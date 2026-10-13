"""Prueba de la ventana: la arma, carga una práctica, revisa que la hoja tenga
los comandos con el estilo de las prácticas, copia equipo por equipo, guarda
los comandos y el .pkt configurado (con los diálogos simulados) y abre el
reporte (sin abrir el Bloc de notas de verdad).

No abre el bucle de eventos, así que la ventana sólo parpadea un instante.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import app as programa
from pkt.descifrar import cifrar_pkt
from prueba_plan import NOTAS, construir


def main():
    root, _ = programa.crear_ventana()
    root.geometry("960x640+40+40")
    aplicacion = programa.Aplicacion(root, None)
    root.update()

    assert list(aplicacion.barra_menu.menus) == ["Archivo", "Editar", "Ver", "Ayuda"]
    assert root.title() == "Sin título - PktRutas"
    assert aplicacion.contenido() == "" and "Ctrl+O" in aplicacion.texto.get("1.0", "end")
    print("[ok] como el Bloc de notas: menú, hoja y barra de estado, nada más")

    guardar = programa.filedialog.asksaveasfilename
    abrir_en_bloc = programa.abrir_en_bloc
    with tempfile.TemporaryDirectory() as carpeta:
        practica = Path(carpeta, "practica.pkt")
        practica.write_bytes(cifrar_pkt(construir(NOTAS)))
        aplicacion.cargar(str(practica))
        root.update()
        texto = aplicacion.contenido()
        assert root.title() == "practica.pkt - PktRutas"
        assert texto.startswith("EN\nCONF T\nHOSTNAME "), texto[:80]
        assert "\n===\nEN\nCONF T\nHOSTNAME " in texto, texto
        assert not any(l.startswith("!") for l in texto.splitlines()), "sin comentarios"
        assert "\nINT FA0/1\n" in texto and "\nNO SHUT\n" in texto and "\nIP ROUTE " in texto
        assert "END" not in texto.split() and "equipo(s) por configurar" in \
            aplicacion.lbl_estado.cget("text")
        print("[ok] al abrir el .pkt la hoja se llena con los comandos, con === entre equipos")

        primero, segundo = texto.split("\n===\n")[:2]
        aplicacion.copiar_siguiente()
        assert root.clipboard_get() == primero + "\n"
        assert aplicacion.texto.get("sel.first", "sel.last") == primero
        aplicacion.copiar_siguiente()
        assert root.clipboard_get() == segundo + "\n"
        assert aplicacion.lbl_estado.cget("text").startswith("Copiado ")
        aplicacion.reiniciar()
        aplicacion.copiar_siguiente()
        assert root.clipboard_get() == primero + "\n"
        print("[ok] Ctrl+Enter copia un equipo a la vez y lo deja seleccionado")

        try:
            comandos = Path(carpeta, "comandos.txt")
            programa.filedialog.asksaveasfilename = lambda **kw: str(comandos)
            aplicacion.guardar_comandos()
            guardado = comandos.read_bytes()
            assert b"\r\n" in guardado and b"\n" not in guardado.replace(b"\r\n", b""), \
                "con fin de línea de Windows, como el Bloc de notas"
            assert guardado.replace(b"\r\n", b"\n").decode() == texto.rstrip("\n") + "\n"

            copia = Path(carpeta, "practica_configurado.pkt")
            programa.filedialog.asksaveasfilename = lambda **kw: str(copia)
            aplicacion.guardar_pkt()
            root.update()
            assert copia.exists() and copia.stat().st_size > 0
            assert aplicacion.lbl_estado.cget("text").startswith("Guardado"), \
                aplicacion.lbl_estado.cget("text")
            print("[ok] guarda los comandos (.txt) y el .pkt configurado")

            abiertos = []
            programa.abrir_en_bloc = abiertos.append
            aplicacion.ver_reporte()
            reporte = Path(abiertos[0]).read_text(encoding="utf-8-sig")
            assert "CONFIGURACIÓN - practica.pkt" in reporte and "1. COMANDOS POR APLICAR" in \
                reporte and "6. COMPROBACIÓN" in reporte
            print("[ok] el reporte completo se abre aparte, en el Bloc de notas")
        finally:
            programa.filedialog.asksaveasfilename = guardar
            programa.abrir_en_bloc = abrir_en_bloc

    aplicacion.acercar(1)
    assert aplicacion.zoom == 110 and aplicacion.lbl_zoom.cget("text") == "110 %"
    aplicacion.acercar(0)
    assert aplicacion.zoom == 100 and aplicacion.lbl_zoom.cget("text") == "100 %"
    aplicacion.cargar("no-existe.pkt")
    assert "No existe" in aplicacion.lbl_estado.cget("text")
    print("[ok] zoom como el del Bloc de notas, y los errores se avisan sin cerrar nada")

    root.destroy()
    return 0


if __name__ == "__main__":
    sys.exit(main())
