"""Plan de VLANs escrito en las notas del lienzo, y la configuración de LAN que
se deriva de él y del cableado del .pkt.

La idea es dejar configurado en Packet Tracer sólo lo que define la estructura
-los hostnames y los enlaces /30- y escribir en una nota, junto a cada sitio,
qué VLANs lleva:

    SWR1
    VLAN 3 12.1.0.0/16
    VLAN 4 CUATRO 12.4.0.0 255.252.0.0
    VLAN 5 12.0.0.128 - 12.0.0.255 - 255.128

o la red base del sitio y el tamaño de cada VLAN (VLSM), o sólo la red base,
que se reparte en partes iguales entre las VLANs de sus PCs ('PC1 V3'):

    R1 16.0.0.0          R1 16.1.0.0/16         R1 16.1.0.0/16
    VLAN 2/17            VLAN 3 500
    VLAN 3/24            VLAN 4 VENTAS 120
    VLAN 4/25

Con eso el programa arma lo demás:

* en el dueño del sitio (switch multicapa o router): las VLANs, las SVI o las
  subinterfaces y los pools de DHCP, con la última dirección utilizable de cada
  red como puerta de enlace;
* en todos los switches del sitio: las VLANs, las troncales, EtherChannel en
  los cables paralelos, la raíz de STP y los puertos de acceso de cada PC.

Las reglas de STP y EtherChannel salen de cómo se resolvieron a mano P2 y SS1:
la raíz es el switch pegado al dueño (sólo si el sitio tiene dos o más
switches) y en cada EtherChannel el lado activo es el más cercano al dueño.

A qué equipo pertenece cada nota se decide, en este orden:
1. por el nombre escrito en la nota (hostname o etiqueta del lienzo);
2. porque las redes de la nota ya están configuradas en algún equipo;
3. por cercanía en el lienzo. Esto último falla con facilidad, así que se
   avisa para que se agregue el nombre.
"""

from __future__ import annotations

import ipaddress
import math
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field

from . import vlsm
from .red import AVISO, ERROR, INFO, Hallazgo

_NOMBRES_VLAN = ("", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE",
                 "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE",
                 "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
                 "VEINTE")

_RE_VLAN = re.compile(r"\bVLAN\s*[-#:]?\s*(\d{1,4})\b", re.I)
_RE_TOKEN = re.compile(r"""
      (?P<ip>\d{1,3}(?:\.+\d{1,3}){3})(?:\s*/\s*(?P<pre>\d{1,2}))?
    | /\s*(?P<pre2>\d{1,2})\b
    | (?<![\w.])\.?(?P<abrev>\d{1,3}(?:\.\d{1,3}){1,2})(?![\d.])
    | (?<![\w.])\.(?P<octeto>\d{1,3})(?![\d.])
    | (?<![\w./])(?P<num>\d{1,8})(?![\w.])
    | (?P<pal>[^\W\d_][\w\-]*)
""", re.X)
_RE_IP_SUELTA = re.compile(r"\d{1,3}\.\d{1,3}")
# "PC1 V3", "V4-PC2", "VLAN 5", "Laptop vlan10" -> número de VLAN de la PC.
_RE_VLAN_PC = re.compile(r"(?:^|[^a-z])v(?:lan)?[\s\-_#]*(\d{1,4})(?!\d)", re.I)
_CLAVES_GW = {"gw", "gateway", "puerta", "default-router"}
_IGNORAR = {"vlan", "red", "mascara", "máscara", "rango", "broadcast", "de", "a",
            "y", "net", "mask", "hosts", "usuarios", "enlace", "nombre", "name",
            "host", "usuario", "equipos", "pcs", "pc", "base"}

PRIORIDAD_RAIZ = 4096


def nombre_por_omision(numero) -> str:
    """El nombre que se usa en las prácticas: VLAN 3 -> TRES."""
    if 0 < numero < len(_NOMBRES_VLAN):
        return _NOMBRES_VLAN[numero]
    return "VLAN%d" % numero


@dataclass
class VlanPlan:
    numero: int
    red: ipaddress.IPv4Network
    nombre: str
    gateway: str

    @property
    def mascara(self) -> str:
        return str(self.red.netmask)

    @property
    def direccion(self) -> str:
        return str(self.red.network_address)

    @property
    def difusion(self) -> str:
        return str(self.red.broadcast_address)


@dataclass
class Pedida:
    """VLAN que la nota nombra sin red: sale de la red base del sitio, del
    tamaño que diga su diagonal ('VLAN 2/17') o su número de usuarios."""
    numero: int
    nombre: str | None = None
    usuarios: int | None = None
    prefijo: int | None = None

    @property
    def tamano(self):
        """Prefijo que le toca, o None si no dice de qué tamaño es."""
        if self.prefijo is not None:
            return self.prefijo
        if self.usuarios:
            try:
                return vlsm.prefijo_para_usuarios(self.usuarios)
            except ValueError:
                return None
        return None


@dataclass
class Orden:
    """Un grupo de comandos para un equipo, y si ya está en su configuración."""
    tipo: str
    lineas: list
    presente: bool = False


@dataclass
class Canal:
    a: str
    puertos_a: list
    modo_a: str
    grupo_a: int
    b: str
    puertos_b: list
    modo_b: str
    grupo_b: int


@dataclass
class Sitio:
    """Lo que el plan asigna a un equipo dueño (multicapa o router)."""
    dueno: object
    vlans: list = field(default_factory=list)
    como: str = ""                     # "nombre", "configuración", "cercanía"
    notas: list = field(default_factory=list)            # [(x, y)]
    puerto_lan: str | None = None      # routers: la interfaz hacia el switch
    switches: dict = field(default_factory=dict)         # nombre -> distancia
    raiz: str | None = None
    canales: list = field(default_factory=list)
    pcs: list = field(default_factory=list)  # (pc, equipo, puerto, vlan, fuente)
    bloque: object = None              # red base del sitio, si la nota la trae
    inicio: object = None              # base sin diagonal: desde dónde se reparte
    pedidas: list = field(default_factory=list)          # [Pedida]
    reparto: str = ""                  # "en partes iguales", "por diagonal"...


@dataclass
class Plan:
    notas: int = 0
    sitios: list = field(default_factory=list)
    ordenes: dict = field(default_factory=dict)         # equipo -> [Orden]
    switches_en_orden: list = field(default_factory=list)
    hallazgos: list = field(default_factory=list)

    @property
    def vacio(self) -> bool:
        return not self.sitios

    def pendientes(self, equipo) -> list:
        return [o for o in self.ordenes.get(equipo, []) if not o.presente]

    def sitio_de(self, equipo):
        for sitio in self.sitios:
            if sitio.dueno.nombre == equipo:
                return sitio
        return None


# ==========================================================================
# Lectura de las notas
# ==========================================================================

@dataclass
class _Nota:
    x: float | None
    y: float | None
    texto: str


def _tag(el) -> str:
    return el.tag.split("}")[-1].lower() if isinstance(el.tag, str) else ""


def _leer_notas(raiz) -> list:
    notas = []
    for nodo in raiz.iter():
        if _tag(nodo) != "note":
            continue
        valores = {_tag(h): (h.text or "") for h in nodo}
        try:
            x, y = float(valores.get("x", "")), float(valores.get("y", ""))
        except ValueError:
            x = y = None
        texto = valores.get("text", "").replace("\r", "\n").replace("\t", " ")
        if texto.strip():
            notas.append(_Nota(x, y, texto))
    return notas


def _partir_nota(texto, nombres) -> list:
    """[(equipo | None, tramo)]: una línea que empieza con el nombre de un
    equipo abre un tramo nuevo, así una sola nota puede describir varios
    sitios."""
    ordenados = sorted(nombres, key=len, reverse=True)
    tramos = [[None, []]]
    for linea in texto.split("\n"):
        baja = linea.strip().lower()
        encontrado = None
        for nombre in ordenados:
            if baja == nombre or baja.rstrip(":").strip() == nombre \
                    or baja.startswith(nombre + ":") or baja.startswith(nombre + " "):
                encontrado = nombre
                break
        if encontrado is None:
            tramos[-1][1].append(linea)
            continue
        resto = linea.strip()[len(encontrado):].lstrip(" :")
        tramos.append([nombres[encontrado], [resto]])
    salida = []
    for equipo, lineas in tramos:
        tramo = "\n".join(lineas)
        # Sirve si trae VLANs, o si nombra un equipo y trae una red (la red
        # base del sitio). Las notas de los enlaces ('.4') no traen ninguna.
        if _RE_VLAN.search(tramo) or (equipo is not None and _RE_IP_SUELTA.search(tramo)):
            salida.append((equipo, tramo))
    return salida


def _es_ip(texto) -> bool:
    try:
        ipaddress.IPv4Address(texto)
        return True
    except ValueError:
        return False


def _es_mascara(texto) -> bool:
    try:
        valor = int(ipaddress.IPv4Address(texto))
    except ValueError:
        return False
    inversa = (~valor) & 0xFFFFFFFF
    return valor != 0 and (inversa & (inversa + 1)) == 0


def _mascara_abreviada(texto):
    """'255.192' -> 255.255.255.192, '252.0' -> 255.255.252.0."""
    octetos = texto.split(".")
    while len(octetos) < 4:
        octetos.insert(0, "255")
    completa = ".".join(octetos)
    return completa if _es_mascara(completa) else None


def _base_de(topo):
    """Primeros dos octetos más comunes entre las direcciones de los routers.

    En algunas notas las direcciones van recortadas ('3.0 - 3.255 255.0'): los
    octetos que faltan son los de toda la práctica, y los enlaces /30 los traen.
    """
    cuenta = Counter()
    for d in topo.ruteadores:
        for i in d.interfaces_ip:
            if not i.planeada:
                cuenta[tuple(i.ip.split(".")[:2])] += 1
    return list(cuenta.most_common(1)[0][0]) if cuenta else None


def _completar(corta, base):
    """'3.0' con base ['13', '0'] -> '13.0.3.0'; '2.0.0' -> '13.2.0.0'."""
    octetos = corta.split(".")
    faltan = 4 - len(octetos)
    if base is None or faltan > len(base):
        return None
    completa = ".".join(base[:faltan] + octetos)
    return completa if _es_ip(completa) else None


def _lineas_vlan(tramo, avisos, base=None) -> list:
    """Cada 'VLAN n' del tramo: VlanPlan si trae su red, Pedida si no."""
    marcas = list(_RE_VLAN.finditer(tramo))
    salida = []
    for i, marca in enumerate(marcas):
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(tramo)
        vlan = _interpretar(int(marca.group(1)), tramo[marca.end():fin], avisos,
                            base)
        if vlan is not None:
            salida.append(vlan)
    return salida


def _vlans_de(tramo, avisos, base=None) -> list:
    return [v for v in _lineas_vlan(tramo, avisos, base) if isinstance(v, VlanPlan)]


def _leer_tramo(tramo, avisos, base=None):
    """(VLANs con red, VLANs sin red, red base del sitio, desde dónde se reparte)."""
    marca = _RE_VLAN.search(tramo)
    bloque, inicio = _bloque_de(tramo[:marca.start()] if marca else tramo, avisos,
                                base)
    vlans, pedidas = [], []
    for v in _lineas_vlan(tramo, avisos, base):
        (vlans if isinstance(v, VlanPlan) else pedidas).append(v)
    return vlans, pedidas, bloque, inicio


def _prefijo_por_clase(direccion):
    primero = int(direccion.split(".")[0])
    return 8 if primero < 128 else 16 if primero < 192 else 24 if primero < 224 else None


def _bloque_de(texto, avisos, base=None):
    """(red base del sitio, inicio). Va junto al hostname, antes de cualquier
    VLAN: 'R1 16.1.0.0/16', o 'R1' y abajo '16.1.0.0 255.255.0.0'. Sin diagonal
    ('R1 16.0.0.0') se reparte desde esa dirección (el inicio) dentro de la
    red de su clase; con diagonal el inicio es None."""
    red_txt = prefijo = mascara = None
    for t in _RE_TOKEN.finditer(texto):
        if t.group("ip"):
            limpia = re.sub(r"\.+", ".", t.group("ip"))
            if not _es_ip(limpia):
                continue
            if red_txt is None:
                red_txt = limpia
                prefijo = int(t.group("pre")) if t.group("pre") else None
            elif mascara is None and _es_mascara(limpia):
                mascara = limpia
        elif t.group("pre2") and red_txt is not None and prefijo is None:
            prefijo = int(t.group("pre2"))
        elif t.group("abrev"):
            if red_txt is None:
                red_txt = _completar(t.group("abrev"), base)
            elif mascara is None:
                mascara = _mascara_abreviada(t.group("abrev"))
        elif t.group("octeto") and red_txt is not None and mascara is None:
            mascara = _mascara_abreviada(t.group("octeto"))
    if red_txt is None:
        return None, None
    if prefijo is None and mascara is None:
        clase = _prefijo_por_clase(red_txt)
        if clase is None:
            return None, None
        red = ipaddress.IPv4Network("%s/%d" % (red_txt, clase), strict=False)
        return red, ipaddress.IPv4Address(red_txt)
    try:
        red = ipaddress.IPv4Network("%s/%s" % (red_txt, mascara if prefijo is None
                                                else prefijo), strict=False)
    except ValueError:
        return None, None
    if red.prefixlen > 29:
        return None, None   # un /30 es un enlace, no una red para repartir en VLANs
    if str(red.network_address) != red_txt:
        avisos.append("la red base %s no es dirección de red; se usó %s"
                      % (red_txt, red))
    return red, None


def _interpretar(numero, cuerpo, avisos, base=None):
    red_txt = prefijo = mascara = difusion = gateway = nombre = usuarios = None
    tamano = None                   # 'VLAN 2/17': sólo el tamaño, sin red
    espera_gw = intento = False
    for t in _RE_TOKEN.finditer(cuerpo):
        if t.group("pal"):
            palabra = t.group("pal")
            if palabra.lower() in _CLAVES_GW:
                espera_gw = True
            elif nombre is None and palabra.lower() not in _IGNORAR:
                nombre = palabra.upper()
            continue
        if t.group("num"):
            # 'VLAN 3 500' o 'VLAN 3 500 usuarios': cuántos equipos lleva.
            if usuarios is None and int(t.group("num")) > 0:
                usuarios = int(t.group("num"))
            continue
        if t.group("pre2"):
            if red_txt is not None and prefijo is None:
                prefijo = int(t.group("pre2"))
            elif red_txt is None and tamano is None:
                tamano = int(t.group("pre2"))
            continue
        if t.group("octeto"):
            # '.248' sólo puede ser una máscara: 255.255.255.248
            if red_txt is not None and mascara is None:
                mascara = _mascara_abreviada(t.group("octeto"))
            continue
        if t.group("abrev"):
            # Recortado puede ser una dirección ('3.0') o una máscara ('255.0').
            # Lo primero tras 'VLAN n' es la red; después, si rellenado con 255
            # a la izquierda forma una máscara válida, es la máscara.
            corta = t.group("abrev")
            como_mascara = _mascara_abreviada(corta)
            if red_txt is None:
                red_txt, intento = _completar(corta, base), True
                if red_txt is None:
                    avisos.append("VLAN %d: no se pudo completar la dirección '%s'"
                                  % (numero, corta))
            elif como_mascara and mascara is None:
                mascara = como_mascara
            elif difusion is None and prefijo is None and mascara is None:
                difusion = _completar(corta, base)
            else:
                avisos.append("VLAN %d: '%s' no es una máscara válida"
                              % (numero, corta))
            continue
        cruda = t.group("ip")
        limpia = re.sub(r"\.+", ".", cruda)
        if limpia != cruda:
            avisos.append("VLAN %d: se leyó '%s' como %s" % (numero, cruda, limpia))
        if not _es_ip(limpia):
            continue
        if espera_gw:
            gateway, espera_gw = limpia, False
        elif red_txt is None and tamano is None and limpia.startswith("255.") \
                and _es_mascara(limpia):
            # 'VLAN 2 255.255.128.0': ninguna red empieza en 255, es el tamaño.
            tamano = ipaddress.IPv4Network("0.0.0.0/%s" % limpia).prefixlen
        elif red_txt is None:
            red_txt = limpia
            if t.group("pre"):
                prefijo = int(t.group("pre"))
        elif mascara is None and _es_mascara(limpia):
            mascara = limpia
        elif difusion is None and prefijo is None:
            difusion = limpia
        else:
            avisos.append("VLAN %d: se ignoró %s" % (numero, limpia))

    if red_txt is None:
        # Sin red: la saca el reparto de la red base del sitio. Si se intentó
        # escribir una y no se entendió, ya quedó el aviso y no se inventa.
        if intento:
            return None
        if tamano is not None and not 0 < tamano <= 30:
            avisos.append("VLAN %d: /%d no deja direcciones para equipos"
                          % (numero, tamano))
            return None
        return Pedida(numero, nombre, usuarios, tamano)
    if tamano is not None and prefijo is None and mascara is None and difusion is None:
        prefijo = tamano            # 'VLAN 2 /17 16.0.0.0': la diagonal iba antes

    por_prefijo = por_rango = por_mascara = None
    try:
        if prefijo is not None:
            por_prefijo = ipaddress.IPv4Network("%s/%d" % (red_txt, prefijo),
                                                strict=False)
        if mascara:
            por_mascara = ipaddress.IPv4Network("%s/%s" % (red_txt, mascara),
                                                strict=False)
        if difusion:
            bloques = list(ipaddress.summarize_address_range(
                ipaddress.IPv4Address(red_txt), ipaddress.IPv4Address(difusion)))
            if len(bloques) == 1:
                por_rango = bloques[0]
            else:
                avisos.append("VLAN %d: el rango %s - %s no es una subred exacta"
                              % (numero, red_txt, difusion))
    except ValueError as exc:
        avisos.append("VLAN %d: %s" % (numero, exc))

    # La diagonal escrita manda; luego el rango (son dos direcciones
    # completas) y al final la máscara, que en las notas suele ir abreviada.
    red = por_prefijo or por_rango or por_mascara
    if red is None:
        avisos.append("VLAN %d: falta la máscara o la diagonal" % numero)
        return None
    if por_mascara is not None and por_mascara != red:
        avisos.append("VLAN %d: la máscara %s no cuadra con %s; se usó /%d"
                      % (numero, mascara, red, red.prefixlen))
    if por_rango is not None and por_rango != red:
        avisos.append("VLAN %d: el rango %s - %s no cuadra con %s; se usó %s"
                      % (numero, red_txt, difusion, red, red))
    if str(red.network_address) != red_txt:
        avisos.append("VLAN %d: %s no es dirección de red; se usó %s"
                      % (numero, red_txt, red))
    if red.prefixlen > 30:
        avisos.append("VLAN %d: %s no deja direcciones para equipos" % (numero, red))
        return None
    if usuarios and usuarios > red.num_addresses - 2:
        avisos.append("VLAN %d: en %s caben %d equipos y la nota pide %d"
                      % (numero, red, red.num_addresses - 2, usuarios))

    if gateway:
        g = ipaddress.IPv4Address(gateway)
        if g not in red or g in (red.network_address, red.broadcast_address):
            avisos.append("VLAN %d: la puerta de enlace %s no es utilizable en %s"
                          % (numero, gateway, red))
            gateway = None
    if not gateway:
        gateway = str(red.broadcast_address - 1)
    return VlanPlan(numero, red, nombre or nombre_por_omision(numero), gateway)


# ==========================================================================
# Cableado de capa 2
# ==========================================================================

def _interfaz(disp, puerto):
    for i in disp.interfaces:
        if i.nombre.lower() == puerto.lower():
            return i
    return None


def _config(disp, puerto):
    return disp.cfg.por_nombre(puerto) if disp.cfg else None


def _puerto_ruteado(disp, puerto) -> bool:
    """Un puerto con IP propia (o 'no switchport') no forma parte de la LAN."""
    i = _interfaz(disp, puerto)
    if i is not None and i.configurada and not i.planeada:
        return True
    ic = _config(disp, puerto)
    return bool(ic and ic.ruteado and ic.ip)


def _es_l2(a, pa, b, pb) -> bool:
    """Un cable que llega a un switch o a una PC es de LAN aunque el otro lado
    tenga IP (un router con la red en el puerto físico, o con IP y además
    subinterfaces). Entre dos equipos de capa 3 sólo cuenta si ninguno de los
    dos puertos tiene IP."""
    if a.es_switch or b.es_switch or a.es_host or b.es_host:
        return True
    return not _puerto_ruteado(a, pa) and not _puerto_ruteado(b, pb)


def _grafo_l2(topo):
    equipos = {d.nombre: d for d in topo.dispositivos}
    cables, ady = [], defaultdict(list)
    for e in topo.enlaces:
        a, b = equipos.get(e.a_dispositivo), equipos.get(e.b_dispositivo)
        if a is None or b is None:
            continue
        if not _es_l2(a, e.a_puerto, b, e.b_puerto):
            continue
        cables.append((a.nombre, e.a_puerto, b.nombre, e.b_puerto))
        ady[a.nombre].append((b.nombre, e.a_puerto, e.b_puerto))
        ady[b.nombre].append((a.nombre, e.b_puerto, e.a_puerto))
    return equipos, cables, ady


def _subir(nombre, equipos, ady):
    """Primer ruteador o multicapa que se alcanza por capa 2 desde `nombre`."""
    if equipos[nombre].es_ruteador:
        return equipos[nombre]
    vistos, cola = {nombre}, deque([nombre])
    while cola:
        u = cola.popleft()
        for v, _, _ in ady.get(u, ()):
            if v in vistos:
                continue
            vistos.add(v)
            if equipos[v].es_ruteador:
                return equipos[v]
            if equipos[v].es_switch:
                cola.append(v)
    return None


# ==========================================================================
# De qué equipo es cada nota
# ==========================================================================

def _redes_configuradas(disp) -> set:
    redes = set()
    for i in disp.interfaces_ip:
        if i.planeada:
            continue
        try:
            redes.add(ipaddress.IPv4Interface("%s/%s" % (i.ip, i.mascara)).network)
        except ValueError:
            continue
    return redes


def _resolver_dueno(marcador, vlans, nota, topo, equipos, ady):
    if marcador is not None:
        return _subir(marcador.nombre, equipos, ady), "nombre"

    redes = {v.red for v in vlans}
    cuentas = Counter()
    for d in topo.ruteadores:
        coincidencias = len(redes & _redes_configuradas(d))
        if coincidencias:
            cuentas[d.nombre] = coincidencias
    if cuentas:
        (mejor, n), *resto = cuentas.most_common()
        if not resto or resto[0][1] < n:
            return equipos[mejor], "configuración"

    if nota.x is None:
        return None, ""
    lan = [d for d in topo.dispositivos
           if (d.es_switch or d.es_host) and d.x is not None]
    if lan:
        cerca = min(lan, key=lambda d: math.dist((nota.x, nota.y), (d.x, d.y)))
        dueno = _subir(cerca.nombre, equipos, ady)
        if dueno is not None:
            return dueno, "cercanía"
    rts = [d for d in topo.ruteadores if d.x is not None]
    if rts:
        return min(rts, key=lambda d: math.dist((nota.x, nota.y), (d.x, d.y))), \
            "cercanía"
    return None, ""


def _nombres_equipos(topo) -> dict:
    """Nombre en minúsculas -> equipo: la etiqueta del lienzo siempre, y el
    hostname cuando no lo comparte con otro."""
    repetidos = Counter(d.hostname.lower() for d in topo.dispositivos if d.hostname)
    salida = {}
    for d in topo.dispositivos:
        salida[d.nombre.lower()] = d
        if d.hostname and repetidos[d.hostname.lower()] == 1:
            salida[d.hostname.lower()] = d
    return salida


# ==========================================================================
# Plan completo
# ==========================================================================

def leer(raiz, topo) -> Plan:
    plan = Plan()
    notas = _leer_notas(raiz)
    if not notas:
        return plan

    def anota(nivel, equipo, mensaje):
        plan.hallazgos.append(Hallazgo(nivel, equipo, mensaje))

    equipos, cables, ady = _grafo_l2(topo)
    nombres = _nombres_equipos(topo)
    base = _base_de(topo)
    sitios = {}

    for nota in notas:
        donde = "la nota en (%d, %d)" % (nota.x, nota.y) if nota.x is not None \
            else "una nota"
        util = False
        for marcador, tramo in _partir_nota(nota.texto, nombres):
            avisos = []
            vlans, pedidas, bloque, inicio = _leer_tramo(tramo, avisos, base)
            algo = bool(vlans or pedidas or bloque)
            dueno, como = (None, "")
            if algo:
                dueno, como = _resolver_dueno(marcador, vlans, nota, topo,
                                              equipos, ady)
            destino = dueno.nombre if dueno else "plan"
            for aviso in avisos:
                anota(AVISO, destino, "%s: %s" % (donde, aviso))
            if not algo:
                continue
            util = True
            if dueno is None:
                anota(ERROR, "plan", "no se sabe de qué equipo es %s; escribe en "
                      "la nota el hostname del core o del router" % donde)
                continue
            if como == "cercanía":
                anota(AVISO, dueno.nombre,
                      "%s no dice de qué equipo es y se asignó a %s por cercanía;"
                      " escribe el hostname en la nota para asegurarlo"
                      % (donde, dueno.hostname or dueno.nombre))
            sitio = sitios.setdefault(dueno.nombre, Sitio(dueno=dueno, como=como))
            if nota.x is not None:
                sitio.notas.append((nota.x, nota.y))
            for vlan in vlans:
                _agregar_vlan(sitio, vlan, anota)
            sitio.pedidas += pedidas
            if bloque is not None:
                if sitio.bloque is not None and (sitio.bloque, sitio.inicio) != \
                        (bloque, inicio):
                    anota(ERROR, dueno.nombre, "trae dos redes base, %s y %s; se usó "
                          "la primera" % (sitio.inicio or sitio.bloque,
                                          inicio or bloque))
                else:
                    sitio.bloque, sitio.inicio = bloque, inicio
        plan.notas += util

    # Routers primero y luego cores, cada grupo por nombre (R2 antes que R10):
    # en ese orden se reparten las redes base que comparten varios sitios.
    plan.sitios = sorted(sitios.values(),
                         key=lambda s: (s.dueno.es_multicapa,
                                        _natural(s.dueno.hostname or s.dueno.nombre)))
    if not plan.sitios:
        return plan
    # Primero quién está en cada sitio (switches y PCs): de ahí salen las VLANs
    # de los sitios que sólo traen su red base.
    _armar_sitios(plan, equipos, cables, ady, anota)
    _repartir(plan, topo, anota)
    _revisar_traslapes(plan, topo, anota)
    for sitio in plan.sitios:
        _revisar_pcs(sitio, anota)
    _generar(plan, equipos, cables)
    _aplicar_al_modelo(plan, anota)
    return plan


def _natural(texto):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", texto)]


def redes_de_notas(topo):
    """Lo que las notas dicen de antemano, sin armar el plan: las VLANs con su
    red escrita [(VlanPlan, de quién)] y las redes base de cada nota. Los
    enlaces se configuran antes que el plan y no deben pisar ninguna de las
    dos; las bases además dicen de dónde salen las IPs de los enlaces."""
    nombres = _nombres_equipos(topo)
    base = _base_de(topo)
    vlans, bases = [], []
    for nota in getattr(topo, "notas", ()):
        for marcador, tramo in _partir_nota(nota.texto, nombres):
            escritas, _, bloque, inicio = _leer_tramo(tramo, [], base)
            quien = (marcador.hostname or marcador.nombre) if marcador is not None \
                else "una nota"
            vlans += [(v, quien) for v in escritas]
            if bloque is not None:
                bases.append(inicio or bloque.network_address)
    return vlans, bases


def _repartir(plan, topo, anota):
    """Las VLANs que no traen red salen de la red base de su sitio: del tamaño
    que diga su diagonal o su número de usuarios (VLSM, la más grande primero),
    o en partes iguales si la nota no dice tamaños. Si el sitio sólo trae la
    red base, sus VLANs son las de sus PCs.

    Cada VLAN toma el primer bloque libre desde el inicio de la red base, así
    que varios sitios con la misma base ('R1 16.0.0.0', 'R2 16.0.0.0') quedan
    uno tras otro, sin encimarse con los enlaces ni entre sí."""
    # Lo que ya usa la práctica y no se puede pisar. Las SVI y subinterfaces
    # de los dueños no cuentan: esas las vuelve a armar el plan.
    duenos = {s.dueno.nombre for s in plan.sitios}
    ocupadas = [v.red for s in plan.sitios for v in s.vlans]
    for d in topo.ruteadores:
        for i in d.interfaces_ip:
            if i.planeada or (d.nombre in duenos and (
                    i.nombre.lower().startswith("vlan") or "." in i.nombre)):
                continue
            try:
                ocupadas.append(ipaddress.IPv4Interface("%s/%s" % (i.ip, i.mascara)).network)
            except ValueError:
                continue
    for sitio in plan.sitios:
        dueno = sitio.dueno.nombre
        ya = {v.numero for v in sitio.vlans}
        pedidas, vistas = [], set(ya)
        for p in sitio.pedidas:
            if p.numero not in vistas:
                pedidas.append(p)
                vistas.add(p.numero)
        if sitio.bloque is None:
            for p in pedidas:
                anota(AVISO, dueno, "VLAN %d: no trae su red, y la nota no tiene una "
                      "red base de dónde sacarla" % p.numero)
            continue
        for v in sitio.vlans:
            if not v.red.subnet_of(sitio.bloque):
                anota(AVISO, dueno, "la VLAN %d (%s) queda fuera de su red base %s"
                      % (v.numero, v.red, sitio.bloque))
        if not sitio.pedidas:
            numeros = sorted({vlan for _, _, _, vlan, _ in sitio.pcs
                              if vlan is not None} - ya)
            pedidas = [Pedida(n) for n in numeros]
        if not pedidas:
            if not sitio.vlans:
                anota(ERROR, dueno, "tiene la red base %s, pero no se sabe qué VLANs "
                      "lleva: ponle a cada PC su VLAN en el nombre ('PC1 V3') o "
                      "escríbelas en la nota ('VLAN 3/24')"
                      % (sitio.inicio or sitio.bloque))
            continue

        redes, sitio.reparto, aviso = _dividir(sitio.bloque, sitio.inicio, pedidas,
                                               ocupadas)
        if aviso:
            anota(AVISO, dueno, aviso)
        con_tamano = any(p.tamano for p in pedidas)
        for pedida, red in zip(pedidas, redes):
            if red is None and con_tamano and not pedida.tamano:
                anota(ERROR, dueno, "la VLAN %d no dice de qué tamaño es: ponle su "
                      "diagonal ('VLAN %d/24') o cuántos equipos lleva, como las demás"
                      % (pedida.numero, pedida.numero))
                continue
            if red is None:
                pista = " (sin diagonal se toma la de su clase, /%d)" \
                    % sitio.bloque.prefixlen if sitio.inicio is not None else ""
                anota(ERROR, dueno, "la VLAN %d%s no cabe en la red base %s%s"
                      % (pedida.numero, " (/%d)" % pedida.tamano if pedida.tamano
                         else "", sitio.inicio or sitio.bloque, pista))
                continue
            if pedida.usuarios and pedida.usuarios > red.num_addresses - 2:
                anota(AVISO, dueno, "VLAN %d: en %s caben %d equipos y la nota pide %d"
                      % (pedida.numero, red, red.num_addresses - 2, pedida.usuarios))
            _agregar_vlan(sitio, VlanPlan(pedida.numero, red,
                                          pedida.nombre or nombre_por_omision(pedida.numero),
                                          str(red.broadcast_address - 1)), anota)
            ocupadas.append(red)


def _candidatas(bloque, inicio, prefijo):
    """Bloques /prefijo alineados dentro de `bloque`, del primero que empieza
    en `inicio` o después, hacia arriba."""
    tamano = 2 ** (32 - prefijo)
    desde = max(int(inicio) if inicio is not None else 0, int(bloque.network_address))
    n = -(-desde // tamano) * tamano
    fin = int(bloque.broadcast_address)
    while n + tamano - 1 <= fin:
        yield ipaddress.IPv4Network((n, prefijo))
        n += tamano


def _dividir(bloque, inicio, pedidas, ocupadas):
    """([red o None por pedida], cómo se repartió, aviso). Cada VLAN toma el
    primer bloque libre: se salta cualquiera que pise una red que ya use la
    práctica (enlaces, otras VLANs)."""
    def libre(red, tomadas):
        return not any(red.overlaps(o) for o in ocupadas) \
            and not any(red.overlaps(t) for t in tomadas)

    redes = [None] * len(pedidas)
    if any(p.tamano for p in pedidas):
        # VLSM: de la más grande a la más chica. Las que no dicen tamaño se
        # quedan sin red y se reporta cuál falta.
        tomadas = []
        for i in sorted((i for i, p in enumerate(pedidas) if p.tamano),
                        key=lambda i: (pedidas[i].tamano, pedidas[i].numero)):
            prefijo = pedidas[i].tamano
            if prefijo < bloque.prefixlen:
                continue
            for red in _candidatas(bloque, inicio, prefijo):
                if libre(red, tomadas):
                    redes[i] = red
                    tomadas.append(red)
                    break
        por_usuarios = any(p.usuarios and p.prefijo is None for p in pedidas)
        por_diagonal = any(p.prefijo is not None for p in pedidas)
        modo = "por diagonal y usuarios" if por_usuarios and por_diagonal else \
            "por usuarios" if por_usuarios else "por diagonal"
        return redes, modo + ", de la más grande a la más chica", None

    orden = sorted(range(len(pedidas)), key=lambda i: pedidas[i].numero)
    inicial = bloque.prefixlen + (len(pedidas) - 1).bit_length()
    aviso = None
    for prefijo in range(inicial, 31):
        libres = []
        for red in _candidatas(bloque, inicio, prefijo):
            if libre(red, libres):
                libres.append(red)
                if len(libres) == len(pedidas):
                    break
        if len(libres) == len(pedidas):
            for i, red in zip(orden, libres):
                redes[i] = red
            if prefijo > inicial:
                aviso = ("en /%d no cabían todas sin pisar las redes que ya usa la "
                         "práctica; se usaron /%d" % (inicial, prefijo))
            break
    return redes, "en partes iguales", aviso


def _agregar_vlan(sitio, vlan, anota):
    for otra in sitio.vlans:
        if otra.numero == vlan.numero:
            if otra.red != vlan.red:
                anota(ERROR, sitio.dueno.nombre,
                      "la VLAN %d aparece dos veces con redes distintas (%s y %s)"
                      % (vlan.numero, otra.red, vlan.red))
            return
        if otra.red == vlan.red:
            anota(ERROR, sitio.dueno.nombre,
                  "las VLAN %d y %d tienen la misma red %s"
                  % (otra.numero, vlan.numero, vlan.red))
            return
    sitio.vlans.append(vlan)
    sitio.vlans.sort(key=lambda v: v.numero)


def _revisar_traslapes(plan, topo, anota):
    """Dos VLANs del plan que se pisan, o una VLAN que pisa un enlace."""
    todas = [(s, v) for s in plan.sitios for v in s.vlans]
    for i in range(len(todas)):
        for j in range(i + 1, len(todas)):
            (sa, va), (sb, vb) = todas[i], todas[j]
            if va.red.overlaps(vb.red):
                anota(ERROR, "plan",
                      "la VLAN %d de %s (%s) se traslapa con la VLAN %d de %s (%s)"
                      % (va.numero, sa.dueno.hostname or sa.dueno.nombre, va.red,
                         vb.numero, sb.dueno.hostname or sb.dueno.nombre, vb.red))
    # Contra lo configurado: un aviso por VLAN, con todas las redes que pisa.
    # Las que son otra VLAN del plan ya salieron en la vuelta anterior.
    del_plan = {v.red for _, v in todas}
    for sitio, vlan in todas:
        choques = defaultdict(set)
        for d in topo.ruteadores:
            for red in _redes_configuradas(d):
                if red in del_plan or not red.overlaps(vlan.red):
                    continue
                choques[red].add(d.hostname or d.nombre)
        if choques:
            detalle = ", ".join("%s (%s)" % (red, ", ".join(sorted(eqs)))
                                for red, eqs in sorted(choques.items(),
                                                       key=lambda x: int(x[0].network_address)))
            anota(ERROR, "plan", "la VLAN %d de %s (%s) choca con %s"
                  % (vlan.numero, sitio.dueno.hostname or sitio.dueno.nombre,
                     vlan.red, detalle))


def _armar_sitios(plan, equipos, cables, ady, anota):
    """Qué switches y PCs le tocan a cada dueño, raíz de STP y EtherChannel."""
    duenos = {s.dueno.nombre: s for s in plan.sitios}
    distancia, de_quien, empatados = {}, {}, set()
    cola = deque()
    for nombre in duenos:
        distancia[nombre], de_quien[nombre] = 0, nombre
        cola.append(nombre)
    while cola:
        u = cola.popleft()
        for v, _, _ in ady.get(u, ()):
            if not equipos[v].es_switch:
                continue
            if v in distancia:
                if de_quien[v] != de_quien[u] and distancia[v] == distancia[u] + 1:
                    empatados.add(v)
                continue
            distancia[v], de_quien[v] = distancia[u] + 1, de_quien[u]
            cola.append(v)
    for v in sorted(empatados):
        anota(AVISO, v, "queda a la misma distancia de dos sitios; se tomó el de %s"
              % (equipos[de_quien[v]].hostname or de_quien[v]))

    for sitio in plan.sitios:
        dueno = sitio.dueno.nombre
        sitio.switches = {n: d for n, d in distancia.items()
                          if de_quien[n] == dueno and n != dueno}
        miembros = set(sitio.switches) | {dueno}

        propios = [c for c in cables if c[0] in miembros and c[2] in miembros]
        if not sitio.dueno.es_multicapa:
            lan = sorted(c[1] if c[0] == dueno else c[3] for c in propios
                         if dueno in (c[0], c[2]))
            if not lan:
                anota(ERROR, dueno, "no tiene ningún switch cableado para las VLANs "
                      "del plan (se necesita un puerto sin IP hacia la LAN)")
            else:
                sitio.puerto_lan = lan[0]
                if len(set(lan)) > 1:
                    anota(AVISO, dueno, "tiene varios puertos hacia la LAN; las "
                          "subinterfaces se ponen en %s" % lan[0])

        # PCs: las cableadas a un switch del sitio o al multicapa dueño.
        for a, pa, b, pb in cables:
            for pc, equipo, puerto in ((a, b, pb), (b, a, pa)):
                if equipos[pc].es_host and equipo in miembros \
                        and (equipo != dueno or sitio.dueno.es_multicapa):
                    vlan, fuente = _vlan_de_pc(equipos[pc], equipos[equipo],
                                               puerto, sitio)
                    sitio.pcs.append((pc, equipo, puerto, vlan, fuente))
        sitio.pcs.sort(key=lambda t: (t[1], t[2]))

        # EtherChannel: dos o más cables entre los mismos dos equipos.
        por_par = defaultdict(list)
        for a, pa, b, pb in propios:
            if equipos[a].es_host or equipos[b].es_host:
                continue
            if not sitio.dueno.es_multicapa and dueno in (a, b):
                continue
            (x, px), (y, py) = sorted([(a, pa), (b, pb)])
            por_par[(x, y)].append((px, py))
        grupos = Counter()

        def rango_de(eq):
            return (distancia.get(eq, 0), equipos[eq].hostname or eq)

        for (x, y), puertos in sorted(por_par.items()):
            if len(puertos) < 2:
                continue
            activo, pasivo = (x, y) if rango_de(x) <= rango_de(y) else (y, x)
            px = [p[0] for p in puertos] if activo == x else [p[1] for p in puertos]
            py = [p[1] for p in puertos] if activo == x else [p[0] for p in puertos]
            grupos[activo] += 1
            grupos[pasivo] += 1
            sitio.canales.append(Canal(activo, sorted(px), "active", grupos[activo],
                                       pasivo, sorted(py), "passive", grupos[pasivo]))

        # Raíz de STP: el switch pegado al dueño con más vecinos, sólo si hay
        # switches colgados de otros. En una estrella (todos pegados al dueño)
        # no hay nada que elegir, y en las prácticas nunca se configuró.
        if sitio.switches and max(sitio.switches.values()) >= 2:
            vecinos = defaultdict(set)
            for a, _, b, _ in propios:
                vecinos[a].add(b)
                vecinos[b].add(a)
            pegados = [n for n, d in sitio.switches.items() if d == 1]
            if pegados:
                sitio.raiz = sorted(pegados, key=lambda n: (-len(vecinos[n]),
                                                            equipos[n].hostname or n))[0]

    plan.switches_en_orden = [n for s in plan.sitios
                              for n in sorted(s.switches,
                                              key=lambda n: (s.switches[n], n))]


def _vlan_de_pc(pc, equipo, puerto, sitio):
    m = _RE_VLAN_PC.search(pc.nombre)
    if m:
        return int(m.group(1)), "nombre"
    ic = _config(equipo, puerto)
    if ic and ic.acceso_vlan:
        return ic.acceso_vlan, "switch"
    for i in pc.interfaces_ip:
        for vlan in sitio.vlans:
            if ipaddress.IPv4Address(i.ip) in vlan.red:
                return vlan.numero, "IP"
    if pc.gateway:
        for vlan in sitio.vlans:
            if ipaddress.IPv4Address(pc.gateway) in vlan.red:
                return vlan.numero, "puerta de enlace"
    return None, ""


def _revisar_pcs(sitio, anota):
    dueno = sitio.dueno.nombre
    numeros = {v.numero for v in sitio.vlans}
    sin_vlan = [pc for pc, _, _, vlan, _ in sitio.pcs if vlan is None]
    if sin_vlan:
        anota(AVISO, dueno, "PCs sin VLAN conocida: %s. Ponles la VLAN en el "
              "nombre (por ejemplo 'PC1 V3') para generar su puerto de acceso"
              % ", ".join(sin_vlan))
    for pc, equipo, puerto, vlan, fuente in sitio.pcs:
        if vlan is not None and vlan not in numeros:
            anota(ERROR, dueno, "%s va en la VLAN %d (según su %s), pero el sitio "
                  "sólo tiene %s" % (pc, vlan, fuente,
                                     ", ".join(str(n) for n in sorted(numeros))))


# ==========================================================================
# Comandos
# ==========================================================================

def rango(puertos) -> str:
    """['FastEthernet0/2', 'FastEthernet0/3', 'FastEthernet0/4', 'FastEthernet0/7']
    -> 'FastEthernet0/2 - 4 , FastEthernet0/7'"""
    grupos = defaultdict(list)
    for puerto in puertos:
        m = re.match(r"^(.*?)(\d+)$", puerto)
        if m:
            grupos[m.group(1)].append(int(m.group(2)))
    partes = []
    for base, numeros in grupos.items():
        numeros = sorted(set(numeros))
        inicio = previo = numeros[0]
        for n in numeros[1:] + [None]:
            if n is not None and n == previo + 1:
                previo = n
                continue
            partes.append("%s%d" % (base, inicio) if inicio == previo
                          else "%s%d - %d" % (base, inicio, previo))
            if n is not None:
                inicio = previo = n
    return " , ".join(partes)


def _cabecera(puertos) -> str:
    if len(puertos) == 1:
        return "interface %s" % puertos[0]
    return "interface range %s" % rango(puertos)


def _vlans_bd(disp, vlans) -> list:
    # La VLAN 1 ya existe siempre y IOS no deja cambiarle el nombre.
    existentes = {n for n, _ in disp.vlans}
    return [Orden("vlan", ["vlan %d" % v.numero, " name %s" % v.nombre],
                  v.numero in existentes) for v in vlans if v.numero != 1]


def _troncal(disp, puerto):
    ic = _config(disp, puerto)
    if disp.es_multicapa and ic is not None and ic.ruteado:
        return None                    # puerto ruteado: no puede ser troncal
    lineas = ["interface %s" % puerto]
    if disp.es_multicapa:
        lineas.append(" switchport trunk encapsulation dot1q")
    lineas.append(" switchport mode trunk")
    return Orden("troncal", lineas, bool(ic and ic.modo == "trunk"))


def _canal(disp, puertos, grupo, modo) -> Orden:
    lineas = [_cabecera(puertos)]
    if disp.es_multicapa:
        lineas.append(" switchport trunk encapsulation dot1q")
    lineas += [" switchport mode trunk", " channel-group %d mode %s" % (grupo, modo)]
    presente = all((ic := _config(disp, p)) is not None and ic.canal for p in puertos)
    return Orden("canal", lineas, presente)


def _accesos(disp, pcs) -> list:
    por_vlan = defaultdict(list)
    for _, equipo, puerto, vlan, _ in pcs:
        if equipo == disp.nombre and vlan is not None:
            por_vlan[vlan].append(puerto)
    ordenes = []
    for vlan, puertos in sorted(por_vlan.items()):
        puertos = sorted(puertos, key=lambda p: [int(x) if x.isdigit() else x
                                                 for x in re.split(r"(\d+)", p)])
        presente = all((ic := _config(disp, p)) is not None and ic.acceso_vlan == vlan
                       for p in puertos)
        ordenes.append(Orden("acceso", [_cabecera(puertos),
                                        " switchport mode access",
                                        " switchport access vlan %d" % vlan], presente))
    return ordenes


def _generar(plan, equipos, cables):
    for sitio in plan.sitios:
        dueno = sitio.dueno
        en_canal = {(c.a, p) for c in sitio.canales for p in c.puertos_a} | \
                   {(c.b, p) for c in sitio.canales for p in c.puertos_b}
        troncales = defaultdict(list)
        for a, pa, b, pb in _cables_del_sitio(sitio, equipos, cables):
            for eq, puerto in ((a, pa), (b, pb)):
                if (eq, puerto) in en_canal:
                    continue
                if eq == dueno.nombre and not dueno.es_multicapa:
                    continue           # el lado del router son subinterfaces
                troncales[eq].append(puerto)

        # --- dueño ---------------------------------------------------------
        ordenes = []
        if dueno.es_multicapa:
            ordenes += _vlans_bd(dueno, sitio.vlans)
            for v in sitio.vlans:
                ic = _config(dueno, "Vlan%d" % v.numero)
                ordenes.append(Orden("svi", [
                    "interface Vlan%d" % v.numero,
                    " ip address %s %s" % (v.gateway, v.mascara),
                    " no shutdown"],
                    bool(ic and ic.ip == v.gateway and ic.mascara == v.mascara
                         and not ic.apagada)))
                ordenes.append(_pool(dueno, v))
        elif sitio.puerto_lan:
            ic = _config(dueno, sitio.puerto_lan)
            ordenes.append(Orden("puerto", ["interface %s" % sitio.puerto_lan,
                                            " no shutdown"],
                                 bool(ic and not ic.apagada)))
            for v in sitio.vlans:
                sub = "%s.%d" % (sitio.puerto_lan, v.numero)
                ic = _config(dueno, sub)
                ordenes.append(Orden("subinterfaz", [
                    "interface %s" % sub,
                    " encapsulation dot1Q %d" % v.numero,
                    " ip address %s %s" % (v.gateway, v.mascara)],
                    bool(ic and ic.vlan == v.numero and ic.ip == v.gateway
                         and ic.mascara == v.mascara)))
                ordenes.append(_pool(dueno, v))
        ordenes += _ordenes_de_switch(dueno, sitio, troncales, incluir_vlans=False)
        plan.ordenes[dueno.nombre] = ordenes

        # --- switches del sitio -------------------------------------------
        for nombre in sorted(sitio.switches, key=lambda n: (sitio.switches[n], n)):
            disp = equipos[nombre]
            plan.ordenes[nombre] = _ordenes_de_switch(disp, sitio, troncales)


def _cables_del_sitio(sitio, equipos, cables):
    miembros = set(sitio.switches) | {sitio.dueno.nombre}
    for a, pa, b, pb in cables:
        if a in miembros and b in miembros \
                and not equipos[a].es_host and not equipos[b].es_host:
            yield a, pa, b, pb


def _ordenes_de_switch(disp, sitio, troncales, incluir_vlans=True) -> list:
    ordenes = _vlans_bd(disp, sitio.vlans) if incluir_vlans else []
    if sitio.raiz == disp.nombre:
        numeros = sorted({1} | {v.numero for v in sitio.vlans})
        lista = ",".join(str(n) for n in numeros)
        presente = bool(disp.cfg) and all(
            disp.cfg.stp.get(n, 32768) <= PRIORIDAD_RAIZ for n in numeros)
        ordenes.append(Orden("stp", ["spanning-tree vlan %s priority %d"
                                     % (lista, PRIORIDAD_RAIZ)], presente))
    for puerto in sorted(troncales.get(disp.nombre, [])):
        orden = _troncal(disp, puerto)
        if orden is not None:
            ordenes.append(orden)
    for canal in sitio.canales:
        if canal.a == disp.nombre:
            ordenes.append(_canal(disp, canal.puertos_a, canal.grupo_a, canal.modo_a))
        if canal.b == disp.nombre:
            ordenes.append(_canal(disp, canal.puertos_b, canal.grupo_b, canal.modo_b))
    ordenes += _accesos(disp, sitio.pcs)
    return ordenes


def _pool(disp, vlan) -> Orden:
    presente = bool(disp.cfg) and any(
        p.red == vlan.direccion and p.mascara == vlan.mascara
        and p.gateway == vlan.gateway for p in disp.cfg.pools)
    return Orden("dhcp", ["ip dhcp pool VLAN%d" % vlan.numero,
                          " network %s %s" % (vlan.direccion, vlan.mascara),
                          " default-router %s" % vlan.gateway], presente)


def _aplicar_al_modelo(plan, anota):
    """Mete las puertas de enlace del plan en el modelo, para que el cálculo de
    rutas ya vea las redes de cada VLAN."""
    from .modelo import Interfaz, _insertar_interfaz

    for sitio in plan.sitios:
        dueno = sitio.dueno
        if not dueno.es_multicapa and not sitio.puerto_lan:
            continue
        for v in sitio.vlans:
            nombre = "Vlan%d" % v.numero if dueno.es_multicapa \
                else "%s.%d" % (sitio.puerto_lan, v.numero)
            actual = _interfaz(dueno, nombre)
            if actual is None:
                actual = Interfaz(nombre=nombre)
                _insertar_interfaz(dueno.interfaces, actual,
                                   None if dueno.es_multicapa else sitio.puerto_lan)
            elif actual.configurada and (actual.ip, actual.mascara) != \
                    (v.gateway, v.mascara):
                anota(AVISO, dueno.nombre,
                      "%s tiene %s %s, pero el plan pide %s %s"
                      % (nombre, actual.ip, actual.mascara, v.gateway, v.mascara))
            if (actual.ip, actual.mascara) != (v.gateway, v.mascara):
                actual.planeada = True
            actual.ip, actual.mascara = v.gateway, v.mascara
            actual.encendida, actual.vlan = True, str(v.numero)
