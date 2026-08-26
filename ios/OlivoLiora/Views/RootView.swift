import SwiftUI
import OlivoLioraCore

@main
struct OlivoLioraApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.green)
                // La app es en español y con números en dólares, igual que la
                // web, sin depender del idioma del teléfono.
                .environment(\.locale, Locale(identifier: "es"))
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: store.appBecameActive()
            case .background, .inactive: store.appWillResignActive()
            @unknown default: break
            }
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        // Se usa `.tabItem` y no la API `Tab { }` de iOS 18 para no dejar
        // fuera a iPhones con iOS 17. En iOS 26 el sistema le aplica Liquid
        // Glass igualmente, así que no se pierde nada del aspecto nuevo.
        TabView {
            NavigationStack { DashboardView() }
                .tabItem { Label("Resumen", systemImage: "house.fill") }
            NavigationStack { RecipesView() }
                .tabItem { Label("Recetas", systemImage: "birthday.cake.fill") }
            NavigationStack { SalesView() }
                .tabItem { Label("Ventas", systemImage: "chart.bar.fill") }
            NavigationStack { ExpensesView() }
                .tabItem { Label("Inversión", systemImage: "creditcard.fill") }
            NavigationStack { IngredientsView() }
                .tabItem { Label("Ingredientes", systemImage: "shippingbox.fill") }
        }
        .minimizingTabBar()
        .background(Theme.cream)
    }
}

/// El estado de guardado, arriba a la derecha.
///
/// Es informativo y nada más: no hay botón de sincronizar ni de reintentar,
/// porque no hay nada que ella deba decidir. Si no hay señal, la app espera y
/// sube sola.
struct SyncBadge: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(store.syncState.label)
                .font(Theme.rounded(12, .semibold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassPanel(shapeIsCapsule: true)
        .animation(.easeInOut(duration: 0.25), value: store.syncState)
        .accessibilityLabel(store.syncState.label)
    }

    private var color: Color {
        switch store.syncState {
        case .saved: return Theme.green
        case .saving: return Theme.gold
        case .waitingForNetwork: return Theme.peach
        case .localOnly: return Theme.muted
        }
    }
}

extension View {
    /// Variante en cápsula del panel de cristal, para la insignia de guardado.
    @ViewBuilder
    func glassPanel(shapeIsCapsule: Bool) -> some View {
        if shapeIsCapsule {
            modifier(GlassPanel(shape: AnyShape(Capsule())))
        } else {
            modifier(GlassPanel())
        }
    }
}
