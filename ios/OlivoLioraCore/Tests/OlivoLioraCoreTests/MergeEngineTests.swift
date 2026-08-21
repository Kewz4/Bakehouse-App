import XCTest
@testable import OlivoLioraCore

/// Las mismas propiedades que se prueban en test/sync-core.test.js del lado web.
/// Tienen que valer en los dos lados o el teléfono y la laptop pueden quedar en
/// desacuerdo para siempre.
final class MergeEngineTests: XCTestCase {

    // Marcas de tiempo realistas: las lápidas se limpian a los 120 días, así que
    // usar números pequeños las haría parecer de 1970.
    let base = MergeEngine.now()

    func rec(_ id: String, _ offset: Double, _ extra: [String: JSONValue] = [:]) -> Record {
        var fields: [String: JSONValue] = ["id": .string(id), "updatedAt": .number(base + offset), "deleted": .bool(false)]
        for (k, v) in extra { fields[k] = v }
        return Record(fields)
    }

    func doc(_ c: Ledger, _ list: [Record]) -> SyncDocument {
        var d = SyncDocument(); d[c] = list; return d
    }

    func ids(_ d: SyncDocument, _ c: Ledger) -> [String] {
        d.live(c).map(\.id).sorted()
    }

    func canon(_ d: SyncDocument) -> String {
        Ledger.allCases.map { c in d[c].map(\.canonical).joined(separator: "|") }.joined(separator: "#")
    }

    func testNewerRecordWins() {
        let a = doc(.sales, [rec("s1", 100, ["total": 10])])
        let b = doc(.sales, [rec("s1", 200, ["total": 99])])
        XCTAssertEqual(MergeEngine.merge(a, b).sales[0].double("total"), 99)
        XCTAssertEqual(MergeEngine.merge(b, a).sales[0].double("total"), 99)
    }

    func testMergeIsCommutative() {
        let a = doc(.sales, [rec("s1", 100, ["total": 10]), rec("s2", 300, ["total": 5])])
        let b = doc(.sales, [rec("s1", 200, ["total": 99]), rec("s3", 150, ["total": 7])])
        XCTAssertEqual(canon(MergeEngine.merge(a, b)), canon(MergeEngine.merge(b, a)))
    }

    func testMergeIsAssociative() {
        let a = doc(.expenses, [rec("e1", 100, ["amount": 1])])
        let b = doc(.expenses, [rec("e1", 200, ["amount": 2]), rec("e2", 50, ["amount": 9])])
        let c = doc(.expenses, [rec("e1", 150, ["amount": 3]), rec("e3", 400, ["amount": 4])])
        XCTAssertEqual(
            canon(MergeEngine.merge(MergeEngine.merge(a, b), c)),
            canon(MergeEngine.merge(a, MergeEngine.merge(b, c))))
    }

    func testMergeIsIdempotent() {
        let a = doc(.recipes, [rec("r1", 100, ["name": "Brownie"])])
        let b = doc(.recipes, [rec("r1", 200, ["name": "Brownie de nuez"])])
        let once = MergeEngine.merge(a, b)
        XCTAssertEqual(canon(MergeEngine.merge(once, b)), canon(once))
        XCTAssertEqual(canon(MergeEngine.merge(once, once)), canon(once))
    }

    func testExactTieResolvesTheSameBothWays() {
        let a = doc(.sales, [rec("s1", 500, ["total": 10])])
        let b = doc(.sales, [rec("s1", 500, ["total": 20])])
        XCTAssertEqual(canon(MergeEngine.merge(a, b)), canon(MergeEngine.merge(b, a)))
    }

    func testDeleteOnPhoneDoesNotComeBackFromLaptop() {
        let laptop = doc(.expenses, [rec("e1", 100, ["name": "Gas"])])
        let phone = doc(.expenses, [MergeEngine.tombstone(id: "e1", now: base + 200)])
        XCTAssertEqual(ids(MergeEngine.merge(laptop, phone), .expenses), [])
        XCTAssertEqual(ids(MergeEngine.merge(phone, laptop), .expenses), [])
    }

    func testEditAfterDeleteRevivesOnPurpose() {
        let deleted = doc(.expenses, [MergeEngine.tombstone(id: "e1", now: base + 100)])
        let edited = doc(.expenses, [rec("e1", 300, ["name": "Gas para horno"])])
        let out = MergeEngine.merge(deleted, edited)
        XCTAssertEqual(ids(out, .expenses), ["e1"])
        XCTAssertEqual(out.expenses[0].string("name"), "Gas para horno")
    }

    func testOfflinePhoneEditAndLaptopEditBothSurvive() {
        // Ella anota una venta en el mercado sin señal y un gasto en la laptop
        // en casa. Al volver el internet tienen que quedar las dos cosas.
        let start = doc(.sales, [rec("s0", 50, ["product": "Cheesecake"])])
        let phone = MergeEngine.merge(start, doc(.sales, [rec("s-phone", 900, ["product": "Brownies"])]))
        let laptop = MergeEngine.merge(start, doc(.sales, [rec("s-laptop", 800, ["product": "Flan"])]))
        XCTAssertEqual(ids(MergeEngine.merge(phone, laptop), .sales), ["s-laptop", "s-phone", "s0"])
    }

    func testThreeDevicesConvergeRegardlessOfOrder() {
        let a = doc(.sales, [rec("a", 100), rec("shared", 500, ["v": "A"])])
        let b = doc(.sales, [rec("b", 200), rec("shared", 700, ["v": "B"])])
        let c = doc(.sales, [rec("c", 300), rec("shared", 600, ["v": "C"])])

        let orders = [
            canon(MergeEngine.merge(MergeEngine.merge(a, b), c)),
            canon(MergeEngine.merge(MergeEngine.merge(c, a), b)),
            canon(MergeEngine.merge(MergeEngine.merge(b, c), a)),
            canon(MergeEngine.merge(a, MergeEngine.merge(b, c)))
        ]
        XCTAssertEqual(Set(orders).count, 1, "todos los órdenes deben dar el mismo resultado")
        let out = MergeEngine.merge(MergeEngine.merge(a, b), c)
        XCTAssertEqual(out.live(.sales).first { $0.id == "shared" }?.string("v"), "B")
    }

    func testRecordsWithoutTimestampLoseToAnyEdit() {
        let old = doc(.recipes, [Record(["id": "r1", "name": "Sin fecha"])])
        let new = doc(.recipes, [rec("r1", 10, ["name": "Con fecha"])])
        let normalizedOld = MergeEngine.normalize(document: old)
        XCTAssertEqual(MergeEngine.merge(normalizedOld, new).recipes[0].string("name"), "Con fecha")
    }

    func testDuplicateIdsCollapse() {
        let d = MergeEngine.normalize(document: doc(.sales, [
            rec("s1", 100, ["total": 1]), rec("s1", 200, ["total": 2])
        ]))
        XCTAssertEqual(d.sales.count, 1)
        XCTAssertEqual(d.sales[0].double("total"), 2)
    }

    func testContainsDetectsMissingChanges() {
        let mine = doc(.sales, [rec("s1", 500)])
        XCTAssertTrue(MergeEngine.contains(doc(.sales, [rec("s1", 500)]), mine))
        XCTAssertTrue(MergeEngine.contains(doc(.sales, [rec("s1", 900)]), mine))
        XCTAssertFalse(MergeEngine.contains(doc(.sales, [rec("s1", 100)]), mine))
        XCTAssertFalse(MergeEngine.contains(SyncDocument(), mine))
    }

    func testOldTombstonesArePurgedAndRecentOnesKept() {
        var d = doc(.sales, [
            MergeEngine.tombstone(id: "viejo", now: base - MergeEngine.tombstoneTTL - 1000),
            MergeEngine.tombstone(id: "reciente", now: base - 1000)
        ])
        MergeEngine.purgeTombstones(&d, now: base)
        XCTAssertEqual(d.sales.map(\.id), ["reciente"])
    }

    func testUnknownFieldsSurviveARoundTrip() {
        // Si la web añade un campo que esta versión de la app no conoce, la app
        // tiene que devolverlo intacto y no borrárselo a todos al sincronizar.
        let json = """
        {"v":2,"sales":[{"id":"s1","updatedAt":\(Int(base)),"deleted":false,\
        "product":"Flan","campoDelFuturo":{"algo":[1,2,3]}}],\
        "ingredients":[],"recipes":[],"expenses":[],"updatedAt":\(Int(base))}
        """
        let doc = try! JSONDecoder().decode(SyncDocument.self, from: Data(json.utf8))
        let out = try! JSONEncoder().encode(doc)
        let again = try! JSONDecoder().decode(SyncDocument.self, from: out)
        XCTAssertNotNil(again.sales.first?["campoDelFuturo"], "el campo desconocido debe sobrevivir")
        XCTAssertEqual(again.sales.first?["campoDelFuturo"]?.objectValue?["algo"]?.arrayValue?.count, 3)
    }

    func testDecodingToleratesGarbage() {
        let json = """
        {"sales":"no soy una lista","recipes":[null,5,"x"],"ingredients":[],"expenses":[]}
        """
        let doc = try? JSONDecoder().decode(SyncDocument.self, from: Data(json.utf8))
        XCTAssertEqual(doc?.sales.count, 0)
        XCTAssertEqual(doc?.recipes.count, 0)
    }
}
