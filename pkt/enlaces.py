"""Los enlaces entre ruteadores: se configuran los que no tienen IP y se
corrigen los que la traen equivocada.

Cada cable entre dos equipos de capa 3 se revisa aquí:

* Sin IP en ningún lado: toma el /30 de la nota que tenga junto ('.4', '.8',
  como las que pones para numerar tus enlaces), o si no tiene nota, el primer
  /30 libre desde la .4 de tu red base. Así una práctica en blanco queda
  configurada sólo con sus notas. Entre dos cores hace falta la nota: sin
  ella el cable puede ser una troncal a propósito.
* Con un error que tiene una sola explicación (una IP que es de otro enlace,
  una máscara distinta a la del vecino, la misma IP en los dos extremos, un
  extremo sin IP, un puerto sin 'no shutdown'): se corrige. Cuando los dos
  lados son igual de sospechosos no se adivina: se dan las dos opciones.

Todo cambio se hace en el modelo -así el ruteo se calcula con la red ya
configurada- y el comando que lo hace va en los de ese equipo, con un
comentario que dice por qué.
"""

from __future__ import annotations

import ipaddress
import math
import re
from collections import Counter
from dataclasses import dataclass, field

from .plan import Orden, _interfaz, redes_de_notas
from .red import AVISO, ERROR, INFO, Hallazgo, clave_cable

# '.4', '.4/30', '16.0.0.4' o '16.0.0.4/30': la red /30 del cable de al lado.
_RE_NOTA_ENLACE = re.compile(r"(?:(\d{1,3}\.\d{1,3}\.\d{1,3})\.|\.)(\d{1,4})(?:\s*/\s*30)?")
# En tus prácticas la nota queda a menos de 130 px del centro de su cable.
_DISTANCIA_MAXIMA = 200


@dataclass
class Correcciones:
    ordenes: dict = field(default_factory=dict)      # equipo -> [Orden]
    hallazgos: list = field(default_factory=list)
    revisados: set = field(default_factory=set)      # cables ya explicados aquí

    @property
    def total(self) -> int:
        return sum(len(o) for o in self.ordenes.values())


def _red(ifaz):
    try:
        return ipaddress.IPv4Interface("%s/%s" % (ifaz.ip, ifaz.mascara)).network
    except ValueError:
        return None


def _natural(texto):
    """'R10' después de 'R2', como se lee."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", texto)]


def _orden(disp, vis):
    """Routers antes que cores y luego por nombre: al primero le toca la IP más
    baja del enlace, que es como numeras los tuyos (R1 .5 - R2 .6)."""
    return (disp.es_multicapa, _natural(vis[disp.nombre]))


def _lista(vis, equipos) -> str:
    nombres = sorted({vis[d.nombre] for d in equipos}, key=_natural)
    if len(nombres) == 1:
        return nombres[0]
    return "%s y %s" % (", ".join(nombres[:-1]), nombres[-1])


def _para_lan(disp, ifaz) -> bool:
    """Puerto que se dejó para la LAN aunque el cable vaya a otro equipo de
    capa 3: con subinterfaces, o en un multicapa como troncal, acceso o
    EtherChannel."""
    base = ifaz.nombre.lower() + "."
    if any(i.nombre.lower().startswith(base) for i in disp.interfaces):
        return True
    ic = disp.cfg.por_nombre(ifaz.nombre) if disp.cfg else None
    return bool(ic and not ic.ruteado and (ic.modo or ic.acceso_vlan or ic.canal))


def _cables(topo, vis) -> list:
    """(a, ia, b, ib) por cada cable entre dos equipos de capa 3, con `a` el
    que va primero por nombre."""
    salida = []
    for e in topo.enlaces:
        a, b = topo.por_nombre(e.a_dispositivo), topo.por_nombre(e.b_dispositivo)
        if a is None or b is None or not (a.es_ruteador and b.es_ruteador):
            continue
        ia, ib = _interfaz(a, e.a_puerto), _interfaz(b, e.b_puerto)
        if ia is None or ib is None:
            continue
        if _orden(b, vis) < _orden(a, vis):
            a, ia, b, ib = b, ib, a, ia
        salida.append((a, ia, b, ib))
    salida.sort(key=lambda t: (_orden(t[0], vis), _natural(t[1].nombre)))
    return salida


def _mascara_comun(cables):
    """La máscara de tus enlaces: la de los cables que ya cuadran."""
    cuenta = Counter(ia.mascara for _, ia, _, ib in cables
                     if ia.configurada and ib.configurada and _red(ia) == _red(ib))
    if not cuenta:
        cuenta = Counter(i.mascara for _, ia, _, ib in cables
                         for i in (ia, ib) if i.configurada)
    return cuenta.most_common(1)[0][0] if cuenta else None


def _con_ip(topo, ip, excepto=None) -> list:
    return [d for d in topo.dispositivos for i in d.interfaces_ip
            if i.ip == ip and i is not excepto]


def _dentro(topo, red, excepto) -> list:
    """Equipos con alguna interfaz dentro de `red`, sin contar `excepto`."""
    salida = []
    for d in topo.dispositivos:
        for i in d.interfaces_ip:
            if any(i is x for x in excepto):
                continue
            try:
                if ipaddress.IPv4Address(i.ip) in red:
                    salida.append(d)
            except ValueError:
                continue
    return salida


def _host_libre(topo, red, preferida=None, excepto=None):
    """Dirección utilizable de `red` que nadie más tenga. Primero se prueba la
    que ocupa el mismo lugar que `preferida` en su red: 12.0.0.30 (la .2 de su
    /30) pasa a ser la .2 de la red del vecino."""
    ocupadas = {i.ip for d in topo.dispositivos for i in d.interfaces_ip
                if i is not excepto}
    candidatas = []
    if preferida is not None:
        candidatas.append(red.network_address + (int(preferida) & int(red.hostmask)))
    for n, h in enumerate(red.hosts()):
        if n >= 1024:
            break
        candidatas.append(h)
    for h in candidatas:
        if h not in (red.network_address, red.broadcast_address) \
                and str(h) not in ocupadas:
            return str(h)
    return None


def _sospechas(topo, vis, vlans, comun, ifaz, vecina) -> list:
    """Motivos para pensar que `ifaz` es el extremo equivocado del cable."""
    motivos, red = [], _red(ifaz)
    duplicada = _con_ip(topo, ifaz.ip, ifaz)
    if duplicada:
        motivos.append("la IP %s ya es de %s" % (ifaz.ip, _lista(vis, duplicada)))
    ajenos = _dentro(topo, red, (ifaz, vecina))
    if ajenos:
        varios = len({d.nombre for d in ajenos}) > 1
        motivos.append("la red %s ya la usa%s %s"
                       % (red, "n" if varios else "", _lista(vis, ajenos)))
    if comun and ifaz.mascara != comun and vecina.mascara == comun:
        motivos.append("tus enlaces usan %s" % comun)
    for vlan, quien in vlans:
        if red.overlaps(vlan.red):
            motivos.append("%s cae en la VLAN %d de %s" % (red, vlan.numero, quien))
            break
    return motivos


# ==========================================================================
# Notas de enlace ('.4', '.8'...)
# ==========================================================================

@dataclass
class _NotaEnlace:
    x: float
    y: float
    prefijo: str | None      # '16.0.0' si la nota trae la dirección completa
    octeto: int
    texto: str


def _notas_de_enlace(topo) -> list:
    salida = []
    for n in getattr(topo, "notas", ()):
        texto = n.texto.strip()
        m = _RE_NOTA_ENLACE.fullmatch(texto)
        if m and n.x is not None:
            salida.append(_NotaEnlace(n.x, n.y, m.group(1), int(m.group(2)), texto))
    return salida


def _etiquetar(cables, notas) -> dict:
    """{índice del cable: nota}: cada nota va al cable cuyo centro le queda más
    cerca, sin repetir notas ni cables."""
    pares = []
    for k, nota in enumerate(notas):
        for j, (a, _, b, _) in enumerate(cables):
            if a.x is None or b.x is None:
                continue
            distancia = math.dist((nota.x, nota.y), ((a.x + b.x) / 2, (a.y + b.y) / 2))
            if distancia <= _DISTANCIA_MAXIMA:
                pares.append((distancia, k, j))
    asignadas, usadas = {}, set()
    for _, k, j in sorted(pares):
        if k not in usadas and j not in asignadas:
            asignadas[j] = notas[k]
            usadas.add(k)
    return asignadas


def _base_enlaces(cables, bases, notas):
    """Los tres primeros octetos de tus enlaces: los de los que ya tienen IP;
    en una práctica en blanco, los de las notas de enlace que traen la
    dirección completa ('12.0.0.4'), y si ninguna la trae, los de la red base
    de las notas de VLAN."""
    cuenta = Counter()
    for _, ia, _, ib in cables:
        for i in (ia, ib):
            red = _red(i) if i.configurada else None
            if red is not None and red.prefixlen == 30:
                cuenta[str(red.network_address).rsplit(".", 1)[0]] += 1
    if not cuenta:
        cuenta = Counter(n.prefijo for n in notas if n.prefijo)
    if not cuenta:
        cuenta = Counter(str(b).rsplit(".", 1)[0] for b in bases)
    return cuenta.most_common(1)[0][0] if cuenta else None


def _red_de_nota(nota, base):
    """El /30 que contiene la dirección de la nota: '.4' (la red) y '.5' o '.6'
    (un extremo) dicen lo mismo, porque hay prácticas con cada costumbre.
    None si la dirección no existe ('.256')."""
    prefijo = nota.prefijo or base
    if prefijo is None or nota.octeto > 255:
        return None
    try:
        return ipaddress.IPv4Network("%s.%d/30" % (prefijo, nota.octeto - nota.octeto % 4))
    except ValueError:
        return None


def _notas_confiables(cables, etiquetas, base) -> bool:
    """Las notas sirven si, en los enlaces que ya tienen IP, la mayoría dice el
    /30 de su cable. Si no, en esa práctica significan otra cosa (o se numeró
    distinto) y es mejor no usarlas. En una práctica en blanco no hay con qué
    compararlas y se usan."""
    bien = mal = 0
    for j, nota in etiquetas.items():
        _, ia, _, ib = cables[j]
        if ia.configurada and ib.configurada and _red(ia) == _red(ib):
            if _red_de_nota(nota, base) == _red(ia):
                bien += 1
            else:
                mal += 1
    return bien >= mal


def _ocupadas(topo, vlans) -> list:
    redes = [v.red for v, _ in vlans]
    for d in topo.dispositivos:
        for i in d.interfaces_ip:
            red = _red(i)
            if red is not None:
                redes.append(red)
    return redes


def _aplicar(c, disp, ifaz, ip, mascara, comentario, nota):
    """Cambia la interfaz en el modelo y deja en el equipo el comando que lo hace."""
    ifaz.correccion = nota
    ifaz.ip, ifaz.mascara, ifaz.encendida = ip, mascara, True
    lineas = ["! " + comentario, "interface %s" % ifaz.nombre]
    if disp.es_multicapa:
        lineas.append(" no switchport")
    lineas += [" ip address %s %s" % (ip, mascara), " no shutdown"]
    c.ordenes.setdefault(disp.nombre, []).append(Orden("enlace", lineas))


# ==========================================================================
# Casos
# ==========================================================================

def _dos_lados(topo, c, vis, vlans, comun, a, ia, b, ib):
    """Los dos extremos tienen IP pero en redes distintas."""
    ra, rb = _red(ia), _red(ib)
    if ra is None or rb is None:
        return
    if ra == rb:
        if ia.ip == ib.ip:
            _misma_ip(topo, c, vis, ra, a, ia, b, ib)
        return

    llave = clave_cable(a.nombre, ia.nombre, b.nombre, ib.nombre)
    sa = _sospechas(topo, vis, vlans, comun, ia, ib)
    sb = _sospechas(topo, vis, vlans, comun, ib, ia)
    if bool(sa) == bool(sb):
        opciones = []
        for dmal, imal, ibien in ((b, ib, ia), (a, ia, ib)):
            ip = _host_libre(topo, _red(ibien), ipaddress.IPv4Address(imal.ip), imal)
            if ip:
                opciones.append("%s%s en %s %s" % (
                    ip, "" if imal.mascara == ibien.mascara else " " + ibien.mascara,
                    vis[dmal.nombre], imal.nombre))
        c.revisados.add(llave)
        c.hallazgos.append(Hallazgo(ERROR, "red",
            "El enlace %s %s (%s/%d) - %s %s (%s/%d) une dos subredes distintas y "
            "no hay cómo saber qué lado está mal%s"
            % (vis[a.nombre], ia.nombre, ia.ip, ra.prefixlen,
               vis[b.nombre], ib.nombre, ib.ip, rb.prefixlen,
               ": pon " + ", o ".join(opciones) if opciones else "")))
        return

    mal, imal, bien, ibien = (a, ia, b, ib) if sa else (b, ib, a, ia)
    red = _red(ibien)
    nueva = _host_libre(topo, red, ipaddress.IPv4Address(imal.ip), imal)
    if nueva is None:
        return          # la red del vecino ya no tiene lugar: queda el error general
    c.revisados.add(llave)
    antes = "%s/%d" % (imal.ip, _red(imal).prefixlen)
    if nueva == imal.ip:
        que = "tiene la máscara %s y su vecino %s %s usa %s" % (
            imal.mascara, vis[bien.nombre], ibien.nombre, ibien.mascara)
    else:
        que = "tenía %s, pero su cable va a %s %s (%s/%d) y %s" % (
            antes, vis[bien.nombre], ibien.nombre, ibien.ip, red.prefixlen,
            "; ".join(sa or sb))
    c.hallazgos.append(Hallazgo(ERROR, mal.nombre,
        "%s %s: se corrige a %s %s (va en sus comandos por aplicar)"
        % (imal.nombre, que, nueva, ibien.mascara)))
    _aplicar(c, mal, imal, nueva, ibien.mascara,
             "corrige el enlace con %s (tenia %s)" % (vis[bien.nombre], antes),
             "corregida, tenía %s" % antes)


def _misma_ip(topo, c, vis, red, a, ia, b, ib):
    """Los dos extremos con la misma IP: al primero por nombre le toca la más
    baja del /30 y al otro la siguiente."""
    if red.prefixlen != 30:
        return
    primera, segunda = (str(h) for h in red.hosts())
    if ia.ip == primera:
        mal, imal, bien, ibien, nueva = b, ib, a, ia, segunda
    else:
        mal, imal, bien, ibien, nueva = a, ia, b, ib, primera
    if _con_ip(topo, nueva):
        return
    c.revisados.add(clave_cable(a.nombre, ia.nombre, b.nombre, ib.nombre))
    c.hallazgos.append(Hallazgo(ERROR, mal.nombre,
        "%s tiene la misma IP que su vecino %s %s (%s): se corrige a %s %s "
        "(va en sus comandos por aplicar)"
        % (imal.nombre, vis[bien.nombre], ibien.nombre, imal.ip, nueva, imal.mascara)))
    _aplicar(c, mal, imal, nueva, imal.mascara,
             "corrige el enlace con %s (tenia la misma IP %s)" % (vis[bien.nombre],
                                                                   imal.ip),
             "corregida, tenía %s (repetida)" % imal.ip)


def _un_lado(topo, c, vis, a, ia, b, ib):
    """Un extremo con IP y el otro sin nada: se completa el /30."""
    con, icon, sin, isin = (a, ia, b, ib) if ia.configurada else (b, ib, a, ia)
    red = _red(icon)
    if red is None or red.prefixlen != 30 or _para_lan(sin, isin):
        return
    otra = _host_libre(topo, red)
    if otra is None:
        return          # la otra dirección ya es de alguien: queda el aviso general
    c.revisados.add(clave_cable(a.nombre, ia.nombre, b.nombre, ib.nombre))
    c.hallazgos.append(Hallazgo(AVISO, sin.nombre,
        "%s no tenía IP y su cable va a %s %s (%s/30): se completa con %s %s "
        "(va en sus comandos por aplicar)"
        % (isin.nombre, vis[con.nombre], icon.nombre, icon.ip, otra, icon.mascara)))
    _aplicar(c, sin, isin, otra, icon.mascara,
             "faltaba la IP del enlace con %s" % vis[con.nombre],
             "completada por el programa")


def _siguiente_30(topo, vlans, base, reservadas):
    """El primer /30 libre de tus enlaces, desde la .4 de su red, sin pisar
    ninguna red ni los /30 que las notas apartan para otros cables. Sin base
    conocida, el que sigue al último enlace."""
    enlaces = [red for d in topo.ruteadores for i in d.interfaces_ip
               if not i.planeada and (red := _red(i)) is not None and red.prefixlen == 30]
    ocupadas = _ocupadas(topo, vlans) + list(reservadas)
    if base is not None:
        siguiente = int(ipaddress.IPv4Address(base + ".4"))
    elif enlaces:
        siguiente = int(max(enlaces).network_address) + 4
    else:
        return None
    for _ in range(1 << 16):
        if siguiente > 0xFFFFFFFC:
            return None
        candidata = ipaddress.IPv4Network((siguiente, 30))
        if not any(candidata.overlaps(o) for o in ocupadas):
            return candidata
        siguiente += 4
    return None


def _sin_ip(topo, c, vis, vlans, cable, nota, base, reservadas):
    """Cable entre routers sin IP en ningún lado: el /30 de su nota, o el
    primero libre de tus enlaces."""
    a, ia, b, ib = cable
    if (a.es_multicapa and b.es_multicapa and nota is None) or _para_lan(a, ia) \
            or _para_lan(b, ib):
        return          # entre dos cores, sin nota, puede ser una troncal a propósito
    c.revisados.add(clave_cable(a.nombre, ia.nombre, b.nombre, ib.nombre))
    texto = "%s %s - %s %s" % (vis[a.nombre], ia.nombre, vis[b.nombre], ib.nombre)

    red = _red_de_nota(nota, base) if nota is not None else None
    if nota is not None and red is None and nota.octeto <= 255 and base is None:
        c.hallazgos.append(Hallazgo(AVISO, "red",
            "el cable %s tiene la nota '%s', pero no se sabe en qué red van tus "
            "enlaces: escribe la dirección completa en una de sus notas ('12.0.0.4') "
            "o agrega las notas de VLAN con su red base" % (texto, nota.texto)))
        return
    if nota is not None and red is None:
        c.hallazgos.append(Hallazgo(AVISO, "red",
            "la nota '%s' junto al cable %s no es una dirección válida: se eligió "
            "otro /30" % (nota.texto, texto)))
    elif red is not None and any(red.overlaps(o) for o in _ocupadas(topo, vlans)):
        c.hallazgos.append(Hallazgo(AVISO, "red",
            "la nota '%s' junto al cable %s pide %s, que ya está ocupada: se eligió "
            "otro" % (nota.texto, texto, red)))
        red = None
    de_nota = red is not None
    if red is None:
        red = _siguiente_30(topo, vlans, base, reservadas)
    if red is None:
        c.hallazgos.append(Hallazgo(AVISO, "red",
            "el cable %s no tiene IP en ningún lado y no hay de dónde tomar la "
            "numeración: ponle junto al cable una nota con la dirección completa "
            "('12.0.0.4') o configúralo tú" % texto))
        return

    primera, segunda = (str(h) for h in red.hosts())
    quien = "%s .%s, %s .%s" % (vis[a.nombre], primera.rsplit(".", 1)[1],
                                vis[b.nombre], segunda.rsplit(".", 1)[1])
    if de_nota:
        c.hallazgos.append(Hallazgo(INFO, "red",
            "el cable %s toma %s de su nota '%s' (%s)" % (texto, red, nota.texto, quien)))
        comentario, origen = "enlace de la nota %s: %s" % (nota.texto, red), \
            "de la nota %s" % nota.texto
    else:
        c.hallazgos.append(Hallazgo(AVISO, "red",
            "el cable %s no tenía IP ni nota: se eligió %s, el primero libre de tus "
            "enlaces (%s). Si tu práctica pide otro, ponle su nota junto al cable o "
            "configúralo, y vuelve a abrir el archivo" % (texto, red, quien)))
        comentario, origen = "enlace sin IP: el programa eligio %s" % red, \
            "elegida por el programa"
    for disp, ifaz, ip in ((a, ia, primera), (b, ib, segunda)):
        _aplicar(c, disp, ifaz, ip, str(red.netmask), comentario, origen)


def _revisar_notas(c, vis, cables, etiquetas, base):
    """Un enlace que ya traía su IP contra la nota que tiene junto. Los que se
    configuraron o corrigieron aquí ya tienen su propio mensaje."""
    for j, nota in sorted(etiquetas.items()):
        a, ia, b, ib = cables[j]
        if clave_cable(a.nombre, ia.nombre, b.nombre, ib.nombre) in c.revisados:
            continue
        if not (ia.configurada and ib.configurada) or _red(ia) != _red(ib):
            continue
        red, esperada = _red(ia), _red_de_nota(nota, base)
        texto = "%s - %s" % (vis[a.nombre], vis[b.nombre])
        if esperada is None:
            c.hallazgos.append(Hallazgo(AVISO, "red",
                "la nota '%s' junto al enlace %s no es una dirección válida; el "
                "enlace tiene %s" % (nota.texto, texto, red)))
        elif esperada != red:
            c.hallazgos.append(Hallazgo(AVISO, "red",
                "la nota '%s' junto al enlace %s dice %s, pero el enlace tiene %s"
                % (nota.texto, texto, esperada, red)))


def _apagadas(topo, c):
    """Puertos con IP y cable, pero sin 'no shutdown'."""
    cableados = set()
    for e in topo.enlaces:
        cableados.add((e.a_dispositivo, e.a_puerto.lower()))
        cableados.add((e.b_dispositivo, e.b_puerto.lower()))
    for d in topo.ruteadores:
        for i in d.interfaces_ip:
            if i.encendida or i.planeada or (d.nombre, i.nombre.lower()) not in cableados:
                continue
            i.encendida = True
            c.ordenes.setdefault(d.nombre, []).append(
                Orden("enlace", ["interface %s" % i.nombre, " no shutdown"]))
            c.hallazgos.append(Hallazgo(AVISO, d.nombre,
                "%s tiene IP %s pero estaba apagada: se agrega 'no shutdown' a sus "
                "comandos" % (i.nombre, i.ip)))


def corregir(topo) -> Correcciones:
    """Se llama antes de armar el plan de VLANs: las redes de VLAN que se
    reparten después ya ven los enlaces y se acomodan alrededor."""
    c = Correcciones()
    vis = topo.nombres_visibles()
    cables = _cables(topo, vis)
    vlans, bases = redes_de_notas(topo)
    comun = _mascara_comun(cables)
    etiquetas = _etiquetar(cables, _notas_de_enlace(topo))
    base = _base_enlaces(cables, bases, etiquetas.values())
    if not _notas_confiables(cables, etiquetas, base):
        etiquetas = {}

    # Primero lo que ya tiene IP en los dos lados, luego lo que tiene uno y al
    # final lo que no tiene nada: así el /30 que se elija ya ve los arreglados.
    for a, ia, b, ib in cables:
        if ia.configurada and ib.configurada:
            _dos_lados(topo, c, vis, vlans, comun, a, ia, b, ib)
    for a, ia, b, ib in cables:
        if ia.configurada != ib.configurada:
            _un_lado(topo, c, vis, a, ia, b, ib)
    vacios = [j for j, (_, ia, _, ib) in enumerate(cables)
              if not ia.configurada and not ib.configurada]
    # Los /30 que las notas apartan no se le dan a otro cable.
    reservadas = {red for j in vacios if j in etiquetas
                  and (red := _red_de_nota(etiquetas[j], base)) is not None}
    for j in vacios:
        _sin_ip(topo, c, vis, vlans, cables[j], etiquetas.get(j), base, reservadas)
    _apagadas(topo, c)
    _revisar_notas(c, vis, cables, etiquetas, base)
    return c
