import Foundation
import Observation
import OlivoLioraCore

/// El estado de la app y toda la sincronización.
///
/// Regla de oro: escribir en el disco es inmediato y nunca falla por culpa de
/// la red. Subir es un intento que se repite hasta que sale. Así ella puede
/// anotar una venta en el mercado sin señal, guardar el teléfono y encontrarse
/// todo en la laptop cuando llegue a casa, sin tocar nada.
@MainActor
@Observable
final class AppStore {

    private(set) var doc: SyncDocument
    private(set) var syncState: SyncState = .saving
    /// Falso mientras el servidor no tenga almacén conectado: la app funciona
    /// igual, sólo que los datos se quedan en este dispositivo.
    private(set) var cloudEnabled = false

    /// Filtro del panel. Es lo único configurable, y es parte del negocio
    /// (¿cómo me fue este mes?), no un ajuste técnico.
    var period: Period = .month
    var customFrom = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    var customTo = Date()

    private let client = SyncClient()
    private let monitor = NetworkMonitor()

    private var syncTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var pendingUpload = false      // hay cambios locales sin confirmar
    private var attempt = 0                // para la espera creciente entre reintentos
    private var isSyncing = false
    private var syncAgain = false

    init(doc: SyncDocument? = nil, startBackgroundWork: Bool = true) {
        self.doc = doc ?? LocalStore.load()
        guard startBackgroundWork else { return }
        monitor.onBecameOnline = { [weak self] in
            self?.attempt = 0
            self?.scheduleSync(after: .milliseconds(200))
            self?.refreshFromServer()
        }
        monitor.start()
        Task { await boot() }
    }

    var range: ClosedRange<Date> {
        period.range(from: customFrom, to: customTo)
    }

    // MARK: - Lecturas para la interfaz

    var recipes: [Recipe] { Analytics.recipes(doc).sorted { $0.name < $1.name } }
    var ingredients: [Ingredient] { Analytics.ingredients(doc).sorted { $0.name < $1.name } }
    var allSales: [Sale] { Analytics.sales(doc) }
    var allExpenses: [Expense] { Analytics.expenses(doc) }

    var sales: [Sale] { allSales.filter { Analytics.inRange($0.date, range) } }
    var expenses: [Expense] { allExpenses.filter { Analytics.inRange($0.date, range) } }

    var metrics: Metrics { Analytics.metrics(doc: doc, range: range) }
    var topProducts: [TopProduct] { Analytics.topProducts(doc: doc, range: range) }
    var monthlyBars: [MonthBar] { Analytics.monthlyBars(doc: doc) }
    var alerts: [(title: String, detail: String)] { Analytics.alerts(doc: doc) }

    var recipesById: [String: Recipe] {
        Dictionary(recipes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    func recipe(id: String) -> Recipe? { recipesById[id] }
    func profit(of sale: Sale) -> Double { Analytics.profit(of: sale, recipes: recipesById) }

    // MARK: - Escrituras

    func upsert<T: RecordBacked>(_ item: T, into collection: Ledger) {
        var copy = item
        copy.touch()
        var list = doc[collection].filter { $0.id != copy.id }
        list.append(copy.record)
        doc[collection] = list
        save()
    }

    func save(_ ingredient: Ingredient) { upsert(ingredient, into: .ingredients) }
    func save(_ recipe: Recipe) { upsert(recipe, into: .recipes) }
    func save(_ sale: Sale) { upsert(sale, into: .sales) }
    func save(_ expense: Expense) { upsert(expense, into: .expenses) }

    /// Borrar deja una lápida en vez de quitar el registro. Sin ella, el
    /// borrado no viajaría y el otro dispositivo lo devolvería a la vida.
    func delete(id: String, from collection: Ledger) {
        var list = doc[collection].filter { $0.id != id }
        list.append(MergeEngine.tombstone(id: id))
        doc[collection] = list
        save()
    }

    func duplicate(_ recipe: Recipe) {
        var copy = recipe
        copy.record.fields["id"] = .string(UUID().uuidString)
        copy.name = recipe.name + " (copia)"
        save(copy)
    }

    private func save() {
        doc.updatedAt = MergeEngine.now()
        LocalStore.save(doc)
        pendingUpload = true
        syncState = cloudEnabled ? .saving : .localOnly
        scheduleSync(after: .milliseconds(400))
    }

    // MARK: - Sincronización

    private func boot() async {
        syncState = .saving
        do {
            let res = try await client.pull()
            guard res.enabled else { cloudEnabled = false; syncState = .localOnly; return }
            cloudEnabled = true
            if let remote = res.doc { adopt(MergeEngine.merge(doc, remote)) }
            await performSync()
            startPeriodicRefresh()
        } catch {
            cloudEnabled = false
            syncState = .localOnly
        }
    }

    private func adopt(_ merged: SyncDocument) {
        doc = merged
        LocalStore.save(doc)
    }

    private func scheduleSync(after delay: Duration) {
        guard cloudEnabled else { return }
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.performSync()
        }
    }

    private func performSync() async {
        guard cloudEnabled else { return }
        if isSyncing { syncAgain = true; return }
        isSyncing = true
        defer {
            isSyncing = false
            if syncAgain { syncAgain = false; scheduleSync(after: .milliseconds(300)) }
        }

        if pendingUpload { syncState = .saving }
        let sent = doc

        do {
            let res = try await client.push(sent)
            guard res.enabled else { cloudEnabled = false; syncState = .localOnly; return }
            if let remote = res.doc {
                // Volvemos a combinar contra lo local por si ella escribió algo
                // mientras el viaje estaba en curso.
                adopt(MergeEngine.merge(doc, remote))
                // Sólo damos la subida por buena si el servidor de verdad tiene
                // lo nuestro; si no, reintentamos.
                pendingUpload = !MergeEngine.contains(remote, sent)
            } else {
                pendingUpload = false
            }
            attempt = 0
            syncState = pendingUpload ? .waitingForNetwork : .saved
            if pendingUpload { scheduleSync(after: .milliseconds(1500)) }
        } catch {
            // Sin señal o servidor caído. Lo local sigue intacto: reintentamos
            // con esperas cada vez más largas, hasta un minuto.
            attempt += 1
            syncState = .waitingForNetwork
            let seconds = min(60, pow(2.0, Double(min(attempt, 6))))
            scheduleSync(after: .seconds(seconds))
        }
    }

    /// Baja lo que hicieron los otros dispositivos.
    func refreshFromServer() {
        guard cloudEnabled, !isSyncing else { return }
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            do {
                let res = try await self.client.pull()
                guard res.enabled, let remote = res.doc else { return }
                let merged = MergeEngine.merge(self.doc, remote)
                if merged.canonical != self.doc.canonical {
                    self.adopt(merged)
                    if !self.pendingUpload { self.syncState = .saved }
                }
            } catch {
                // Sin señal: da igual, se reintenta en el próximo ciclo.
            }
        }
    }

    /// Cada 30 segundos mientras la app está abierta, para que lo que ella
    /// anote en la laptop aparezca en el teléfono sin tener que cerrarla.
    private func startPeriodicRefresh() {
        refreshTask?.cancel()
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard let self else { return }
                self.refreshFromServer()
            }
        }
    }

    /// Al volver a abrir la app: bajar lo nuevo y subir lo que quedó pendiente.
    func appBecameActive() {
        if !cloudEnabled {
            Task { await boot() }
            return
        }
        refreshFromServer()
        if pendingUpload { scheduleSync(after: .milliseconds(200)) }
    }

    /// Al mandar la app al fondo: intentar subir ya lo que falte.
    func appWillResignActive() {
        LocalStore.save(doc)
        if pendingUpload { scheduleSync(after: .milliseconds(0)) }
    }

    // MARK: - Fotos

    /// Sube una foto y devuelve la dirección que hay que guardar en la receta.
    /// Si no hay señal, devuelve el data URL: la foto se ve igual en este
    /// teléfono y se reemplazará por la dirección definitiva más adelante.
    func uploadPhoto(dataURL: String, filename: String) async -> String {
        guard cloudEnabled else { return dataURL }
        do {
            if let url = try await client.uploadPhoto(dataURL: dataURL, filename: filename) {
                return url
            }
        } catch {
            // Se queda la copia local.
        }
        return dataURL
    }
}
