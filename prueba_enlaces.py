"""Prueba de la corrección de enlaces entre ruteadores.

Parte de la misma práctica sintética de prueba_plan.py (r1, r2 y SWR1 unidos
por /30) y le mete, uno por uno, los errores que se cometen al teclear los
enlaces a mano. En cada caso revisa que el programa arregle lo que tiene una
sola explicación, que el comando quede en el equipo que toca, que el ruteo se
calcule con la red ya corregida, y que no adivine cuando hay dos arreglos
igual de buenos.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

from pkt import red as analisis
from pkt import reporte
from pkt.modelo import leer_topologia
from prueba_plan import NOTAS, _cable, _equipo, _texto_de, construir

R1 = ["hostname r1",
      "interface FastEthernet0/0", " ip address 10.0.0.1 255.255.255.252",
      "interface FastEthernet0/1", " ip address 10.0.0.5 255.255.255.252"]


def _r2(*lineas_fa00):
    return ["hostname r2", "interface FastEthernet0/0", *lineas_fa00,
            "interface FastEthernet0/1", " shutdown"]


def _analizar(cambios, agregar=None, conectada=True):
    """cambios: {equipo del lienzo: running-config nuevo}. Con `conectada`, el
    ruteo que sale tiene que llegar a todos lados sin bucles."""
    raiz = ET.fromstring(construir(NOTAS))
    for dev in raiz.iter("DEVICE"):
        nombre = dev.findtext("ENGINE/NAME")
        if nombre in cambios:
            rc = dev.find("ENGINE/RUNNINGCONFIG")
            for linea in list(rc):
                rc.remove(linea)
            for texto in cambios[nombre]:
                ET.SubElement(rc, "LINE").text = texto
    if agregar:
        agregar(raiz)
    topo = leer_topologia(ET.tostring(raiz))
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    hallazgos = analisis.revisar(topo, subredes, rutas)
    _, problemas = analisis.verificar_ruteo(topo, subredes, rutas)
    assert not conectada or not problemas, \
        "el ruteo corregido tiene problemas: %s" % problemas
    return topo, rutas, hallazgos


def _mensajes(hallazgos, nivel=None):
    return [h.mensaje for h in hallazgos if nivel is None or h.nivel == nivel]


def _ruta(rutas, equipo, red):
    return next((r for r in rutas[equipo] if r.red == red), None)


def prueba_sin_errores():
    topo, _, _ = _analizar({})
    assert topo.correcciones.total == 0 and not topo.correcciones.hallazgos, \
        topo.correcciones.hallazgos
    print("[ok] una práctica bien configurada no recibe correcciones")


def prueba_ip_de_otro_enlace():
    """El error de SS1: una IP que es de otro enlace."""
    topo, rutas, hallazgos = _analizar({"Router1": _r2(
        " ip address 10.0.0.6 255.255.255.252")})
    errores = _mensajes(hallazgos, "ERROR")
    assert any("tenía 10.0.0.6/30" in e and "ya es de SWR1" in e
               and "se corrige a 10.0.0.2" in e for e in errores), errores
    assert not any("IP duplicada" in e for e in errores), \
        "ya corregida, la IP deja de estar repetida: %s" % errores
    assert not any("une dos subredes" in e for e in errores), errores

    bloques = reporte.bloques_por_equipo(topo, rutas)
    r2 = _texto_de(bloques, "r2")
    assert "interface FastEthernet0/0\n ip address 10.0.0.2 255.255.255.252\n" \
           " no shutdown" in r2, r2
    assert r2.index("ip address 10.0.0.2") < r2.index("ip route"), \
        "la corrección va antes que las rutas"
    ruta = _ruta(rutas, "Router0", "10.3.0.0")
    assert ruta is not None and ruta.salto == "10.0.0.2", \
        "el ruteo debe usar la IP ya corregida"

    texto = reporte.construir("prueba", "prueba", topo,
                              analisis.construir_subredes(topo), rutas, [], hallazgos)
    assert "<- corregida, tenía 10.0.0.6/30" in texto, "el inventario lo señala"
    assert "1 puerto(s) de enlace" in texto
    print("[ok] la IP de otro enlace se corrige y el ruteo sale con la red arreglada")


def prueba_mascara_distinta():
    _, rutas, hallazgos = _analizar({"Router1": _r2(
        " ip address 10.0.0.2 255.255.255.0")})
    assert any("tiene la máscara 255.255.255.0" in e
               and "se corrige a 10.0.0.2 255.255.255.252" in e
               for e in _mensajes(hallazgos, "ERROR")), _mensajes(hallazgos)
    assert _ruta(rutas, "Router0", "10.3.0.0").salto == "10.0.0.2"
    print("[ok] la máscara distinta a la del vecino se iguala")


def prueba_misma_ip():
    topo, rutas, hallazgos = _analizar({"Router1": _r2(
        " ip address 10.0.0.1 255.255.255.252")})
    assert any("la misma IP" in e and "se corrige a 10.0.0.2" in e
               for e in _mensajes(hallazgos, "ERROR")), _mensajes(hallazgos)
    assert "Router0" not in topo.correcciones.ordenes, \
        "al de menor nombre le toca la IP baja: r1 se queda con la .1"
    print("[ok] la misma IP en los dos extremos: la baja al de menor nombre")


def prueba_un_extremo_sin_ip():
    topo, rutas, hallazgos = _analizar({"Router1": _r2(" shutdown")})
    assert any("no tenía IP" in a and "se completa con 10.0.0.2" in a
               for a in _mensajes(hallazgos, "AVISO")), _mensajes(hallazgos)
    r2 = _texto_de(reporte.bloques_por_equipo(topo, rutas), "r2")
    assert "! faltaba la IP del enlace con r1\ninterface FastEthernet0/0\n" \
           " ip address 10.0.0.2 255.255.255.252\n no shutdown" in r2, r2

    # En el core hace falta además 'no switchport'.
    topo, rutas, hallazgos = _analizar({"Multilayer Switch0": [
        "hostname SWR1", "interface FastEthernet0/1", "interface FastEthernet0/2"]})
    swr1 = _texto_de(reporte.bloques_por_equipo(topo, rutas), "SWR1")
    assert "interface FastEthernet0/1\n no switchport\n ip address 10.0.0.6 " \
           "255.255.255.252\n no shutdown" in swr1, swr1
    assert _ruta(rutas, "Multilayer Switch0", "10.3.0.0").salto == "10.0.0.5"
    print("[ok] el extremo sin IP se completa (en el core, con 'no switchport')")


def prueba_enlace_sin_ip():
    """Un tercer router cableado a r2 sin IP en ningún lado."""
    def agregar(raiz):
        dispositivos = raiz.find("NETWORK/DEVICES")
        _equipo(dispositivos, "Router2", "Router", "2811", 700, 100,
                ["hostname r3", "interface FastEthernet0/0", " shutdown"])
        _cable(raiz.find("NETWORK/LINKS"), "Router1", "FastEthernet1/0",
               "Router2", "FastEthernet0/0")

    topo, rutas, hallazgos = _analizar({"Router1": _r2(
        " ip address 10.0.0.2 255.255.255.252") + [
        "interface FastEthernet1/0", " shutdown"]}, agregar)
    assert any("se eligió 10.0.0.8/30" in a and "r2 .9" in a and "r3 .10" in a
               for a in _mensajes(hallazgos, "AVISO")), _mensajes(hallazgos)
    bloques = reporte.bloques_por_equipo(topo, rutas)
    assert "interface FastEthernet0/0\n ip address 10.0.0.10 255.255.255.252" \
        in _texto_de(bloques, "r3")
    assert _ruta(rutas, "Router2", "10.1.0.0").salto == "10.0.0.9", \
        "r3 ya entra al ruteo por el enlace elegido"
    print("[ok] el cable sin IP recibe el /30 que sigue a tus enlaces")


def prueba_sin_explicacion_unica():
    """Dos lados igual de sospechosos: no se adivina, se dan las opciones."""
    topo, _, hallazgos = _analizar({"Router1": _r2(
        " ip address 10.0.0.9 255.255.255.252")}, conectada=False)
    errores = _mensajes(hallazgos, "ERROR")
    assert any("no hay cómo saber" in e and "10.0.0.2 en r2 FastEthernet0/0" in e
               and "10.0.0.10 en r1 FastEthernet0/0" in e for e in errores), errores
    assert sum("10.0.0.9" in e for e in errores) == 1, \
        "un solo mensaje por el enlace: %s" % errores
    assert topo.correcciones.total == 0
    print("[ok] cuando no hay una sola explicación da las dos opciones sin tocar nada")


def prueba_puerto_apagado():
    topo, rutas, hallazgos = _analizar({"Router0": R1[:3] + [" shutdown"] + R1[3:]})
    assert any("estaba apagada" in a for a in _mensajes(hallazgos, "AVISO"))
    r1 = _texto_de(reporte.bloques_por_equipo(topo, rutas), "r1")
    assert "interface FastEthernet0/0\n no shutdown" in r1, r1
    print("[ok] el puerto con IP pero apagado recibe su 'no shutdown'")


def main():
    prueba_sin_errores()
    prueba_ip_de_otro_enlace()
    prueba_mascara_distinta()
    prueba_misma_ip()
    prueba_un_extremo_sin_ip()
    prueba_enlace_sin_ip()
    prueba_sin_explicacion_unica()
    prueba_puerto_apagado()
    return 0


if __name__ == "__main__":
    sys.exit(main())
