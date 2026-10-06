"""F2 - Salida: los comandos generados, para copiar o guardar.

En la práctica la configuración se pega en un dispositivo a la vez, así que
además de copiar todo hay una lista de equipos: un solo botón va copiando el
siguiente que falte, y la casilla de cada renglón marca los que ya llevas.
Cuando la topología tiene muchos ruteadores la lista se desplaza en vertical,
que es lo único que no se desborda.
"""

from __future__ import annotations

import os
import subprocess
import tkinter as tk
from pathlib import Path
from tkinter import filedialog

from . import tema
from .nucleo import Panel

VACIO = ("Aquí aparecen los comandos generados, equipo por equipo.\n\n"
         "F1  abre un archivo .pkt: el programa genera lo que le falta\n"
         "    (hostnames, enlaces, ruteo, VLANs, DHCP, troncales, EtherChannel\n"
         "    y STP) y aquí aparece todo, listo para pegar.\n"
         "F2  esta vista: Ctrl+Enter copia el siguiente equipo.\n\n"
         "También puedes guardar una copia del .pkt con todo ya aplicado\n"
         "(Ctrl+Shift+S).\n")


_ENVOLTURA = {"enable", "configure terminal", "end", "write memory"}


def _contar_comandos(texto) -> int:
    """Comandos de verdad del bloque: sin comentarios ni enable/end."""
    return sum(1 for linea in texto.splitlines()
               if linea.strip() and not linea.startswith("!")
               and linea.strip() not in _ENVOLTURA)


class PanelSalida(Panel):
    tecla = "F2"
    titulo = "Salida"
    ayuda = ("Ctrl+Enter copiar el siguiente equipo   Ctrl+Shift+C copiar todo   "
             "Ctrl+S guardar   Ctrl+B Bloc de notas")

    relleno = (0, 0)     # a sangre, como la hoja del Bloc de notas

    def construir(self):
        m = self.marco
        m.configure(bg=tema.BARRA)
        self.bloques = []
        self.marcas = {}

        # --- lista de equipos (sólo aparece cuando hay bloques) -------------
        self.equipos = tema.marco(m, tema.BARRA)
        cabecera = tema.marco(self.equipos, tema.BARRA)
        cabecera.pack(fill=tk.X, padx=6, pady=(4, 0))
        self.btn_siguiente = tema.boton(cabecera, "Copiar siguiente",
                                        self.copiar_siguiente,
                                        font=tema.MONO_NEGRITA)
        self.btn_siguiente.pack(side=tk.LEFT)
        tema.boton(cabecera, "Reiniciar marcas", self.reiniciar).pack(side=tk.LEFT,
                                                                     padx=6)
        self.lbl_equipos = tema.etiqueta(
            cabecera, "  la casilla marca los que ya copiaste",
            fondo=tema.BARRA, color=tema.TENUE)
        self.lbl_equipos.pack(side=tk.LEFT)
        self.caja, self.lista = tema.marco_desplazable(self.equipos, alto=132)
        self.caja.pack(fill=tk.X, padx=6, pady=(4, 4))

        contenedor = tema.marco(m, tema.HOJA)
        contenedor.pack(fill=tk.BOTH, expand=True)
        # wrap por palabra: los comandos son cortos y no se parten, pero los
        # renglones largos del reporte se acomodan al ancho de la ventana.
        self.texto = tema.texto(contenedor, wrap="word")
        vertical = tk.Scrollbar(contenedor, command=self.texto.yview,
                                bg=tema.PANEL, troughcolor=tema.FONDO, bd=0,
                                highlightthickness=0)
        self.texto.configure(yscrollcommand=vertical.set)
        self.texto.grid(row=0, column=0, sticky="nsew")
        vertical.grid(row=0, column=1, sticky="ns")
        contenedor.grid_rowconfigure(0, weight=1)
        contenedor.grid_columnconfigure(0, weight=1)

        self.texto.insert("1.0", VACIO)
        self.primero = self.texto

    # ------------------------------------------------------------------
    def compactar(self, compacto):
        if compacto:
            self.lbl_equipos.pack_forget()
        else:
            self.lbl_equipos.pack(side=tk.LEFT)
        self._ajustar_alto()

    def _ajustar_alto(self):
        """La lista crece con el número de equipos y sólo se desplaza a partir
        de unos cuantos, para no comerse el espacio del texto."""
        visibles = min(max(len(self.bloques), 1), 4 if self.app.compacto else 7)
        self.caja.lienzo.configure(height=visibles * 26)

    # ------------------------------------------------------------------
    def escribir(self, lineas, bloques=None):
        if isinstance(lineas, str):
            lineas = lineas.split("\n")
        self.texto.delete("1.0", tk.END)
        self.texto.insert("1.0", "\n".join(lineas))
        self.texto.see("1.0")
        self._pintar_equipos(bloques or [])

    def _pintar_equipos(self, bloques):
        self.bloques = list(bloques)
        self.marcas = {}
        for hijo in self.lista.winfo_children():
            hijo.destroy()
        if not self.bloques:
            self.equipos.pack_forget()
            return
        self.equipos.pack(fill=tk.X, pady=(0, 6),
                          before=self.marco.winfo_children()[-1])

        for nombre, texto, pendientes in self.bloques:
            comandos = _contar_comandos(texto)
            var = tk.BooleanVar(value=False)
            self.marcas[nombre] = var
            fila = tema.marco(self.lista)
            fila.pack(fill=tk.X)
            tk.Checkbutton(fila, variable=var, command=self._refrescar_boton,
                           bg=tema.PANEL, activebackground=tema.PANEL,
                           selectcolor=tema.CAMPO, bd=0,
                           highlightthickness=0).pack(side=tk.LEFT)
            etiqueta = "%-30s %3d comando%s%s" % (
                nombre[:30], comandos, " " if comandos == 1 else "s",
                "" if pendientes else "   (ya completo)")
            tema.boton(fila, etiqueta,
                       lambda n=nombre: self.copiar_equipo(n),
                       anchor="w", font=tema.MONO).pack(side=tk.LEFT, fill=tk.X,
                                                        expand=True, padx=(4, 0))
        self._ajustar_alto()
        self._refrescar_boton()

    def _pendientes(self):
        return [n for n, _, _ in self.bloques if not self.marcas[n].get()]

    def _refrescar_boton(self):
        faltan = self._pendientes()
        if faltan:
            self.btn_siguiente.configure(text="Copiar siguiente: %s" % faltan[0][:22],
                                         state=tk.NORMAL)
        else:
            self.btn_siguiente.configure(text="Todos copiados", state=tk.DISABLED)

    def reiniciar(self):
        for var in self.marcas.values():
            var.set(False)
        self._refrescar_boton()
        self.estado("Marcas reiniciadas: se copiarán todos de nuevo")

    def copiar_siguiente(self):
        faltan = self._pendientes()
        if not faltan:
            self.estado("Ya copiaste los %d equipos. Usa 'Reiniciar marcas' "
                        "para empezar otra vez." % len(self.bloques), "ok")
            return
        self.copiar_equipo(faltan[0])

    def copiar_equipo(self, nombre):
        for n, texto, pendientes in self.bloques:
            if n != nombre:
                continue
            self.app.root.clipboard_clear()
            self.app.root.clipboard_append(texto)
            self.marcas[n].set(True)
            self._refrescar_boton()
            comandos = _contar_comandos(texto)
            faltan = len(self._pendientes())
            self.estado("Copiado: %s  (%d comando%s, %s). "
                        "Pégalo en su CLI; faltan %d equipo(s)."
                        % (n, comandos, "" if comandos == 1 else "s",
                           "lo que le falta" if pendientes
                           else "su configuración completa", faltan), "ok")
            return

    # ------------------------------------------------------------------
    def contenido(self):
        return self.texto.get("1.0", tk.END).rstrip() + "\n"

    def copiar(self):
        self.app.root.clipboard_clear()
        self.app.root.clipboard_append(self.contenido())
        self.estado("Toda la salida copiada al portapapeles", "ok")

    def limpiar(self):
        self.texto.delete("1.0", tk.END)
        self.texto.insert("1.0", VACIO)
        self._pintar_equipos([])
        self.estado("Salida vacía")

    def guardar(self):
        sugerido = "configuracion.txt"
        if self.proyecto.ruta_pkt:
            sugerido = Path(self.proyecto.ruta_pkt).stem + "_config.txt"
        ruta = filedialog.asksaveasfilename(
            title="Guardar la salida", defaultextension=".txt",
            initialfile=sugerido,
            filetypes=[("Texto", "*.txt"), ("Todos", "*.*")])
        if not ruta:
            return None
        Path(ruta).write_text(self.contenido(), encoding="utf-8-sig",
                              newline="\r\n")
        self.estado("Guardado en %s" % ruta, "ok")
        return ruta

    def bloc_de_notas(self):
        ruta = self.guardar()
        if not ruta:
            return
        try:
            if os.name == "nt":
                subprocess.Popen(["notepad.exe", str(ruta)])
            else:
                subprocess.Popen(["xdg-open", str(ruta)])
        except Exception as exc:
            self.estado("No se pudo abrir el Bloc de notas: %s" % exc, "error")

    def accion(self):
        """Ctrl+Enter: si hay equipos, copia el siguiente que falte."""
        if self.bloques:
            self.copiar_siguiente()
        else:
            self.copiar()

    def al_entrar(self):
        self.texto.focus_set()
