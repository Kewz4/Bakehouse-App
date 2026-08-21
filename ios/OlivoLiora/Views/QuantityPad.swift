import SwiftUI
import OlivoLioraCore

/// Teclado propio para cantidades, igual que el de la web.
///
/// Existe porque en repostería se escribe en fracciones: "media taza", "1 ½
/// libras". El teclado del sistema deja escribir cualquier cosa y luego hay que
/// rechazarla con un error; este sólo deja escribir cantidades válidas, así que
/// nunca hay nada que corregir.
struct QuantityField: View {
    let label: String
    @Binding var text: String
    /// Unidad que se muestra en la vista previa ("2 ½ tazas").
    var unitShort: String = ""

    @State private var showPad = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.rounded(12, .bold))
                .foregroundStyle(Theme.muted)

            Button { showPad = true } label: {
                HStack {
                    Text(display)
                        .font(Theme.rounded(17))
                        .foregroundStyle(text.isEmpty ? Theme.muted : Theme.ink)
                    Spacer()
                    Image(systemName: "square.grid.3x3.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 12)
                .frame(height: 46)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: $showPad) {
            QuantityPad(text: $text, unitShort: unitShort)
                .presentationDetents([.height(360)])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.cream)
        }
    }

    private var display: String {
        if text.isEmpty { return "toca para escribir" }
        let n = Quantity.parse(text)
        return n > 0 ? Quantity.pretty(n) + (unitShort.isEmpty ? "" : " " + unitShort) : text
    }
}

struct QuantityPad: View {
    @Binding var text: String
    var unitShort: String = ""
    @Environment(\.dismiss) private var dismiss

    private let rows: [[String]] = [
        ["1", "2", "3", "½"],
        ["4", "5", "6", "⅓"],
        ["7", "8", "9", "¼"],
        [".", "0", "⌫", "¾"]
    ]

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text(preview)
                    .font(Theme.rounded(19, .semibold))
                    .foregroundStyle(preview.isEmpty ? Theme.muted : Theme.ink)
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.2), value: preview)
                Spacer()
                Button("Listo") { dismiss() }
                    .font(Theme.rounded(16, .bold))
                    .primaryActionStyle()
            }
            .padding(.top, 14)

            VStack(spacing: 8) {
                ForEach(rows, id: \.self) { row in
                    HStack(spacing: 8) {
                        ForEach(row, id: \.self) { key in
                            PadKey(key: key) { press(key) }
                        }
                    }
                }
                HStack(spacing: 8) {
                    PadKey(key: "⅔") { press("⅔") }
                    PadKey(key: "⅛") { press("⅛") }
                    PadKey(key: "Borrar", wide: true) { text = "" }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var preview: String {
        let n = Quantity.parse(text)
        guard n > 0 else { return text.isEmpty ? "Escribe una cantidad" : text }
        return Quantity.pretty(n) + (unitShort.isEmpty ? "" : " " + unitShort)
    }

    /// Misma lógica de escritura que `padKey()` en app.js.
    private func press(_ key: String) {
        switch key {
        case "⌫":
            if !text.isEmpty { text.removeLast() }
            text = String(text.reversed().drop(while: { $0 == " " }).reversed())
        case "½", "⅓", "¼", "¾", "⅔", "⅛":
            if let last = text.last, last.isNumber { text += " " }
            text += key
        case ".":
            // Un solo punto decimal, y "0." si todavía no hay número.
            if !text.contains(".") { text += text.isEmpty ? "0." : "." }
        default:
            text += key
        }
    }
}

private struct PadKey: View {
    let key: String
    var wide: Bool = false
    let action: () -> Void

    private var isFraction: Bool { "½⅓¼¾⅔⅛".contains(key) }
    private var isDelete: Bool { key == "⌫" }

    var body: some View {
        Button(action: {
            action()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }) {
            Text(key)
                .font(Theme.rounded(wide ? 15 : 22, .medium))
                .foregroundStyle(isFraction ? Theme.green : Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityName)
    }

    private var background: Color {
        if isFraction { return Theme.sage }
        if isDelete || wide { return Theme.line.opacity(0.6) }
        return .white
    }

    private var accessibilityName: String {
        switch key {
        case "⌫": return "Borrar un carácter"
        case "½": return "un medio"
        case "⅓": return "un tercio"
        case "¼": return "un cuarto"
        case "¾": return "tres cuartos"
        case "⅔": return "dos tercios"
        case "⅛": return "un octavo"
        case ".": return "punto decimal"
        default: return key
        }
    }
}

/// Campo de dinero. Teclado decimal y nada más: no hay forma de escribir algo
/// que no sea un monto.
struct MoneyField: View {
    let label: String
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.rounded(12, .bold))
                .foregroundStyle(Theme.muted)
            HStack(spacing: 4) {
                Text("$").font(Theme.rounded(17)).foregroundStyle(Theme.muted)
                TextField("0.00", text: $value)
                    .keyboardType(.decimalPad)
                    .font(Theme.rounded(17))
            }
            .padding(.horizontal, 12)
            .frame(height: 46)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))
        }
    }
}

/// Campo de texto con el mismo aspecto que los demás.
struct PlainField: View {
    let label: String
    var placeholder: String = ""
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.rounded(12, .bold))
                .foregroundStyle(Theme.muted)
            TextField(placeholder, text: $text)
                .font(Theme.rounded(17))
                .padding(.horizontal, 12)
                .frame(height: 46)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
        }
    }
}
