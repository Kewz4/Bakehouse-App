import Foundation

// MARK: - Qué clase de cosa es

/// Ingrediente, fruta/verdura o empaque.
///
/// El empaque no se come pero cuesta dinero, y es un gasto tan recurrente como
/// la harina: va en la misma lista, con su propia categoría. Eso tiene una
/// consecuencia que hay que tratar aparte — una caja no tiene macros, y sin
/// esto una receta con caja no conseguiría NUNCA una etiqueta de dieta, porque
/// le faltaría "un ingrediente por cubrir".
public enum IngredientKind: String, CaseIterable, Sendable {
    case ingrediente, fruta, empaque

    public var label: String {
        switch self {
        case .ingrediente: return "Ingrediente"
        case .fruta:       return "Fruta y verdura"
        case .empaque:     return "Empaque"
        }
    }

    public var emoji: String {
        switch self {
        case .ingrediente: return "🥣"
        case .fruta:       return "🍎"
        case .empaque:     return "📦"
        }
    }

    /// El empaque cuesta, pero no alimenta: no cuenta para los macros.
    public var feeds: Bool { self != .empaque }

    /// Réplica de kindOf() en business-core.js.
    static func of(_ ing: Ingredient) -> IngredientKind {
        if let raw = ing.record["kind"]?.stringValue, let k = IngredientKind(rawValue: raw) { return k }
        // Antes esto era un interruptor de sí/no para la fruta. Lo que ella
        // marcó entonces sigue mandando sobre la detección por nombre.
        if let flag = ing.record["fruta"]?.boolValue { return flag ? .fruta : .ingrediente }
        return Badges.nameLooksLikeFruit(ing.name) ? .fruta : .ingrediente
    }
}

// MARK: - Conversión entre unidades

public enum ConversionVia: String, Sendable {
    /// La misma familia: mililitros y cucharadas. La equivalencia es exacta.
    case sameFamily = "misma-familia"
    /// A través de cuánto pesa una pieza: barras de mantequilla y gramos.
    case piece = "pieza"
}

/// Para cuántas tandas alcanza lo que hay en la despensa.
public struct Yield: Sendable, Equatable {
    /// Tandas exactas, con decimales.
    public let batches: Double
    /// Tandas de verdad: media hornada de galletas no existe.
    public let wholeBatches: Int
    public let servings: Double
    public let wholeServings: Double
    /// Cuánto gasta UNA tanda, en unidades base del ingrediente.
    public let perBatch: Double
    /// Lo que hay, en esas mismas unidades base.
    public let available: Double
    /// Lo que falta para completar una tanda. Cero si alcanza.
    public let short: Double
    /// Lo que sobra después de la última tanda entera.
    public let leftover: Double
    public let baseUnit: String
    public var isEnough: Bool { batches >= 1 }
}

public struct Conversion: Sendable, Equatable {
    public let via: ConversionVia
    /// "200 g = 1.77 u"
    public let texto: String
    /// La explicación larga, para el botón de información.
    public let detalle: String
}

// MARK: - En qué unidad se lee un precio

extension Units {
    /// Elige la unidad en la que un precio se puede leer.
    ///
    /// Manda la unidad preferida. Sólo se cambia cuando daría "$0.00", y aun
    /// entonces se busca dentro de su mismo sistema de medida: quien compra en
    /// gramos quiere ver kilos, no onzas. Réplica de legible() en
    /// business-core.js.
    public static func readableCost(_ perBase: Double,
                                    family: MeasureUnit.Family,
                                    preferred: String) -> (amount: Double, unit: String) {
        let pref = info(preferred)
        let own = pref.family == family ? pref.factor : 1
        if perBase * own >= Ingredient.costReadable {
            return (perBase * own, pref.family == family ? pref.short : base(family).short)
        }

        let todas = inFamily(family).sorted { $0.factor < $1.factor }
        let mismoSistema = todas.filter { $0.system == pref.system }
        let busca: ([MeasureUnit]) -> MeasureUnit? = { lista in
            lista.first { perBase * $0.factor >= Ingredient.costMinimum }
        }
        guard let elegida = busca(mismoSistema) ?? busca(todas) ?? todas.last else {
            return (perBase * own, pref.short)
        }
        return (perBase * elegida.factor, elegida.short)
    }
}

// MARK: - Sobre qué cantidad se leen los macros

/// Las etiquetas vienen por 100 g o por 100 ml, y así se guardan. Pero "por
/// cada 100 unidades" no lo lee nadie: los datos de una banana se dicen POR
/// BANANA, no por cien bananas. Se sigue guardando igual —por 100 unidades
/// base, para que las cuentas de receta no cambien— y se enseña por pieza.
public struct MacroBasis: Sendable, Equatable {
    public let amount: Double
    public let unit: String
    public let label: String
    /// Lo que se enseña, multiplicado por esto, es lo que se guarda.
    public let factor: Double

    public static func of(_ unitSingle: String) -> MacroBasis {
        if Units.family(unitSingle) == .conteo {
            return MacroBasis(amount: 1, unit: "unidad", label: "cada unidad", factor: 100)
        }
        let u = Units.info(unitSingle)
        return MacroBasis(amount: 100, unit: u.short, label: "100 \(u.short)", factor: 1)
    }

    /// De lo que ella escribe a lo que se guarda.
    public static func toStore(_ value: Double?, unitSingle: String) -> Double? {
        guard let v = value, v.isFinite else { return nil }
        return ((v * of(unitSingle).factor) * 10_000).rounded() / 10_000
    }

    /// De lo guardado a lo que se enseña.
    public static func toShow(_ value: Double?, unitSingle: String) -> Double? {
        guard let v = value, v.isFinite else { return nil }
        return ((v / of(unitSingle).factor) * 100).rounded() / 100
    }
}

// MARK: - Nutrición de lo que no trae etiqueta

/// Convierte unos valores de referencia (por 100 g) a lo que se guarda.
///
/// Una banana no trae etiqueta, pero sus datos son conocimiento general. El
/// modelo aporta los valores por 100 g y cuánto pesa una pieza típica; la
/// cuenta se hace aquí, por lo mismo de siempre: una división mal hecha por el
/// modelo se ve igual de convincente que una bien hecha, y aquí acaba en un
/// precio o en una etiqueta de dieta.
/// Réplica de normalizarReferencia() en business-core.js.
public enum ReferenceNutrition {

    public enum Failure: String, Sendable, Error {
        case sinDatos = "sin-datos"
        case sinPeso = "sin-peso"
        case sinDensidad = "sin-densidad"
    }

    public static func normalize(per100g: [Macro: Double?],
                                 gramsPerPiece: Double?,
                                 unitSingle: String) -> Result<[Macro: Double?], Failure> {
        let hasAny = Macro.allCases.contains { (per100g[$0] ?? nil) != nil }
        guard hasAny else { return .failure(.sinDatos) }

        let family = Units.family(unitSingle)
        // De gramos a mililitros hace falta la densidad, y no es la misma para
        // un jugo que para un puré. Inventarla daría un número creíble y falso.
        guard family != .volumen else { return .failure(.sinDensidad) }

        let factor: Double
        if family == .masa {
            factor = 1                       // ya viene por 100 g, que es como se guarda
        } else {
            guard let g = gramsPerPiece, g > 0, g.isFinite else { return .failure(.sinPeso) }
            // Guardado = por 100 piezas. Una pieza aporta por100g x g/100, así
            // que cien piezas aportan por100g x g.
            factor = g
        }

        var out: [Macro: Double?] = [:]
        for m in Macro.allCases {
            if let v = per100g[m] ?? nil, v.isFinite {
                out[m] = ((v * factor) * 100).rounded() / 100
            } else {
                out[m] = Double?.none
            }
        }
        return .success(out)
    }
}
