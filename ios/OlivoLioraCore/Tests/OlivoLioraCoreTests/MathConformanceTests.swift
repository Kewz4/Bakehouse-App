import XCTest
@testable import OlivoLioraCore

/// Conformidad de las CUENTAS entre JavaScript y Swift.
///
/// Los casos y los resultados esperados los produce business-core.js
/// (`node test/make-math-fixtures.js`). Aquí se repiten con el código de Swift.
///
/// Una divergencia aquí no da error ni cuelga la app: simplemente el teléfono y
/// la laptop enseñarían precios distintos para la misma receta, que es
/// exactamente el tipo de fallo que nadie nota hasta que ya cobró de menos.
final class MathConformanceTests: XCTestCase {

    struct Fixtures: Decodable {
        struct ParseCase: Decodable { let `in`: String; let out: Double }
        struct PrettyCase: Decodable { let `in`: Double; let out: String }
        struct IngredientCase: Decodable {
            struct Input: Decodable {
                let name: String; let quantity: Double
                let price: Double; let unitSingle: String
            }
            let `in`: Input; let out: Double
        }
        struct RecipeCase: Decodable {
            struct Line: Decodable { let qty: Double; let cost: Double }
            struct Input: Decodable {
                let name: String; let yield: Double
                let price: Double; let ingredients: [Line]
            }
            let `in`: Input
            let totalCost: Double, unitCost: Double, margin: Double, suggested: Double
        }
        let parseQty: [ParseCase]
        let prettyQty: [PrettyCase]
        let baseCost: [IngredientCase]
        let recipe: [RecipeCase]
    }

    func load() throws -> Fixtures {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "math-conformance", withExtension: "json"),
            "falta math-conformance.json: corre `node test/make-math-fixtures.js`")
        return try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
    }

    /// "media taza", "1 ½", "2,5"… tienen que dar el mismo número en los dos lados.
    func testQuantityParsingMatchesJavaScript() throws {
        for c in try load().parseQty {
            XCTAssertEqual(Quantity.parse(c.in), c.out, accuracy: 1e-9,
                           "«\(c.in)»: Swift y JavaScript interpretan la cantidad distinto")
        }
    }

    func testQuantityFormattingMatchesJavaScript() throws {
        for c in try load().prettyQty {
            XCTAssertEqual(Quantity.pretty(c.in), c.out,
                           "\(c.in) se muestra distinto en Swift que en la web")
        }
    }

    /// El costo por unidad base es de donde sale todo lo demás.
    func testIngredientBaseCostMatchesJavaScript() throws {
        for c in try load().baseCost {
            let ing = Ingredient(name: c.in.name, unit: "paquete",
                                 quantity: c.in.quantity, price: c.in.price,
                                 unitSingle: c.in.unitSingle)
            XCTAssertEqual(ing.baseCost, c.out, accuracy: 1e-9,
                           "«\(c.in.name)»: costo por unidad base distinto")
        }
    }

    func testRecipeCostingMatchesJavaScript() throws {
        for c in try load().recipe {
            let lines = c.in.ingredients.map {
                RecipeLine(name: "x", qty: $0.qty, unit: "g", cost: $0.cost)
            }
            let r = Recipe(name: c.in.name, yield: c.in.yield, price: c.in.price, lines: lines)
            XCTAssertEqual(r.totalCost, c.totalCost, accuracy: 1e-9, "«\(c.in.name)» costo total")
            XCTAssertEqual(r.unitCost, c.unitCost, accuracy: 1e-9, "«\(c.in.name)» costo por porción")
            XCTAssertEqual(r.margin, c.margin, accuracy: 1e-9, "«\(c.in.name)» margen")
            XCTAssertEqual(r.suggestedPrice(), c.suggested, accuracy: 1e-9, "«\(c.in.name)» precio sugerido")
        }
    }
}
