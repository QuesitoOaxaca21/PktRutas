"""Barra de menú propia, al estilo del Bloc de notas de Windows 11.

La barra de menú nativa de Tk se dibuja con los colores del sistema y en
Windows sale gris claro, que desentona en el tema oscuro. Ésta son etiquetas
normales que despliegan un `tk.Menu` emergente, y ese sí se puede pintar.
"""

from __future__ import annotations

import tkinter as tk

from . import tema


class BarraMenu(tk.Frame):
    """`definicion` = [(título, [entrada | None, ...]), ...]

    Cada entrada es (etiqueta, atajo, comando), o (etiqueta, atajo, comando,
    variable) para una opción con palomita. `None` dibuja un separador.
    """

    def __init__(self, padre, definicion):
        super().__init__(padre, bg=tema.BARRA)
        self.menus = {}
        for titulo, entradas in definicion:
            etiqueta = tk.Label(self, text=titulo, bg=tema.BARRA, fg=tema.TEXTO,
                                font=tema.UI, padx=10, pady=4)
            etiqueta.pack(side=tk.LEFT, padx=(4, 0), pady=2)
            menu = self._armar(entradas)
            etiqueta.bind("<Button-1>", lambda e, m=menu, w=etiqueta: self._abrir(m, w))
            etiqueta.bind("<Enter>", lambda e, w=etiqueta: w.configure(bg=tema.RESALTE))
            etiqueta.bind("<Leave>", lambda e, w=etiqueta: w.configure(bg=tema.BARRA))
            self.menus[titulo] = menu

    def _armar(self, entradas):
        menu = tk.Menu(self, tearoff=0, bg=tema.MENU, fg=tema.TEXTO,
                       activebackground=tema.MENU_ACTIVO, activeforeground=tema.TEXTO,
                       selectcolor=tema.TEXTO, bd=0, font=tema.UI, relief=tk.FLAT)
        for entrada in entradas:
            if entrada is None:
                menu.add_separator()
            elif len(entrada) == 4:
                etiqueta, atajo, comando, variable = entrada
                menu.add_checkbutton(label=etiqueta, accelerator=atajo, command=comando,
                                     variable=variable, onvalue=True, offvalue=False)
            else:
                etiqueta, atajo, comando = entrada
                menu.add_command(label=etiqueta, accelerator=atajo, command=comando)
        return menu

    def _abrir(self, menu, widget):
        menu.tk_popup(widget.winfo_rootx(),
                      widget.winfo_rooty() + widget.winfo_height())
