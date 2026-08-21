import Foundation

/// Una etiqueta de dieta: "Keto", "Sin azúcar", "GymReady"…
public struct DietBadge: Hashable, Sendable, Identifiable {
    public let key: String
    public let name: String
    public let emoji: String
    /// Qué significa exactamente. Se enseña al tocarla, para que la etiqueta no
    /// sea una afirmación a ciegas.
    public let detail: String

    public var id: String { key }
    public var label: String { "\(emoji) \(name)" }
}

/// Por qué una receta no tiene etiquetas.
public enum BadgeReason: String, Sendable {
    case none            // sí tiene etiquetas
    case noIngredients   // receta vacía
    case missingData     // faltan macros de algún ingrediente
    case noneMatched     // datos completos, pero no cumple ninguna
}

public struct BadgeResult: Sendable {
    public var badges: [DietBadge] = []
    public var reason: BadgeReason = .none
    public var macros = RecipeMacros()
}

/// Reglas de etiquetas. Traducción exacta de business-core.js.
///
/// Se calculan sobre los macros POR PORCIÓN. Los cortes siguen los de las
/// etiquetas de alimentos donde existen.
public enum Badges {

    public static let all: [DietBadge] = [
        DietBadge(key: "sinAzucar",  name: "Sin azúcar",     emoji: "🍭",
                  detail: "Menos de 0.5 g de azúcar por porción"),
        DietBadge(key: "bajoAzucar", name: "Bajo en azúcar", emoji: "🍬",
                  detail: "5 g de azúcar o menos por porción"),
        DietBadge(key: "keto",       name: "Keto",           emoji: "🥑",
                  detail: "Pocos carbohidratos netos y mayoría de calorías de grasa"),
        DietBadge(key: "gymReady",   name: "GymReady",       emoji: "💪",
                  detail: "Buena carga de proteína por porción"),
        DietBadge(key: "altaFibra",  name: "Alta en fibra",  emoji: "🌾",
                  detail: "5 g de fibra o más por porción"),
        DietBadge(key: "bajoGrasa",  name: "Bajo en grasa",  emoji: "🪶",
                  detail: "3 g de grasa o menos por porción"),
        DietBadge(key: "bajoSodio",  name: "Bajo en sodio",  emoji: "🧂",
                  detail: "140 mg de sodio o menos por porción"),
        DietBadge(key: "paleo",      name: "Paleo",          emoji: "🥥",
                  detail: "Sin harinas, lácteos ni azúcar añadida")
    ]

    private static func badge(_ key: String) -> DietBadge {
        all.first { $0.key == key }!
    }

    /// Paleo no se puede deducir de los macros: no es cuestión de cantidades
    /// sino de qué lleva la receta. Se mira por nombre, y a propósito de forma
    /// estricta — ante la duda, no se pone.
    static let notPaleo = ["suero", "caseina", "caseína", "gluten", "centeno",
                           "cebada", "malta", "nata", "condensada",
                           "harina", "trigo", "azucar", "azúcar", "leche", "crema",
                           "queso", "mantequilla", "yogur", "yoghurt", "maiz", "maíz",
                           "arroz", "avena", "frijol", "soya", "lenteja", "garbanzo",
                           "cacahuate", "maní", "mani", "levadura", "margarina", "pan",
                           "galleta", "cereal", "sirope", "jarabe"]
    static let paleoExceptions = ["harina de almendra", "harina de coco", "harina de yuca",
                                  "harina de castaña", "leche de coco", "leche de almendra"]

    public static func isPaleo(_ ingredients: [Ingredient]) -> Bool {
        guard !ingredients.isEmpty else { return false }
        return ingredients.allSatisfy { ing in
            let name = ing.name.lowercased()
            if paleoExceptions.contains(where: { name.contains($0) }) { return true }
            return !notPaleo.contains(where: { name.contains($0) })
        }
    }

    /// Etiquetas de una receta.
    ///
    /// Devuelve vacío —y el motivo— si falta algún ingrediente por cubrir. Son
    /// afirmaciones sobre salud: mejor ninguna que una equivocada.
    public static func evaluate(recipe: Recipe, ingredients: [String: Ingredient]) -> BadgeResult {
        var out = BadgeResult()
        out.macros = Analytics.macros(for: recipe, ingredients: ingredients)

        guard out.macros.total > 0 else { out.reason = .noIngredients; return out }
        guard out.macros.isComplete else { out.reason = .missingData; return out }

        let p = out.macros.perServing
        func v(_ m: Macro) -> Double { p[m] ?? 0 }
        let calories = v(.calorias)

        if v(.azucar) <= 0.5 { out.badges.append(badge("sinAzucar")) }
        else if v(.azucar) <= 5 { out.badges.append(badge("bajoAzucar")) }

        let netCarbs = v(.carbohidratos) - v(.fibra)
        if calories > 0, netCarbs <= 10, (v(.grasa) * 9) / calories >= 0.6 {
            out.badges.append(badge("keto"))
        }
        if v(.proteina) >= 10, calories > 0, (v(.proteina) * 4) / calories >= 0.2 {
            out.badges.append(badge("gymReady"))
        }
        if v(.fibra) >= 5 { out.badges.append(badge("altaFibra")) }
        if v(.grasa) <= 3 { out.badges.append(badge("bajoGrasa")) }
        if v(.sodioMg) <= 140 { out.badges.append(badge("bajoSodio")) }

        let used = recipe.lines.compactMap { $0.ingredientId.flatMap { ingredients[$0] } }
        if used.count == recipe.lines.count, isPaleo(used) {
            out.badges.append(badge("paleo"))
        }

        out.reason = out.badges.isEmpty ? .noneMatched : .none
        return out
    }
}
