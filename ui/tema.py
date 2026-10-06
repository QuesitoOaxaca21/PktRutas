"""Paleta, widgets y navegación por teclado.

Todo el programa usa estos ayudantes para que los paneles se vean iguales y
para que el teclado se comporte siempre de la misma forma: Enter avanza al
siguiente campo, flechas arriba/abajo se mueven entre campos y Escape cierra
la ventana que esté encima.
"""

from __future__ import annotations

import ctypes
import platform
import tkinter as tk

FONDO = "#202020"
PANEL = "#2d2d2d"
REJILLA = "#1a1a1a"
CAMPO = "#181818"
BARRA = "#2b2b2b"      # barras de menú y de estado, como el Bloc de notas
HOJA = "#1f1f1f"       # el área de texto
BOTON = "#404040"
BOTON_ACTIVO = "#5a5a5a"
TEXTO = "#ffffff"
TENUE = "#9a9a9a"
ACENTO = "#4a9eff"
ERROR = "#ff6b6b"
OK = "#6bd66b"

MONO = ("Consolas", 10)
MONO_NEGRITA = ("Consolas", 10, "bold")
TITULO = ("Consolas", 12, "bold")


def barra_oscura(ventana):
    """Pone la barra de título de Windows en modo oscuro."""
    if platform.system() != "Windows":
        return
    try:
        ventana.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(ventana.winfo_id())
        valor = ctypes.c_int(1)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, 20, ctypes.byref(valor), ctypes.sizeof(valor))
    except Exception:
        pass


# --------------------------------------------------------------------------
# Widgets
# --------------------------------------------------------------------------

def marco(padre, fondo=PANEL, **kw):
    return tk.Frame(padre, bg=fondo, **kw)


def etiqueta(padre, texto, fondo=PANEL, color=TEXTO, fuente=MONO, **kw):
    return tk.Label(padre, text=texto, bg=fondo, fg=color, font=fuente,
                    anchor="w", **kw)


def titulo(padre, texto, fondo=PANEL):
    return tk.Label(padre, text=texto, bg=fondo, fg=TEXTO, font=TITULO,
                    anchor="w")


def ayuda(padre, texto, fondo=PANEL):
    return tk.Label(padre, text=texto, bg=fondo, fg=TENUE, font=("Consolas", 9),
                    anchor="w", justify="left")


def entrada(padre, ancho=None, centrado=True, **kw):
    op = dict(bg=CAMPO, fg=TEXTO, font=MONO, bd=0, highlightthickness=1,
              highlightbackground=REJILLA, highlightcolor=ACENTO,
              insertbackground=TEXTO,
              justify="center" if centrado else "left")
    op.update(kw)
    if ancho:
        op["width"] = ancho
    return tk.Entry(padre, **op)


def boton(padre, texto, comando, **kw):
    op = dict(text=texto, command=comando, bg=BOTON, fg=TEXTO, font=MONO,
              bd=0, relief=tk.FLAT, activebackground=BOTON_ACTIVO,
              activeforeground=TEXTO, padx=10, pady=3, cursor="hand2")
    op.update(kw)
    return tk.Button(padre, **op)


def lista(padre, alto=6, **kw):
    op = dict(bg=CAMPO, fg=TEXTO, font=MONO, height=alto, bd=0,
              highlightthickness=1, highlightbackground=REJILLA,
              selectbackground=BOTON_ACTIVO, selectforeground=TEXTO,
              activestyle="none", exportselection=False)
    op.update(kw)
    return tk.Listbox(padre, **op)


def texto(padre, **kw):
    op = dict(bg=HOJA, fg=TEXTO, font=("Consolas", 11), bd=0,
              highlightthickness=0, insertbackground=TEXTO, wrap="none",
              undo=True, padx=8, pady=6, selectbackground="#264f78")
    op.update(kw)
    return tk.Text(padre, **op)


def separador(padre):
    return tk.Frame(padre, bg=REJILLA, height=1)


def marco_desplazable(padre, alto=140):
    """Marco con barra vertical. Devuelve (contenedor, interior).

    Los widgets se meten en `interior`; el contenedor es el que se empaqueta.
    Sirve para listas que pueden crecer mucho, como la de equipos.
    """
    contenedor = tk.Frame(padre, bg=PANEL)
    lienzo = tk.Canvas(contenedor, bg=PANEL, bd=0, highlightthickness=0,
                       height=alto)
    barra = tk.Scrollbar(contenedor, orient="vertical", command=lienzo.yview,
                         bg=PANEL, troughcolor=FONDO, bd=0, highlightthickness=0)
    interior = tk.Frame(lienzo, bg=PANEL)
    ventana = lienzo.create_window((0, 0), window=interior, anchor="nw")
    lienzo.configure(yscrollcommand=barra.set)

    interior.bind("<Configure>",
                  lambda e: lienzo.configure(scrollregion=lienzo.bbox("all")))
    lienzo.bind("<Configure>", lambda e: lienzo.itemconfig(ventana, width=e.width))

    def rueda(evento):
        lienzo.yview_scroll(int(-evento.delta / 120), "units")

    contenedor.bind("<Enter>", lambda e: contenedor.bind_all("<MouseWheel>", rueda))
    contenedor.bind("<Leave>", lambda e: contenedor.unbind_all("<MouseWheel>"))

    barra.pack(side=tk.RIGHT, fill=tk.Y)
    lienzo.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    contenedor.lienzo = lienzo   # para poder ajustarle el alto después
    return contenedor, interior


# --------------------------------------------------------------------------
# Navegación por teclado
# --------------------------------------------------------------------------

def encadenar(widgets, al_final=None):
    """Enter (y flecha abajo) avanza; flecha arriba retrocede.

    En el último campo, Enter ejecuta `al_final` si se indicó; si no, regresa
    al primero para poder seguir capturando en ciclo.
    """
    widgets = [w for w in widgets if w is not None]
    if not widgets:
        return

    def ir(indice):
        destino = widgets[indice % len(widgets)]
        destino.focus_set()
        if isinstance(destino, tk.Entry):
            destino.selection_range(0, tk.END)
            destino.icursor(tk.END)
        return "break"

    for i, w in enumerate(widgets):
        ultimo = (i == len(widgets) - 1)
        if ultimo and al_final is not None:
            w.bind("<Return>", lambda e, f=al_final: (f(), "break")[1])
        else:
            w.bind("<Return>", lambda e, k=i + 1: ir(k))
        w.bind("<Down>", lambda e, k=i + 1: ir(k))
        w.bind("<Up>", lambda e, k=i - 1: ir(k))


def enfocar(widget):
    if widget is None:
        return
    widget.focus_set()
    if isinstance(widget, tk.Entry):
        widget.selection_range(0, tk.END)


def escape_cierra(ventana):
    ventana.bind("<Escape>", lambda e: ventana.destroy())
