"""Genera el reporte de texto que se abre en el Bloc de notas.

Lo primero que aparece son los comandos, que es a lo que uno viene; el
inventario, las subredes y las comprobaciones quedan después, como respaldo.

Los equipos se nombran con el hostname que tú configuraste, no con la etiqueta
que Packet Tracer les pone en el lienzo (Router0, Multilayer Switch1, ...).
Cuando dos equipos comparten hostname se añade la etiqueta entre paréntesis
para poder distinguirlos.
"""

from __future__ import annotations

import datetime

from .red import ERROR, AVISO, INFO, verificar_ruteo

ANCHO = 78


def _titulo(texto, caracter="="):
    return [caracter * ANCHO, " " + texto, caracter * ANCHO, ""]


def _seccion(numero, texto):
    encabezado = "%d. %s" % (numero, texto)
    return ["", encabezado, "-" * len(encabezado), ""]


def _orden_equipo(disp):
    """Ruteadores primero, luego conmutadores y al final los equipos finales."""
    grupo = 0 if disp.es_ruteador else (2 if disp.es_host else 1)
    return (grupo, disp.nombre)


def nombres_visibles(topo) -> dict:
    """Etiqueta de Packet Tracer -> nombre que se muestra en el reporte."""
    return topo.nombres_visibles()


def _orden_ruteador(disp):
    """Primero los ruteadores y al final los conmutadores de núcleo, que es el
    orden en que conviene aplicar la configuración."""
    return (1 if disp.es_multicapa else 0, disp.hostname or disp.nombre)


def _equipos_con_salida(topo) -> list:
    """Ruteadores, luego los multicapa y al final los switches del plan de
    VLANs, sitio por sitio: el orden en que conviene configurarlos. Un switch
    que sólo necesita su hostname va al final."""
    equipos = sorted(topo.ruteadores, key=_orden_ruteador)
    por_nombre = {d.nombre: d for d in topo.dispositivos}
    plan = getattr(topo, "plan", None)
    if plan is not None:
        equipos += [por_nombre[n] for n in plan.switches_en_orden
                    if n in por_nombre]
    nombres = getattr(topo, "nombres", None)
    if nombres is not None:
        ya = {d.nombre for d in equipos}
        equipos += [por_nombre[n] for n in sorted(nombres.ordenes)
                    if n not in ya and n in por_nombre]
    return equipos


def _ordenes(topo, disp) -> list:
    """El hostname primero, luego los enlaces, de los que depende lo demás, y al
    final lo que pide el plan de VLANs."""
    salida = []
    for fuente in ("nombres", "correcciones", "plan"):
        origen = getattr(topo, fuente, None)
        if origen is not None:
            salida += origen.ordenes.get(disp.nombre, [])
    return salida


def _bloque(disp, nombre, ordenes, rutas_sel, ip_routing, extra=None) -> list:
    """Bloque de CLI pegable tal cual para un equipo."""
    lin = ["!" + "-" * 40, "! %s%s" % (nombre, "  (conmutador multicapa)"
                                       if disp.es_multicapa else "")]
    if extra:
        lin.append("! " + extra)
    lin.append("!" + "-" * 40)
    lin += ["enable", "configure terminal"]
    for orden in ordenes:
        if orden.tipo == "hostname":
            lin += orden.lineas
    if ip_routing:
        lin.append("ip routing")
    for orden in ordenes:
        if orden.tipo != "hostname":
            lin += orden.lineas
    for r in rutas_sel:
        lin.append("ip route %s %s %s" % (r.red, r.mascara, r.salto))
    lin += ["end", "write memory", ""]
    return lin


def _pendiente(topo, disp, rutas):
    """(órdenes de LAN, rutas, ip routing) que le faltan al equipo."""
    ordenes = [o for o in _ordenes(topo, disp) if not o.presente]
    faltan = [r for r in rutas.get(disp.nombre, []) if not r.ya_configurada]
    return ordenes, faltan, disp.es_multicapa and disp.ruteo_ip is not True


def pendientes(topo, rutas):
    """(rutas, grupos de comandos de LAN, puertos de enlace, hostnames) que
    quedan por aplicar."""
    n_rutas = n_lan = n_enlaces = n_nombres = 0
    for disp in _equipos_con_salida(topo):
        ordenes, faltan, _ = _pendiente(topo, disp, rutas)
        n_rutas += len(faltan)
        n_enlaces += sum(1 for o in ordenes if o.tipo == "enlace")
        n_nombres += sum(1 for o in ordenes if o.tipo == "hostname")
        n_lan += sum(1 for o in ordenes if o.tipo not in ("enlace", "hostname"))
    return n_rutas, n_lan, n_enlaces, n_nombres


def texto_pendientes(n_rutas, n_lan, n_enlaces=0, n_nombres=0) -> str:
    """'3 hostname(s), 4 puerto(s) de enlace, 20 ruta(s) y 9 grupo(s) de ...'"""
    partes = (["%d hostname(s)" % n_nombres] if n_nombres else []) + \
        (["%d puerto(s) de enlace" % n_enlaces] if n_enlaces else []) + \
        ["%d ruta(s)" % n_rutas, "%d grupo(s) de comandos de LAN" % n_lan]
    return ", ".join(partes[:-1]) + " y " + partes[-1]


def bloques_por_equipo(topo, rutas) -> list:
    """[(nombre, texto, tiene_pendientes)] para copiar equipo por equipo.

    Si al equipo le falta algo se copia sólo eso; si ya está completo se copia
    su configuración entera, que es lo útil para rehacerlo desde cero.
    """
    nombre = nombres_visibles(topo)
    salida = []
    for disp in _equipos_con_salida(topo):
        ordenes, faltan, ip_routing = _pendiente(topo, disp, rutas)
        if ordenes or faltan or ip_routing:
            lineas = _bloque(disp, nombre[disp.nombre], ordenes, faltan, ip_routing)
            pendiente = True
        else:
            todas_o = _ordenes(topo, disp)
            todas_r = rutas.get(disp.nombre, [])
            if not todas_o and not todas_r:
                continue
            lineas = _bloque(disp, nombre[disp.nombre], todas_o, todas_r,
                             disp.es_multicapa)
            pendiente = False
        salida.append((nombre[disp.nombre], "\n".join(lineas).rstrip() + "\n",
                       pendiente))
    return salida


_COMO = {
    "nombre": "la nota lo nombra",
    "configuración": "sus redes ya estaban configuradas ahí",
    "cercanía": "POR CERCANÍA: escribe el hostname en la nota para asegurarlo",
}

_AYUDA_PLAN = [
    "  No hay notas con VLANs en el lienzo. Para que el programa genere las",
    "  VLANs, el DHCP, las troncales, EtherChannel y la raíz de STP, pon una",
    "  nota (Place Note) junto a cada red con el hostname de su core o router,",
    "  su red base y la diagonal de cada VLAN:",
    "",
    "      R1 16.0.0.0",
    "      VLAN 2/17",
    "      VLAN 3/24",
    "",
    "  y a cada PC su VLAN en el nombre ('PC1 V3'). También sirve sólo la red",
    "  base ('R1 16.1.0.0/16', en partes iguales entre las VLANs de las PCs),",
    "  cuántos equipos lleva cada VLAN ('VLAN 3 500') o la red de cada una",
    "  ('VLAN 3 12.1.0.0/16'). La puerta de enlace es la última dirección",
    "  utilizable; para otra, agrega 'gw x.x.x.x'.",
]


def _seccion_plan(topo, nombre) -> list:
    from collections import defaultdict
    from .plan import rango

    lin = _seccion(3, "PLAN DE VLANs (de las notas del lienzo)")
    plan = getattr(topo, "plan", None)
    if plan is None or plan.vacio:
        return lin + _AYUDA_PLAN
    for sitio in plan.sitios:
        d = sitio.dueno
        donde = "SVI" if d.es_multicapa else \
            "subinterfaces en %s" % (sitio.puerto_lan or "?")
        lin.append("%s  (%s; %s)" % (nombre[d.nombre], donde, _COMO[sitio.como]))
        if sitio.bloque is not None:
            base = "red base %s" % sitio.bloque
            if sitio.inicio is not None:
                base = "red base %s (sin diagonal: desde ahí, dentro de %s)" % (
                    sitio.inicio, sitio.bloque)
            lin.append("  %s%s" % (base, ", repartida %s" % sitio.reparto
                                   if sitio.reparto else ""))
        # Cada VLAN como en tus notas: red - broadcast - máscara, y su gateway.
        for v in sitio.vlans:
            lin.append("  VLAN %-3d %-10s %s - %s - %s   gw %s"
                       % (v.numero, v.nombre, v.direccion, v.difusion, v.mascara,
                          v.gateway))
        if sitio.switches:
            lista = sorted(sitio.switches, key=lambda n: (sitio.switches[n], n))
            lin.append("  switches: %s" % ", ".join(
                nombre[n] + (" (raíz STP)" if n == sitio.raiz else "") for n in lista))
        for c in sitio.canales:
            lin.append("  EtherChannel: %s %s (%s)  <->  %s %s (%s)"
                       % (nombre[c.a], rango(c.puertos_a), c.modo_a,
                          nombre[c.b], rango(c.puertos_b), c.modo_b))
        por_vlan = defaultdict(list)
        for pc, _, _, vlan, _ in sitio.pcs:
            por_vlan[vlan].append(nombre.get(pc, pc))
        for vlan in sorted(por_vlan, key=lambda v: (v is None, v or 0)):
            etiqueta = "sin VLAN" if vlan is None else "VLAN %d" % vlan
            lin.append("  PCs %s: %s" % (etiqueta, ", ".join(sorted(por_vlan[vlan]))))
        lin.append("")
    return lin


def construir(nombre_archivo, formato, topo, subredes, rutas, inalcanzables,
              hallazgos) -> str:
    nombre = nombres_visibles(topo)
    ruteadores = sorted(topo.ruteadores, key=_orden_ruteador)
    trayectos, problemas = verificar_ruteo(topo, subredes, rutas)

    lin = []
    ahora = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
    lin += _titulo("CONFIGURACIÓN - %s" % nombre_archivo)
    lin.append("Generado:  %s   |   Formato: %s" % (ahora, formato))
    lin.append("Equipos:   %d   |   Ruteadores: %d   |   Subredes: %d"
               % (len(topo.dispositivos), len(topo.ruteadores), len(subredes)))
    if problemas:
        lin.append("")
        lin.append("¡ATENCIÓN! el ruteo calculado NO es consistente:")
        for p in problemas[:8]:
            lin.append("  - " + p)
    else:
        lin.append("Comprobación: los %d trayectos posibles llegan a su destino "
                   "sin bucles." % trayectos)

    equipos = _equipos_con_salida(topo)

    # ---- 1. Comandos por aplicar -------------------------------------------
    lin += _seccion(1, "COMANDOS POR APLICAR")
    if not equipos:
        lin.append("  (no se reconoció ningún ruteador)")
    else:
        for disp in equipos:
            ordenes, faltan, ip_routing = _pendiente(topo, disp, rutas)
            if ordenes or faltan or ip_routing:
                lin += _bloque(disp, nombre[disp.nombre], ordenes, faltan,
                               ip_routing)
                continue
            lin.append("!" + "-" * 40)
            lin.append("! %s" % nombre[disp.nombre])
            lin.append("!" + "-" * 40)
            todas = rutas.get(disp.nombre, [])
            # Sólo se nombra la ruta que cubre cuando es más amplia que el
            # destino; si cada una está puesta tal cual, el detalle sobra.
            amplias = sorted({r.cubierta_por for r in todas
                              if r.marca.startswith(" (por")})
            if not disp.es_ruteador:
                lin.append("! ya tiene todo lo que pide el plan de VLANs")
            elif not todas:
                lin.append("! nada pendiente: ya tiene conectadas todas las redes")
            elif amplias:
                lin.append("! nada pendiente: sus %d destino(s) los cubre %s"
                           % (len(todas), ", ".join(amplias)))
            else:
                lin.append("! nada pendiente: sus %d ruta(s) ya están puestas"
                           % len(todas))
            lin.append("")
        lin.append("! Por aplicar: %s" % texto_pendientes(*pendientes(topo, rutas)))

    # ---- 2. Configuración completa -----------------------------------------
    lin += _seccion(2, "CONFIGURACIÓN COMPLETA")
    if not equipos:
        lin.append("  (no hay ruteadores)")
    else:
        lin.append("  Todo lo de cada equipo, esté puesto o no, para aplicarlo")
        lin.append("  desde cero o cotejarlo con lo que ya tienes.")
        lin.append("")
        for disp in equipos:
            todas = rutas.get(disp.nombre, [])
            ordenes = _ordenes(topo, disp)
            if not todas and not ordenes and not disp.es_multicapa:
                lin += ["!" + "-" * 40, "! %s" % nombre[disp.nombre],
                        "!" + "-" * 40,
                        "! todas sus redes están conectadas directamente", ""]
                continue
            puestas = [r for r in todas if r.ya_configurada] + \
                      [o for o in ordenes if o.presente]
            extra = None
            if puestas:
                amplias = sorted({r.cubierta_por for r in todas if r.ya_configurada
                                  and r.marca.startswith(" (por")})
                extra = "%d de %d ya puestos%s" % (
                    len(puestas), len(todas) + len(ordenes),
                    "; %s cubre sus rutas" % ", ".join(amplias) if amplias else "")
            lin += _bloque(disp, nombre[disp.nombre], ordenes, todas,
                           disp.es_multicapa, extra)

    # ---- 3. Plan de VLANs --------------------------------------------------
    lin += _seccion_plan(topo, nombre)

    # ---- 3. Inventario -----------------------------------------------------
    cableados = set()
    for enlace in topo.enlaces:
        cableados.add((enlace.a_dispositivo, enlace.a_puerto))
        cableados.add((enlace.b_dispositivo, enlace.b_puerto))

    lin += _seccion(4, "INVENTARIO DE EQUIPOS")
    if topo.avisos_lectura:
        for aviso in topo.avisos_lectura:
            lin.append("  * " + aviso)
        lin.append("")
    if not topo.dispositivos:
        lin.append("  (ninguno)")
    for disp in sorted(topo.dispositivos, key=_orden_equipo):
        if disp.es_multicapa:
            papel = "conmutador multicapa (capa 3)"
        elif disp.es_ruteador:
            papel = "ruteador"
        elif disp.es_host:
            papel = "equipo final"
        else:
            papel = "conmutador / otro"
        partes = [x for x in (disp.tipo, disp.modelo) if x]
        descripcion = " ".join(dict.fromkeys(
            p for p in partes if not any(o is not p and p in o for o in partes)))
        lin.append("%-16s %s%s" % (nombre[disp.nombre], papel,
                                   (" - " + descripcion) if descripcion else ""))
        if disp.hostname and disp.hostname != disp.nombre:
            lin.append("%-16s   en el lienzo: %s" % ("", disp.nombre))
        if disp.gateway:
            lin.append("%-16s   puerta de enlace: %s" % ("", disp.gateway))
        if disp.vlans:
            lin.append("%-16s   VLANs: %s" % ("", ", ".join(
                "%d %s" % (n, v) for n, v in disp.vlans)))
        if disp.es_multicapa:
            lin.append("%-16s   ip routing: %s" % ("", {True: "habilitado",
                                                        False: "DESHABILITADO"}
                                                   .get(disp.ruteo_ip, "?")))
        if not disp.interfaces:
            lin.append("%-16s   (sin interfaces reconocidas)" % "")
        libres = 0
        for ifaz in disp.interfaces:
            # Un switch de 24 puertos no aporta nada listando los que no se
            # usan: sólo se detallan los que tienen IP o llevan cable.
            if not (ifaz.configurada or ifaz.dhcp
                    or (disp.nombre, ifaz.nombre) in cableados):
                libres += 1
                continue
            if ifaz.configurada:
                # Lo que no viene del archivo se señala: el inventario muestra
                # la red ya corregida y con las VLANs del plan.
                origen = ""
                if ifaz.correccion:
                    origen = "  <- " + ifaz.correccion
                elif ifaz.planeada:
                    origen = "  <- del plan de VLANs"
                lin.append("%-16s   %-22s %-15s %-15s %s%s"
                           % ("", ifaz.nombre, ifaz.ip, ifaz.mascara, ifaz.estado,
                              origen))
            else:
                lin.append("%-16s   %-22s %s" % ("", ifaz.nombre, ifaz.estado))
            if ifaz.ipv6:
                lin.append("%-16s   %-22s %s/%s"
                           % ("", "", ifaz.ipv6, ifaz.prefijo6 or "64"))
        if libres:
            lin.append("%-16s   (%d puerto(s) más sin usar)" % ("", libres))
        for pool in disp.pools:
            lin.append("%-16s   DHCP '%s': %s %s  gateway %s"
                       % ("", pool.nombre, pool.red or "?", pool.mascara or "",
                          pool.gateway or "sin default-router"))
        if disp.rutas_estaticas:
            lin.append("%-16s   %d ruta(s) estática(s) ya configurada(s)"
                       % ("", len(disp.rutas_estaticas)))
        lin.append("")

    # ---- 4. Subredes -------------------------------------------------------
    lin += _seccion(5, "SUBREDES DETECTADAS")
    if not subredes:
        lin.append("  No se detectó ninguna subred con direccionamiento IPv4.")
    else:
        lin.append("%-20s %-16s %s" % ("RED", "MÁSCARA", "INTERFACES EN LA SUBRED"))
        lin.append("-" * ANCHO)
        for sub in subredes:
            miembros = ", ".join("%s:%s" % (nombre[d.nombre], i.nombre)
                                 for d, i in sub.interfaces)
            lin.append("%-20s %-16s %s" % (sub.etiqueta, sub.mascara, miembros))

    # ---- 5. Comprobación ---------------------------------------------------
    lin += _seccion(6, "COMPROBACIÓN DE LA CONFIGURACIÓN")
    errores = [h for h in hallazgos if h.nivel == ERROR]
    avisos = [h for h in hallazgos if h.nivel == AVISO]
    if not hallazgos:
        lin.append("  Sin observaciones: la configuración se ve consistente.")
    else:
        lin.append("  %d error(es), %d aviso(s), %d nota(s) informativa(s)."
                   % (len(errores), len(avisos),
                      len([h for h in hallazgos if h.nivel == INFO])))
        lin.append("")
        for h in hallazgos:
            lin.append("  [%-5s] %-14s %s"
                       % (h.nivel, nombre.get(h.equipo, h.equipo), h.mensaje))

    if inalcanzables:
        lin.append("")
        lin.append("  Subredes sin camino desde el resto de la red:")
        for sub in inalcanzables:
            lin.append("    - %s" % sub.etiqueta)

    # ---- 6. Detalle del cálculo --------------------------------------------
    lin += _seccion(7, "DETALLE DEL RUTEO CALCULADO")
    if not ruteadores:
        lin.append("  No se reconoció ningún ruteador en la topología.")
    else:
        lin.append("  Cada red se resuelve por separado: se mide a qué distancia")
        lin.append("  queda desde cada equipo y cada uno reenvía al vecino que lo")
        lin.append("  acerca. SALTOS = ruteadores por atravesar. (ya) = la ruta ya")
        lin.append("  está puesta; (por X) = la cubre una ruta más amplia.")
        lin.append("")
        for router in ruteadores:
            propias = [s.etiqueta for s in subredes
                       if any(d.nombre == router.nombre for d, _ in s.interfaces)]
            lin.append("%s" % nombre[router.nombre])
            lin.append("  redes conectadas: %s" % (", ".join(propias) or "ninguna"))
            destino = rutas.get(router.nombre, [])
            if not destino:
                if len(propias) >= len(subredes):
                    lin.append("  no necesita rutas estáticas: ya tiene "
                               "conectadas todas las redes.")
                else:
                    lin.append("  NO SE LE CALCULARON RUTAS: no hay camino IP "
                               "hacia el resto de la red.")
                    lin.append("  Revisa la IP y el cable de su enlace de "
                               "subida; mientras siga aislado no se le puede")
                    lin.append("  calcular el siguiente salto de ninguna ruta.")
                lin.append("")
                continue
            lin.append("  %-16s %-16s %-16s %-21s %s"
                       % ("RED DESTINO", "MÁSCARA", "SIGUIENTE SALTO", "SALE POR",
                          "SALTOS"))
            for r in destino:
                lin.append("  %-16s %-16s %-16s %-21s %d%s"
                           % (r.red, r.mascara, r.salto, r.interfaz_salida,
                              r.saltos, r.marca))
            lin.append("")

    lin.append("")
    lin.append("=" * ANCHO)
    return "\r\n".join(lin) + "\r\n"
