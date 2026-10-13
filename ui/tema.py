"""Colores y letras de la ventana, como el Bloc de notas de Windows 11.

Igual que el Bloc de notas, sigue el tema de Windows: oscuro o claro. Se lee
una vez, al abrir la ventana.
"""

from __future__ import annotations

import ctypes
import platform


def _windows_en_claro() -> bool:
    if platform.system() != "Windows":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows"
                            r"\CurrentVersion\Themes\Personalize") as clave:
            return bool(winreg.QueryValueEx(clave, "AppsUseLightTheme")[0])
    except OSError:
        return False


CLARO = _windows_en_claro()

if CLARO:
    BARRA = "#f3f3f3"           # barras de menú y de estado
    HOJA = "#ffffff"            # el área de texto
    TEXTO = "#1b1b1b"
    TENUE = "#5f5f5f"
    LINEA = "#e1e1e1"           # la raya sobre la barra de estado
    RESALTE = "#e6e6e6"         # el título del menú bajo el puntero
    MENU = "#f9f9f9"            # el menú desplegado
    MENU_ACTIVO = "#e1e1e1"
    SELECCION = "#b5d5f5"
    PILDORA, PILDORA_ENCIMA, PILDORA_ACTIVA = "#b9b9b9", "#8c8c8c", "#6c6c6c"
    OK, AVISO, ERROR = "#0f7b0f", "#8a5300", "#c42b1c"
else:
    BARRA = "#2b2b2b"
    HOJA = "#1f1f1f"
    TEXTO = "#ffffff"
    TENUE = "#9a9a9a"
    LINEA = "#1a1a1a"
    RESALTE = "#404040"
    MENU = "#2d2d2d"
    MENU_ACTIVO = "#4a4a4a"
    SELECCION = "#264f78"
    PILDORA, PILDORA_ENCIMA, PILDORA_ACTIVA = "#5c5c5c", "#8a8a8a", "#ababab"
    OK, AVISO, ERROR = "#6bd66b", "#ffc861", "#ff6b6b"

LETRA_HOJA = "Consolas"         # la del Bloc de notas
UI = ("Segoe UI", 10)
UI_CHICA = ("Segoe UI", 9)


def barra_oscura(ventana):
    """Pone oscura la barra de título de Windows, si el tema es oscuro."""
    if CLARO or platform.system() != "Windows":
        return
    try:
        ventana.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(ventana.winfo_id())
        valor = ctypes.c_int(1)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, 20, ctypes.byref(valor), ctypes.sizeof(valor))
    except Exception:
        pass
