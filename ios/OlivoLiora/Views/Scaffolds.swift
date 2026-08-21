import SwiftUI
import OlivoLioraCore

/// Estructura común de las listas (ventas, gastos, ingredientes).
///
/// Una sola acción visible por pantalla, siempre en el mismo sitio: el botón
/// grande de abajo a la derecha. No hay menús ni ajustes que descubrir.
struct ListScaffold<Content: View>: View {
    let eyebrow: String
    let title: String
    var subtitle: String? = nil
    let searchPrompt: String
    @Binding var search: String
    let addLabel: String
    let onAdd: () -> Void
    let isEmpty: Bool
    let emptyText: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                BrandHeader(subtitle: subtitle ?? title)
                SectionHeading(eyebrow: eyebrow, title: title)

                if isEmpty {
                    EmptyHint(text: emptyText).padding(.top, 8)
                } else {
                    LazyVStack(spacing: 10) { content() }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 96)
        }
        .background(Theme.cream)
        .scrollIndicators(.hidden)
        .searchable(text: $search, prompt: searchPrompt)
        .overlay(alignment: .bottomTrailing) {
            AddButton(label: addLabel, action: onAdd)
                .padding(.trailing, 18)
                .padding(.bottom, 18)
        }
    }
}

/// El botón de añadir. Flota sobre el contenido: es la única capa que lleva
/// cristal, tal como recomienda Apple para Liquid Glass — el cristal es para la
/// navegación, nunca para el contenido.
struct AddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            action()
        }) {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 58, height: 58)
        }
        .primaryActionStyle()
        .clipShape(Circle())
        .shadow(color: Theme.green.opacity(0.35), radius: 12, y: 6)
        .accessibilityLabel(label)
    }
}

/// Estructura común de los formularios.
///
/// Guardar y Cancelar siempre arriba, en el mismo sitio, y Guardar se apaga
/// solo si falta algo: así nunca aparece un error después de haber escrito.
struct EditorScaffold<Content: View>: View {
    let title: String
    let canSave: Bool
    let onSave: () -> Void
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    content()
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(Theme.cream)
            .scrollIndicators(.hidden)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .tint(Theme.muted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: onSave)
                        .font(Theme.rounded(16, .bold))
                        .disabled(!canSave)
                        .tint(Theme.green)
                }
            }
        }
        .presentationDragIndicator(.visible)
    }
}

/// Confirmación de borrado. Se pregunta siempre, porque no hay deshacer.
struct DeleteConfirm: ViewModifier {
    @Binding var isPresented: Bool
    let what: String
    let onDelete: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog("¿Borrar \(what)?", isPresented: $isPresented, titleVisibility: .visible) {
            Button("Borrar", role: .destructive, action: onDelete)
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("No se puede deshacer.")
        }
    }
}

extension View {
    func deleteConfirm(isPresented: Binding<Bool>, what: String,
                       onDelete: @escaping () -> Void) -> some View {
        modifier(DeleteConfirm(isPresented: isPresented, what: what, onDelete: onDelete))
    }
}
