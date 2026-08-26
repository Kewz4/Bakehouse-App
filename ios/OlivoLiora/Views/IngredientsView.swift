import SwiftUI
import PhotosUI
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
            title: "Ingredientes",
            detail: Labels.count(shown: filtered.count, total: store.ingredients.count,
                                 singular: "guardado", plural: "guardados"),
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
                        let cost = ing.displayCost
                        Text(Money.format(cost.amount))
                            .font(Theme.rounded(16, .heavy))
                            .foregroundStyle(Theme.ink)
                        Text("por \(cost.unit)")
                            .font(Theme.rounded(11))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .padding(14)
                .panelCard()
                .contentShape(Rectangle())
                .onTapGesture { editing = ing }
                .plainRow()
                .rowActions(onEdit: { editing = ing },
                            onDelete: { store.delete(id: ing.id, from: .ingredients) })
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

    // Datos nutricionales: texto mientras se edita, para poder distinguir
    // "vacío" (no se sabe) de "0" (sí se sabe, y es cero).
    @State private var macros: [Macro: String] = [:]
    /// Marcar fruta cambia qué etiqueta de azúcar sale en las recetas.
    @State private var kind: IngredientKind = .ingrediente
    @State private var showMacros = false
    @State private var scanStatus = "Toma una foto de la tabla nutricional y se llena solo."
    @State private var scanning = false
    @State private var showScanCamera = false
    @State private var scanPick: PhotosPickerItem?

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

            macrosSection

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
                    Text("\(Money.format(preview.displayCost.amount)) por \(preview.displayCost.unit)")
                        .font(Theme.rounded(18, .bold))
                        .foregroundStyle(.white)
                }
                .padding(16)
                .background(Theme.green, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
        }
        .onAppear(perform: load)
        .onChange(of: name) { _, newName in
            // Sólo se adivina mientras crea uno nuevo; si está editando, lo que
            // ella haya marcado se respeta.
            guard ingredient == nil else { return }
            // Sin categoría escrita, kind sale del nombre. Es lo que hace que
            // al escribir "fresas" se marque fruta sola.
            let probe = Ingredient(name: newName, unit: "", quantity: 1, price: 0, unitSingle: "g")
            kind = probe.kind
        }
        .onChange(of: scanPick) { _, item in Task { await scanPicked(item) } }
        .sheet(isPresented: $showScanCamera) {
            CameraPicker { image in Task { await scan(image: image) } }
                .ignoresSafeArea()
        }
    }

    // MARK: - Información nutricional (opcional)

    /// Cerrado por defecto: es opcional y la mayoría de las recetas funcionan
    /// sin esto. Quien lo use lo abre una vez.
    private var macrosSection: some View {
        DisclosureGroup(isExpanded: $showMacros) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Sirve para saber cuánta azúcar, proteína o grasa lleva cada postre.")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                if store.visionEnabled {
                    HStack(spacing: 8) {
                        Button { showScanCamera = true } label: {
                            Label("Leer con la cámara", systemImage: "camera.viewfinder")
                                .font(Theme.rounded(13, .semibold))
                        }
                        .secondaryActionStyle()
                        .disabled(scanning)

                        PhotosPicker(selection: $scanPick, matching: .images) {
                            Label("Elegir", systemImage: "photo.on.rectangle")
                                .font(Theme.rounded(13, .semibold))
                        }
                        .secondaryActionStyle()
                        .disabled(scanning)
                    }
                    HStack(spacing: 6) {
                        if scanning { ProgressView().controlSize(.small) }
                        Text(scanStatus)
                            .font(Theme.rounded(11))
                            .foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Text("Por cada \(macroBasis)")
                    .font(Theme.rounded(12, .bold))
                    .foregroundStyle(Theme.ink)

                // Lo que ella elija manda sobre lo que se adivina por el
                // nombre: una ralladura de limón se puede sacar de "fruta", y
                // una "pulpa" que no suena a nada se puede meter.
                //
                // El empaque no es un detalle de organización: una caja cuesta
                // dinero pero no se come, así que no aporta macros ni impide
                // que la receta consiga sus etiquetas de dieta.
                Picker("Qué es", selection: $kind) {
                    ForEach(IngredientKind.allCases, id: \.self) { k in
                        Text("\(k.emoji) \(k.label)").tag(k)
                    }
                }
                .pickerStyle(.segmented)
                .tint(Theme.green)
                .padding(12)
                .background(Color(hex: 0xFDF7EF), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Color(hex: 0xF0E2CD), lineWidth: 1))

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10),
                                    GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(Macro.allCases) { m in
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(m.label) (\(m.unit))")
                                .font(Theme.rounded(11, .bold))
                                .foregroundStyle(Theme.muted)
                                .lineLimit(1)
                            TextField("", text: Binding(
                                get: { macros[m] ?? "" },
                                set: { macros[m] = $0 }))
                                .keyboardType(.decimalPad)
                                .font(Theme.rounded(16))
                                .padding(.horizontal, 10)
                                .frame(height: 42)
                                .background(Color.white, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .stroke(Theme.line, lineWidth: 1))
                        }
                    }
                }
            }
            .padding(.top, 10)
        } label: {
            HStack(spacing: 8) {
                Text("Información nutricional")
                    .font(Theme.rounded(15, .bold))
                    .foregroundStyle(Theme.ink)
                Text("OPCIONAL")
                    .font(Theme.rounded(10, .semibold))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Color(hex: 0xF2EFE6), in: Capsule())
            }
        }
        .tint(Theme.green)
        .padding(14)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(Theme.line, lineWidth: 1))
    }

    /// Sobre qué cantidad se leen los macros. Para lo que se pesa son 100 g o
    /// 100 ml, como en las etiquetas. Para lo que se cuenta es UNA pieza: los
    /// datos de una banana se dicen por banana, no por cien bananas.
    /// La regla vive en el núcleo, que es donde se compara contra la web.
    private var macroBasis: String { MacroBasis.of(unitSingle).label }

    private func scanPicked(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        await scan(image: image)
    }

    private func scan(image: UIImage) async {
        // Una tabla nutricional es texto grande: con 1100 px se lee igual de
        // bien y el envío pesa la mitad, que es lo que hace que no se corte.
        guard let dataURL = RecipeEditor.dataURL(from: image, maxSide: 1100, quality: 0.8) else {
            scanStatus = "No pude usar esa foto."
            return
        }
        scanning = true
        scanStatus = "Leyendo la etiqueta…"
        defer { scanning = false }

        let result = await store.scanLabel(dataURL: dataURL,
                                           packageQty: Quantity.parse(quantity),
                                           packageUnit: unitSingle)
        guard result.ok else {
            scanStatus = result.mensaje ?? "No pude leer esa etiqueta."
            return
        }
        var filled = 0
        for m in Macro.allCases {
            if let value = result.macros[m.rawValue] ?? nil {
                macros[m] = Quantity.pretty(value)
                filled += 1
            }
        }
        scanStatus = filled > 0
            ? "Listo: \(filled) datos llenados." + (result.confianza == "baja"
                ? " Revísalos, la foto salió borrosa." : " Revisa que estén bien.")
            : "No encontré datos en esa foto."
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
            for m in Macro.allCases {
                if let v = i.macro(m),
                   let visto = MacroBasis.toShow(v, unitSingle: i.unitSingle) {
                    macros[m] = Quantity.pretty(visto)
                }
            }
            showMacros = i.hasMacros
            kind = i.kind
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
        // Un campo vacío es "no se sabe" (nil), no cero.
        for m in Macro.allCases {
            let raw = (macros[m] ?? "").trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: ",", with: ".")
            record.setMacro(m, raw.isEmpty ? nil
                : MacroBasis.toStore(Double(raw), unitSingle: unitSingle))
        }
        record.setKind(kind)
        store.save(record)
        dismiss()
    }
}
