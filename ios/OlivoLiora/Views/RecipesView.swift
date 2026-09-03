import SwiftUI
import OlivoLioraCore

struct RecipesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var editing: Recipe?
    @State private var creating = false
    @State private var calcCost = ""
    @State private var calcPercent = "65"
    @State private var calcMode: PriceCalculator.Mode = .margin
    /// La receta cuyo precio se está calculando en la ventana.
    @State private var calcFor: Recipe?
    /// Etiqueta por la que se está filtrando. Vacío = todas.
    @State private var badgeFilter = ""

    private var filtered: [Recipe] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.recipes.filter { recipe in
            let matchesText = q.isEmpty || recipe.name.lowercased().contains(q)
            guard matchesText else { return false }
            guard !badgeFilter.isEmpty else { return true }
            return store.badges(of: recipe).badges.contains { $0.key == badgeFilter }
        }
    }

    var body: some View {
        // `List` y no `ScrollView`: `.swipeActions` sólo tiene efecto dentro de
        // una List. La calculadora y los consejos son filas más, sin adornos.
        List {
            Group {
                ScreenHeader(
                    title: "Recetas",
                    detail: Labels.count(shown: filtered.count, total: store.recipes.count,
                                         singular: "receta", plural: "recetas"))
                badgeFilterRow

                if filtered.isEmpty {
                    EmptyHint(text: search.isEmpty
                        ? "Crea tu primer postre y calcula en un minuto cuánto cobrar."
                        : "Ninguna receta coincide con tu búsqueda.")
                }
            }
            .plainRow()

            ForEach(filtered) { recipe in
                RecipeCard(
                    recipe: recipe,
                    macros: store.macros(of: recipe),
                    badges: store.badges(of: recipe),
                    onDuplicate: { store.duplicate(recipe) },
                    onUseInCalculator: { calcFor = recipe })
                    .contentShape(Rectangle())
                    .onTapGesture { editing = recipe }
                    .plainRow()
                    .rowActions(onEdit: { editing = recipe },
                                onDelete: { store.delete(id: recipe.id, from: .recipes) })
            }

            PriceCalculatorPanel(cost: $calcCost, percent: $calcPercent, mode: $calcMode)
                .plainRow(vertical: 8)
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(Theme.cream)
        .scrollIndicators(.hidden)
        .searchable(text: $search, prompt: "Buscar receta…")
        .overlay(alignment: .bottomTrailing) {
            AddButton(label: "Nueva receta") { creating = true }
                .padding(.trailing, 18).padding(.bottom, 18)
        }
        .sheet(isPresented: $creating) { RecipeEditor(recipe: nil) }
        .sheet(item: $editing) { RecipeEditor(recipe: $0) }
        .sheet(item: $calcFor) { receta in
            PriceCalculatorSheet(recipe: receta) { precio in
                var actualizada = receta
                actualizada.price = (precio * 100).rounded() / 100
                store.save(actualizada)
            }
        }
    }

    /// Chips para filtrar por dieta. Sólo salen las etiquetas que alguna receta
    /// tiene, así que tocar cualquiera siempre devuelve algo.
    @ViewBuilder
    private var badgeFilterRow: some View {
        let available = store.availableBadges
        if !available.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(available, id: \.badge.key) { item in
                        Button {
                            badgeFilter = (badgeFilter == item.badge.key) ? "" : item.badge.key
                        } label: {
                            HStack(spacing: 4) {
                                Text(item.badge.label)
                                Text("\(item.count)").opacity(0.6)
                            }
                            .font(Theme.rounded(12, .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(badgeFilter == item.badge.key ? Theme.green : Color.white,
                                        in: Capsule())
                            .foregroundStyle(badgeFilter == item.badge.key ? .white : Theme.muted)
                            .overlay(Capsule().stroke(
                                badgeFilter == item.badge.key ? Theme.green : Theme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                    if !badgeFilter.isEmpty {
                        Button("Ver todas") { badgeFilter = "" }
                            .font(Theme.rounded(12, .semibold))
                            .foregroundStyle(Theme.green)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }
}

// MARK: - Tarjeta de receta

struct RecipeCard: View {
    let recipe: Recipe
    let macros: RecipeMacros
    let badges: BadgeResult
    let onDuplicate: () -> Void
    let onUseInCalculator: () -> Void

    /// El color del distintivo dice de un vistazo si el precio está bien:
    /// verde a partir del 60% de margen, ámbar entre 45 y 60, rojo por debajo.
    private var badge: (text: String, bg: Color, fg: Color) {
        guard recipe.hasPrice else {
            return ("Falta ponerle precio", Color(hex: 0xFDF0DC), Color(hex: 0x96601F))
        }
        let m = recipe.margin
        let text = "Ganas \(Int(m.rounded()))% de cada venta"
        if m >= 60 { return (text, Color(hex: 0xE4F0E6), Color(hex: 0x2F6B45)) }
        if m >= 45 { return (text, Color(hex: 0xFDF0DC), Color(hex: 0x96601F)) }
        return (text, Color(hex: 0xF9E3DF), Theme.red)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let url = URL(string: recipe.photo), recipe.photo.hasPrefix("http") {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Rectangle().fill(Theme.sage.opacity(0.5))
                }
                .frame(height: 145)
                .frame(maxWidth: .infinity)
                .clipped()
            }

            VStack(alignment: .leading, spacing: 12) {
                Chip(text: "\(Quantity.pretty(recipe.yield)) porciones")

                VStack(alignment: .leading, spacing: 3) {
                    Text(recipe.name)
                        .font(Theme.rounded(18, .semibold))
                        .foregroundStyle(Theme.ink)
                    Text("\(recipe.lines.count) ingredientes · costo por porción \(Money.format(recipe.unitCost))")
                        .font(Theme.rounded(12))
                        .foregroundStyle(Theme.muted)
                }

                HStack(spacing: 8) {
                    miniStat("Costo total", Money.format(recipe.totalCost))
                    miniStat("Precio / porción", Money.format(recipe.price))
                }

                Text(badge.text)
                    .font(Theme.rounded(11, .heavy))
                    .foregroundStyle(badge.fg)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(badge.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                if recipe.hasPrice && recipe.margin < 60 {
                    Text("Cobrando \(Money.format(recipe.suggestedPrice())) ganarías más")
                        .font(Theme.rounded(12))
                        .foregroundStyle(Theme.muted)
                }

                // Sólo aparece si hay datos nutricionales, y dice cuántos
                // ingredientes pudo contar cuando faltan.
                if let sentence = macros.sentence {
                    Text(sentence)
                        .font(Theme.rounded(12, .bold))
                        .foregroundStyle(Theme.green)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(hex: 0xEEF4EA),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }

                if !badges.badges.isEmpty {
                    // Envolvemos en filas: pueden salir varias etiquetas.
                    FlowChips(badges: badges.badges)
                } else if badges.reason == .missingData, macros.needsNutrition {
                    HStack(spacing: 6) {
                        FaltaBadge(texto: "faltan \(macros.missing) de \(macros.total)")
                        Text("por completar su información nutricional")
                            .font(Theme.rounded(11))
                            .foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                HStack(spacing: 4) {
                    cardAction("Duplicar", action: onDuplicate)
                    cardAction("Calcular precio", action: onUseInCalculator)
                    Spacer()
                }
                .padding(.top, 2)
            }
            .padding(16)
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
            .stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 12, y: 6)
    }

    private func miniStat(_ caption: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(caption).font(Theme.rounded(11)).foregroundStyle(Theme.muted)
            Text(value).font(Theme.rounded(15, .bold)).foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(Color(hex: 0xF8F7F1), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func cardAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(Theme.rounded(13, .bold))
            .foregroundStyle(Theme.green)
            .padding(.vertical, 8).padding(.horizontal, 8)
            .buttonStyle(.plain)
    }
}

// MARK: - Calculadora

struct PriceCalculatorPanel: View {
    @Binding var cost: String
    @Binding var percent: String
    @Binding var mode: PriceCalculator.Mode
    /// Cuando se abre desde una receta: su nombre, y qué hacer con el precio.
    var recipeName: String? = nil
    var onApply: ((Double) -> Void)? = nil

    private var result: PriceCalculator.Result {
        PriceCalculator.compute(
            cost: Double(cost.replacingOccurrences(of: ",", with: ".")) ?? 0,
            percent: Double(percent.replacingOccurrences(of: ",", with: ".")) ?? 0,
            mode: mode)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("¿Cuánto cobrar?").font(Theme.title(21)).foregroundStyle(Theme.ink)
            if let n = recipeName {
                Text("Una porción de \(n) te cuesta \(Money.format(Double(cost.replacingOccurrences(of: ",", with: ".")) ?? 0)).")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Escribe cuánto te cuesta hacer una porción y cuánto quieres ganar.")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
            }

            Picker("Modo", selection: $mode) {
                ForEach(PriceCalculator.Mode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            MoneyField(label: "Costo unitario", value: $cost)

            VStack(alignment: .leading, spacing: 6) {
                Text(mode.fieldLabel).font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                HStack(spacing: 4) {
                    TextField("65", text: $percent)
                        .keyboardType(.numberPad)
                        .font(Theme.rounded(17))
                    Text("%").font(Theme.rounded(17)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 12)
                .frame(height: 46)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))

                // El deslizador es la forma rápida; el campo, la exacta. Los
                // dos escriben en el mismo sitio.
                Slider(value: Binding(
                    get: { min(Double(percent.replacingOccurrences(of: ",", with: ".")) ?? 0,
                               mode == .margin ? 95 : 300) },
                    set: { percent = String(Int($0.rounded())) }
                ), in: 0...(mode == .margin ? 95 : 300), step: 1)
                .tint(Theme.green)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(result.caption)
                    .font(Theme.rounded(12))
                    .foregroundStyle(.white.opacity(0.75))
                Text(Money.format(result.price))
                    .font(Theme.rounded(27, .bold))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(17)
            .background(Theme.green, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .animation(.snappy(duration: 0.25), value: result.price)

            if !result.note.isEmpty {
                Text(result.note)
                    .font(Theme.rounded(12, .bold))
                    .foregroundStyle(result.isWarning ? Theme.red : Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Sólo cuando se abre desde una receta: el precio se le pone a esa
            // receta sin tener que entrar al editor.
            if let apply = onApply {
                Button("Ponerle este precio") { apply(result.price) }
                    .primaryActionStyle()
                    .frame(maxWidth: .infinity)
                    .disabled(!(result.price > 0))
            }
        }
        .padding(18)
        .background(
            LinearGradient(colors: [Color(hex: 0xF6ECEA), Color(hex: 0xFAF4EC)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
            .stroke(Color(hex: 0xECDCD8), lineWidth: 1))
    }
}

/// La calculadora en una ventana, abierta desde una receta.
///
/// Es el MISMO panel de la pantalla de recetas — los mismos dos modos, el mismo
/// deslizador — para que no haya que aprender dos cosas que hacen lo mismo. Se
/// abre con el costo de esa receta ya puesto, que es el dato que hace falta y
/// el que nadie se sabe de memoria.
struct PriceCalculatorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let recipe: Recipe
    let onApply: (Double) -> Void

    @State private var cost: String
    @State private var percent = "65"
    @State private var mode: PriceCalculator.Mode = .margin

    init(recipe: Recipe, onApply: @escaping (Double) -> Void) {
        self.recipe = recipe
        self.onApply = onApply
        _cost = State(initialValue: String(format: "%.2f", recipe.unitCost))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                PriceCalculatorPanel(cost: $cost, percent: $percent, mode: $mode,
                                     recipeName: recipe.name) { precio in
                    onApply(precio)
                    dismiss()
                }
                .padding(16)
            }
            .background(Theme.cream)
            .scrollIndicators(.hidden)
            .navigationTitle("¿Cuánto cobrar?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }.tint(Theme.muted)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
/// Etiquetas de dieta en varias filas, sin que se salgan de la tarjeta.
struct FlowChips: View {
    let badges: [DietBadge]

    var body: some View {
        // Dos por fila: los nombres son cortos y así no hay que medir texto.
        let rows = stride(from: 0, to: badges.count, by: 2).map { i in
            Array(badges[i..<min(i + 2, badges.count)])
        }
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 5) {
                    ForEach(row) { badge in
                        Text(badge.label)
                            .font(Theme.rounded(11, .heavy))
                            .foregroundStyle(Color(hex: 0x2F6B45))
                            .lineLimit(1)
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(Color(hex: 0xEEF4EA), in: Capsule())
                            .overlay(Capsule().stroke(Color(hex: 0xD7E6D5), lineWidth: 1))
                            .accessibilityLabel("\(badge.name). \(badge.detail)")
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
