import SwiftUI
import OlivoLioraCore

/// Estructura común de las listas (ventas, gastos, ingredientes).
///
/// La cabecera es UNA sola línea con el nombre de la pantalla. Antes había dos
/// bloques encima de cada lista — la marca y luego un antetítulo con el título —
/// y entre eso y la pestaña de abajo, "Ingredientes" acababa escrito tres veces
/// en la misma pantalla. El nombre de la app ya está en el icono y en el panel
/// de inicio; no hace falta repetirlo en cada sitio al que ella entra.
///
/// Va sobre `List` y no sobre `ScrollView` + `LazyVStack` por una razón muy
/// concreta: `.swipeActions` SÓLO funciona dentro de una `List`. Fuera de ella
/// el modificador compila igual y no hace absolutamente nada, que es la peor
/// forma de fallar — parece implementado y no lo está.
///
/// La `List` va desnuda (sin separadores, sin fondo, sin sangrías propias) para
/// que las tarjetas se vean igual que antes.
struct ListScaffold<Content: View>: View {
    let title: String
    /// Bajo el título, y sólo si dice algo que el título no dice ya.
    var detail: String? = nil
    let searchPrompt: String
    @Binding var search: String
    let addLabel: String
    let onAdd: () -> Void
    let isEmpty: Bool
    let emptyText: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        List {
            Group {
                ScreenHeader(title: title, detail: detail)
                    .padding(.bottom, 2)

                if isEmpty {
                    EmptyHint(text: emptyText)
                }
            }
            .plainRow()

            content()
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
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

extension View {
    /// Una fila sin la decoración que `List` pone por defecto.
    func plainRow(vertical: CGFloat = 5) -> some View {
        self
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: vertical, leading: 16, bottom: vertical, trailing: 16))
    }

    /// Deslizar para editar (izquierda) y para borrar (derecha).
    ///
    /// `allowsFullSwipe: false` en el borrado a propósito: hay que deslizar y
    /// además tocar el botón rojo. No hay deshacer, y el borrado viaja a todos
    /// los dispositivos, así que un deslizón largo no debería bastar.
    func rowActions(onEdit: @escaping () -> Void,
                    onDelete: @escaping () -> Void) -> some View {
        self
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button(action: onEdit) {
                    Label("Editar", systemImage: "pencil")
                }
                .tint(Theme.green)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive, action: onDelete) {
                    Label("Borrar", systemImage: "trash")
                }
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

/// Confirmación de borrado, para lo que cuesta rehacer (una receta entera).
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

/// La cabecera de una pantalla: su nombre y, si lo hay, un dato que valga la
/// pena leer.
///
/// La regla que sigue todo esto: **el nombre de la pantalla se escribe una vez**.
/// Lo que va debajo tiene que aportar información nueva — cuántas cosas hay, de
/// qué período son — y nunca ser otra manera de decir lo mismo.
struct ScreenHeader: View {
    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Theme.title(28))
                    .foregroundStyle(Theme.ink)
                if let detail {
                    Text(detail)
                        .font(Theme.rounded(12, .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 8)
            SyncBadge()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
