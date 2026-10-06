"""Prueba de la configuración completa a partir de las notas.

Una práctica en blanco: los routers y el core sólo tienen su nombre en el
lienzo (R1, R2, SWR1), ningún puerto tiene IP, y junto a cada cable entre
ellos hay una nota con su /30 ('.4', '.8'). Las VLANs vienen de las notas con
la red base y la diagonal de cada una, y la VLAN de cada PC de su nombre. De
ahí tiene que salir todo: hostnames, enlaces, ruteo, VLANs, DHCP y LAN.

    R1 --.4-- R2 ... Switch2 -- PC5 V5
     |
    .8
     |
    SWR1 -- Switch0 == Switch1 -- PCs
"""

from __future__ import annotations

import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from pkt import escribir, nombres
from pkt import red as analisis
from pkt import reporte
from pkt.descifrar import cifrar_pkt
from pkt.modelo import leer_topologia
from prueba_plan import _REF, _cable, _equipo, _texto_de

ROUTER = ["hostname Router", "interface FastEthernet0/0", " shutdown",
          "interface FastEthernet0/1", " shutdown"]
NOTAS = [(250, 85, ".4"), (85, 200, ".8"),
         (900, 900, "SWR1 10.0.0.0\nVLAN 3/24\nVLAN 4/24"),
         (950, 950, "R2 10.0.0.0\nVLAN 5/26")]


def construir(notas=NOTAS, hostname_r1="Router", core2=False) -> bytes:
    """`core2` agrega un segundo core, SWR2, cableado a SWR1."""
    _REF.clear()
    raiz = ET.Element("PACKETTRACER5")
    red = ET.SubElement(raiz, "NETWORK")
    equipos = ET.SubElement(red, "DEVICES")
    _equipo(equipos, "R1", "Router", "2811", 100, 100,
            ["hostname %s" % hostname_r1] + ROUTER[1:])
    _equipo(equipos, "R2", "Router", "2811", 400, 100, ROUTER)
    _equipo(equipos, "SWR1", "MultiLayerSwitch", "3560-24PS", 100, 300,
            ["hostname Switch", "interface FastEthernet0/1", "interface FastEthernet0/2"]
            + (["interface FastEthernet0/3"] if core2 else []), vlans=True)
    if core2:
        _equipo(equipos, "SWR2", "MultiLayerSwitch", "3560-24PS", 400, 300,
                ["hostname Switch", "interface FastEthernet0/1"], vlans=True)
    for nombre, x, y in (("Switch0", 100, 500), ("Switch1", 100, 700), ("Switch2", 400, 500)):
        _equipo(equipos, nombre, "Switch", "2960-24TT", x, y, ["hostname Switch"],
                vlans=True)
    for nombre, x in (("PC1 V3", 50), ("PC2 V4", 60), ("PC3 V3", 70), ("PC5 V5", 400)):
        _equipo(equipos, nombre, "Pc", "PC-PT", x, 900)

    enlaces = ET.SubElement(red, "LINKS")
    _cable(enlaces, "R1", "FastEthernet0/0", "R2", "FastEthernet0/0")
    _cable(enlaces, "R1", "FastEthernet0/1", "SWR1", "FastEthernet0/1")
    _cable(enlaces, "SWR1", "FastEthernet0/2", "Switch0", "FastEthernet0/1")
    for n in (2, 3):
        _cable(enlaces, "Switch0", "FastEthernet0/%d" % n, "Switch1", "FastEthernet0/%d" % n)
    _cable(enlaces, "Switch0", "FastEthernet0/5", "PC1 V3", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/5", "PC2 V4", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/6", "PC3 V3", "FastEthernet0")
    _cable(enlaces, "R2", "FastEthernet0/1", "Switch2", "FastEthernet0/1")
    _cable(enlaces, "Switch2", "FastEthernet0/2", "PC5 V5", "FastEthernet0")
    if core2:
        _cable(enlaces, "SWR1", "FastEthernet0/3", "SWR2", "FastEthernet0/1")

    contenedor = ET.SubElement(ET.SubElement(raiz, "PHYSICALWORKSPACE"), "NOTES")
    for x, y, texto in notas:
        nota = ET.SubElement(contenedor, "NOTE")
        ET.SubElement(nota, "X").text = str(x)
        ET.SubElement(nota, "Y").text = str(y)
        ET.SubElement(nota, "TEXT").text = texto
    return ET.tostring(raiz)


def _analizar(xml):
    topo = leer_topologia(xml)
    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    _, problemas = analisis.verificar_ruteo(topo, subredes, rutas)
    return topo, rutas, inalcanzables, problemas


def _ip(topo, equipo, puerto):
    disp = topo.por_nombre(equipo)
    i = next(i for i in disp.interfaces if i.nombre == puerto)
    return i.ip, i.mascara


def prueba_hostnames():
    assert nombres.hostname_de("R1") == "R1"
    assert nombres.hostname_de("Router Central") == "Router-Central"
    assert nombres.hostname_de("1R") is None
    topo, rutas, _, _ = _analizar(construir())
    assert {d.nombre: d.hostname for d in topo.ruteadores} == \
        {"R1": "R1", "R2": "R2", "SWR1": "SWR1"}
    assert "Switch0" not in topo.nombres.ordenes, \
        "con el nombre de fábrica en el lienzo no se inventa hostname"
    # Un hostname que ya pusiste a mano no se toca.
    topo2, _, _, _ = _analizar(construir(hostname_r1="r1"))
    assert "R1" not in topo2.nombres.ordenes and topo2.por_nombre("R1").hostname == "r1"
    print("[ok] el hostname sale del nombre en el lienzo, sin tocar el que ya pusiste")


def prueba_completa():
    topo, rutas, inalcanzables, problemas = _analizar(construir())
    assert _ip(topo, "R1", "FastEthernet0/0") == ("10.0.0.5", "255.255.255.252")
    assert _ip(topo, "R2", "FastEthernet0/0") == ("10.0.0.6", "255.255.255.252")
    assert _ip(topo, "R1", "FastEthernet0/1") == ("10.0.0.9", "255.255.255.252")
    assert _ip(topo, "SWR1", "FastEthernet0/1") == ("10.0.0.10", "255.255.255.252")
    # Las VLANs se reparten alrededor de los enlaces, que van primero.
    sitios = {s.dueno.hostname: s for s in topo.plan.sitios}
    assert [(v.numero, str(v.red)) for v in sitios["R2"].vlans] == [(5, "10.0.0.64/26")]
    assert [(v.numero, str(v.red)) for v in sitios["SWR1"].vlans] == [
        (3, "10.0.1.0/24"), (4, "10.0.2.0/24")], sitios["SWR1"].vlans
    assert not inalcanzables and not problemas, (inalcanzables, problemas)

    bloques = reporte.bloques_por_equipo(topo, rutas)
    r1 = _texto_de(bloques, "R1")
    assert r1.startswith("!" + "-" * 40 + "\n! R1\n") and \
        "configure terminal\nhostname R1\n" in r1, r1[:200]
    assert "interface FastEthernet0/0\n ip address 10.0.0.5 255.255.255.252\n" \
           " no shutdown" in r1, r1
    swr1 = _texto_de(bloques, "SWR1")
    assert "hostname SWR1\nip routing\n" in swr1 and \
        "interface FastEthernet0/1\n no switchport\n ip address 10.0.0.10" in swr1, swr1
    assert reporte.pendientes(topo, rutas)[2:] == (4, 3), reporte.pendientes(topo, rutas)
    print("[ok] práctica en blanco: hostnames, enlaces de sus notas, VLANs y ruteo")

    with tempfile.TemporaryDirectory() as carpeta:
        origen, destino = Path(carpeta, "blanco.pkt"), Path(carpeta, "listo.pkt")
        origen.write_bytes(cifrar_pkt(construir()))
        resumen = escribir.escribir(origen, destino)
        assert resumen["quedan"] == (0, 0, 0, 0), resumen["quedan"]
    print("[ok] el .pkt escrito desde una práctica en blanco ya no necesita nada")


def prueba_sin_notas_de_enlace():
    """Sin notas de enlace, los /30 se toman en orden desde la .4 de la base."""
    topo, _, _, problemas = _analizar(construir(NOTAS[2:]))
    assert _ip(topo, "R1", "FastEthernet0/0")[0] == "10.0.0.5"
    assert _ip(topo, "R1", "FastEthernet0/1")[0] == "10.0.0.9"
    assert not problemas
    print("[ok] sin notas de enlace se numeran solos desde la .4 de la red base")


def prueba_nota_con_direccion_completa():
    """Una nota con la dirección completa dice en qué red van los enlaces, y
    las cortas ('.8') la siguen: las VLANs ya no tienen que esquivarlos."""
    topo, _, _, problemas = _analizar(construir([(250, 85, "10.9.9.4"), (85, 200, ".8")]
                                                + NOTAS[2:]))
    assert _ip(topo, "R2", "FastEthernet0/0")[0] == "10.9.9.6"
    assert _ip(topo, "R1", "FastEthernet0/1")[0] == "10.9.9.9"
    sitios = {s.dueno.hostname: s for s in topo.plan.sitios}
    assert [str(v.red) for v in sitios["R2"].vlans] == ["10.0.0.0/26"], sitios["R2"].vlans
    assert not problemas, problemas
    print("[ok] la nota con la dirección completa fija la red de las notas cortas")


def prueba_sin_notas_de_vlan():
    """Una práctica sólo de ruteo, sin notas de VLAN: basta con escribir completa
    una nota de enlace. Si ninguna lo está, se pide en vez de inventar la red."""
    topo, _, _, problemas = _analizar(construir([(250, 85, "10.0.0.4"), (85, 200, ".8")]))
    assert _ip(topo, "R2", "FastEthernet0/0")[0] == "10.0.0.6"
    assert _ip(topo, "SWR1", "FastEthernet0/1")[0] == "10.0.0.10"
    assert not problemas, problemas
    topo, rutas, _, _ = _analizar(construir(NOTAS[:2]))
    assert not _ip(topo, "R1", "FastEthernet0/0")[0]
    hallazgos = analisis.revisar(topo, analisis.construir_subredes(topo), rutas)
    assert sum("no se sabe en qué red van tus enlaces" in h.mensaje for h in hallazgos) == 2, \
        [h.mensaje for h in hallazgos]
    print("[ok] sin notas de VLAN basta una nota de enlace con la dirección completa")


def prueba_entre_cores():
    """Entre dos cores el cable se configura sólo si tiene su nota: sin ella
    puede ser una troncal a propósito."""
    topo, _, _, problemas = _analizar(construir(NOTAS + [(250, 285, ".12")], core2=True))
    assert _ip(topo, "SWR1", "FastEthernet0/3")[0] == "10.0.0.13"
    assert _ip(topo, "SWR2", "FastEthernet0/1")[0] == "10.0.0.14"
    assert "no switchport" in "\n".join(
        l for o in topo.correcciones.ordenes["SWR2"] for l in o.lineas)
    assert not problemas, problemas
    topo, _, _, _ = _analizar(construir(core2=True))
    assert not _ip(topo, "SWR2", "FastEthernet0/1")[0]
    print("[ok] entre dos cores, el cable con nota se configura y sin nota no se toca")


def prueba_notas_que_no_son_de_enlace():
    """Si en los enlaces ya configurados las notas no coinciden con su /30, en
    esa práctica significan otra cosa: no se usan ni se reclaman."""
    xml = construir([(250, 85, ".40"), (85, 200, ".44")] + NOTAS[2:])
    raiz = ET.fromstring(xml)
    for dev in raiz.iter("DEVICE"):
        if dev.findtext("ENGINE/NAME") in ("R1", "R2"):
            rc = dev.find("ENGINE/RUNNINGCONFIG")
            for linea in list(rc):
                rc.remove(linea)
            ip = "10.0.0.1" if dev.findtext("ENGINE/NAME") == "R1" else "10.0.0.2"
            for texto in ("hostname " + dev.findtext("ENGINE/NAME"), "interface FastEthernet0/0",
                          " ip address %s 255.255.255.252" % ip, "interface FastEthernet0/1"):
                ET.SubElement(rc, "LINE").text = texto
    topo, rutas, _, _ = _analizar(ET.tostring(raiz))
    hallazgos = analisis.revisar(topo, analisis.construir_subredes(topo), rutas)
    assert not any("nota '" in h.mensaje for h in hallazgos), \
        [h.mensaje for h in hallazgos if "nota '" in h.mensaje]
    print("[ok] las notas que en esa práctica significan otra cosa no se usan")


def main():
    prueba_hostnames()
    prueba_completa()
    prueba_sin_notas_de_enlace()
    prueba_nota_con_direccion_completa()
    prueba_sin_notas_de_vlan()
    prueba_entre_cores()
    prueba_notas_que_no_son_de_enlace()
    return 0


if __name__ == "__main__":
    sys.exit(main())
