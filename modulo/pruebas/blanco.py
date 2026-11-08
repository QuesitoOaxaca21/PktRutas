"""Deja un .pkt como práctica en blanco: conserva lienzo, cables y notas, y borra
lo configurado. Sirve para probar el módulo contra lo que se hizo a mano.

Uso: blanco.py origen.pkt destino.pkt [--notas archivo.json]
Con --notas se reemplaza el texto de las notas ({"texto a buscar": "reemplazo"}).
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pkt.descifrar import cifrar_pkt, descifrar_archivo


def _limpiar_config(lineas: list, es_router: bool) -> list:
    salida, i = [], 0
    while i < len(lineas):
        linea = lineas[i]
        j = i + 1
        while j < len(lineas) and lineas[j].startswith(" "):
            j += 1
        cuerpo = lineas[i + 1:j]
        i = j
        s = linea.strip().lower()
        if s.startswith("hostname "):
            salida.append("hostname %s" % ("Router" if es_router else "Switch"))
        elif s.startswith(("ip dhcp ", "ipv6 unicast-routing", "ip route ", "ipv6 route ", "spanning-tree vlan")):
            continue
        elif s.startswith("vlan "):
            continue
        elif s.startswith("interface "):
            nombre = s.split()[1]
            if "." in nombre or nombre.startswith("port-channel"):
                continue
            salida.append(linea)
            deja = [x for x in cuerpo if not x.strip().lower().startswith(
                ("ip address", "no ip address", "ipv6 ", "switchport ", "channel-group", "shutdown", "no shutdown"))]
            if es_router or nombre == "vlan1":
                deja.insert(0, " no ip address")
            if es_router:
                deja.append(" shutdown")
            elif nombre == "vlan1":
                deja.append(" shutdown")
            salida += deja
        else:
            salida.append(linea)
            salida += cuerpo
    return salida


def blanco(xml: bytes) -> bytes:
    texto = xml.decode("utf-8")

    def equipo(m):
        d = m.group(0)
        tipo = re.search(r"<TYPE[^>]*>([^<]*)</TYPE>", d).group(1).lower()
        es_router = "router" in tipo and "wireless" not in tipo
        if "switch" in tipo or es_router:
            def rc(mc):
                lineas = re.findall(r"<LINE>([^<]*)</LINE>", mc.group(0))
                nuevas = _limpiar_config(lineas, es_router)
                return "<RUNNINGCONFIG>" + "".join("<LINE>%s</LINE>" % l for l in nuevas) + "</RUNNINGCONFIG>"
            d = re.sub(r"<RUNNINGCONFIG>.*?</RUNNINGCONFIG>", rc, d, count=1, flags=re.S)
            d = re.sub(r'<VLAN (?=[^>]*number="(?!1"|100[2-5]")\d+")[^>]*/?>', "", d)
            d = re.sub(r"<HOSTNAME>[^<]*</HOSTNAME>", "<HOSTNAME>%s</HOSTNAME>" % ("Router" if es_router else "Switch"), d)
            if es_router:
                d = re.sub(r"(<PORT>.*?)<POWER>true</POWER>", r"\1<POWER>false</POWER>", d, flags=re.S)
        if "pc" == tipo or "server" == tipo:
            d = re.sub(r"<GATEWAY>[^<]*</GATEWAY>", "<GATEWAY></GATEWAY>", d)
            d = re.sub(r"<PORT_DHCP_ENABLE>true</PORT_DHCP_ENABLE>", "<PORT_DHCP_ENABLE>false</PORT_DHCP_ENABLE>", d)
        d = re.sub(r"<IP>[^<]*</IP>", "<IP></IP>", d)
        d = re.sub(r"<SUBNET>[^<]*</SUBNET>", "<SUBNET></SUBNET>", d)
        return d

    texto = re.sub(r"<DEVICE>.*?</DEVICE>", equipo, texto, flags=re.S)
    return texto.encode("utf-8")


def main():
    origen, destino = Path(sys.argv[1]), Path(sys.argv[2])
    xml, _ = descifrar_archivo(origen)
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    salida = blanco(xml)
    if "--notas" in sys.argv:
        cambios = json.loads(Path(sys.argv[sys.argv.index("--notas") + 1]).read_text(encoding="utf-8"))
        for buscar, poner in cambios.items():
            salida = salida.replace(buscar.encode("utf-8"), poner.encode("utf-8"))
    destino.write_bytes(cifrar_pkt(salida))
    print("listo:", destino)


if __name__ == "__main__":
    main()
