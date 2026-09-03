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
                /// Opcional: cuánto pesa una pieza, para lo que se compra en cajas.
                let unitWeight: Double?
                let unitWeightUnit: String?
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
        struct CountCase: Decodable {
            struct Input: Decodable {
                let shown: Int
                let total: Int
                let singular: String
                let plural: String
            }
            let `in`: Input
            let out: String?
        }
        struct JoinCase: Decodable {
            let `in`: [String?]
            let out: String?
        }
        struct EscalaCase: Decodable {
            let `in`: IngredientCase.Input
            let amount: Double
            let unit: String
        }
        struct BreakdownCase: Decodable {
            struct Salida: Decodable { let amount: Double; let unit: String }
            let `in`: IngredientCase.Input
            let salidas: [Salida]
        }
        struct FactorCase: Decodable {
            struct Input: Decodable {
                let ing: IngredientCase.Input
                let unit: String
                let qty: Double
            }
            let `in`: Input
            let factor: Double?
            let via: String?
            let lineCost: Double?
            let texto: String?
        }
        struct BasisCase: Decodable {
            let `in`: String
            let amount: Double
            let unit: String
            let etiqueta: String
            let factor: Double
        }
        struct KindCase: Decodable {
            struct Input: Decodable {
                let name: String
                let kind: String?
                let fruta: Bool?
            }
            let `in`: Input
            let kind: String
            let fruta: Bool
        }
        let baseCost: [IngredientCase]
        let displayCost: [DisplayCostCase]
        let displayCostEscala: [EscalaCase]
        let costBreakdown: [BreakdownCase]
        let unitFactor: [FactorCase]
        let macroBasis: [BasisCase]
        struct GastosCase: Decodable {
            struct Entrada: Decodable {
                let id: String; let date: String; let name: String
                let amount: Double; let cantidad: Double?
                let tipo: String; let frecuencia: String?
            }
            struct CantidadCase: Decodable {
                let `in`: Entrada; let cantidad: Double; let montoBase: Double
            }
            struct Desglose: Decodable {
                let operativo: Double; let inversion: Double
                let recurrente: Double; let sueltos: Double; let total: Double
            }
            let hoy: String
            let cantidades: [CantidadCase]
            let mes: Desglose
            let inicio: Desglose
        }
        let kindOf: [KindCase]
        struct PeriodosCase: Decodable {
            struct Caso: Decodable {
                let clave: String; let offset: Int
                let desde: String; let hasta: String
                let etiqueta: String; let movible: Bool
            }
            let hoy: String
            let casos: [Caso]
        }
        let gastos: GastosCase
        let periodos: PeriodosCase
        let countLabel: [CountCase]
        let joinDetail: [JoinCase]
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

    /// Las cabeceras dicen lo mismo en el teléfono y en la laptop.
    ///
    /// No mueve ningún precio, pero es la clase de detalle que hace que la misma
    /// pantalla se sienta como dos apps distintas: "8 guardados" en un sitio y
    /// "8 ingredientes" en el otro.
    func testCountLabelMatchesJavaScript() throws {
        for c in try load().countLabel {
            XCTAssertEqual(
                Labels.count(shown: c.in.shown, total: c.in.total,
                             singular: c.in.singular, plural: c.in.plural),
                c.out,
                "\(c.in.shown)/\(c.in.total): Swift y JavaScript escriben distinto")
        }
    }

    func testDetailJoinMatchesJavaScript() throws {
        for c in try load().joinDetail {
            XCTAssertEqual(Labels.joinAll(c.in), c.out,
                           "\(c.in): la unión de trozos no coincide")
        }
    }

    // MARK: - Lo nuevo: peso por pieza, conversión y categorías

    /// Un ingrediente de prueba a partir de lo que dicen los casos.
    private func hacer(_ i: Fixtures.IngredientCase.Input) -> Ingredient {
        var ing = Ingredient(name: i.name, unit: "paquete",
                             quantity: i.quantity, price: i.price, unitSingle: i.unitSingle)
        if let w = i.unitWeight { ing.unitWeight = w }
        if let u = i.unitWeightUnit { ing.unitWeightUnit = u }
        return ing
    }

    /// Al subir de unidad porque el precio se leería como "$0.00", los dos
    /// lados tienen que elegir la MISMA unidad. Si no, el teléfono diría
    /// "$1.24 por lb" y la laptop "$2.72 por kg" para la misma harina.
    func testCostEscalationMatchesJavaScript() throws {
        for c in try load().displayCostEscala {
            let got = hacer(c.in).displayCost
            XCTAssertEqual(got.unit, c.unit, "«\(c.in.name)»: unidad distinta")
            XCTAssertEqual(got.amount, c.amount, accuracy: 1e-9, "«\(c.in.name)»: importe distinto")
        }
    }

    /// El precio por pieza y por peso, para lo que se compra en cajas.
    func testCostBreakdownMatchesJavaScript() throws {
        for c in try load().costBreakdown {
            let got = hacer(c.in).costBreakdown
            XCTAssertEqual(got.count, c.salidas.count, "«\(c.in.name)»: número de precios distinto")
            for (a, b) in zip(got, c.salidas) {
                XCTAssertEqual(a.unit, b.unit, "«\(c.in.name)»: unidad distinta")
                XCTAssertEqual(a.amount, b.amount, accuracy: 1e-9, "«\(c.in.name)»: importe distinto")
            }
        }
    }

    /// La conversión de una línea de receta. Es lo que decide cuánto cuesta
    /// una receta, así que una diferencia aquí sale directamente en el precio.
    func testUnitConversionMatchesJavaScript() throws {
        for c in try load().unitFactor {
            let ing = hacer(c.in.ing)
            let f = ing.unitFactor(c.in.unit)

            if c.factor == nil {
                XCTAssertNil(f, "«\(c.in.ing.name)» en \(c.in.unit) no se debería poder convertir")
                continue
            }
            let got = try XCTUnwrap(f, "«\(c.in.ing.name)» en \(c.in.unit) debería convertirse")
            XCTAssertEqual(got.factor, c.factor!, accuracy: 1e-9)
            XCTAssertEqual(got.via?.rawValue, c.via)
            if let esperado = c.lineCost {
                XCTAssertEqual(try XCTUnwrap(ing.lineUnitCost(c.in.unit)), esperado, accuracy: 1e-9)
            }
            XCTAssertEqual(ing.conversion(to: c.in.unit, qty: c.in.qty)?.texto, c.texto,
                           "«\(c.in.ing.name)»: el texto de la conversión no coincide")
        }
    }

    /// Sobre qué cantidad se leen los macros: 100 g, o una pieza.
    func testMacroBasisMatchesJavaScript() throws {
        for c in try load().macroBasis {
            let b = MacroBasis.of(c.in)
            XCTAssertEqual(b.amount, c.amount, "\(c.in)")
            XCTAssertEqual(b.unit, c.unit, "\(c.in)")
            XCTAssertEqual(b.label, c.etiqueta, "\(c.in)")
            XCTAssertEqual(b.factor, c.factor, "\(c.in)")
        }
    }

    /// Ingrediente, fruta o empaque. Decide las etiquetas de azúcar y si algo
    /// cuenta para los macros, así que no puede leerse distinto en cada lado.
    func testIngredientKindMatchesJavaScript() throws {
        for c in try load().kindOf {
            var ing = Ingredient(name: c.in.name, unit: "u", quantity: 1, price: 1, unitSingle: "u")
            if let k = c.in.kind { ing.record["kind"] = .string(k) }
            if let f = c.in.fruta { ing.record["fruta"] = .bool(f) }
            XCTAssertEqual(ing.kind.rawValue, c.kind, "«\(c.in.name)»")
            XCTAssertEqual(ing.isFruit, c.fruta, "«\(c.in.name)»: fruta")
        }
    }

    /// Un gasto puede llevar cantidad: dos rollos de papel a $1.25 son $2.50.
    /// Lo anotado antes de que el campo existiera vale uno.
    func testExpenseQuantityMatchesJavaScript() throws {
        for c in try load().gastos.cantidades {
            let g = gasto(c.in)
            XCTAssertEqual(g.cantidad, c.cantidad, accuracy: 1e-9, "«\(c.in.name)»: cantidad")
            XCTAssertEqual(g.montoBase, c.montoBase, accuracy: 1e-9, "«\(c.in.name)»: monto")
        }
    }

    /// El reparto de un período y el acumulado desde que empezó el negocio.
    /// "Hoy" se fija: si no, el fixture cambiaría de un día para otro.
    func testExpenseBreakdownMatchesJavaScript() throws {
        let f = try load().gastos
        let gastos = f.cantidades.map { gasto($0.in) }
        let hoy = try XCTUnwrap(Investment.parse(f.hoy))
        Investment.withNow(hoy) {
            let desde = Investment.parse("2026-03-01")!
            let hasta = Investment.parse("2999-12-31")!
            comprobar(Investment.breakdown(gastos, from: desde, to: hasta), f.mes, "mes")
            comprobar(Investment.sinceTheStart(gastos), f.inicio, "desde el inicio")
        }
    }

    /// Los períodos: de qué fechas se habla y cómo se llama eso.
    ///
    /// Es la cuenta que decide qué ventas y qué gastos se ven. Si Swift y
    /// JavaScript no la hacen igual, el teléfono y la laptop enseñarían meses
    /// distintos con los mismos datos y nadie lo notaría hasta cuadrar caja.
    func testPeriodSpansMatchJavaScript() throws {
        let f = try load().periodos
        let hoy = try XCTUnwrap(DayString.date(from: f.hoy))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let dia: (Date) -> String = { d in
            let c = cal.dateComponents([.year, .month, .day], from: d)
            return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }
        for c in f.casos {
            let p = try XCTUnwrap(Period(rawValue: c.clave), "período «\(c.clave)»")
            let s = p.span(now: hoy, offset: c.offset)
            let que = "\(c.clave) \(c.offset)"
            XCTAssertEqual(dia(s.range.lowerBound), c.desde, "\(que): desde")
            XCTAssertEqual(dia(s.range.upperBound), c.hasta, "\(que): hasta")
            XCTAssertEqual(s.label, c.etiqueta, "\(que): etiqueta")
            XCTAssertEqual(p.movible, c.movible, "\(que): movible")
        }
    }

    private func gasto(_ e: Fixtures.GastosCase.Entrada) -> Expense {
        var g = Expense(record: Record(["id": .string(e.id)]))
        g.date = e.date
        g.name = e.name
        g.amount = e.amount
        if let c = e.cantidad { g.cantidad = c }
        g.record["tipo"] = .string(e.tipo)
        if let f = e.frecuencia { g.record["frecuencia"] = .string(f) }
        return g
    }

    private func comprobar(_ salio: ExpenseBreakdown,
                           _ esperado: Fixtures.GastosCase.Desglose,
                           _ que: String) {
        XCTAssertEqual(salio.investment, esperado.inversion, accuracy: 0.005, "\(que): inversión")
        XCTAssertEqual(salio.recurring,  esperado.recurrente, accuracy: 0.005, "\(que): recurrente")
        XCTAssertEqual(salio.oneOff,     esperado.sueltos,    accuracy: 0.005, "\(que): sueltos")
        XCTAssertEqual(salio.operating,  esperado.operativo,  accuracy: 0.005, "\(que): operativo")
        XCTAssertEqual(salio.total,      esperado.total,      accuracy: 0.005, "\(que): total")
    }
}
