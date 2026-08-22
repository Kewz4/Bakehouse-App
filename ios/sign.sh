#!/bin/bash
#
# Firma la app para UN iPhone y deja el .ipa listo.
#
#   ios/sign.sh <perfil.mobileprovision> <identidad> <llavero> <salida> <build> <version>
#
# Se llama una vez por cada teléfono. Cada certificado de KravaSign sirve para
# un solo dispositivo — el perfil lleva dentro la lista de los que acepta — así
# que dos teléfonos son dos .ipa distintos, cada uno con su identificador.
#
# Escribe en la salida estándar una línea JSON con lo que hizo, para que el
# workflow arme el version.json sin volver a abrir nada.
set -euo pipefail

PERFIL="$1"; IDENTIDAD="$2"; LLAVERO="$3"; SALIDA="$4"; BUILD="$5"; VERSION="$6"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

security cms -D -i "$PERFIL" > "$TMP/perfil.plist"
python3 "$RAIZ/ios/read-profile.py" "$TMP/perfil.plist" > "$TMP/perfil.env"
# shellcheck disable=SC1090
. "$TMP/perfil.env"

echo "→ $BUNDLE_ID (perfil $UUID, caduca $EXPIRES)" >&2

for dir in "$HOME/Library/MobileDevice/Provisioning Profiles" \
           "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$dir"
  cp "$PERFIL" "$dir/$UUID.mobileprovision"
done

# Sólo los permisos que la app usa, y todos salen del propio perfil. Pedir de
# más es la forma más común de que la firma pase y la instalación falle.
cat > "$TMP/app.entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>application-identifier</key><string>$APP_ID</string>
  <key>com.apple.developer.team-identifier</key><string>$TEAM_ID</string>
  <key>get-task-allow</key><false/>
</dict>
</plist>
PLIST
plutil -lint "$TMP/app.entitlements" >/dev/null

cd "$RAIZ/ios"
xcodebuild \
  -project OlivoLiora.xcodeproj \
  -scheme OlivoLiora \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -archivePath "$TMP/OlivoLiora.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  MARKETING_VERSION="$VERSION" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$IDENTIDAD" \
  PROVISIONING_PROFILE_SPECIFIER="$UUID" \
  CODE_SIGN_ENTITLEMENTS="$TMP/app.entitlements" \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=YES \
  OTHER_CODE_SIGN_FLAGS="--keychain $LLAVERO" \
  archive >&2

# `release-testing` es el nombre nuevo de lo que Xcode llamaba `ad-hoc`, que es
# justo lo que es esto: firmado para los iPhones concretos de la lista, sin
# pasar por la App Store. Se prueban los dos nombres para no atarse a la
# versión de Xcode que traiga el runner hoy.
exportar () {
  cat > "$TMP/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$1</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>$IDENTIDAD</string>
  <key>provisioningProfiles</key>
  <dict><key>$BUNDLE_ID</key><string>$UUID</string></dict>
  <key>stripSwiftSymbols</key><true/>
  <key>compileBitcode</key><false/>
  <key>thinning</key><string>&lt;none&gt;</string>
</dict>
</plist>
PLIST
  rm -rf "$TMP/export"
  xcodebuild -exportArchive \
    -archivePath "$TMP/OlivoLiora.xcarchive" \
    -exportPath "$TMP/export" \
    -exportOptionsPlist "$TMP/ExportOptions.plist" >&2
}
exportar release-testing || exportar ad-hoc

IPA=$(find "$TMP/export" -name '*.ipa' | head -1)
[ -n "$IPA" ] || { echo "::error::No salió ningún .ipa del export de $BUNDLE_ID"; exit 1; }

mkdir -p "$SALIDA"
DESTINO="$SALIDA/OlivoLiora-$BUNDLE_ID.ipa"
cp "$IPA" "$DESTINO"

# --- Comprobar antes de publicar ---------------------------------------------
# Un .ipa mal firmado se instala igual de mal en el teléfono de ella que en el
# mío, pero ella no sabría qué hacer con el error.
rm -rf "$TMP/check" && mkdir -p "$TMP/check"
unzip -q "$DESTINO" -d "$TMP/check"
APP=$(find "$TMP/check/Payload" -maxdepth 1 -name '*.app' | head -1)

test -f "$APP/embedded.mobileprovision" \
  || { echo "::error::$BUNDLE_ID salió sin perfil dentro: el iPhone lo rechazaría."; exit 1; }

codesign -dv --verbose=4 "$APP" 2>&1 | grep -E '^(Authority|Identifier|TeamIdentifier)=' >&2 \
  || { echo "::error::$BUNDLE_ID no quedó firmada."; exit 1; }
codesign --verify --deep --strict "$APP" >&2

GOT=$(plutil -extract CFBundleIdentifier raw -o - "$APP/Info.plist")
[ "$GOT" = "$BUNDLE_ID" ] \
  || { echo "::error::La app dice ser $GOT pero el perfil es para $BUNDLE_ID."; exit 1; }

# El .ipa tiene que aceptar el dispositivo que el perfil dice aceptar. Si no,
# la actualización se baja entera y falla al final, en el teléfono.
DISPOSITIVOS=$(python3 -c '
import plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
print(len(p.get("ProvisionedDevices") or []))' "$TMP/perfil.plist")
echo "   firmada · build $(plutil -extract CFBundleVersion raw -o - "$APP/Info.plist") · $DISPOSITIVOS dispositivo(s)" >&2

python3 -c '
import json, sys
print(json.dumps({"bundleId": sys.argv[1], "archivo": sys.argv[2],
                  "dispositivos": int(sys.argv[3]), "caduca": sys.argv[4]}))' \
  "$BUNDLE_ID" "$(basename "$DESTINO")" "$DISPOSITIVOS" "$EXPIRES"
