import Foundation
import Network
import OlivoLioraCore

/// A dónde se sincroniza. Es el mismo sitio que abre ella en la laptop, así que
/// el teléfono y la web comparten exactamente los mismos datos.
enum Config {
    static let baseURL = URL(string: "https://olivo-liora.vercel.app")!
    static var dataURL: URL { baseURL.appendingPathComponent("api/data") }
    static var uploadURL: URL { baseURL.appendingPathComponent("api/upload") }
    static var visionURL: URL { baseURL.appendingPathComponent("api/vision") }
}

/// Lo único que ella llega a ver sobre la sincronización.
/// Sin botones, sin opciones y sin tecnicismos: o está guardado, o se está
/// guardando, o se guardará solo en cuanto vuelva la señal.
enum SyncState: Equatable {
    case saved
    case saving
    case waitingForNetwork
    case localOnly

    var label: String {
        switch self {
        case .saved: return "Todo guardado"
        case .saving: return "Guardando…"
        case .waitingForNetwork: return "Se guardará solo"
        case .localOnly: return "Guardado aquí"
        }
    }
}

/// Guarda el documento en el disco del teléfono.
///
/// Se escribe primero aquí y siempre, pase lo que pase con la red: si la app se
/// cierra, si se va la señal o si el servidor no responde, lo que ella anotó ya
/// está a salvo y subirá después.
struct LocalStore {
    static let filename = "olivo-liora.json"

    static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(filename)
    }

    static func load() -> SyncDocument {
        guard let data = try? Data(contentsOf: fileURL),
              let doc = try? JSONDecoder().decode(SyncDocument.self, from: data)
        else { return SyncDocument() }
        return doc
    }

    static func save(_ doc: SyncDocument) {
        guard let data = try? JSONEncoder().encode(doc) else { return }
        // .atomic evita quedarse con medio archivo si el teléfono se apaga
        // justo mientras escribe.
        try? data.write(to: fileURL, options: .atomic)
    }
}

/// Habla con /api/data.
actor SyncClient {

    struct Response {
        let enabled: Bool
        let doc: SyncDocument?
    }

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 120
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    private struct Envelope: Decodable {
        let enabled: Bool
        let doc: SyncDocument?
    }

    /// Sube el documento y recibe de vuelta el ya combinado con lo de los demás
    /// dispositivos. Un solo viaje hace subida y bajada.
    func push(_ doc: SyncDocument) async throws -> Response {
        var req = URLRequest(url: Config.dataURL)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(doc)

        let (data, response) = try await session.data(for: req)
        try check(response)
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        return Response(enabled: env.enabled, doc: env.doc)
    }

    /// Baja lo que hay en el servidor sin subir nada.
    func pull() async throws -> Response {
        var req = URLRequest(url: Config.dataURL)
        req.httpMethod = "GET"
        req.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await session.data(for: req)
        try check(response)
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        return Response(enabled: env.enabled, doc: env.doc)
    }

    /// Sube una foto y devuelve su dirección definitiva.
    func uploadPhoto(dataURL: String, filename: String) async throws -> String? {
        var req = URLRequest(url: Config.uploadURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(
            withJSONObject: ["filename": filename, "dataUrl": dataURL])

        let (data, response) = try await session.data(for: req)
        try check(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["url"] as? String
    }

    // MARK: - Leer etiquetas nutricionales

    struct LabelScan: Sendable {
        var ok: Bool
        /// Por 100 unidades base. `nil` = la etiqueta no lo dice.
        var macros: [String: Double?] = [:]
        var confianza: String = "media"
        var mensaje: String?
    }

    private struct ScanEnvelope: Decodable {
        let ok: Bool?
        let enabled: Bool?
        let macros: [String: Double?]?
        let confianza: String?
        let mensaje: String?
    }

    /// ¿El servidor puede leer etiquetas? Si no, la app ni enseña la cámara.
    func visionEnabled() async -> Bool {
        var req = URLRequest(url: Config.visionURL)
        req.httpMethod = "GET"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await session.data(for: req),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let env = try? JSONDecoder().decode(ScanEnvelope.self, from: data)
        else { return false }
        return env.enabled == true
    }

    /// Manda la foto de la etiqueta. La llave de Groq vive en el servidor, así
    /// que la app nunca la ve ni la lleva dentro.
    func scanLabel(dataURL: String, packageQty: Double, packageUnit: String) async throws -> LabelScan {
        var req = URLRequest(url: Config.visionURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Subir la foto por datos móviles y esperar a que el modelo la lea pasa
        // de los 20 s que valen para el resto de peticiones. Con el timeout
        // corto, una lectura que iba bien se veía como "no pude leerla".
        req.timeoutInterval = 60
        // JSONSerialization lanza con NaN o infinito, y ese error se vería como
        // "no pude leer la etiqueta" sin que la etiqueta tuviera nada que ver.
        let safeQty = packageQty.isFinite ? packageQty : 0
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "dataUrl": dataURL,
            "paquete": ["cantidad": safeQty, "unitSingle": packageUnit]
        ])

        let (data, response) = try await session.data(for: req)
        try check(response)
        let env = try JSONDecoder().decode(ScanEnvelope.self, from: data)
        return LabelScan(ok: env.ok == true,
                         macros: env.macros ?? [:],
                         confianza: env.confianza ?? "media",
                         mensaje: env.mensaje)
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}

/// Avisa cuando hay o no hay internet, para subir en cuanto vuelva la señal
/// sin que ella tenga que hacer nada.
@MainActor
final class NetworkMonitor {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "olivo.network")
    private(set) var isOnline = true
    var onBecameOnline: (() -> Void)?

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasOffline = !self.isOnline
                self.isOnline = path.status == .satisfied
                if wasOffline && self.isOnline { self.onBecameOnline?() }
            }
        }
        monitor.start(queue: queue)
    }

    func stop() { monitor.cancel() }
}
