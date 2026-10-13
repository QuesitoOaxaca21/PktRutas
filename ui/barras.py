"""Barras de desplazamiento delgadas, como las de Windows 11.

Las de Tk en Windows son las clásicas, blancas, y no se pueden pintar. Éstas
son un Canvas del color de la hoja con una píldora gris: aparece al mover el
puntero sobre la hoja o al desplazarse, se esconde sola cuando no se usa,
engorda al pasarle el puntero encima y se puede arrastrar. Cuando todo el
texto cabe no se dibuja. La rueda del mouse y el touchpad mueven la hoja como
siempre.
"""

from __future__ import annotations

import tkinter as tk

from . import tema

CARRIL = 12         # px que ocupa la barra
MARGEN = 3          # px entre la píldora y las orillas
MINIMO = 36         # largo mínimo de la píldora
ESPERA = 1500       # ms sin usarla antes de esconderla


class BarraFina(tk.Canvas):
    """Se usa como un tk.Scrollbar: `command` es el yview (o xview) del Text
    y el Text la avisa con `set` en su yscrollcommand (o xscrollcommand)."""

    def __init__(self, padre, orient="vertical", command=None):
        self.vertical = orient == "vertical"
        super().__init__(padre, bg=tema.HOJA, bd=0, highlightthickness=0,
                         width=CARRIL if self.vertical else 1,
                         height=1 if self.vertical else CARRIL)
        self.command = command
        self.inicio, self.fin = 0.0, 1.0
        self.visible = self.encima = False
        self.agarre = None          # dónde se tomó la píldora al arrastrarla
        self._espera = None
        self.bind("<Configure>", lambda e: self._dibujar())
        self.bind("<Enter>", lambda e: self._sobre(True))
        self.bind("<Leave>", lambda e: self._sobre(False))
        self.bind("<ButtonPress-1>", self._presiona)
        self.bind("<B1-Motion>", self._arrastra)
        self.bind("<ButtonRelease-1>", self._suelta)
        self.bind("<MouseWheel>", self._rueda)

    # ------------------------------------------------------------------
    def set(self, inicio, fin):
        inicio, fin = float(inicio), float(fin)
        if (inicio, fin) != (self.inicio, self.fin):
            self.inicio, self.fin = inicio, fin
            self.despertar()

    @property
    def necesaria(self) -> bool:
        return self.fin - self.inicio < 0.999

    def despertar(self):
        """Se muestra y se esconde sola si no se vuelve a usar."""
        self.visible = True
        if self._espera is not None:
            self.after_cancel(self._espera)
        self._espera = self.after(ESPERA, self._dormir)
        self._dibujar()

    def _dormir(self):
        self._espera = None
        if self.encima or self.agarre is not None:
            self._espera = self.after(ESPERA, self._dormir)
            return
        self.visible = False
        self._dibujar()

    # ------------------------------------------------------------------
    def _largo(self) -> int:
        return (self.winfo_height() if self.vertical else self.winfo_width()) - 2 * MARGEN

    def _pildora(self):
        """(desde, hasta) de la píldora sobre el carril, en px."""
        largo = self._largo()
        visible = self.fin - self.inicio
        tam = min(largo, max(MINIMO, visible * largo))
        avance = self.inicio / (1 - visible) if visible < 1 else 0.0
        desde = MARGEN + avance * (largo - tam)
        return desde, desde + tam

    def _dibujar(self):
        self.delete("all")
        if not self.necesaria or not (self.visible or self.encima or self.agarre is not None):
            return
        activa = self.encima or self.agarre is not None
        grueso = 7 if activa else 3
        color = tema.PILDORA_ACTIVA if self.agarre is not None else \
            tema.PILDORA_ENCIMA if self.encima else tema.PILDORA
        desde, hasta = self._pildora()
        radio = grueso / 2
        eje = CARRIL - MARGEN - radio       # pegada a la orilla de afuera
        puntos = (eje, desde + radio, eje, hasta - radio) if self.vertical else \
            (desde + radio, eje, hasta - radio, eje)
        # Una línea gruesa con puntas redondas es una píldora.
        self.create_line(*puntos, width=grueso, fill=color, capstyle=tk.ROUND)

    # ------------------------------------------------------------------
    def _sobre(self, encima):
        self.encima = encima
        self.despertar()

    def _posicion(self, evento) -> float:
        return evento.y if self.vertical else evento.x

    def _presiona(self, evento):
        if not self.necesaria or self.command is None:
            return
        punto = self._posicion(evento)
        desde, hasta = self._pildora()
        if desde <= punto <= hasta:
            self.agarre = punto - desde
            self._dibujar()
        else:       # en el carril: una página hacia ese lado, como en Windows
            self.command("scroll", -1 if punto < desde else 1, "pages")

    def _arrastra(self, evento):
        if self.agarre is None:
            return
        desde, hasta = self._pildora()
        recorrido = self._largo() - (hasta - desde)
        if recorrido <= 0:
            return
        avance = (self._posicion(evento) - self.agarre - MARGEN) / recorrido
        avance = min(1.0, max(0.0, avance))
        self.command("moveto", avance * (1 - (self.fin - self.inicio)))

    def _suelta(self, _evento):
        self.agarre = None
        self.despertar()

    def _rueda(self, evento):
        """La rueda sobre la barra mueve la hoja igual que sobre el texto."""
        if self.command is not None and evento.delta:
            paso = -evento.delta // 3 if evento.delta > 0 else (2 - evento.delta) // 3
            self.command("scroll", paso, "pixels")
        return "break"
