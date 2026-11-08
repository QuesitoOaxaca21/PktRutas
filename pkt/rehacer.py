"""Equipos que se rehacen desde cero.

Agregar comandos arregla lo que falta y lo que el mismo comando reemplaza (una
IP, la VLAN de un puerto, el nombre de una VLAN). Hay errores que no se quitan
así: una ruta que manda el tráfico al lado equivocado, un pool de DHCP que
estorba, un EtherChannel con otro grupo o modo, la prioridad de STP en el
switch que no es la raíz, una IP en el puerto que lleva las subinterfaces o
una subinterfaz con la VLAN cambiada.

En esos equipos se borra lo que el programa configura (rutas, pools, STP,
subinterfaces, SVI, canales e IPs) y se vuelve a poner todo, ya correcto. Lo
demás (contraseñas, ACL, NAT, OSPF...) no se toca.
"""

from __future__ import annotations

import ipaddress
import re

from .plan import PRIORIDAD_RAIZ

# Pares de modos con los que se forma un EtherChannel: LACP, PAgP o forzado.
_FORMAN = {frozenset(p) for p in (("on",), ("active",), ("active", "passive"),
                                  ("desirable",), ("desirable", "auto"))}


def _forman(uno, otro) -> bool:
    return frozenset((uno, otro)) in _FORMAN


def _red(direccion, mascara):
    try:
        return ipaddress.IPv4Network("%s/%s" % (direccion, mascara), strict=False)
    except (TypeError, ValueError):
        return None


def ip_suelta(topo, disp, puerto) -> bool:
    """La IP del puerto no la comparte ningún otro equipo: sobra. (Si alguien
    más está en su red, como en la VLAN nativa de un router-on-a-stick, va a
    propósito.)"""
    ifaz = next((i for i in disp.interfaces if i.nombre.lower() == puerto.lower()), None)
    if ifaz is None or not ifaz.configurada:
        return True
    red = _red(ifaz.ip, ifaz.mascara)
    return red is not None and not any(
        d is not disp and any(ipaddress.IPv4Address(i.ip) in red for i in d.interfaces_ip)
        for d in topo.dispositivos)


def motivos(topo, rutas) -> dict:
    """{equipo: [motivo, ...]} de los equipos que hay que rehacer desde cero."""
    salida = {}
    vis = topo.nombres_visibles()
    por_nombre = {d.nombre: d for d in topo.dispositivos}

    def anota(disp, texto):
        salida.setdefault(disp.nombre, []).append(texto)

    # Rutas a una red que mandan el tráfico por donde no llega.
    for router in topo.ruteadores:
        for r in rutas.get(router.nombre, []):
            if r.mal_puesta:
                anota(router, "la ruta a %s/%d va por %s, que no lleva hacia allá (va por %s)"
                      % (r.red, ipaddress.IPv4Network("0.0.0.0/%s" % r.mascara).prefixlen,
                         r.salto_configurado, r.salto))

    plan = getattr(topo, "plan", None)
    sitios = plan.sitios if plan is not None else []

    # Pools de DHCP que cubren la red de una VLAN y no son el de ninguna VLAN
    # del equipo (red, máscara y puerta de enlace).
    vlans = [(s.dueno.nombre, v) for s in sitios for v in s.vlans]
    for disp in topo.dispositivos:
        propias = [v for dueno, v in vlans if dueno == disp.nombre]
        for pool in (disp.cfg.pools if disp.cfg else []):
            red = _red(pool.red, pool.mascara)
            if red is None or any((pool.red, pool.mascara, pool.gateway) ==
                                  (v.direccion, v.mascara, v.gateway) for v in propias):
                continue
            choca = [v for v in propias if red.overlaps(v.red)] or \
                [v for _, v in vlans if red.overlaps(v.red)]
            if choca:
                v = choca[0]
                anota(disp, "el pool %s (%s, puerta %s) no es el de la VLAN %d (%s, puerta "
                      "%s)" % (pool.nombre, red, pool.gateway or "ninguna", v.numero, v.red,
                               v.gateway))

    for sitio in sitios:
        # EtherChannel que no se forma (puntas con modos que no se entienden, o
        # puertos del mismo canal en grupos o modos distintos), o en puertos que
        # no van en canal. Con PAgP (desirable / auto) también se forma: no
        # tiene que ser el LACP que propone el programa.
        planeados = set()
        for c in sitio.canales:
            puntas = []
            for equipo, puertos, modo in ((c.a, c.puertos_a, c.modo_a),
                                          (c.b, c.puertos_b, c.modo_b)):
                disp = por_nombre.get(equipo)
                planeados |= {(equipo, p.lower()) for p in puertos}
                ics = [disp.cfg.por_nombre(p) if disp and disp.cfg else None for p in puertos]
                hoy = {(ic.canal, ic.modo_canal or "on") if ic is not None and ic.canal
                       is not None else None for ic in ics}
                puntas.append((disp, puertos, modo, hoy))
            for disp, puertos, modo, hoy in puntas:
                if len(hoy) > 1:
                    anota(disp, "los puertos %s de su EtherChannel no están todos en el "
                          "mismo canal y modo" % ", ".join(puertos))
            (da, pa, ma, ha), (db, pb, mb, hb) = puntas
            if len(ha) > 1 or len(hb) > 1 or ha == hb == {None}:
                continue
            modo_a = ma if ha == {None} else next(iter(ha))[1]     # lo que tendrá
            modo_b = mb if hb == {None} else next(iter(hb))[1]
            if not _forman(modo_a, modo_b):
                for disp, puertos, hoy, otro in ((da, pa, ha, modo_b), (db, pb, hb, modo_a)):
                    if hoy != {None}:
                        anota(disp, "su EtherChannel en %s está en modo %s y del otro lado "
                              "va %s: así no se forma" % (", ".join(puertos),
                                                           next(iter(hoy))[1], otro))
        for nombre in list(sitio.switches) + [sitio.dueno.nombre]:
            disp = por_nombre.get(nombre)
            for ic in (disp.cfg.interfaces if disp and disp.cfg else []):
                if ic.canal is not None and not ic.nombre.lower().startswith("port-channel") \
                        and (nombre, ic.nombre.lower()) not in planeados:
                    anota(disp, "%s está en el canal %d, y ese puerto no va en EtherChannel"
                          % (ic.nombre, ic.canal))
                    break

        # Una prioridad de STP que le compite a la raíz de su red (una raíz
        # secundaria, más alta, sí se vale).
        if sitio.raiz is not None:
            for nombre in list(sitio.switches) + [sitio.dueno.nombre]:
                disp = por_nombre.get(nombre)
                if nombre == sitio.raiz or disp is None or disp.cfg is None:
                    continue
                if disp.cfg.stp.get(1, 32768) <= PRIORIDAD_RAIZ:
                    anota(disp, "tiene prioridad de STP en la VLAN 1, y la raíz de su red "
                          "es %s" % vis[sitio.raiz])

        # Router-on-a-stick: el puerto de las subinterfaces no lleva IP, y cada
        # subinterfaz lleva su propia VLAN.
        dueno, lan = sitio.dueno, sitio.puerto_lan
        if dueno.es_multicapa or not lan or dueno.cfg is None:
            continue
        numeros = {v.numero for v in sitio.vlans}
        for ic in dueno.cfg.interfaces:
            nombre = ic.nombre.lower()
            if nombre == lan.lower() and ic.ip and ip_suelta(topo, dueno, ic.nombre):
                anota(dueno, "%s tiene la IP %s, que no comparte nadie, y es el puerto de las "
                      "subinterfaces de sus VLANs" % (ic.nombre, ic.ip))
            elif nombre.startswith("vlan") and ic.ip:
                anota(dueno, "tiene IP en %s; en un router las VLANs van en subinterfaces"
                      % ic.nombre)
            elif ic.es_subinterfaz and ic.padre.lower() == lan.lower():
                sufijo = ic.nombre.split(".", 1)[1]
                numero = int(sufijo) if sufijo.isdigit() else None
                if ic.vlan is not None and ic.vlan != numero:
                    anota(dueno, "%s tiene encapsulation dot1Q %d" % (ic.nombre, ic.vlan))
                elif numero not in numeros and (ic.ip or ic.vlan is not None):
                    anota(dueno, "%s es de la VLAN %s, que su red no tiene" % (ic.nombre, sufijo))
    return salida


def quitar(lineas):
    """(running-config sin lo que el programa configura, comandos que lo
    quitan): rutas, pools, prioridades de STP, subinterfaces, SVI (menos la
    VLAN 1), Port-channel, canales, IPs de los puertos y 'no switchport'."""
    limpias, comandos, creadas = [], [], []
    i = 0
    while i < len(lineas):
        linea = lineas[i].rstrip()
        j = i + 1
        while j < len(lineas) and lineas[j].startswith(" "):
            j += 1
        cuerpo = [x.rstrip() for x in lineas[i + 1:j]]
        s = linea.strip()
        bajo = s.lower()
        i = j
        if bajo.startswith(("ip route ", "ip dhcp excluded-address ")):
            comandos.append("no " + s)
            continue
        if bajo.startswith("ip dhcp pool "):
            comandos.append("no ip dhcp pool " + s.split()[3])
            continue
        m = re.match(r"spanning-tree vlan (\S+) priority \d+$", bajo)
        if m:
            comandos.append("no spanning-tree vlan %s priority" % m.group(1))
            continue
        if bajo.startswith("interface "):
            nombre = s.split(None, 1)[1]
            tipo = nombre.lower()
            if "." in tipo or tipo.startswith("port-channel") or \
                    (tipo.startswith("vlan") and tipo != "vlan1"):
                # Al último: en Packet Tracer, borrar el Port-channel antes de soltar
                # sus puertos los deja apagados.
                creadas.append("no interface " + nombre)
                continue
            if tipo != "vlan1":
                deja, quita = [], []
                ruteado = any(x.strip().lower() == "no switchport" for x in cuerpo)
                for x in cuerpo:
                    xs = x.strip().lower()
                    if xs.startswith("ip address "):
                        # En el multicapa 'switchport' ya la quita; en un router
                        # queda 'no ip address', como lo deja IOS.
                        if not ruteado:
                            quita.append(" no ip address")
                            deja.append(" no ip address")
                    elif xs == "no switchport":
                        quita.append(" switchport")
                    elif xs.startswith("channel-group "):
                        quita += [" no channel-group", " no shutdown"]
                    else:
                        deja.append(x)
                if quita:
                    comandos += ["interface " + nombre] + quita
                limpias += [linea] + deja
                continue
        if s == "!" and limpias and limpias[-1].strip() == "!":
            continue                            # sin '!' repetidos donde se quitó algo
        limpias += [linea] + cuerpo
    return limpias, comandos + creadas
