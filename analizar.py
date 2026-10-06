"""Analizador de prácticas de Cisco Packet Tracer.

Lee un archivo .pkt, comprueba la configuración de la topología y genera la
que le falta (o toda, si la práctica está en blanco) como archivo de texto,
que se abre en el Bloc de notas.

Uso:
    python analizar.py practica.pkt
    python analizar.py practica.pkt -o resultado.txt
    python analizar.py practica.pkt --pkt copia.pkt   (copia con todo aplicado)
    python analizar.py practica.pkt --xml        (guarda también el XML interno)
    python analizar.py practica.pkt --esquema    (muestra la estructura del XML)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from pkt import red as analisis
from pkt import reporte
from pkt.descifrar import descifrar_archivo
from pkt.modelo import leer_topologia


try:  # que los acentos salgan bien tambien en consolas antiguas
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass


def _buscar_pkt():
    """Sin argumentos: usa el único .pkt que haya junto al programa."""
    for carpeta in (Path.cwd(), Path(__file__).resolve().parent):
        candidatos = sorted(carpeta.glob("*.pkt"))
        if len(candidatos) == 1:
            return candidatos[0]
        if len(candidatos) > 1:
            print("Hay varios archivos .pkt en %s; indica cuál analizar." % carpeta)
            for c in candidatos:
                print("   ", c.name)
            return None
    return None


def _abrir_en_bloc_de_notas(ruta):
    try:
        if os.name == "nt":
            subprocess.Popen(["notepad.exe", str(ruta)])
        else:
            subprocess.Popen(["xdg-open", str(ruta)])
    except Exception as exc:
        print("No se pudo abrir el Bloc de notas (%s)." % exc)
        print("El reporte quedó en: %s" % ruta)


def _resumen_esquema(xml: bytes, limite=400) -> str:
    """Estructura del XML: útil para adaptar el lector a otra versión de PT."""
    raiz = ET.fromstring(xml)
    conteo, muestra = Counter(), {}

    def recorrer(el, ruta, prof):
        etiqueta = el.tag.split("}")[-1]
        actual = ruta + "/" + etiqueta
        conteo[actual] += 1
        texto = (el.text or "").strip()
        if texto and actual not in muestra:
            muestra[actual] = texto[:40]
        if prof < 7:
            for hijo in el:
                recorrer(hijo, actual, prof + 1)

    recorrer(raiz, "", 0)
    lineas = ["%-8s %-58s %s" % ("VECES", "RUTA", "EJEMPLO")]
    for ruta, veces in sorted(conteo.items())[:limite]:
        lineas.append("%-8d %-58s %s" % (veces, ruta[:58], muestra.get(ruta, "")))
    return "\n".join(lineas)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="Comprueba una topología de Packet Tracer y genera la "
                    "configuración que le falta.")
    p.add_argument("archivo", nargs="?", help="archivo .pkt a analizar")
    p.add_argument("-o", "--salida", help="archivo de texto de salida")
    p.add_argument("--xml", action="store_true",
                   help="guarda además el XML descifrado")
    p.add_argument("--esquema", action="store_true",
                   help="muestra la estructura de etiquetas del XML")
    p.add_argument("--no-abrir", action="store_true",
                   help="no abrir el Bloc de notas al terminar")
    p.add_argument("--pkt", metavar="SALIDA.pkt",
                   help="escribe además una copia del .pkt con todo ya aplicado")
    args = p.parse_args(argv)

    ruta = Path(args.archivo) if args.archivo else _buscar_pkt()
    if ruta is None:
        p.print_help()
        return 2
    if not ruta.exists():
        print("No existe el archivo: %s" % ruta)
        return 2

    print("Leyendo %s ..." % ruta.name)
    try:
        xml, formato = descifrar_archivo(ruta)
    except Exception as exc:
        print("ERROR: %s" % exc)
        return 1
    print("Descifrado con el formato: %s (%d KB de XML)" % (formato, len(xml) // 1024))

    if args.xml:
        destino_xml = ruta.with_suffix(".xml")
        destino_xml.write_bytes(xml)
        print("XML guardado en %s" % destino_xml)

    if args.esquema:
        destino_esq = ruta.with_name(ruta.stem + "_esquema.txt")
        texto = _resumen_esquema(xml)
        destino_esq.write_text(texto, encoding="utf-8")
        print("Esquema guardado en %s" % destino_esq)
        print(texto[:4000])

    topo = leer_topologia(xml)
    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    hallazgos = analisis.revisar(topo, subredes, rutas)

    texto = reporte.construir(ruta.name, formato, topo, subredes, rutas,
                              inalcanzables, hallazgos)
    salida = Path(args.salida) if args.salida else ruta.with_name(
        ruta.stem + "_ruteo.txt")
    salida.write_text(texto, encoding="utf-8-sig", newline="")

    pendientes = reporte.pendientes(topo, rutas)
    errores = sum(1 for h in hallazgos if h.nivel == analisis.ERROR)
    print("Equipos: %d   Ruteadores: %d   Subredes: %d   Sitios con VLANs: %d"
          % (len(topo.dispositivos), len(topo.ruteadores), len(subredes),
             len(topo.plan.sitios) if topo.plan else 0))
    print("Errores de configuración: %d   Por aplicar: %s"
          % (errores, reporte.texto_pendientes(*pendientes)))
    print("Reporte: %s" % salida)

    if args.pkt:
        from pkt import escribir
        try:
            resumen = escribir.escribir(ruta, args.pkt)
        except Exception as exc:
            print("No se pudo escribir el .pkt configurado: %s" % exc)
            return 1
        quedan = resumen["quedan"]
        print("Pkt configurado: %s  (%d equipo(s), %d comandos, %d PC(s) en DHCP, "
              "%d PC(s) con su nombre original; al volver a leerlo %s)"
              % (args.pkt, len(resumen["equipos"]), resumen["comandos"], resumen["pcs"],
                 resumen["renombradas"],
                 "ya no falta nada" if not any(quedan)
                 else "aún faltan " + reporte.texto_pendientes(*quedan)))
        if resumen["sin_renombrar"]:
            print("No se renombraron (su nombre ya lo usa otro equipo): %s"
                  % ", ".join(resumen["sin_renombrar"]))

    if not args.no_abrir:
        _abrir_en_bloc_de_notas(salida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
