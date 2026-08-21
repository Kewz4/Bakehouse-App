import Foundation

/// Los datos nutricionales que se pueden guardar de un ingrediente.
/// Mismo conjunto y mismos nombres que en business-core.js.
public enum Macro: String, CaseIterable, Sendable, Identifiable {
    case calorias, proteina, carbohidratos, azucar, grasa, grasaSaturada, fibra, sodioMg

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .calorias:      return "Calorías"
        case .proteina:      return "Proteína"
        case .carbohidratos: return "Carbohidratos"
        case .azucar:        return "Azúcares"
        case .grasa:         return "Grasa"
        case .grasaSaturada: return "Grasa saturada"
        case .fibra:         return "Fibra"
        case .sodioMg:       return "Sodio"
        }
    }

    public var unit: String { self == .calorias ? "kcal" : (self == .sodioMg ? "mg" : "g") }
}

public extension Ingredient {

    /// Valor por 100 unidades base. `nil` significa "no se sabe", que NO es lo
    /// mismo que 0: un producto sin grasa tiene 0 de verdad, y confundir las
    /// dos cosas falsea la suma de la receta.
    func macro(_ m: Macro) -> Double? {
        guard let obj = record["macros"]?.objectValue, let raw = obj[m.rawValue] else { return nil }
        if case .null = raw { return nil }
        return raw.doubleValue
    }

    mutating func setMacro(_ m: Macro, _ value: Double?) {
        var obj = record["macros"]?.objectValue ?? [:]
        obj[m.rawValue] = value.map { JSONValue.number($0) } ?? .null
        // Si no quedó ningún dato, se borra el campo entero en vez de dejar un
        // objeto lleno de nulls dando vueltas por la sincronización.
        record["macros"] = obj.values.contains(where: { if case .null = $0 { return false } else { return true } })
            ? .object(obj) : nil
    }

    var hasMacros: Bool { Macro.allCases.contains { macro($0) != nil } }

    /// Cuánto aporta 1 unidad base (1 g, 1 ml, 1 unidad).
    func macroPerBase(_ m: Macro) -> Double { (macro(m) ?? 0) / 100 }
}

/// Resultado de sumar los macros de una receta.
public struct RecipeMacros: Sendable {
    public var totals: [Macro: Double] = [:]
    public var perServing: [Macro: Double] = [:]
    /// Cuántas líneas de la receta se pudieron contar…
    public var counted: Int = 0
    /// …de cuántas hay en total.
    public var total: Int = 0

    public var isComplete: Bool { counted == total && total > 0 }
    public var hasAny: Bool { counted > 0 }

    /// La frase que se le enseña: "Por porción: 190 kcal · 8 g azúcar".
    /// Si faltan ingredientes por cubrir, lo dice. Un total redondo calculado
    /// con la mitad de la receta es un número creíble y equivocado.
    public var sentence: String? {
        guard hasAny else { return nil }
        let shown: [(Macro, String)] = [
            (.calorias, "kcal"), (.proteina, "g proteína"),
            (.azucar, "g azúcar"), (.grasa, "g grasa")
        ]
        let parts = shown.compactMap { macro, suffix -> String? in
            let v = perServing[macro] ?? 0
            guard v > 0 else { return nil }
            return "\(Self.short(v)) \(suffix)"
        }
        guard !parts.isEmpty else { return nil }
        let warning = isComplete ? "" : " · sólo \(counted) de \(total) ingredientes"
        return "Por porción: " + parts.joined(separator: " · ") + warning
    }

    static func short(_ v: Double) -> String {
        let r = (v * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(r)
    }
}

public extension Analytics {

    /// Suma los macros de una receta.
    ///
    /// Sólo cuentan las líneas enlazadas a un ingrediente que tenga datos. Las
    /// demás se reportan aparte para poder avisar en vez de callar.
    /// Réplica exacta de `recipeMacros()` en business-core.js.
    static func macros(for recipe: Recipe, ingredients: [String: Ingredient]) -> RecipeMacros {
        var out = RecipeMacros()
        let lines = recipe.lines
        out.total = lines.count

        for m in Macro.allCases { out.totals[m] = 0 }

        for line in lines {
            guard let id = line.ingredientId,
                  let ing = ingredients[id],
                  ing.hasMacros else { continue }
            // La cantidad de la línea llevada a unidades base.
            let base = line.qty * Units.info(line.unit.isEmpty ? ing.unitSingle : line.unit).factor
            for m in Macro.allCases {
                out.totals[m, default: 0] += base * ing.macroPerBase(m)
            }
            out.counted += 1
        }

        let servings = recipe.yield > 0 ? recipe.yield : 1
        for m in Macro.allCases { out.perServing[m] = (out.totals[m] ?? 0) / servings }
        return out
    }
}
