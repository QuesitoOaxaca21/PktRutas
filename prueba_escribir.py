"""Prueba de la escritura del .pkt configurado.

Revisa tres cosas: que el running-config quede como lo dejaría IOS después de
pegar los comandos (con el formato de Packet Tracer), que un .pkt escrito se
vuelva a leer sin que le falte nada, y que nunca se sobrescriba el original.
"""

from __future__ import annotations

import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from pkt import escribir, reporte
from pkt.descifrar import cifrar_pkt, descifrar_archivo, descifrar_pkt
from prueba_plan import NOTAS, construir

# Un 2960 recién sacado de la caja, como lo guarda Packet Tracer 9.
SWITCH = ["!", "version 15.0", "no service password-encryption", "!", "hostname sw1",
          "!", "spanning-tree mode pvst", "spanning-tree extend system-id", "!",
          "interface FastEthernet0/1", "!", "interface FastEthernet0/2", "!",
          "interface FastEthernet0/3", "!", "interface FastEthernet0/4", "!",
          "interface Vlan1", " no ip address", " shutdown", "!", "line con 0", "!",
          "line vty 0 4", " login", "!", "end"]
ROUTER = ["!", "hostname r1", "!", "no ip cef", "no ipv6 cef", "!",
          "spanning-tree mode pvst", "!", "interface FastEthernet0/0",
          " ip address 10.0.0.1 255.255.255.252", " duplex auto", " speed auto", "!",
          "interface FastEthernet0/1", " no ip address", " duplex auto", " speed auto",
          " shutdown", "!", "ip classless", "!", "ip flow-export version 9", "!",
          "line con 0", "!", "end"]


def prueba_running_config():
    rc = escribir.RunningConfig(SWITCH).aplicar([
        "vlan 3", " name TRES", "spanning-tree vlan 1,3 priority 4096",
        "interface FastEthernet0/1", " switchport mode trunk",
        "interface range FastEthernet0/2 - 3", " switchport mode trunk",
        " channel-group 1 mode active",
        "interface FastEthernet0/4", " switchport mode access",
        " switchport access vlan 3"])
    esperado = ["spanning-tree extend system-id", "spanning-tree vlan 1,3 priority 4096",
                "!", "interface Port-channel1", " switchport mode trunk", "!",
                "interface FastEthernet0/1", " switchport mode trunk", "!",
                "interface FastEthernet0/2", " switchport mode trunk",
                " channel-group 1 mode active", "!", "interface FastEthernet0/3",
                " switchport mode trunk", " channel-group 1 mode active", "!",
                "interface FastEthernet0/4", " switchport access vlan 3",
                " switchport mode access", "!", "interface Vlan1"]
    inicio = rc.l.index("spanning-tree extend system-id")
    assert rc.l[inicio:inicio + len(esperado)] == esperado, rc.l
    assert rc.vlans == {3: "TRES"}, rc.vlans

    rc = escribir.RunningConfig(ROUTER).aplicar([
        "interface FastEthernet0/1", " no shutdown",
        "interface FastEthernet0/1.3", " encapsulation dot1Q 3",
        " ip address 10.1.0.254 255.255.0.0",
        "ip dhcp pool VLAN3", " network 10.1.0.0 255.255.0.0",
        " default-router 10.1.0.254",
        "ip route 10.3.0.0 255.255.255.0 10.0.0.2"])
    esperado = ["!", "hostname r1", "!", "ip dhcp pool VLAN3",
                " network 10.1.0.0 255.255.0.0", " default-router 10.1.0.254", "!",
                "no ip cef", "no ipv6 cef", "!", "spanning-tree mode pvst", "!",
                "interface FastEthernet0/0", " ip address 10.0.0.1 255.255.255.252",
                " duplex auto", " speed auto", "!", "interface FastEthernet0/1",
                " no ip address", " duplex auto", " speed auto", "!",
                "interface FastEthernet0/1.3", " encapsulation dot1Q 3",
                " ip address 10.1.0.254 255.255.0.0", "!", "ip classless",
                "ip route 10.3.0.0 255.255.255.0 10.0.0.2 ", "!",
                "ip flow-export version 9", "!", "line con 0", "!", "end"]
    assert rc.l == esperado, rc.l
    assert rc.estado("FastEthernet0/1") == (True, None)
    print("[ok] el running-config queda como lo dejaría IOS, en el orden de "
          "Packet Tracer")


def prueba_escribir_y_releer():
    with tempfile.TemporaryDirectory() as carpeta:
        origen = Path(carpeta, "practica.pkt")
        destino = Path(carpeta, "practica_configurado.pkt")
        origen.write_bytes(cifrar_pkt(construir(NOTAS)))
        antes, _ = descifrar_pkt(origen.read_bytes())

        resumen = escribir.escribir(origen, destino)
        assert resumen["equipos"] and resumen["comandos"] > 20, resumen
        assert resumen["quedan"] == (0, 0, 0, 0), \
            "al volver a leerlo no debe faltar nada: %s" % (resumen["quedan"],)
        assert origen.read_bytes() and descifrar_pkt(origen.read_bytes())[0] == antes, \
            "el original no se toca"

        xml, _ = descifrar_archivo(destino)
        raiz = ET.fromstring(xml)
        for dev in raiz.iter("DEVICE"):
            if dev.findtext("ENGINE/NAME") == "Switch1":
                vlans = {v.get("number"): v.get("name") for v in dev.find("ENGINE/VLANS")}
                assert vlans.get("3") == "TRES" and vlans.get("4") == "CUATRO", vlans

        # Las PCs vuelven a su nombre; la de una VLAN que su sitio no tiene
        # (PC9 V9) y la que no traía VLAN (PC4) se quedan como estaban.
        nombres = {d.findtext("ENGINE/NAME") for d in raiz.iter("DEVICE")}
        assert {"PC1", "PC2", "PC3", "PC5", "PC9 V9", "PC4"} <= nombres, nombres
        assert not {"PC1 V3", "PC2 V4", "PC3 V3", "PC5 V5"} & nombres, nombres
        assert resumen["renombradas"] == 4, resumen

        try:
            escribir.escribir(origen, origen)
        except ValueError:
            pass
        else:
            raise AssertionError("no debe dejar sobrescribir el original")
    print("[ok] el .pkt escrito se vuelve a leer sin que le falte nada, y el "
          "original no se toca")


def prueba_nombre_original():
    casos = {"PC1 V3": "PC1", "V4 PC2": "PC2", "PC7 VLAN5": "PC7", "PC1-V3": "PC1",
             "Laptop vlan10": "Laptop", "PC4": "PC4", "Servidor V20": "Servidor"}
    for nombre, esperado in casos.items():
        assert escribir.nombre_original(nombre) == esperado, \
            "%r -> %r" % (nombre, escribir.nombre_original(nombre))
    print("[ok] las PCs recuperan su nombre sin la VLAN (y en la copia se renombran)")


def main():
    prueba_running_config()
    prueba_escribir_y_releer()
    prueba_nombre_original()
    return 0


if __name__ == "__main__":
    sys.exit(main())
