import SwiftUI
import OlivoLioraCore

struct ExpensesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var editing: Expense?
    @State private var creating = false

    private var filtered: [Expense] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? store.expenses : store.expenses.filter {
            $0.name.lowercased().contains(q) || $0.category.lowercased().contains(q)
        }
    }

    var body: some View {
        ListScaffold(
            eyebrow: "Lo que gastas",
            title: "Gastos",
            subtitle: store.period.label,
            searchPrompt: "Buscar gasto…",
            search: $search,
            addLabel: "Registrar gasto",
            onAdd: { creating = true },
            isEmpty: filtered.isEmpty,
            emptyText: search.isEmpty
                ? "Aquí aparecerán tus gastos: gas, cajas, entregas…"
                : "Ningún gasto coincide con tu búsqueda."
        ) {
            ForEach(filtered) { expense in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(expense.name)
                            .font(Theme.rounded(16, .semibold))
                            .foregroundStyle(Theme.ink)
                        HStack(spacing: 8) {
                            Text(DayString.short(expense.date))
                                .font(Theme.rounded(12))
                                .foregroundStyle(Theme.muted)
                            Chip(text: expense.category)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(Money.format(expense.amount))
                        .font(Theme.rounded(16, .heavy))
                        .foregroundStyle(Theme.red)
                }
                .padding(14)
                .panelCard()
                .contentShape(Rectangle())
                .onTapGesture { editing = expense }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        store.delete(id: expense.id, from: .expenses)
                    } label: { Label("Borrar", systemImage: "trash") }
                }
            }
        }
        .sheet(isPresented: $creating) { ExpenseEditor(expense: nil) }
        .sheet(item: $editing) { ExpenseEditor(expense: $0) }
    }
}

struct ExpenseEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let expense: Expense?

    @State private var date = Date()
    @State private var name = ""
    @State private var category = "Servicios"
    @State private var amount = ""
    @State private var loaded = false

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) > 0
    }

    var body: some View {
        EditorScaffold(title: expense == nil ? "Registrar gasto" : "Editar gasto",
                       canSave: canSave, onSave: commit) {
            DatePicker("Fecha", selection: $date, displayedComponents: .date)
                .font(Theme.rounded(15))
                .environment(\.locale, Locale(identifier: "es"))

            PlainField(label: "Concepto", placeholder: "ej. Gas para horno", text: $name)

            VStack(alignment: .leading, spacing: 6) {
                Text("Categoría").font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                Picker("Categoría", selection: $category) {
                    ForEach(Expense.categories, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(Theme.green)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .frame(height: 46)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))
            }

            MoneyField(label: "Monto", value: $amount)
        }
        .onAppear(perform: load)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let e = expense {
            date = DayString.date(from: e.date) ?? Date()
            name = e.name
            category = e.category
            amount = e.amount > 0 ? String(format: "%.2f", e.amount) : ""
        }
    }

    private func commit() {
        var record = expense ?? Expense(date: DayString.today(date), name: "",
                                        category: category, amount: 0)
        record.date = DayString.today(date)
        record.name = name.trimmingCharacters(in: .whitespaces)
        record.category = category
        record.amount = Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0
        store.save(record)
        dismiss()
    }
}
