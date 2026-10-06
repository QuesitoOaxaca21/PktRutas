"""Prueba de la interfaz: arma la ventana, carga una práctica, recorre las dos
vistas, copia equipo por equipo y guarda el .pkt configurado con el diálogo
simulado.

No abre el bucle de eventos, así que la ventana sólo parpadea un instante.
"""

from __future__ import annotations

import sys
import tempfile
import tkinter as tk
from pathlib import Path

import app as programa
from pkt.descifrar import cifrar_pkt
from prueba_plan import NOTAS, construir
from ui import panel_archivo


def main():
    root, _ = programa.crear_ventana()
    root.geometry("1120x720+40+40")
    aplicacion = programa.Aplicacion(root, None)
    root.update()

    assert [p.tecla for p in aplicacion.paneles] == ["F1", "F2"], \
        [p.tecla for p in aplicacion.paneles]
    for i in range(len(aplicacion.paneles)):
        aplicacion.mostrar(i)
        root.update()
    print("[ok] las dos vistas se dibujan: F1 archivo y F2 salida")

    f1, salida = aplicacion.paneles[0], aplicacion.salida
    with tempfile.TemporaryDirectory() as carpeta:
        practica = Path(carpeta, "practica.pkt")
        practica.write_bytes(cifrar_pkt(construir(NOTAS)))
        assert f1.btn_guardar.cget("state") == tk.DISABLED, \
            "sin archivo no se puede guardar el .pkt configurado"
        f1.cargar(str(practica))
        root.update()
        texto = salida.contenido()
        assert "CONFIGURACIÓN - practica.pkt" in texto and "ip route" in texto, texto[:300]
        assert aplicacion.activo == 1, "al analizar se pasa a la salida"
        assert salida.bloques and f1.btn_guardar.cget("state") == tk.NORMAL
        print("[ok] F1 analiza el .pkt y la salida queda en F2 con la lista de equipos")

        primero = salida.bloques[0]
        salida.copiar_siguiente()
        assert root.clipboard_get() == primero[1]
        assert salida.marcas[primero[0]].get(), "el equipo copiado queda marcado"
        print("[ok] Copiar siguiente copia el primer equipo y lo marca")

        destino = Path(carpeta, "practica_configurado.pkt")
        original = panel_archivo.filedialog.asksaveasfilename
        panel_archivo.filedialog.asksaveasfilename = lambda **kw: str(destino)
        try:
            f1.guardar_pkt()
        finally:
            panel_archivo.filedialog.asksaveasfilename = original
        root.update()
        assert destino.exists() and destino.stat().st_size > 0
        assert aplicacion.lbl_estado.cget("text").startswith("Guardado"), \
            aplicacion.lbl_estado.cget("text")
        print("[ok] Guardar .pkt configurado escribe la copia y lo dice en la barra")

    f1.ent_ruta.delete(0, tk.END)
    f1.ent_ruta.insert(0, "no-existe.pkt")
    f1.analizar()
    assert "No existe" in aplicacion.lbl_estado.cget("text")
    print("[ok] los errores se avisan en la barra de estado, sin cerrar nada")

    root.destroy()
    return 0


if __name__ == "__main__":
    sys.exit(main())
