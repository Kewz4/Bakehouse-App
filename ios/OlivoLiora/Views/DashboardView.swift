import SwiftUI
import OlivoLioraCore

struct DashboardView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // El único sitio de toda la app donde aparece el nombre: es la
                // pantalla de inicio. Antes estaba aquí arriba, otra vez en el
                // saludo ("Así va Olivo & Liora") y una tercera en la cabecera
                // de cada una de las otras pestañas. Ella ya sabe qué app abrió.
                ScreenHeader(title: "Hola, Camila.", detail: nil)

                UpdateBanner()

                periodPicker

                metricsGrid

                panel(title: "Cuánto vendiste por mes") {
                    MonthlyChart(bars: store.monthlyBars)
                }

                panel(title: "Un resumen rápido") {
                    let m = store.metrics
                    VStack(spacing: 0) {
                        DotRow(title: "Venta promedio", subtitle: "Cuánto deja cada venta",
                               amount: Money.format(m.averageTicket))
                        Divider().overlay(Theme.line)
                        DotRow(title: "Ventas registradas", subtitle: "En este período",
                               amount: "\(m.salesCount)")
                        Divider().overlay(Theme.line)
                        DotRow(title: "Porciones vendidas", subtitle: "En total",
                               amount: Quantity.pretty(m.unitsSold))
                        Divider().overlay(Theme.line)
                        DotRow(title: "Tu mejor venta",
                               subtitle: m.bestSale?.product ?? "Sin ventas aún",
                               amount: m.bestSale.map { Money.format($0.total) } ?? "—")
                    }
                }

                panel(title: "Ideas para ganar más") {
                    let alerts = store.alerts
                    if alerts.isEmpty {
                        EmptyHint(text: "¡Todo va en orden! Sigue registrando tu actividad.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(alerts.enumerated()), id: \.offset) { _, a in
                                DotRow(title: a.title, subtitle: a.detail)
                            }
                        }
                    }
                }

                panel(title: "Productos más vendidos") {
                    let top = store.topProducts
                    if top.isEmpty {
                        EmptyHint(text: "Registra ventas para ver tu ranking de productos.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(top) { p in
                                DotRow(title: p.name,
                                       subtitle: "\(Quantity.pretty(p.qty)) unidades vendidas",
                                       amount: Money.format(p.total))
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .background(Theme.cream)
        .scrollIndicators(.hidden)
        .refreshable { store.refreshFromServer() }
    }

    // MARK: - Período

    private var periodPicker: some View { PeriodBar() }

    // MARK: - Métricas

    private var metricsGrid: some View {
        let m = store.metrics
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                         spacing: 12) {
            MetricTile(caption: "Lo que vendiste", value: Money.format(m.salesTotal),
                       note: "En este período")
            MetricTile(caption: "Tu ganancia", value: Money.format(m.profit),
                       note: m.marginSentence,
                       valueColor: m.profit < 0 ? Theme.red : Theme.ink)
            MetricTile(caption: "Costo de los postres", value: Money.format(m.productionCost),
                       note: "Ingredientes que usaste")
            MetricTile(caption: "Otros gastos", value: Money.format(m.expensesTotal),
                       note: "Gas, cajas, entregas…")
        }
    }

    @ViewBuilder
    private func panel<Content: View>(title: String,
                                      @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(Theme.title(21)).foregroundStyle(Theme.ink)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .panelCard()
    }
}

/// La barra de "¿de cuándo?": flechas para ir mes a mes y un menú para elegir
/// de qué tamaño es el paso.
///
/// Vive aquí y no dentro del panel porque la pregunta se hace en tres
/// pantallas. En recetas e ingredientes no aparece: son un catálogo, no cambian
/// porque cambie el mes.
struct PeriodBar: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                if store.period.movible {
                    Button { store.movePeriod(-1) } label: {
                        Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.green)
                    .frame(width: 34, height: 34)

                    Text(store.periodLabel)
                        .font(Theme.rounded(15, .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(minWidth: 96)
                        .contentTransition(.numericText())

                    Button { store.movePeriod(1) } label: {
                        Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(store.periodOffset >= 0 ? Theme.muted.opacity(0.4) : Theme.green)
                    .frame(width: 34, height: 34)
                    .disabled(store.periodOffset >= 0)
                } else {
                    Text(store.periodLabel)
                        .font(Theme.rounded(15, .bold))
                        .foregroundStyle(Theme.ink)
                }

                Spacer()

                Picker("Período", selection: Binding(
                    get: { store.period },
                    set: { store.setPeriod($0) })) {
                    ForEach(Period.allCases) { p in Text(p.label).tag(p) }
                }
                .pickerStyle(.menu)
                .tint(Theme.green)
            }

            if store.period == .custom {
                HStack(spacing: 10) {
                    DatePicker("Desde", selection: $store.customFrom, displayedComponents: .date)
                        .font(Theme.rounded(13))
                    DatePicker("Hasta", selection: $store.customTo, displayedComponents: .date)
                        .font(Theme.rounded(13))
                }
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "es"))
            }
        }
        .animation(.snappy(duration: 0.22), value: store.periodLabel)
    }
}

struct MetricTile: View {
    let caption: String
    let value: String
    let note: String
    var valueColor: Color = Theme.ink
    /// En burdeos y a lo ancho, para la cifra que se lee primero.
    var destacada: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(caption)
                .font(Theme.rounded(12))
                .foregroundStyle(destacada ? .white.opacity(0.75) : Theme.muted)
                .lineLimit(1)
            Text(value)
                .font(Theme.rounded(destacada ? 28 : 23, .bold))
                .foregroundStyle(destacada ? .white : valueColor)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .contentTransition(.numericText())
            Text(note)
                .font(Theme.rounded(11, .semibold))
                .foregroundStyle(destacada ? .white.opacity(0.8) : Theme.green)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: destacada ? 92 : 104, alignment: .topLeading)
        .padding(14)
        .modifier(TileBackground(destacada: destacada))
        .animation(.snappy(duration: 0.25), value: value)
    }
}

/// El fondo de la tarjeta: el de siempre, o burdeos cuando destaca.
private struct TileBackground: ViewModifier {
    let destacada: Bool
    func body(content: Content) -> some View {
        if destacada {
            content.background(Theme.green,
                               in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            content.panelCard()
        }
    }
}

/// Las ventas de los últimos seis meses. El mes actual va resaltado, igual que
/// en la web.
struct MonthlyChart: View {
    let bars: [MonthBar]

    private var maxValue: Double { max(bars.map(\.value).max() ?? 1, 1) }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(bars) { bar in
                VStack(spacing: 6) {
                    if bar.value > 0 {
                        Text(Money.format(bar.value))
                            .font(Theme.rounded(9, .bold))
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(bar.index == bars.count - 1 ? Theme.green : Theme.sage)
                        .frame(height: max(6, CGFloat(bar.value / maxValue) * 130))
                    Text(bar.label)
                        .font(Theme.rounded(11))
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(bar.label): \(Money.format(bar.value))")
            }
        }
        .frame(height: 190)
        .animation(.snappy(duration: 0.3), value: bars.map(\.value))
    }
}
