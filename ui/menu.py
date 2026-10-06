"""Barra de menú propia, al estilo del Bloc de notas de Windows 11.

La barra de menú nativa de Tk se dibuja con los colores del sistema y en
Windows sale gris claro, que desentona con el resto. Ésta son etiquetas
normales que despliegan un `tk.Menu` emergente, y ese sí se puede pintar.
"""

from __future__ import annotations

import tkinter as tk

from . import tema


class BarraMenu(tk.Frame):
    """`definicion` = [(título, [(etiqueta, atajo, comando) | None, ...]), ...]

    Un elemento `None` dentro de un menú dibuja un separador.
    """

    def __init__(self, padre, definicion):
        super().__init__(padre, bg=tema.BARRA)
        self.menus = []
        for titulo, entradas in definicion:
            etiqueta = tk.Label(self, text=" %s " % titulo, bg=tema.BARRA,
                                fg=tema.TEXTO, font=tema.MONO, padx=6, pady=3)
            etiqueta.pack(side=tk.LEFT)
            menu = self._armar(entradas)
            etiqueta.bind("<Button-1>", lambda e, m=menu, w=etiqueta: self._abrir(m, w))
            etiqueta.bind("<Enter>", lambda e, w=etiqueta: w.configure(bg=tema.BOTON))
            etiqueta.bind("<Leave>", lambda e, w=etiqueta: w.configure(bg=tema.BARRA))
            self.menus.append(menu)

    def _armar(self, entradas):
        menu = tk.Menu(self, tearoff=0, bg=tema.PANEL, fg=tema.TEXTO,
                       activebackground=tema.BOTON_ACTIVO,
                       activeforeground=tema.TEXTO, bd=0,
                       font=tema.MONO, relief=tk.FLAT)
        for entrada in entradas:
            if entrada is None:
                menu.add_separator()
                continue
            etiqueta, atajo, comando = entrada
            menu.add_command(label=etiqueta, accelerator=atajo, command=comando)
        return menu

    def _abrir(self, menu, widget):
        menu.tk_popup(widget.winfo_rootx(),
                      widget.winfo_rooty() + widget.winfo_height())
