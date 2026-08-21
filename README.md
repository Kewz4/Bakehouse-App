# Olivo & Liora

Control de negocio para una repostería: recetas y costos, precios, ventas,
gastos e ingredientes. Existe en dos formas que comparten los mismos datos:

- **la web** — `https://olivo-liora.vercel.app` (PWA, se instala en el teléfono
  o se abre en la laptop)
- **la app de iPhone** — nativa, en `ios/`

Lo que se anota en una aparece en la otra sin tocar nada.

---

## Estado del despliegue

**Hecho:**

- Este código está publicado en producción (`/sync-core.js` responde 200).
- Repositorio conectado a Vercel; rama `main` creada con este código.
- Blob Store creado y conectado al proyecto — `store_cFMIRAZHGAS7bOLQ`, público.

**Falta una cosa, y es la última:** el proyecto tiene el store conectado pero
**sin permiso de escritura**.

```bash
curl -s https://olivo-liora.vercel.app/api/data
# {"enabled":false, …, "blobVars":["BLOB_STORE_ID","BLOB_WEBHOOK_PUBLIC_KEY"]}
```

Esas dos variables demuestran que la conexión existe. La que falta es
`BLOB_READ_WRITE_TOKEN`, que es la única que permite *guardar*. Sin ella se
podría leer, pero no escribir, así que la app sigue en modo "guardado aquí".

### Cómo arreglarlo

**Opción A — reconectar con permiso de escritura**

1. Vercel → **Storage** → tu Blob Store → pestaña de proyectos conectados.
2. En `olivo-liora`, comprueba que esté como **Read and write**, no *Read only*.
   Si está en solo lectura: desconecta y vuelve a conectar eligiendo lectura y
   escritura.

**Opción B — añadir la variable a mano** (siempre funciona)

1. Vercel → **Storage** → tu Blob Store → sección de tokens / `.env.local`.
   Copia el valor de `BLOB_READ_WRITE_TOKEN` (empieza por `vercel_blob_rw_…`).
2. Proyecto `olivo-liora` → **Settings** → **Environment Variables** → añade
   `BLOB_READ_WRITE_TOKEN` con ese valor, marcando *Production*, *Preview* y
   *Development*.
3. **Redespliega.** Añadir una variable no redespliega solo:
   *Deployments* → el último → menú `⋯` → **Redeploy**.

> Si al conectar el store le pusiste un prefijo y la variable quedó como
> `ALGO_BLOB_READ_WRITE_TOKEN`, también sirve: el código acepta cualquier
> variable cuyo nombre termine en `BLOB_READ_WRITE_TOKEN`.

### Comprobar que quedó

```bash
curl -s https://olivo-liora.vercel.app/api/data
# {"enabled":true,"doc":{…},"updatedAt":…}
```

Con eso en verde: abre la web en la laptop y en el teléfono, anota una venta en
uno y espera unos segundos. Aparece en el otro.

> Nota sobre el almacén público: el documento queda legible para cualquiera que
> conozca su dirección
> (`…public.blob.vercel-storage.com/datos/olivo-liora.json`). Fue una decisión
> tomada a propósito por simplicidad. Si algún día quieres cerrarlo, es cambiar
> `api/data.js` a un store privado y leerlo con el SDK.

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
npm run fixtures
```

genera casos **y el resultado exacto que produce el lado de JavaScript**, para
las dos cosas que están escritas dos veces:

- la combinación (`sync-core.js` ↔ `MergeEngine.swift`), comparando el documento
  resultante carácter por carácter;
- las cuentas (`business-core.js` ↔ `Units.swift`, `Domain.swift`): 35 cantidades
  escritas a mano como "media taza" o "1 ½", 16 formatos de número, costos por
  unidad base y recetas completas.

Una prueba de Swift los replica con su propio código y exige lo mismo. CI falla
si los casos están desactualizados, así que no se puede cambiar una regla en un
solo lado sin enterarse.

---

## Pruebas

```bash
npm test          # motor de combinación + endpoint /api/data (26 pruebas)
npm run test:e2e  # dos navegadores contra un servidor (8 pruebas)
npm run dev       # servidor local en :4321 con sincronización en memoria

cd ios/OlivoLioraCore && swift test   # núcleo de iOS (21 pruebas)
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

El runner compila con **Xcode 26.6 / SDK iPhoneOS 26.5**, así que Liquid Glass
va incluido de verdad (no es el camino alternativo). Pesa ~550 kB.

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
