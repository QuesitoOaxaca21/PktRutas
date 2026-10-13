"""PktRutas - la ventana.

A imagen del Bloc de notas de Windows 11: la barra de menú, la hoja con los
comandos y la barra de estado, nada más. Archivo > Abrir carga un .pkt y la
hoja se llena con los comandos de cada equipo, separados por '==='; desde el
mismo menú se guardan los comandos o la copia del .pkt con todo ya aplicado.
Ningún error cierra el programa: se avisa en la barra de estado.

    python app.py                 abre la ventana vacía
    python app.py practica.pkt    abre la ventana con el archivo ya analizado
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import traceback
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox

from pkt import VERSION, escribir, formato, reporte
from pkt import red as analisis
from pkt.descifrar import descifrar_archivo
from pkt.modelo import leer_topologia
from ui import tema
from ui.menu import BarraMenu

PAGINA = "https://github.com/QuesitoOaxaca21/PktRutas"
PISTA = ("Archivo > Abrir .pkt (Ctrl+O) para generar los comandos de tu práctica.\n"
         "\n"
         "Salen equipo por equipo, separados por ===. Ctrl+Enter copia el siguiente\n"
         "equipo para pegarlo en su CLI, y Archivo > Guardar .pkt configurado escribe\n"
         "una copia de la práctica con todo ya aplicado.\n")
ZOOMS = (50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300)
LETRA = 11      # puntos, al 100 %
COLOR = {"info": tema.TENUE, "ok": tema.OK, "aviso": tema.AVISO, "error": tema.ERROR}


def abrir_en_bloc(ruta):
    """Abre un .txt en el Bloc de notas."""
    if os.name == "nt":
        subprocess.Popen(["notepad.exe", str(ruta)])
    else:
        webbrowser.open(Path(ruta).as_uri())


def _equipo(bloque):
    """El hostname de un bloque de comandos, que dice de qué equipo es."""
    for linea in bloque.splitlines():
        if linea.upper().startswith("HOSTNAME "):
            return linea.split(None, 1)[1].strip()
    return None


class Aplicacion:
    def __init__(self, root, archivo=None):
        self.root = root
        self.ruta = None            # el .pkt cargado
        self.reporte = ""
        self.copiados = 0           # bloques ya copiados con Ctrl+Enter
        self.zoom = 100
        self.ajuste = tk.BooleanVar(value=False)
        self.ver_estado = tk.BooleanVar(value=True)

        root.title("Sin título - PktRutas")
        root.geometry("960x640")
        root.minsize(420, 260)
        root.configure(bg=tema.BARRA)
        try:    # default=: también para los diálogos
            root.iconbitmap(default=str(Path(__file__).with_name("pktrutas.ico")))
        except tk.TclError:
            pass        # sin el ícono se queda el de Tk
        tema.barra_oscura(root)
        root.report_callback_exception = self._error_no_atrapado

        self._menu()
        self._barra_estado()        # antes que la hoja: así reserva su renglón
        self._hoja()
        self._atajos()
        self._pista()
        if archivo:
            root.after(120, lambda: self.cargar(archivo))

    # ------------------------------------------------------------------
    # Armado de la ventana
    # ------------------------------------------------------------------
    def _menu(self):
        definicion = [
            ("Archivo", [
                ("Abrir .pkt...", "Ctrl+O", self.abrir),
                ("Volver a cargar", "F5", self.recargar),
                None,
                ("Guardar comandos como...", "Ctrl+S", self.guardar_comandos),
                ("Guardar .pkt configurado...", "Ctrl+Mayús+S", self.guardar_pkt),
                None,
                ("Salir", "Ctrl+Q", self.root.destroy),
            ]),
            ("Editar", [
                ("Deshacer", "Ctrl+Z", lambda: self.texto.event_generate("<<Undo>>")),
                None,
                ("Cortar", "Ctrl+X", lambda: self.texto.event_generate("<<Cut>>")),
                ("Copiar", "Ctrl+C", lambda: self.texto.event_generate("<<Copy>>")),
                ("Pegar", "Ctrl+V", lambda: self.texto.event_generate("<<Paste>>")),
                None,
                ("Copiar siguiente equipo", "Ctrl+Entrar", self.copiar_siguiente),
                ("Empezar desde el primer equipo", "", self.reiniciar),
                ("Copiar todo", "Ctrl+Mayús+C", self.copiar_todo),
                None,
                ("Seleccionar todo", "Ctrl+A", self.seleccionar_todo),
            ]),
            ("Ver", [
                ("Acercar", "Ctrl+Más", lambda: self.acercar(1)),
                ("Alejar", "Ctrl+Menos", lambda: self.acercar(-1)),
                ("Restaurar zoom", "Ctrl+0", lambda: self.acercar(0)),
                None,
                ("Ajuste de línea", "", self._ajustar, self.ajuste),
                ("Barra de estado", "", self._mostrar_estado, self.ver_estado),
                None,
                ("Reporte completo", "Ctrl+R", self.ver_reporte),
            ]),
            ("Ayuda", [
                ("Guía de uso", "", self.guia),
                ("Acerca de PktRutas", "", self.acerca),
            ]),
        ]
        self.barra_menu = BarraMenu(self.root, definicion)
        self.barra_menu.pack(fill=tk.X)

    def _barra_estado(self):
        """Como la del Bloc de notas: el mensaje a la izquierda y a la derecha
        la posición, el zoom, el fin de línea y la codificación."""
        self.pie = tk.Frame(self.root, bg=tema.BARRA)
        self.pie.pack(fill=tk.X, side=tk.BOTTOM)
        tk.Frame(self.pie, bg=tema.LINEA, height=1).pack(fill=tk.X, side=tk.TOP)
        comun = dict(bg=tema.BARRA, fg=tema.TENUE, font=tema.UI_CHICA, pady=4, padx=12)
        segmentos = []
        for texto in ("UTF-8", "Windows (CRLF)", "100 %", "Lín. 1, col. 1"):
            segmento = tk.Label(self.pie, text=texto, **comun)
            segmento.pack(side=tk.RIGHT)
            segmentos.append(segmento)
        self.lbl_zoom, self.lbl_posicion = segmentos[2], segmentos[3]
        self.lbl_estado = tk.Label(self.pie, text="", anchor="w", **comun)
        self.lbl_estado.pack(side=tk.LEFT, fill=tk.X, expand=True)

    def _hoja(self):
        self.marco_hoja = tk.Frame(self.root, bg=tema.HOJA)
        self.marco_hoja.pack(fill=tk.BOTH, expand=True)
        self.texto = tk.Text(
            self.marco_hoja, bg=tema.HOJA, fg=tema.TEXTO, insertbackground=tema.TEXTO,
            selectbackground=tema.SELECCION, selectforeground=tema.TEXTO,
            inactiveselectbackground=tema.SELECCION, font=(tema.LETRA_HOJA, LETRA),
            bd=0, highlightthickness=0, wrap="none", undo=True, padx=10, pady=8)
        self.vertical = tk.Scrollbar(self.marco_hoja, command=self.texto.yview)
        self.horizontal = tk.Scrollbar(self.marco_hoja, orient="horizontal",
                                       command=self.texto.xview)
        self.texto.configure(yscrollcommand=self.vertical.set,
                             xscrollcommand=self.horizontal.set)
        self.texto.grid(row=0, column=0, sticky="nsew")
        self.vertical.grid(row=0, column=1, sticky="ns")
        self.horizontal.grid(row=1, column=0, sticky="ew")
        self.marco_hoja.grid_rowconfigure(0, weight=1)
        self.marco_hoja.grid_columnconfigure(0, weight=1)
        self.texto.tag_configure("pista", foreground=tema.TENUE)
        for evento in ("<KeyRelease>", "<ButtonRelease-1>"):
            self.texto.bind(evento, lambda e: self._posicion(), add="+")
        self.texto.focus_set()

    def _atajos(self):
        atajos = [
            ("<Control-o>", self.abrir), ("<F5>", self.recargar),
            ("<Control-s>", self.guardar_comandos), ("<Control-S>", self.guardar_pkt),
            ("<Control-Return>", self.copiar_siguiente),
            ("<Control-KP_Enter>", self.copiar_siguiente),
            ("<Control-C>", self.copiar_todo), ("<Control-a>", self.seleccionar_todo),
            ("<Control-r>", self.ver_reporte), ("<Control-q>", self.root.destroy),
            ("<Control-plus>", lambda: self.acercar(1)),
            ("<Control-equal>", lambda: self.acercar(1)),
            ("<Control-KP_Add>", lambda: self.acercar(1)),
            ("<Control-minus>", lambda: self.acercar(-1)),
            ("<Control-KP_Subtract>", lambda: self.acercar(-1)),
            ("<Control-0>", lambda: self.acercar(0)),
        ]
        for secuencia, funcion in atajos:
            # En la hoja también: si no, el Text hace lo suyo antes (Ctrl+O
            # abre un renglón, Ctrl+Enter mete un salto).
            manejador = lambda e, f=funcion: (f(), "break")[1]
            self.texto.bind(secuencia, manejador)
            self.root.bind_all(secuencia, manejador)
        self.texto.bind("<Control-MouseWheel>",
                        lambda e: (self.acercar(1 if e.delta > 0 else -1), "break")[1])

    # ------------------------------------------------------------------
    # La hoja
    # ------------------------------------------------------------------
    def _pista(self):
        self.texto.configure(state="normal")
        self.texto.delete("1.0", tk.END)
        self.texto.insert("1.0", PISTA, "pista")
        self.texto.configure(state="disabled")
        self.estado("Abre una práctica de Packet Tracer con Ctrl+O.")

    def _poner_texto(self, texto):
        self.texto.configure(state="normal")
        self.texto.delete("1.0", tk.END)
        self.texto.insert("1.0", texto)
        self.texto.edit_reset()         # que Ctrl+Z no regrese a lo anterior
        self.texto.mark_set(tk.INSERT, "1.0")
        self.texto.see("1.0")
        self.copiados = 0
        self._posicion()

    def contenido(self) -> str:
        """Lo que está en la hoja (vacío si todavía no hay comandos)."""
        if self.ruta is None:
            return ""
        return self.texto.get("1.0", "end-1c")

    def _posicion(self):
        linea, columna = self.texto.index(tk.INSERT).split(".")
        self.lbl_posicion.configure(text="Lín. %s, col. %d" % (linea, int(columna) + 1))

    def acercar(self, paso):
        """Zoom como el del Bloc de notas: `paso` 1 acerca, -1 aleja, 0 al 100 %."""
        if paso == 0:
            self.zoom = 100
        else:
            i = ZOOMS.index(self.zoom) + paso
            self.zoom = ZOOMS[max(0, min(len(ZOOMS) - 1, i))]
        self.texto.configure(font=(tema.LETRA_HOJA, max(4, round(LETRA * self.zoom / 100))))
        self.lbl_zoom.configure(text="%d %%" % self.zoom)

    def _ajustar(self):
        if self.ajuste.get():
            self.texto.configure(wrap="word")
            self.horizontal.grid_remove()
        else:
            self.texto.configure(wrap="none")
            self.horizontal.grid()

    def _mostrar_estado(self):
        if self.ver_estado.get():
            self.pie.pack(fill=tk.X, side=tk.BOTTOM, before=self.marco_hoja)
        else:
            self.pie.pack_forget()

    def estado(self, mensaje, nivel="info"):
        self.lbl_estado.configure(text=mensaje, fg=COLOR.get(nivel, tema.TENUE))

    # ------------------------------------------------------------------
    # Archivo
    # ------------------------------------------------------------------
    def abrir(self):
        ruta = filedialog.askopenfilename(
            title="Abrir práctica de Packet Tracer",
            initialdir=str(self.ruta.parent) if self.ruta else None,
            filetypes=[("Packet Tracer", "*.pkt *.pka"), ("Todos", "*.*")])
        if ruta:
            self.cargar(ruta)

    def recargar(self):
        """Después de guardar cambios en Packet Tracer."""
        if self.ruta is None:
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        self.cargar(self.ruta)

    def cargar(self, ruta):
        ruta = Path(str(ruta).strip().strip('"'))
        if not ruta.is_file():
            self.estado("No existe el archivo: %s" % ruta, "error")
            return
        self.estado("Leyendo %s ..." % ruta.name)
        self.root.update_idletasks()
        try:
            xml, formato_pkt = descifrar_archivo(ruta)
        except Exception as exc:
            self.estado("No se pudo leer %s: %s" % (ruta.name, exc), "error")
            return
        topo = leer_topologia(xml)
        subredes = analisis.construir_subredes(topo)
        rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
        hallazgos = analisis.revisar(topo, subredes, rutas)
        self.ruta = ruta
        self.reporte = reporte.construir(ruta.name, formato_pkt, topo, subredes, rutas,
                                         inalcanzables, hallazgos)

        bloques = reporte.comandos_por_equipo(topo, rutas)
        completa = not bloques      # nada pendiente: se muestra todo
        if completa:
            bloques = reporte.comandos_por_equipo(topo, rutas, completa=True)
        self._poner_texto(reporte.texto_comandos(bloques))
        self.root.title("%s - PktRutas" % ruta.name)

        if not bloques:
            mensaje = "No se reconoció ningún ruteador que configurar."
        elif completa:
            mensaje = ("No le falta nada: es la configuración completa de sus %d equipos."
                       % len(bloques))
        else:
            mensaje = "%d equipo(s) por configurar; Ctrl+Enter copia el primero." % len(bloques)
        # Lo que arreglan los mismos comandos (las rutas que faltan) no se
        # cuenta: en una práctica en blanco faltan todas.
        errores = sum(h.nivel == analisis.ERROR and not h.resuelto for h in hallazgos)
        avisos = sum(h.nivel == analisis.AVISO and not h.resuelto for h in hallazgos)
        if errores or avisos:
            mensaje += " %d error(es) y %d aviso(s): Ver > Reporte completo." % (errores, avisos)
        self.estado(mensaje, "aviso" if errores or avisos else "ok")

    def guardar_comandos(self):
        texto = self.contenido()
        if not texto.strip():
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        ruta = filedialog.asksaveasfilename(
            title="Guardar comandos", defaultextension=".txt",
            initialdir=str(self.ruta.parent), initialfile=self.ruta.stem + "_comandos.txt",
            filetypes=[("Texto", "*.txt"), ("Todos", "*.*")])
        if not ruta:
            return
        Path(ruta).write_text(texto.rstrip("\n") + "\n", encoding="utf-8", newline="\r\n")
        self.estado("Guardado %s" % Path(ruta).name, "ok")

    def guardar_pkt(self):
        """Copia del .pkt con todo lo generado ya aplicado, para abrirla en
        Packet Tracer sin pegar nada. El original no se toca."""
        origen = self.ruta
        if origen is None:
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        ruta = filedialog.asksaveasfilename(
            title="Guardar .pkt configurado", defaultextension=".pkt",
            initialdir=str(origen.parent), initialfile=origen.stem + "_configurado.pkt",
            filetypes=[("Packet Tracer", "*.pkt")])
        if not ruta:
            return
        if Path(ruta).resolve() == origen.resolve():
            self.estado("No se sobrescribe el original: elige otro nombre.", "error")
            return
        self.estado("Escribiendo %s ..." % Path(ruta).name)
        self.root.update_idletasks()
        try:
            resumen = escribir.escribir(origen, ruta)
        except Exception as exc:
            self.estado("No se pudo escribir el .pkt: %s" % exc, "error")
            return
        pcs = ""
        if resumen["pcs"]:
            pcs += ", %d PC(s) en DHCP" % resumen["pcs"]
        if resumen["renombradas"]:
            pcs += ", %d con su nombre original" % resumen["renombradas"]
        if resumen["sin_renombrar"]:
            pcs += " (%s se quedaron igual: su nombre ya lo usa otro equipo)" \
                   % ", ".join(resumen["sin_renombrar"])
        if not resumen["equipos"] and not resumen["pcs"] and not resumen["renombradas"]:
            self.estado("No había nada que aplicar: la copia quedó igual al original.", "ok")
        elif any(resumen["quedan"]):
            self.estado("Guardado %s, pero al volver a leerlo aún faltan %s: revisa el "
                        "reporte." % (Path(ruta).name,
                                      reporte.texto_pendientes(*resumen["quedan"])), "aviso")
        else:
            self.estado("Guardado %s: %d equipo(s) configurados%s. Ábrelo en Packet Tracer."
                        % (Path(ruta).name, len(resumen["equipos"]), pcs),
                        "aviso" if resumen["sin_renombrar"] else "ok")

    # ------------------------------------------------------------------
    # Editar
    # ------------------------------------------------------------------
    def copiar_siguiente(self):
        """Copia el bloque del siguiente equipo y lo deja seleccionado en la
        hoja. Sale de lo que haya en la hoja, con todo y lo que le cambies."""
        if self.ruta is None:
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        bloques = formato.partir(self.contenido())
        if self.copiados >= len(bloques):
            self.estado("Ya copiaste los %d equipos. Editar > Empezar desde el primer "
                        "equipo para volver a empezar." % len(bloques), "ok")
            return
        inicio, fin, texto = bloques[self.copiados]
        self.root.clipboard_clear()
        self.root.clipboard_append(texto + "\n")
        self.texto.tag_remove("sel", "1.0", tk.END)
        self.texto.tag_add("sel", "%d.0" % inicio, "%d.end" % fin)
        self.texto.mark_set(tk.INSERT, "%d.0" % inicio)
        self.texto.see("%d.end" % fin)
        self.texto.see("%d.0" % inicio)
        self.copiados += 1
        comandos = sum(1 for l in texto.splitlines()
                       if l.strip() and l.strip().upper() not in ("EN", "CONF T"))
        faltan = len(bloques) - self.copiados
        self.estado("Copiado %s (%d comando%s). Pégalo en su CLI; %s."
                    % (_equipo(texto) or "el equipo %d" % self.copiados, comandos,
                       "" if comandos == 1 else "s",
                       "faltan %d equipo(s)" % faltan if faltan else "era el último"), "ok")
        self._posicion()

    def reiniciar(self):
        self.copiados = 0
        self.estado("Ctrl+Enter vuelve a copiar desde el primer equipo.")

    def copiar_todo(self):
        texto = self.contenido()
        if not texto.strip():
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(texto)
        self.estado("Todos los comandos se copiaron al portapapeles.", "ok")

    def seleccionar_todo(self):
        self.texto.tag_add("sel", "1.0", "end-1c")

    # ------------------------------------------------------------------
    # Ver y Ayuda
    # ------------------------------------------------------------------
    def ver_reporte(self):
        """El reporte completo (plan de VLANs, avisos, detalle del ruteo), en
        el Bloc de notas."""
        if not self.reporte:
            self.estado("Primero abre un .pkt (Ctrl+O).", "error")
            return
        carpeta = Path(tempfile.gettempdir()) / "PktRutas"
        carpeta.mkdir(exist_ok=True)
        ruta = carpeta / (self.ruta.stem + "_reporte.txt")
        ruta.write_text(self.reporte, encoding="utf-8-sig", newline="")
        try:
            abrir_en_bloc(ruta)
        except OSError as exc:
            self.estado("No se pudo abrir el reporte: %s" % exc, "error")
            return
        self.estado("El reporte se abrió en el Bloc de notas.", "ok")

    def guia(self):
        guia = Path(__file__).with_name("GUIA.html")
        if not guia.exists():
            self.estado("No se encontró GUIA.html junto al programa.", "error")
            return
        webbrowser.open(guia.as_uri())
        self.estado("La guía de uso se abrió en el navegador.")

    def acerca(self):
        messagebox.showinfo("Acerca de PktRutas",
                            "PktRutas %s\n\nConfiguración Cisco desde prácticas de Packet "
                            "Tracer (.pkt).\n\n%s" % (VERSION, PAGINA))

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
            root.dnd_bind("<<Drop>>", lambda e: app.cargar(e.data.strip().strip("{}")))
            app.estado("Abre una práctica con Ctrl+O o suéltala sobre la ventana.")
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
