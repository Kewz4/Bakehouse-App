import Foundation

// Vistas con tipos sobre los registros crudos.
//
// Cada una guarda el `Record` original y escribe encima de él, así los campos
// que esta versión de la app no conozca sobreviven intactos al guardar.

/// `id` se declara aquí y no sólo en la extensión: si únicamente lo aportara
/// la extensión, Swift no sabría si el `ID` de `Identifiable` es `String` o el
/// `ObjectIdentifier` que ofrece por defecto, y la conformidad no compila.
public protocol RecordBacked: Identifiable {
    var record: Record { get set }
    init(record: Record)
    var id: String { get }
}

public extension RecordBacked {
    var id: String { record.id }
    var updatedAt: Double { record.updatedAt }
    var isDeleted: Bool { record.deleted }
    mutating func touch(now: Date = Date()) { record.touch(now: now) }
}

// MARK: - Ingrediente

public struct Ingredient: RecordBacked, Hashable, Sendable {
    public var record: Record
    public init(record: Record) { self.record = record }

    public init(id: String = UUID().uuidString, name: String, unit: String,
                quantity: Double, price: Double, unitSingle: String) {
        record = Record(["id": .string(id)])
        self.name = name; self.unit = unit; self.quantity = quantity
        self.price = price; self.unitSingle = unitSingle
        record.touch()
    }

    /// Cómo la compra: "bolsa", "caja", "botella".
    public var unit: String {
        get { record.string("unit") } set { record["unit"] = .string(newValue) }
    }
    public var name: String {
        get { record.string("name") } set { record["name"] = .string(newValue) }
    }
    /// Cuánto trae el empaque, en `unitSingle`.
    public var quantity: Double {
        get { record.double("quantity") } set { record["quantity"] = .number(newValue) }
    }
    public var price: Double {
        get { record.double("price") } set { record["price"] = .number(newValue) }
    }
    /// En qué se mide: g, ml, u…
    public var unitSingle: String {
        get { let v = record.string("unitSingle"); return v.isEmpty ? "g" : v }
        set { record["unitSingle"] = .string(newValue) }
    }

    /// Costo por unidad base (por gramo, por ml o por unidad).
    public var baseCost: Double {
        let q = quantity * Units.info(unitSingle).factor
        return price / (q == 0 ? 1 : q)
    }

    /// Cuánto pesa (o cuánto mide) UNA pieza. Opcional.
    ///
    /// Una caja de 24 barras de mantequilla son 24 unidades, y además cada
    /// barra pesa 113 g. Con ese dato salen dos cosas: el precio por barra Y
    /// por gramo, y una receta puede pedir 200 g de mantequilla aunque la
    /// compra se haga por piezas.
    public var unitWeight: Double {
        get { record["unitWeight"]?.doubleValue ?? 0 }
        set { record["unitWeight"] = newValue > 0 ? .number(newValue) : .null }
    }

    public var unitWeightUnit: String {
        get { record["unitWeightUnit"]?.stringValue ?? "g" }
        set { record["unitWeightUnit"] = .string(newValue) }
    }

    /// El peso de una pieza, ya en unidades base, o nil si no se sabe.
    public var pieceWeight: (amount: Double, unit: String, base: Double, family: MeasureUnit.Family)? {
        guard unitWeight > 0 else { return nil }
        let u = Units.info(unitWeightUnit)
        // "cada unidad pesa 3 unidades" no dice nada; hace falta peso o volumen.
        guard u.family != .conteo else { return nil }
        return (unitWeight, unitWeightUnit, unitWeight * u.factor, u.family)
    }

    /// Qué clase de cosa es. El empaque cuesta pero no se come.
    public var kind: IngredientKind { IngredientKind.of(self) }

    /// A cuánto sale, en una unidad que se pueda leer.
    ///
    /// Manda la unidad que ELLA eligió: si compra la harina en kilos, la quiere
    /// ver en kilos. Sólo se cambia cuando su unidad daría "$0.00" —una harina
    /// de $1.25 la bolsa de 459 g sale a $0.0027 el gramo, y a dos decimales eso
    /// es cero—, y aun entonces se busca dentro de su mismo sistema de medida:
    /// quien compra en gramos quiere kilos, no onzas.
    /// Réplica de displayCost() en business-core.js.
    public var displayCost: (amount: Double, unit: String) {
        Units.readableCost(baseCost, family: Units.family(unitSingle), preferred: unitSingle)
    }

    /// Las dos caras del precio: por pieza y por peso, cuando se sabe cuánto
    /// pesa una. Una caja de 7 barras a $7 son $1 la barra y $8.85 el kilo.
    public var costBreakdown: [(amount: Double, unit: String)] {
        var out = [displayCost]
        guard let w = pieceWeight else { return out }
        let own = Units.family(unitSingle)
        if own == .conteo {
            out.append(Units.readableCost(baseCost / w.base, family: w.family, preferred: w.unit))
        } else if own == w.family {
            out.append((baseCost * w.base, "unidad"))
        }
        return out
    }

    /// Cuántas unidades base valen UNA de `lineUnit`, y si hubo que dar rodeo.
    ///
    /// Es lo que convierte "dos cucharadas" en un costo cuando la leche se
    /// compró por litros, y "200 g" en un costo cuando la mantequilla se compró
    /// por barras. `nil` cuando la conversión no se puede hacer sin inventarse
    /// un dato: de mililitros a gramos hace falta la densidad.
    public func unitFactor(_ lineUnit: String) -> (factor: Double, via: ConversionVia?)? {
        let own = Units.family(unitSingle)
        let li = Units.info(lineUnit)
        if li.family == own {
            return (li.factor, lineUnit == unitSingle ? nil : .sameFamily)
        }
        guard let w = pieceWeight else { return nil }
        if own == .conteo && li.family == w.family { return (li.factor / w.base, .piece) }
        if li.family == .conteo && own == w.family { return (li.factor * w.base, .piece) }
        return nil
    }

    /// Lo que cuesta una unidad de `lineUnit` de este ingrediente.
    public func lineUnitCost(_ lineUnit: String) -> Double? {
        unitFactor(lineUnit).map { baseCost * $0.factor }
    }

    /// Qué se convirtió, en palabras. `nil` si no hubo conversión ninguna.
    public func conversion(to lineUnit: String, qty: Double) -> Conversion? {
        guard let f = unitFactor(lineUnit), let via = f.via else { return nil }
        let own = Units.info(unitSingle)
        // El factor lleva a unidades BASE, así que la equivalencia se dice en
        // la unidad base de la familia: "30 ml", no "30 L".
        let base = Units.base(Units.family(unitSingle))
        let equivale = (qty * f.factor * 1000).rounded() / 1000
        let izq = "\(Quantity.pretty(qty)) \(Units.info(lineUnit).short)"
        let der = "\(Quantity.pretty(equivale)) \(base.short)"
        // "80 g = 80 g" es verdad y no sirve de nada. Pasa cuando la receta ya
        // pide la unidad base de la familia: la conversión existe —la harina se
        // compró en libras— pero la frase no la enseña, y un aviso que no dice
        // nada acaba enseñando a ignorar los avisos que sí dicen algo.
        if izq == der { return nil }
        let texto = "\(izq) = \(der)"
        let detalle: String
        if via == .piece, let w = pieceWeight {
            detalle = "Compras \(name) por \(own.name), y cada una pesa "
                + "\(Quantity.pretty(w.amount)) \(Units.info(w.unit).short). Con eso la cuenta sale sola."
        } else {
            detalle = "Compras \(name) por \(own.name). Son la misma medida, así que la equivalencia es exacta."
        }
        return Conversion(via: via, texto: texto, detalle: detalle)
    }

    /// ¿A este ingrediente le falta la información nutricional?
    ///
    /// El empaque no cuenta: una caja no se come, así que pedirle calorías
    /// sería pedir un dato que no existe, y marcarla enseñaría a ignorar la
    /// marca.
    public var needsNutrition: Bool { kind != .empaque && !hasMacros }

    /// Por debajo de esto el número se ve como "$0.00".
    public static let costReadable: Double = 0.01
    /// Al subir de unidad, se busca al menos esto.
    public static let costMinimum: Double = 0.10

    @available(*, deprecated, message: "Usa displayCost: daba $0.00 para ingredientes que se miden en gramos")
    public var displayUnitCost: Double { baseCost * Units.info(unitSingle).factor }
}

// MARK: - Receta

public struct RecipeLine: Hashable, Sendable {
    public var ingredientId: String?
    public var name: String
    public var qty: Double
    public var unit: String
    /// Costo por unidad elegida, ya convertido.
    public var cost: Double

    public init(ingredientId: String? = nil, name: String, qty: Double, unit: String, cost: Double) {
        self.ingredientId = ingredientId; self.name = name
        self.qty = qty; self.unit = unit; self.cost = cost
    }

    init?(json: JSONValue) {
        guard let o = json.objectValue else { return nil }
        ingredientId = o["ingredientId"]?.stringValue
        name = o["name"]?.stringValue ?? ""
        qty = o["qty"]?.doubleValue ?? 0
        unit = o["unit"]?.stringValue ?? "u"
        cost = o["cost"]?.doubleValue ?? 0
    }

    var json: JSONValue {
        var o: [String: JSONValue] = [
            "name": .string(name), "qty": .number(qty),
            "unit": .string(unit), "cost": .number(cost)
        ]
        if let id = ingredientId, !id.isEmpty { o["ingredientId"] = .string(id) }
        return .object(o)
    }

    public var lineTotal: Double { qty * cost }
}

public struct Recipe: RecordBacked, Hashable, Sendable {
    public var record: Record
    public init(record: Record) { self.record = record }

    public init(id: String = UUID().uuidString, name: String, yield: Double,
                price: Double, lines: [RecipeLine], photo: String = "") {
        record = Record(["id": .string(id)])
        self.name = name; self.yield = yield; self.price = price
        self.lines = lines; self.photo = photo
        record.touch()
    }

    public var name: String {
        get { record.string("name") } set { record["name"] = .string(newValue) }
    }
    /// Cuántas porciones rinde.
    public var yield: Double {
        get { let y = record.double("yield"); return y > 0 ? y : 1 }
        set { record["yield"] = .number(newValue) }
    }
    /// Precio de venta por porción. 0 = todavía sin precio.
    public var price: Double {
        get { record.double("price") } set { record["price"] = .number(newValue) }
    }
    public var photo: String {
        get { record.string("photo") } set { record["photo"] = .string(newValue) }
    }
    public var lines: [RecipeLine] {
        get { (record["ingredients"]?.arrayValue ?? []).compactMap(RecipeLine.init(json:)) }
        set { record["ingredients"] = .array(newValue.map(\.json)) }
    }

    /// Lo que cuesta hacer la receta entera.
    public var totalCost: Double { lines.reduce(0) { $0 + $1.lineTotal } }
    /// Lo que cuesta una porción.
    public var unitCost: Double { totalCost / (yield == 0 ? 1 : yield) }
    /// Qué porcentaje del precio es ganancia.
    public var margin: Double { price > 0 ? (price - unitCost) / price * 100 : 0 }
    public var hasPrice: Bool { price > 0 }
    public var losesMoney: Bool { hasPrice && price < unitCost }

    /// Precio al que habría que vender para dejar `target`% de margen.
    public func suggestedPrice(target: Double = 65) -> Double {
        unitCost / (1 - target / 100)
    }
}

// MARK: - Venta

public struct Sale: RecordBacked, Hashable, Sendable {
    public var record: Record
    public init(record: Record) { self.record = record }

    public init(id: String = UUID().uuidString, date: String, product: String,
                qty: Double, total: Double, recipeId: String = "") {
        record = Record(["id": .string(id)])
        self.date = date; self.product = product
        self.qty = qty; self.total = total; self.recipeId = recipeId
        record.touch()
    }

    /// Formato "YYYY-MM-DD", igual que la web.
    public var date: String {
        get { record.string("date") } set { record["date"] = .string(newValue) }
    }
    public var product: String {
        get { record.string("product") } set { record["product"] = .string(newValue) }
    }
    public var qty: Double {
        get { record.double("qty") } set { record["qty"] = .number(newValue) }
    }
    public var total: Double {
        get { record.double("total") } set { record["total"] = .number(newValue) }
    }
    public var recipeId: String {
        get { record.string("recipeId") } set { record["recipeId"] = .string(newValue) }
    }
}

// MARK: - Gasto

public struct Expense: RecordBacked, Hashable, Sendable {
    public static let categories = [
        "Servicios", "Transporte", "Empaque", "Ingredientes",
        "Marketing", "Mano de obra", "Otro"
    ]

    public var record: Record
    public init(record: Record) { self.record = record }

    public init(id: String = UUID().uuidString, date: String, name: String,
                category: String, amount: Double) {
        record = Record(["id": .string(id)])
        self.date = date; self.name = name
        self.category = category; self.amount = amount
        record.touch()
    }

    public var date: String {
        get { record.string("date") } set { record["date"] = .string(newValue) }
    }
    public var name: String {
        get { record.string("name") } set { record["name"] = .string(newValue) }
    }
    public var category: String {
        get { let c = record.string("category"); return c.isEmpty ? "Otro" : c }
        set { record["category"] = .string(newValue) }
    }
    public var amount: Double {
        get { record.double("amount") } set { record["amount"] = .number(newValue) }
    }

    /// Cuántos se compraron. Un rollo de papel pergamino vale $1.25 y ella
    /// compra dos: el gasto son $2.50, pero el precio anotado sigue siendo
    /// $1.25. Lo anotado antes de que existiera este campo vale uno, así que
    /// los números de siempre siguen dando lo mismo.
    public var cantidad: Double {
        get {
            guard record["cantidad"] != nil else { return 1 }
            let n = record.double("cantidad")
            return n > 0 ? n : 1
        }
        set { record["cantidad"] = .number(newValue) }
    }

    /// Lo que costó de verdad: el precio de uno por cuántos se llevaron.
    public var montoBase: Double { amount * cantidad }
}

// MARK: - Fechas

public enum DayString {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        return f
    }()

    public static func today(_ date: Date = Date()) -> String { formatter.string(from: date) }

    /// Interpreta "2026-08-21" al mediodía local, igual que la web, para que un
    /// cambio de huso horario no mueva una venta de día.
    public static func date(from day: String) -> Date? {
        guard let d = formatter.date(from: String(day.prefix(10))) else { return nil }
        return Calendar.current.date(byAdding: .hour, value: 12, to: d) ?? d
    }

    /// "21/08/26", igual que `fmtDate` en la web.
    public static func short(_ day: String) -> String {
        let parts = String(day.prefix(10)).split(separator: "-")
        guard parts.count == 3 else { return day.isEmpty ? "—" : day }
        return "\(parts[2])/\(parts[1])/\(parts[0].suffix(2))"
    }
}
