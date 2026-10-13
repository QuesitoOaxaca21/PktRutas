"""Los comandos con el estilo de las prácticas.

En mayúsculas, abreviados, sin comentarios ni sangría, un renglón en blanco
entre interfaz e interfaz y '===' entre un equipo y el siguiente:

    EN
    CONF T
    HOSTNAME R2

    INT FA0/0
    IP ADD 12.0.0.6 255.255.255.252
    NO SHUT

Por dentro el programa trabaja con la forma completa de IOS ('interface
FastEthernet0/0', ' ip address ...'), que es también la que guarda Packet
Tracer en el running-config; aquí sólo cambia cómo se muestra. Lo que es un
nombre tuyo (el hostname, el nombre de una VLAN o de un pool) se deja tal
cual: pasarlo a mayúsculas renombraría el equipo.
"""

from __future__ import annotations

import re

SEPARADOR = "==="

# Comandos que se abrevian, como se teclean en las prácticas. El orden importa:
# 'interface range' antes que 'interface'.
_ABREVIADOS = (("enable", "EN"), ("configure terminal", "CONF T"),
               ("interface range", "INT RANGE"), ("interface", "INT"),
               ("no interface", "NO INT"), ("ip address", "IP ADD"),
               ("no ip address", "NO IP ADD"), ("no shutdown", "NO SHUT"))
_TIPOS = {"gigabitethernet": "GI", "fastethernet": "FA", "ethernet": "ETH",
          "serial": "SE", "port-channel": "PO", "loopback": "LO", "vlan": "VLAN "}
_RE_TIPO = re.compile(r"\b(%s)\s*(?=\d)" % "|".join(sorted(_TIPOS, key=len, reverse=True)),
                      re.IGNORECASE)
# Comandos cuyo argumento es un nombre tuyo y se respeta como está.
_CON_NOMBRE = ("hostname ", "name ", "ip dhcp pool ", "no ip dhcp pool ")


def interfaz(texto) -> str:
    """'FastEthernet0/2 - 4 , Ethernet0/1/0' -> 'FA0/2 - 4 , ETH0/1/0'."""
    return _RE_TIPO.sub(lambda m: _TIPOS[m.group(1).lower()], texto).upper()


def renglon(linea) -> str:
    """Un renglón de IOS con el estilo de las prácticas."""
    s = linea.strip()
    bajo = s.lower()
    for completo, corto in _ABREVIADOS:
        if bajo == completo or bajo.startswith(completo + " "):
            resto = s[len(completo):]
            return corto + (interfaz(resto) if "interface" in completo else resto.upper())
    for prefijo in _CON_NOMBRE:
        if bajo.startswith(prefijo):
            return prefijo.upper() + s[len(prefijo):]
    return s.upper()


def estilo(lineas) -> list:
    """Los renglones de IOS de un equipo, sin 'enable' ni 'configure terminal',
    como bloque para pegar: EN, CONF T, lo de alcance global junto, cada
    interfaz (o VLAN, o pool) en su párrafo, y nada de comentarios. Un
    comentario no sale, pero lo que sigue empieza párrafo."""
    ios = [l.rstrip() for l in lineas if l.strip()]
    salida = ["EN", "CONF T"]
    en_modo = corte = False
    for i, linea in enumerate(ios):
        if linea.lstrip().startswith("!"):
            corte = True
            continue
        sangria = linea.startswith(" ")
        siguiente = next((x for x in ios[i + 1:] if not x.lstrip().startswith("!")), "")
        abre = not sangria and siguiente.startswith(" ")
        if not sangria and (abre or en_modo or corte) and salida[-1] != "":
            salida.append("")
        corte = False
        salida.append(renglon(linea))
        en_modo = sangria or abre
    return salida


def unir(bloques) -> str:
    """Los bloques de cada equipo, separados por '==='."""
    return "".join(b.rstrip("\n") + "\n" + (SEPARADOR + "\n" if i < len(bloques) - 1 else "")
                   for i, b in enumerate(bloques))


def partir(texto) -> list:
    """Al revés que `unir`: [(primer renglón, último renglón, texto)] de cada
    bloque, con los renglones contados desde 1 como en el editor."""
    bloques, actual = [], []
    for numero, linea in enumerate(texto.split("\n") + [SEPARADOR], start=1):
        if linea.strip() == SEPARADOR:
            while actual and not actual[-1][1].strip():
                actual.pop()
            while actual and not actual[0][1].strip():
                actual.pop(0)
            if actual:
                bloques.append((actual[0][0], actual[-1][0],
                                "\n".join(l for _, l in actual)))
            actual = []
        else:
            actual.append((numero, linea))
    return bloques
