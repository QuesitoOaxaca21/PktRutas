"""F1 - Cargar un archivo .pkt: lo analiza, genera lo que falta y escribe la
copia configurada."""

from __future__ import annotations

import tkinter as tk
from pathlib import Path
from tkinter import filedialog

from pkt import escribir
from pkt import red as analisis
from pkt import reporte
from pkt.descifrar import descifrar_archivo
from pkt.modelo import leer_topologia

from . import tema
from .nucleo import Panel


class PanelArchivo(Panel):
    tecla = "F1"
    titulo = "Archivo .pkt"
    ayuda = ("Ctrl+O abrir archivo   Ctrl+Enter volver a analizar   "
             "Ctrl+Shift+S guardar .pkt configurado")

    def construir(self):
        m = self.marco
        self.lbl_titulo = tema.titulo(m, "F1 · Archivo de Packet Tracer")
        self.lbl_titulo.pack(anchor="w")
        self.lbl_ayuda = tema.ayuda(
            m, "Elige un .pkt guardado desde Packet Tracer. Si ya configuraste "
               "hostnames y enlaces, el programa genera lo\nque falta; si la "
               "práctica está en blanco, todo sale de sus notas: el nombre de cada "
               "equipo en el lienzo,\nlas notas de enlace (.4, .8...) y las notas "
               "de VLANs. También puedes arrastrar el .pkt sobre Analizar.bat.")
        self.lbl_ayuda.pack(anchor="w", pady=(2, 12))

        self.fila = tema.marco(m)
        self.fila.pack(fill=tk.X)
        self.lbl_archivo = tema.etiqueta(self.fila, "Archivo ")
        self.lbl_archivo.pack(side=tk.LEFT)
        self.ent_ruta = tema.entrada(self.fila, centrado=False)
        self.ent_ruta.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
        self.btn_abrir = tema.boton(self.fila, "Abrir archivo .pkt", self.abrir)
        self.btn_abrir.pack(side=tk.LEFT)
        # Escribe una copia del .pkt con todo lo generado ya aplicado.
        self.btn_guardar = tema.boton(self.fila, "Guardar .pkt configurado",
                                      self.guardar_pkt, disabledforeground=tema.TENUE)
        self.btn_guardar.pack(side=tk.LEFT, padx=(8, 0))
        self.btn_guardar.configure(state=tk.DISABLED)
        self.primero = self.ent_ruta
        self.ent_ruta.bind("<Return>", lambda e: (self.analizar(), "break")[1])

        self.acciones = tema.marco(m)
        self.acciones.pack(fill=tk.X, pady=10)
        tema.boton(self.acciones, "Volver a analizar", self.analizar).pack(side=tk.LEFT)
        tema.etiqueta(self.acciones, "  después de guardar cambios en Packet Tracer",
                      fondo=tema.PANEL, color=tema.TENUE).pack(side=tk.LEFT)

        self.resumen = tema.texto(m, height=14, wrap="word")
        self.resumen.pack(fill=tk.BOTH, expand=True, pady=(6, 0))
        self._escribir("Ningún archivo cargado todavía.")

    def compactar(self, compacto):
        """Ventana chica: sólo los botones del archivo y el resumen."""
        if compacto:
            self.lbl_titulo.pack_forget()
            self.lbl_ayuda.pack_forget()
            self.acciones.pack_forget()
            self.lbl_archivo.pack_forget()
            self.ent_ruta.pack_forget()
            self.fila.pack_configure(pady=(0, 6))
        else:
            self.lbl_titulo.pack(anchor="w", before=self.fila)
            self.lbl_ayuda.pack(anchor="w", pady=(2, 12), before=self.fila)
            self.ent_ruta.pack(side=tk.LEFT, fill=tk.X, expand=True,
                               padx=(0, 8), before=self.btn_abrir)
            self.lbl_archivo.pack(side=tk.LEFT, before=self.ent_ruta)
            self.acciones.pack(fill=tk.X, pady=10, before=self.resumen)
            self.fila.pack_configure(pady=0)

    # ------------------------------------------------------------------
    def _escribir(self, texto):
        self.resumen.configure(state="normal")
        self.resumen.delete("1.0", tk.END)
        self.resumen.insert("1.0", texto)
        self.resumen.configure(state="disabled")

    def abrir(self):
        ruta = filedialog.askopenfilename(
            title="Abrir archivo de Packet Tracer",
            filetypes=[("Packet Tracer", "*.pkt *.pka"), ("Todos", "*.*")])
        if ruta:
            self.cargar(ruta)

    def cargar(self, ruta):
        self.ent_ruta.delete(0, tk.END)
        self.ent_ruta.insert(0, str(ruta))
        self.analizar()

    def accion(self):
        self.analizar()

    # ------------------------------------------------------------------
    def analizar(self):
        ruta = Path(self.ent_ruta.get().strip().strip('"'))
        if not ruta.name:
            self.estado("Escribe o elige un archivo .pkt", "error")
            return
        if not ruta.exists():
            self.estado("No existe el archivo: %s" % ruta, "error")
            self._escribir("No se encontró:\n%s" % ruta)
            return

        self.estado("Descifrando %s ..." % ruta.name)
        self.marco.update_idletasks()
        try:
            xml, formato = descifrar_archivo(ruta)
        except Exception as exc:
            self.estado("No se pudo descifrar el archivo", "error")
            self._escribir("No se pudo descifrar %s\n\n%s" % (ruta.name, exc))
            return

        p = self.proyecto
        p.ruta_pkt, p.formato_pkt = ruta, formato
        p.topologia = leer_topologia(xml)
        p.subredes = analisis.construir_subredes(p.topologia)
        p.rutas_pkt, p.inalcanzables = analisis.calcular_rutas(p.topologia,
                                                               p.subredes)
        p.hallazgos = analisis.revisar(p.topologia, p.subredes, p.rutas_pkt)

        texto = reporte.construir(ruta.name, formato, p.topologia, p.subredes,
                                  p.rutas_pkt, p.inalcanzables, p.hallazgos)
        bloques = reporte.bloques_por_equipo(p.topologia, p.rutas_pkt)
        self.app.volcar(texto.replace("\r\n", "\n").split("\n"), bloques)

        errores = sum(1 for h in p.hallazgos if h.nivel == analisis.ERROR)
        pendientes = reporte.pendientes(p.topologia, p.rutas_pkt)
        plan = p.topologia.plan
        vlans = "%d red(es) con VLANs, de %d nota(s)" % (len(plan.sitios), plan.notas) \
            if plan is not None and not plan.vacio else "sin notas de VLANs"
        self._escribir(
            "Formato:      %s\n"
            "Equipos:      %d   (ruteadores: %d)\n"
            "Subredes:     %d\n"
            "Plan:         %s\n"
            "Errores:      %d\n"
            "Por aplicar:  %s\n\n"
            "Los comandos están en la Salida (F2), equipo por equipo; el detalle de\n"
            "cada enlace configurado o corregido, en la sección 6 del reporte.\n"
            "O usa 'Guardar .pkt configurado' para tener una copia del archivo con "
            "todo ya aplicado."
            % (formato, len(p.topologia.dispositivos), len(p.topologia.ruteadores),
               len(p.subredes), vlans, errores, reporte.texto_pendientes(*pendientes)))
        self.btn_guardar.configure(state=tk.NORMAL)
        self.estado("Listo: %s por aplicar, %d error(es). Ve a F2."
                    % (reporte.texto_pendientes(*pendientes), errores),
                    "ok" if not errores else "aviso")

    def guardar_pkt(self):
        """Copia del .pkt con todo lo generado ya aplicado, para abrirla en
        Packet Tracer sin pegar nada. El original no se toca."""
        origen = self.proyecto.ruta_pkt
        if not origen:
            self.estado("Primero abre un .pkt", "error")
            return
        origen = Path(origen)
        ruta = filedialog.asksaveasfilename(
            title="Guardar .pkt configurado", defaultextension=".pkt",
            initialdir=str(origen.parent), initialfile=origen.stem + "_configurado.pkt",
            filetypes=[("Packet Tracer", "*.pkt")])
        if not ruta:
            return
        if Path(ruta).resolve() == origen.resolve():
            self.estado("No se sobrescribe el original: elige otro nombre", "error")
            return
        self.estado("Escribiendo %s ..." % Path(ruta).name)
        self.marco.update_idletasks()
        try:
            resumen = escribir.escribir(origen, ruta)
        except Exception as exc:
            self.estado("No se pudo escribir el .pkt: %s" % exc, "error")
            return
        quedan = resumen["quedan"]
        pcs = ""
        if resumen["pcs"]:
            pcs += ", %d PC(s) en DHCP" % resumen["pcs"]
        if resumen["renombradas"]:
            pcs += ", %d con su nombre original" % resumen["renombradas"]
        if resumen["sin_renombrar"]:
            pcs += " (%s se quedaron igual: su nombre ya lo usa otro equipo)" \
                   % ", ".join(resumen["sin_renombrar"])
        if not resumen["equipos"] and not resumen["pcs"] and not resumen["renombradas"]:
            self.estado("No había nada que aplicar: la copia quedó igual al original", "ok")
        elif any(quedan):
            self.estado("Guardado %s, pero al volver a leerlo aún faltan %s: revisa el "
                        "reporte" % (Path(ruta).name, reporte.texto_pendientes(*quedan)),
                        "aviso")
        else:
            self.estado("Guardado %s: %d equipo(s) configurados (%s)%s. Ábrelo en Packet "
                        "Tracer." % (Path(ruta).name, len(resumen["equipos"]),
                                     ", ".join(resumen["nombres"][:6]), pcs),
                        "aviso" if resumen["sin_renombrar"] else "ok")
