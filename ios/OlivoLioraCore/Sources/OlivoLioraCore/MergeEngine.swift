import Foundation

/// Un registro: un ingrediente, una receta, una venta o un gasto.
///
/// Por dentro es el JSON tal cual llegó, para no perder campos que esta versión
/// de la app todavía no conozca (ver JSONValue.swift).
public struct Record: Hashable, Sendable {
    public var fields: [String: JSONValue]

    public init(_ fields: [String: JSONValue]) { self.fields = fields }

    public var id: String {
        get { fields["id"]?.stringValue ?? "" }
        set { fields["id"] = .string(newValue) }
    }

    /// Milisegundos desde 1970, igual que `Date.now()` en JavaScript.
    public var updatedAt: Double {
        get { fields["updatedAt"]?.doubleValue ?? 1 }
        set { fields["updatedAt"] = .number(newValue.rounded(.down)) }
    }

    public var deleted: Bool {
        get { fields["deleted"]?.boolValue ?? false }
        set { fields["deleted"] = .bool(newValue) }
    }

    public subscript(key: String) -> JSONValue? {
        get { fields[key] }
        set { fields[key] = newValue }
    }

    public func string(_ key: String) -> String { fields[key]?.stringValue ?? "" }
    public func double(_ key: String) -> Double { fields[key]?.doubleValue ?? 0 }

    public var canonical: String { JSONValue.object(fields).canonical }

    /// Marca el registro como modificado ahora. De esto depende que gane la
    /// versión más reciente al combinar.
    public mutating func touch(now: Date = Date()) {
        updatedAt = now.timeIntervalSince1970 * 1000
        deleted = false
    }
}

/// Las cuatro listas que forman los datos del negocio.
public enum Collection: String, CaseIterable, Sendable {
    case ingredients, recipes, sales, expenses
}

/// El documento completo que viaja entre el teléfono, la laptop y el servidor.
public struct SyncDocument: Hashable, Sendable {
    public var ingredients: [Record] = []
    public var recipes: [Record] = []
    public var sales: [Record] = []
    public var expenses: [Record] = []
    public var updatedAt: Double = 0

    public init() {}

    public subscript(c: Collection) -> [Record] {
        get {
            switch c {
            case .ingredients: return ingredients
            case .recipes: return recipes
            case .sales: return sales
            case .expenses: return expenses
            }
        }
        set {
            switch c {
            case .ingredients: ingredients = newValue
            case .recipes: recipes = newValue
            case .sales: sales = newValue
            case .expenses: expenses = newValue
            }
        }
    }

    /// Los registros que la usuaria ve: sin lápidas.
    public func live(_ c: Collection) -> [Record] { self[c].filter { !$0.deleted } }

    public var isEmpty: Bool {
        Collection.allCases.allSatisfy { self[$0].isEmpty }
    }

    public var recordCount: Int {
        Collection.allCases.reduce(0) { $0 + self[$1].count }
    }

    /// Misma cadena que produce `SyncCore.canonical(doc)` en JavaScript.
    /// La prueba de conformidad la compara carácter por carácter contra la que
    /// genera el motor web: si los dos motores dejan de coincidir, falla.
    public var canonical: String {
        var o: [String: JSONValue] = [
            "v": .number(Double(MergeEngine.documentVersion)),
            "updatedAt": .number(updatedAt)
        ]
        for c in Collection.allCases {
            o[c.rawValue] = .array(self[c].map { JSONValue.object($0.fields) })
        }
        return JSONValue.object(o).canonical
    }
}

/// Traducción exacta de sync-core.js.
///
/// Si cambias una regla aquí, cámbiala también allá: los dos lados tienen que
/// combinar igual o el teléfono y la laptop pueden quedar en desacuerdo.
public enum MergeEngine {

    public static let documentVersion = 2
    /// Las lápidas se guardan 120 días, igual que en el servidor.
    public static let tombstoneTTL: Double = 120 * 24 * 60 * 60 * 1000

    public static func now(_ date: Date = Date()) -> Double {
        (date.timeIntervalSince1970 * 1000).rounded(.down)
    }

    /// Deja un registro en forma canónica. Los registros creados antes de que
    /// existiera la sincronización no traen `updatedAt`; se les pone 1 para que
    /// cualquier edición posterior les gane.
    public static func normalize(_ raw: [String: JSONValue]) -> Record? {
        var rec = Record(raw)
        if rec.fields["id"]?.stringValue?.isEmpty ?? true { return nil }
        rec.id = rec.string("id")
        let t = raw["updatedAt"]?.doubleValue ?? 0
        rec.updatedAt = (t.isFinite && t > 0) ? t.rounded(.down) : 1
        rec.deleted = raw["deleted"]?.boolValue == true
        return rec
    }

    /// Elige entre dos versiones del MISMO registro.
    /// 1. Gana `updatedAt` mayor.
    /// 2. Si empatan, gana el JSON canónico mayor: no es "más correcto", pero
    ///    es determinista, y por eso los dispositivos convergen.
    public static func pickWinner(_ a: Record, _ b: Record) -> Record {
        if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt ? a : b }
        return a.canonical >= b.canonical ? a : b
    }

    /// Ordena por id para que dos dispositivos con los mismos datos produzcan
    /// exactamente los mismos bytes. El orden que ve la usuaria lo decide la
    /// interfaz, no esto.
    static func sortById(_ list: [Record]) -> [Record] {
        list.sorted { $0.id < $1.id }
    }

    static func dedupe(_ list: [Record]) -> [Record] {
        var byId: [String: Record] = [:]
        for rec in list {
            byId[rec.id] = byId[rec.id].map { pickWinner($0, rec) } ?? rec
        }
        return sortById(Array(byId.values))
    }

    public static func normalize(document raw: SyncDocument) -> SyncDocument {
        var out = SyncDocument()
        for c in Collection.allCases { out[c] = dedupe(raw[c]) }
        out.updatedAt = raw.updatedAt > 0 ? raw.updatedAt.rounded(.down) : 0
        return out
    }

    /// Combina dos documentos. Conmutativa, asociativa e idempotente.
    public static func merge(_ local: SyncDocument, _ remote: SyncDocument) -> SyncDocument {
        var out = SyncDocument()
        for c in Collection.allCases {
            var byId: [String: Record] = [:]
            for rec in local[c] { byId[rec.id] = byId[rec.id].map { pickWinner($0, rec) } ?? rec }
            for rec in remote[c] { byId[rec.id] = byId[rec.id].map { pickWinner($0, rec) } ?? rec }
            out[c] = sortById(Array(byId.values))
        }
        out.updatedAt = max(local.updatedAt, remote.updatedAt)
        return out
    }

    /// Quita lápidas antiguas para que el documento no crezca sin límite.
    public static func purgeTombstones(_ doc: inout SyncDocument, now: Double = MergeEngine.now()) {
        let cutoff = now - tombstoneTTL
        for c in Collection.allCases {
            doc[c] = doc[c].filter { !($0.deleted && $0.updatedAt < cutoff) }
        }
    }

    /// Convierte un registro en lápida, conservando su id. Sin esto, un borrado
    /// en el teléfono reaparecería en la siguiente sincronización de la laptop.
    public static func tombstone(id: String, now: Double = MergeEngine.now()) -> Record {
        Record(["id": .string(id), "deleted": .bool(true), "updatedAt": .number(now)])
    }

    /// ¿`haystack` ya contiene todo lo que hay en `needle`?
    /// Sirve para confirmar que el servidor recibió lo nuestro antes de dar la
    /// sincronización por buena.
    public static func contains(_ haystack: SyncDocument, _ needle: SyncDocument) -> Bool {
        for c in Collection.allCases {
            var index: [String: Record] = [:]
            for rec in haystack[c] { index[rec.id] = rec }
            for mine in needle[c] {
                guard let theirs = index[mine.id] else { return false }
                if theirs.updatedAt < mine.updatedAt { return false }
            }
        }
        return true
    }
}

// MARK: - JSON

extension SyncDocument: Codable {
    enum CodingKeys: String, CodingKey {
        case v, ingredients, recipes, sales, expenses, updatedAt
    }

    public init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        for col in Collection.allCases {
            let key = CodingKeys(stringValue: col.rawValue)!
            let raw = (try? c.decode([JSONValue].self, forKey: key)) ?? []
            self[col] = raw.compactMap { $0.objectValue.flatMap(MergeEngine.normalize) }
        }
        updatedAt = (try? c.decode(Double.self, forKey: .updatedAt)) ?? 0
        self = MergeEngine.normalize(document: self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(MergeEngine.documentVersion, forKey: .v)
        for col in Collection.allCases {
            let key = CodingKeys(stringValue: col.rawValue)!
            try c.encode(self[col].map { JSONValue.object($0.fields) }, forKey: key)
        }
        try c.encode(Int64(updatedAt), forKey: .updatedAt)
    }
}
