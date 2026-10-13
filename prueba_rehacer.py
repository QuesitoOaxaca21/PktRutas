"""Prueba de una práctica a medias y mal hecha.

A la práctica de prueba_plan se le meten errores típicos de cuando se acaba el
tiempo. Los que se arreglan agregando comandos (la VLAN de una PC, la IP de
una SVI, el nombre de una VLAN, un enlace con IP de otra red) se corrigen
así; los equipos con errores que no (una ruta al revés, un pool de más, un
EtherChannel con otro modo, la raíz de STP en otro switch) se rehacen desde
cero. Después de aplicarlo todo, no queda nada mal.
"""

from __future__ import annotations

import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from pkt import escribir, reporte
from pkt import red as analisis
from pkt.descifrar import cifrar_pkt, descifrar_archivo
from pkt.modelo import leer_topologia
from prueba_plan import NOTAS, construir as construir_bien

ERRORES = {
    "Multilayer Switch0": [
        "interface Vlan3", " ip address 10.2.0.5 255.255.0.0",       # IP de otra VLAN
        "ip dhcp pool P3", " network 10.1.0.0 255.255.0.0",
        " default-router 10.1.0.1"],                                   # pool de más
    "Router0": ["ip route 10.3.0.0 255.255.255.0 10.0.0.6"],          # ruta al revés
    "Switch1": [
        "interface FastEthernet0/5", " switchport mode access",
        " switchport access vlan 3",                                   # PC2 V4 en la 3
        "interface FastEthernet0/2", " channel-group 1 mode on",
        "interface FastEthernet0/3", " channel-group 1 mode on",
        "interface FastEthernet0/4", " channel-group 1 mode on",      # 'on' contra active
        "spanning-tree vlan 1,3,4 priority 0"],                        # raíz equivocada
}


def construir():
    raiz = ET.fromstring(construir_bien(NOTAS))
    for dev in raiz.iter("DEVICE"):
        eng = dev.find("ENGINE")
        nombre = eng.findtext("NAME")
        rc = eng.find("RUNNINGCONFIG")
        if rc is None:
            continue
        for linea in rc:
            if nombre == "Router1" and linea.text == " ip address 10.0.0.2 255.255.255.252":
                linea.text = " ip address 10.0.0.9 255.255.255.252"   # enlace en otra red
        for texto in ERRORES.get(nombre, []):
            ET.SubElement(rc, "LINE").text = texto
        if nombre == "Multilayer Switch0":
            ET.SubElement(eng.find("VLANS"), "VLAN", number="4", name="CUATROO")
    return ET.tostring(raiz)


def _analizar(xml):
    topo = leer_topologia(xml)
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    return topo, subredes, rutas


def prueba_bien_hecha():
    topo, _, rutas = _analizar(construir_bien(NOTAS))
    assert not reporte.desde_cero(topo, rutas), reporte.desde_cero(topo, rutas)
    print("[ok] a una práctica sin errores no se le rehace nada")


def prueba_que_se_rehace():
    topo, _, rutas = _analizar(construir())
    motivos = reporte.desde_cero(topo, rutas)
    assert sorted(motivos) == ["Multilayer Switch0", "Router0", "Switch1"], motivos
    assert any("10.3.0.0/24 va por 10.0.0.6" in m for m in motivos["Router0"])
    assert any("pool P3" in m for m in motivos["Multilayer Switch0"])
    assert any("modo on" in m for m in motivos["Switch1"]) and \
        any("prioridad de STP" in m for m in motivos["Switch1"])
    print("[ok] se rehacen los equipos con errores que no se quitan agregando comandos")

    bloques = dict(reporte.comandos_por_equipo(topo, rutas))
    r1, swr1 = bloques["r1"], bloques["SWR1"]
    sw1 = bloques["Switch (Switch1)"]
    assert "NO IP ROUTE 10.3.0.0 255.255.255.0 10.0.0.6" in r1 and \
        "IP ROUTE 10.3.0.0 255.255.255.0 10.0.0.2" in r1, r1
    assert "INT FA0/0\nIP ADD 10.0.0.1 255.255.255.252\nNO SHUT" in r1, \
        "los enlaces que estaban bien se vuelven a poner"
    assert "NO IP DHCP POOL P3" in swr1 and "NO INT VLAN 3" in swr1, swr1
    assert "INT VLAN 3\nIP ADD 10.1.255.254 255.255.0.0" in swr1
    assert "VLAN 4\nNAME CUATRO" in swr1, "el nombre mal escrito se corrige"
    assert "NO SPANNING-TREE VLAN 1,3,4 PRIORITY" in sw1 and "NO CHANNEL-GROUP" in sw1
    assert "CHANNEL-GROUP 1 MODE PASSIVE" in sw1 and "SWITCHPORT ACCESS VLAN 4" in sw1
    assert sw1.index("NO CHANNEL-GROUP") < sw1.index("CHANNEL-GROUP 1 MODE PASSIVE"), \
        "primero se borra y luego se pone"
    # r2 no se rehace: su enlace se arregla con un comando.
    assert "NO IP ROUTE" not in bloques["r2"] and \
        "INT FA0/0\nIP ADD 10.0.0.2 255.255.255.252" in bloques["r2"], bloques["r2"]
    print("[ok] su bloque borra lo que tenía (NO ...) y pone todo de nuevo, ya correcto")


def prueba_pkt_configurado():
    with tempfile.TemporaryDirectory() as carpeta:
        origen, destino = Path(carpeta, "mal.pkt"), Path(carpeta, "listo.pkt")
        origen.write_bytes(cifrar_pkt(construir()))
        resumen = escribir.escribir(origen, destino)
        xml, _ = descifrar_archivo(destino)
    assert sorted(resumen["desde_cero"]) == ["Multilayer Switch0", "Router0", "Switch1"]
    assert resumen["quedan"] == (0, 0, 0, 0) and not resumen["siguen_mal"], resumen
    topo, subredes, rutas = _analizar(xml)
    hallazgos = analisis.revisar(topo, subredes, rutas)
    assert not [h.mensaje for h in hallazgos if "no llega el trafico" in h.mensaje], \
        "después de aplicarlo, el tráfico llega a todos lados"
    swr1 = topo.por_nombre("Multilayer Switch0")
    assert [p.nombre for p in swr1.cfg.pools] == ["VLAN3", "VLAN4"]
    assert (4, "CUATRO") in [tuple(v) for v in swr1.vlans]
    sw1 = topo.por_nombre("Switch1")
    assert {(i.canal, i.modo_canal) for i in sw1.cfg.interfaces if i.canal} == {(1, "passive")}
    assert not sw1.cfg.stp, "al switch que no es la raíz se le quita la prioridad"
    print("[ok] el .pkt configurado queda bien: sin pendientes ni nada que rehacer")


def main():
    prueba_bien_hecha()
    prueba_que_se_rehace()
    prueba_pkt_configurado()
    return 0


if __name__ == "__main__":
    sys.exit(main())
