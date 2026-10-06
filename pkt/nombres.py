"""Hostnames a partir del nombre que cada equipo tiene en el lienzo.

En una práctica en blanco lo único que distingue a un router de otro es su
nombre en el lienzo (Display Name). Si se lo cambias de Router0 a R1 y el
equipo todavía tiene el hostname de fábrica, el programa le pone
'hostname R1': así las notas, el reporte y la CLI hablan del mismo equipo.
Un hostname que ya configuraste no se toca.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .plan import Orden
from .red import AVISO, Hallazgo

# Los nombres que Packet Tracer pone solo: Router0, Switch3(1), Multilayer Switch0.
_LIENZO_DE_FABRICA = re.compile(r"(Router|Switch|Multilayer Switch)\d+(\(\d+\))*")
_HOSTNAME_DE_FABRICA = {"", "router", "switch"}


@dataclass
class Nombres:
    ordenes: dict = field(default_factory=dict)      # equipo -> [Orden]
    hallazgos: list = field(default_factory=list)


def hostname_de(etiqueta):
    """El nombre del lienzo como hostname válido de IOS: letras, números y
    guiones, empezando con letra. None si no se puede."""
    limpio = re.sub(r"[^A-Za-z0-9-]+", "-", etiqueta.strip())
    limpio = re.sub(r"-{2,}", "-", limpio).strip("-")[:63].rstrip("-")
    return limpio if limpio and limpio[0].isalpha() else None


def generar(topo) -> Nombres:
    resultado = Nombres()
    for d in topo.dispositivos:
        if d.cfg is None or d.es_host or _LIENZO_DE_FABRICA.fullmatch(d.nombre):
            continue
        if (d.hostname or "").lower() not in _HOSTNAME_DE_FABRICA:
            continue                      # ya tiene uno puesto a mano
        nuevo = hostname_de(d.nombre)
        if nuevo is None:
            resultado.hallazgos.append(Hallazgo(
                AVISO, d.nombre, "su nombre en el lienzo no sirve como hostname (tiene "
                "que empezar con letra); configúralo a mano o cambia el nombre"))
            continue
        if nuevo == d.hostname:
            continue
        d.hostname = nuevo
        resultado.ordenes[d.nombre] = [Orden("hostname", ["hostname %s" % nuevo])]
    return resultado
