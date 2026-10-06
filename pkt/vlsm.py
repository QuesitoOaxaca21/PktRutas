"""División de una red en segmentos.

Dos formas de dividir, que son las dos que se piden en las prácticas:

* **Por diagonal** (FLSM): todas las subredes del mismo tamaño, indicando el
  prefijo destino (/26) o cuántas subredes se quieren.
* **Por número de usuarios** (VLSM): a cada VLAN se le da el bloque más chico
  donde quepan sus hosts, empezando por la más grande para no dejar huecos.
"""

from __future__ import annotations

import ipaddress
import math
from dataclasses import dataclass


@dataclass
class Segmento:
    """Una subred ya asignada a una VLAN."""
    nombre: str
    vlan: int | None
    red: ipaddress.IPv4Network
    usuarios: int | None = None

    @property
    def mascara(self) -> str:
        return str(self.red.netmask)

    @property
    def prefijo(self) -> int:
        return self.red.prefixlen

    @property
    def wildcard(self) -> str:
        return str(self.red.hostmask)

    @property
    def capacidad(self) -> int:
        """Hosts utilizables."""
        return max(self.red.num_addresses - 2, 0)

    @property
    def direccion_red(self) -> str:
        return str(self.red.network_address)

    @property
    def broadcast(self) -> str:
        return str(self.red.broadcast_address)

    @property
    def primera(self) -> str:
        if self.capacidad == 0:
            return str(self.red.network_address)
        return str(self.red.network_address + 1)

    @property
    def ultima(self) -> str:
        if self.capacidad == 0:
            return str(self.red.broadcast_address)
        return str(self.red.broadcast_address - 1)

    @property
    def gateway(self) -> str:
        """Puerta de enlace: la primera utilizable, que es lo habitual."""
        return self.primera

    @property
    def rango(self) -> str:
        return "%s - %s" % (self.primera, self.ultima)

    @property
    def etiqueta(self) -> str:
        return "%s/%d" % (self.direccion_red, self.prefijo)


def prefijo_para_usuarios(usuarios: int) -> int:
    """Prefijo más chico donde caben `usuarios` hosts más red y broadcast."""
    if usuarios < 1:
        raise ValueError("el número de usuarios debe ser al menos 1")
    if usuarios > 2 ** 30:
        raise ValueError("demasiados usuarios para IPv4")
    prefijo = 30
    while prefijo > 0 and (2 ** (32 - prefijo) - 2) < usuarios:
        prefijo -= 1
    return prefijo


def prefijo_para_cantidad(base: ipaddress.IPv4Network, cantidad: int) -> int:
    """Prefijo necesario para partir `base` en al menos `cantidad` subredes."""
    if cantidad < 1:
        raise ValueError("se necesita al menos una subred")
    bits = math.ceil(math.log2(cantidad))
    prefijo = base.prefixlen + bits
    if prefijo > 30:
        raise ValueError("no se pueden sacar %d subredes utilizables de %s"
                         % (cantidad, base))
    return prefijo


def dividir_por_prefijo(base, peticiones, prefijo=None) -> list:
    """FLSM. `peticiones` es una lista de (vlan, nombre, usuarios)."""
    if not peticiones:
        return []
    if prefijo is None:
        prefijo = prefijo_para_cantidad(base, len(peticiones))
    if prefijo < base.prefixlen:
        raise ValueError("el prefijo /%d es más grande que la red base %s"
                         % (prefijo, base))
    bloques = list(base.subnets(new_prefix=prefijo))
    if len(peticiones) > len(bloques):
        raise ValueError("%s sólo da %d subredes /%d y se pidieron %d"
                         % (base, len(bloques), prefijo, len(peticiones)))
    segmentos = []
    for i, (vlan, nombre, usuarios) in enumerate(peticiones):
        seg = Segmento(nombre, vlan, bloques[i], usuarios)
        if usuarios and usuarios > seg.capacidad:
            raise ValueError("en %s (/%d) caben %d hosts y %s pide %d"
                             % (seg.etiqueta, prefijo, seg.capacidad, nombre,
                                usuarios))
        segmentos.append(seg)
    return segmentos


def dividir_por_usuarios(base, peticiones) -> list:
    """VLSM. Reparte de la VLAN más grande a la más chica y devuelve los
    segmentos en el mismo orden en que se capturaron."""
    if not peticiones:
        return []
    for vlan, nombre, usuarios in peticiones:
        if not usuarios:
            raise ValueError("falta el número de usuarios de %s"
                             % (nombre or "una VLAN"))

    orden = sorted(range(len(peticiones)), key=lambda i: -peticiones[i][2])
    resultado = [None] * len(peticiones)
    cursor = int(base.network_address)
    tope = int(base.broadcast_address)

    for i in orden:
        vlan, nombre, usuarios = peticiones[i]
        prefijo = prefijo_para_usuarios(usuarios)
        tamano = 2 ** (32 - prefijo)
        inicio = ((cursor + tamano - 1) // tamano) * tamano  # alinear el bloque
        red = ipaddress.IPv4Network((inicio, prefijo))
        if int(red.broadcast_address) > tope:
            raise ValueError(
                "no cabe %s (%d usuarios, necesita /%d) dentro de %s"
                % (nombre or "VLAN %s" % vlan, usuarios, prefijo, base))
        resultado[i] = Segmento(nombre, vlan, red, usuarios)
        cursor = int(red.broadcast_address) + 1

    return resultado


def espacio_libre(base, segmentos) -> list:
    """Bloques de `base` que no quedaron asignados."""
    if not segmentos:
        return [base]
    usados = sorted((s.red for s in segmentos), key=lambda r: int(r.network_address))
    libres, cursor = [], int(base.network_address)
    for red in usados:
        if int(red.network_address) > cursor:
            libres.extend(ipaddress.summarize_address_range(
                ipaddress.IPv4Address(cursor),
                ipaddress.IPv4Address(int(red.network_address) - 1)))
        cursor = max(cursor, int(red.broadcast_address) + 1)
    if cursor <= int(base.broadcast_address):
        libres.extend(ipaddress.summarize_address_range(
            ipaddress.IPv4Address(cursor), base.broadcast_address))
    return libres
