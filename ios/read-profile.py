#!/usr/bin/env python3
"""Saca del perfil de firma los datos que necesita el workflow.

El perfil manda: dice para qué identificador de app vale el certificado y a qué
equipo pertenece. Se leen de ahí en vez de escribirlos a mano en el workflow
porque si algún día se regeneran los certificados con otro identificador, la
compilación se adapta sola en lugar de firmar una app que el iPhone rechaza.
"""
import datetime
import plistlib
import shlex
import sys


def main() -> int:
    with open(sys.argv[1], "rb") as f:
        profile = plistlib.load(f)

    entitlements = profile["Entitlements"]
    app_id = entitlements["application-identifier"]
    team = entitlements["com.apple.developer.team-identifier"]

    if not app_id.startswith(team + "."):
        print(f"::error::El perfil dice equipo {team} pero la app {app_id}.", file=sys.stderr)
        return 1

    # Un perfil caducado firma igual y produce un .ipa que el iPhone rechaza al
    # instalarlo, sin decir por qué. Mejor pararlo aquí, donde se puede explicar.
    expires = profile["ExpirationDate"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=datetime.timezone.utc)
    quedan = (expires - datetime.datetime.now(datetime.timezone.utc)).days
    if quedan < 0:
        print(f"::error::El perfil de firma caducó el {expires:%d/%m/%Y}. "
              "Genera uno nuevo con KravaSign y actualiza el secreto "
              "IOS_MOBILEPROVISION_BASE64.", file=sys.stderr)
        return 1
    if quedan < 30:
        print(f"::warning::Al perfil de firma le quedan {quedan} días "
              f"(caduca el {expires:%d/%m/%Y}).", file=sys.stderr)

    values = {
        "UUID": profile["UUID"],
        "APP_ID": app_id,
        # El prefijo del equipo no forma parte del identificador de la app.
        "BUNDLE_ID": app_id[len(team) + 1:],
        "TEAM_ID": team,
        "EXPIRES": str(profile["ExpirationDate"]),
    }
    for key, value in values.items():
        print(f"{key}={shlex.quote(value)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
