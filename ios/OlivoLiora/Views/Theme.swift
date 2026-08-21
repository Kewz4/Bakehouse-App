import SwiftUI

/// Los mismos colores y tipografías que la web, para que la app y el sitio se
/// sientan una sola cosa.
enum Theme {
    static let ink     = Color(hex: 0x20362C)
    static let green   = Color(hex: 0x365B4C)
    static let sage    = Color(hex: 0xDCE6D8)
    static let cream   = Color(hex: 0xFBF9F3)
    static let peach   = Color(hex: 0xF1C6A8)
    static let gold    = Color(hex: 0xC8954E)
    static let red     = Color(hex: 0xBD5A50)
    static let line    = Color(hex: 0xE7E2D7)
    static let muted   = Color(hex: 0x748178)
    static let card    = Color(hex: 0xFFFEFA)

    /// Los títulos de la web usan Georgia; en iOS el equivalente de sistema es
    /// New York, que es lo que da `.serif`.
    static func title(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif) }
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static let cardRadius: CGFloat = 18
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}

// MARK: - Liquid Glass

// Liquid Glass llegó con iOS 26. Aquí hay DOS comprobaciones y las dos hacen
// falta:
//
//   #if canImport(FoundationModels)  -> ¿el SDK con el que se compila conoce
//      siquiera estos símbolos? FoundationModels también es nuevo de iOS 26, así
//      que sirve de señal. Sin esto, compilar con un Xcode anterior falla al no
//      existir `glassEffect`, por mucho `if #available` que se ponga: el
//      `#available` decide en ejecución, no en compilación.
//
//   if #available(iOS 26.0, *)       -> ¿el iPhone que la está usando lo tiene?
//
// El resultado es un solo código que compila con cualquier Xcode y se ve nativo
// tanto en el iPhone que ella tenga hoy como en iOS 26/27.
struct GlassPanel: ViewModifier {
    var tinted: Bool = false
    var shape: AnyShape = AnyShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))

    func body(content: Content) -> some View {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            content.glassEffect(
                tinted ? .regular.tint(Theme.green.opacity(0.16)) : .regular,
                in: shape)
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    @ViewBuilder
    private func fallback(_ content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.stroke(Theme.line, lineWidth: 1))
    }
}

/// Tarjeta de contenido. Va en opaco a propósito: el cristal es para la capa de
/// navegación, no para el contenido — cristal sobre cristal ensucia la jerarquía
/// y cuesta rendimiento, y Apple lo desaconseja explícitamente.
struct PanelCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.04), radius: 12, y: 6)
    }
}

extension View {
    func glassPanel(tinted: Bool = false) -> some View { modifier(GlassPanel(tinted: tinted)) }
    func panelCard() -> some View { modifier(PanelCard()) }

    /// Botón principal: cristal con tinte en iOS 26, relleno sólido antes.
    @ViewBuilder
    func primaryActionStyle() -> some View {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent).tint(Theme.green)
        } else {
            self.buttonStyle(.borderedProminent).tint(Theme.green)
        }
        #else
        self.buttonStyle(.borderedProminent).tint(Theme.green)
        #endif
    }

    @ViewBuilder
    func secondaryActionStyle() -> some View {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glass).tint(Theme.green)
        } else {
            self.buttonStyle(.bordered).tint(Theme.green)
        }
        #else
        self.buttonStyle(.bordered).tint(Theme.green)
        #endif
    }

    /// La barra de pestañas se encoge al bajar por la lista (iOS 26).
    @ViewBuilder
    func minimizingTabBar() -> some View {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
        #else
        self
        #endif
    }
}

// MARK: - Piezas comunes

/// Mensaje para cuando todavía no hay nada. Nunca es un error: siempre dice
/// qué hacer a continuación.
struct EmptyHint: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.rounded(14))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(28)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    .foregroundStyle(Theme.line))
    }
}

/// Fila de lista con punto, título, subtítulo y cifra a la derecha.
struct DotRow: View {
    let title: String
    var subtitle: String? = nil
    var amount: String? = nil
    var amountColor: Color = Theme.ink

    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.peach).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.rounded(15, .semibold)).foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle).font(Theme.rounded(12)).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 8)
            if let amount {
                Text(amount).font(Theme.rounded(15, .heavy)).foregroundStyle(amountColor)
            }
        }
        .padding(.vertical, 8)
    }
}

struct Chip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.rounded(11, .bold))
            .foregroundStyle(Theme.green)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(Theme.sage, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
