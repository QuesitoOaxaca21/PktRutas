"""Prueba del estilo de los comandos: en mayúsculas, abreviados, sin
comentarios, un renglón en blanco entre interfaces y === entre equipos."""

from __future__ import annotations

import sys

from pkt import formato, reporte
from pkt import red as analisis
from pkt.modelo import leer_topologia

# El bloque de R2 tal como se teclea en las prácticas.
ESPERADO_R2 = """EN
CONF T
HOSTNAME R2

INT FA0/0
IP ADD 12.0.0.6 255.255.255.252
NO SHUT

INT FA0/1
IP ADD 12.0.0.9 255.255.255.252
NO SHUT

INT ETH0/1/0
IP ADD 12.0.0.13 255.255.255.252
NO SHUT

INT ETH0/3/0
IP ADD 12.0.0.17 255.255.255.252
NO SHUT"""


def prueba_ejemplo():
    ios = ["hostname R2"]
    for puerto, ip in (("FastEthernet0/0", "12.0.0.6"), ("FastEthernet0/1", "12.0.0.9"),
                       ("Ethernet0/1/0", "12.0.0.13"), ("Ethernet0/3/0", "12.0.0.17")):
        ios += ["! enlace de la nota", "interface " + puerto,
                " ip address %s 255.255.255.252" % ip, " no shutdown"]
    assert "\n".join(formato.estilo(ios)) == ESPERADO_R2, formato.estilo(ios)
    print("[ok] el bloque sale igual que en las prácticas")


def prueba_renglones():
    casos = {
        "interface range FastEthernet0/2 - 4 , FastEthernet0/7": "INT RANGE FA0/2 - 4 , FA0/7",
        "interface Vlan3": "INT VLAN 3",
        "interface GigabitEthernet0/0.10": "INT GI0/0.10",
        "interface Serial0/0/0": "INT SE0/0/0",
        "interface Port-channel1": "INT PO1",
        " encapsulation dot1Q 5": "ENCAPSULATION DOT1Q 5",
        " no switchport": "NO SWITCHPORT",
        "spanning-tree vlan 1,3,4 priority 4096": "SPANNING-TREE VLAN 1,3,4 PRIORITY 4096",
        "ip route 10.3.0.0 255.255.255.0 10.0.0.5": "IP ROUTE 10.3.0.0 255.255.255.0 10.0.0.5",
        " switchport trunk encapsulation dot1q": "SWITCHPORT TRUNK ENCAPSULATION DOT1Q",
        " default-router 10.1.255.254": "DEFAULT-ROUTER 10.1.255.254",
        # Los nombres tuyos se respetan: en mayúsculas renombrarían el equipo.
        "hostname sw10": "HOSTNAME sw10",
        " name ventas": "NAME ventas",
        "ip dhcp pool Vlan3": "IP DHCP POOL Vlan3",
    }
    for ios, esperado in casos.items():
        assert formato.renglon(ios) == esperado, (ios, formato.renglon(ios), esperado)
    print("[ok] abreviaturas de interfaces y comandos; los nombres tuyos no cambian")


def prueba_parrafos():
    ios = ["hostname SWR1", "ip routing", "vlan 3", " name TRES", "interface Vlan3",
           " ip address 10.1.255.254 255.255.0.0", "ip route 10.3.0.0 255.255.255.0 10.0.0.5",
           "ip route 10.4.0.0 255.255.0.0 10.0.0.5"]
    assert formato.estilo(ios) == [
        "EN", "CONF T", "HOSTNAME SWR1", "IP ROUTING", "",
        "VLAN 3", "NAME TRES", "",
        "INT VLAN 3", "IP ADD 10.1.255.254 255.255.0.0", "",
        "IP ROUTE 10.3.0.0 255.255.255.0 10.0.0.5", "IP ROUTE 10.4.0.0 255.255.0.0 10.0.0.5"]
    print("[ok] lo global va junto; cada interfaz, VLAN o pool en su párrafo")


def prueba_unir_y_partir():
    texto = formato.unir(["EN\nCONF T\nHOSTNAME R1", "EN\nCONF T\nHOSTNAME R2\n"])
    assert texto == "EN\nCONF T\nHOSTNAME R1\n===\nEN\nCONF T\nHOSTNAME R2\n"
    assert formato.partir(texto) == [(1, 3, "EN\nCONF T\nHOSTNAME R1"),
                                     (5, 7, "EN\nCONF T\nHOSTNAME R2")]
    print("[ok] === entre un equipo y otro, y la hoja se vuelve a partir en bloques")


def _comandos(xml):
    topo = leer_topologia(xml)
    rutas, _ = analisis.calcular_rutas(topo, analisis.construir_subredes(topo))
    return reporte.comandos_por_equipo(topo, rutas)


def prueba_practicas():
    import prueba_completa
    import prueba_plan
    bloques = _comandos(prueba_completa.construir())
    texto = reporte.texto_comandos(bloques)
    r1 = dict(bloques)["R1"]
    assert r1.startswith("EN\nCONF T\nHOSTNAME R1\n\nINT FA0/0\nIP ADD 10.0.0.5 "
                         "255.255.255.252\nNO SHUT\n\nINT FA0/1\nIP ADD 10.0.0.9 "
                         "255.255.255.252\nNO SHUT\n\nIP ROUTE "), r1
    assert texto.count("\n===\n") == len(bloques) - 1
    assert "!" not in texto and "END" not in texto.split() and "WRITE" not in texto
    for linea in texto.splitlines():
        assert linea == linea.upper() or linea.startswith(("HOSTNAME ", "NAME ")), linea
    # Si el hostname ya estaba puesto, el bloque igual lo trae: sin comentarios,
    # es lo que dice de qué equipo es.
    r2 = dict(_comandos(prueba_plan.construir(prueba_plan.NOTAS)))["r2"]
    assert r2.startswith("EN\nCONF T\nHOSTNAME r2\n"), r2
    print("[ok] en una práctica, cada bloque empieza con EN, CONF T y su HOSTNAME")


def main():
    prueba_ejemplo()
    prueba_renglones()
    prueba_parrafos()
    prueba_unir_y_partir()
    prueba_practicas()
    return 0


if __name__ == "__main__":
    sys.exit(main())
