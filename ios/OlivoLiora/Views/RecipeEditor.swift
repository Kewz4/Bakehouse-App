import SwiftUI
import PhotosUI
import OlivoLioraCore

/// Editor de receta.
///
/// El orden importa y antes estaba al revés: pedía el precio de venta antes de
/// que se supiera el costo, y así no se decide un precio. Ahora sigue el orden
/// real de la cabeza de quien cocina:
///
///   1. qué es y cuánto rinde
///   2. qué lleva          → el costo aparece solo
///   3. cuánto quiero ganar → el precio sale de ahí
///
/// La foto va al final: es opcional y no se necesita para decidir nada.
struct RecipeEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let recipe: Recipe?

    @State private var name = ""
    @State private var yieldText = "1"
    @State private var lines: [EditableLine] = []
    @State private var photo = ""
    @State private var photoStatus = "Toma una foto o elige una de tu galería."
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var loaded = false

    // Precio: o sale de un margen, o se escribe a mano.
    @State private var priceMode: PriceMode = .margin
    @State private var marginPct: Double = 65
    @State private var manualPrice = ""

    enum PriceMode: String, CaseIterable {
        case margin, manual
        var label: String { self == .margin ? "Con un margen" : "Yo pongo el precio" }
    }

    /// Una línea de la receta mientras se edita.
    struct EditableLine: Identifiable, Equatable {
        let id = UUID()
        var ingredientId: String = ""
        var freeName: String = ""
        var qty: String = ""
        var unit: String = "g"
        var cost: Double = 0
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && Quantity.parse(yieldText) > 0
    }

    private var totalCost: Double { lines.reduce(0) { $0 + Quantity.parse($1.qty) * $1.cost } }
    private var yieldValue: Double { max(Quantity.parse(yieldText), 1) }
    private var unitCost: Double { totalCost / yieldValue }

    /// El precio que se va a guardar, venga de donde venga.
    private var finalPrice: Double {
        switch priceMode {
        case .manual:
            return Double(manualPrice.replacingOccurrences(of: ",", with: ".")) ?? 0
        case .margin:
            guard unitCost > 0, marginPct < 100 else { return 0 }
            return unitCost / (1 - marginPct / 100)
        }
    }

    private var profitPerServing: Double { finalPrice - unitCost }

    var body: some View {
        EditorScaffold(title: recipe == nil ? "Nueva receta" : "Editar receta",
                       canSave: canSave, onSave: commit) {
            PlainField(label: "Nombre del postre", placeholder: "ej. Cheesecake", text: $name)
            QuantityField(label: "¿Cuántas porciones rinde?", text: $yieldText)

            ingredientsSection
            costPanel
            pricePanel
            nutritionPreview
            photoSection
        }
        .onAppear(perform: load)
        .onChange(of: pickerItem) { _, item in Task { await loadPicked(item) } }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in Task { await use(image: image) } }
                .ignoresSafeArea()
        }
    }

    // MARK: - 2. Ingredientes

    private var ingredientsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("¿Qué lleva?")
                    .font(Theme.rounded(16, .bold))
                    .foregroundStyle(Theme.ink)
                Text("Toca la cantidad y se abre un teclado con fracciones (½, ⅓, ¼…).")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach($lines) { $line in
                LineEditor(line: $line, onRemove: {
                    lines.removeAll { $0.id == line.id }
                })
            }

            Button {
                lines.append(EditableLine())
            } label: {
                Label("Agregar ingrediente", systemImage: "plus")
                    .font(Theme.rounded(14, .bold))
                    .frame(maxWidth: .infinity)
            }
            .secondaryActionStyle()
        }
        .padding(.top, 4)
    }

    // MARK: - 3. Lo que cuesta

    private var costPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lo que te cuesta")
                .font(Theme.rounded(13, .bold))
                .foregroundStyle(.white.opacity(0.85))
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Money.format(unitCost))
                        .font(Theme.rounded(30, .bold))
                        .foregroundStyle(.white)
                        .contentTransition(.numericText())
                    Text("cada porción")
                        .font(Theme.rounded(12))
                        .foregroundStyle(.white.opacity(0.75))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Money.format(totalCost))
                        .font(Theme.rounded(17, .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                    Text("la receta entera")
                        .font(Theme.rounded(11))
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            if totalCost == 0 {
                Text("Agrega ingredientes y el costo aparece solo.")
                    .font(Theme.rounded(11))
                    .foregroundStyle(.white.opacity(0.75))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .animation(.snappy(duration: 0.25), value: unitCost)
    }

    // MARK: - 4. Cuánto cobrar

    private var pricePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("¿Cuánto vas a cobrar?")
                .font(Theme.rounded(16, .bold))
                .foregroundStyle(Theme.ink)

            Picker("Cómo poner el precio", selection: $priceMode) {
                ForEach(PriceMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            if priceMode == .margin {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("De cada venta quiero ganar")
                            .font(Theme.rounded(13))
                            .foregroundStyle(Theme.muted)
                        Spacer()
                        Text("\(Int(marginPct))%")
                            .font(Theme.rounded(16, .bold))
                            .foregroundStyle(Theme.green)
                            .contentTransition(.numericText())
                    }
                    Slider(value: $marginPct, in: 30...90, step: 5)
                        .tint(Theme.green)
                    Text("La mayoría de la repostería se mueve entre 60 % y 70 %.")
                        .font(Theme.rounded(11))
                        .foregroundStyle(Theme.muted)
                }
            } else {
                MoneyField(label: "Precio por porción", value: $manualPrice)
            }

            // El resultado, venga del margen o escrito a mano.
            VStack(alignment: .leading, spacing: 3) {
                Text(priceMode == .margin ? "Cobrando así, cada porción sale a" : "Cada porción")
                    .font(Theme.rounded(12))
                    .foregroundStyle(.white.opacity(0.75))
                Text(Money.format(finalPrice))
                    .font(Theme.rounded(28, .bold))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                if finalPrice > 0 && unitCost > 0 {
                    Text(profitPerServing >= 0
                         ? "Te quedan \(Money.format(profitPerServing)) de ganancia por porción"
                         : "Estás perdiendo \(Money.format(-profitPerServing)) por porción")
                        .font(Theme.rounded(12, .semibold))
                        .foregroundStyle(profitPerServing >= 0 ? .white.opacity(0.9) : Color(hex: 0xFFD9D4))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(profitPerServing < 0 && finalPrice > 0 ? Theme.red : Theme.green,
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .animation(.snappy(duration: 0.25), value: finalPrice)

            if unitCost == 0 && priceMode == .margin {
                Text("Primero agrega los ingredientes: el precio se calcula a partir de lo que te cuesta.")
                    .font(Theme.rounded(11))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .panelCard()
    }

    // MARK: - 5. Nutrición (si hay datos)

    @ViewBuilder
    private var nutritionPreview: some View {
        let draft = draftRecipe
        let result = store.badges(of: draft)
        if result.macros.hasAny || result.reason == .missingData {
            VStack(alignment: .leading, spacing: 9) {
                Text("Información nutricional")
                    .font(Theme.rounded(13, .bold))
                    .foregroundStyle(Theme.ink)
                if let sentence = result.macros.sentence {
                    Text(sentence)
                        .font(Theme.rounded(12, .semibold))
                        .foregroundStyle(Theme.green)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !result.badges.isEmpty {
                    FlowChips(badges: result.badges)
                } else if result.reason == .missingData {
                    Text("Añade los datos nutricionales de todos los ingredientes para ver etiquetas como “Sin azúcar” o “Keto”.")
                        .font(Theme.rounded(11))
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .panelCard()
        }
    }

    /// La receta tal como va quedando, para calcular macros y etiquetas en vivo.
    private var draftRecipe: Recipe {
        let built = lines.compactMap { line -> RecipeLine? in
            guard !line.ingredientId.isEmpty, Quantity.parse(line.qty) > 0 else { return nil }
            return RecipeLine(ingredientId: line.ingredientId, name: line.freeName,
                              qty: Quantity.parse(line.qty), unit: line.unit, cost: line.cost)
        }
        // Se conservan también las líneas sin ingrediente para que la cobertura
        // se calcule sobre el total real y no parezca completa cuando no lo es.
        let all = built + lines.filter { $0.ingredientId.isEmpty && Quantity.parse($0.qty) > 0 }
            .map { RecipeLine(ingredientId: nil, name: $0.freeName, qty: Quantity.parse($0.qty),
                              unit: $0.unit, cost: $0.cost) }
        return Recipe(name: name, yield: yieldValue, price: finalPrice, lines: all)
    }

    // MARK: - 6. Foto (opcional)

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Foto del postre (opcional)")
                .font(Theme.rounded(12, .bold))
                .foregroundStyle(Theme.muted)

            HStack(spacing: 12) {
                Group {
                    if photo.isEmpty {
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(Color(hex: 0xEFECE2))
                            .overlay(Image(systemName: "photo").foregroundStyle(Theme.muted))
                    } else if photo.hasPrefix("http"), let url = URL(string: photo) {
                        AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                            placeholder: { Color(hex: 0xEFECE2) }
                    } else if let image = Self.image(fromDataURL: photo) {
                        Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Color(hex: 0xEFECE2)
                    }
                }
                .frame(width: 74, height: 74)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Button { showCamera = true } label: {
                            Label("Tomar foto", systemImage: "camera.fill")
                                .font(Theme.rounded(13, .semibold))
                        }
                        .secondaryActionStyle()

                        PhotosPicker(selection: $pickerItem, matching: .images) {
                            Label("Elegir", systemImage: "photo.on.rectangle")
                                .font(Theme.rounded(13, .semibold))
                        }
                        .secondaryActionStyle()

                        if !photo.isEmpty {
                            Button {
                                photo = ""
                                photoStatus = "Sin foto."
                            } label: {
                                Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.red)
                            .accessibilityLabel("Quitar foto")
                        }
                    }
                    Text(photoStatus)
                        .font(Theme.rounded(11))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(12)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                .foregroundStyle(Theme.line))
        }
    }

    private func loadPicked(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        await use(image: image)
    }

    private func use(image: UIImage) async {
        photoStatus = "Preparando la foto…"
        guard let dataURL = Self.dataURL(from: image) else {
            photoStatus = "No pude usar esa foto."
            return
        }
        photo = dataURL
        photoStatus = "Foto lista ✓"
        let uploaded = await store.uploadPhoto(dataURL: dataURL,
                                               filename: "\(name.isEmpty ? "postre" : name).jpg")
        photo = uploaded
        photoStatus = uploaded.hasPrefix("http") ? "Foto guardada ✓" : "Se subirá al volver el internet"
    }

    /// Reduce a 1280 px y comprime, igual que la web: una foto de iPhone en
    /// bruto son varios MB y no cabe en el documento compartido.
    static func dataURL(from image: UIImage, maxSide: CGFloat = 1280, quality: CGFloat = 0.82) -> String? {
        let side = max(image.size.width, image.size.height)
        let scale = min(1, maxSide / max(side, 1))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)

        // `scale = 1` es imprescindible. Por defecto UIGraphicsImageRenderer usa
        // la escala de la pantalla, así que en un iPhone 3x "reducir a 1280 px"
        // producía en realidad 3840 px: nueve veces los píxeles y varios MB al
        // codificar. En el navegador el canvas redimensiona exacto, y por eso
        // la misma foto funcionaba desde la laptop y fallaba desde el teléfono.
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let resized = renderer.image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = resized.jpegData(compressionQuality: quality) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    static func image(fromDataURL s: String) -> UIImage? {
        guard let comma = s.firstIndex(of: ","),
              let data = Data(base64Encoded: String(s[s.index(after: comma)...]))
        else { return nil }
        return UIImage(data: data)
    }

    // MARK: - Carga y guardado

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let r = recipe else { lines = [EditableLine()]; return }
        name = r.name
        yieldText = Quantity.pretty(r.yield)
        photo = r.photo
        if !r.photo.isEmpty { photoStatus = "Foto guardada ✓" }
        lines = r.lines.map { line in
            EditableLine(ingredientId: line.ingredientId ?? "",
                         freeName: line.name,
                         qty: line.qty > 0 ? Quantity.pretty(line.qty) : "",
                         unit: line.unit,
                         cost: line.cost)
        }
        if lines.isEmpty { lines = [EditableLine()] }

        // Una receta que ya tenía precio se abre con ese precio tal cual: no se
        // le cambia por uno calculado sin que ella lo pida.
        if r.price > 0 {
            priceMode = .manual
            manualPrice = String(format: "%.2f", r.price)
        }
    }

    private func commit() {
        let built: [RecipeLine] = lines.compactMap { line in
            let ing = store.ingredients.first { $0.id == line.ingredientId }
            let label = ing?.name ?? line.freeName.trimmingCharacters(in: .whitespaces)
            let qty = Quantity.parse(line.qty)
            guard !label.isEmpty, qty > 0 else { return nil }
            // Sin redondear: a $0.0028661 el gramo, recortar decimales metía un
            // 1.2% de error en el costo de la receta.
            let cost = ing.flatMap { $0.lineUnitCost(line.unit) } ?? line.cost
            return RecipeLine(ingredientId: ing?.id, name: label, qty: qty, unit: line.unit, cost: cost)
        }

        var record = recipe ?? Recipe(name: "", yield: 1, price: 0, lines: [])
        record.name = name.trimmingCharacters(in: .whitespaces)
        record.yield = yieldValue
        record.price = finalPrice
        record.lines = built
        record.photo = photo
        store.save(record)
        dismiss()
    }
}

// MARK: - Una línea de ingrediente

private struct LineEditor: View {
    @Environment(AppStore.self) private var store
    @Binding var line: RecipeEditor.EditableLine
    let onRemove: () -> Void

    @State private var showPicker = false
    /// La conversión que se está explicando, si tocó la (i).
    @State private var shownConversion: Conversion?

    private var ingredient: Ingredient? {
        store.ingredients.first { $0.id == line.ingredientId }
    }

    /// Las unidades que se le pueden ofrecer a esta línea.
    ///
    /// Todas las que se pueden convertir de verdad: las de su familia, más las
    /// de la otra cuando se sabe cuánto pesa una pieza — leche comprada en
    /// litros se mide en cucharadas, y mantequilla comprada por barras se mide
    /// en gramos. Las que harían falta una densidad no se ofrecen, porque
    /// ofrecerlas sería prometer una cuenta que no se puede hacer.
    private var unitChoices: [MeasureUnit] {
        guard let ing = ingredient else { return Units.all }
        return Units.all.filter { ing.unitFactor($0.key) != nil }
    }

    /// Qué se convirtió, si es que hubo conversión.
    private var conversion: Conversion? {
        guard let ing = ingredient else { return nil }
        return ing.conversion(to: line.unit, qty: Quantity.parse(line.qty))
    }

    private var lineTotal: Double { Quantity.parse(line.qty) * line.cost }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                // Pantalla completa con buscador: un desplegable es inservible
                // cuando hay cientos de ingredientes.
                Button { showPicker = true } label: {
                    HStack {
                        Text(ingredient?.name ?? (line.freeName.isEmpty ? "Elige un ingrediente" : line.freeName))
                            .font(Theme.rounded(15))
                            .foregroundStyle(ingredient == nil && line.freeName.isEmpty ? Theme.muted : Theme.ink)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 10).frame(height: 42)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 34, height: 34)
                        .background(Color(hex: 0xF2EEE6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Quitar ingrediente")
            }

            HStack(alignment: .bottom, spacing: 8) {
                QuantityField(label: "Cantidad", text: $line.qty,
                              unitShort: Units.info(line.unit).short)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Unidad").font(Theme.rounded(12, .bold)).foregroundStyle(Theme.muted)
                    Picker("Unidad", selection: $line.unit) {
                        ForEach(unitChoices, id: \.key) { (u: MeasureUnit) in
                            Text(u.short).tag(u.key)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).frame(height: 46)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
                }
                .frame(maxWidth: 110)
            }

            if lineTotal > 0 {
                Text("\(Quantity.pretty(Quantity.parse(line.qty))) \(Units.info(line.unit).short) cuestan \(Money.format(lineTotal))")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
            }

            // Cuando la unidad de la receta no es la de la compra, se dice. Un
            // costo que aparece solo, sin explicar de dónde salió, es un costo
            // en el que no se confía.
            if let c = conversion {
                Button { shownConversion = c } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 9, weight: .bold))
                        Text(c.texto)
                            .font(Theme.rounded(11, .bold))
                        Image(systemName: "info.circle.fill")
                            .font(.system(size: 11))
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(Theme.sage, in: Capsule())
                    .foregroundStyle(Theme.green)
                }
                .buttonStyle(.plain)
                .transition(.scale(scale: 0.94).combined(with: .opacity))
            }
        }
        .padding(12)
        .background(Color(hex: 0xF8F7F1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.snappy(duration: 0.24), value: conversion)
        .alert("Conversión automática", isPresented: Binding(
            get: { shownConversion != nil },
            set: { if !$0 { shownConversion = nil } }
        ), presenting: shownConversion) { _ in
            Button("Entendido", role: .cancel) {}
        } message: { c in
            Text("\(c.texto)\n\n\(c.detalle)")
        }
        .sheet(isPresented: $showPicker) {
            IngredientPicker(selectedId: line.ingredientId) { picked in
                guard let picked else {
                    line.ingredientId = ""
                    line.cost = 0
                    return
                }
                line.ingredientId = picked.id
                line.freeName = picked.name
                if !Units.inFamily(Units.family(picked.unitSingle)).contains(where: { $0.key == line.unit }) {
                    line.unit = picked.unitSingle
                }
                recomputeCost()
            }
        }
        .onChange(of: line.unit) { _, _ in recomputeCost() }
        .onAppear { recomputeCost() }
    }

    private func recomputeCost() {
        guard let ing = ingredient else { return }
        // Puede cruzar de contar a pesar cuando se sabe cuánto pesa una pieza.
        // Si la conversión no se puede hacer, la unidad elegida ya no sirve
        // para este ingrediente y se vuelve a la suya.
        if let c = ing.lineUnitCost(line.unit) {
            line.cost = c
        } else {
            line.unit = ing.unitSingle
            line.cost = ing.baseCost
        }
    }
}

// MARK: - Cámara

/// La cámara del sistema. SwiftUI todavía no la ofrece de forma nativa, así que
/// se envuelve el controlador de UIKit.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onCapture(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
