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
                  detail: "Sin azúcar añadida"),
        DietBadge(key: "bajoAzucar", name: "Bajo en azúcar", emoji: "🍬",
                  detail: "Poca azúcar añadida, o lleva fruta"),
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

    /// La fruta lleva fructosa aunque no tenga azúcar añadida, así que una
    /// receta con fruta nunca es "sin azúcar": es "baja en azúcar".
    ///
    /// El coco queda fuera a propósito: la harina y la leche de coco casi no
    /// traen azúcar y marcarlas como fruta arruinaría las recetas keto.
    public static let fruitWords = ["fresa", "frambuesa", "mora", "zarzamora", "arandano",
        "arándano", "blueberry", "mango", "banano", "banana", "platano", "plátano",
        "manzana", "pera", "piña", "pina", "durazno", "melocoton", "melocotón", "cereza",
        "uva", "pasas", "naranja", "mandarina", "limon", "limón", "kiwi", "papaya",
        "sandia", "sandía", "melon", "melón", "maracuya", "maracuyá", "guayaba", "datil",
        "dátil", "higo", "ciruela", "granada", "tamarindo", "maranon", "marañón",
        "jocote", "mamey", "zapote", "anona", "nispero", "níspero", "lichi",
        "carambola", "fruta"]

    /// ¿El nombre suena a fruta? Es sólo la detección automática: la categoría
    /// que ella elija manda sobre esto.
    public static func nameLooksLikeFruit(_ nombre: String) -> Bool {
        let n = nombre.lowercased()
        return fruitWords.contains { n.contains($0) }
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

        // --- Azúcar ---------------------------------------------------------
        // "Sin azúcar" en el mercado quiere decir SIN AZÚCAR AÑADIDA: la leche
        // tiene lactosa y sigue vendiéndose como sin azúcar. Por eso se mira la
        // añadida y no la total. La excepción es la fruta: su fructosa sí cuenta
        // para quien la vigila, así que una receta con fruta no pasa de "baja".
        //
        // Si algún ingrediente no declara la azúcar añadida no se pone ninguna
        // de las dos: es una afirmación sobre salud y no se hace a medias.
        // El empaque no se come: ni aporta azúcar ni puede impedir que se sepa
        // cuánta lleva la receta.
        let edibleLines = recipe.lines.filter { line in
            guard let id = line.ingredientId, let ing = ingredients[id] else { return true }
            return ing.kind.feeds
        }
        let used = edibleLines.compactMap { $0.ingredientId.flatMap { ingredients[$0] } }
        let knowAdded = used.count == edibleLines.count && !edibleLines.isEmpty
            && used.allSatisfy { $0.macro(.azucarAnadida) != nil }
        if knowAdded {
            let added = v(.azucarAnadida)
            let withFruit = used.contains { $0.isFruit }
            if added <= 0.5 && !withFruit {
                out.badges.append(badge("sinAzucar"))
            } else if added <= 5 {
                out.badges.append(badge("bajoAzucar"))
            }
        }

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

        if used.count == edibleLines.count, isPaleo(used) {
            out.badges.append(badge("paleo"))
        }

        out.reason = out.badges.isEmpty ? .noneMatched : .none
        return out
    }
}
