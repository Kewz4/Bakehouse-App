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

    /// A cuánto sale una unidad de compra: "$0.29 / lb".
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
