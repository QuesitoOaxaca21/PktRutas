"""Escribe un .pkt nuevo con la configuración que genera el programa ya puesta.

Packet Tracer guarda la configuración de cada equipo IOS como el texto de su
running-config (ENGINE/RUNNINGCONFIG, un <LINE> por renglón) y la vuelve a
aplicar al abrir el archivo: las rutas, los pools de DHCP, las SVI, las
subinterfaces, las troncales y el EtherChannel no existen en ningún otro lado
del XML. Aparte guarda el estado de cada puerto físico (POWER, IP, SUBNET) y
las VLANs de los switches, en ENGINE/VLANS y en el vlan.dat de su flash.

Aquí se deja cada cosa como quedaría después de pegar los comandos en la CLI
y hacer 'write memory', las PCs del plan en DHCP y con su nombre original
(sin la VLAN que se les puso para el programa, que en la copia ya vive en el
puerto del switch). Sólo se reescriben esos fragmentos del XML, con el
mismo formato que usa Packet Tracer; el resto del archivo queda byte por byte
igual. El cifrado es el mismo de Packet Tracer: al volver a cifrar un archivo
sin cambios sale idéntico al original.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import xml.parsers.expat
from collections import defaultdict
from xml.sax.saxutils import escape, quoteattr

from . import reporte
from .descifrar import cifrar_pkt, descifrar_pkt
from .modelo import clase_de, puertos_xml

# ==========================================================================
# Comandos por equipo
# ==========================================================================


def comandos(topo, disp, rutas) -> list:
    """Lo que le falta al equipo, como se pegaría después de 'configure
    terminal' (sin comentarios, 'end' ni 'write memory')."""
    ordenes, faltan, ip_routing = reporte._pendiente(topo, disp, rutas)
    lineas = ["ip routing"] if ip_routing else []
    for orden in ordenes:
        lineas += [l for l in orden.lineas if not l.startswith("!")]
    lineas += ["ip route %s %s %s" % (r.red, r.mascara, r.salto) for r in faltan]
    return lineas


def _expandir(rango) -> list:
    """'FastEthernet0/2 - 4 , FastEthernet0/7' -> los cuatro puertos."""
    puertos = []
    for parte in rango.split(","):
        parte = parte.strip()
        m = re.match(r"^(.*?)(\d+)\s*-\s*(\d+)$", parte)
        if m:
            puertos += ["%s%d" % (m.group(1), n)
                        for n in range(int(m.group(2)), int(m.group(3)) + 1)]
        elif parte:
            puertos.append(parte)
    return puertos


# ==========================================================================
# El running-config como texto
# ==========================================================================

# Orden en que IOS muestra los renglones de una interfaz: lo nuevo se mete en
# su lugar, así el resultado se ve como lo dejaría el propio IOS.
_RANGO = (("description", 0), ("no switchport", 1),
          ("switchport trunk encapsulation", 2), ("encapsulation", 2),
          ("mac-address", 3), ("switchport access vlan", 3), ("switchport mode", 4),
          ("ip address", 5), ("no ip address", 5), ("channel-group", 6))
# Renglones que se sustituyen en vez de sumarse: una interfaz tiene uno solo.
_UNICOS = (("ip address", "no ip address"), ("switchport mode",),
           ("switchport access vlan",), ("switchport trunk encapsulation",),
           ("channel-group",), ("encapsulation",))


def _rango(linea) -> int:
    s = linea.strip()
    for prefijo, rango in _RANGO:
        if s.startswith(prefijo):
            return rango
    return 9


def _clave(linea):
    s = linea.strip()
    for grupo in _UNICOS:
        if any(s.startswith(p) for p in grupo):
            return grupo
    return None


class RunningConfig:
    """Lista de renglones de 'show running-config' que se edita como lo haría
    IOS al recibir los comandos."""

    def __init__(self, lineas):
        # Los renglones se conservan tal cual (Packet Tracer deja un espacio al
        # final de algunos); las comparaciones se hacen sin él.
        self.l = [x.rstrip("\r\n") for x in lineas] or ["!", "end"]
        self.vlans = {}          # número -> nombre, para la base de VLANs
        self.tocadas = []        # interfaces que se modificaron
        self.nuevo_hostname = None

    # --- bloques -----------------------------------------------------------
    def _fin(self, inicio) -> int:
        fin = inicio + 1
        while fin < len(self.l) and self.l[fin].startswith(" "):
            fin += 1
        return fin

    def bloque(self, cabecera):
        objetivo = cabecera.lower()
        for i, x in enumerate(self.l):
            if x.rstrip().lower() == objetivo:
                return i, self._fin(i)
        return None

    def _interfaces(self) -> list:
        return [i for i, x in enumerate(self.l) if x.startswith("interface ")]

    def _tras(self, i) -> int:
        """Posición después del bloque que empieza en i y de su '!'."""
        fin = self._fin(i)
        return fin + 1 if fin < len(self.l) and self.l[fin] == "!" else fin

    def _antes_de(self, *prefijos) -> int:
        for i, x in enumerate(self.l):
            if any(x.startswith(p) for p in prefijos):
                return i
        return self._final()

    def _final(self) -> int:
        """Antes de 'line con 0' o de 'end'."""
        for i, x in enumerate(self.l):
            if x.startswith("line ") or x == "end":
                return i
        return len(self.l)

    def interfaz(self, nombre):
        cabecera = "interface " + nombre
        encontrado = self.bloque(cabecera)
        if encontrado:
            return encontrado
        bajo = nombre.lower()
        interfaces = self._interfaces()
        if bajo.startswith("port-channel"):
            pos = interfaces[0] if interfaces else self._final()
        elif "." in nombre:
            padre = nombre.split(".")[0].lower()
            hermanos = [i for i in interfaces
                        if self.l[i].lower().split(" ", 1)[1].split(".")[0] == padre]
            pos = self._tras(hermanos[-1]) if hermanos else \
                (self._tras(interfaces[-1]) if interfaces else self._final())
        elif bajo.startswith("vlan"):
            svis = [i for i in interfaces if self.l[i].lower().startswith("interface vlan")]
            ancla = svis[-1] if svis else (interfaces[-1] if interfaces else None)
            pos = self._tras(ancla) if ancla is not None else self._final()
        else:
            pos = self._tras(interfaces[-1]) if interfaces else self._final()
        self.l[pos:pos] = [cabecera, "!"]
        return pos, pos + 1

    def poner(self, nombre, renglon):
        """Un renglón dentro de 'interface <nombre>', con las reglas de IOS."""
        if nombre not in self.tocadas:
            self.tocadas.append(nombre)
        inicio, fin = self.interfaz(nombre)
        s = renglon.strip()
        if s == "no shutdown":
            self.l[inicio + 1:fin] = [x for x in self.l[inicio + 1:fin]
                                      if x.strip() != "shutdown"]
            return
        renglon = " " + s
        if any(x.strip() == s for x in self.l[inicio + 1:fin]):
            return
        clave = _clave(s)
        if clave:
            for i in range(inicio + 1, fin):
                if _clave(self.l[i]) == clave:
                    self.l[i] = renglon
                    return
        pos = fin
        for i in range(inicio + 1, fin):
            if _rango(self.l[i]) > _rango(renglon):
                pos = i
                break
        self.l.insert(pos, renglon)

    # --- globales ----------------------------------------------------------
    def hostname(self, nombre):
        self.nuevo_hostname = nombre
        for i, x in enumerate(self.l):
            if x.startswith("hostname "):
                self.l[i] = "hostname " + nombre
                return
        self.l.insert(min(1, len(self.l)), "hostname " + nombre)

    def ip_routing(self):
        self.l = [x for x in self.l if x.strip() != "no ip routing"]
        if not any(x.strip() == "ip routing" for x in self.l):
            pos = self._antes_de("spanning-tree", "interface ")
            self.l[pos:pos] = ["ip routing", "!"]

    def stp(self, linea):
        m = re.match(r"spanning-tree vlan (\S+) priority (\d+)", linea)
        nuevas = set(_numeros(m.group(1)))
        quedan = []
        for x in self.l:
            v = re.match(r"spanning-tree vlan (\S+) priority (\d+)$", x.strip())
            if v and v.group(2) == m.group(2) and set(_numeros(v.group(1))) <= nuevas:
                continue
            quedan.append(x)
        self.l = quedan
        for ancla in ("spanning-tree extend system-id", "spanning-tree mode"):
            for i, x in enumerate(self.l):
                if x.startswith(ancla):
                    self.l.insert(i + 1, linea)
                    return
        pos = self._antes_de("interface ")
        self.l[pos:pos] = [linea, "!"]

    def ruta(self, linea):
        partes = linea.split()
        if any(x.split() == partes for x in self.l):
            return
        rutas = [i for i, x in enumerate(self.l) if x.startswith("ip route ")]
        clasless = [i for i, x in enumerate(self.l) if x.strip() == "ip classless"]
        if rutas:
            pos = rutas[-1] + 1
        elif clasless:
            pos = clasless[0] + 1
        else:
            pos = self._antes_de("ip flow-export", "line ", "end")
            self.l[pos:pos] = ["ip classless", "!"]
            pos += 1
        self.l.insert(pos, linea + " ")      # Packet Tracer deja un espacio al final

    def pool(self, nombre, renglones):
        cabecera = "ip dhcp pool " + nombre
        encontrado = self.bloque(cabecera)
        if encontrado:
            inicio, fin = encontrado
            nuevos = [" " + r.strip() for r in renglones]
            claves = {r.split()[0] for r in nuevos}
            viejos = [x for x in self.l[inicio + 1:fin] if x.split()[0] not in claves]
            self.l[inicio + 1:fin] = nuevos + viejos
            return
        pools = [i for i, x in enumerate(self.l) if x.startswith("ip dhcp pool ")]
        bloque = [cabecera] + [" " + r.strip() for r in renglones]
        if pools:
            pos = self._fin(pools[-1])
            self.l[pos:pos] = bloque
        else:
            pos = self._antes_de("ip routing", "no ip cef", "ip cef", "no ipv6 cef",
                                 "license ", "spanning-tree", "interface ")
            self.l[pos:pos] = bloque + ["!"]

    def otra(self, linea):
        if not any(x.strip() == linea.strip() for x in self.l):
            pos = self._antes_de("interface ")
            self.l[pos:pos] = [linea, "!"]

    # --- aplicar una lista de comandos ---------------------------------------
    def aplicar(self, lineas):
        contexto, canales = None, {}
        for linea in lineas:
            if not linea.strip() or linea.startswith("!"):
                continue
            if linea.startswith(" "):
                if contexto is None:
                    continue
                tipo, valor = contexto[0], contexto[-1]
                if tipo == "interfaz":
                    for nombre in valor:
                        self.poner(nombre, linea)
                    m = re.match(r"\s*channel-group (\d+)", linea)
                    if m:
                        canales[int(m.group(1))] = valor[0]
                elif tipo == "pool":
                    valor.append(linea)
                elif tipo == "vlan" and linea.strip().startswith("name "):
                    self.vlans[valor] = linea.strip()[5:]
                continue
            if contexto and contexto[0] == "pool":
                self.pool(contexto[1], contexto[2])
            contexto = None
            if linea.startswith("interface range "):
                contexto = ("interfaz", _expandir(linea[len("interface range "):]))
            elif linea.startswith("interface "):
                contexto = ("interfaz", [linea.split(" ", 1)[1].strip()])
            elif linea.startswith("ip dhcp pool "):
                contexto = ("pool", linea.split()[3], [])
            elif re.match(r"vlan \d+$", linea):
                numero = int(linea.split()[1])
                self.vlans.setdefault(numero, "VLAN%04d" % numero)
                contexto = ("vlan", numero)
            elif linea.startswith("hostname "):
                self.hostname(linea.split(None, 1)[1].strip())
            elif linea == "ip routing":
                self.ip_routing()
            elif linea.startswith("spanning-tree vlan "):
                self.stp(linea)
            elif linea.startswith("ip route "):
                self.ruta(linea)
            else:
                self.otra(linea)
        if contexto and contexto[0] == "pool":
            self.pool(contexto[1], contexto[2])
        # Como IOS: el canal crea su Port-channel, con la configuración de
        # capa 2 de su primer puerto.
        for numero, miembro in sorted(canales.items()):
            po = "Port-channel%d" % numero
            if self.bloque("interface " + po):
                continue
            inicio, fin = self.bloque("interface " + miembro)
            for x in self.l[inicio + 1:fin]:
                if x.strip().startswith("switchport"):
                    self.poner(po, x)
            self.interfaz(po)
        return self

    def estado(self, nombre):
        """(encendida, ip, máscara) de una interfaz según el texto."""
        encontrado = self.bloque("interface " + nombre)
        if not encontrado:
            return None
        inicio, fin = encontrado
        cuerpo = [x.strip() for x in self.l[inicio + 1:fin]]
        ip = next((x.split()[2:4] for x in cuerpo if x.startswith("ip address ")), None)
        return "shutdown" not in cuerpo, ip


def _numeros(lista) -> list:
    salida = []
    for parte in lista.split(","):
        a, _, b = parte.partition("-")
        if a.isdigit():
            salida += list(range(int(a), int(b or a) + 1))
    return salida


# ==========================================================================
# El XML, por pedazos
# ==========================================================================

_INTERES = {"DEVICE", "RUNNINGCONFIG", "STARTUPCONFIG", "VLANS", "VLAN_COUNT",
            "POWER", "IP", "SUBNET", "PORT_DHCP_ENABLE", "NAME", "SYS_NAME"}


def _rangos(datos: bytes) -> dict:
    """Etiqueta -> [(inicio, fin)] en bytes, en orden de documento. Los da
    expat, que sí dice en qué byte empieza cada etiqueta."""
    rangos = defaultdict(list)
    pila = []
    p = xml.parsers.expat.ParserCreate()

    def abre(_tag, _attrs):
        pila.append(p.CurrentByteIndex)

    def cierra(tag):
        inicio = pila.pop()
        j = p.CurrentByteIndex
        if tag not in _INTERES:
            return
        if datos[j:j + 2] == b"</":
            fin = datos.index(b">", j) + 1
        else:                                      # <X/> autocerrada
            fin = datos.index(b">", inicio) + 1
        rangos[tag].append((inicio, fin))

    p.StartElementHandler = abre
    p.EndElementHandler = cierra
    p.Parse(datos, True)
    return rangos


class _Editor:
    def __init__(self, datos: bytes, raiz):
        self.xml = datos
        self.rangos = _rangos(datos)
        self.indice = {}
        for tag in _INTERES:
            elementos = list(raiz.iter(tag))
            if len(elementos) != len(self.rangos[tag]):
                raise ValueError("el XML no se pudo indexar (%s)" % tag)
            self.indice[tag] = {id(e): n for n, e in enumerate(elementos)}
        self.cambios = []

    def _sangria(self, inicio) -> str:
        """Los espacios antes de la etiqueta, para seguir la sangría del
        archivo (Packet Tracer usa un espacio por nivel)."""
        linea = self.xml.rfind(b"\n", 0, inicio) + 1
        antes = self.xml[linea:inicio]
        return antes.decode("ascii") if antes.strip() == b"" else ""

    def reemplazar(self, elemento, texto: str):
        n = self.indice[elemento.tag][id(elemento)]
        inicio, fin = self.rangos[elemento.tag][n]
        self.cambios.append((inicio, fin, texto.encode("utf-8")))

    def lineas(self, elemento, lineas):
        """RUNNINGCONFIG o STARTUPCONFIG con un <LINE> por renglón."""
        n = self.indice[elemento.tag][id(elemento)]
        inicio, _ = self.rangos[elemento.tag][n]
        sangria = self._sangria(inicio)
        cuerpo = "".join("%s <LINE>%s</LINE>\n" % (sangria, escape(l)) for l in lineas)
        self.reemplazar(elemento, "<%s>\n%s%s</%s>" % (elemento.tag, cuerpo, sangria,
                                                       elemento.tag))

    def valor(self, elemento, texto):
        """El mismo elemento, con sus atributos, y otro texto."""
        atributos = "".join(" %s=%s" % (k, quoteattr(v)) for k, v in elemento.attrib.items())
        self.reemplazar(elemento, "<%s%s>%s</%s>" % (elemento.tag, atributos,
                                                     escape(texto), elemento.tag))

    def vlans(self, elemento, vlans):
        n = self.indice["VLANS"][id(elemento)]
        inicio, _ = self.rangos["VLANS"][n]
        sangria = self._sangria(inicio)
        cuerpo = "".join('%s <VLAN name=%s number="%d" rspan="%s"/>\n'
                         % (sangria, quoteattr(nombre), numero, rspan)
                         for numero, (nombre, rspan) in sorted(vlans.items()))
        self.reemplazar(elemento, "<VLANS>\n%s%s</VLANS>" % (cuerpo, sangria))

    def resultado(self) -> bytes:
        datos = bytearray(self.xml)
        for inicio, fin, nuevo in sorted(self.cambios, reverse=True):
            datos[inicio:fin] = nuevo
        return bytes(datos)


# ==========================================================================
# Todo junto
# ==========================================================================

def nombre_original(nombre) -> str:
    """'PC1 V3' -> 'PC1', 'V4 PC2' -> 'PC2', 'PC7 VLAN5' -> 'PC7': el nombre
    sin la VLAN que se le puso para el programa."""
    from .plan import _RE_VLAN_PC

    m = _RE_VLAN_PC.search(nombre)
    if not m:
        return nombre
    limpio = nombre[:m.start()] + " " + nombre[m.end():]
    return re.sub(r"\s+", " ", limpio).strip(" -_#")


def _renombres(topo):
    """({nombre con VLAN: nombre original}, [PCs que no se pudieron renombrar]).

    Sólo las PCs cuya VLAN salió del nombre y quedó en su puerto de acceso: en
    la copia la VLAN ya vive en el switch. Si el nombre limpio ya lo usa otro
    equipo, se deja como está para no repetir nombres."""
    plan = getattr(topo, "plan", None)
    renombres, choques = {}, []
    ocupados = {d.nombre for d in topo.dispositivos}
    for sitio in (plan.sitios if plan is not None else []):
        numeros = {v.numero for v in sitio.vlans}
        for pc, _, _, vlan, fuente in sitio.pcs:
            if fuente != "nombre" or vlan not in numeros or pc in renombres:
                continue
            nuevo = nombre_original(pc)
            if not nuevo or nuevo == pc:
                continue
            if nuevo in ocupados or nuevo in renombres.values():
                choques.append(pc)
                continue
            renombres[pc] = nuevo
    return renombres, choques


def _dispositivos(raiz) -> dict:
    salida = {}
    for device in raiz.iter("DEVICE"):
        engine = device.find("ENGINE")
        if engine is not None and engine.findtext("NAME"):
            salida[engine.findtext("NAME")] = device
    return salida


def configurar(datos: bytes, topo, rutas):
    """(XML nuevo, resumen). No toca lo que ya está puesto."""
    raiz = ET.fromstring(datos)
    editor = _Editor(datos, raiz)
    dispositivos = _dispositivos(raiz)
    resumen = {"equipos": [], "comandos": 0, "pcs": 0}

    for disp in reporte._equipos_con_salida(topo):
        pendientes = comandos(topo, disp, rutas)
        device = dispositivos.get(disp.nombre)
        if not pendientes or device is None:
            continue
        engine = device.find("ENGINE")
        rc_el = engine.find("RUNNINGCONFIG")
        if rc_el is None:
            continue
        rc = RunningConfig([l.text or "" for l in rc_el]).aplicar(pendientes)
        editor.lineas(rc_el, rc.l)
        sc_el = engine.find("STARTUPCONFIG")
        if sc_el is not None:                     # como después de 'write memory'
            editor.lineas(sc_el, rc.l)
        # Packet Tracer también guarda el hostname aparte, en SYS_NAME.
        sys_name = engine.find("SYS_NAME")
        if rc.nuevo_hostname and sys_name is not None \
                and (sys_name.text or "") != rc.nuevo_hostname:
            editor.valor(sys_name, rc.nuevo_hostname)

        # Puertos físicos: encendido, IP y máscara, como los dejó el texto.
        puertos = dict((n.lower(), p) for n, p in puertos_xml(engine, clase_de(device)))
        for nombre in rc.tocadas:
            port = puertos.get(nombre.lower())
            estado = rc.estado(nombre)
            if port is None or estado is None:
                continue
            encendida, ip = estado
            nodo = port.find("POWER")
            if nodo is not None and (nodo.text or "") != ("true" if encendida else "false"):
                editor.valor(nodo, "true" if encendida else "false")
            if ip:
                for tag, texto in (("IP", ip[0]), ("SUBNET", ip[1])):
                    nodo = port.find(tag)
                    if nodo is not None and (nodo.text or "") != texto:
                        editor.valor(nodo, texto)

        # VLANs: la lista del equipo y cada copia del vlan.dat de su flash.
        if rc.vlans:
            for vl in engine.iter("VLANS"):
                actuales = {int(v.get("number")): (v.get("name"), v.get("rspan", "0"))
                            for v in vl if v.get("number", "").isdigit()}
                for numero, nombre in rc.vlans.items():
                    actuales[numero] = (nombre, actuales.get(numero, ("", "0"))[1])
                editor.vlans(vl, actuales)
            for contenido in engine.iter("FILE_CONTENT"):
                cuenta, vl = contenido.find("VLAN_COUNT"), contenido.find("VLANS")
                if cuenta is not None and vl is not None:
                    total = len({int(v.get("number")) for v in vl
                                 if v.get("number", "").isdigit()} | set(rc.vlans))
                    editor.valor(cuenta, str(total))

        resumen["equipos"].append(disp.nombre)
        resumen["comandos"] += len(pendientes)

    # PCs del plan en DHCP, para que tomen su dirección del pool de su VLAN.
    plan = getattr(topo, "plan", None)
    for sitio in (plan.sitios if plan is not None else []):
        for pc, _, _, vlan, _ in sitio.pcs:
            device = dispositivos.get(pc)
            if vlan is None or device is None:
                continue
            engine = device.find("ENGINE")
            for _, port in puertos_xml(engine, "host"):
                nodo = port.find("PORT_DHCP_ENABLE")
                if nodo is not None and (nodo.text or "").lower() != "true":
                    editor.valor(nodo, "true")
                    resumen["pcs"] += 1
                break

    # Las PCs recuperan su nombre, en el equipo y en la vista física.
    renombres, resumen["sin_renombrar"] = _renombres(topo)
    resumen["renombradas"] = 0
    if renombres:
        for nodo in raiz.iter("NAME"):
            if (nodo.text or "") in renombres:
                editor.valor(nodo, renombres[nodo.text])
        resumen["renombradas"] = len(renombres)

    return editor.resultado(), resumen


def _analizar(claro):
    from . import red
    from .modelo import leer_topologia

    topo = leer_topologia(claro)
    rutas, _ = red.calcular_rutas(topo, red.construir_subredes(topo))
    return topo, rutas


def escribir(ruta_origen, ruta_destino) -> dict:
    """Lee el .pkt (tal como está ahora en disco), escribe la copia configurada
    y la vuelve a leer para comprobarla. Nunca sobrescribe el original."""
    from pathlib import Path

    if Path(ruta_origen).resolve() == Path(ruta_destino).resolve():
        raise ValueError("el archivo configurado no puede sobrescribir el original")
    claro, _ = descifrar_pkt(Path(ruta_origen).read_bytes())
    topo, rutas = _analizar(claro)
    nuevo, resumen = configurar(claro, topo, rutas)
    datos = cifrar_pkt(nuevo)

    # Antes de guardar: que se descifre, que sea XML válido y que al leerlo
    # ya no le falte nada.
    vuelta, _ = descifrar_pkt(datos)
    if vuelta != nuevo:
        raise ValueError("el archivo cifrado no se pudo leer de vuelta")
    topo2, rutas2 = _analizar(vuelta)
    resumen["quedan"] = reporte.pendientes(topo2, rutas2)
    resumen["nombres"] = [topo.nombres_visibles()[n] for n in resumen["equipos"]]
    Path(ruta_destino).write_bytes(datos)
    return resumen
