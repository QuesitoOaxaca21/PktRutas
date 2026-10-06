r"""Prueba de extremo a extremo con una topología sintética.

Construye un XML con la estructura que usa Packet Tracer, lo empaqueta como
un .pkt del formato moderno y ejecuta el análisis completo. Sirve para
verificar el lector, el cálculo de rutas y el reporte sin necesidad de tener
Packet Tracer instalado.

La topología es:

    PC0 PC1        PC2 Servidor          PC3
      \  /           \  /                 |
      SW1            SW2                 SW3
       |              |                   |
      R1 --10.0.0.0/30-- R2 --10.0.1.0/30-- R3
   192.168.1.0/24   192.168.2.0/24    192.168.3.0/24
       |
   10.0.2.0/30
       |
     CORE (3560, capa 3)  ---  Vlan10 192.168.10.0/24  -> PC4
                           \-  Vlan20 192.168.20.0/24  -> PC5

con errores deliberados: una IP duplicada, una puerta de enlace fuera de
rango, otra que no existe y una interfaz con IP pero apagada. El switch de
núcleo se declara con TYPE "Switch": solo el modelo revela que enruta.
"""

from __future__ import annotations

import struct
import subprocess
import sys
import zlib
from pathlib import Path

from pkt import descifrar as d

AQUI = Path(__file__).resolve().parent


def puerto(nombre, ip=None, mascara=None, encendido=True):
    partes = ["      <PORT>", "        <NAME>%s</NAME>" % nombre]
    if ip:
        partes.append("        <IP>%s</IP>" % ip)
        partes.append("        <SUBNET>%s</SUBNET>" % mascara)
    partes.append("        <POWER>%s</POWER>" % ("true" if encendido else "false"))
    partes.append("      </PORT>")
    return "\n".join(partes)


def equipo(nombre, tipo, modelo, puertos, gateway=None, rutas=()):
    partes = ["  <DEVICE>", "    <ENGINE>",
              "      <NAME>%s</NAME>" % nombre,
              '      <TYPE model="%s">%s</TYPE>' % (modelo, tipo)]
    if gateway:
        partes.append("      <GATEWAY>%s</GATEWAY>" % gateway)
    partes.extend(puertos)
    if rutas:
        partes.append("      <ROUTETABLE>")
        for red, mascara, salto in rutas:
            partes.append("        <STATICROUTE><NETWORK>%s</NETWORK>"
                          "<MASK>%s</MASK><NEXTHOP>%s</NEXTHOP></STATICROUTE>"
                          % (red, mascara, salto))
        partes.append("      </ROUTETABLE>")
    partes += ["    </ENGINE>", "  </DEVICE>"]
    return "\n".join(partes)


def cable(a, pa, b, pb):
    return ("  <LINK><CABLE><FROM>%s</FROM><PORT>%s</PORT>"
            "<TO>%s</TO><PORT>%s</PORT></CABLE></LINK>" % (a, pa, b, pb))


def construir_xml() -> bytes:
    equipos = [
        equipo("R1", "Router", "2911", [
            puerto("GigabitEthernet0/0", "192.168.1.1", "255.255.255.0"),
            puerto("GigabitEthernet0/1", "10.0.0.1", "255.255.255.252"),
            puerto("GigabitEthernet0/2", "10.0.2.2", "255.255.255.252"),
        ]),
        # Switch de núcleo: TYPE dice "Switch", sólo el modelo lo delata.
        equipo("CORE", "Switch", "3560-24PS", [
            puerto("Vlan10", "192.168.10.1", "255.255.255.0"),
            puerto("Vlan20", "192.168.20.1", "255.255.255.0"),
            puerto("GigabitEthernet0/1", "10.0.2.1", "255.255.255.252"),
            puerto("GigabitEthernet0/2"),
            puerto("GigabitEthernet0/3"),
        ]),
        equipo("R2", "Router", "2911", [
            puerto("GigabitEthernet0/0", "192.168.2.1", "255.255.255.0"),
            puerto("GigabitEthernet0/1", "10.0.0.2", "255.255.255.252"),
            puerto("Serial0/0/0", "10.0.1.1", "255.255.255.252"),
        ], rutas=[("192.168.1.0", "255.255.255.0", "10.0.0.1")]),
        # R3 resuelve todo con una ruta por omision: el analisis no debe
        # pedirle una ruta por cada red.
        equipo("R3", "Router", "2911", [
            puerto("Serial0/0/0", "10.0.1.2", "255.255.255.252"),
            puerto("GigabitEthernet0/0", "192.168.3.1", "255.255.255.0"),
            # Interfaz con IP pero apagada: debe salir como aviso.
            puerto("GigabitEthernet0/1", "172.16.0.1", "255.255.255.0", False),
        ], rutas=[("0.0.0.0", "0.0.0.0", "10.0.1.1")]),
        equipo("SW1", "Switch", "2960", [puerto("FastEthernet0/%d" % i)
                                         for i in range(1, 4)]),
        equipo("SW2", "Switch", "2960", [puerto("FastEthernet0/%d" % i)
                                         for i in range(1, 4)]),
        equipo("SW3", "Switch", "2960", [puerto("FastEthernet0/%d" % i)
                                         for i in range(1, 3)]),
        equipo("PC0", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.1.10", "255.255.255.0")],
               gateway="192.168.1.1"),
        # Puerta de enlace que no existe en la topología.
        equipo("PC1", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.1.11", "255.255.255.0")],
               gateway="192.168.1.254"),
        equipo("PC2", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.2.10", "255.255.255.0")],
               gateway="192.168.2.1"),
        # IP duplicada con PC2.
        equipo("Servidor0", "Server", "Server-PT",
               [puerto("FastEthernet0", "192.168.2.10", "255.255.255.0")],
               gateway="192.168.2.1"),
        # Puerta de enlace de otra subred.
        equipo("PC3", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.3.10", "255.255.255.0")],
               gateway="192.168.1.1"),
        equipo("PC4", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.10.10", "255.255.255.0")],
               gateway="192.168.10.1"),
        equipo("PC5", "PC", "PC-PT",
               [puerto("FastEthernet0", "192.168.20.10", "255.255.255.0")],
               gateway="192.168.20.1"),
    ]
    cables = [
        cable("R1", "GigabitEthernet0/0", "SW1", "FastEthernet0/1"),
        cable("PC0", "FastEthernet0", "SW1", "FastEthernet0/2"),
        cable("PC1", "FastEthernet0", "SW1", "FastEthernet0/3"),
        cable("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1"),
        cable("R2", "GigabitEthernet0/0", "SW2", "FastEthernet0/1"),
        cable("PC2", "FastEthernet0", "SW2", "FastEthernet0/2"),
        cable("Servidor0", "FastEthernet0", "SW2", "FastEthernet0/3"),
        cable("R2", "Serial0/0/0", "R3", "Serial0/0/0"),
        cable("R3", "GigabitEthernet0/0", "SW3", "FastEthernet0/1"),
        cable("PC3", "FastEthernet0", "SW3", "FastEthernet0/2"),
        cable("R1", "GigabitEthernet0/2", "CORE", "GigabitEthernet0/1"),
        cable("PC4", "FastEthernet0", "CORE", "GigabitEthernet0/2"),
        cable("PC5", "FastEthernet0", "CORE", "GigabitEthernet0/3"),
    ]
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<PACKETTRACER5>\n'
           "  <VERSION>9.0.1</VERSION>\n  <NETWORK>\n  <DEVICES>\n"
           + "\n".join(equipos)
           + "\n  </DEVICES>\n  <LINKS>\n" + "\n".join(cables)
           + "\n  </LINKS>\n  </NETWORK>\n</PACKETTRACER5>\n")
    return xml.encode("utf-8")


def empaquetar(xml: bytes) -> bytes:
    """Aplica el mismo formato que guarda Packet Tracer 9."""
    comprimido = struct.pack(">I", len(xml)) + zlib.compress(xml)
    etapa2 = d.desofuscar_2(comprimido)
    texto, tag = d.eax_cifrar(d._CLAVE, d._IV, etapa2)
    bruto = texto + tag
    n = len(bruto)
    patron = bytes(((n - i * n) & 0xFF) for i in range(256))
    return d._xor_grande(bruto, patron)[::-1]


def prueba_equipo_aislado():
    """Un equipo sin camino hacia el resto no debe salir como 'no necesita
    rutas': se le tienen que calcular cero rutas por estar aislado, y el
    reporte debe decirlo con todas sus letras."""
    from pkt import red as analisis
    from pkt import reporte
    from pkt.modelo import Dispositivo, Interfaz, Topologia

    topo = Topologia()
    solo = Dispositivo("SW-CORE", "MultiLayerSwitch", "3560-24PS")
    solo.interfaces = [Interfaz("Vlan10", "192.168.10.1", "255.255.255.0"),
                       Interfaz("Vlan20", "192.168.20.1", "255.255.255.0")]
    otro = Dispositivo("R1", "Router", "2911")
    otro.interfaces = [Interfaz("GigabitEthernet0/0", "10.0.0.1", "255.255.255.0")]
    topo.dispositivos = [solo, otro]

    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    hallazgos = analisis.revisar(topo, subredes, rutas)
    texto = reporte.construir("aislado", "prueba", topo, subredes, rutas,
                              inalcanzables, hallazgos)
    assert not rutas["SW-CORE"], "un equipo aislado no puede tener rutas"
    assert "NO SE LE CALCULARON RUTAS" in texto, \
        "el reporte debe explicar que el equipo quedo aislado"
    assert "no necesita rutas estáticas" not in texto, \
        "no debe decir que no necesita rutas cuando en realidad esta aislado"
    print("[ok] un equipo aislado se reporta como tal, no como 'sin rutas'")


def prueba_malla_cruzada():
    """Malla completa entre cuatro ruteadores, con las dos diagonales.

    Es el caso donde hay varios caminos del mismo costo y donde un cálculo
    hecho por separado desde cada origen puede acabar mandándose el tráfico de
    ida y vuelta. El ruteo generado tiene que llevar a todos los destinos sin
    un solo bucle.
    """
    from pkt import red as analisis
    from pkt.modelo import Dispositivo, Interfaz, Topologia

    topo = Topologia()
    equipos = {}
    for i, nombre in enumerate("ABCD"):
        disp = Dispositivo("R" + nombre, "Router", "2911")
        disp.interfaces = [Interfaz("GigabitEthernet0/0", "192.168.%d.1" % i,
                                    "255.255.255.0")]
        equipos[nombre] = disp
        topo.dispositivos.append(disp)
    enlaces = (("A", "B"), ("B", "C"), ("C", "D"), ("D", "A"),
               ("A", "C"), ("B", "D"))          # anillo + las dos diagonales
    for i, (a, b) in enumerate(enlaces):
        base = "10.0.%d." % i
        equipos[a].interfaces.append(
            Interfaz("Serial0/%d/0" % i, base + "1", "255.255.255.252"))
        equipos[b].interfaces.append(
            Interfaz("Serial0/%d/1" % i, base + "2", "255.255.255.252"))

    subredes = analisis.construir_subredes(topo)
    rutas, inalcanzables = analisis.calcular_rutas(topo, subredes)
    trayectos, problemas = analisis.verificar_ruteo(topo, subredes, rutas)
    assert not inalcanzables, "en una malla completa nada queda inalcanzable"
    # 4 LAN con 3 ruteadores ajenos + 6 enlaces con 2 ajenos = 24 trayectos.
    assert trayectos == 24, "se esperaban 24 trayectos, hubo %d" % trayectos
    assert not problemas, "la malla cruzada produjo rutas malas: %s" % problemas
    print("[ok] malla con enlaces cruzados: %d trayectos sin bucles" % trayectos)


def main():
    prueba_equipo_aislado()
    prueba_malla_cruzada()
    carpeta = AQUI / "ejemplo"
    carpeta.mkdir(exist_ok=True)
    destino = carpeta / "practica_demo.pkt"
    destino.write_bytes(empaquetar(construir_xml()))
    print("Archivo de prueba generado: %s" % destino)

    orden = [sys.executable, str(AQUI / "analizar.py"), str(destino), "--no-abrir"]
    codigo = subprocess.call(orden, cwd=str(AQUI))
    if codigo:
        return codigo

    texto = (carpeta / "practica_demo_ruteo.txt").read_text(encoding="utf-8-sig")
    detalle = texto[texto.index("7. DETALLE DEL RUTEO"):]
    bloque = detalle[detalle.index("\nR3\n"):]
    assert "(por 0.0.0.0/0)" in bloque, \
        "la ruta por omision de R3 deberia cubrir sus destinos"
    revision = texto[texto.index("6. COMPROBACIÓN"):texto.index("7. DETALLE")]
    assert "R3             le faltan" not in revision, \
        "no deberian pedirse rutas que la ruta por omision ya cubre"
    assert "llegan a su destino sin bucles" in texto, \
        "el reporte debe traer la comprobacion del ruteo generado"
    print("[ok] la ruta por omision se reconoce como cobertura")
    print()
    print((carpeta / "practica_demo_ruteo.txt").read_text(encoding="utf-8-sig"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
