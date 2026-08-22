#!/usr/bin/env python3
"""Arma el version.json que publica la Release.

   make-version.py <variantes.jsonl> <base-de-descarga> <version> <build> <commit>

Es lo que lee el teléfono para saber si hay algo más nuevo y de dónde bajarlo.
Lleva una entrada por iPhone, porque cada certificado de KravaSign sirve para un
solo dispositivo y por tanto cada teléfono tiene su propio .ipa y su propio
identificador de app.

Los campos sueltos de arriba (`bundleId`, `ipa`) repiten la primera entrada a
propósito: son los que leía la versión anterior de /api/app-version, y mientras
haya una Release vieja circulando conviene que siga entendiéndose.
"""
import json
import sys


def main() -> int:
    variantes_path, base, version, build, commit = sys.argv[1:6]

    apps = []
    for linea in open(variantes_path):
        if not linea.strip():
            continue
        v = json.loads(linea)
        apps.append({
            "nombre": v.get("nombre") or "este iPhone",
            "bundleId": v["bundleId"],
            "ipa": f'{base}/{v["archivo"]}',
            "dispositivos": v.get("dispositivos", 0),
        })

    if not apps:
        print("::error::No hay ninguna variante firmada que publicar.", file=sys.stderr)
        return 1

    from datetime import datetime, timezone
    doc = {
        "version": version,
        "build": int(build),
        "title": "Olivo & Liora",
        "publishedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": commit,
        "apps": apps,
        # Compatibilidad con lo que ya está desplegado.
        "bundleId": apps[0]["bundleId"],
        "ipa": apps[0]["ipa"],
    }
    print(json.dumps(doc, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
