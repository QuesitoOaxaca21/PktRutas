"""Prueba del instalador, sin tocar tu menú Inicio ni tu escritorio.

Instala en una carpeta temporal, con los accesos directos en carpetas de
prueba y el registro en una clave de prueba (HKCU\\Software\\PktRutasPrueba).
Revisa que la copia instalada funcione por sí sola y la desinstala sin dejar
nada.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

CLAVE = r"Software\PktRutasPrueba"


def main():
    if os.name != "nt":
        print("[omitida] el instalador es sólo para Windows")
        return 0
    import winreg

    import instalar
    from pkt import VERSION
    from pkt.descifrar import cifrar_pkt
    from prueba_plan import NOTAS, construir

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        destino = tmp / "Programs" / "PktRutas"
        accesos = {"menú Inicio": tmp / "menu", "escritorio": tmp / "escritorio",
                   "Enviar a": tmp / "enviar"}
        try:
            assert instalar.instalar(destino, accesos, CLAVE) == VERSION
            assert (destino / "app.py").is_file() and (destino / "pkt" / "modelo.py").is_file()
            assert (destino / "pktrutas.ico").is_file() and (destino / "GUIA.html").is_file()
            assert not list(destino.glob("prueba_*.py")), "las pruebas no se instalan"
            print("[ok] copia el programa, el ícono y la guía, sin las pruebas")

            for carpeta in accesos.values():
                programa, argumentos = instalar.leer_acceso(carpeta / "PktRutas.lnk")
                assert Path(programa).name.lower() in ("pyw.exe", "pythonw.exe"), programa
                assert '"%s"' % (destino / "app.py") in argumentos, argumentos
            print("[ok] los accesos directos abren app.py con pyw o pythonw, sin consola")

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, CLAVE) as k:
                quitar = winreg.QueryValueEx(k, "UninstallString")[0]
                assert winreg.QueryValueEx(k, "DisplayVersion")[0] == VERSION
            assert quitar.endswith('"%s" --desinstalar' % (destino / "instalar.py")), quitar
            print("[ok] queda registrado para desinstalarlo desde Configuración")

            # La copia instalada tiene todo lo que necesita: analiza una
            # práctica sin el repositorio al lado.
            practica = tmp / "practica.pkt"
            practica.write_bytes(cifrar_pkt(construir(NOTAS)))
            r = subprocess.run([sys.executable, str(destino / "analizar.py"), str(practica),
                                "--no-abrir"], cwd=tmp, capture_output=True,
                               encoding="utf-8", errors="replace")
            assert r.returncode == 0 and "Por aplicar" in r.stdout, r.stdout + r.stderr
            print("[ok] el programa instalado analiza un .pkt por sí solo")

            # Volver a instalar actualiza: lo que ya no es del programa se va.
            (destino / "pkt" / "viejo.py").write_text("# de una versión anterior\n")
            instalar.instalar(destino, accesos, CLAVE)
            assert not (destino / "pkt" / "viejo.py").exists()
            print("[ok] instalar otra vez reemplaza la versión anterior completa")

            ajena = tmp / "ajena"
            ajena.mkdir()
            (ajena / "tarea.docx").write_text("no se borra")
            for accion in (lambda: instalar.desinstalar(ajena, {}, CLAVE + "Nada"),
                           lambda: instalar.instalar(ajena, {}, CLAVE + "Nada")):
                try:
                    accion()
                except SystemExit:
                    pass
                else:
                    raise AssertionError("tocó una carpeta que no es de PktRutas")
            assert (ajena / "tarea.docx").read_text() == "no se borra"

            quitado = instalar.desinstalar(destino, accesos, CLAVE)
            assert not destino.exists(), "la carpeta se quita"
            assert not any((c / "PktRutas.lnk").exists() for c in accesos.values())
            assert len(quitado) == 5, quitado
            try:
                winreg.OpenKey(winreg.HKEY_CURRENT_USER, CLAVE).Close()
                raise AssertionError("quedó la clave del registro")
            except FileNotFoundError:
                pass
            print("[ok] desinstalar quita todo y nunca toca una carpeta ajena")
        finally:
            os.chdir(Path(__file__).resolve().parent)
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, CLAVE)
            except FileNotFoundError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
