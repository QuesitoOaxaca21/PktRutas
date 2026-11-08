"""Prueba del plan de VLANs escrito en notas del lienzo.

Arma un XML con la misma estructura que guarda Packet Tracer 9 (equipos con
running-config, cables por save-ref-id, notas con coordenadas) y comprueba lo
que el programa genera a partir de él. La topología imita una práctica real:

    r1 --10.0.0.0/30-- r2 ...(Fa0/1, router-on-a-stick)... SwC -- PC5 V5
     |
    10.0.0.4/30
     |
    SWR1 (3560) --troncal-- SwA ==3 cables== SwB -- PC2 V4, PC3 V3, PC4, PC9 V9
                             |
                            PC1 V3

Sólo están configurados los hostnames y los enlaces /30, que es lo que se deja
puesto a mano; lo demás lo pide la nota.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

from pkt import plan as planlan
from pkt import red as analisis
from pkt import reporte
from pkt.modelo import leer_topologia

_REF = {}


def _equipo(padre, nombre, tipo, modelo, x, y, config=(), vlans=False):
    dev = ET.SubElement(padre, "DEVICE")
    eng = ET.SubElement(dev, "ENGINE")
    ET.SubElement(eng, "NAME").text = nombre
    ET.SubElement(eng, "TYPE", model=modelo).text = tipo
    _REF[nombre] = "save-ref-id:%d" % (len(_REF) + 1)
    ET.SubElement(eng, "SAVE_REF_ID").text = _REF[nombre]
    if config:
        rc = ET.SubElement(eng, "RUNNINGCONFIG")
        for linea in config:
            ET.SubElement(rc, "LINE").text = linea
    if vlans:
        contenedor = ET.SubElement(eng, "VLANS")
        ET.SubElement(contenedor, "VLAN", number="1", name="default")
    logico = ET.SubElement(ET.SubElement(dev, "WORKSPACE"), "LOGICAL")
    ET.SubElement(logico, "X").text = str(x)
    ET.SubElement(logico, "Y").text = str(y)


def _cable(padre, a, pa, b, pb):
    cable = ET.SubElement(ET.SubElement(padre, "LINK"), "CABLE")
    ET.SubElement(cable, "FROM").text = _REF[a]
    ET.SubElement(cable, "PORT").text = pa
    ET.SubElement(cable, "TO").text = _REF[b]
    ET.SubElement(cable, "PORT").text = pb


def construir(notas) -> bytes:
    _REF.clear()
    raiz = ET.Element("PACKETTRACER5")
    red = ET.SubElement(raiz, "NETWORK")
    equipos = ET.SubElement(red, "DEVICES")
    _equipo(equipos, "Router0", "Router", "2811", 100, 100, [
        "hostname r1",
        "interface FastEthernet0/0", " ip address 10.0.0.1 255.255.255.252",
        "interface FastEthernet0/1", " ip address 10.0.0.5 255.255.255.252"])
    _equipo(equipos, "Router1", "Router", "2811", 400, 100, [
        "hostname r2",
        "interface FastEthernet0/0", " ip address 10.0.0.2 255.255.255.252",
        "interface FastEthernet0/1", " shutdown"])
    _equipo(equipos, "Multilayer Switch0", "MultiLayerSwitch", "3560-24PS", 100, 300, [
        "hostname SWR1",
        "interface FastEthernet0/1", " no switchport",
        " ip address 10.0.0.6 255.255.255.252",
        "interface FastEthernet0/2"], vlans=True)
    for nombre, x in (("Switch0", 100), ("Switch1", 100), ("Switch2", 400)):
        _equipo(equipos, nombre, "Switch", "2960-24TT", x, 500 if nombre != "Switch1"
                else 700, ["hostname Switch"], vlans=True)
    for nombre, x in (("PC1 V3", 50), ("PC2 V4", 60), ("PC3 V3", 70), ("PC4", 80),
                      ("PC9 V9", 90), ("PC5 V5", 400)):
        _equipo(equipos, nombre, "Pc", "PC-PT", x, 900)

    enlaces = ET.SubElement(red, "LINKS")
    _cable(enlaces, "Router0", "FastEthernet0/0", "Router1", "FastEthernet0/0")
    _cable(enlaces, "Router0", "FastEthernet0/1", "Multilayer Switch0", "FastEthernet0/1")
    _cable(enlaces, "Multilayer Switch0", "FastEthernet0/2", "Switch0", "FastEthernet0/1")
    for n in (2, 3, 4):   # tres cables paralelos: EtherChannel
        _cable(enlaces, "Switch0", "FastEthernet0/%d" % n, "Switch1", "FastEthernet0/%d" % n)
    _cable(enlaces, "Switch0", "FastEthernet0/5", "PC1 V3", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/5", "PC2 V4", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/6", "PC3 V3", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/7", "PC4", "FastEthernet0")
    _cable(enlaces, "Switch1", "FastEthernet0/8", "PC9 V9", "FastEthernet0")
    _cable(enlaces, "Router1", "FastEthernet0/1", "Switch2", "FastEthernet0/1")
    _cable(enlaces, "Switch2", "FastEthernet0/2", "PC5 V5", "FastEthernet0")

    contenedor = ET.SubElement(ET.SubElement(raiz, "PHYSICALWORKSPACE"), "NOTES")
    for x, y, texto in notas:
        nota = ET.SubElement(contenedor, "NOTE")
        ET.SubElement(nota, "X").text = str(x)
        ET.SubElement(nota, "Y").text = str(y)
        ET.SubElement(nota, "TEXT").text = texto
    return ET.tostring(raiz)


NOTAS = [
    (900, 900, "SWR1\nVLAN 3 10.1.0.0/16\nVLAN 4 CUATRO 10.2.0.0 255.255.0.0"),
    # Estilo que ya usas: VLAN en un renglón y el rango con máscara abreviada.
    (950, 950, "r2:\nVLAN 5\n10.3.0.0\t-\t10.3.0.255\t-\t255.0"),
]


def prueba_formatos():
    casos = (
        ("VLAN 3 12.1.0.0/16", None, "12.1.0.0/16", "12.1.255.254", "TRES"),
        ("VLAN 4 12.4.0.0 255.252.0.0", None, "12.4.0.0/14", "12.7.255.254", "CUATRO"),
        ("VLAN 5 CINCO 12.0.0.128/25", None, "12.0.0.128/25", "12.0.0.254", "CINCO"),
        ("VLAN 2\n17.1.128..0 - 17.1.255.255 - 128.0.0", None, "17.1.128.0/17",
         "17.1.255.254", "DOS"),
        ("VLAN 7\n0.48\t-\t0.63\t255.240", ["13", "0"], "13.0.0.48/28", "13.0.0.62",
         "SIETE"),
        ("VLAN 6\n2.0.0\t-\t2.255.255\t255.0.0", ["13", "0"], "13.2.0.0/16",
         "13.2.255.254", "SEIS"),
        ("VLAN 5\n11.0.0.64\t-\t11.0.0.71\t-\t.248", None, "11.0.0.64/29", "11.0.0.70",
         "CINCO"),
        ("VLAN 3 10.1.0.0/16 gw 10.1.0.1", None, "10.1.0.0/16", "10.1.0.1", "TRES"),
    )
    for texto, base, red, gateway, nombre in casos:
        avisos = []
        vlans = planlan._vlans_de(texto, avisos, base)
        assert len(vlans) == 1, "%r -> %s %s" % (texto, vlans, avisos)
        v = vlans[0]
        assert (str(v.red), v.gateway, v.nombre) == (red, gateway, nombre), \
            "%r -> %s gw %s %s" % (texto, v.red, v.gateway, v.nombre)
    avisos = []
    planlan._vlans_de("VLAN 2\n17.1.128..0 - 17.1.255.255 - 128.0.0", avisos)
    assert any("17.1.128..0" in a for a in avisos), "la errata debe avisarse"
    assert any("no cuadra" in a for a in avisos), "la máscara que no cuadra también"
    assert planlan.rango(["FastEthernet0/2", "FastEthernet0/3", "FastEthernet0/4",
                          "FastEthernet0/7"]) == "FastEthernet0/2 - 4 , FastEthernet0/7"

    # Sin red: la VLAN queda pedida, con su nombre y sus usuarios, para
    # sacarla de la red base del sitio.
    avisos = []
    pedida, = planlan._lineas_vlan("VLAN 4 VENTAS 200 usuarios", avisos)
    assert (pedida.numero, pedida.nombre, pedida.usuarios) == (4, "VENTAS", 200), pedida
    vlans, pedidas, bloque, inicio = planlan._leer_tramo("16.1.0.0/16\nVLAN 3 500",
                                                         avisos)
    assert str(bloque) == "16.1.0.0/16" and inicio is None
    assert pedidas[0].usuarios == 500 and pedidas[0].tamano == 23 and not vlans
    _, _, bloque, _ = planlan._leer_tramo(" 16.1.0.0 255.255.0.0", avisos)
    assert str(bloque) == "16.1.0.0/16", bloque
    # Base sin diagonal y cada VLAN con la suya: se reparte desde esa dirección.
    _, pedidas, bloque, inicio = planlan._leer_tramo(
        " 16.0.0.0\nVLAN 2/17\nVLAN 3 /24\nVLAN 4 255.255.255.128", avisos)
    assert (str(bloque), str(inicio)) == ("16.0.0.0/8", "16.0.0.0"), (bloque, inicio)
    assert [(p.numero, p.tamano) for p in pedidas] == [(2, 17), (3, 24), (4, 25)]
    avisos = []
    planlan._vlans_de("VLAN 3 12.1.0.0/24 500 usuarios", avisos)
    assert any("caben 254" in a for a in avisos), avisos
    print("[ok] se leen los cuatro estilos de nota (diagonal, máscara, rango y recortado)")


def _texto_de(bloques, nombre):
    for eq, texto, _ in bloques:
        if eq == nombre or eq.endswith("(%s)" % nombre):
            return texto
    raise AssertionError("no hay bloque para %s" % nombre)


def prueba_topologia():
    topo = leer_topologia(construir(NOTAS))
    plan = topo.plan
    sitios = {s.dueno.hostname: s for s in plan.sitios}
    assert set(sitios) == {"SWR1", "r2"}, sitios
    assert all(s.como == "nombre" for s in sitios.values())

    core, roas = sitios["SWR1"], sitios["r2"]
    assert [v.numero for v in core.vlans] == [3, 4]
    assert core.switches == {"Switch0": 1, "Switch1": 2}, core.switches
    assert core.raiz == "Switch0", "la raíz es el switch pegado al core"
    assert len(core.canales) == 1
    canal = core.canales[0]
    assert (canal.a, canal.modo_a, canal.b, canal.modo_b) == \
        ("Switch0", "active", "Switch1", "passive"), canal
    assert roas.puerto_lan == "FastEthernet0/1"
    assert roas.raiz is None, "un sitio de un solo switch no lleva raíz"
    print("[ok] sitios, raíz de STP y lado activo del EtherChannel")

    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    trayectos, problemas = analisis.verificar_ruteo(topo, subredes, rutas)
    assert not inalcanzables and not problemas, (inalcanzables, problemas)
    assert trayectos > 0
    print("[ok] las redes del plan entran al ruteo: %d trayectos sin bucles" % trayectos)

    bloques = reporte.bloques_por_equipo(topo, rutas)
    orden = [eq for eq, _, _ in bloques]
    assert orden.index("r1") < orden.index("SWR1") < orden.index("Switch (Switch0)"), \
        "primero routers, luego cores, luego switches: %s" % orden

    swr1 = _texto_de(bloques, "SWR1")
    for esperado in ("ip routing", "vlan 4\n name CUATRO", "interface Vlan3\n"
                     " ip address 10.1.255.254 255.255.0.0\n no shutdown",
                     "ip dhcp pool VLAN4\n network 10.2.0.0 255.255.0.0\n"
                     " default-router 10.2.255.254",
                     "interface FastEthernet0/2\n switchport trunk encapsulation "
                     "dot1q\n switchport mode trunk",
                     "ip route 10.3.0.0 255.255.255.0 10.0.0.5"):
        assert esperado in swr1, "falta en SWR1: %r\n%s" % (esperado, swr1)

    r2 = _texto_de(bloques, "r2")
    for esperado in ("interface FastEthernet0/1\n no shutdown",
                     "interface FastEthernet0/1.5\n encapsulation dot1Q 5\n"
                     " ip address 10.3.0.254 255.255.255.0",
                     "ip dhcp pool VLAN5\n network 10.3.0.0 255.255.255.0\n"
                     " default-router 10.3.0.254",
                     "ip route 10.1.0.0 255.255.0.0 10.0.0.1"):
        assert esperado in r2, "falta en r2: %r\n%s" % (esperado, r2)

    sw0 = _texto_de(bloques, "Switch0")
    for esperado in ("spanning-tree vlan 1 priority 4096",
                     "interface FastEthernet0/1\n switchport mode trunk",
                     "interface range FastEthernet0/2 - 4\n switchport mode trunk\n"
                     " channel-group 1 mode active",
                     "interface FastEthernet0/5\n switchport mode access\n"
                     " switchport access vlan 3"):
        assert esperado in sw0, "falta en Switch0: %r\n%s" % (esperado, sw0)
    sw1 = _texto_de(bloques, "Switch1")
    assert "channel-group 1 mode passive" in sw1 and "spanning-tree" not in sw1
    assert "interface FastEthernet0/5\n switchport mode access\n switchport access vlan 4" in sw1
    assert "FastEthernet0/7" not in sw1, "la PC sin VLAN no debe llevar puerto de acceso"
    print("[ok] bloques de core, router-on-a-stick y switches con el estilo de las prácticas")

    hallazgos = analisis.revisar(topo, subredes, rutas)
    textos = [h.mensaje for h in hallazgos]
    assert any("PC4" in t and "sin VLAN" in t for t in textos), textos
    assert any("PC9 V9" in t and "VLAN 9" in t for t in hallazgos_de(hallazgos, "ERROR")), textos
    assert not any("ip routing" in t for t in textos), \
        "no debe reclamar 'ip routing' cuando el bloque generado ya lo trae"
    print("[ok] avisa la PC sin VLAN y marca como error la VLAN que el sitio no tiene")


def hallazgos_de(hallazgos, nivel):
    return [h.mensaje for h in hallazgos if h.nivel == nivel]


def prueba_traslape_y_cercania():
    notas = NOTAS + [(420, 110, "VLAN 6 10.1.128.0/17")]   # sin nombre y encimada
    topo = leer_topologia(construir(notas))
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    hallazgos = analisis.revisar(topo, subredes, rutas)
    errores = hallazgos_de(hallazgos, "ERROR")
    assert any("se traslapa" in e and "10.1.0.0/16" in e for e in errores), errores
    avisos = hallazgos_de(hallazgos, "AVISO")
    assert any("por cercanía" in a for a in avisos), avisos
    print("[ok] detecta VLANs encimadas y avisa cuando una nota se asigna por cercanía")


def prueba_svi_en_router():
    """El error de P2: la IP de la VLAN puesta en 'interface Vlan3' de un router
    sin módulo de switch, y la subinterfaz que sí serviría, sin IP."""
    raiz = ET.fromstring(construir([]))
    for dev in raiz.iter("DEVICE"):
        if dev.findtext("ENGINE/NAME") == "Router1":
            rc = dev.find("ENGINE/RUNNINGCONFIG")
            for linea in ("interface FastEthernet0/1.3", " encapsulation dot1Q 3",
                          "interface Vlan3", " ip address 10.3.0.254 255.255.255.0"):
                ET.SubElement(rc, "LINE").text = linea
    topo = leer_topologia(ET.tostring(raiz))
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    hallazgos = analisis.revisar(topo, subredes, rutas)
    assert any("Vlan3" in e and "subinterfaz" in e
               for e in hallazgos_de(hallazgos, "ERROR")), hallazgos
    assert any("FastEthernet0/1.3" in a and "no tiene IP" in a
               for a in hallazgos_de(hallazgos, "AVISO")), hallazgos
    print("[ok] marca la IP de VLAN puesta en un router en vez de en la subinterfaz")


def _plan_de(notas):
    topo = leer_topologia(construir(notas))
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    _, problemas = analisis.verificar_ruteo(topo, subredes, rutas)
    assert not problemas, problemas
    hallazgos = analisis.revisar(topo, subredes, rutas)
    sitios = {s.dueno.hostname: s for s in topo.plan.sitios}
    return topo, subredes, rutas, hallazgos, sitios


def prueba_red_base():
    """Sólo el hostname y la red base: las VLANs salen de las PCs del sitio y
    la red se reparte entre ellas."""
    topo, subredes, rutas, hallazgos, sitios = _plan_de([
        (900, 900, "SWR1 10.1.0.0/16"), (950, 950, "r2\n10.3.0.0/24")])
    core, roas = sitios["SWR1"], sitios["r2"]
    # PC1 V3, PC2 V4, PC3 V3 y PC9 V9: tres VLANs, así que cuartos (/18).
    assert [(v.numero, str(v.red), v.gateway) for v in core.vlans] == [
        (3, "10.1.0.0/18", "10.1.63.254"), (4, "10.1.64.0/18", "10.1.127.254"),
        (9, "10.1.128.0/18", "10.1.191.254")], core.vlans
    assert core.reparto == "en partes iguales"
    assert [(v.numero, str(v.red)) for v in roas.vlans] == [(5, "10.3.0.0/24")]
    errores = hallazgos_de(hallazgos, "ERROR")
    assert not any("VLAN 9" in e for e in errores), \
        "la VLAN de la PC9 ya es del sitio: %s" % errores

    bloques = reporte.bloques_por_equipo(topo, rutas)
    swr1 = _texto_de(bloques, "SWR1")
    assert "interface Vlan9\n ip address 10.1.191.254 255.255.192.0" in swr1, swr1
    assert "ip dhcp pool VLAN9\n network 10.1.128.0 255.255.192.0\n" \
           " default-router 10.1.191.254" in swr1, swr1
    assert "interface FastEthernet0/1.5\n encapsulation dot1Q 5\n" \
           " ip address 10.3.0.254 255.255.255.0" in _texto_de(bloques, "r2")
    texto = reporte.construir("prueba", "prueba", topo, subredes, rutas, [], hallazgos)
    assert "red base 10.1.0.0/16, repartida en partes iguales" in texto
    assert "VLAN 3   TRES       10.1.0.0 - 10.1.63.255 - 255.255.192.0   gw " \
           "10.1.63.254" in texto, texto[texto.index("3. PLAN"):][:600]
    print("[ok] con la red base sola, reparte en partes iguales entre las VLANs de las PCs")

    # Por usuarios: la más grande primero, y la lista de la nota manda.
    _, _, _, hallazgos, sitios = _plan_de([
        (900, 900, "SWR1 10.1.0.0/16\nVLAN 3 1000\nVLAN 4 VENTAS 200"),
        (950, 950, "r2\n10.3.0.0/24")])
    core = sitios["SWR1"]
    assert [(v.numero, v.nombre, str(v.red)) for v in core.vlans] == [
        (3, "TRES", "10.1.0.0/22"), (4, "VENTAS", "10.1.4.0/24")], core.vlans
    assert core.reparto.startswith("por usuarios"), core.reparto
    assert any("PC9 V9" in e for e in hallazgos_de(hallazgos, "ERROR"))
    print("[ok] con usuarios reparte por VLSM, de la VLAN más grande a la más chica")

    # Una red base que incluye los enlaces: se saltan los bloques ocupados.
    _, _, _, hallazgos, sitios = _plan_de([
        (900, 900, "SWR1 10.1.0.0/16"), (950, 950, "r2 10.0.0.0/24")])
    assert [(v.numero, str(v.red)) for v in sitios["r2"].vlans] == [(5, "10.0.0.128/25")]
    assert any("se usaron /25" in a for a in hallazgos_de(hallazgos, "AVISO"))
    print("[ok] el reparto se salta las redes que ya usa la práctica")


def _pools_cuadran(texto):
    """Cada pool reparte la red de su VLAN y da como gateway la IP que lleva
    la SVI o la subinterfaz de esa VLAN. Devuelve cuántos pools revisó."""
    import ipaddress
    import re
    interfaces, pools, actual, pool = {}, {}, None, None
    for linea in texto.splitlines():
        m = re.match(r"interface \S*?(?:Vlan|\.)(\d+)$", linea)
        if m or linea.startswith("interface") or linea.startswith("ip dhcp pool"):
            actual = int(m.group(1)) if m else None
            m = re.match(r"ip dhcp pool VLAN(\d+)$", linea)
            pool = int(m.group(1)) if m else None
        elif linea.startswith(" ip address") and actual is not None:
            interfaces[actual] = tuple(linea.split()[2:4])
        elif linea.startswith(" network") and pool is not None:
            pools.setdefault(pool, {})["red"] = tuple(linea.split()[1:3])
        elif linea.startswith(" default-router") and pool is not None:
            pools.setdefault(pool, {})["gw"] = linea.split()[1]
    for vlan, pool in pools.items():
        red = ipaddress.IPv4Network("%s/%s" % pool["red"])
        assert interfaces[vlan] == (pool["gw"], pool["red"][1]), (vlan, pool, interfaces)
        assert ipaddress.IPv4Address(pool["gw"]) in red and \
            str(red.broadcast_address - 1) == pool["gw"], (vlan, pool)
    return len(pools)


def prueba_base_con_diagonales():
    """La forma de la práctica: la red base sin diagonal y cada VLAN con la
    suya. Dos sitios con la misma base quedan uno tras otro."""
    topo, _, rutas, hallazgos, sitios = _plan_de([
        (900, 900, "SWR1 10.0.0.0\nVLAN 3/17\nVLAN 4/24\nVLAN 9/25"),
        (950, 950, "r2 10.0.0.0\nVLAN 5/26")])
    # r2 va primero (routers antes que cores): 10.0.0.0/26 pisa los enlaces.
    assert [(v.numero, str(v.red)) for v in sitios["r2"].vlans] == [(5, "10.0.0.64/26")]
    # SWR1, de la más grande a la más chica, en el primer hueco libre.
    assert [(v.numero, str(v.red), v.gateway) for v in sitios["SWR1"].vlans] == [
        (3, "10.0.128.0/17", "10.0.255.254"), (4, "10.0.1.0/24", "10.0.1.254"),
        (9, "10.0.0.128/25", "10.0.0.254")], sitios["SWR1"].vlans
    assert not hallazgos_de(hallazgos, "ERROR"), hallazgos_de(hallazgos, "ERROR")
    bloques = reporte.bloques_por_equipo(topo, rutas)
    revisados = _pools_cuadran(_texto_de(bloques, "SWR1")) + \
        _pools_cuadran(_texto_de(bloques, "r2"))
    assert revisados == 4, revisados

    # El orden en que se escriben las VLANs no cambia nada.
    _, _, _, _, revuelto = _plan_de([
        (950, 950, "r2 10.0.0.0\nVLAN 5/26"),
        (900, 900, "SWR1 10.0.0.0\nVLAN 9/25\nVLAN 3/17\nVLAN 4/24")])
    assert [(v.numero, str(v.red)) for v in revuelto["SWR1"].vlans] == \
        [(v.numero, str(v.red)) for v in sitios["SWR1"].vlans], revuelto["SWR1"].vlans
    print("[ok] base sin diagonal y VLANs con la suya: VLSM sin encimarse, sin "
          "importar el orden, y cada pool con el gateway de su VLAN")

    _, _, _, hallazgos, _ = _plan_de([(900, 900, "SWR1 10.0.0.0\nVLAN 3/17\nVLAN 4")])
    assert any("VLAN 4 no dice de qué tamaño" in e
               for e in hallazgos_de(hallazgos, "ERROR")), hallazgos
    print("[ok] la VLAN que no trae tamaño cuando las demás sí, se marca")


R4T = ["hostname Router", "interface FastEthernet0/0", " shutdown",
       "interface FastEthernet0/1", " shutdown", "interface Ethernet0/0/0", " shutdown"]
M4T = ["hostname Switch", "interface FastEthernet0/1", "interface FastEthernet0/2"]


def _cuatro_routers(notas, enlaces=(".4", ".8", ".12", ".16", ".20"), cfg=None):
    """R1 - R2 - R3 - R4, con SWR1 colgando de R1 y SWR2 de R3, como en P4_P3."""
    cfg = cfg or {}
    _REF.clear()
    raiz = ET.Element("PACKETTRACER5")
    red = ET.SubElement(raiz, "NETWORK")
    equipos = ET.SubElement(red, "DEVICES")
    lugares = {"R1": (100, 100), "R2": (1000, 100), "R3": (2000, 100), "R4": (3000, 100),
               "SWR1": (100, 1000), "SWR2": (2000, 1000), "S1": (100, 1500), "S2": (1000, 600),
               "S3": (2000, 1500), "S4": (3000, 600)}
    for n in ("R1", "R2", "R3", "R4"):
        _equipo(equipos, n, "Router", "2811", *lugares[n], cfg.get(n, R4T))
    for n in ("SWR1", "SWR2"):
        _equipo(equipos, n, "MultiLayerSwitch", "3560-24PS", *lugares[n], cfg.get(n, M4T), vlans=True)
    for n in ("S1", "S2", "S3", "S4"):
        _equipo(equipos, n, "Switch", "2960-24TT", *lugares[n], ["hostname Switch"], vlans=True)
    cables = ET.SubElement(red, "LINKS")
    for a, pa, b, pb in (("R1", "FastEthernet0/0", "R2", "FastEthernet0/0"),
                         ("R2", "FastEthernet0/1", "R3", "FastEthernet0/0"),
                         ("R3", "FastEthernet0/1", "R4", "FastEthernet0/0"),
                         ("R1", "Ethernet0/0/0", "SWR1", "FastEthernet0/1"),
                         ("R3", "Ethernet0/0/0", "SWR2", "FastEthernet0/1"),
                         ("SWR1", "FastEthernet0/2", "S1", "FastEthernet0/1"),
                         ("R2", "Ethernet0/0/0", "S2", "FastEthernet0/1"),
                         ("SWR2", "FastEthernet0/2", "S3", "FastEthernet0/1"),
                         ("R4", "FastEthernet0/1", "S4", "FastEthernet0/1")):
        _cable(cables, a, pa, b, pb)
    contenedor = ET.SubElement(ET.SubElement(raiz, "PHYSICALWORKSPACE"), "NOTES")
    medios = ((550, 100), (1500, 100), (2500, 100), (100, 550), (2000, 550))
    for (x, y), texto in list(zip(medios, enlaces)) + [((500 + 300 * i, 3000), t) for i, t in enumerate(notas)]:
        nota = ET.SubElement(contenedor, "NOTE")
        ET.SubElement(nota, "X").text = str(x)
        ET.SubElement(nota, "Y").text = str(y)
        ET.SubElement(nota, "TEXT").text = texto
    return ET.tostring(raiz)


def _redes(topo, sitio):
    s = next(x for x in topo.plan.sitios if (x.rotulo or x.dueno.hostname) == sitio)
    return [(v.numero, str(v.red)) for v in s.vlans]


def _reportado(topo):
    subredes = analisis.construir_subredes(topo)
    rutas, _ = analisis.calcular_rutas(topo, subredes)
    return analisis.revisar(topo, subredes, rutas), rutas


def prueba_orden_de_reparto():
    """Como en las hojas de P4_P3: una tabla por VLAN, de la más chica a la más
    grande, tachando lo que choca; el multicapa va en el lugar de su router."""
    topo = leer_topologia(_cuatro_routers([
        "R2 16.0.0.0\nVLAN 2/17\nVLAN 3/22\nVLAN 4/24",
        "R3 16.0.0.0\nVLAN 2/17\nVLAN 3/22\nVLAN 4/24\nVLAN 5/15",
        "R4 16.0.0.0\nVLAN 3/22\nVLAN 4/24\nVLAN 5/15",
        "SWR1 16.0.0.0\nVLAN 3/22"]))
    assert _redes(topo, "SWR1") == [(3, "16.0.4.0/22")], _redes(topo, "SWR1")
    assert _redes(topo, "R2") == [(2, "16.0.128.0/17"), (3, "16.0.8.0/22"), (4, "16.0.1.0/24")]
    assert _redes(topo, "R3") == [(2, "16.1.0.0/17"), (3, "16.0.12.0/22"), (4, "16.0.2.0/24"),
                                  (5, "16.2.0.0/15")], _redes(topo, "R3")
    assert _redes(topo, "R4") == [(3, "16.0.16.0/22"), (4, "16.0.3.0/24"), (5, "16.4.0.0/15")]
    hallazgos, _ = _reportado(topo)
    assert any("las redes salieron de la más chica" in h.mensaje for h in topo.plan.hallazgos), topo.plan.hallazgos
    print("[ok] sin nada escrito, las redes salen VLAN por VLAN, de la más chica a la más grande")

    # Lo ya configurado manda: con esta V2 en 16.0.1.0 sólo cuadra de grande a chica.
    r2 = ["hostname R2", "interface FastEthernet0/0", " no ip address", "interface FastEthernet0/1",
          " no ip address", "interface Ethernet0/0/0", " no ip address", "interface Ethernet0/0/0.2",
          " encapsulation dot1Q 2", " ip address 16.0.1.254 255.255.255.0"]
    topo = leer_topologia(_cuatro_routers(["R2 16.0.0.0\nVLAN 2/24\nVLAN 3/25", "R4 16.0.0.0\nVLAN 3/25"], cfg={"R2": r2}))
    assert _redes(topo, "R2") == [(2, "16.0.1.0/24"), (3, "16.0.0.128/25")], _redes(topo, "R2")
    assert _redes(topo, "R4") == [(3, "16.0.2.0/25")], _redes(topo, "R4")
    assert any("tus redes ya van de la más grande" in h.mensaje for h in topo.plan.hallazgos), topo.plan.hallazgos
    print("[ok] lo que ya está configurado manda sobre el orden")


def prueba_nota_de_router_sin_lan():
    """El formato de P4_P3: sin red base, con el rango hasta la última utilizable, y
    una nota a nombre de un router cuya LAN cuelga del multicapa."""
    topo = leer_topologia(_cuatro_routers([
        "R3\nVLAN 2/17\n 16.1.0.0 - 16.1.127.254 - 255.255.128.0\nVLAN 5/16\n 16.2.0.0 - 16.3.255.254 - 255.254.0.0",
        "R2\nVLAN 4/24\n 16.0.1.0 - 16.0.1.254 - 255.255.255.0"]))
    s = next(x for x in topo.plan.sitios if x.rotulo == "R3")
    assert s.dueno.nombre == "SWR2", s.dueno.nombre
    assert _redes(topo, "R3") == [(2, "16.1.0.0/17"), (5, "16.2.0.0/15")], _redes(topo, "R3")
    mensajes = [h.mensaje for h in topo.plan.hallazgos]
    assert "la nota de R3 se aplicó a SWR2: R3 no tiene LAN propia" in mensajes[0:] or \
        any("se aplicó a SWR2" in m for m in mensajes), mensajes
    assert not any("subred exacta" in m for m in mensajes), mensajes
    assert any("VLAN 5: la nota dice /16, pero tu rango y tu máscara son de /15" in m for m in mensajes), mensajes
    hallazgos, rutas = _reportado(topo)
    assert not any("no se sabe en qué red" in h for h in hallazgos_de(hallazgos, "AVISO")), hallazgos_de(hallazgos, "AVISO")
    bloques = reporte.bloques_por_equipo(topo, rutas)
    swr2 = _texto_de(bloques, "SWR2")
    assert "interface Vlan2\n ip address 16.1.127.254 255.255.128.0" in swr2, swr2
    assert "interface FastEthernet0/1\n no switchport\n ip address 16.0.0.22" in swr2, swr2
    print("[ok] la nota de un router sin LAN va en su multicapa, y los enlaces salen de sus redes")

    # Si el multicapa ya tiene su nota, la de R3 sí es un error que hay que decir.
    topo = leer_topologia(_cuatro_routers(["R3 16.0.0.0\nVLAN 2/24", "SWR2 16.0.0.0\nVLAN 9/24"]))
    assert any("no tiene ningún switch cableado" in h.mensaje for h in topo.plan.hallazgos), topo.plan.hallazgos
    print("[ok] si el multicapa ya tiene nota, la del router se marca")


def prueba_combo_olvidado():
    """Un combo olvidado se agrega contando desde el último. Aquí los combos se toman
    tal cual, así que no recorre a los demás; revisarlo le toca al módulo."""
    topo = leer_topologia(_cuatro_routers([
        "R2\nVLAN 3/22\n 16.0.8.0 - 16.0.11.254 - 255.255.252.0\nVLAN 4/24\n 16.0.1.0 - 16.0.1.254 - 255.255.255.0",
        "R4\nVLAN 3/22\n 16.0.12.0 - 16.0.15.254 - 255.255.252.0\nVLAN 4/24\n 16.0.2.0 - 16.0.2.254 - 255.255.255.0",
        "SWR1\nVLAN 3/22\n 16.0.4.0 - 16.0.7.254 - 255.255.252.0\nVLAN 4/24\n 16.0.16.0 - 16.0.16.254 - 255.255.255.0\n"
        "VLAN 6/28\n 16.0.17.0 - 16.0.17.14 - 255.255.255.240"]))
    assert _redes(topo, "SWR1") == [(3, "16.0.4.0/22"), (4, "16.0.16.0/24"), (6, "16.0.17.0/28")], _redes(topo, "SWR1")
    assert _redes(topo, "R2") == [(3, "16.0.8.0/22"), (4, "16.0.1.0/24")], _redes(topo, "R2")
    assert _redes(topo, "R4") == [(3, "16.0.12.0/22"), (4, "16.0.2.0/24")], _redes(topo, "R4")
    assert not hallazgos_de(topo.plan.hallazgos, "ERROR"), hallazgos_de(topo.plan.hallazgos, "ERROR")
    _, rutas = _reportado(topo)
    assert "ip address 16.0.17.14 255.255.255.240" in _texto_de(reporte.bloques_por_equipo(topo, rutas), "SWR1")
    print("[ok] un combo olvidado se queda donde lo escribiste y no recorre a los demás")


def prueba_sin_notas():
    topo = leer_topologia(construir([]))
    assert topo.plan.vacio
    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    texto = reporte.construir("prueba", "prueba", topo, subredes, rutas,
                              inalcanzables, analisis.revisar(topo, subredes, rutas))
    assert "Place Note" in texto, "sin notas, el reporte explica cómo escribirlas"
    print("[ok] sin notas no se genera LAN y el reporte explica cómo escribirlas")


def main():
    prueba_formatos()
    prueba_topologia()
    prueba_traslape_y_cercania()
    prueba_svi_en_router()
    prueba_red_base()
    prueba_base_con_diagonales()
    prueba_orden_de_reparto()
    prueba_nota_de_router_sin_lan()
    prueba_combo_olvidado()
    prueba_sin_notas()
    return 0


if __name__ == "__main__":
    sys.exit(main())
