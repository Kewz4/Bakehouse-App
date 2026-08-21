import SwiftUI
import OlivoLioraCore

struct IngredientsView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var editing: Ingredient?
    @State private var creating = false

    private var filtered: [Ingredient] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? store.ingredients
            : store.ingredients.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        ListScaffold(
            eyebrow: "Lo que compras",
            title: "Ingredientes",
            searchPrompt: "Buscar ingrediente…",
            search: $search,
            addLabel: "Nuevo ingrediente",
            onAdd: { creating = true },
            isEmpty: filtered.isEmpty,
            emptyText: search.isEmpty
                ? "Guarda cada ingrediente una vez y podrás usarlo en todas tus recetas."
                : "Ningún ingrediente coincide con tu búsqueda."
        ) {
            ForEach(filtered) { ing in
                let short = Units.info(ing.unitSingle).short
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(ing.name)
                            .font(Theme.rounded(16, .semibold))
                            .foregroundStyle(Theme.ink)
                        Text("\(ing.unit) de \(Quantity.pretty(ing.quantity)) \(short) · \(Money.format(ing.price))")
                            .font(Theme.rounded(12))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Money.format(ing.displayUnitCost))
                            .font(Theme.rounded(16, .heavy))
                            .foregroundStyle(Theme.ink)
                        Text("por \(short)")
                            .font(Theme.rounded(11))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .padding(14)
                .panelCard()
                .contentShape(Rectangle())
                .onTapGesture { editing = ing }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        store.delete(id: ing.id, from: .ingredients)
                    } label: { Label("Borrar", systemImage: "trash") }
                }
            }
        }
        .sheet(isPresented: $creating) { IngredientEditor(ingredient: nil) }
        .sheet(item: $editing) { IngredientEditor(ingredient: $0) }
    }
}

struct IngredientEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let ingredient: Ingredient?

    @State private var name = ""
    @State private var unit = ""
    @State private var quantity = ""
    @State private var unitSingle = "g"
    @State private var price = ""
    @State private var loaded = false

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !unit.trimmingCharacters(in: .whitespaces).isEmpty
            && Quantity.parse(quantity) > 0
            && (Double(price.replacingOccurrences(of: ",", with: ".")) ?? -1) >= 0
    }

    var body: some View {
        EditorScaffold(title: ingredient == nil ? "Nuevo ingrediente" : "Editar ingrediente",
                       canSave: canSave, onSave: commit) {
            PlainField(label: "Nombre", placeholder: "ej. Harina", text: $name)
            PlainField(label: "¿Cómo lo compras?", placeholder: "ej. bolsa, caja, botella", text: $unit)
            QuantityField(label: "¿Cuánto trae?", text: $quantity,
                          unitShort: Units.info(unitSingle).short)

            VStack(alignment: .leading, spacing: 6) {
                Text("¿En qué se mide?").font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                Picker("Unidad", selection: $unitSingle) {
                    ForEach(Units.all, id: \.key) { u in Text(u.name).tag(u.key) }
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

            MoneyField(label: "¿Cuánto te costó?", value: $price)

            Text("Ejemplo: compras una bolsa de harina de 5 libras por $6.50 → escribes “bolsa”, 5 y eliges “libras”. Después en tus recetas puedes usar gramos: la cuenta se hace sola.")
                .font(Theme.rounded(12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if canSave {
                let preview = previewIngredient
                HStack {
                    Text("Te sale a")
                        .font(Theme.rounded(13))
                        .foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    Text("\(Money.format(preview.displayUnitCost)) por \(Units.info(unitSingle).short)")
                        .font(Theme.rounded(18, .bold))
                        .foregroundStyle(.white)
                }
                .padding(16)
                .background(Theme.green, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
        }
        .onAppear(perform: load)
    }

    private var previewIngredient: Ingredient {
        Ingredient(name: name, unit: unit,
                   quantity: Quantity.parse(quantity),
                   price: Double(price.replacingOccurrences(of: ",", with: ".")) ?? 0,
                   unitSingle: unitSingle)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let i = ingredient {
            name = i.name
            unit = i.unit
            quantity = Quantity.pretty(i.quantity)
            unitSingle = i.unitSingle
            price = i.price > 0 ? String(format: "%.2f", i.price) : ""
        }
    }

    private func commit() {
        var record = ingredient ?? Ingredient(name: "", unit: "", quantity: 1,
                                              price: 0, unitSingle: unitSingle)
        record.name = name.trimmingCharacters(in: .whitespaces)
        record.unit = unit.trimmingCharacters(in: .whitespaces)
        record.quantity = Quantity.parse(quantity)
        record.unitSingle = unitSingle
        record.price = Double(price.replacingOccurrences(of: ",", with: ".")) ?? 0
        store.save(record)
        dismiss()
    }
}
