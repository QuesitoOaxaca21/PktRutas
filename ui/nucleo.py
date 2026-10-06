"""Estado compartido entre las vistas y clase base de las vistas."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Proyecto:
    """El archivo .pkt cargado y lo que se calculó de él."""

    ruta_pkt: object = None
    formato_pkt: str = ""
    topologia: object = None
    subredes: list = field(default_factory=list)
    rutas_pkt: dict = field(default_factory=dict)
    inalcanzables: list = field(default_factory=list)
    hallazgos: list = field(default_factory=list)


class Panel:
    """Base de las vistas. Cada una vive en su propio Frame."""

    tecla = ""
    titulo = ""
    ayuda = ""
    relleno = (16, 12)   # margen interno; la Salida lo pone en cero

    def __init__(self, padre, app):
        import tkinter as tk
        from . import tema

        self.app = app
        self.proyecto = app.proyecto
        self.marco = tk.Frame(padre, bg=tema.PANEL,
                              padx=self.relleno[0], pady=self.relleno[1])
        self.primero = None
        self.construir()

    # --- ganchos que sobreescribe cada vista ---
    def construir(self):
        raise NotImplementedError

    def al_entrar(self):
        """Se llama al mostrar la vista."""
        from . import tema
        tema.enfocar(self.primero)

    def accion(self):
        """Acción principal de la vista (Ctrl+Enter)."""

    def compactar(self, compacto):
        """Ventana chica: cada vista esconde lo accesorio. Por omisión, nada."""

    # --- utilidades para las vistas ---
    def estado(self, mensaje, nivel="info"):
        self.app.estado(mensaje, nivel)
