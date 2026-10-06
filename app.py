"""PktRutas - interfaz gráfica.

Una sola ventana con dos vistas: F1 carga el archivo .pkt y F2 muestra la
salida de comandos. Ningún error cierra el programa: todo se reporta en la
barra de estado.

    python app.py                 abre la ventana vacía
    python app.py practica.pkt    abre la ventana con el archivo ya analizado
"""

from __future__ import annotations

import sys
import traceback
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

from pkt import VERSION
from ui import tema
from ui.menu import BarraMenu
from ui.nucleo import Proyecto
from ui.panel_archivo import PanelArchivo
from ui.panel_salida import PanelSalida

COLOR_NIVEL = {"info": tema.TENUE, "ok": tema.OK, "aviso": "#ffc861",
               "error": tema.ERROR}


class Aplicacion:
    def __init__(self, root, archivo=None):
        self.root = root
        self.proyecto = Proyecto()
        self.compacto = False

        root.title("PktRutas %s - configuración Cisco desde un .pkt" % VERSION)
        root.geometry("1120x720")
        root.minsize(520, 360)
        root.configure(bg=tema.FONDO)
        try:    # default=: también para los diálogos
            root.iconbitmap(default=str(Path(__file__).with_name("pktrutas.ico")))
        except tk.TclError:
            pass        # sin el ícono se queda el de Tk
        tema.barra_oscura(root)
        root.report_callback_exception = self._error_no_atrapado

        self.barra = tk.Frame(root, bg=tema.BARRA)
        self.barra.pack(fill=tk.X)
        # La barra de estado se empaqueta antes que el area central: asi
        # reserva su renglon y el texto no se la come al crecer.
        self._barra_estado()
        self.contenedor = tk.Frame(root, bg=tema.BARRA)
        self.contenedor.pack(fill=tk.BOTH, expand=True)

        self.paneles = [
            PanelArchivo(self.contenedor, self),
            PanelSalida(self.contenedor, self),
        ]
        self.salida = self.paneles[-1]
        self.activo = None
        self._pintar_menu()
        self._atajos()

        self.mostrar(0)
        self.estado("Listo. Abre un .pkt con Ctrl+O o arrástralo sobre Analizar.bat.")
        if archivo:
            self.root.after(120, lambda: self.paneles[0].cargar(archivo))

    # ------------------------------------------------------------------
    # Armado de la ventana
    # ------------------------------------------------------------------
    def _pintar_menu(self):
        """Menú al estilo del Bloc de notas: Archivo, Editar, Ver y Ayuda."""
        ver = [(p.titulo, p.tecla, (lambda k=i: self.mostrar(k)))
               for i, p in enumerate(self.paneles)]
        definicion = [
            ("Archivo", [
                ("Abrir .pkt...", "Ctrl+O", self._abrir),
                ("Guardar .pkt configurado...", "Ctrl+Shift+S",
                 self.paneles[0].guardar_pkt),
                ("Guardar salida...", "Ctrl+S", self.salida.guardar),
                ("Abrir en Bloc de notas", "Ctrl+B", self.salida.bloc_de_notas),
                None,
                ("Salir", "Ctrl+Q", self.root.destroy),
            ]),
            ("Editar", [
                ("Copiar todo", "Ctrl+Shift+C", self.salida.copiar),
                ("Copiar siguiente equipo", "Ctrl+Entrar",
                 self.salida.copiar_siguiente),
                ("Reiniciar marcas", "", self.salida.reiniciar),
                ("Limpiar salida", "Ctrl+L", self.salida.limpiar),
            ]),
            ("Ver", ver),
            ("Ayuda", [
                ("Guía de uso", "", self._guia),
            ]),
        ]
        BarraMenu(self.barra, definicion).pack(side=tk.LEFT)

    def _barra_estado(self):
        """Una sola línea con segmentos, como la del Bloc de notas."""
        pie = tk.Frame(self.root, bg=tema.BARRA)
        pie.pack(fill=tk.X, side=tk.BOTTOM)
        tk.Frame(pie, bg=tema.REJILLA, height=1).pack(fill=tk.X, side=tk.TOP)
        comun = dict(bg=tema.BARRA, font=("Consolas", 9), pady=3)
        self.lbl_estado = tk.Label(pie, text="", fg=tema.TENUE, anchor="w",
                                   padx=10, **comun)
        self.lbl_estado.pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Label(pie, text="UTF-8", fg="#6f6f6f", padx=10,
                 **comun).pack(side=tk.RIGHT)
        self.lbl_panel = tk.Label(pie, text="", fg="#6f6f6f", padx=10, **comun)
        self.lbl_panel.pack(side=tk.RIGHT)

    def _atajos(self):
        for i, panel in enumerate(self.paneles):
            self.root.bind_all("<%s>" % panel.tecla, lambda e, k=i: self.mostrar(k))
        self.root.bind_all("<Control-Return>", lambda e: self._accion())
        self.root.bind_all("<Control-KP_Enter>", lambda e: self._accion())
        self.root.bind_all("<Control-o>", lambda e: self._abrir())
        self.root.bind_all("<Control-s>", lambda e: (self.salida.guardar(), "break")[1])
        self.root.bind_all("<Control-S>",
                           lambda e: (self.paneles[0].guardar_pkt(), "break")[1])
        self.root.bind_all("<Control-b>", lambda e: (self.salida.bloc_de_notas(), "break")[1])
        self.root.bind_all("<Control-l>", lambda e: (self.salida.limpiar(), "break")[1])
        self.root.bind_all("<Control-C>", lambda e: (self.salida.copiar(), "break")[1])
        self.root.bind_all("<Control-q>", lambda e: self.root.destroy())
        self.root.bind("<Configure>", self._al_redimensionar)

    # ------------------------------------------------------------------
    # Navegación
    # ------------------------------------------------------------------
    def mostrar(self, indice):
        if self.activo is not None:
            self.paneles[self.activo].marco.pack_forget()
        self.activo = indice % len(self.paneles)
        panel = self.paneles[self.activo]
        panel.marco.pack(fill=tk.BOTH, expand=True)
        self.lbl_panel.configure(text="%s  %s" % (panel.tecla, panel.titulo))
        panel.al_entrar()
        return "break"

    def _al_redimensionar(self, evento):
        """Ventana chica: se esconde lo accesorio y queda lo indispensable."""
        if evento.widget is not self.root:
            return
        compacto = evento.width < 880 or evento.height < 540
        if compacto == self.compacto:
            return
        self.compacto = compacto
        for panel in self.paneles:
            panel.compactar(compacto)

    def _accion(self):
        self.paneles[self.activo].accion()
        return "break"

    def _abrir(self):
        self.mostrar(0)
        self.paneles[0].abrir()
        return "break"

    def _guia(self):
        guia = Path(__file__).with_name("GUIA.html")
        if not guia.exists():
            self.estado("No se encontró GUIA.html junto al programa", "error")
            return
        webbrowser.open(guia.as_uri())
        self.estado("La guía de uso se abrió en el navegador")

    # ------------------------------------------------------------------
    # Servicios para los paneles
    # ------------------------------------------------------------------
    def estado(self, mensaje, nivel="info"):
        self.lbl_estado.configure(text=mensaje,
                                  fg=COLOR_NIVEL.get(nivel, tema.TENUE))

    def volcar(self, lineas, bloques=None):
        """`bloques` = [(equipo, texto)] para los botones de copiar por equipo."""
        self.salida.escribir(lineas, bloques)
        self.mostrar(len(self.paneles) - 1)

    # ------------------------------------------------------------------
    def _error_no_atrapado(self, tipo, valor, rastro):
        detalle = "".join(traceback.format_exception(tipo, valor, rastro))
        self.estado("Error: %s" % valor, "error")
        messagebox.showerror(
            "Ocurrió un error",
            "El programa sigue abierto. Detalle:\n\n" + detalle[-1800:])


def crear_ventana():
    """Usa tkinterdnd2 si está instalado, para poder soltar el .pkt encima."""
    try:
        from tkinterdnd2 import TkinterDnD
        return TkinterDnD.Tk(), True
    except Exception:
        return tk.Tk(), False


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    archivo = argv[0] if argv else None

    root, con_dnd = crear_ventana()
    app = Aplicacion(root, archivo)

    if con_dnd:
        try:
            from tkinterdnd2 import DND_FILES
            root.drop_target_register(DND_FILES)
            root.dnd_bind("<<Drop>>", lambda e: app.paneles[0].cargar(
                e.data.strip().strip("{}")))
            app.estado("Listo. Puedes soltar un .pkt sobre la ventana.")
        except Exception:
            pass

    root.mainloop()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        try:    # sin consola visible, el detalle tiene que quedar en disco
            registro = Path(__file__).with_name("error.log")
            registro.write_text(traceback.format_exc(), encoding="utf-8")
        except Exception:
            pass
        try:
            messagebox.showerror("PktRutas no pudo abrir",
                                 traceback.format_exc()[-1800:])
        except Exception:
            input("\nOcurrió un error. Presiona Enter para cerrar...")
        sys.exit(1)
