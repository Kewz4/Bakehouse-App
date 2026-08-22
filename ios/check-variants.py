#!/usr/bin/env python3
"""Comprueba que lo firmado tiene sentido antes de publicarlo.

Dos cosas, y las dos sólo se notarían en el teléfono de ella:

  - Dos perfiles con el mismo identificador serían dos .ipa peleándose por la
    misma dirección de descarga, y el teléfono equivocado bajándose el que no es.
  - Un perfil ad-hoc sólo instala en los dispositivos que lleva dentro. Si el
    iPhone de ella no está en ninguno, "Actualizar" se baja la app entera y
    falla al final, sin decir por qué.
"""
import json
import sys


def main() -> int:
    variantes = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
    if not variantes:
        print("::error::No se firmó ninguna variante.", file=sys.stderr)
        return 1

    ids = [v["bundleId"] for v in variantes]
    if len(ids) != len(set(ids)):
        print(f"::error::Dos perfiles usan el mismo identificador: {ids}",
              file=sys.stderr)
        return 1

    total = 0
    for v in variantes:
        total += v["dispositivos"]
        print(f'  {v["nombre"]}: {v["bundleId"]} · '
              f'{v["dispositivos"]} dispositivo(s) · caduca {v["caduca"]}')

    print(f"La app se puede instalar en {total} iPhone(s).")
    if total < 2:
        print("::warning::Sólo hay un iPhone cubierto. Si el de ella no es ése, "
              "la actualización le fallará al instalarse: hacen falta sus "
              "propios IOS_P12_BASE64_2 y IOS_MOBILEPROVISION_BASE64_2.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
