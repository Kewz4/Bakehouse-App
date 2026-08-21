import SwiftUI
import PhotosUI
import OlivoLioraCore

struct RecipeEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let recipe: Recipe?

    @State private var name = ""
    @State private var yieldText = "1"
    @State private var price = ""
    @State private var lines: [EditableLine] = []
    @State private var photo = ""
    @State private var photoStatus = "Toma una foto o elige una de tu galería."
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var loaded = false

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

    private var totalCost: Double {
        lines.reduce(0) { $0 + Quantity.parse($1.qty) * $1.cost }
    }
    private var yieldValue: Double { max(Quantity.parse(yieldText), 1) }
    private var unitCost: Double { totalCost / yieldValue }
    private var priceValue: Double { Double(price.replacingOccurrences(of: ",", with: ".")) ?? 0 }
    private var margin: Double { priceValue > 0 ? (priceValue - unitCost) / priceValue * 100 : 0 }

    var body: some View {
        EditorScaffold(title: recipe == nil ? "Nueva receta" : "Editar receta",
                       canSave: canSave, onSave: commit) {
            PlainField(label: "Nombre del postre", placeholder: "ej. Cheesecake", text: $name)
            QuantityField(label: "Porciones que rinde", text: $yieldText)
            MoneyField(label: "Precio de venta por porción", value: $price)

            photoSection

            Text("Ingredientes usados en la receta")
                .font(Theme.rounded(16, .bold))
                .foregroundStyle(Theme.ink)
                .padding(.top, 6)
            Text("Elige un ingrediente y toca la cantidad: se abre un teclado con números y fracciones (½, ⅓, ¼…).")
                .font(Theme.rounded(12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

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

            totalsPanel
        }
        .onAppear(perform: load)
        .onChange(of: pickerItem) { _, item in Task { await loadPicked(item) } }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in Task { await use(image: image) } }
                .ignoresSafeArea()
        }
    }

    // MARK: - Foto

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
                            .overlay(Image(systemName: "photo")
                                .foregroundStyle(Theme.muted))
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
                                Image(systemName: "xmark")
                                    .font(.system(size: 12, weight: .bold))
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
        // Se sube al almacén compartido para que también se vea en la laptop.
        // Si no hay señal se queda la copia local y se sube al guardar de nuevo.
        let uploaded = await store.uploadPhoto(dataURL: dataURL, filename: "\(name.isEmpty ? "postre" : name).jpg")
        photo = uploaded
        photoStatus = uploaded.hasPrefix("http") ? "Foto guardada ✓" : "Se subirá al volver el internet"
    }

    /// Reduce a 1280 px y comprime, igual que la web: una foto de iPhone en
    /// bruto son varios MB y no cabe en el documento compartido.
    static func dataURL(from image: UIImage, maxSide: CGFloat = 1280, quality: CGFloat = 0.82) -> String? {
        let side = max(image.size.width, image.size.height)
        let scale = min(1, maxSide / max(side, 1))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)

        let renderer = UIGraphicsImageRenderer(size: target)
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

    // MARK: - Totales

    private var totalsPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                stat("Costo total", Money.format(totalCost))
                stat("Costo por porción", Money.format(unitCost))
                stat("Precio / porción", Money.format(priceValue))
                stat("Ganas del precio",
                     priceValue > 0 ? "\(Int(margin.rounded()))%" : "—",
                     color: priceValue <= 0 ? Theme.ink : (margin >= 55 ? Theme.green : Theme.red))
            }
            if unitCost > 0 && (priceValue <= 0 || margin < 55) {
                Text("Cobrando \(Money.format(unitCost / 0.35)) por porción tendrías buena ganancia.")
                    .font(Theme.rounded(12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .panelCard()
    }

    private func stat(_ caption: String, _ value: String, color: Color = Theme.ink) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(caption).font(Theme.rounded(11)).foregroundStyle(Theme.muted)
            Text(value).font(Theme.rounded(15, .bold)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(Color(hex: 0xF8F7F1), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    // MARK: - Carga y guardado

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let r = recipe else { lines = [EditableLine()]; return }
        name = r.name
        yieldText = Quantity.pretty(r.yield)
        price = r.price > 0 ? String(format: "%.2f", r.price) : ""
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
    }

    private func commit() {
        let built: [RecipeLine] = lines.compactMap { line in
            let ing = store.ingredients.first { $0.id == line.ingredientId }
            let label = ing?.name ?? line.freeName.trimmingCharacters(in: .whitespaces)
            let qty = Quantity.parse(line.qty)
            guard !label.isEmpty, qty > 0 else { return nil }
            let cost = ing.map { $0.baseCost * Units.info(line.unit).factor } ?? line.cost
            return RecipeLine(ingredientId: ing?.id, name: label, qty: qty, unit: line.unit, cost: cost)
        }

        var record = recipe ?? Recipe(name: "", yield: 1, price: 0, lines: [])
        record.name = name.trimmingCharacters(in: .whitespaces)
        record.yield = yieldValue
        record.price = priceValue
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

    private var ingredient: Ingredient? {
        store.ingredients.first { $0.id == line.ingredientId }
    }

    /// Sólo se ofrecen unidades de la misma familia que el ingrediente: si se
    /// compra en libras se puede usar en gramos, pero nunca en mililitros.
    private var unitChoices: [Unit] {
        guard let ing = ingredient else { return Units.all }
        return Units.inFamily(Units.family(ing.unitSingle))
    }

    private var lineTotal: Double { Quantity.parse(line.qty) * line.cost }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if store.ingredients.isEmpty {
                    TextField("Ingrediente", text: $line.freeName)
                        .font(Theme.rounded(15))
                        .padding(.horizontal, 10).frame(height: 42)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(Theme.line, lineWidth: 1))
                } else {
                    Picker("Ingrediente", selection: $line.ingredientId) {
                        Text("Elige un ingrediente").tag("")
                        ForEach(store.ingredients) { Text($0.name).tag($0.id) }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).frame(height: 42)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
                }

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
                        ForEach(unitChoices, id: \.key) { Text($0.short).tag($0.key) }
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
        }
        .padding(12)
        .background(Color(hex: 0xF8F7F1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onChange(of: line.ingredientId) { _, _ in adoptIngredientUnit() }
        .onChange(of: line.unit) { _, _ in recomputeCost() }
        .onAppear { recomputeCost() }
    }

    /// Al elegir un ingrediente, la unidad salta a la suya y el costo se
    /// recalcula solo: ella nunca escribe un precio por gramo a mano.
    private func adoptIngredientUnit() {
        guard let ing = ingredient else { return }
        if !unitChoices.contains(where: { $0.key == line.unit }) {
            line.unit = ing.unitSingle
        }
        recomputeCost()
    }

    private func recomputeCost() {
        guard let ing = ingredient else { return }
        line.cost = ing.baseCost * Units.info(line.unit).factor
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
