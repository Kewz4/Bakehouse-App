import XCTest
@testable import OlivoLioraCore

/// Conformidad entre los dos motores de combinación.
///
/// Los casos y el resultado esperado los genera el motor de JavaScript
/// (`node test/make-conformance-fixtures.js`). Aquí se combinan los mismos
/// documentos con el motor de Swift y se exige el mismo texto, carácter por
/// carácter.
///
/// Es la red de seguridad de la paridad: si alguien cambia la regla en un solo
/// lado, esta prueba falla en vez de que la laptop y el teléfono empiecen a
/// mostrar cosas distintas.
final class ConformanceTests: XCTestCase {

    struct Case: Decodable {
        let name: String
        let a: SyncDocument
        let b: SyncDocument
        let expectedAB: String
        let expectedBA: String
    }

    func loadCases() throws -> [Case] {
        guard let url = Bundle.module.url(forResource: "merge-conformance", withExtension: "json") else {
            XCTFail("falta merge-conformance.json: corre `node test/make-conformance-fixtures.js`")
            return []
        }
        return try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    }

    func testSwiftMergeMatchesJavaScriptMerge() throws {
        let cases = try loadCases()
        XCTAssertFalse(cases.isEmpty, "no se cargó ningún caso")

        for c in cases {
            let ab = MergeEngine.merge(c.a, c.b).canonical
            let ba = MergeEngine.merge(c.b, c.a).canonical

            XCTAssertEqual(ab, c.expectedAB, "caso «\(c.name)»: Swift y JavaScript combinan distinto (a+b)")
            XCTAssertEqual(ba, c.expectedBA, "caso «\(c.name)»: Swift y JavaScript combinan distinto (b+a)")
            XCTAssertEqual(ab, ba, "caso «\(c.name)»: la combinación debe ser conmutativa también en Swift")
        }
    }

    /// Combinar tres veces no puede cambiar nada: si cambiara, sincronizar dos
    /// veces seguidas movería datos.
    func testRepeatedMergeIsStable() throws {
        for c in try loadCases() {
            let once = MergeEngine.merge(c.a, c.b)
            let twice = MergeEngine.merge(once, c.b)
            let thrice = MergeEngine.merge(twice, c.a)
            XCTAssertEqual(once.canonical, twice.canonical, "caso «\(c.name)»")
            XCTAssertEqual(once.canonical, thrice.canonical, "caso «\(c.name)»")
        }
    }
}
