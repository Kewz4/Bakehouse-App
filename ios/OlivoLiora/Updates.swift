import Foundation
import Observation
import UIKit

/// Se encarga de que la app se actualice sola.
///
/// La idea es que ella nunca tenga que instalar nada a mano ni saber que existe
/// un número de versión: si hay algo más nuevo publicado, aparece un botón que
/// dice "Actualizar" y con tocarlo se acabó. Si no hay nada nuevo, no aparece
/// absolutamente nada.
@MainActor
@Observable
final class Updates {

    enum Phase: Equatable {
        case idle           // no hay nada nuevo (o todavía no se ha mirado)
        case ready          // hay una versión nueva esperando
        case installing     // ella tocó el botón; iOS se está encargando
    }

    private(set) var phase: Phase = .idle

    private let client: SyncClient
    private var installURL: URL?
    private var lastCheck: Date?

    /// No tiene sentido preguntar en cada vuelta a la app: se publica una
    /// versión cada muchas horas, no cada minuto.
    private static let minimumInterval: TimeInterval = 10 * 60

    init(client: SyncClient) {
        self.client = client
    }

    /// El número de compilación de la app que está corriendo ahora mismo.
    ///
    /// Se compara este número, y no el "1.0.0" que se ve en los textos, porque
    /// sube en cada publicación y es un entero: comparar dos enteros no tiene
    /// casos raros, y comparar "1.10" contra "1.9" sí.
    static var currentBuild: Int {
        let raw = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        return Int(raw ?? "") ?? 0
    }

    func check(force: Bool = false) async {
        // Mientras se está instalando no hay nada que volver a mirar: la app
        // está a punto de ser reemplazada.
        guard phase != .installing else { return }

        if !force, let last = lastCheck, Date().timeIntervalSince(last) < Self.minimumInterval {
            return
        }

        guard let latest = await client.latestVersion() else { return }
        lastCheck = Date()

        // Estrictamente mayor. Igual no es una actualización, y menor significa
        // que este teléfono va por delante de lo publicado — que pasa mientras
        // se prueba una compilación antes de publicarla, y ahí ofrecer
        // "actualizar" sería mandarla hacia atrás.
        guard latest.build > Self.currentBuild, let url = URL(string: latest.install) else {
            phase = .idle
            installURL = nil
            return
        }

        installURL = url
        phase = .ready
    }

    /// iOS se encarga del resto: pregunta si instalar, baja la app y la
    /// reemplaza en su sitio. Los datos guardados en el teléfono se quedan
    /// donde están, porque es la misma app y no una nueva.
    func install() {
        guard let installURL else { return }
        phase = .installing
        UIApplication.shared.open(installURL)
    }
}
