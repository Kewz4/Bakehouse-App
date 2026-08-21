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

## Información nutricional y etiquetas de dieta

Cada ingrediente puede llevar, **opcionalmente**, sus macros por 100 g (o 100 ml,
o 100 unidades): calorías, proteína, carbohidratos, azúcares, grasa, grasa
saturada, fibra y sodio. Las recetas los suman.

### Leer la etiqueta con la cámara

Ella toma una foto de la tabla nutricional y los campos se llenan solos.

Para que funcione hace falta una variable en Vercel:

1. Proyecto `olivo-liora` → **Settings** → **Environment Variables**.
2. Añade `GROQ_API_KEY` con tu llave de Groq (`gsk_…`), en *Production*,
   *Preview* y *Development*.
3. **Redespliega** (añadir una variable no redespliega solo).

Comprobación: `curl -s https://olivo-liora.vercel.app/api/vision` debe decir
`{"enabled":true}`. Si dice `false`, el botón de la cámara sencillamente no
aparece y los campos se escriben a mano — la app no se rompe.

> La llave vive **sólo en el servidor**. No está en el repositorio ni viaja al
> navegador ni a la app: `api/vision.js` hace la llamada y devuelve únicamente
> el resultado. Meterla en `app.js` la dejaría a la vista de cualquiera que
> abriera la página, y este repositorio es público.

**Cómo se reparte el trabajo con el modelo** (`qwen/qwen3.6-27b` en Groq): el
modelo SÓLO copia lo que ve y dice si la tabla es "por porción" o "por 100 g".
Las cuentas —pasar de una cosa a la otra— se hacen en `business-core.js`. Es a
propósito: un modelo que divide mal produce un número igual de convincente que
uno bien calculado, y aquí un error acaba en un precio mal puesto. Si la
etiqueta no dice cuánto pesa una porción pero sí cuántas trae el envase, se
deduce con lo que ella ya escribió del paquete.

### Etiquetas de dieta

Cuando una receta tiene los macros **de todos** sus ingredientes, se le ponen
etiquetas automáticas: 🍭 Sin azúcar, 🍬 Bajo en azúcar, 🥑 Keto, 💪 GymReady,
🌾 Alta en fibra, 🪶 Bajo en grasa, 🧂 Bajo en sodio, 🥥 Paleo. Se puede filtrar
la lista de recetas por cualquiera de ellas.

| etiqueta | regla (por porción) |
|---|---|
| Sin azúcar | 0.5 g de azúcar o menos |
| Bajo en azúcar | entre 0.5 y 5 g — aquí caen los postres endulzados con fruta |
| Keto | carbohidratos netos ≤ 10 g y ≥ 60 % de las calorías vienen de grasa |
| GymReady | ≥ 10 g de proteína y ≥ 20 % de las calorías |
| Alta en fibra | ≥ 5 g |
| Bajo en grasa | ≤ 3 g |
| Bajo en sodio | ≤ 140 mg |
| Paleo | por ingredientes, no por macros (ver abajo) |

**Si falta la información de un solo ingrediente, la receta no lleva ninguna
etiqueta.** No es una limitación: son afirmaciones sobre salud. Un "Sin azúcar"
calculado con tres de cinco ingredientes no es un dato incompleto, es uno falso,
y alguien que evita el azúcar por indicación médica podría creerlo. En ese caso
la tarjeta dice qué falta por llenar.

**Paleo es la excepción**: no se puede deducir de los macros, porque no depende
de las cantidades sino de qué lleva la receta. Se decide por el nombre de los
ingredientes contra una lista de palabras (harina de trigo, azúcar, lácteos,
suero, legumbres…), con excepciones para que "harina de almendra" no quede
descartada por decir "harina". Ante la duda, no se pone. Es una ayuda, no un
certificado.

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

### Construir, firmar y publicar el `.ipa`

CI lo hace en cada push a `ios/`. Si los certificados están cargados como
secretos, el `.ipa` sale **firmado** y se publica solo en una Release; si no
están, sale sin firmar y sólo sirve para comprobar que todo compila.

El runner compila con **Xcode 26.6 / SDK iPhoneOS 26.5**, así que Liquid Glass
va incluido de verdad (no es el camino alternativo). Pesa ~550 kB.

#### Los tres secretos

En *Settings → Secrets and variables → Actions*:

| Secreto | Qué es |
|---|---|
| `IOS_P12_BASE64` | el `.p12` de distribución, en base64 |
| `IOS_P12_PASSWORD` | la contraseña con la que se exportó ese `.p12` |
| `IOS_MOBILEPROVISION_BASE64` | el perfil **ad-hoc**, en base64 |

Para sacar el base64, en un Mac:

```bash
base64 -i cert.p12            | pbcopy   # → IOS_P12_BASE64
base64 -i perfil.mobileprovision | pbcopy # → IOS_MOBILEPROVISION_BASE64
```

Los archivos en sí **no van al repositorio**: un `.p12` lleva dentro la clave
privada con la que se firma, y este repositorio es público.

El perfil tiene que ser el de distribución ad-hoc (`get-task-allow: false`), no
el de desarrollo. El de desarrollo también firma, pero produce una app que sólo
arranca con Xcode conectado.

#### De dónde sale el identificador de la app

Del propio perfil, no de `project.yml`. El workflow lo lee con
`ios/read-profile.py` y se lo pasa a `xcodebuild`.

Importa porque **iOS decide por el identificador si actualiza la app que ya está
instalada o si instala una segunda al lado**. Si no coincide, ella acabaría con
dos iconos iguales y los datos del teléfono en el que ya no entra. Por eso
`project.yml` lleva el mismo valor escrito (`app.gorilla3597.nadir5999`) y el
paso de firma comprueba que lo que salió coincide con lo que el perfil dice.

### Que se actualice sola

Ella no reinstala nada. Cada compilación firmada se publica en una Release y el
teléfono la recoge:

```
GitHub Release  ──►  /api/app-version  ──►  la app compara el número de compilación
     │                                              │
     │                                        ¿hay uno mayor?
     │                                              ▼
     └──────────►  /instalar/olivo-liora.plist  ◄── botón "Actualizar"
                          (itms-services)
```

* **`/api/app-version`** lee `version.json` de la última Release y dice qué hay.
* **`/instalar/olivo-liora.plist`** es el archivo que iOS necesita para
  instalar; apunta al `.ipa` de la Release.
* **`/instalar.html`** es la página para la **primera** instalación, la única
  vez que hace falta abrir algo en Safari.

La comparación se hace sobre `CFBundleVersion`, que es el número de la
ejecución del workflow y sube siempre. Comparar enteros no tiene casos raros;
comparar `"1.10"` contra `"1.9"` sí.

Ninguna de las dos direcciones usa la API de GitHub: `releases/latest/download/`
es una dirección fija y sin límite de peticiones, mientras que la API sin
credenciales corta a las 60 por hora **por IP**, y las IP de Vercel son
compartidas. Tampoco hay ninguna llave guardada en el servidor para esto.

En la app son dos cosas y nada más: una frase y un botón. Sin número de
versión, sin notas de la versión, sin ajuste que buscar.

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
api/app-version.js  api/manifest.js        qué versión hay y cómo instalarla
instalar.html                              la página de la primera instalación
test/                                       pruebas de web y sincronización
ios/OlivoLioraCore/                         núcleo sin SwiftUI (compila en Linux)
ios/OlivoLiora/                             la app SwiftUI
ios/project.yml                             el .xcodeproj se genera con XcodeGen
ios/read-profile.py                         lee el identificador del perfil de firma
```

El `.xcodeproj` no se guarda en el repositorio: el formato `.pbxproj` es
ilegible en un diff y da conflictos constantes. `xcodegen generate` lo
reconstruye desde `project.yml`.
