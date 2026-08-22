#!/usr/bin/env python3
"""Dice con qué identidad del llavero hay que firmar un perfil concreto.

Con dos iPhones hay dos certificados en el llavero a la vez, y firmar un .ipa
con la identidad del otro produce algo que compila, se empaqueta, se publica —
y falla al instalarse en el teléfono, que es donde nadie puede arreglarlo.

El perfil lleva dentro los certificados que acepta (`DeveloperCertificates`), así
que la elección no se adivina: se busca en el llavero la identidad cuya huella
esté en esa lista.
"""
import hashlib
import plistlib
import re
import subprocess
import sys


def huellas_del_perfil(ruta: str) -> set[str]:
    """SHA-1 de cada certificado que el perfil acepta, como los da `security`."""
    perfil = plistlib.loads(
        subprocess.run(["security", "cms", "-D", "-i", ruta],
                       capture_output=True, check=True).stdout)
    return {hashlib.sha1(cert).hexdigest().upper()
            for cert in perfil.get("DeveloperCertificates", [])}


def identidades(llavero: str) -> list[tuple[str, str]]:
    """(huella, nombre) de cada identidad que puede firmar código."""
    salida = subprocess.run(
        ["security", "find-identity", "-v", "-p", "codesigning", llavero],
        capture_output=True, text=True).stdout
    return re.findall(r'\)\s+([0-9A-F]{40})\s+"([^"]+)"', salida)


def main() -> int:
    perfil, llavero = sys.argv[1], sys.argv[2]
    acepta = huellas_del_perfil(perfil)
    disponibles = identidades(llavero)

    for huella, nombre in disponibles:
        if huella in acepta:
            print(nombre)
            return 0

    # Con un solo certificado en el llavero no hay ambigüedad que resolver, y
    # parar aquí sería peor que seguir: los perfiles de algunos servicios de
    # firma no siempre traen la lista completa.
    if len(disponibles) == 1:
        print(disponibles[0][1])
        return 0

    print("::error::Ninguna identidad del llavero sirve para este perfil. "
          f"El perfil acepta {len(acepta)} certificado(s) y en el llavero hay "
          f"{len(disponibles)}. ¿Están cruzados el .p12 y el .mobileprovision?",
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
