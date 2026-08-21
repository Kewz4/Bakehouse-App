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
        struct MacroRecipeCase: Decodable {
            struct Line: Decodable {
                let ingredientId: String?; let qty: Double; let unit: String
            }
            struct Input: Decodable {
                let name: String; let yield: Double; let ingredients: [Line]
            }
            let `in`: Input
            let totals: [String: Double]
            let perServing: [String: Double]
            let contadas: Int
            let total: Int
            let completo: Bool
        }
        struct BadgeCase: Decodable {
            struct Line: Decodable {
                let ingredientId: String?; let qty: Double; let unit: String
            }
            struct Input: Decodable {
                let name: String; let yield: Double; let ingredients: [Line]
            }
            let `in`: Input
            let badges: [String]
            let motivo: String?
        }
        let badgeIngredients: [String: JSONValue]
        let badgeRecipes: [BadgeCase]
        let macroIngredients: [String: JSONValue]
        let macroRecipes: [MacroRecipeCase]
        let parseQty: [ParseCase]
        let prettyQty: [PrettyCase]
        struct DisplayCostCase: Decodable {
            let `in`: IngredientCase.Input
            let amount: Double
            let unit: String
        }
        let baseCost: [IngredientCase]
        let displayCost: [DisplayCostCase]
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

    /// Los macros de una receta tienen que sumar igual en los dos lados.
    /// Una diferencia aquí no rompe nada: sólo hace que el teléfono y la laptop
    /// muestren distinta azúcar para el mismo postre.
    func testRecipeMacrosMatchJavaScript() throws {
        let f = try load()

        // Los ingredientes vienen tal cual del lado JavaScript.
        var ingredients: [String: Ingredient] = [:]
        for (id, raw) in f.macroIngredients {
            guard let obj = raw.objectValue else { continue }
            var rec = Record(obj)
            rec.id = id
            ingredients[id] = Ingredient(record: rec)
        }
        XCTAssertFalse(ingredients.isEmpty, "no se cargaron los ingredientes de prueba")

        for c in f.macroRecipes {
            let lines = c.in.ingredients.map {
                RecipeLine(ingredientId: $0.ingredientId, name: "x",
                           qty: $0.qty, unit: $0.unit, cost: 0)
            }
            let recipe = Recipe(name: c.in.name, yield: c.in.yield, price: 0, lines: lines)
            let got = Analytics.macros(for: recipe, ingredients: ingredients)

            XCTAssertEqual(got.counted, c.contadas, "«\(c.in.name)» ingredientes contados")
            XCTAssertEqual(got.total, c.total, "«\(c.in.name)» ingredientes totales")
            XCTAssertEqual(got.isComplete, c.completo, "«\(c.in.name)» cobertura completa")

            for m in Macro.allCases {
                XCTAssertEqual(got.totals[m] ?? 0, c.totals[m.rawValue] ?? 0, accuracy: 1e-9,
                               "«\(c.in.name)» total de \(m.rawValue)")
                XCTAssertEqual(got.perServing[m] ?? 0, c.perServing[m.rawValue] ?? 0, accuracy: 1e-9,
                               "«\(c.in.name)» por porción de \(m.rawValue)")
            }
        }
    }

    /// Un dato que la etiqueta no trae se queda en nil, no en cero. Guardarlo
    /// como cero diría que el producto no tiene fibra, que es otra cosa.
    func testMissingMacroStaysNilNotZero() {
        var ing = Ingredient(name: "Leche", unit: "botella", quantity: 1,
                             price: 1.15, unitSingle: "l")
        ing.setMacro(.calorias, 61)
        ing.setMacro(.fibra, nil)
        XCTAssertEqual(ing.macro(.calorias), 61)
        XCTAssertNil(ing.macro(.fibra))
        XCTAssertTrue(ing.hasMacros)

        // Un cero explícito sí es un dato.
        var azucar = Ingredient(name: "Azúcar", unit: "bolsa", quantity: 1,
                                price: 1, unitSingle: "kg")
        azucar.setMacro(.grasa, 0)
        XCTAssertEqual(azucar.macro(.grasa), 0)
        XCTAssertTrue(azucar.hasMacros)

        // Y quitar el último dato deja el ingrediente sin macros del todo.
        azucar.setMacro(.grasa, nil)
        XCTAssertFalse(azucar.hasMacros)
    }

    /// Las etiquetas de dieta tienen que salir idénticas en los dos lados,
    /// incluidas las que NO se ponen. Que el teléfono diga "Sin azúcar" donde
    /// la laptop no lo dice sería peor que no tener etiquetas.
    func testDietBadgesMatchJavaScript() throws {
        let f = try load()

        var ingredients: [String: Ingredient] = [:]
        for (id, raw) in f.badgeIngredients {
            guard let obj = raw.objectValue else { continue }
            var rec = Record(obj)
            rec.id = id
            ingredients[id] = Ingredient(record: rec)
        }
        XCTAssertFalse(ingredients.isEmpty)

        for c in f.badgeRecipes {
            let lines = c.in.ingredients.map {
                RecipeLine(ingredientId: $0.ingredientId, name: "x",
                           qty: $0.qty, unit: $0.unit, cost: 0)
            }
            let recipe = Recipe(name: c.in.name, yield: c.in.yield, price: 0, lines: lines)
            let got = Badges.evaluate(recipe: recipe, ingredients: ingredients)

            XCTAssertEqual(got.badges.map(\.key), c.badges,
                           "«\(c.in.name)»: etiquetas distintas entre Swift y JavaScript")
        }
    }

    /// Una receta a la que le falten datos no lleva NINGUNA etiqueta, pase lo
    /// que pase con los ingredientes que sí tienen. Es la regla que impide
    /// afirmar algo sobre salud a partir de información incompleta.
    func testIncompleteRecipeGetsNoBadges() throws {
        let f = try load()
        let incomplete = f.badgeRecipes.first { $0.motivo == "faltan-datos" }
        let c = try XCTUnwrap(incomplete, "hace falta un caso con datos incompletos")

        var ingredients: [String: Ingredient] = [:]
        for (id, raw) in f.badgeIngredients {
            guard let obj = raw.objectValue else { continue }
            var rec = Record(obj); rec.id = id
            ingredients[id] = Ingredient(record: rec)
        }
        let lines = c.in.ingredients.map {
            RecipeLine(ingredientId: $0.ingredientId, name: "x",
                       qty: $0.qty, unit: $0.unit, cost: 0)
        }
        let got = Badges.evaluate(
            recipe: Recipe(name: c.in.name, yield: c.in.yield, price: 0, lines: lines),
            ingredients: ingredients)

        XCTAssertTrue(got.badges.isEmpty)
        XCTAssertEqual(got.reason, .missingData)
    }

    /// "A cuánto sale" tiene que elegir la misma unidad en los dos lados.
    /// Si no, el teléfono diría "$1.24 por lb" y la laptop "$0.00 por g" para
    /// el mismo ingrediente.
    func testReadableCostUnitMatchesJavaScript() throws {
        for c in try load().displayCost {
            let ing = Ingredient(name: c.in.name, unit: "paquete",
                                 quantity: c.in.quantity, price: c.in.price,
                                 unitSingle: c.in.unitSingle)
            let got = ing.displayCost
            XCTAssertEqual(got.unit, c.unit, "«\(c.in.name)»: unidad distinta")
            XCTAssertEqual(got.amount, c.amount, accuracy: 1e-9, "«\(c.in.name)»: importe distinto")
        }
    }

    /// Regresión: el costo por unidad de una línea NO puede redondearse.
    /// La web lo guardaba con 4 decimales y iOS con toda la precisión, así que
    /// la misma receta costaba distinto en cada plataforma — 1.19% de más en la
    /// web para una harina que sale a $0.0028661 el gramo.
    func testRecipeLineCostKeepsFullPrecision() {
        let harina = Ingredient(name: "Harina", unit: "bolsa", quantity: 5,
                                price: 6.5, unitSingle: "lb")
        let perGram = harina.baseCost
        XCTAssertEqual(perGram, 6.5 / (5 * 453.592), accuracy: 1e-12)

        let line = RecipeLine(ingredientId: harina.id, name: "Harina",
                              qty: 500, unit: "g", cost: perGram)
        XCTAssertEqual(line.lineTotal, 500 * perGram, accuracy: 1e-9)
        // Con el redondeo viejo daba 1.45 en vez de 1.4330.
        XCTAssertLessThan(abs(line.lineTotal - 1.4330), 0.0005,
                          "el costo de la línea se desvió: \(line.lineTotal)")
    }
}
