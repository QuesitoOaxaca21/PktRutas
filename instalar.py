"""Instala PktRutas para el usuario actual, sin permisos de administrador.

    py -3 instalar.py                    instala o actualiza
    py -3 instalar.py --sin-escritorio   igual, sin el acceso del escritorio
    py -3 instalar.py --desinstalar      lo quita todo

Copia el programa a %LOCALAPPDATA%\\Programs\\PktRutas, pone su acceso directo
en el menú Inicio, en el escritorio y en "Enviar a" (clic derecho sobre un .pkt,
Enviar a, PktRutas), y lo registra en Configuración > Aplicaciones para poder
desinstalarlo desde ahí.

Los accesos abren el programa con pyw o pythonw, que vienen firmados por la
Python Software Foundation: el Control inteligente de aplicaciones de Windows 11
los deja correr, cosa que no haría con un instalador .exe sin firma.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import shutil
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

NOMBRE = "PktRutas"
AQUI = Path(__file__).resolve().parent
CLAVE = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\PktRutas"
PAGINA = "https://github.com/QuesitoOaxaca21/PktRutas"
DESCRIPCION = "Configuración Cisco desde prácticas de Packet Tracer"

# Lo que se instala: el programa, el ícono y la ayuda. Las pruebas y los
# detalles técnicos se quedan en el repositorio.
ARCHIVOS = ["app.py", "analizar.py", "instalar.py", "Analizar.bat", "pktrutas.ico",
            "GUIA.html", "LEEME.txt"]
PAQUETES = ["pkt", "ui"]


# ==========================================================================
# Windows: carpetas del usuario y accesos directos
# ==========================================================================

class _GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    def __init__(self, texto):
        super().__init__()
        ctypes.oledll.ole32.CLSIDFromString(texto, ctypes.byref(self))


def _carpeta_conocida(guid) -> Path:
    """La carpeta real (el escritorio puede estar en OneDrive, por ejemplo)."""
    ruta = ctypes.c_wchar_p()
    ctypes.oledll.shell32.SHGetKnownFolderPath(ctypes.byref(_GUID(guid)), 0, None,
                                               ctypes.byref(ruta))
    try:
        return Path(ruta.value)
    finally:
        ctypes.windll.ole32.CoTaskMemFree(ruta)


def accesos_del_usuario() -> dict:
    """{dónde: carpeta}: menú Inicio, escritorio y Enviar a."""
    return {
        "menú Inicio": _carpeta_conocida("{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}"),
        "escritorio": _carpeta_conocida("{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}"),
        "Enviar a": _carpeta_conocida("{8983036C-27C0-404B-8F08-102D10DCFD74}"),
    }


def _com(indice, nombre, *argumentos):
    """El método `indice` de la tabla de una interfaz COM."""
    return ctypes.WINFUNCTYPE(ctypes.HRESULT, *argumentos)(indice, nombre)


_QueryInterface = _com(0, "QueryInterface", ctypes.POINTER(_GUID),
                       ctypes.POINTER(ctypes.c_void_p))
_Release = ctypes.WINFUNCTYPE(wintypes.ULONG)(2, "Release")
# IShellLinkW
_GetPath = _com(3, "GetPath", wintypes.LPWSTR, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
_SetDescription = _com(7, "SetDescription", wintypes.LPCWSTR)
_SetWorkingDirectory = _com(9, "SetWorkingDirectory", wintypes.LPCWSTR)
_GetArguments = _com(10, "GetArguments", wintypes.LPWSTR, ctypes.c_int)
_SetArguments = _com(11, "SetArguments", wintypes.LPCWSTR)
_SetIconLocation = _com(17, "SetIconLocation", wintypes.LPCWSTR, ctypes.c_int)
_SetPath = _com(20, "SetPath", wintypes.LPCWSTR)
# IPersistFile
_Load = _com(5, "Load", wintypes.LPCWSTR, wintypes.DWORD)
_Save = _com(6, "Save", wintypes.LPCWSTR, wintypes.BOOL)


class _Enlace:
    """Un acceso directo (.lnk), con IShellLinkW e IPersistFile."""

    def __enter__(self):
        ole32 = ctypes.oledll.ole32
        ole32.CoInitialize(None)
        self.enlace, self.archivo = ctypes.c_void_p(), ctypes.c_void_p()
        ole32.CoCreateInstance(ctypes.byref(_GUID("{00021401-0000-0000-C000-000000000046}")),
                               None, 1,      # CLSCTX_INPROC_SERVER
                               ctypes.byref(_GUID("{000214F9-0000-0000-C000-000000000046}")),
                               ctypes.byref(self.enlace))
        _QueryInterface(self.enlace, ctypes.byref(_GUID("{0000010B-0000-0000-C000-000000000046}")),
                        ctypes.byref(self.archivo))
        return self

    def __exit__(self, *_):
        for puntero in (self.archivo, self.enlace):
            if puntero:
                _Release(puntero)


def crear_acceso(ruta: Path, programa, argumentos, carpeta: Path, icono: Path):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with _Enlace() as e:
        _SetPath(e.enlace, str(programa))
        _SetArguments(e.enlace, argumentos)
        _SetWorkingDirectory(e.enlace, str(carpeta))
        _SetDescription(e.enlace, DESCRIPCION)
        _SetIconLocation(e.enlace, str(icono), 0)
        _Save(e.archivo, str(ruta), True)


def leer_acceso(ruta: Path) -> tuple:
    """(programa, argumentos) de un acceso directo."""
    with _Enlace() as e:
        _Load(e.archivo, str(ruta), 0)
        programa, argumentos = ctypes.create_unicode_buffer(1024), ctypes.create_unicode_buffer(1024)
        _GetPath(e.enlace, programa, 1024, None, 0)
        _GetArguments(e.enlace, argumentos, 1024)
        return programa.value, argumentos.value


def interpretes() -> tuple:
    """((programa, opción) para la ventana, (programa, opción) con consola).

    Se prefiere el lanzador py/pyw de python.org: sigue sirviendo cuando
    actualizas Python. Si no está, los de este mismo Python."""
    pyw, py = shutil.which("pyw"), shutil.which("py")
    if pyw and py and "WindowsApps" not in pyw:
        return (pyw, "-3 "), (py, "-3 ")
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return (str(pythonw) if pythonw.exists() else sys.executable, ""), (sys.executable, "")


# ==========================================================================
# Instalar y desinstalar
# ==========================================================================

def _es_nuestra(carpeta: Path) -> bool:
    """Para no borrar nunca una carpeta ajena: una instalación de PktRutas
    tiene app.py y pkt/modelo.py (o está vacía)."""
    return ((carpeta / "app.py").is_file() and (carpeta / "pkt" / "modelo.py").is_file()) \
        or not any(carpeta.iterdir())


def _copiar(origen: Path, destino: Path):
    if destino.exists():
        if not _es_nuestra(destino):
            raise SystemExit("%s ya existe y no es una instalación de PktRutas: no se toca."
                             % destino)
        shutil.rmtree(destino)      # actualizar = quitar la versión anterior completa
    destino.mkdir(parents=True)
    for nombre in ARCHIVOS:
        shutil.copy2(origen / nombre, destino / nombre)
    for paquete in PAQUETES:
        (destino / paquete).mkdir()
        for archivo in (origen / paquete).glob("*.py"):
            shutil.copy2(archivo, destino / paquete / archivo.name)


def _registrar(destino: Path, clave, version, consola):
    import winreg
    programa, opcion = consola
    tamano = sum(f.stat().st_size for f in destino.rglob("*") if f.is_file()) // 1024
    cadenas = {
        "DisplayName": NOMBRE,
        "DisplayVersion": version,
        "DisplayIcon": str(destino / "pktrutas.ico"),
        "InstallLocation": str(destino),
        "UninstallString": '"%s" %s"%s" --desinstalar' % (programa, opcion,
                                                          destino / "instalar.py"),
        "URLInfoAbout": PAGINA,
        "InstallDate": time.strftime("%Y%m%d"),
    }
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, clave, 0, winreg.KEY_SET_VALUE) as k:
        for nombre, valor in cadenas.items():
            winreg.SetValueEx(k, nombre, 0, winreg.REG_SZ, valor)
        for nombre, valor in (("NoModify", 1), ("NoRepair", 1), ("EstimatedSize", tamano)):
            winreg.SetValueEx(k, nombre, 0, winreg.REG_DWORD, valor)


def instalar(destino: Path, accesos: dict, clave=CLAVE, origen: Path = AQUI) -> str:
    """Copia el programa a `destino`, crea los accesos ({dónde: carpeta}) y lo
    registra en HKCU\\`clave`. Devuelve la versión instalada."""
    faltan = [n for n in ARCHIVOS + [p + "/__init__.py" for p in PAQUETES]
              if not (origen / n).is_file()]
    if faltan:
        raise SystemExit("Faltan archivos junto al instalador: %s. Descomprime la "
                         "carpeta completa y vuelve a intentarlo." % ", ".join(faltan))
    texto = (origen / "pkt" / "__init__.py").read_text(encoding="utf-8")
    version = texto.split('VERSION = "', 1)[1].split('"', 1)[0]
    if destino.resolve() != origen.resolve():     # ya instalado ahí: sólo los accesos
        _copiar(origen, destino)
    ventana, consola = interpretes()
    for carpeta in accesos.values():
        crear_acceso(carpeta / (NOMBRE + ".lnk"), ventana[0],
                     '%s"%s"' % (ventana[1], destino / "app.py"), destino,
                     destino / "pktrutas.ico")
    _registrar(destino, clave, version, consola)
    return version


def desinstalar(destino: Path, accesos: dict, clave=CLAVE) -> list:
    """Quita los accesos que abren esta instalación, el registro y la carpeta.
    Devuelve lo que quitó."""
    import winreg
    if destino.is_dir() and not _es_nuestra(destino):
        raise SystemExit("%s no es una instalación de PktRutas: no se toca." % destino)
    quitado = []
    for donde, carpeta in accesos.items():
        ruta = carpeta / (NOMBRE + ".lnk")
        if ruta.is_file() and str(destino / "app.py").lower() in leer_acceso(ruta)[1].lower():
            ruta.unlink()
            quitado.append("el acceso directo del %s" % donde)
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, clave)
        quitado.append("el registro en Configuración > Aplicaciones")
    except FileNotFoundError:
        pass
    if destino.is_dir():
        os.chdir(tempfile.gettempdir())       # no se puede borrar la carpeta en uso
        shutil.rmtree(destino)
        quitado.append(str(destino))
    return quitado


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Instala o desinstala PktRutas para este usuario.")
    p.add_argument("--desinstalar", action="store_true", help="quita el programa y sus accesos")
    p.add_argument("--sin-escritorio", action="store_true",
                   help="no crea el acceso directo del escritorio")
    args = p.parse_args(argv)
    if os.name != "nt":
        print("El instalador es para Windows. En otro sistema abre app.py con Python 3.")
        return 1
    destino = Path(os.environ["LOCALAPPDATA"]) / "Programs" / NOMBRE
    accesos = accesos_del_usuario()

    if args.desinstalar:
        print("Se va a quitar PktRutas de %s, con sus accesos directos." % destino)
        if input("¿Continuar? [S/n] ").strip().lower() in ("n", "no"):
            return 1
        try:
            quitado = desinstalar(destino, accesos)
        except OSError as exc:
            print("\nNo se pudo quitar todo (%s). Cierra PktRutas y vuelve a intentarlo." % exc)
            input("Presiona Enter para cerrar...")
            return 1
        print("\nListo, se quitó:" if quitado else "\nPktRutas no estaba instalado.")
        for cosa in quitado:
            print("  - " + cosa)
        input("\nPresiona Enter para cerrar...")
        return 0

    if args.sin_escritorio:
        del accesos["escritorio"]
    print("Instalando PktRutas en %s ..." % destino)
    try:
        version = instalar(destino, accesos)
    except OSError as exc:
        print("\nNo se pudo instalar (%s). Si PktRutas está abierto, ciérralo y vuelve "
              "a intentarlo." % exc)
        return 1
    print("\nListo: PktRutas %s quedó instalado." % version)
    print("  - Ábrelo desde el menú Inicio%s." % ("" if args.sin_escritorio
                                                 else " o el acceso del escritorio"))
    print("  - Clic derecho sobre un .pkt > Enviar a > PktRutas lo abre ya analizado.")
    print("  - La guía de uso está en el menú Ayuda del programa.")
    print("  - Para quitarlo: Configuración > Aplicaciones > PktRutas > Desinstalar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
