import Foundation

/// Períodos del panel. Mismas opciones y mismos cortes que el `<select>` de la web.
public enum Period: String, CaseIterable, Identifiable, Sendable {
    case day, week, month, quarter, semester, year, all, custom

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .day: return "Hoy"
        case .week: return "Esta semana"
        case .month: return "Este mes"
        case .quarter: return "Trimestre"
        case .semester: return "Semestre"
        case .year: return "Año"
        case .all: return "Todo"
        case .custom: return "Personalizado"
        }
    }

    /// La semana empieza en lunes, como en la web (`(getDay()+6)%7`).
    public func range(now: Date = Date(), from: Date? = nil, to: Date? = nil) -> ClosedRange<Date> {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        cal.firstWeekday = 2
        let far = cal.date(from: DateComponents(year: 2999, month: 12, day: 31)) ?? now
        let startOfDay = cal.startOfDay(for: now)

        func startOf(month: Int, year: Int) -> Date {
            cal.date(from: DateComponents(year: year, month: month, day: 1)) ?? startOfDay
        }
        let comps = cal.dateComponents([.year, .month], from: now)
        let year = comps.year ?? 2026
        let month = comps.month ?? 1

        switch self {
        case .day:
            return startOfDay...far
        case .week:
            let weekday = (cal.component(.weekday, from: now) + 5) % 7  // lunes = 0
            let start = cal.date(byAdding: .day, value: -weekday, to: startOfDay) ?? startOfDay
            return start...far
        case .month:
            return startOf(month: month, year: year)...far
        case .quarter:
            return startOf(month: ((month - 1) / 3) * 3 + 1, year: year)...far
        case .semester:
            return startOf(month: month <= 6 ? 1 : 7, year: year)...far
        case .year:
            return startOf(month: 1, year: year)...far
        case .all:
            return (cal.date(from: DateComponents(year: 1900, month: 1, day: 1)) ?? startOfDay)...far
        case .custom:
            let start = from.map { cal.startOfDay(for: $0) }
                ?? cal.date(from: DateComponents(year: 1900, month: 1, day: 1)) ?? startOfDay
            let end = to.map { cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: $0))?
                .addingTimeInterval(-1) ?? $0 } ?? far
            return start...max(start, end)
        }
    }
}

/// Los números del panel. Las fórmulas son las mismas que en app.js: si cambian
/// aquí y no allá, el teléfono y la laptop mostrarían ganancias distintas con
/// los mismos datos.
public struct Metrics: Sendable {
    public var salesTotal: Double = 0
    /// Lo que costó hacer lo vendido (ingredientes).
    public var productionCost: Double = 0
    /// Lo que se resta de la ganancia: gastos sueltos más recurrentes.
    public var expensesTotal: Double = 0
    /// Lo invertido en este período, y desde el principio.
    public var investmentPeriod: Double = 0
    public var investmentEver: Double = 0
    public var recurringTotal: Double = 0
    public var oneOffTotal: Double = 0
    public var profit: Double = 0
    public var salesCount: Int = 0
    public var unitsSold: Double = 0
    public var averageTicket: Double = 0
    public var bestSale: Sale?

    public var marginPercent: Double {
        salesTotal > 0 ? profit / salesTotal * 100 : 0
    }

    /// "Te quedan 62 centavos de cada dólar" — la frase que ve ella.
    public var marginSentence: String {
        guard salesTotal > 0 else { return "Aún sin ventas" }
        return "Te quedan \(Int(marginPercent.rounded())) centavos de cada dólar"
    }
}

public struct TopProduct: Identifiable, Sendable {
    public var id: String { name }
    public let name: String
    public let qty: Double
    public let total: Double
}

public struct MonthBar: Identifiable, Sendable {
    public var id: Int { index }
    public let index: Int
    public let label: String
    public let value: Double
}

public enum Analytics {

    public static func sales(_ doc: SyncDocument) -> [Sale] {
        doc.live(.sales).map(Sale.init(record:))
            .sorted { $0.date > $1.date }
    }
    public static func expenses(_ doc: SyncDocument) -> [Expense] {
        doc.live(.expenses).map(Expense.init(record:))
            .sorted { $0.date > $1.date }
    }
    public static func recipes(_ doc: SyncDocument) -> [Recipe] {
        doc.live(.recipes).map(Recipe.init(record:))
    }
    public static func ingredients(_ doc: SyncDocument) -> [Ingredient] {
        doc.live(.ingredients).map(Ingredient.init(record:))
    }

    public static func inRange(_ day: String, _ range: ClosedRange<Date>) -> Bool {
        guard let d = DayString.date(from: day) else { return false }
        return range.contains(d)
    }

    public static func metrics(doc: SyncDocument, range: ClosedRange<Date>) -> Metrics {
        let recipesById = Dictionary(
            recipes(doc).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let periodSales = sales(doc).filter { inRange($0.date, range) }
        // Los gastos NO se filtran por fecha aquí: un gasto recurrente se anota
        // una vez y vale para todos los períodos siguientes, así que filtrarlo
        // por su fecha lo haría desaparecer del mes que viene y la ganancia
        // saldría mejor de lo que es. De eso se encarga Investment.
        let todos = expenses(doc)

        var m = Metrics()
        m.salesTotal = periodSales.reduce(0) { $0 + $1.total }
        m.productionCost = periodSales.reduce(0) { acc, sale in
            guard let r = recipesById[sale.recipeId] else { return acc }
            return acc + r.unitCost * sale.qty
        }
        let g = Investment.breakdown(todos, from: range.lowerBound, to: range.upperBound)
        m.expensesTotal = g.operating
        m.investmentPeriod = g.investment
        m.investmentEver = Investment.investedEver(todos)
        m.recurringTotal = g.recurring
        m.oneOffTotal = g.oneOff
        // La inversión NO se resta: una batidora se compra una vez y trabaja
        // durante años. Restarla del mes haría parecer un desastre un mes bueno.
        m.profit = m.salesTotal - m.productionCost - g.operating
        m.salesCount = periodSales.count
        m.unitsSold = periodSales.reduce(0) { $0 + $1.qty }
        m.averageTicket = periodSales.isEmpty ? 0 : m.salesTotal / Double(periodSales.count)
        m.bestSale = periodSales.max { $0.total < $1.total }
        return m
    }

    public static func topProducts(doc: SyncDocument, range: ClosedRange<Date>, limit: Int = 5) -> [TopProduct] {
        var totals: [String: (qty: Double, total: Double)] = [:]
        for sale in sales(doc) where inRange(sale.date, range) {
            let key = sale.product.isEmpty ? "Sin nombre" : sale.product
            var entry = totals[key] ?? (0, 0)
            entry.qty += sale.qty
            entry.total += sale.total
            totals[key] = entry
        }
        return totals.map { TopProduct(name: $0.key, qty: $0.value.qty, total: $0.value.total) }
            .sorted { $0.total > $1.total }
            .prefix(limit)
            .map { $0 }
    }

    /// Los últimos seis meses, siempre — el gráfico no depende del filtro,
    /// igual que en la web.
    public static func monthlyBars(doc: SyncDocument, now: Date = Date()) -> [MonthBar] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "es")
        fmt.dateFormat = "LLL"

        var bars: [MonthBar] = []
        var values = [Double](repeating: 0, count: 6)

        for sale in sales(doc) {
            guard let d = DayString.date(from: sale.date) else { continue }
            let a = cal.dateComponents([.year, .month], from: d)
            let b = cal.dateComponents([.year, .month], from: now)
            let diff = ((b.year ?? 0) - (a.year ?? 0)) * 12 + ((b.month ?? 0) - (a.month ?? 0))
            if diff >= 0 && diff < 6 { values[5 - diff] += sale.total }
        }

        for i in 0..<6 {
            let date = cal.date(byAdding: .month, value: -(5 - i), to: now) ?? now
            var label = fmt.string(from: date).replacingOccurrences(of: ".", with: "")
            label = label.prefix(1).uppercased() + label.dropFirst()
            bars.append(MonthBar(index: i, label: label, value: values[i]))
        }
        return bars
    }

    /// Los avisos del panel: mismas reglas y mismo orden que `renderAlerts()`.
    public static func alerts(doc: SyncDocument) -> [(title: String, detail: String)] {
        var out: [(String, String)] = []
        let allRecipes = recipes(doc)

        if allRecipes.isEmpty {
            out.append(("Crea tu primer postre", "Así sabrás exactamente cuánto te cuesta hacerlo."))
        } else {
            if let sinPrecio = allRecipes.first(where: { !$0.hasPrice }) {
                out.append(("Falta el precio de \(sinPrecio.name)",
                            "Ponle precio para saber cuánto ganas con cada porción."))
            }
            if let low = allRecipes.first(where: { $0.hasPrice && $0.margin < 55 }) {
                out.append(("Margen bajo en \(low.name)",
                            "Solo ganas \(Int(low.margin.rounded())) centavos por dólar. "
                            + "Cobrando \(Money.format(low.suggestedPrice())) por porción estarías mejor."))
            }
            if let neg = allRecipes.first(where: { $0.losesMoney }) {
                out.append(("Estás perdiendo con \(neg.name)",
                            "Cobras menos de lo que te cuesta hacerlo. Sube el precio."))
            }
        }
        if doc.live(.sales).isEmpty {
            out.append(("Anota tus ventas", "Así verás cuánto ganas de verdad y qué se vende más."))
        }
        if doc.live(.ingredients).isEmpty {
            out.append(("Anota lo que compras",
                        "Agrega tus ingredientes una vez y los reutilizas en cada receta."))
        }
        return out
    }

    /// Utilidad de una venta: lo cobrado menos lo que costó hacerlo.
    public static func profit(of sale: Sale, recipes: [String: Recipe]) -> Double {
        let cost = recipes[sale.recipeId].map { $0.unitCost * sale.qty } ?? 0
        return sale.total - cost
    }
}

/// La calculadora de precios de la pestaña de recetas.
public enum PriceCalculator {
    public enum Mode: String, CaseIterable, Sendable {
        /// "De cada venta quiero ganar X%" (margen sobre el precio).
        case margin
        /// "Al costo le sumo X%" (recargo sobre el costo).
        case markup

        public var label: String {
            self == .margin ? "Ganar % del precio" : "Sumar % al costo"
        }
        public var fieldLabel: String {
            self == .margin ? "De cada venta quiero ganar (%)" : "Al costo le sumo (%)"
        }
    }

    public struct Result: Sendable {
        public var price: Double
        public var caption: String
        public var note: String
        public var isWarning: Bool
        /// El porcentaje ya corregido, si el que se escribió era imposible.
        public var clampedPercent: Double
    }

    public static func compute(cost: Double, percent: Double, mode: Mode) -> Result {
        let cost = max(0, cost)
        var pct = percent.isFinite ? percent : 0

        switch mode {
        case .markup:
            pct = max(0, pct)
            let price = cost * (1 + pct / 100)
            let equivalent = price > 0 ? (price - cost) / price * 100 : 0
            return Result(
                price: price,
                caption: "Precio cobrando \(Int(pct))% sobre el costo",
                note: cost > 0
                    ? "Ganas \(Money.format(price - cost)) por porción: \(Int(equivalent.rounded())) centavos de cada dólar que cobras."
                    : "Escribe cuánto te cuesta una porción.",
                isWarning: false,
                clampedPercent: pct)

        case .margin:
            var note = ""
            var warn = false
            if pct >= 100 {
                pct = 99
                note = "Para ganar el 100% del precio, hacer el postre tendría que costarte $0. "
                     + "Lo dejé en 99%. Si lo que quieres es cobrar el doble de lo que te cuesta, "
                     + "toca “Sumar % al costo” y escribe 100."
                warn = true
            } else if pct < 0 {
                pct = 0
            }
            let price = cost / (1 - pct / 100)
            if note.isEmpty {
                if pct >= 90 {
                    note = "Es un precio alto. Revisa que la gente lo siga comprando."; warn = true
                } else if cost > 0 && pct > 0 && pct < 40 {
                    note = "Ganas poco. Recuerda sumar el gas, las cajas y tu tiempo."; warn = true
                } else if cost > 0 {
                    note = "Ganas \(Money.format(price - cost)) por porción."
                } else {
                    note = "Escribe cuánto te cuesta una porción."
                }
            }
            return Result(price: price, caption: "Precio mínimo recomendado",
                          note: note, isWarning: warn, clampedPercent: pct)
        }
    }
}
