import Foundation

/// Unidades de medida. Cada una guarda a cuánto equivale en la unidad base de
/// su familia (masa → gramos, volumen → mililitros, conteo → unidades).
/// Copia exacta de la tabla `UNITS` de app.js.
public struct MeasureUnit: Hashable, Sendable {
    public let key: String
    public let factor: Double
    public let family: Family
    /// A qué sistema de medida pertenece. Al subir de unidad porque el precio
    /// se leería como "$0.00", se busca dentro del mismo: quien compra en
    /// gramos quiere ver kilos, no onzas.
    public var system: System { Units.systemOf(key) }
    public let name: String
    public let short: String

    public enum Family: String, Sendable, CaseIterable {
        case masa, volumen, conteo
    }

    public enum System: Sendable {
        case metrico, imperial, casero, conteo
    }
}

public enum Units {
    public static let all: [MeasureUnit] = [
        MeasureUnit(key: "g",      factor: 1,       family: .masa,    name: "gramos (g)",     short: "g"),
        MeasureUnit(key: "kg",     factor: 1000,    family: .masa,    name: "kilos (kg)",     short: "kg"),
        MeasureUnit(key: "lb",     factor: 453.592, family: .masa,    name: "libras (lb)",    short: "lb"),
        MeasureUnit(key: "oz",     factor: 28.3495, family: .masa,    name: "onzas (oz)",     short: "oz"),
        MeasureUnit(key: "ml",     factor: 1,       family: .volumen, name: "mililitros (ml)", short: "ml"),
        MeasureUnit(key: "l",      factor: 1000,    family: .volumen, name: "litros (L)",     short: "L"),
        MeasureUnit(key: "taza",   factor: 240,     family: .volumen, name: "tazas",          short: "taza"),
        MeasureUnit(key: "cda",    factor: 15,      family: .volumen, name: "cucharadas",     short: "cda"),
        MeasureUnit(key: "cdta",   factor: 5,       family: .volumen, name: "cucharaditas",   short: "cdta"),
        MeasureUnit(key: "u",      factor: 1,       family: .conteo,  name: "unidades",       short: "u"),
        MeasureUnit(key: "docena", factor: 12,      family: .conteo,  name: "docenas",        short: "docena")
    ]

    private static let byKey: [String: MeasureUnit] = Dictionary(uniqueKeysWithValues: all.map { ($0.key, $0) })

    public static func info(_ key: String) -> MeasureUnit { byKey[key] ?? byKey["u"]! }
    public static func family(_ key: String) -> MeasureUnit.Family { info(key).family }

    static func systemOf(_ key: String) -> MeasureUnit.System {
        switch key {
        case "g", "kg", "ml", "l":       return .metrico
        case "lb", "oz":                 return .imperial
        case "taza", "cda", "cdta":      return .casero
        default:                         return .conteo
        }
    }

    /// La unidad de referencia de una familia: el gramo, el mililitro, la unidad.
    public static func base(_ family: MeasureUnit.Family) -> MeasureUnit {
        all.first { $0.family == family && $0.factor == 1 } ?? info("u")
    }
    public static func inFamily(_ family: MeasureUnit.Family) -> [MeasureUnit] { all.filter { $0.family == family } }
}

/// Cantidades escritas a mano.
///
/// Acepta lo mismo que la web: "1/2", "1 1/2", "½", "2.5", "2,5", "media taza",
/// "un cuarto", "dos tercios". La repostería se escribe en fracciones, así que
/// esto no es un adorno: es como ella escribe de verdad.
public enum Quantity {

    static let fractionChars: [Character: Double] = [
        "½": 0.5, "⅓": 1.0/3, "⅔": 2.0/3, "¼": 0.25, "¾": 0.75,
        "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
        "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1.0/6, "⅚": 5.0/6
    ]

    static let words: [String: Double] = [
        "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
        "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12,
        "medio": 0.5, "media": 0.5, "mitad": 0.5, "cuarto": 0.25, "cuarta": 0.25,
        "tercio": 1.0/3, "tercia": 1.0/3, "octavo": 0.125, "docena": 12
    ]

    /// Convierte texto en número. Devuelve 0 si no se entiende nada.
    public static func parse(_ raw: String) -> Double {
        var text = raw.lowercased().trimmingCharacters(in: .whitespaces)
        if text.isEmpty { return 0 }
        text = text.replacingOccurrences(of: ",", with: ".")

        // 1. Símbolos de fracción: "1 ½", "½"
        for (ch, value) in fractionChars where text.contains(ch) {
            let before = String(text[text.startIndex..<text.firstIndex(of: ch)!])
                .trimmingCharacters(in: .whitespaces)
            return (Double(before) ?? 0) + value
        }

        // 2. Mixtas y fracciones escritas: "1 1/2", "3/4"
        if let m = firstMatch(#"^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)"#, text),
           m.count == 4, let whole = Double(m[1]), let num = Double(m[2]), let den = Double(m[3]) {
            return whole + num / (den == 0 ? 1 : den)
        }
        if let m = firstMatch(#"^(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)"#, text),
           m.count == 3, let num = Double(m[1]), let den = Double(m[2]) {
            return num / (den == 0 ? 1 : den)
        }

        // 3. Número normal al principio: "2.5 tazas"
        if let m = firstMatch(#"^-?\d+(?:\.\d+)?"#, text), let n = Double(m[0]) { return n }

        // 4. Palabras: "media", "un cuarto", "dos tercios"
        var total = 0.0
        var pending: Double? = nil
        let parts = text.split(whereSeparator: { $0 == " " || $0 == "\t" })
            .map(String.init)
            .filter { $0 != "y" && !$0.isEmpty }
        for part in parts {
            let singular = part.hasSuffix("s") ? String(part.dropLast()) : part
            guard let value = words[singular] ?? words[part] else { continue }
            if value >= 1 {
                if pending == nil { pending = value } else { total += pending! * value; pending = nil }
            } else {
                total += (pending ?? 1) * value
                pending = nil
            }
        }
        if let p = pending { total += p }
        return total
    }

    /// Número bonito: 0.5 → "½", 1.25 → "1 ¼", 2 → "2".
    public static func pretty(_ n: Double) -> String {
        guard n.isFinite, n != 0 else { return "0" }
        let whole = floor(n)
        let rest = (n - whole).rounded(toPlaces: 3)
        let map: [Double: String] = [0.5: "½", 0.25: "¼", 0.75: "¾", 0.333: "⅓", 0.667: "⅔", 0.125: "⅛"]
        guard let frac = map[rest] else {
            let rounded = n.rounded(toPlaces: 2)
            return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        }
        return (whole > 0 ? String(Int(whole)) + " " : "") + frac
    }

    private static func firstMatch(_ pattern: String, _ text: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }
        return (0..<m.numberOfRanges).map { i in
            guard let r = Range(m.range(at: i), in: text) else { return "" }
            return String(text[r])
        }
    }
}

public extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let d = pow(10.0, Double(places))
        return (self * d).rounded() / d
    }
}

/// Formato de dinero idéntico al de la web (`Intl.NumberFormat` en-US, USD).
public enum Money {
    private static let formatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    public static func format(_ value: Double) -> String {
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "$0.00"
    }
}
