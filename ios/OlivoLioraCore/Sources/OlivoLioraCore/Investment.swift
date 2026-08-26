import Foundation

/// Inversión y gastos.
///
/// Tres cosas distintas que antes eran una sola:
///
///   gasto       una compra suelta de este mes (el gas, unas cajas)
///   inversion   maquinaria y compras de una vez. Cuesta una vez y sirve años.
///   recurrente  algo que se repite: cada semana o cada mes, sin volver a anotarlo
///
/// La inversión NO se resta de la ganancia del mes. Una batidora de $2000 no
/// hace que un mes bueno parezca un desastre: se compra una vez y trabaja
/// durante años. Se cuenta aparte.
/// Réplica de la sección de inversión de business-core.js.
public enum ExpenseKind: String, CaseIterable, Sendable {
    case gasto, inversion, recurrente

    public var label: String {
        switch self {
        case .gasto:      return "Gasto"
        case .inversion:  return "Inversión"
        case .recurrente: return "Recurrente"
        }
    }

    public var detail: String {
        switch self {
        case .gasto:      return "Una compra de este mes"
        case .inversion:  return "Maquinaria y cosas que se compran una vez"
        case .recurrente: return "Se repite solo cada semana o cada mes"
        }
    }
}

public enum ExpenseFrequency: String, CaseIterable, Sendable {
    case semanal, mensual

    public var label: String { self == .semanal ? "Cada semana" : "Cada mes" }
}

extension Expense {
    public var kind: ExpenseKind {
        guard let raw = record["tipo"]?.stringValue, let k = ExpenseKind(rawValue: raw) else {
            return .gasto
        }
        return k
    }

    public var frequency: ExpenseFrequency {
        record["frecuencia"]?.stringValue == "semanal" ? .semanal : .mensual
    }

    public mutating func setKind(_ k: ExpenseKind) { record["tipo"] = .string(k.rawValue) }
    public mutating func setFrequency(_ f: ExpenseFrequency) {
        record["frecuencia"] = .string(f.rawValue)
    }
}

public struct ExpenseBreakdown: Sendable, Equatable {
    /// Lo que se resta de la ganancia: sueltos más recurrentes.
    public var operating: Double = 0
    public var investment: Double = 0
    public var recurring: Double = 0
    public var oneOff: Double = 0
    public var total: Double = 0
}

public enum Investment {

    /// Se pasa por aquí para poder fijar "hoy" en las pruebas.
    static var now: () -> Date = { Date() }

    public static func withNow(_ date: Date, _ body: () -> Void) {
        let anterior = now
        now = { date }
        body()
        now = anterior
    }

    /// Una fecha suelta a mediodía, sin que el huso horario la corra un día.
    static func parse(_ text: String) -> Date? {
        DayString.date(from: text)
    }

    /// Cuántas veces cae un gasto recurrente dentro de un período.
    ///
    /// Se anota una vez ("$50 al mes de gas") y a partir de su fecha se repite
    /// solo. Contar sólo la anotación haría que un gasto de enero no apareciera
    /// en marzo, y el margen del negocio saldría mejor de lo que es.
    public static func occurrences(of expense: Expense,
                                   from desde: Date, to hasta: Date) -> Int {
        guard let inicio = parse(expense.date) else { return 0 }

        // Nunca hacia el futuro: el internet del mes que viene todavía no se ha
        // pagado. Importa más de lo que parece — los períodos de la app terminan
        // en una fecha abierta y muy lejana, así que sin este tope un gasto
        // mensual se contaría miles de veces.
        //
        // Y es el final de HOY, no el instante actual: las fechas sueltas se
        // normalizan a mediodía, y comparar contra la hora exacta dejaba fuera
        // la cuota que toca hoy mismo.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let hoy = now()
        guard let finDeHoy = cal.date(bySettingHour: 23, minute: 59, second: 59, of: hoy) else { return 0 }

        var tope = min(hasta, finDeHoy)
        if let fin = expense.record["hasta"]?.stringValue.flatMap(parse), fin < tope { tope = fin }
        guard tope >= desde, inicio <= tope else { return 0 }

        var n = 0
        var cursor = inicio
        let semanal = expense.frequency == .semanal
        // Un tope duro: una fecha de hace veinte años no debe dejar esto dando
        // vueltas semana a semana.
        let maximo = 5000
        while cursor <= tope && n < maximo {
            if cursor >= desde { n += 1 }
            guard let siguiente = cal.date(byAdding: semanal ? .day : .month,
                                           value: semanal ? 7 : 1, to: cursor) else { break }
            cursor = siguiente
        }
        return n
    }

    /// Cuánto suma un gasto dentro de un período.
    public static func amount(of expense: Expense, from desde: Date, to hasta: Date) -> Double {
        let monto = expense.amount
        guard expense.kind == .recurrente else {
            guard let d = parse(expense.date), d >= desde, d <= hasta else { return 0 }
            return monto
        }
        return monto * Double(occurrences(of: expense, from: desde, to: hasta))
    }

    /// Reparte los gastos de un período en las tres cosas que son.
    public static func breakdown(_ expenses: [Expense],
                                 from desde: Date, to hasta: Date) -> ExpenseBreakdown {
        var out = ExpenseBreakdown()
        for e in expenses {
            let monto = amount(of: e, from: desde, to: hasta)
            guard monto != 0 else { continue }
            switch e.kind {
            case .inversion:  out.investment += monto
            case .recurrente: out.recurring += monto
            case .gasto:      out.oneOff += monto
            }
        }
        out.operating = out.oneOff + out.recurring
        out.total = out.operating + out.investment
        return out
    }

    /// Lo invertido desde el principio, sin mirar el período: lo que él quiere
    /// saber es cuánto lleva puesto en el negocio, y eso no cambia porque se
    /// mire un mes u otro.
    public static func investedEver(_ expenses: [Expense]) -> Double {
        expenses.filter { $0.kind == .inversion }.reduce(0) { $0 + $1.amount }
    }
}
