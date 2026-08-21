import SwiftUI

/// El aviso de que hay una versión nueva de la app.
///
/// Aparece sólo en la pantalla de inicio y sólo cuando hay algo que instalar. Si
/// no lo hay, no ocupa ni un píxel: no es un ajuste ni una pantalla a la que
/// haya que entrar a mirar.
///
/// No dice números de versión, ni "build", ni qué cambió. Un botón, una frase, y
/// iOS se encarga del resto.
struct UpdateBanner: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        switch store.updates.phase {
        case .idle:
            EmptyView()

        case .ready:
            banner {
                Button("Actualizar") {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    store.updates.install()
                }
                .primaryActionStyle()
            } text: {
                Text("Hay una versión nueva de tu app.")
            }

        case .installing:
            banner {
                ProgressView().tint(Theme.green)
            } text: {
                // Después de tocar el botón iOS pide confirmación y se lleva la
                // app a la pantalla de inicio para instalarla. Sin esta frase,
                // volver aquí y ver el mismo botón invita a tocarlo otra vez.
                Text("Instalándose. Aparecerá sola en unos segundos.")
            }
        }
    }

    @ViewBuilder
    private func banner<Action: View, Label: View>(
        @ViewBuilder action: () -> Action,
        @ViewBuilder text: () -> Label
    ) -> some View {
        HStack(spacing: 12) {
            text()
                .font(Theme.rounded(14, .semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            action()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .fill(Theme.sage))
        .transition(.move(edge: .top).combined(with: .opacity))
        .animation(.snappy(duration: 0.3), value: store.updates.phase)
    }
}
