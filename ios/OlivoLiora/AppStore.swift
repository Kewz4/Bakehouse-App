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
    private var periodicTask: Task<Void, Never>?
    private var pendingUpload = false      // hay cambios locales sin confirmar
    private var attempt = 0                // para la espera creciente entre reintentos
    private var isSyncing = false
    /// Sube en cada escritura. Sirve para saber si ella escribió algo mientras
    /// una subida estaba en curso.
    private var writeGeneration = 0
    private var syncAgain = false

    init(doc: SyncDocument? = nil, startBackgroundWork: Bool = true) {
        self.doc = doc ?? LocalStore.load()
        guard startBackgroundWork else { return }
        monitor.onBecameOnline = { [weak self] in
            guard let self else { return }
            self.attempt = 0
            guard self.cloudEnabled else {
                // Arrancó sin señal: no llegó a saber si hay almacén. Ahora que
                // hay internet, se vuelve a intentar el arranque completo.
                Task { await self.boot() }
                return
            }
            self.scheduleSync(after: .milliseconds(200))
            self.refreshFromServer()
            Task { await self.reconcilePhotos() }
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
    var ingredientsById: [String: Ingredient] {
        Dictionary(ingredients.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// Resumen nutricional de una receta, si hay datos.
    func macros(of recipe: Recipe) -> RecipeMacros {
        Analytics.macros(for: recipe, ingredients: ingredientsById)
    }

    /// Etiquetas de dieta de una receta.
    func badges(of recipe: Recipe) -> BadgeResult {
        Badges.evaluate(recipe: recipe, ingredients: ingredientsById)
    }

    /// Sólo las etiquetas que alguna receta tiene de verdad, con su cuenta.
    /// Ofrecer un filtro que no devuelve nada es peor que no ofrecerlo.
    var availableBadges: [(badge: DietBadge, count: Int)] {
        let index = ingredientsById
        var counts: [String: Int] = [:]
        for recipe in recipes {
            for b in Badges.evaluate(recipe: recipe, ingredients: index).badges {
                counts[b.key, default: 0] += 1
            }
        }
        return Badges.all.compactMap { b in
            guard let n = counts[b.key] else { return nil }
            return (b, n)
        }
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
        writeGeneration &+= 1
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
            await reconcilePhotos()
            await checkVision()
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
        let sentGeneration = writeGeneration

        do {
            let res = try await client.push(sent)
            guard res.enabled else { cloudEnabled = false; syncState = .localOnly; return }
            if let remote = res.doc {
                // Volvemos a combinar contra lo local por si ella escribió algo
                // mientras el viaje estaba en curso.
                adopt(MergeEngine.merge(doc, remote))
                // Sólo damos la subida por buena si el servidor de verdad tiene
                // lo nuestro Y ella no escribió nada nuevo durante el viaje.
                let confirmed = MergeEngine.contains(remote, sent)
                    && writeGeneration == sentGeneration
                pendingUpload = !confirmed
            } else {
                pendingUpload = writeGeneration != sentGeneration
            }
            attempt = 0
            syncState = pendingUpload ? .waitingForNetwork : .saved
            if pendingUpload { scheduleSync(after: .milliseconds(1500)) }
            // Acabamos de comprobar que hay señal: buen momento para subir las
            // fotos que se hayan quedado guardadas como texto. Si no hay
            // ninguna, no hace nada.
            Task { await reconcilePhotos() }
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
    ///
    /// El bucle se guarda para poder cancelarlo: `boot()` puede volver a
    /// llamarse (por ejemplo si la primera vez no había señal y luego sí), y sin
    /// esto quedaría un bucle extra vivo por cada intento.
    private func startPeriodicRefresh() {
        periodicTask?.cancel()
        periodicTask = Task { [weak self] in
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

    // MARK: - Leer etiquetas nutricionales

    /// Falso mientras el servidor no tenga la llave: entonces el botón de la
    /// cámara ni aparece, en vez de ofrecer algo que va a fallar.
    private(set) var visionEnabled = false

    private func checkVision() async {
        visionEnabled = await client.visionEnabled()
    }

    func scanLabel(dataURL: String, packageQty: Double, packageUnit: String) async -> SyncClient.LabelScan {
        do {
            return try await client.scanLabel(dataURL: dataURL,
                                              packageQty: packageQty, packageUnit: packageUnit)
        } catch {
            return SyncClient.LabelScan(
                ok: false, mensaje: "No pude leer la etiqueta ahora. Puedes escribir los datos a mano.")
        }
    }

    // MARK: - Fotos

    private var reconcilingPhotos = false

    /// Una foto tomada sin señal se queda dentro del documento como texto
    /// (data:image/…). Son cientos de kB por foto, no se ven en los otros
    /// dispositivos, y si se juntan varias el documento deja de caber y la
    /// sincronización se rompe del todo.
    ///
    /// Esto las sube de una en una en cuanto hay internet y las reemplaza por su
    /// dirección. Se cura solo: las fotos van por su propio endpoint, así que
    /// funciona incluso si el documento ya está demasiado grande para subirse.
    func reconcilePhotos() async {
        guard cloudEnabled, !reconcilingPhotos else { return }
        let pending = Analytics.recipes(doc).filter { $0.photo.hasPrefix("data:") }
        guard !pending.isEmpty else { return }

        reconcilingPhotos = true
        defer { reconcilingPhotos = false }

        for var recipe in pending {
            let url = await uploadPhoto(dataURL: recipe.photo,
                                        filename: (recipe.name.isEmpty ? "postre" : recipe.name) + ".jpg")
            guard url.hasPrefix("http") else { return }  // sigue sin señal
            recipe.photo = url
            save(recipe)
        }
    }

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
