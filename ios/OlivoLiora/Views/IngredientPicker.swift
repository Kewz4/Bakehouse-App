import SwiftUI
import OlivoLioraCore

/// Selector de ingrediente a pantalla completa, con buscador.
///
/// Un menú desplegable funciona con diez ingredientes y se vuelve inservible
/// con doscientos: hay que recorrer una lista larguísima sin poder buscar. Esto
/// abre una pantalla con el buscador enfocado, así que escribir "har" y tocar
/// es más rápido que desplegar nada.
struct IngredientPicker: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    /// El ingrediente elegido ahora mismo, para marcarlo.
    let selectedId: String
    let onPick: (Ingredient?) -> Void

    @State private var search = ""
    @FocusState private var searchFocused: Bool

    private var results: [Ingredient] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return store.ingredients }
        // Los que empiezan por lo buscado van primero: al escribir "har",
        // "Harina" debe salir antes que "Azúcar de harina de coco".
        let matches = store.ingredients.filter { $0.name.lowercased().contains(q) }
        return matches.sorted { a, b in
            let sa = a.name.lowercased().hasPrefix(q), sb = b.name.lowercased().hasPrefix(q)
            return sa == sb ? a.name < b.name : sa
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if store.ingredients.isEmpty {
                    EmptyHint(text: "Todavía no has guardado ingredientes. Agrégalos en la pestaña Ingredientes y aquí aparecerán.")
                        .plainRow()
                } else if results.isEmpty {
                    EmptyHint(text: "Ningún ingrediente se llama así.")
                        .plainRow()
                }

                ForEach(results) { ing in
                    Button {
                        onPick(ing)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(ing.name)
                                    .font(Theme.rounded(16, .semibold))
                                    .foregroundStyle(Theme.ink)
                                let cost = ing.displayCost
                                Text("\(Money.format(cost.amount)) por \(cost.unit)")
                                    .font(Theme.rounded(12))
                                    .foregroundStyle(Theme.muted)
                            }
                            Spacer(minLength: 8)
                            if ing.hasMacros {
                                Image(systemName: "leaf.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.green.opacity(0.6))
                                    .accessibilityLabel("Con información nutricional")
                            }
                            if ing.id == selectedId {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(Theme.green)
                            }
                        }
                        .padding(14)
                        .panelCard()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .plainRow(vertical: 4)
                }
            }
            .listStyle(.plain)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .background(Theme.cream)
            .navigationTitle("Elige un ingrediente")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Buscar ingrediente…")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }.tint(Theme.muted)
                }
                if !selectedId.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Quitar") {
                            onPick(nil)
                            dismiss()
                        }
                        .tint(Theme.red)
                    }
                }
            }
        }
    }
}
