"""Modelo de la topología y lectura del XML que produce Packet Tracer.

Packet Tracer **no guarda el nombre de las interfaces**: cada `<PORT>` sólo
trae su tipo (`eCopperFastEthernet`, `eSerial`, ...) y el nombre se deduce de
dónde cuelga dentro del árbol de módulos:

    DEVICE / ENGINE / MODULE            <- el chasis
                      SLOT   (índice)   <- ranura del chasis
                        MODULE          <- la tarjeta madre
                          PORT          -> FastEthernet0/0, 0/1 ...
                          SLOT (índice) <- ranura de tarjeta (WIC, NM)
                            MODULE
                              PORT      -> Ethernet0/3/0 ...

Los routers numeran desde 0 y los switches desde 1 (Fa0/1 ... Fa0/24), y los
equipos finales no llevan diagonal (FastEthernet0). Los cables sí guardan el
nombre real del puerto, así que sirven para comprobar la reconstrucción.

Si el archivo no trae ese árbol (por ejemplo un XML armado a mano) se usa una
lectura de respaldo que busca patrones en cualquier parte del documento.
"""

from __future__ import annotations

import ipaddress
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from . import configuracion as cfgio

RE_IFAZ = re.compile(
    r"^(FastEthernet|GigabitEthernet|TenGigabitEthernet|Ethernet|Serial|Vlan"
    r"|Loopback|Tunnel|Port-channel|Wireless|Management)"
    r"\d*([/.:]\d+)*$",
    re.IGNORECASE,
)
RE_IPV4 = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

_TIPOS_RUTEO = ("router", "multilayer", "layer3", "l3", "firewall", "asa")
_TIPOS_SWITCH = ("switch", "bridge", "hub", "repeater", "access point", "wrt")
_TIPOS_HOST = ("pc", "laptop", "server", "printer", "tablet", "phone", "tv",
               "host", "iot", "camera", "sbc", "mcu")
# Familias de conmutadores multicapa: Packet Tracer suele guardarlos con
# TYPE "Switch", asi que el modelo es lo unico que los distingue de un 2960.
_MODELOS_L3 = ("3560", "3650", "3750", "3850", "4500", "6500", "6800",
               "9200", "9300", "9400", "9500")

# Tipo de puerto de Packet Tracer -> nombre de interfaz de IOS.
_NOMBRE_PUERTO = {
    "ecopperfastethernet": "FastEthernet",
    "efiberfastethernet": "FastEthernet",
    "ecoppergigabitethernet": "GigabitEthernet",
    "efibergigabitethernet": "GigabitEthernet",
    "ecopper10gigabitethernet": "TenGigabitEthernet",
    "efiber10gigabitethernet": "TenGigabitEthernet",
    "ecopperethernet": "Ethernet",
    "eserial": "Serial",
    "ewireless": "Wireless",
    "ewirelessn": "Wireless",
    "ewirelessac": "Wireless",
    "ecellular": "Cellular",
    "emodem": "Modem",
    "ecoaxial": "Coaxial",
}
# Puertos que no son interfaces de red y no deben aparecer en el inventario.
_PUERTOS_IGNORADOS = ("econsole", "eaux", "eusb", "ebluetooth", "einfrared",
                      "ertc", "eprogrammer")


def es_ipv4(texto) -> bool:
    if not texto:
        return False
    texto = texto.strip()
    if not RE_IPV4.match(texto):
        return False
    return all(0 <= int(o) <= 255 for o in texto.split("."))


def _tag(el) -> str:
    t = el.tag
    return t.split("}")[-1].lower() if isinstance(t, str) else ""


def _texto(el) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def _hijo(el, nombre):
    for h in el:
        if _tag(h) == nombre:
            return h
    return None


@dataclass
class Interfaz:
    nombre: str
    ip: str | None = None
    mascara: str | None = None
    encendida: bool = True
    vlan: str | None = None
    dhcp: bool = False
    ipv6: str | None = None
    prefijo6: str | None = None
    planeada: bool = False   # la puso el plan de VLANs, no la configuración
    correccion: str = ""     # qué le cambió la revisión de enlaces, si algo

    @property
    def configurada(self) -> bool:
        return bool(self.ip) and self.ip != "0.0.0.0" and bool(self.mascara)

    @property
    def estado(self) -> str:
        if self.configurada:
            return "activa" if self.encendida else "APAGADA"
        if self.dhcp:
            return "por DHCP"
        return "sin IP"

    def __str__(self) -> str:
        if self.configurada:
            return "%s %s %s" % (self.nombre, self.ip, self.mascara)
        return "%s (%s)" % (self.nombre, self.estado)


@dataclass
class Dispositivo:
    nombre: str
    tipo: str = ""
    modelo: str = ""
    interfaces: list = field(default_factory=list)
    gateway: str | None = None
    rutas_estaticas: list = field(default_factory=list)  # (red, mascara, salto)
    ruteo_ip: bool | None = None   # 'ip routing'; None = no se pudo leer
    vlans: list = field(default_factory=list)            # (numero, nombre)
    hostname: str = ""                                   # el que dice el config
    pools: list = field(default_factory=list)            # pools de DHCP
    cfg: object = None             # running-config completo, ya interpretado
    x: float | None = None         # posición en el lienzo lógico
    y: float | None = None

    @property
    def interfaces_ip(self) -> list:
        return [i for i in self.interfaces if i.configurada]

    def redes(self) -> set:
        """Subredes distintas en las que el equipo tiene una interfaz."""
        salida = set()
        for i in self.interfaces_ip:
            try:
                salida.add(ipaddress.IPv4Interface("%s/%s" % (i.ip, i.mascara)).network)
            except ValueError:
                continue
        return salida

    @property
    def _descripcion(self) -> str:
        return (self.tipo + " " + self.modelo).lower()

    @property
    def es_ruteador(self) -> bool:
        t = self._descripcion
        if any(p in t for p in _TIPOS_RUTEO) or any(p in t for p in _MODELOS_L3):
            return True
        if any(p in t for p in _TIPOS_HOST):
            return False
        # Un 2960 lleva a lo mucho una SVI de administracion; si hay interfaces
        # con IP en dos o mas redes (varias SVI o puertos ruteados), enruta.
        return len(self.redes()) >= 2

    @property
    def es_multicapa(self) -> bool:
        """Conmutador de nucleo: es un switch, pero trabaja en capa 3."""
        return self.es_ruteador and any(p in self._descripcion
                                        for p in _TIPOS_SWITCH)

    @property
    def es_host(self) -> bool:
        return any(p in self._descripcion for p in _TIPOS_HOST)

    @property
    def es_switch(self) -> bool:
        """Conmutador de capa 2 (un multicapa cuenta como ruteador)."""
        return not self.es_ruteador and any(p in self._descripcion
                                            for p in _TIPOS_SWITCH)


@dataclass
class Enlace:
    a_dispositivo: str
    a_puerto: str
    b_dispositivo: str
    b_puerto: str


@dataclass
class Topologia:
    dispositivos: list = field(default_factory=list)
    enlaces: list = field(default_factory=list)
    avisos_lectura: list = field(default_factory=list)
    notas: list = field(default_factory=list)   # notas del lienzo, tal cual
    nombres: object = None         # hostnames tomados del nombre en el lienzo
    plan: object = None            # plan de VLANs leído de las notas
    correcciones: object = None    # enlaces configurados o arreglados al leer

    @property
    def ruteadores(self) -> list:
        return [d for d in self.dispositivos if d.es_ruteador]

    def nombres_visibles(self) -> dict:
        """Etiqueta del lienzo -> nombre para mostrar: el hostname que pusiste,
        con la etiqueta entre paréntesis si dos equipos lo comparten."""
        from collections import Counter
        repetidos = Counter(d.hostname for d in self.dispositivos if d.hostname)
        salida = {}
        for d in self.dispositivos:
            if not d.hostname or d.hostname == d.nombre:
                salida[d.nombre] = d.nombre
            elif repetidos[d.hostname] == 1:
                salida[d.nombre] = d.hostname
            else:
                salida[d.nombre] = "%s (%s)" % (d.hostname, d.nombre)
        return salida

    def por_nombre(self, nombre):
        for d in self.dispositivos:
            if d.nombre == nombre:
                return d
        return None


# ==========================================================================
# Lectura del formato real de Packet Tracer
# ==========================================================================

def _clase_equipo(tipo, modelo) -> str:
    """Cómo numera Packet Tracer los puertos de este equipo."""
    t = (tipo + " " + modelo).lower()
    if any(p in t for p in _TIPOS_HOST):
        return "host"
    if any(p in t for p in _TIPOS_SWITCH):
        return "switch"
    return "router"


def _base_de_puerto(tipo_puerto):
    t = (tipo_puerto or "").strip().lower()
    if not t or t in _PUERTOS_IGNORADOS:
        return None
    nombre = _NOMBRE_PUERTO.get(t)
    if nombre:
        return nombre
    # Tipo nuevo o desconocido: quitamos la 'e' inicial y lo usamos tal cual.
    return t[1:].capitalize() if t.startswith("e") and len(t) > 1 else None


def _ipv6_de(port):
    """Primera dirección IPv6 unicast del puerto, si tiene."""
    contenedor = _hijo(port, "ipv6_addresses")
    if contenedor is None:
        return None, None
    for nodo in contenedor.iter():
        for valor in [_texto(nodo)] + [v for v in nodo.attrib.values()]:
            valor = (valor or "").strip()
            if ":" not in valor:
                continue
            direccion, _, prefijo = valor.partition("/")
            try:
                obj = ipaddress.IPv6Address(direccion)
            except ValueError:
                continue
            if obj.is_link_local:
                continue
            return direccion, (prefijo or None)
    return None, None


def _leer_puerto_pt(port, nombre) -> Interfaz:
    ip = _texto(_hijo(port, "ip"))
    mascara = _texto(_hijo(port, "subnet"))
    ipv6, prefijo6 = _ipv6_de(port)
    return Interfaz(
        nombre=nombre,
        ip=ip if es_ipv4(ip) and ip != "0.0.0.0" else None,
        mascara=mascara if es_ipv4(mascara) else None,
        encendida=_texto(_hijo(port, "power")).lower() != "false",
        dhcp=_texto(_hijo(port, "port_dhcp_enable")).lower() == "true",
        ipv6=ipv6,
        prefijo6=prefijo6,
    )


def _puertos_pt(engine, clase) -> list:
    return [_leer_puerto_pt(port, nombre) for nombre, port in puertos_xml(engine, clase)]


def clase_de(device) -> str:
    """'router', 'switch' o 'host', según cómo numera sus puertos."""
    nodo_tipo = _hijo(_hijo(device, "engine"), "type")
    tipo = _texto(nodo_tipo)
    modelo = " ".join(v for v in (nodo_tipo.attrib.get("model", ""),
                                  nodo_tipo.attrib.get("customModel", ""))
                      if v) if nodo_tipo is not None else ""
    return _clase_equipo(tipo, modelo)


def puertos_xml(engine, clase) -> list:
    """[(nombre, elemento PORT)]: reconstruye los nombres recorriendo el árbol
    de módulos y ranuras."""
    chasis = _hijo(engine, "module")
    if chasis is None:
        return []
    puertos = []
    contadores_host = {}
    inicio = 1 if clase == "switch" else 0

    def visitar(modulo, ruta):
        contadores = contadores_host if clase == "host" else {}
        for hijo in modulo:
            if _tag(hijo) != "port":
                continue
            base = _base_de_puerto(_texto(_hijo(hijo, "type")))
            if base is None:
                continue
            n = contadores.get(base, inicio)
            contadores[base] = n + 1
            if clase == "host":
                nombre = "%s%d" % (base, n)
            else:
                nombre = "%s%s/%d" % (base, "/".join(str(i) for i in ruta), n)
            puertos.append((nombre, hijo))
        indice = 0
        for hijo in modulo:
            if _tag(hijo) != "slot":
                continue
            sub = _hijo(hijo, "module")
            if sub is not None:
                visitar(sub, ruta + [indice])
            indice += 1

    indice = 0
    for hijo in chasis:
        if _tag(hijo) != "slot":
            continue
        sub = _hijo(hijo, "module")
        if sub is not None:
            visitar(sub, [indice])
        indice += 1
    return puertos


def _vlans_pt(engine) -> list:
    contenedor = _hijo(engine, "vlans")
    if contenedor is None:
        return []
    vlans = []
    for nodo in contenedor:
        numero = nodo.attrib.get("number") or nodo.attrib.get("NUMBER")
        nombre = nodo.attrib.get("name") or nodo.attrib.get("NAME") or ""
        if numero and numero.isdigit() and int(numero) < 1002:
            vlans.append((int(numero), nombre))
    return sorted(vlans)


def _buscar(el, nombre):
    for nodo in el.iter():
        if _tag(nodo) == nombre:
            return nodo
    return None


def _lineas_config(engine):
    """Renglones del running-config, conservando la sangría."""
    nodo = _buscar(engine, "runningconfig")
    if nodo is None or not len(nodo):
        nodo = _buscar(engine, "startupconfig")
    if nodo is None:
        return []
    return [(h.text or "").rstrip() for h in nodo if _tag(h) == "line"]


def _insertar_interfaz(lista, ifaz, padre):
    """Las subinterfaces van justo debajo de su interfaz física."""
    if padre:
        objetivo = padre.lower()
        for k in range(len(lista) - 1, -1, -1):
            actual = lista[k].nombre.lower()
            if actual == objetivo or actual.startswith(objetivo + "."):
                lista.insert(k + 1, ifaz)
                return
    lista.append(ifaz)


def _aplicar_config(disp, cfg):
    """El running-config manda: trae subinterfaces, SVI, rutas y DHCP."""
    disp.hostname = cfg.hostname
    for ic in cfg.interfaces:
        actual = next((i for i in disp.interfaces
                       if i.nombre.lower() == ic.nombre.lower()), None)
        if actual is None:
            actual = Interfaz(nombre=ic.nombre)
            _insertar_interfaz(disp.interfaces, actual, ic.padre)
        actual.ip = ic.ip
        actual.mascara = ic.mascara
        if ic.ipv6:
            actual.ipv6, actual.prefijo6 = ic.ipv6, ic.prefijo6
        actual.encendida = not ic.apagada
        if ic.vlan is not None:
            actual.vlan = str(ic.vlan)
        elif ic.acceso_vlan is not None:
            actual.vlan = str(ic.acceso_vlan)
    if cfg.rutas:
        disp.rutas_estaticas = list(cfg.rutas)
    if cfg.ruteo_ip is not None:
        disp.ruteo_ip = cfg.ruteo_ip
    elif any(p in disp._descripcion for p in _TIPOS_SWITCH):
        # En un switch, 'ip routing' aparece en el running-config cuando esta
        # habilitado: si leimos la configuracion y no esta, es que esta apagado.
        disp.ruteo_ip = False
    disp.pools = list(cfg.pools)
    nombres = {n: v for n, v in cfg.vlans if v}
    disp.vlans = [(n, nombres.get(n) or v) for n, v in disp.vlans] or cfg.vlans


def _leer_dispositivo_pt(device):
    engine = _hijo(device, "engine")
    if engine is None:
        return None, None
    nombre = _texto(_hijo(engine, "name"))
    if not nombre:
        return None, None
    nodo_tipo = _hijo(engine, "type")
    tipo = _texto(nodo_tipo)
    modelo = ""
    if nodo_tipo is not None:
        # model="2811" y customModel="2811 IOS15" describen lo mismo: nos
        # quedamos con el más específico para no repetirlo en el reporte.
        valores = [(v or "").strip() for v in (nodo_tipo.attrib.get("model"),
                                               nodo_tipo.attrib.get("customModel"))]
        valores = [v for v in valores if v]
        modelo = " ".join(dict.fromkeys(
            v for v in valores if not any(o != v and v in o for o in valores)))

    disp = Dispositivo(nombre=nombre, tipo=tipo, modelo=modelo)
    disp.interfaces = _puertos_pt(engine, _clase_equipo(tipo, modelo))
    if not disp.interfaces:      # XML sin árbol de módulos: lectura por nombre
        disp.interfaces = _puertos_por_nombre(engine)
    gateway = _texto(_hijo(engine, "gateway"))
    disp.gateway = gateway if es_ipv4(gateway) and gateway != "0.0.0.0" else None
    disp.rutas_estaticas = _leer_rutas(engine)
    disp.ruteo_ip = _bandera(engine, ("iprouting", "ip_routing",
                                      "routingenabled", "l3enabled"))
    disp.vlans = _vlans_pt(engine)

    lineas = _lineas_config(engine)
    if lineas:
        disp.cfg = cfgio.analizar(lineas)
        _aplicar_config(disp, disp.cfg)

    # Posición en el lienzo lógico: sirve para asociar las notas del plan de
    # VLANs con el equipo que tienen al lado.
    logico = _buscar(device, "logical")
    if logico is not None:
        try:
            disp.x = float(_texto(_hijo(logico, "x")))
            disp.y = float(_texto(_hijo(logico, "y")))
        except ValueError:
            pass
    return disp, _texto(_hijo(engine, "save_ref_id"))


def _leer_enlaces_pt(raiz, referencias) -> list:
    """Los cables sí guardan el nombre real del puerto en cada extremo."""
    enlaces = []
    for cable in raiz.iter():
        if _tag(cable) != "cable":
            continue
        desde = hasta = None
        puertos = []
        for hijo in cable:
            t = _tag(hijo)
            if t == "from":
                desde = referencias.get(_texto(hijo))
            elif t == "to":
                hasta = referencias.get(_texto(hijo))
            elif t == "port":
                puertos.append(_texto(hijo))
        if desde and hasta and len(puertos) >= 2:
            enlaces.append(Enlace(desde, puertos[0], hasta, puertos[1]))
    return enlaces


def _leer_topologia_pt(raiz):
    """Devuelve None si el XML no tiene la estructura DEVICE/ENGINE."""
    dispositivos, referencias = [], {}
    for device in raiz.iter():
        if _tag(device) != "device":
            continue
        disp, referencia = _leer_dispositivo_pt(device)
        if disp is None:
            continue
        dispositivos.append(disp)
        if referencia:
            referencias[referencia] = disp.nombre
    if not dispositivos:
        return None

    topo = Topologia(dispositivos=dispositivos)
    topo.enlaces = _leer_enlaces_pt(raiz, referencias)

    # Los cables sí traen el nombre real del puerto: sirven de red de
    # seguridad por si una versión futura numera las interfaces distinto.
    desajustes = []
    for enlace in topo.enlaces:
        for equipo, puerto in ((enlace.a_dispositivo, enlace.a_puerto),
                               (enlace.b_dispositivo, enlace.b_puerto)):
            disp = topo.por_nombre(equipo)
            if disp and disp.interfaces and \
                    not any(i.nombre == puerto for i in disp.interfaces):
                desajustes.append("%s:%s" % (equipo, puerto))
    if desajustes:
        topo.avisos_lectura.append(
            "Los nombres de interfaz reconstruidos no coinciden con los del "
            "cableado en %d puerto(s) (%s). Esta versión de Packet Tracer "
            "podría numerar distinto." % (len(desajustes),
                                          ", ".join(desajustes[:4])))

    sin_puertos = [d.nombre for d in dispositivos if not d.interfaces]
    if sin_puertos:
        topo.avisos_lectura.append(
            "Sin puertos reconocidos en: %s." % ", ".join(sin_puertos[:6]))
    con_v6 = [d.nombre for d in dispositivos
              if any(i.ipv6 for i in d.interfaces)]
    if con_v6:
        topo.avisos_lectura.append(
            "Hay direcciones IPv6 en %s; el reporte las muestra, pero el ruteo "
            "que se calcula es sólo IPv4." % ", ".join(con_v6[:4]))
    return topo


# ==========================================================================
# Lectura de respaldo, por patrones (XML de otra versión o armado a mano)
# ==========================================================================

def _padres(raiz):
    return {hijo: padre for padre in raiz.iter() for hijo in padre}


def _bajo_enlace(el, padres) -> bool:
    actual = el
    while actual is not None:
        t = _tag(actual)
        if "link" in t or "cable" in t:
            return True
        actual = padres.get(actual)
    return False


def _campo(el, claves, validar=None):
    """Primer descendiente (o atributo) cuya clave contenga alguna de `claves`."""
    def util(valor):
        valor = (valor or "").strip()
        if valor and (validar is None or validar(valor)):
            return valor
        return None

    for nombre, valor in el.attrib.items():
        if any(c in nombre.lower() for c in claves):
            v = util(valor)
            if v:
                return v
    for hijo in el.iter():
        if hijo is el:
            continue
        if any(c in _tag(hijo) for c in claves):
            v = util(_texto(hijo))
            if v:
                return v
        for nombre, valor in hijo.attrib.items():
            if any(c in nombre.lower() for c in claves):
                v = util(valor)
                if v:
                    return v
    return None


def _bandera(el, claves):
    """Lee una opción de sí/no. Devuelve None si no aparece en el archivo."""
    valor = _campo(el, claves)
    if valor is None:
        return None
    return valor.strip().lower() in ("true", "1", "yes", "on", "enabled")


def _es_apagada(el) -> bool:
    for hijo in el.iter():
        t = _tag(hijo)
        if "shutdown" in t:
            if _texto(hijo).lower() in ("true", "1", "yes"):
                return True
        elif t.endswith("power") or t in ("portstatus", "status"):
            if _texto(hijo).lower() in ("false", "0", "no", "down"):
                return True
    return False


def _puertos_por_nombre(raiz_disp) -> list:
    """Puertos que sí traen su nombre escrito en el XML."""
    puertos, vistos = [], set()
    for el in raiz_disp.iter():
        nombre = None
        for hijo in el:
            txt = _texto(hijo)
            if txt and RE_IFAZ.match(txt):
                nombre = txt
                break
        if nombre is None or nombre in vistos:
            continue
        vistos.add(nombre)
        ip = _campo(el, ("ipaddress", "ip_address"), es_ipv4) or \
            _campo(el, ("ip",), es_ipv4)
        puertos.append(Interfaz(
            nombre=nombre, ip=ip,
            mascara=_campo(el, ("subnet", "mask", "netmask"), es_ipv4),
            encendida=not _es_apagada(el),
            vlan=_campo(el, ("vlan",))))
    return puertos


def _nombre_dispositivo(el, padres):
    mejor, mejor_prof = None, 10 ** 6
    prof = {id(el): 0}
    for hijo in el.iter():
        if hijo is el:
            continue
        prof[id(hijo)] = prof.get(id(padres.get(hijo)), 0) + 1
        t = _tag(hijo)
        if "name" in t and not t.startswith("dns") and "vlan" not in t:
            txt = _texto(hijo)
            if txt and not RE_IFAZ.match(txt) and not es_ipv4(txt):
                if prof[id(hijo)] < mejor_prof:
                    mejor, mejor_prof = txt, prof[id(hijo)]
    return mejor


def _leer_rutas(el) -> list:
    rutas = []
    for nodo in el.iter():
        if "route" not in _tag(nodo):
            continue
        ips = [_texto(h) for h in nodo.iter() if es_ipv4(_texto(h))]
        if len(ips) >= 3:
            rutas.append((ips[0], ips[1], ips[2]))
    return rutas


def _leer_topologia_generica(raiz):
    padres = _padres(raiz)
    topo = Topologia()
    candidatos = [el for el in raiz.iter()
                  if not _bajo_enlace(el, padres) and _puertos_por_nombre(el)]
    conjunto = {id(c) for c in candidatos}
    hojas = [el for el in candidatos
             if not any(id(h) in conjunto for h in el.iter() if h is not el)]

    vistos = set()
    for el in hojas:
        actual = el
        for _ in range(4):
            if _nombre_dispositivo(actual, padres):
                break
            actual = padres.get(actual, actual)
        if id(actual) in vistos:
            continue
        vistos.add(id(actual))
        nombre = _nombre_dispositivo(actual, padres) or "Equipo%d" % len(vistos)
        disp = Dispositivo(nombre=nombre,
                           tipo=_campo(actual, ("type",)) or "",
                           modelo=_campo(actual, ("model",)) or "")
        disp.interfaces = _puertos_por_nombre(actual)
        disp.gateway = _campo(actual, ("gateway",), es_ipv4)
        if disp.gateway == "0.0.0.0":
            disp.gateway = None
        disp.rutas_estaticas = _leer_rutas(actual)
        disp.ruteo_ip = _bandera(actual, ("iprouting", "ip_routing"))
        topo.dispositivos.append(disp)

    nombres = {d.nombre for d in topo.dispositivos}
    for el in raiz.iter():
        t = _tag(el)
        if "cable" not in t and t != "link":
            continue
        refs, puertos = [], []
        for hijo in el.iter():
            txt = _texto(hijo)
            if not txt:
                continue
            if txt in nombres:
                refs.append(txt)
            elif RE_IFAZ.match(txt):
                puertos.append(txt)
        if len(refs) >= 2 and len(puertos) >= 2:
            topo.enlaces.append(Enlace(refs[0], puertos[0], refs[1], puertos[1]))
    return topo


def leer_topologia(xml: bytes) -> Topologia:
    raiz = ET.fromstring(xml)
    topo = _leer_topologia_pt(raiz)
    if topo is None:
        topo = _leer_topologia_generica(raiz)
        if not topo.dispositivos:
            topo.avisos_lectura.append(
                "No se reconoció ningún equipo dentro del XML. Vuelve a "
                "ejecutar con --xml y revisa el archivo descifrado.")
    if not topo.enlaces and topo.dispositivos:
        topo.avisos_lectura.append(
            "No se reconocieron los cables: las comprobaciones de cableado se "
            "omiten y el ruteo se calcula por adyacencia IP.")

    # Todo lo que sale de las notas y del lienzo se aplica antes de calcular
    # el ruteo, en este orden:
    # 1. los hostnames que faltan, del nombre que el equipo tiene en el lienzo;
    # 2. los enlaces entre ruteadores: los que traen una IP equivocada se
    #    corrigen y los que no tienen se configuran (de sus notas '.4', '.8'),
    #    antes que las VLANs, porque en las prácticas van al inicio de la red
    #    base y las VLANs se reparten alrededor de ellos;
    # 3. el plan de VLANs, así sus redes ya existen cuando se buscan caminos.
    from . import enlaces, nombres
    from . import plan as planlan
    topo.notas = planlan._leer_notas(raiz)
    topo.nombres = nombres.generar(topo)
    topo.correcciones = enlaces.corregir(topo)
    topo.plan = planlan.leer(raiz, topo)
    return topo
