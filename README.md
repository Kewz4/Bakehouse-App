# Olivo & Liora

Control de negocio para una repostería: recetas y costos, precios, ventas,
gastos e ingredientes. Existe en dos formas que comparten los mismos datos:

- **la web** — `https://olivo-liora.vercel.app` (PWA, se instala en el teléfono
  o se abre en la laptop)
- **la app de iPhone** — nativa, en `ios/`

Lo que se anota en una aparece en la otra sin tocar nada.

---

## ⚠️ Falta un paso, y sin él no se sincroniza nada

Ahora mismo `https://olivo-liora.vercel.app/api/data` responde:

```json
{ "enabled": false }
```

Eso significa que **el proyecto no tiene un Blob Store conectado**. Sin él no
hay dónde guardar los datos compartidos, así que cada dispositivo se queda con
su propia copia en el navegador y nunca se ven entre ellos. Es exactamente la
razón por la que la laptop y el teléfono muestran cosas distintas.

El código ya está listo para el momento en que exista. En cuanto aparezca la
variable, la sincronización se enciende sola: no hay que volver a desplegar
nada a mano ni cambiar una línea.

**Cómo conectarlo** (una vez, ~30 segundos):

1. Entra a <https://vercel.com/dashboard> con la cuenta donde vive el proyecto
   `olivo-liora`.
2. Pestaña **Storage** → **Create Database** → **Blob**.
3. Ponle un nombre (por ejemplo `olivo-liora-datos`) y créalo.
4. En **Connect Project**, elige `olivo-liora` y conéctalo a *Production*,
   *Preview* y *Development*.

Vercel añade `BLOB_READ_WRITE_TOKEN` y redespliega solo.

**Para comprobar que quedó:**

```bash
curl -s https://olivo-liora.vercel.app/api/data
# antes:   {"enabled":false, ...}
# después: {"enabled":true,"doc":{...},"updatedAt":...}
```

> El conector de Vercel de esta sesión sólo ve el team `OlivoLiora`, que está
> vacío. El proyecto `olivo-liora` está en otra cuenta, así que este paso no se
> podía hacer desde aquí.

---

## Cómo funciona la sincronización

El problema no era que faltara sincronización, sino que la que había podía
**borrar datos**. Ambos lados mandaban el documento entero y ganaba el último
en escribir, así que una venta anotada en el teléfono desaparecía en cuanto la
laptop sincronizaba. Los borrados eran peor: sin marca de borrado, algo borrado
en un dispositivo lo resucitaba el otro en la siguiente subida.

Ahora hay **una sola regla de combinación**, en `sync-core.js`, que usan por
igual el navegador, el servidor y la app de iPhone.

Cada registro lleva:

| campo | para qué |
|---|---|
| `id` | identifica el registro, nunca cambia |
| `updatedAt` | milisegundos de la última modificación |
| `deleted` | lápida: el registro se conserva marcado, no se elimina |

Combinar dos documentos es tomar, registro por registro, el de `updatedAt` más
alto. Nunca se pisa un documento completo. Esa operación es **conmutativa,
asociativa e idempotente**, y de ahí sale la garantía que importa: da igual el
orden en que lleguen los cambios, cuántos dispositivos escriban a la vez o
cuántas veces se repita una sincronización — todos terminan viendo lo mismo.

Las lápidas son lo que hace que un borrado viaje. Se guardan 120 días y luego
se limpian para que el documento no crezca sin límite; el precio es que un
dispositivo apagado más de 120 días podría resucitar algo borrado.

### Sin señal

El documento local **es** la cola de salida. Cualquier cambio sin subir sigue
ahí dentro, así que no hay una cola aparte que se pueda perder o desincronizar.

- Se escribe primero en el dispositivo, siempre, y eso nunca falla por la red.
- Subir es un intento que se reintenta con esperas crecientes (1s, 2s, 4s… hasta
  1 minuto).
- Se reintenta también al volver la señal, al volver a la app y cada 30 s.
- Sólo se da por sincronizado cuando el servidor confirma que **de verdad**
  tiene los cambios (`contains`); si no, se reintenta.

Ella no ve nada de esto. El único texto es *Todo guardado* / *Guardando…* /
*Se guardará solo*. No hay botón de sincronizar ni de reintentar, porque no hay
ninguna decisión que le corresponda tomar.

### En el servidor

`api/data.js` ya no sobrescribe: lee lo guardado, lo combina con lo que llega y
guarda el resultado. Devuelve el documento combinado, así **un solo viaje hace
subida y bajada**. Después relee para confirmar que la escritura quedó, y si
otro dispositivo se le cruzó en el intento, repite.

---

## Que los dos motores no se separen

La regla está escrita dos veces: en JavaScript (`sync-core.js`) y en Swift
(`MergeEngine.swift`). Si una se cambia y la otra no, el teléfono y la laptop
empiezan a discrepar en silencio, que es la peor forma de fallar.

Para evitarlo:

```bash
node test/make-conformance-fixtures.js
```

genera casos de combinación **y el resultado exacto que produce el motor de
JavaScript**. Una prueba de Swift los replica con su propio motor y exige el
mismo texto, carácter por carácter. CI falla si los casos están desactualizados.

---

## Pruebas

```bash
npm test          # motor de combinación + endpoint /api/data (23 pruebas)
npm run test:e2e  # dos navegadores contra un servidor (7 pruebas)
npm run dev       # servidor local en :4321 con sincronización en memoria

cd ios/OlivoLioraCore && swift test   # núcleo de iOS (17 pruebas)
```

`test/two-devices.test.js` es la que corresponde a lo que se pidió: levanta la
app real en dos navegadores independientes (dos `localStorage` = dos
dispositivos) y comprueba que una venta anotada en uno aparece en el otro, que
lo escrito sin señal sube al volver el internet, que un borrado viaja, y que
los datos que ya existían no se pierden al actualizar.

---

## La app de iPhone

### Construir el `.ipa`

CI lo hace en cada push a `ios/`:

**Actions → App de iPhone → artefacto `OlivoLiora-unsigned-ipa`**

Sale **sin firmar**, con la estructura `Payload/OlivoLiora.app` que espera
KravaSign. También se puede lanzar a mano desde *Actions → Run workflow*.

En local (hace falta un Mac):

```bash
brew install xcodegen
cd ios && xcodegen generate && open OlivoLiora.xcodeproj
```

### Por qué el mínimo es iOS 17 y no iOS 26

Liquid Glass es de iOS 26, pero poner iOS 26 como mínimo dejaría fuera al
iPhone que ella tenga hoy si no está actualizado. La app pide iOS 17 y aplica
Liquid Glass cuando el dispositivo lo soporta; si no, usa materiales
translúcidos, que es lo más parecido de antes.

Eso necesita **dos** comprobaciones, y las dos hacen falta por razones
distintas:

```swift
#if canImport(FoundationModels)   // ¿el SDK conoce estos símbolos?
if #available(iOS 26.0, *) {      // ¿el iPhone los tiene?
    content.glassEffect(.regular, in: shape)
} else {
    content.background(.ultraThinMaterial, in: shape)
}
#else
content.background(.ultraThinMaterial, in: shape)
#endif
```

`#available` decide en ejecución. Compilando contra un Xcode anterior, la
llamada a `glassEffect` **no compila** aunque esté dentro de un `#available`,
porque el símbolo no existe en ese SDK. `FoundationModels` también es nuevo de
iOS 26, así que sirve de señal de "este SDK ya es el nuevo".

Por lo mismo la barra de pestañas usa `.tabItem` y no el tipo `Tab` de iOS 18:
en iOS 26 el sistema le pone Liquid Glass igual, sin dejar fuera a iOS 17.

### Liquid Glass, aplicado como Apple lo pide

- El cristal es **sólo para la capa de navegación**: barra de pestañas, botón
  flotante de añadir, insignia de guardado. El contenido va opaco.
- Nada de cristal sobre cristal: ensucia la jerarquía y cuesta rendimiento.
- Nada de cristal en listas que se desplazan.
- Las adaptaciones de accesibilidad (Reducir transparencia, Aumentar contraste,
  Reducir movimiento) las hace el sistema solo; no se sobrescriben.

### Paridad con la web

| | web | iPhone |
|---|---|---|
| Panel con métricas y filtro de período | ✅ | ✅ |
| Gráfico de 6 meses | ✅ | ✅ |
| Avisos ("margen bajo en…") | ✅ | ✅ |
| Ranking de productos | ✅ | ✅ |
| Recetas con costo, margen y sugerencia | ✅ | ✅ |
| Calculadora de precios (margen / recargo) | ✅ | ✅ |
| Editor de ingredientes con conversión de unidades | ✅ | ✅ |
| Teclado de fracciones (½, ⅓, ¼…) | ✅ | ✅ |
| Foto del postre (cámara y galería) | ✅ | ✅ |
| Ventas, gastos, ingredientes | ✅ | ✅ |
| Búsqueda en cada lista | ✅ | ✅ |
| Funciona sin señal | ✅ | ✅ |

Las fórmulas del negocio están portadas literalmente (costo por porción,
margen, precio sugerido, la diferencia entre "ganar % del precio" y "sumar % al
costo", los cortes de período con semanas que empiezan en lunes), así que los
mismos datos dan los mismos números en los dos lados.

---

## Estructura

```
index.html  app.js  styles.css  sw.js      la PWA
sync-core.js                               la regla de combinación (web + servidor)
api/data.js                                lee, combina y guarda
api/upload.js                              fotos
test/                                       pruebas de web y sincronización
ios/OlivoLioraCore/                         núcleo sin SwiftUI (compila en Linux)
ios/OlivoLiora/                             la app SwiftUI
ios/project.yml                             el .xcodeproj se genera con XcodeGen
```

El `.xcodeproj` no se guarda en el repositorio: el formato `.pbxproj` es
ilegible en un diff y da conflictos constantes. `xcodegen generate` lo
reconstruye desde `project.yml`.
