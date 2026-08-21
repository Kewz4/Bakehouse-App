import Foundation

/// Los textos de cabecera que la web y la app enseñan igual.
///
/// La regla de las pantallas es que el nombre se escribe UNA vez, y lo que va
/// debajo tiene que aportar algo que el nombre no diga ya. Casi siempre eso es
/// "cuántas cosas hay". Vive aquí, en el núcleo compartido, por lo mismo que las
/// cuentas: se comprueba contra la versión de JavaScript en las pruebas de
/// conformidad, así que la frase no puede irse separando entre el teléfono y la
/// laptop sin que alguien se entere.
public enum Labels {

    /// "8 guardados", o "3 de 8" mientras hay una búsqueda escrita.
    ///
    /// Devuelve `nil` cuando no hay nada: en una pantalla vacía el mensaje que
    /// dice qué hacer está justo debajo, y un "0 recetas" encima sólo estorba.
    public static func count(shown: Int, total: Int,
                             singular: String, plural: String) -> String? {
        guard total > 0 else { return nil }
        if shown != total { return "\(shown) de \(total)" }
        return "\(total) \(total == 1 ? singular : plural)"
    }

    /// Junta trozos con un punto, saltándose los que no existen.
    public static func join(_ parts: String?...) -> String? {
        joinAll(parts)
    }

    /// La misma unión, tomando una lista ya hecha.
    public static func joinAll(_ parts: [String?]) -> String? {
        let kept = parts.compactMap { $0 }.filter { !$0.isEmpty }
        return kept.isEmpty ? nil : kept.joined(separator: " · ")
    }
}
