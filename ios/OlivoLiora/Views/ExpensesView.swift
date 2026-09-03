import SwiftUI
import OlivoLioraCore

struct ExpensesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var editing: Expense?
    @State private var creating = false

    /// Se mira la lista ENTERA, no la filtrada por fecha: un gasto recurrente
    /// se anota una vez y sigue valiendo los meses siguientes, así que
    /// filtrarlo por su fecha lo haría desaparecer.
    private var filtered: [Expense] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.allExpenses.filter { e in
            let coincide = q.isEmpty || e.name.lowercased().contains(q)
                || e.category.lowercased().contains(q)
            guard coincide else { return false }
            return e.kind == .recurrente || store.amountInPeriod(e) > 0
        }
    }

    var body: some View {
        ListScaffold(
            title: "Inversión",
            detail: Labels.count(shown: filtered.count, total: filtered.count,
                                 singular: "movimiento", plural: "movimientos"),
            searchPrompt: "Buscar…",
            search: $search,
            addLabel: "Registrar",
            onAdd: { creating = true },
            isEmpty: filtered.isEmpty,
            emptyText: search.isEmpty
                ? "Aquí van tus gastos y tus inversiones: el gas, las cajas, y también la batidora."
                : "Nada coincide con tu búsqueda."
        ) {
            PeriodBar().plainRow()

            totals.plainRow()

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
                            Chip(text: expense.kind.label)
                            if expense.kind == .recurrente {
                                Text(expense.frequency.label)
                                    .font(Theme.rounded(11, .semibold))
                                    .foregroundStyle(Theme.muted)
                            } else {
                                Chip(text: expense.category)
                            }
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        let enPeriodo = store.amountInPeriod(expense)
                        Text(Money.format(enPeriodo > 0 ? enPeriodo : expense.amount))
                            .font(Theme.rounded(16, .heavy))
                            // La inversión no es una pérdida: es dinero puesto
                            // en el negocio. No se pinta en rojo.
                            .foregroundStyle(expense.kind == .inversion ? Theme.ink : Theme.red)
                        let veces = store.occurrencesInPeriod(expense)
                        if veces > 1 {
                            Text("\(Money.format(expense.amount)) cada vez")
                                .font(Theme.rounded(11))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
                .padding(14)
                .panelCard()
                .contentShape(Rectangle())
                .onTapGesture { editing = expense }
                .plainRow()
                .rowActions(onEdit: { editing = expense },
                            onDelete: { store.delete(id: expense.id, from: .expenses) })
            }
        }
        .sheet(isPresented: $creating) { ExpenseEditor(expense: nil) }
        .sheet(item: $editing) { ExpenseEditor(expense: $0) }
    }

    /// Los cuatro números de arriba.
    ///
    /// "Invertido en total" no mira el período a propósito: lo que se quiere
    /// saber es cuánto lleva puesto en el negocio desde el principio, y eso no
    /// cambia porque se mire un mes u otro.
    private var totals: some View {
        let m = store.metrics
        return VStack(spacing: 10) {
            // La respuesta a "¿cuánto llevamos metido aquí?" va sola y a lo
            // ancho: es la pregunta, no una tarjeta más de la fila.
            MetricTile(caption: "Gastado desde que empezamos",
                       value: Money.format(m.spentEver),
                       note: m.startedOn.map { "Todo, desde el \(DayString.short(DayString.today($0)))" }
                             ?? "Todavía no hay nada anotado",
                       destacada: true)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10),
                                GridItem(.flexible(), spacing: 10)], spacing: 10) {
            MetricTile(caption: "Invertido en total", value: Money.format(m.investmentEver),
                       note: "Maquinaria y compras de una vez")
            MetricTile(caption: "Invertido aquí", value: Money.format(m.investmentPeriod),
                       note: "Maquinaria y compras de una vez")
            MetricTile(caption: "Gastos recurrentes", value: Money.format(m.recurringTotal),
                       note: "Lo que se repite solo")
            MetricTile(caption: "Gastos sueltos", value: Money.format(m.oneOffTotal),
                       note: "Compras de este período")
            }
        }
        .padding(.bottom, 4)
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
    @State private var kind: ExpenseKind = .gasto
    @State private var frequency: ExpenseFrequency = .mensual
    @State private var cantidad = ""
    @State private var loaded = false

    /// Vacío quiere decir uno: si el campo arrancara con un "1" dentro,
    /// teclear un 2 dejaría "12".
    private var cuantos: Double {
        let n = Quantity.parse(cantidad)
        return n > 0 ? n : 1
    }

    /// Sólo se enseña cuando hay más de uno: si no, repetiría el precio.
    private var totalGastado: String? {
        let precio = Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0
        guard precio > 0, cuantos > 1 else { return nil }
        return "\(Quantity.pretty(cuantos)) × \(Money.format(precio)) = \(Money.format(precio * cuantos))"
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) > 0
    }

    var body: some View {
        EditorScaffold(title: expense == nil ? "Registrar" : "Editar",
                       canSave: canSave, onSave: commit) {
            // Tres cosas distintas que antes eran una sola. La inversión se
            // cuenta aparte y NO se resta de la ganancia del mes: una batidora
            // se compra una vez y trabaja durante años.
            Picker("Qué es", selection: $kind) {
                ForEach(ExpenseKind.allCases, id: \.self) { k in Text(k.label).tag(k) }
            }
            .pickerStyle(.segmented)
            .tint(Theme.green)

            Text(kind.detail)
                .font(Theme.rounded(12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

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

            MoneyField(label: "Precio de uno", value: $amount)

            // Dos rollos de papel a $1.25 son $2.50, pero el precio anotado
            // sigue siendo $1.25: es el que ella reconocerá la próxima vez.
            QuantityField(label: "¿Cuántos?", text: $cantidad)

            if let total = totalGastado {
                HStack {
                    Text("En total").font(Theme.rounded(13)).foregroundStyle(Theme.muted)
                    Spacer()
                    Text(total).font(Theme.rounded(18, .bold)).foregroundStyle(Theme.ink)
                }
                .padding(12)
                .background(Color(hex: 0xFDF7EF), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }

            if kind == .recurrente {
                VStack(alignment: .leading, spacing: 6) {
                    Text("¿Cada cuánto se repite?")
                        .font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                    Picker("Frecuencia", selection: $frequency) {
                        ForEach(ExpenseFrequency.allCases, id: \.self) { f in
                            Text(f.label).tag(f)
                        }
                    }
                    .pickerStyle(.segmented)
                    .tint(Theme.green)
                    Text("Se anota una vez y se cuenta solo cada período, desde la fecha de arriba. No hay que volver a escribirlo cada mes.")
                        .font(Theme.rounded(11))
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .animation(.snappy(duration: 0.22), value: kind)
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
            kind = e.kind
            frequency = e.frequency
            cantidad = e.cantidad > 1 ? Quantity.pretty(e.cantidad) : ""
        }
    }

    private func commit() {
        var record = expense ?? Expense(date: DayString.today(date), name: "",
                                        category: category, amount: 0)
        record.date = DayString.today(date)
        record.name = name.trimmingCharacters(in: .whitespaces)
        record.category = category
        record.amount = Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0
        record.cantidad = cuantos
        record.setKind(kind)
        record.setFrequency(frequency)
        store.save(record)
        dismiss()
    }
}
