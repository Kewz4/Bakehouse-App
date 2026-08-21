import Foundation

/// Un valor JSON cualquiera.
///
/// Los registros se guardan como diccionarios de `JSONValue` en vez de structs
/// con campos fijos, y es a propósito: si la app de iPhone decodificara a un
/// struct, cualquier campo que la web añada en el futuro y que iOS no conozca
/// se perdería al volver a codificar. Y como al combinar gana la versión más
/// reciente, ese campo desaparecería para todos, no sólo en el teléfono.
///
/// Guardando el JSON tal cual, la app de iPhone puede leer y escribir lo que
/// entiende y devolver intacto lo que no.
public enum JSONValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

// MARK: - Codable

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Double.self) { self = .number(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? c.decode([String: JSONValue].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "JSON no reconocido")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v):
            // Los enteros se escriben sin `.0` para que el JSON se vea igual
            // que el que produce el navegador.
            if v.rounded() == v && abs(v) < 9_007_199_254_740_992 {
                try c.encode(Int64(v))
            } else {
                try c.encode(v)
            }
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

// MARK: - Lectura cómoda

public extension JSONValue {
    var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return JSONValue.formatNumber(n)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    /// Acepta número o texto: la web guarda a veces `""` y a veces `0`.
    var doubleValue: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s):
            let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            return t.isEmpty ? nil : Double(t)
        case .bool(let b): return b ? 1 : 0
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    static func formatNumber(_ n: Double) -> String {
        if n.rounded() == n && abs(n) < 9_007_199_254_740_992 { return String(Int64(n)) }
        return String(n)
    }
}

// MARK: - Escritura cómoda

extension JSONValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
}
extension JSONValue: ExpressibleByFloatLiteral {
    public init(floatLiteral value: Double) { self = .number(value) }
}
extension JSONValue: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
}
extension JSONValue: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}

// MARK: - Forma canónica

public extension JSONValue {
    /// Misma representación estable que `canonical()` en sync-core.js: claves
    /// ordenadas y sin espacios. Se usa para desempatar cuando dos versiones
    /// del mismo registro tienen exactamente la misma hora.
    var canonical: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return JSONValue.formatNumber(n)
        case .string(let s): return JSONValue.quote(s)
        case .array(let a): return "[" + a.map(\.canonical).joined(separator: ",") + "]"
        case .object(let o):
            let parts = o.keys.sorted().map { JSONValue.quote($0) + ":" + o[$0]!.canonical }
            return "{" + parts.joined(separator: ",") + "}"
        }
    }

    /// Escapa igual que `JSON.stringify` de JavaScript.
    static func quote(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if ch.value < 0x20 {
                    out += String(format: "\\u%04x", ch.value)
                } else {
                    out.unicodeScalars.append(ch)
                }
            }
        }
        return out + "\""
    }
}
