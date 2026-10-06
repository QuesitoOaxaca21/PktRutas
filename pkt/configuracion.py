"""Lectura del running-config que Packet Tracer guarda dentro del .pkt.

Cada equipo con IOS lleva su configuración como texto, línea por línea, en
`ENGINE/.../RUNNINGCONFIG/LINE`. Es la fuente más fiel que hay en el archivo:
trae los nombres reales de las interfaces, las **subinterfaces** de VLAN con su
`encapsulation dot1Q`, las rutas estáticas, los pools de DHCP y las SVI, cosas
que el árbol de módulos no puede dar porque ahí sólo existen los puertos
físicos.

El analizador usa esto como fuente principal y deja la reconstrucción por
módulos para los puertos que la configuración no menciona.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

RE_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


@dataclass
class InterfazConfig:
    nombre: str
    ip: str | None = None
    mascara: str | None = None
    ipv6: str | None = None
    prefijo6: str | None = None
    apagada: bool = False
    vlan: int | None = None          # encapsulation dot1Q
    nativa: bool = False
    acceso_vlan: int | None = None   # switchport access vlan
    modo: str | None = None          # 'access' o 'trunk'
    descripcion: str = ""
    canal: int | None = None         # channel-group N
    modo_canal: str | None = None    # active, passive, on, desirable, auto
    encapsulacion: str | None = None # switchport trunk encapsulation dot1q
    ruteado: bool = False            # no switchport

    @property
    def es_subinterfaz(self) -> bool:
        return "." in self.nombre

    @property
    def padre(self):
        return self.nombre.split(".")[0] if self.es_subinterfaz else None


@dataclass
class PoolDHCP:
    nombre: str
    red: str | None = None
    mascara: str | None = None
    gateway: str | None = None
    dns: str | None = None


@dataclass
class Configuracion:
    hostname: str = ""
    interfaces: list = field(default_factory=list)
    rutas: list = field(default_factory=list)     # (red, mascara, salto)
    rutas6: list = field(default_factory=list)    # (red/prefijo, salto)
    ruteo_ip: bool | None = None
    ruteo_ipv6: bool = False
    pools: list = field(default_factory=list)
    vlans: list = field(default_factory=list)     # (numero, nombre)
    stp: dict = field(default_factory=dict)       # vlan -> prioridad

    def por_nombre(self, nombre):
        for i in self.interfaces:
            if i.nombre.lower() == (nombre or "").lower():
                return i
        return None


def _entero(texto):
    try:
        return int(texto)
    except (TypeError, ValueError):
        return None


def expandir_vlans(texto) -> list:
    """'1,3-5' -> [1, 3, 4, 5]"""
    salida = []
    for parte in (texto or "").split(","):
        inicio, _, fin = parte.strip().partition("-")
        a, b = _entero(inicio), _entero(fin) if fin else _entero(inicio)
        if a is not None and b is not None:
            salida.extend(range(a, b + 1))
    return salida


def analizar(lineas) -> Configuracion:
    """`lineas` es la lista de renglones del running-config."""
    cfg = Configuracion()
    interfaz = None
    pool = None
    vlan_actual = None

    for cruda in lineas:
        linea = (cruda or "").rstrip()
        if not linea.strip() or linea.strip() == "!":
            continue
        sangrada = linea.startswith(" ")
        partes = linea.split()
        clave = partes[0].lower()

        # --- bloques que terminan al llegar una línea sin sangría ---
        if not sangrada:
            interfaz = pool = vlan_actual = None

        if not sangrada:
            if clave == "hostname" and len(partes) > 1:
                cfg.hostname = partes[1]
            elif clave == "interface" and len(partes) > 1:
                interfaz = InterfazConfig(nombre=partes[1])
                cfg.interfaces.append(interfaz)
            elif clave == "vlan" and len(partes) > 1 and partes[1].isdigit():
                vlan_actual = int(partes[1])
                cfg.vlans.append((vlan_actual, ""))
            elif clave == "ip" and len(partes) >= 2:
                sub = partes[1].lower()
                if sub == "routing":
                    cfg.ruteo_ip = True
                elif sub == "route" and len(partes) >= 5 and RE_IP.match(partes[2]):
                    cfg.rutas.append((partes[2], partes[3], partes[4]))
                elif sub == "dhcp" and len(partes) >= 4 and partes[2].lower() == "pool":
                    pool = PoolDHCP(nombre=partes[3])
                    cfg.pools.append(pool)
            elif clave == "no" and len(partes) >= 3 and partes[1].lower() == "ip" \
                    and partes[2].lower() == "routing":
                cfg.ruteo_ip = False
            elif clave == "ipv6" and len(partes) >= 2:
                sub = partes[1].lower()
                if sub == "unicast-routing":
                    cfg.ruteo_ipv6 = True
                elif sub == "route" and len(partes) >= 4:
                    cfg.rutas6.append((partes[2], partes[3]))
            elif clave == "spanning-tree" and len(partes) >= 5 \
                    and partes[1].lower() == "vlan" and partes[3].lower() == "priority":
                for numero in expandir_vlans(partes[2]):
                    cfg.stp[numero] = _entero(partes[4])
            continue

        # --- líneas dentro de un bloque ---
        if interfaz is not None:
            _linea_de_interfaz(interfaz, partes)
        elif pool is not None:
            _linea_de_pool(pool, partes)
        elif vlan_actual is not None and clave == "name" and len(partes) > 1:
            cfg.vlans = [(n, " ".join(partes[1:]) if n == vlan_actual else v)
                         for n, v in cfg.vlans]

    return cfg


def _linea_de_interfaz(interfaz, partes):
    clave = partes[0].lower()
    if clave == "shutdown":
        interfaz.apagada = True
    elif clave == "no" and len(partes) > 1 and partes[1].lower() == "shutdown":
        interfaz.apagada = False
    elif clave == "no" and len(partes) > 1 and partes[1].lower() == "switchport":
        interfaz.ruteado = True
    elif clave == "channel-group" and len(partes) >= 2:
        interfaz.canal = _entero(partes[1])
        if len(partes) >= 4 and partes[2].lower() == "mode":
            interfaz.modo_canal = partes[3].lower()
    elif clave == "description":
        interfaz.descripcion = " ".join(partes[1:])
    elif clave == "encapsulation" and len(partes) >= 3:
        interfaz.vlan = _entero(partes[2])
        interfaz.nativa = len(partes) > 3 and partes[3].lower() == "native"
    elif clave == "ip" and len(partes) >= 4 and partes[1].lower() == "address":
        if RE_IP.match(partes[2]) and RE_IP.match(partes[3]):
            interfaz.ip, interfaz.mascara = partes[2], partes[3]
    elif clave == "ipv6" and len(partes) >= 3 and partes[1].lower() == "address":
        direccion, _, prefijo = partes[2].partition("/")
        if ":" in direccion:
            interfaz.ipv6, interfaz.prefijo6 = direccion, prefijo or None
    elif clave == "switchport" and len(partes) >= 2:
        if partes[1].lower() == "mode" and len(partes) > 2:
            interfaz.modo = partes[2].lower()
        elif partes[1].lower() == "trunk" and len(partes) >= 4 \
                and partes[2].lower() == "encapsulation":
            interfaz.encapsulacion = partes[3].lower()
        elif partes[1].lower() == "access" and len(partes) >= 4 \
                and partes[2].lower() == "vlan":
            interfaz.acceso_vlan = _entero(partes[3])
            interfaz.modo = interfaz.modo or "access"


def _linea_de_pool(pool, partes):
    clave = partes[0].lower()
    if clave == "network" and len(partes) >= 3:
        pool.red, pool.mascara = partes[1], partes[2]
    elif clave == "default-router" and len(partes) >= 2:
        pool.gateway = partes[1]
    elif clave == "dns-server" and len(partes) >= 2:
        pool.dns = partes[1]
