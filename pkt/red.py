"""Analisis de red: subredes, grafo de ruteadores, ruteo estatico y revisiones.

La adyacencia entre ruteadores se deduce de la capa 3 (dos interfaces en la
misma subred estan en el mismo segmento), no del cableado. Asi los switches
son transparentes, que es justo como se razona al escribir rutas estaticas a
mano, y el calculo sigue funcionando aunque no se hayan podido leer los cables.
"""

from __future__ import annotations

import ipaddress
from collections import deque
from dataclasses import dataclass, field

ERROR, AVISO, INFO = "ERROR", "AVISO", "INFO"


@dataclass
class Hallazgo:
    nivel: str
    equipo: str
    mensaje: str


@dataclass
class Subred:
    red: str
    mascara: str
    prefijo: int
    interfaces: list = field(default_factory=list)   # (dispositivo, interfaz)

    @property
    def clave(self):
        return (self.red, self.mascara)

    @property
    def etiqueta(self):
        return "%s/%d" % (self.red, self.prefijo)

    def ruteadores(self):
        return [(d, i) for d, i in self.interfaces if d.es_ruteador]


@dataclass
class Ruta:
    red: str
    mascara: str
    salto: str
    interfaz_salida: str
    destino: str
    saltos: int
    ya_configurada: bool = False
    cubierta_por: str = ""      # prefijo de la ruta que ya la resuelve
    salto_configurado: str = ""

    @property
    def marca(self) -> str:
        if not self.ya_configurada:
            return ""
        if self.cubierta_por in ("", "%s/%s" % (self.red, self.mascara)):
            return " (ya)"
        return " (por %s)" % self.cubierta_por


def _red_de(ip, mascara):
    return ipaddress.IPv4Interface("%s/%s" % (ip, mascara)).network


def clave_cable(a, pa, b, pb):
    """Identifica un cable sin importar de qué lado se lea."""
    return frozenset({(a, pa.lower()), (b, pb.lower())})


def _cobertura(rutas_configuradas) -> list:
    """Convierte (red, mascara, salto) en redes comparables."""
    salida = []
    for red, mascara, salto in rutas_configuradas:
        try:
            salida.append((ipaddress.IPv4Network("%s/%s" % (red, mascara),
                                                 strict=False), salto))
        except ValueError:
            continue
    return salida


def _cubre(cobertura, destino):
    """Ruta configurada mas especifica que contiene al destino.

    Una ruta por omision (0.0.0.0/0) o una sumarizada resuelven muchos
    destinos a la vez: compararlas por igualdad exacta hacia creer que
    faltaban rutas que en realidad ya estaban resueltas.
    """
    mejor = None
    for red, salto in cobertura:
        if destino.subnet_of(red) and (mejor is None
                                       or red.prefixlen > mejor[0].prefixlen):
            mejor = (red, salto)
    return mejor


def _indice_de_ips(topo) -> dict:
    """Direccion -> ruteador que la tiene, para seguir los siguientes saltos."""
    return {i.ip: d for d in topo.ruteadores for i in d.interfaces_ip}


def entrega(topo, origen, destino, indice):
    """Sigue las rutas *configuradas* desde `origen` hasta la red `destino`.

    Es la prueba que de verdad contesta "por que no da ping": no compara
    listas de rutas, camina la topologia salto por salto como lo haria un
    paquete, usando solo lo que los equipos tienen puesto hoy.

    Devuelve (llega, causa, equipo_donde_se_corta).
    """
    actual, visitados = origen, set()
    for _ in range(len(topo.ruteadores) + 2):
        if any(destino.subnet_of(red) for red in actual.redes()):
            return True, "", ""
        if actual.nombre in visitados:
            return False, "el trafico da vueltas", actual.nombre
        visitados.add(actual.nombre)

        cubre = _cubre(_cobertura(actual.rutas_estaticas), destino)
        if cubre is None:
            return False, "sin ruta", actual.nombre
        salto = cubre[1]
        try:
            direccion = ipaddress.IPv4Address(salto)
        except (ipaddress.AddressValueError, ValueError):
            causa = "la ruta sale por interfaz (%s) y no se puede seguir" % salto
            return False, causa, actual.nombre
        if not any(direccion in red for red in actual.redes()):
            causa = "el siguiente salto %s no esta en sus redes conectadas" % salto
            return False, causa, actual.nombre
        siguiente = indice.get(salto)
        if siguiente is None:
            causa = "el siguiente salto %s no es de ningun ruteador" % salto
            return False, causa, actual.nombre
        actual = siguiente
    return False, "demasiados saltos", actual.nombre


def _mismo_bloque(pool, sub) -> bool:
    """True si un pool de DHCP reparte justo esa subred."""
    if not (pool.red and pool.mascara and mascara_valida(pool.mascara)):
        return False
    try:
        red = ipaddress.IPv4Network("%s/%s" % (pool.red, pool.mascara),
                                    strict=False)
    except ValueError:
        return False
    return str(red.network_address) == sub.red and red.prefixlen == sub.prefijo


def mascara_valida(mascara) -> bool:
    try:
        ipaddress.IPv4Network("0.0.0.0/%s" % mascara)
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------
# Subredes
# --------------------------------------------------------------------------

def construir_subredes(topo) -> list:
    mapa = {}
    for disp in topo.dispositivos:
        for ifaz in disp.interfaces_ip:
            if not mascara_valida(ifaz.mascara):
                continue
            red = _red_de(ifaz.ip, ifaz.mascara)
            clave = (str(red.network_address), ifaz.mascara)
            sub = mapa.get(clave)
            if sub is None:
                sub = Subred(clave[0], clave[1], red.prefixlen)
                mapa[clave] = sub
            sub.interfaces.append((disp, ifaz))
    return sorted(mapa.values(), key=lambda s: (ipaddress.IPv4Address(s.red), s.prefijo))


# --------------------------------------------------------------------------
# Ruteo
# --------------------------------------------------------------------------

def _vecinos(subredes) -> dict:
    """nombre -> [(vecino, ip_del_vecino, interfaz_local)]"""
    ady = {}
    for sub in subredes:
        rts = sub.ruteadores()
        for disp_a, ifaz_a in rts:
            lista = ady.setdefault(disp_a.nombre, [])
            for disp_b, ifaz_b in rts:
                if disp_b.nombre != disp_a.nombre:
                    lista.append((disp_b.nombre, ifaz_b.ip, ifaz_a.nombre))
    for lista in ady.values():
        lista.sort(key=lambda t: (t[0], ipaddress.IPv4Address(t[1])))
    return ady


def _distancias_a(destinos, ady) -> dict:
    """Saltos de cada ruteador hasta la red destino (BFS desde sus duenos)."""
    dist = {n: 0 for n in destinos}
    cola = deque(destinos)
    while cola:
        u = cola.popleft()
        for vecino, _ip, _ifaz in ady.get(u, ()):
            if vecino not in dist:
                dist[vecino] = dist[u] + 1
                cola.append(vecino)
    return dist


def calcular_rutas(topo, subredes):
    """Devuelve (rutas_por_router, subredes_inalcanzables).

    Se resuelve **una red destino a la vez**: se mide a que distancia queda esa
    red desde cada ruteador y cada uno reenvia al vecino que lo acerca. Como el
    siguiente salto siempre esta mas cerca del destino que uno mismo, el
    resultado no puede formar bucles ni siquiera con enlaces cruzados o mallas,
    donde hay varios caminos del mismo costo. (Calcular el camino mas corto por
    separado desde cada origen no da esa garantia: dos equipos pueden elegir
    caminos opuestos y mandarse el trafico el uno al otro.)
    """
    ady = _vecinos(subredes)
    for router in topo.ruteadores:
        ady.setdefault(router.nombre, [])
    rutas = {r.nombre: [] for r in topo.ruteadores}
    inalcanzables = []

    for sub in subredes:
        duenos = [d.nombre for d, _ in sub.ruteadores()]
        if not duenos:
            continue
        dist = _distancias_a(duenos, ady)
        for router in topo.ruteadores:
            if router.nombre in duenos:
                continue
            propia = dist.get(router.nombre)
            if propia is None:
                if sub not in inalcanzables:
                    inalcanzables.append(sub)
                continue
            mejor = None
            for vecino, ip_vecino, ifaz in ady[router.nombre]:
                cerca = dist.get(vecino)
                if cerca is None or cerca >= propia:
                    continue      # ese vecino no acerca al destino
                clave = (cerca, ipaddress.IPv4Address(ip_vecino))
                if mejor is None or clave < mejor[0]:
                    mejor = (clave, ip_vecino, ifaz)
            if mejor is None:
                continue
            rutas[router.nombre].append(Ruta(
                red=sub.red, mascara=sub.mascara, salto=mejor[1],
                interfaz_salida=mejor[2], destino=duenos[0], saltos=propia))

    for router in topo.ruteadores:
        lista = rutas[router.nombre]
        lista.sort(key=lambda r: ipaddress.IPv4Address(r.red))
        cobertura = _cobertura(router.rutas_estaticas)
        for r in lista:
            destino = ipaddress.IPv4Network("%s/%s" % (r.red, r.mascara),
                                            strict=False)
            cubre = _cubre(cobertura, destino)
            if cubre:
                r.ya_configurada = True
                # Si la ruta puesta es exactamente el destino no hay nada que
                # aclarar; solo interesa nombrarla cuando es mas amplia.
                r.cubierta_por = "" if cubre[0] == destino else str(cubre[0])
                r.salto_configurado = cubre[1]

    return rutas, inalcanzables


def verificar_ruteo(topo, subredes, rutas):
    """Sigue las rutas *generadas* para cada par origen-destino.

    Es la red de seguridad del calculo: si alguna vez saliera un bucle o una
    ruta hacia la nada, aqui se ve antes de que el usuario la pegue.
    Devuelve (trayectos_probados, problemas).
    """
    por_ip = {i.ip: d.nombre for d in topo.ruteadores for i in d.interfaces_ip}
    problemas, total = [], 0
    for sub in subredes:
        duenos = {d.nombre for d, _ in sub.ruteadores()}
        if not duenos:
            continue
        for router in topo.ruteadores:
            if router.nombre in duenos:
                continue
            total += 1
            actual, visto = router.nombre, set()
            while actual not in duenos:
                if actual in visto:
                    problemas.append("bucle hacia %s saliendo de %s"
                                     % (sub.etiqueta, router.nombre))
                    break
                visto.add(actual)
                ruta = next((r for r in rutas.get(actual, ())
                             if (r.red, r.mascara) == sub.clave), None)
                if ruta is None:
                    problemas.append("%s se queda sin ruta hacia %s"
                                     % (actual, sub.etiqueta))
                    break
                siguiente = por_ip.get(ruta.salto)
                if siguiente is None:
                    problemas.append("el salto %s hacia %s no es de nadie"
                                     % (ruta.salto, sub.etiqueta))
                    break
                actual = siguiente
    return total, problemas


# --------------------------------------------------------------------------
# Comprobaciones de configuracion
# --------------------------------------------------------------------------

def revisar(topo, subredes, rutas) -> list:
    hallazgos = []
    vis = topo.nombres_visibles()     # los mensajes usan tus hostnames
    # Los enlaces que ya se corrigieron (o se explicaron) al leer el archivo
    # traen su propio mensaje; aquí no se repiten.
    correcciones = getattr(topo, "correcciones", None)
    revisados = correcciones.revisados if correcciones is not None else set()

    def anota(nivel, equipo, mensaje):
        hallazgos.append(Hallazgo(nivel, equipo, mensaje))

    # Mascaras invalidas y direcciones no asignables.
    for disp in topo.dispositivos:
        for ifaz in disp.interfaces:
            if not ifaz.ip or ifaz.ip == "0.0.0.0":
                continue
            if not ifaz.mascara:
                anota(ERROR, disp.nombre,
                      "%s tiene IP %s sin mascara de subred" % (ifaz.nombre, ifaz.ip))
                continue
            if not mascara_valida(ifaz.mascara):
                anota(ERROR, disp.nombre,
                      "%s: la mascara %s no es valida" % (ifaz.nombre, ifaz.mascara))
                continue
            red = _red_de(ifaz.ip, ifaz.mascara)
            if red.prefixlen <= 30:
                direccion = ipaddress.IPv4Address(ifaz.ip)
                if direccion == red.network_address:
                    anota(ERROR, disp.nombre,
                          "%s usa %s, que es la direccion de red de %s"
                          % (ifaz.nombre, ifaz.ip, red))
                elif direccion == red.broadcast_address:
                    anota(ERROR, disp.nombre,
                          "%s usa %s, que es la direccion de broadcast de %s"
                          % (ifaz.nombre, ifaz.ip, red))
            if not ifaz.encendida:
                anota(AVISO, disp.nombre,
                      "%s tiene IP %s pero esta apagada (falta 'no shutdown')"
                      % (ifaz.nombre, ifaz.ip))

    # Direcciones IP repetidas.
    por_ip = {}
    for disp in topo.dispositivos:
        for ifaz in disp.interfaces_ip:
            por_ip.setdefault(ifaz.ip, []).append("%s:%s" % (vis[disp.nombre],
                                                             ifaz.nombre))
    for ip, duenos in sorted(por_ip.items()):
        if len(duenos) > 1:
            anota(ERROR, "red", "IP duplicada %s en %s" % (ip, ", ".join(duenos)))

    # Cables entre equipos cuyas IPs no coinciden de subred.
    for enlace in topo.enlaces:
        if clave_cable(enlace.a_dispositivo, enlace.a_puerto,
                       enlace.b_dispositivo, enlace.b_puerto) in revisados:
            continue
        a, b = topo.por_nombre(enlace.a_dispositivo), topo.por_nombre(enlace.b_dispositivo)
        if a is None or b is None or not (a.es_ruteador and b.es_ruteador):
            continue
        ia = next((i for i in a.interfaces_ip if i.nombre == enlace.a_puerto), None)
        ib = next((i for i in b.interfaces_ip if i.nombre == enlace.b_puerto), None)
        if ia is None or ib is None:
            if ia is None and ib is None:
                continue
            falta = (a.nombre, enlace.a_puerto) if ia is None else (b.nombre, enlace.b_puerto)
            anota(AVISO, falta[0],
                  "%s tiene cable hacia %s pero no tiene IP configurada"
                  % (falta[1], vis[b.nombre] if ia is None else vis[a.nombre]))
            continue
        if not (mascara_valida(ia.mascara) and mascara_valida(ib.mascara)):
            continue
        if _red_de(ia.ip, ia.mascara) != _red_de(ib.ip, ib.mascara):
            anota(ERROR, "red",
                  "El enlace %s:%s (%s/%s) - %s:%s (%s/%s) une dos subredes distintas"
                  % (vis[a.nombre], ia.nombre, ia.ip, ia.mascara,
                     vis[b.nombre], ib.nombre, ib.ip, ib.mascara))

    # Puerta de enlace de los equipos finales.
    hay_varias_redes = len(subredes) > 1
    todas_las_ips = set(por_ip)
    sin_respaldo = {}
    for disp in topo.dispositivos:
        if not disp.es_host:
            continue
        ips = disp.interfaces_ip
        if not disp.gateway:
            if hay_varias_redes and ips:
                anota(AVISO, disp.nombre, "no tiene puerta de enlace configurada")
            continue
        gw = ipaddress.IPv4Address(disp.gateway)
        if ips:
            en_rango = any(gw in _red_de(i.ip, i.mascara)
                           for i in ips if mascara_valida(i.mascara))
            if not en_rango:
                anota(ERROR, disp.nombre,
                      "la puerta de enlace %s no pertenece a su propia subred"
                      % disp.gateway)
                continue
        # Tambien aplica a los equipos por DHCP: si nadie tiene esa direccion,
        # la interfaz LAN del ruteador todavia no esta configurada.
        if disp.gateway not in todas_las_ips:
            sin_respaldo.setdefault(disp.gateway, []).append(disp.nombre)

    if sin_respaldo:
        direcciones = sorted(sin_respaldo, key=ipaddress.IPv4Address)
        equipos = sum(len(v) for v in sin_respaldo.values())
        muestra = ", ".join(direcciones[:6])
        if len(direcciones) > 6:
            muestra += " y %d mas" % (len(direcciones) - 6)
        anota(AVISO, "red",
              "%d equipo(s) finales apuntan a %d puerta(s) de enlace que no "
              "existen en ninguna interfaz (%s): falta configurar las "
              "interfaces LAN de los ruteadores"
              % (equipos, len(direcciones), muestra))

    # Subredes con equipos finales pero sin ruteador.
    for sub in subredes:
        if sub.ruteadores():
            continue
        hosts = [d.nombre for d, _ in sub.interfaces]
        anota(AVISO, "red",
              "la subred %s no tiene ninguna interfaz de ruteador (%s quedan "
              "sin salida)" % (sub.etiqueta, ", ".join(sorted(set(hosts)))))

    # Subredes solapadas.
    redes = [(sub, ipaddress.IPv4Network("%s/%d" % (sub.red, sub.prefijo)))
             for sub in subredes]
    for i in range(len(redes)):
        for j in range(i + 1, len(redes)):
            a, b = redes[i][1], redes[j][1]
            if a.overlaps(b):
                anota(AVISO, "red", "las subredes %s y %s se traslapan" % (a, b))

    # Ruteadores sin conexion con el resto.
    ady = _vecinos(subredes)
    nombres = [r.nombre for r in topo.ruteadores]
    if len(nombres) > 1:
        alcanzables = _distancias_a([nombres[0]], ady)
        aislados = [n for n in nombres if n not in alcanzables]
        if aislados:
            anota(ERROR, "red",
                  "sin camino IP hacia el resto de la red: %s"
                  % ", ".join(vis[n] for n in aislados))

    # Enlaces punto a punto configurados de un solo lado.
    for sub in subredes:
        if sub.prefijo < 30 or len(sub.interfaces) != 1:
            continue
        disp, ifaz = sub.interfaces[0]
        if any(_mismo_bloque(pool, sub) for pool in getattr(disp, "pools", ())):
            continue
        anota(AVISO, disp.nombre,
              "%s (%s) es el unico extremo configurado de %s: falta la IP del "
              "otro lado, o la direccion sobra" % (ifaz.nombre, ifaz.ip,
                                                   sub.etiqueta))

    # Hostname de fabrica o repetido entre equipos.
    por_hostname = {}
    for disp in topo.dispositivos:
        if disp.hostname:
            por_hostname.setdefault(disp.hostname, []).append(disp.nombre)
    for hostname, equipos in sorted(por_hostname.items()):
        if len(equipos) > 1:
            muestra = ", ".join(sorted(equipos)[:5])
            if len(equipos) > 5:
                muestra += " y %d mas" % (len(equipos) - 5)
            anota(AVISO, "red",
                  "%d equipos comparten el hostname '%s' (%s): en la CLI no se "
                  "distinguen entre si" % (len(equipos), hostname, muestra))
        elif hostname.lower() in ("router", "switch"):
            anota(INFO, equipos[0],
                  "conserva el hostname de fabrica '%s'" % hostname)

    # Coherencia de los pools de DHCP con las interfaces del equipo.
    for disp in topo.dispositivos:
        for pool in getattr(disp, "pools", ()):
            if not (pool.red and pool.mascara and mascara_valida(pool.mascara)):
                continue
            red = ipaddress.IPv4Network("%s/%s" % (pool.red, pool.mascara),
                                        strict=False)
            propia = next((i for i in disp.interfaces_ip
                           if mascara_valida(i.mascara)
                           and _red_de(i.ip, i.mascara) == red), None)
            if propia is None:
                anota(AVISO, disp.nombre,
                      "el pool DHCP '%s' reparte %s, que no corresponde a "
                      "ninguna interfaz de este equipo" % (pool.nombre, red))
                continue
            if not pool.gateway:
                anota(AVISO, disp.nombre,
                      "el pool DHCP '%s' no tiene default-router" % pool.nombre)
            elif ipaddress.IPv4Address(pool.gateway) not in red:
                anota(ERROR, disp.nombre,
                      "el pool DHCP '%s' entrega la puerta de enlace %s, fuera "
                      "de %s" % (pool.nombre, pool.gateway, red))
            elif pool.gateway != propia.ip:
                anota(AVISO, disp.nombre,
                      "el pool DHCP '%s' entrega %s como puerta de enlace, "
                      "pero %s tiene %s" % (pool.nombre, pool.gateway,
                                            propia.nombre, propia.ip))

    # Conmutadores multicapa: sin 'ip routing' las SVI no se comunican entre si.
    for disp in topo.dispositivos:
        if not disp.es_multicapa:
            continue
        if any(i.planeada for i in disp.interfaces):
            continue    # sus SVI vienen del plan y el bloque generado ya lo trae
        vlans = sorted(i.nombre for i in disp.interfaces_ip
                       if i.nombre.lower().startswith("vlan"))
        detalle = (" (SVI: %s)" % ", ".join(vlans)) if vlans else ""
        if disp.ruteo_ip is False:
            anota(ERROR, disp.nombre,
                  "es un conmutador multicapa que enruta %d redes%s pero tiene "
                  "'ip routing' deshabilitado" % (len(disp.redes()), detalle))
        elif disp.ruteo_ip is None:
            anota(INFO, disp.nombre,
                  "se trata como conmutador multicapa (capa 3)%s: revisa que "
                  "tenga 'ip routing' habilitado" % detalle)

    # Estado del ruteo estatico ya presente en los equipos.
    for router in topo.ruteadores:
        necesarias = rutas.get(router.nombre, [])
        faltan = [r for r in necesarias if not r.ya_configurada]
        if router.rutas_estaticas and not faltan and necesarias:
            anota(INFO, router.nombre, "su ruteo estatico ya esta completo")
        elif faltan:
            anota(AVISO, router.nombre,
                  "le faltan %d ruta(s) estatica(s) de %d necesarias"
                  % (len(faltan), len(necesarias)))
        destinos = []
        for r in necesarias:
            try:
                destinos.append(ipaddress.IPv4Network("%s/%s" % (r.red, r.mascara),
                                                      strict=False))
            except ValueError:
                continue
        for red, mascara, salto in router.rutas_estaticas:
            try:
                configurada = ipaddress.IPv4Network("%s/%s" % (red, mascara),
                                                    strict=False)
            except ValueError:
                continue
            if not any(d.subnet_of(configurada) for d in destinos):
                anota(INFO, router.nombre,
                      "la ruta %s %s via %s no resuelve ninguna red de esta "
                      "topologia" % (red, mascara, salto))

        # Siguiente salto que el equipo no puede alcanzar por si mismo.
        conectadas = router.redes()
        for red, mascara, salto in router.rutas_estaticas:
            try:
                direccion = ipaddress.IPv4Address(salto)
            except (ipaddress.AddressValueError, ValueError):
                continue    # forma "ip route X Y <interfaz>"
            if conectadas and not any(direccion in n for n in conectadas):
                anota(ERROR, router.nombre,
                      "la ruta %s %s apunta a %s, que no esta en ninguna red "
                      "conectada del equipo" % (red, mascara, salto))

    # Prueba de alcance real: se siguen las rutas que los equipos ya tienen.
    # Es la causa tipica de "sale el ping pero no vuelve".
    indice = _indice_de_ips(topo)
    for sub in subredes:
        duenos = {d.nombre for d, _ in sub.ruteadores()}
        if not duenos:
            continue
        try:
            destino = ipaddress.IPv4Network(sub.etiqueta)
        except ValueError:
            continue
        fallos = {}
        for router in topo.ruteadores:
            if router.nombre in duenos:
                continue
            llega, causa, donde = entrega(topo, router, destino, indice)
            if llega:
                continue
            # Si se corta en el propio origen no hace falta nombrarlo dos veces.
            motivo = causa if donde == router.nombre else "%s en %s" % (causa,
                                                                        vis[donde])
            fallos.setdefault(motivo, []).append(router.nombre)
        for motivo, equipos in sorted(fallos.items()):
            anota(AVISO, "red",
                  "hacia %s (%s) no llega el trafico desde %s: %s"
                  % (sub.etiqueta, ", ".join(sorted(vis[n] for n in duenos)),
                     ", ".join(sorted(vis[n] for n in equipos)), motivo))

    # Interfaces de VLAN en un router: sin un módulo de switch no se levantan,
    # y la subinterfaz que sí serviría se queda sin IP. Es el error de P2 (R2).
    for disp in topo.dispositivos:
        if not disp.es_ruteador or disp.es_multicapa:
            continue
        for ifaz in disp.interfaces:
            baja = ifaz.nombre.lower()
            if baja.startswith("vlan") and ifaz.configurada and not ifaz.planeada:
                anota(ERROR, disp.nombre,
                      "%s tiene IP %s, pero en un router una interfaz de VLAN no "
                      "se levanta: la IP va en la subinterfaz del puerto hacia el "
                      "switch (interface <puerto>.%s)"
                      % (ifaz.nombre, ifaz.ip, ifaz.nombre[4:]))
            elif "." in ifaz.nombre and ifaz.vlan and not ifaz.configurada:
                anota(AVISO, disp.nombre,
                      "%s tiene 'encapsulation dot1Q %s' pero no tiene IP: esa "
                      "VLAN se queda sin puerta de enlace ni DHCP"
                      % (ifaz.nombre, ifaz.vlan))

    plan = getattr(topo, "plan", None)
    if plan is not None:
        hallazgos.extend(plan.hallazgos)
    if correcciones is not None:
        hallazgos.extend(correcciones.hallazgos)
    nombres = getattr(topo, "nombres", None)
    if nombres is not None:
        hallazgos.extend(nombres.hallazgos)

    orden = {ERROR: 0, AVISO: 1, INFO: 2}
    hallazgos.sort(key=lambda h: (orden[h.nivel], h.equipo, h.mensaje))
    return hallazgos
