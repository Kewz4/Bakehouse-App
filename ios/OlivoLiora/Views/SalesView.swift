import SwiftUI
import OlivoLioraCore

struct SalesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var editing: Sale?
    @State private var creating = false

    private var filtered: [Sale] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? store.sales
            : store.sales.filter { $0.product.lowercased().contains(q) }
    }

    var body: some View {
        ListScaffold(
            title: "Ventas",
            // El período sí hace falta decirlo: esta lista está filtrada por él
            // y el selector está en la otra pestaña, así que desde aquí no se
            // vería por ningún lado de dónde salen (o no salen) estas ventas.
            detail: Labels.join(
                store.period.label,
                Labels.count(shown: filtered.count, total: store.sales.count,
                             singular: "venta", plural: "ventas")),
            searchPrompt: "Buscar venta…",
            search: $search,
            addLabel: "Registrar venta",
            onAdd: { creating = true },
            isEmpty: filtered.isEmpty,
            emptyText: search.isEmpty
                ? "Aún no hay ventas aquí. Anota tu primera venta y verás cuánto ganaste."
                : "Ninguna venta coincide con tu búsqueda."
        ) {
            ForEach(filtered) { sale in
                SaleRow(sale: sale, profit: store.profit(of: sale))
                    .contentShape(Rectangle())
                    .onTapGesture { editing = sale }
                    .plainRow()
                    .rowActions(onEdit: { editing = sale },
                                onDelete: { store.delete(id: sale.id, from: .sales) })
            }
        }
        .sheet(isPresented: $creating) { SaleEditor(sale: nil) }
        .sheet(item: $editing) { SaleEditor(sale: $0) }
    }
}

private struct SaleRow: View {
    let sale: Sale
    let profit: Double

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(sale.product)
                    .font(Theme.rounded(16, .semibold))
                    .foregroundStyle(Theme.ink)
                Text("\(DayString.short(sale.date)) · \(Quantity.pretty(sale.qty)) und.")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(Money.format(sale.total))
                    .font(Theme.rounded(16, .heavy))
                    .foregroundStyle(Theme.ink)
                Text(Money.format(profit))
                    .font(Theme.rounded(12, .bold))
                    .foregroundStyle(profit >= 0 ? Theme.green : Theme.red)
            }
        }
        .padding(14)
        .panelCard()
    }
}

struct SaleEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let sale: Sale?

    @State private var date = Date()
    @State private var product = ""
    @State private var qty = "1"
    @State private var total = ""
    @State private var recipeId = ""
    @State private var loaded = false

    private var selectedRecipe: Recipe? { store.recipe(id: recipeId) }

    private var hint: String {
        guard let r = selectedRecipe else { return "" }
        let n = max(Quantity.parse(qty), 1)
        return "Con tu precio serían \(Money.format(r.price * n)) · "
             + "hacerlos te cuesta unos \(Money.format(r.unitCost * n))"
    }

    private var canSave: Bool {
        !product.trimmingCharacters(in: .whitespaces).isEmpty
            && (Double(total.replacingOccurrences(of: ",", with: ".")) ?? 0) > 0
            && Quantity.parse(qty) > 0
    }

    var body: some View {
        EditorScaffold(title: sale == nil ? "Registrar venta" : "Editar venta",
                       canSave: canSave, onSave: commit) {
            DatePicker("Fecha", selection: $date, displayedComponents: .date)
                .font(Theme.rounded(15))
                .environment(\.locale, Locale(identifier: "es"))

            VStack(alignment: .leading, spacing: 6) {
                Text("Producto").font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                Picker("Producto", selection: $recipeId) {
                    Text("Venta general").tag("")
                    ForEach(store.recipes) { r in
                        Text("\(r.name) · \(Money.format(r.price))/porción").tag(r.id)
                    }
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

            PlainField(label: "Descripción", placeholder: "ej. Caja de brownies", text: $product)
            QuantityField(label: "Cantidad", text: $qty)
            MoneyField(label: "Total cobrado", value: $total)

            if !hint.isEmpty {
                Text(hint)
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear(perform: load)
        .onChange(of: recipeId) { _, _ in applyRecipeDefaults() }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let s = sale {
            date = DayString.date(from: s.date) ?? Date()
            product = s.product
            qty = Quantity.pretty(s.qty)
            total = s.total > 0 ? String(format: "%.2f", s.total) : ""
            recipeId = s.recipeId
        }
    }

    /// Al elegir un postre se rellenan el nombre y el total sugerido, para que
    /// registrar una venta sea un par de toques.
    private func applyRecipeDefaults() {
        guard let r = selectedRecipe else { return }
        if product.trimmingCharacters(in: .whitespaces).isEmpty { product = r.name }
        let n = max(Quantity.parse(qty), 1)
        let suggested = r.price * n
        if suggested > 0 { total = String(format: "%.2f", suggested) }
    }

    private func commit() {
        var record = sale ?? Sale(date: DayString.today(date), product: "", qty: 1, total: 0)
        record.date = DayString.today(date)
        record.product = product.trimmingCharacters(in: .whitespaces)
        record.qty = Quantity.parse(qty)
        record.total = Double(total.replacingOccurrences(of: ",", with: ".")) ?? 0
        record.recipeId = recipeId
        store.save(record)
        dismiss()
    }
}
