// El plan de VLANs que viene en las notas y la configuración de LAN que sale de
// él y del cableado. Es pkt/plan.py, más lo nuevo: cada VLAN puede traer sus
// 'combos' (lo que calculaste a mano en IPv4 e IPv6), que luego revisa combos.js.
//
//     R1
//     VLAN 2/22
//         11.0.4.0 - 11.0.7.254 - 255.255.252.0
//         ABCD:AB:AC:AD::4A0/126 - ABCD:AB:AC:AD::4A3/126

var _NOMBRES_VLAN = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
                     "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE",
                     "DIECIOCHO", "DIECINUEVE", "VEINTE"];
var _RE_VLAN = /\bVLAN\s*[-#:]?\s*(\d{1,4})\b/ig;
var _RE_IP_SUELTA = /\d{1,3}\.\d{1,3}/;
var _RE_VLAN_PC = /(?:^|[^a-z])v(?:lan)?[\s\-_#]*(\d{1,4})(?!\d)/i;
var _RE_V6 = /[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){1,8}(?:\s*\/\s*\d{1,3})?/g;
var _CLAVES_GW = ["gw", "gateway", "puerta", "default-router"];
var _IGNORAR = ["vlan", "red", "mascara", "máscara", "rango", "broadcast", "de", "a", "y", "net", "mask",
                "hosts", "usuarios", "enlace", "nombre", "name", "host", "usuario", "equipos", "pcs", "pc", "base"];
var PRIORIDAD_RAIZ = 4096;

function nombrePorOmision(numero) {
    return numero > 0 && numero < _NOMBRES_VLAN.length ? _NOMBRES_VLAN[numero] : "VLAN" + numero;
}

function _nuevaVlan(numero, red, nombre, gateway) {
    return { numero: numero, red: red, nombre: nombre, gateway: gateway, combo4: null, combo6: null,
             reservado: false, red6: null, gw6: null };
}

function _tamanoPedida(p) {
    if (p.prefijo !== null) { return p.prefijo; }
    if (p.usuarios) {
        for (var pre = 30; pre >= 1; pre--) {
            if (Math.pow(2, 32 - pre) - 2 >= p.usuarios) { return pre; }
        }
    }
    return null;
}

// `mal`: lo que el equipo ya trae y contradice a la nota. Un equipo así se borra y se vuelve a
// configurar; lo que sólo falta se agrega.
function _orden(tipo, lineas, presente, mal) { return { tipo: tipo, lineas: lineas, presente: !!presente, mal: mal || null }; }

// La diagonal que dicen a la vez el rango y la máscara de un combo; null si no se
// ponen de acuerdo. La segunda dirección puede ser la última utilizable o la difusión.
function _prefijoDeCombo(c) {
    if (!c || !c.ultima || !c.mascara || !esIp(c.red.txt) || !esIp(c.ultima.txt) || !esMascara(c.mascara.txt)) { return null; }
    var pre = prefijoDeMascara(c.mascara.txt);
    if (!(pre > 0 && pre <= 30)) { return null; }
    var t = tamanoRed(pre), a = ipAEntero(c.red.txt), d = ipAEntero(c.ultima.txt) - a;
    return a % t === 0 && (d === t - 2 || d === t - 1) ? pre : null;
}

// La subred exacta de un rango 'red - segunda dirección', o null.
function _rangoExacto(a, b) {
    var cuantos = [b - a + 1, b - a + 2];
    for (var i = 0; i < cuantos.length; i++) {
        var n = cuantos[i];
        if (n >= 2 && a % n === 0 && Math.pow(2, Math.round(Math.log(n) / Math.LN2)) === n) {
            return { n: a, p: 32 - Math.round(Math.log(n) / Math.LN2) };
        }
    }
    return null;
}

// --- Lectura de las notas -------------------------------------------------------------

function _tokens(texto, despl) {
    var re = /(\d{1,3}(?:\.+\d{1,3}){3})(?:\s*\/\s*(\d{1,2})(?![\d.]))?|\/\s*(\d{1,2})(?![\d.])|\.?(\d{1,3}(?:\.\d{1,3}){1,2})(?![\d.])|\.(\d{1,3})(?![\d.])|(\d{1,8})(?![\w.])|([A-Za-zÀ-ÿ][\wÀ-ÿ\-]*)/g;
    var salida = [], m;
    while ((m = re.exec(texto)) !== null) {
        var previo = m.index > 0 ? texto[m.index - 1] : "";
        var palabraOPunto = /[\w.]/.test(previo);
        var t = null;
        if (m[1] !== undefined) {
            t = { tipo: "ip", valor: m[1], pre: m[2] !== undefined ? +m[2] : null, ini: m.index, fin: m.index + m[1].length };
        } else if (m[3] !== undefined) {
            t = { tipo: "pre2", valor: +m[3], ini: m.index, fin: m.index + m[0].length };
        } else if (m[4] !== undefined) {
            if (!palabraOPunto) { t = { tipo: "abrev", valor: m[4], ini: m.index, fin: m.index + m[0].length }; }
        } else if (m[5] !== undefined) {
            if (!palabraOPunto) { t = { tipo: "octeto", valor: m[5], ini: m.index, fin: m.index + m[0].length }; }
        } else if (m[6] !== undefined) {
            if (!palabraOPunto && previo !== "/") { t = { tipo: "num", valor: m[6], ini: m.index, fin: m.index + m[0].length }; }
        } else if (m[7] !== undefined) {
            t = { tipo: "pal", valor: m[7], ini: m.index, fin: m.index + m[0].length };
        }
        if (t === null) {
            re.lastIndex = m.index + 1;
            continue;
        }
        t.ini += despl;
        t.fin += despl;
        salida.push(t);
    }
    return salida;
}

// Las direcciones IPv6 de un tramo: se quitan del texto (se cambian por espacios)
// para que las de IPv4 se lean igual que siempre.
function _sacarV6(texto, despl) {
    var seis = [], limpio = "", ultimo = 0, m;
    _RE_V6.lastIndex = 0;
    while ((m = _RE_V6.exec(texto)) !== null) {
        if (m[0].length === 0) { _RE_V6.lastIndex++; continue; }
        // Una hora o una palabra con ':' no es una dirección; hay que tener al menos dos ':'.
        if ((m[0].match(/:/g) || []).length < 2) { continue; }
        var previo = m.index > 0 ? texto[m.index - 1] : "";
        if (/[\w.]/.test(previo)) { continue; }
        var partes = m[0].split("/");
        var dir = partes[0].trim();
        seis.push({ txt: m[0], dir: dir, g: parse6(dir), pre: partes.length > 1 ? +partes[1].trim() : null,
                    ini: m.index + despl, fin: m.index + m[0].length + despl });
        limpio += texto.substring(ultimo, m.index) + " ".repeat(m[0].length);
        ultimo = m.index + m[0].length;
    }
    return { seis: seis, resto: limpio + texto.substring(ultimo) };
}

function _mascaraAbreviada(texto) {
    var o = texto.split(".");
    while (o.length < 4) { o.unshift("255"); }
    var completa = o.join(".");
    return esMascara(completa) ? completa : null;
}

function _completar(corta, base) {
    var o = corta.split(".");
    var faltan = 4 - o.length;
    if (base === null || faltan > base.length) { return null; }
    var completa = base.slice(0, faltan).concat(o).join(".");
    return esIp(completa) ? completa : null;
}

function _limpiarIp(t) { return t.replace(/\.+/g, "."); }

function _baseDe(topo) {
    var cuenta = [];
    topo.ruteadores.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            if (!i.planeada) { cuenta.push(i.ip.split(".").slice(0, 2).join(".")); }
        });
    });
    if (cuenta.length) { return masComun(cuenta).split("."); }
    // Práctica en blanco: los octetos de las direcciones completas de las notas.
    var escritas = [];
    topo.notas.forEach(function (n) {
        var m = n.texto.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [];
        m.forEach(function (ip) { if (esIp(ip) && ip.indexOf("255.") !== 0) { escritas.push(ip.split(".").slice(0, 2).join(".")); } });
    });
    return escritas.length ? masComun(escritas).split(".") : null;
}

function _bloqueDe(texto, avisos, base) {
    var redTxt = null, prefijo = null, mascara = null;
    _tokens(texto, 0).forEach(function (t) {
        if (t.tipo === "ip") {
            var limpia = _limpiarIp(t.valor);
            if (!esIp(limpia)) { return; }
            if (redTxt === null) { redTxt = limpia; prefijo = t.pre; }
            else if (mascara === null && esMascara(limpia)) { mascara = limpia; }
        } else if (t.tipo === "pre2" && redTxt !== null && prefijo === null) {
            prefijo = t.valor;
        } else if (t.tipo === "abrev") {
            if (redTxt === null) { redTxt = _completar(t.valor, base); }
            else if (mascara === null) { mascara = _mascaraAbreviada(t.valor); }
        } else if (t.tipo === "octeto" && redTxt !== null && mascara === null) {
            mascara = _mascaraAbreviada(t.valor);
        }
    });
    if (redTxt === null) { return { bloque: null, inicio: null }; }
    if (prefijo === null && mascara === null) {
        var clase = prefijoPorClase(redTxt);
        if (clase === null) { return { bloque: null, inicio: null }; }
        return { bloque: red4(redTxt, clase), inicio: ipAEntero(redTxt) };
    }
    var p = prefijo !== null ? prefijo : prefijoDeMascara(mascara);
    if (!(p >= 0 && p <= 32)) { return { bloque: null, inicio: null }; }
    var red = red4(redTxt, p);
    if (red.p > 29) { return { bloque: null, inicio: null }; }
    if (direccionDe(red) !== redTxt) {
        avisos.push("la red base " + redTxt + " no es dirección de red; se usó " + textoRed(red));
    }
    return { bloque: red, inicio: null };
}

// Lo nuevo: 'VLAN n/p' con su rango. Los campos van por posición, como los
// escribes: red, última utilizable y máscara.
function _combo4(toks, base) {
    var campos = toks.filter(function (t) { return t.tipo === "ip" || t.tipo === "abrev" || t.tipo === "octeto"; });
    if (!campos.length) { return null; }
    function completo(t) {
        if (t.tipo === "ip") { return _limpiarIp(t.valor); }
        if (t.tipo === "abrev") { return _completar(t.valor, base) || t.valor; }
        return t.valor;
    }
    function mascaraDeCampo(t) {
        if (t.tipo === "ip") { return _limpiarIp(t.valor); }
        return _mascaraAbreviada(t.valor) || t.valor;
    }
    var c = { red: { txt: completo(campos[0]), ini: campos[0].ini, fin: campos[0].fin }, ultima: null, mascara: null };
    var segundo = campos[1], tercero = campos[2];
    if (segundo && !tercero && (mascaraDeCampo(segundo).indexOf("255.") === 0 || esMascara(mascaraDeCampo(segundo)))) {
        c.mascara = { txt: mascaraDeCampo(segundo), ini: segundo.ini, fin: segundo.fin };
    } else if (segundo) {
        c.ultima = { txt: completo(segundo), ini: segundo.ini, fin: segundo.fin };
    }
    if (tercero) { c.mascara = { txt: mascaraDeCampo(tercero), ini: tercero.ini, fin: tercero.fin }; }
    return c;
}

function _combo6(seis) {
    if (!seis.length) { return null; }
    return { primera: seis[0], ultima: seis.length > 1 ? seis[1] : null };
}

function _interpretar(numero, cuerpo, despl, avisos, base) {
    var v6 = _sacarV6(cuerpo, despl);
    var toks = _tokens(v6.resto, despl);
    var combo6 = _combo6(v6.seis);
    var redTxt = null, prefijo = null, mascara = null, difusion = null, gateway = null, nombre = null, usuarios = null;
    var tamano = null, esperaGw = false, intento = false;

    // 'VLAN 2/22' con su rango escrito: lo revisa combos.js; la red sale del reparto.
    var primero = toks.filter(function (t) { return t.tipo !== "pal"; })[0];
    if (primero && primero.tipo === "pre2") {
        var campos4 = toks.filter(function (t) { return t.tipo === "ip" || t.tipo === "abrev"; });
        // Sólo la red ('VLAN 2/17 16.0.0.0') es la forma de antes: esa red se respeta.
        if (campos4.length >= 2 || (combo6 && !campos4.length)) {
            toks.forEach(function (t) {
                if (t.tipo === "pal" && nombre === null && _IGNORAR.indexOf(t.valor.toLowerCase()) < 0) {
                    nombre = t.valor.toUpperCase();
                }
            });
            // Si el rango y la máscara coinciden entre sí y no con el título, el que se
            // equivocó es el título. Tomarle la palabra movería a todas las redes de después.
            var combo4 = _combo4(toks, base);
            var deCombo = _prefijoDeCombo(combo4), diagonal = primero.valor;
            if (deCombo !== null && deCombo !== diagonal) {
                combo4.diagonal = { txt: "/" + diagonal, ini: primero.ini, fin: primero.fin, real: deCombo };
                diagonal = deCombo;
            }
            if (!(diagonal > 0 && diagonal <= 30)) {
                avisos.push("VLAN " + numero + ": /" + diagonal + " no deja direcciones para equipos");
                return null;
            }
            return { pedida: true, numero: numero, nombre: nombre, usuarios: null, prefijo: diagonal,
                     combo4: combo4, combo6: combo6 };
        }
    }

    toks.forEach(function (t) {
        if (t.tipo === "pal") {
            var baja = t.valor.toLowerCase();
            if (_CLAVES_GW.indexOf(baja) >= 0) { esperaGw = true; }
            else if (nombre === null && _IGNORAR.indexOf(baja) < 0) { nombre = t.valor.toUpperCase(); }
            return;
        }
        if (t.tipo === "num") {
            if (usuarios === null && +t.valor > 0) { usuarios = +t.valor; }
            return;
        }
        if (t.tipo === "pre2") {
            if (redTxt !== null && prefijo === null) { prefijo = t.valor; }
            else if (redTxt === null && tamano === null) { tamano = t.valor; }
            return;
        }
        if (t.tipo === "octeto") {
            if (redTxt !== null && mascara === null) { mascara = _mascaraAbreviada(t.valor); }
            return;
        }
        if (t.tipo === "abrev") {
            var corta = t.valor, comoMascara = _mascaraAbreviada(corta);
            if (redTxt === null) {
                redTxt = _completar(corta, base);
                intento = true;
                if (redTxt === null) {
                    avisos.push("VLAN " + numero + ": no se pudo completar la dirección '" + corta + "'");
                }
            } else if (comoMascara && mascara === null) {
                mascara = comoMascara;
            } else if (difusion === null && prefijo === null && mascara === null) {
                difusion = _completar(corta, base);
            } else {
                avisos.push("VLAN " + numero + ": '" + corta + "' no es una máscara válida");
            }
            return;
        }
        var limpia = _limpiarIp(t.valor);
        if (limpia !== t.valor) {
            avisos.push("VLAN " + numero + ": se leyó '" + t.valor + "' como " + limpia);
        }
        if (!esIp(limpia)) { return; }
        if (esperaGw) {
            gateway = limpia;
            esperaGw = false;
        } else if (redTxt === null && tamano === null && limpia.indexOf("255.") === 0 && esMascara(limpia)) {
            tamano = prefijoDeMascara(limpia);
        } else if (redTxt === null) {
            redTxt = limpia;
            if (t.pre !== null) { prefijo = t.pre; }
        } else if (mascara === null && esMascara(limpia)) {
            mascara = limpia;
        } else if (difusion === null && prefijo === null) {
            difusion = limpia;
        } else {
            avisos.push("VLAN " + numero + ": se ignoró " + limpia);
        }
    });

    if (redTxt === null) {
        if (intento) { return null; }
        if (tamano !== null && !(tamano > 0 && tamano <= 30)) {
            avisos.push("VLAN " + numero + ": /" + tamano + " no deja direcciones para equipos");
            return null;
        }
        return { pedida: true, numero: numero, nombre: nombre, usuarios: usuarios, prefijo: tamano,
                 combo4: null, combo6: combo6 };
    }
    if (tamano !== null && prefijo === null && mascara === null && difusion === null) { prefijo = tamano; }

    var porPrefijo = null, porRango = null, porMascara = null;
    if (prefijo !== null && prefijo >= 0 && prefijo <= 32) { porPrefijo = red4(redTxt, prefijo); }
    if (mascara) { porMascara = redDe(redTxt, mascara); }
    if (difusion) {
        porRango = _rangoExacto(ipAEntero(redTxt), ipAEntero(difusion));
        if (porRango === null) { avisos.push("VLAN " + numero + ": el rango " + redTxt + " - " + difusion + " no es una subred exacta"); }
    }
    var red = porPrefijo || porRango || porMascara;
    if (red === null && nombre !== null) {
        red = red4(redTxt, 24);
        avisos.push("VLAN " + numero + ": no trae máscara ni diagonal, se supuso /24");
    }
    if (red === null) {
        avisos.push("VLAN " + numero + ": falta la máscara o la diagonal");
        return null;
    }
    if (porMascara !== null && !mismaRed(porMascara, red)) {
        avisos.push("VLAN " + numero + ": la máscara " + mascara + " no cuadra con " + textoRed(red) + "; se usó /" + red.p);
    }
    if (porRango !== null && !mismaRed(porRango, red)) {
        avisos.push("VLAN " + numero + ": el rango " + redTxt + " - " + difusion + " no cuadra con " + textoRed(red) + "; se usó " + textoRed(red));
    }
    if (direccionDe(red) !== redTxt) {
        avisos.push("VLAN " + numero + ": " + redTxt + " no es dirección de red; se usó " + textoRed(red));
    }
    if (red.p > 30) {
        avisos.push("VLAN " + numero + ": " + textoRed(red) + " no deja direcciones para equipos");
        return null;
    }
    if (usuarios && usuarios > tamanoRed(red.p) - 2) {
        avisos.push("VLAN " + numero + ": en " + textoRed(red) + " caben " + (tamanoRed(red.p) - 2) + " equipos y la nota pide " + usuarios);
    }
    if (gateway) {
        if (!contiene(red, gateway) || gateway === direccionDe(red) || gateway === difusionDe(red)) {
            avisos.push("VLAN " + numero + ": la puerta de enlace " + gateway + " no es utilizable en " + textoRed(red));
            gateway = null;
        }
    }
    var v = _nuevaVlan(numero, red, nombre || nombrePorOmision(numero), gateway || ultimaDe(red));
    v.combo6 = combo6;
    return v;
}

// (equipo | null, inicio, fin): una línea con el nombre de un equipo abre un tramo,
// así una nota puede hablar de varios sitios. `despl` es la posición en la nota.
function _partirNota(texto, nombres) {
    var ordenados = Object.keys(nombres).sort(function (a, b) { return b.length - a.length; });
    var tramos = [{ equipo: null, ini: 0, fin: 0, declarado: null, algoAntes: false }];
    var pos = 0;
    texto.split("\n").forEach(function (linea) {
        var baja = linea.trim().toLowerCase();
        var hallado = null;
        for (var i = 0; i < ordenados.length; i++) {
            var n = ordenados[i];
            if (baja === n || baja.replace(/:+$/, "").trim() === n || baja.indexOf(n + ":") === 0 || baja.indexOf(n + " ") === 0) {
                hallado = n;
                break;
            }
        }
        var actual = tramos[tramos.length - 1];
        if (hallado === null) {
            // Lo primero de la nota, si no es un equipo que exista todavía, es el
            // nombre que debe llevar: 'R1' en un router que sigue llamándose Router0.
            var md = /^\s*([A-Za-z][\w\-]*):?(?:\s+(?=[\d.]))?\s*/.exec(linea);
            if (!actual.algoAntes && baja && md && md[1] && !/^vlan\d*$/i.test(md[1]) && _IGNORAR.indexOf(md[1].toLowerCase()) < 0
                && (md[0].length === linea.length || /^\s*[\d.]/.test(linea.substring(md[0].length)))) {
                actual.declarado = md[1];
                actual.despDeclarado = pos + md[0].length;
            }
            if (baja) { actual.algoAntes = true; }
            actual.fin = pos + linea.length;
        } else {
            var cab = linea.indexOf(linea.trim());
            var r = cab + hallado.length;
            while (r < linea.length && (linea[r] === " " || linea[r] === ":")) { r++; }
            tramos.push({ equipo: nombres[hallado], ini: pos + r, fin: pos + linea.length, declarado: null, algoAntes: true });
        }
        pos += linea.length + 1;
    });
    var salida = [];
    tramos.forEach(function (t) {
        var ini = t.declarado !== null && t.despDeclarado !== undefined ? t.despDeclarado : t.ini;
        var trozo = texto.substring(ini, t.fin);
        _RE_VLAN.lastIndex = 0;
        if (_RE_VLAN.test(trozo) || (t.equipo !== null && _RE_IP_SUELTA.test(trozo))
            || (t.declarado !== null && _RE_IP_SUELTA.test(trozo))) {
            salida.push({ equipo: t.equipo, declarado: t.declarado, ini: ini, texto: trozo });
        }
    });
    return salida;
}

function _leerTramo(tramo, avisos, base) {
    var vlans = [], pedidas = [], marcas = [], m;
    _RE_VLAN.lastIndex = 0;
    while ((m = _RE_VLAN.exec(tramo.texto)) !== null) { marcas.push({ ini: m.index, fin: m.index + m[0].length, numero: +m[1] }); }
    var antes = marcas.length ? tramo.texto.substring(0, marcas[0].ini) : tramo.texto;
    var bb = _bloqueDe(antes, avisos, base);
    marcas.forEach(function (mc, i) {
        var fin = i + 1 < marcas.length ? marcas[i + 1].ini : tramo.texto.length;
        var v = _interpretar(mc.numero, tramo.texto.substring(mc.fin, fin), tramo.ini + mc.fin, avisos, base);
        if (v !== null) { (v.pedida ? pedidas : vlans).push(v); }
    });
    return { vlans: vlans, pedidas: pedidas, bloque: bb.bloque, inicio: bb.inicio };
}

function _nombresEquipos(topo) {
    var repetidos = {}, salida = {};
    topo.dispositivos.forEach(function (d) {
        if (d.hostname) {
            var k = d.hostname.toLowerCase();
            repetidos[k] = (repetidos[k] || 0) + 1;
        }
    });
    topo.dispositivos.forEach(function (d) {
        salida[d.nombre.toLowerCase()] = d;
        if (d.hostname && repetidos[d.hostname.toLowerCase()] === 1) { salida[d.hostname.toLowerCase()] = d; }
    });
    return salida;
}

// --- Cableado de capa 2 ----------------------------------------------------------------

function _config(d, puerto) { return d.cfg ? d.cfg.porNombre(puerto) : null; }

function _puertoRuteado(d, puerto) {
    var i = d.interfaz(puerto);
    if (i !== null && i.configurada && !i.planeada) { return true; }
    var ic = _config(d, puerto);
    return !!(ic && ic.ruteado && ic.ip);
}

function _esL2(a, pa, b, pb) {
    if (a.esSwitch || b.esSwitch || a.esHost || b.esHost) { return true; }
    return !_puertoRuteado(a, pa) && !_puertoRuteado(b, pb);
}

function _grafoL2(topo) {
    var equipos = {}, cables = [], ady = {};
    topo.dispositivos.forEach(function (d) { equipos[d.nombre] = d; ady[d.nombre] = []; });
    topo.enlaces.forEach(function (e) {
        var a = equipos[e.a], b = equipos[e.b];
        if (!a || !b || !_esL2(a, e.pa, b, e.pb)) { return; }
        cables.push([a.nombre, e.pa, b.nombre, e.pb]);
        ady[a.nombre].push([b.nombre, e.pa, e.pb]);
        ady[b.nombre].push([a.nombre, e.pb, e.pa]);
    });
    return { equipos: equipos, cables: cables, ady: ady };
}

function _subir(nombre, g) {
    if (g.equipos[nombre].esRuteador) { return g.equipos[nombre]; }
    var vistos = {}, cola = [nombre];
    vistos[nombre] = true;
    while (cola.length) {
        var u = cola.shift(), lista = g.ady[u] || [];
        for (var i = 0; i < lista.length; i++) {
            var v = lista[i][0];
            if (vistos[v]) { continue; }
            vistos[v] = true;
            if (g.equipos[v].esRuteador) { return g.equipos[v]; }
            if (g.equipos[v].esSwitch) { cola.push(v); }
        }
    }
    return null;
}

function _redesConfiguradas(d) {
    var redes = [];
    d.interfacesIp().forEach(function (i) {
        if (i.planeada) { return; }
        var r = redDe(i.ip, i.mascara);
        if (r && !redes.some(function (o) { return mismaRed(o, r); })) { redes.push(r); }
    });
    return redes;
}

function _distancia(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

// --- De qué equipo es cada nota -----------------------------------------------------------

// Primera vuelta, antes de todo lo demás: quién es dueño de cada tramo. Un
// multicapa sin IP, sin 'ip routing' y sin nota que lo nombre sólo hace de switch.
function resolverNotas(topo) {
    var nombres = _nombresEquipos(topo);
    var base = _baseDe(topo);
    var res = { tramos: [], enlacesNota: [], avisos: [], base: base, nombresVlan: {}, notasAp: [] };
    var porEnlace = /^(?:(\d{1,3}\.\d{1,3}\.\d{1,3})\.|\.)(\d{1,4})(?:\s*\/\s*30)?(?:\s+(\S+))?$/;
    var nombrados = {};

    topo.notas.forEach(function (nota) {
        var limpia = nota.texto.trim();
        var me = porEnlace.exec(limpia);
        if (me && nota.x !== null) {
            res.enlacesNota.push({ x: nota.x, y: nota.y, prefijo: me[1] || null, octeto: +me[2], texto: limpia,
                                   v6: me[3] && me[3].indexOf(":") >= 0 ? me[3] : null });
            return;
        }
        var deAps = notaDeAps(nota.texto);
        if (deAps) {
            deAps.forEach(function (x) { res.notasAp.push({ nombre: x.nombre, redes: x.redes, nota: nota }); });
            return;
        }
        _partirNota(nota.texto, nombres).forEach(function (tramo) {
            tramo.nota = nota;
            tramo.avisos = [];
            tramo.leido = _leerTramo(tramo, tramo.avisos, base);
            var l = tramo.leido;
            // 'VLAN 2/17' con su nombre debajo, sin dueño ni redes: es la lista de nombres.
            if (_esListaDeNombres(tramo)) {
                l.pedidas.forEach(function (p) { res.nombresVlan[p.numero] = { nombre: p.nombre, prefijo: p.prefijo }; });
                return;
            }
            tramo.util = !!(l.vlans.length || l.pedidas.length || l.bloque);
            tramo.dueno = null;
            tramo.como = "";
            if (tramo.equipo) { nombrados[tramo.equipo.nombre] = true; }
            res.tramos.push(tramo);
        });
    });

    // Los multicapa sin nada de capa 3 se tratan como switches para el grafo; si
    // luego una nota les toca por cercanía, vuelven a ser dueños.
    function conNotaDeEnlace(d) {
        return topo.enlaces.some(function (e) {
            var otro = e.a === d.nombre ? e.b : e.b === d.nombre ? e.a : null;
            var o = otro ? topo.porNombre(otro) : null;
            if (!o || !o.capazCapa3 || d.x === null || o.x === null) { return false; }
            return res.enlacesNota.some(function (n) {
                return _distancia(n.x, n.y, (d.x + o.x) / 2, (d.y + o.y) / 2) <= _DISTANCIA_MAXIMA;
            });
        });
    }
    topo.dispositivos.forEach(function (d) {
        d.soloCapa2 = d.capazCapa3 && _alguno(_TIPOS_SWITCH, d.desc) && !nombrados[d.nombre]
            && !d.interfacesIp().length && !(d.redesDeAntes && d.redesDeAntes.length) && d.ruteoIp !== true && !conNotaDeEnlace(d);
    });
    var g = _grafoL2(topo);
    var tomados = {};
    var pendientes = [];
    res.tramos.forEach(function (tramo) {
        if (!tramo.util) { return; }
        if (tramo.equipo !== null) {
            tramo.dueno = _subir(tramo.equipo.nombre, g);
            tramo.como = "nombre";
        } else {
            var redes = tramo.leido.vlans.map(function (v) { return v.red; });
            var cuentas = [];
            topo.ruteadores.forEach(function (d) {
                var propias = _redesConfiguradas(d).concat(d.redesDeAntes || []);
                var n = redes.filter(function (r) { return propias.some(function (o) { return mismaRed(o, r); }); }).length;
                if (n) { cuentas.push([n, d]); }
            });
            cuentas = ordenar(cuentas, function (c) { return -c[0]; });
            if (cuentas.length && (cuentas.length === 1 || cuentas[1][0] < cuentas[0][0])) {
                tramo.dueno = cuentas[0][1];
                tramo.como = "configuración";
            }
        }
        if (tramo.dueno) { tomados[tramo.dueno.nombre] = true; }
        else { pendientes.push(tramo); }
    });

    // Sin nombre escrito: el dueño del equipo de LAN más cercano, y pueden ser varias
    // notas del mismo.
    pendientes.filter(function (t) { return !t.declarado; }).forEach(function (tramo) {
        var n = tramo.nota;
        if (n.x === null) { return; }
        var lan = topo.dispositivos.filter(function (d) { return (d.esSwitch || d.esHost) && d.x !== null; });
        if (lan.length) {
            var cerca = ordenar(lan, function (d) { return _distancia(n.x, n.y, d.x, d.y); })[0];
            var dueno = _subir(cerca.nombre, g);
            if (dueno) {
                tramo.dueno = dueno;
                tramo.como = "cercanía";
                return;
            }
        }
        var rts = topo.ruteadores.filter(function (d) { return d.x !== null; });
        if (rts.length) {
            tramo.dueno = ordenar(rts, function (d) { return _distancia(n.x, n.y, d.x, d.y); })[0];
            tramo.como = "cercanía";
        }
    });

    // Con un nombre que nadie tiene todavía ('R1' en un Router0): cada nombre a un
    // equipo distinto, el que le quede más cerca, él o cualquier equipo de su LAN.
    var porNombre = {};
    pendientes.forEach(function (t) {
        if (t.declarado) { (porNombre[t.declarado.toLowerCase()] = porNombre[t.declarado.toLowerCase()] || []).push(t); }
    });
    var candidatos = topo.dispositivos.filter(function (d) { return d.capazCapa3 && !tomados[d.nombre]; });
    var dominio = {};
    candidatos.forEach(function (d) { dominio[d.nombre] = d.x !== null ? [[d.x, d.y]] : []; });
    topo.dispositivos.forEach(function (d) {
        if (!(d.esSwitch || d.esHost) || d.x === null) { return; }
        var arriba = _subir(d.nombre, g);
        if (arriba && dominio[arriba.nombre]) { dominio[arriba.nombre].push([d.x, d.y]); }
    });
    var pares = [];
    Object.keys(porNombre).forEach(function (nombre) {
        porNombre[nombre].forEach(function (tramo) {
            if (tramo.nota.x === null) { return; }
            candidatos.forEach(function (d) {
                dominio[d.nombre].forEach(function (p) {
                    pares.push([_distancia(tramo.nota.x, tramo.nota.y, p[0], p[1]), nombre, d]);
                });
            });
        });
    });
    ordenar(pares, function (p) { return p[0]; }).forEach(function (par) {
        var grupo = porNombre[par[1]];
        if (grupo[0].dueno || tomados[par[2].nombre]) { return; }
        tomados[par[2].nombre] = true;
        grupo.forEach(function (tramo) {
            tramo.dueno = par[2];
            tramo.como = "cercanía";
        });
    });

    // Quien ya tiene dueño deja de ser sólo capa 2; lo demás queda como quedó.
    res.tramos.forEach(function (tramo) {
        if (tramo.dueno) {
            tramo.dueno.soloCapa2 = false;
            if (tramo.declarado && tramo.dueno.hostname !== tramo.declarado) {
                tramo.dueno.hostnameNota = tramo.declarado;
            }
        }
    });
    _bajarAlMulticapa(res, topo, g);
    return res;
}

function _esListaDeNombres(tramo) {
    var l = tramo.leido;
    return tramo.equipo === null && !tramo.declarado && l.pedidas.length > 0 && !l.vlans.length && l.bloque === null
        && l.pedidas.every(function (p) { return p.nombre && !p.combo4 && !p.combo6 && !p.usuarios; });
}

function _conLan(d, g) {
    return (g.ady[d.nombre] || []).some(function (par) { return g.equipos[par[0]].esSwitch || g.equipos[par[0]].esHost; });
}

// La nota a nombre de un router sin LAN propia habla de lo que cuelga de él: 'R3' y
// 'SWR2' son el mismo sitio si la red de PCs está en el multicapa pegado a R3.
function _bajarAlMulticapa(res, topo, g) {
    var conNota = {}, porRouter = {};
    res.tramos.forEach(function (t) {
        if (!t.util || !t.dueno) { return; }
        conNota[t.dueno.nombre] = true;
        if (!t.dueno.esMulticapa && !_conLan(t.dueno, g)) { (porRouter[t.dueno.nombre] = porRouter[t.dueno.nombre] || []).push(t); }
    });
    Object.keys(porRouter).forEach(function (nombre) {
        var abajo = [];
        topo.enlaces.forEach(function (e) {
            var otro = e.a === nombre ? e.b : e.b === nombre ? e.a : null;
            var d = otro ? topo.porNombre(otro) : null;
            if (d && d.esMulticapa && !conNota[d.nombre] && _conLan(d, g) && abajo.indexOf(d) < 0) { abajo.push(d); }
        });
        if (abajo.length !== 1) { return; }
        conNota[abajo[0].nombre] = true;
        porRouter[nombre].forEach(function (t) {
            t.rotulo = t.declarado || _nombreVisto(t.dueno);
            t.dueno = abajo[0];
            t.como = "sin lan";
        });
    });
}

// Red base que no se escribió: la que dicen la mayoría de tus combos. En clase A
// o B parte de sus dos primeros octetos (11.0.4.0 -> 11.0.0.0), en clase C de tres.
function baseInferida(res) {
    var escritas = [];
    res.tramos.forEach(function (tramo) {
        tramo.leido.pedidas.forEach(function (p) {
            if (p.combo4 && esIp(p.combo4.red.txt)) { escritas.push(p.combo4.red.txt); }
        });
    });
    if (!escritas.length) { return null; }
    // En un empate, el menor: los enlaces van al principio de la red.
    function comunOcteto(lista, k) {
        return masComun(lista.map(function (ip) { return +ip.split(".")[k]; }).sort(function (a, b) { return a - b; })) + "";
    }
    var primero = comunOcteto(escritas, 0);
    var mismos = escritas.filter(function (ip) { return ip.split(".")[0] === primero; });
    var segundo = comunOcteto(mismos, 1);
    var clase = prefijoPorClase(primero + ".0.0.0");
    if (clase === null) { return null; }
    var inicio = primero + "." + segundo + ".0.0";
    if (clase === 24) {
        var dos = mismos.filter(function (ip) { return ip.split(".")[1] === segundo; });
        inicio = primero + "." + segundo + "." + comunOcteto(dos, 2) + ".0";
    }
    return { bloque: red4(inicio, clase), inicio: ipAEntero(inicio) };
}

function redesDeNotas(res) {
    var vlans = [], bases = [];
    res.tramos.forEach(function (tramo) {
        var quien = tramo.equipo ? (tramo.equipo.hostname || tramo.equipo.nombre) : (tramo.declarado || "una nota");
        tramo.leido.vlans.forEach(function (v) { vlans.push([v, quien]); });
        if (tramo.leido.bloque !== null) {
            bases.push(tramo.leido.inicio !== null ? tramo.leido.inicio : tramo.leido.bloque.n);
        }
    });
    var inferida = baseInferida(res);
    if (inferida !== null) { bases.push(inferida.inicio); }
    return { vlans: vlans, bases: bases };
}

// --- Plan completo ----------------------------------------------------------------------

function leerPlan(topo, res) {
    var plan = { notas: 0, sitios: [], ordenes: {}, switchesEnOrden: [], avisos: [], errores: [], supuestos: [],
                 sitioDe: function (e) {
                     for (var i = 0; i < this.sitios.length; i++) {
                         if (this.sitios[i].dueno.nombre === e) { return this.sitios[i]; }
                     }
                     return null;
                 } };
    if (!res.tramos.length) { return plan; }
    function aviso(equipo, m) { plan.avisos.push([equipo, m]); }
    function error(equipo, m) { plan.errores.push([equipo, m]); }

    var g = _grafoL2(topo);
    var sitios = {};
    var inferida = baseInferida(res);
    res.tramos.forEach(function (tramo) {
        var nota = tramo.nota;
        var donde = nota.x !== null ? "la nota en (" + nota.x + ", " + nota.y + ")" : "una nota";
        var destino = tramo.dueno ? tramo.dueno.nombre : "plan";
        tramo.avisos.forEach(function (a) { aviso(destino, donde + ": " + a); });
        if (!tramo.util) { return; }
        if (tramo.dueno === null) {
            error("plan", "no se sabe de qué equipo es " + donde + "; escribe en la nota el nombre del router");
            return;
        }
        if (tramo.como === "cercanía" && !tramo.declarado) {
            aviso(tramo.dueno.nombre, donde + " no dice de qué equipo es y se asignó a "
                  + (tramo.dueno.hostname || tramo.dueno.nombre) + " por cercanía");
        }
        var s = sitios[tramo.dueno.nombre];
        if (!s) {
            s = { dueno: tramo.dueno, vlans: [], como: tramo.como, notas: [], puertoLan: null, switches: {}, raiz: null,
                  canales: [], pcs: [], bloque: null, inicio: null, pedidas: [], reparto: "", rotulo: tramo.rotulo || null,
                  inalambricos: [], core: null, nativa: null, routerNativa: null, servidor: null, vlanServidor: null };
            sitios[tramo.dueno.nombre] = s;
            if (s.rotulo) {
                plan.supuestos.push(("la nota de " + s.rotulo + " se aplicó a " + _nombreVisto(s.dueno)
                                     + ": " + s.rotulo + " no tiene lan propia").toLowerCase());
            }
        }
        if (nota.x !== null) { s.notas.push([nota.x, nota.y]); }
        tramo.leido.vlans.forEach(function (v) { v.nota = nota; _agregarVlan(s, v, error); });
        tramo.leido.pedidas.forEach(function (p) { p.nota = nota; s.pedidas.push(p); });
        if (tramo.leido.bloque !== null) {
            if (s.bloque !== null && !(mismaRed(s.bloque, tramo.leido.bloque) && s.inicio === tramo.leido.inicio)) {
                error(tramo.dueno.nombre, "trae dos redes base, " + textoRed(s.bloque) + " y " + textoRed(tramo.leido.bloque) + "; se usó la primera");
            } else {
                s.bloque = tramo.leido.bloque;
                s.inicio = tramo.leido.inicio;
            }
        }
        plan.notas++;
    });
    var lista = Object.keys(sitios).map(function (k) { return sitios[k]; });
    lista.forEach(function (s) {
        s.pedidas.concat(s.vlans).forEach(function (x) {
            var deLista = res.nombresVlan[x.numero];
            if (deLista) {
                x.nombre = deLista.nombre;
                x.enLista = true;
            }
        });
    });
    // Sin red base escrita, la de la mayoría de tus combos.
    lista.forEach(function (s) {
        if (s.bloque === null && s.pedidas.length && inferida !== null) {
            s.bloque = inferida.bloque;
            s.inicio = inferida.inicio;
        }
    });
    plan.sitios = ordenar(lista, function (s) {
        return [s.dueno.esMulticapa && !s.rotulo ? 1 : 0, natural(s.rotulo || s.dueno.hostnameNota || s.dueno.hostname || s.dueno.nombre)];
    });
    if (!plan.sitios.length) { return plan; }

    _armarSitios(plan, g, aviso, error);
    _repartir(plan, topo, aviso, error);
    _revisarTraslapes(plan, topo, error);
    _marcarNativas(plan, res, aviso);
    plan.sitios.forEach(function (s) {
        _apartarServidor(s, g);
        _repartirPcs(s, g, plan, aviso);
        _revisarPcs(s, aviso, error);
    });
    plan.g = g;
    return plan;
}

// La VLAN nativa es la que se llama así en tus notas. La de un router cuya única LAN es el segundo
// cable al multicapa también lo es: esa red es la de la controladora y los AP, y llega a todo lo que
// cuelga del multicapa. Por eso el sitio del multicapa también la conoce, aunque no sea suya.
function _marcarNativas(plan, res, aviso) {
    plan.sitios.forEach(function (s) {
        s.vlans.forEach(function (v) {
            v.nativa = /^nativ(a|e|o)s?$/i.test(v.nombre || "") || !!(s.core && s.vlans.length === 1);
            var deLista = res.nombresVlan[v.numero];
            v.enLista = !!deLista;
            if (deLista && deLista.prefijo !== null && deLista.prefijo !== v.red.p) {
                aviso(s.dueno.nombre, "la vlan " + v.numero + " es /" + v.red.p + " y en la lista de nombres dice /" + deLista.prefijo);
            }
        });
        s.nativa = s.vlans.filter(function (v) { return v.nativa; })[0] || null;
    });
    plan.sitios.forEach(function (s) {
        var c = s.core ? plan.sitioDe(s.core.equipo) : null;
        if (c && s.nativa) {
            c.nativa = c.nativa || s.nativa;
            c.routerNativa = s;
        }
    });
}

function _vlansDelSitio(s) {
    var todas = s.nativa && s.vlans.indexOf(s.nativa) < 0 ? s.vlans.concat([s.nativa]) : s.vlans;
    return s.vlanServidor ? todas.concat([s.vlanServidor]) : todas;
}

// El server de un sitio con controladora es el de RADIUS: deja de ser una PC más y su puerto lo arregla
// lo inalámbrico. En un multicapa tiene que estar en él, porque de ahí sale su puerta; con un router, en
// cualquier switch del sitio, de preferencia el de la controladora.
function _apartarServidor(s, g) {
    var wlc = s.inalambricos.filter(function (x) { return x.d.esControladora; })[0];
    if (!wlc || !s.nativa) { return; }
    var elegido = ordenar(s.pcs.filter(function (p) {
        return g.equipos[p.pc].esServidor && (!s.dueno.esMulticapa || p.equipo === s.dueno.nombre);
    }), function (p) { return [p.equipo === wlc.equipo ? 0 : 1, natural(p.puerto)]; })[0];
    if (!elegido) { return; }
    s.servidor = { d: g.equipos[elegido.pc], equipo: elegido.equipo, puerto: elegido.puerto };
    s.pcs = s.pcs.filter(function (p) { return p !== elegido; });
}

function _agregarVlan(s, v, error) {
    for (var i = 0; i < s.vlans.length; i++) {
        var otra = s.vlans[i];
        if (otra.numero === v.numero) {
            if (!mismaRed(otra.red, v.red)) {
                error(s.dueno.nombre, "la VLAN " + v.numero + " aparece dos veces con redes distintas (" + textoRed(otra.red) + " y " + textoRed(v.red) + ")");
            }
            return;
        }
        if (mismaRed(otra.red, v.red)) {
            error(s.dueno.nombre, "las VLAN " + otra.numero + " y " + v.numero + " tienen la misma red " + textoRed(v.red));
            return;
        }
    }
    s.vlans.push(v);
    s.vlans = ordenar(s.vlans, function (x) { return x.numero; });
}

function _candidatas(bloque, inicio, prefijo) {
    var t = tamanoRed(prefijo);
    var desde = Math.max(inicio !== null ? inicio : 0, bloque.n);
    var n = Math.ceil(desde / t) * t;
    var fin = bloque.n + tamanoRed(bloque.p) - 1;
    return { siguiente: function () {
        if (n + t - 1 > fin) { return null; }
        var r = { n: n, p: prefijo };
        n += t;
        return r;
    } };
}

function _dividir(bloque, inicio, pedidas, ocupadas) {
    function libre(red, tomadas) {
        return !ocupadas.some(function (o) { return traslapan(red, o); })
            && !tomadas.some(function (o) { return traslapan(red, o); });
    }
    var redes = pedidas.map(function () { return null; });
    if (pedidas.some(function (p) { return _tamanoPedida(p) !== null; })) {
        var tomadas = [];
        var indices = pedidas.map(function (_, i) { return i; }).filter(function (i) { return _tamanoPedida(pedidas[i]) !== null; });
        ordenar(indices, function (i) { return [_tamanoPedida(pedidas[i]), pedidas[i].numero]; }).forEach(function (i) {
            var prefijo = _tamanoPedida(pedidas[i]);
            if (prefijo < bloque.p) { return; }
            var it = _candidatas(bloque, inicio, prefijo), red;
            while ((red = it.siguiente()) !== null) {
                if (libre(red, tomadas)) {
                    redes[i] = red;
                    tomadas.push(red);
                    break;
                }
            }
        });
        return { redes: redes, modo: "por tamaño", aviso: null };
    }
    var orden = ordenar(pedidas.map(function (_, i) { return i; }), function (i) { return pedidas[i].numero; });
    var bitsN = 0;
    while (Math.pow(2, bitsN) < pedidas.length) { bitsN++; }
    var inicial = bloque.p + bitsN, aviso = null;
    for (var prefijo = inicial; prefijo < 31; prefijo++) {
        var libres = [], it = _candidatas(bloque, inicio, prefijo), red;
        while ((red = it.siguiente()) !== null) {
            if (libre(red, libres)) {
                libres.push(red);
                if (libres.length === pedidas.length) { break; }
            }
        }
        if (libres.length === pedidas.length) {
            orden.forEach(function (i, k) { redes[i] = libres[k]; });
            if (prefijo > inicial) {
                aviso = "en /" + inicial + " no cabían todas sin pisar las redes que ya usa la práctica; se usaron /" + prefijo;
            }
            break;
        }
    }
    return { redes: redes, modo: "en partes iguales", aviso: aviso };
}

// En qué orden salen las redes de una misma base. A mano se hace una tabla por VLAN,
// tachando los bloques que chocan con lo ya repartido, así que el orden lo cambia todo.
// Se usa el que más coincide con lo que la práctica ya dice (tus combos o lo que ya está
// configurado) y, si no dice nada, el primero: de la más chica a la más grande, y en cada
// tabla por número de router, con el multicapa en el lugar del router del que cuelga.
var _REPARTOS = [
    { orden: "chica", sitios: "router", texto: "de la más chica a la más grande, vlan por vlan y por número de router" },
    { orden: "chica", sitios: "dueno", texto: "de la más chica a la más grande, vlan por vlan, routers antes que multicapa" },
    { orden: "grande", sitios: "dueno", texto: "de la más grande a la más chica, vlan por vlan, routers antes que multicapa" },
    { orden: "numero", sitios: "dueno", texto: "por número de vlan, routers antes que multicapa" },
    { orden: "grande", sitios: "router", texto: "de la más grande a la más chica, vlan por vlan y por número de router" },
    { orden: "numero", sitios: "router", texto: "por número de vlan y de router" },
    { orden: "sitio", sitios: "dueno", texto: "sitio por sitio, routers antes que multicapa" }
];

function _nombreVisto(d) {
    return d.hostnameNota || (d.hostname && !/^(router|switch)$/i.test(d.hostname) ? d.hostname : d.nombre);
}

// El lugar de un sitio en la tabla: el router que lo atiende, y el multicapa después de él.
function _rangoPorRouter(s, topo) {
    if (!s.dueno.esMulticapa) { return [0, natural(_nombreVisto(s.dueno)), 0, []]; }
    var routers = [];
    topo.enlaces.forEach(function (e) {
        var otro = e.a === s.dueno.nombre ? e.b : e.b === s.dueno.nombre ? e.a : null;
        var d = otro ? topo.porNombre(otro) : null;
        if (d && d.esRuteador && !d.esMulticapa) { routers.push(natural(_nombreVisto(d))); }
    });
    var propio = natural(_nombreVisto(s.dueno));
    if (!routers.length) { return [1, propio, 1, propio]; }
    return [0, ordenar(routers, function (r) { return r; })[0], 1, propio];
}

function _claveReparto(criterio, q) {
    var lugar = criterio.sitios === "router" ? q.rango : q.k;
    if (criterio.orden === "chica") { return [-q.pre, q.numero, lugar]; }
    if (criterio.orden === "grande") { return [q.pre, q.numero, lugar]; }
    return [q.numero, lugar];
}

// El primer bloque libre desde `inicio`. Lo que choca se salta entero: contar de /28 en /28
// hasta 16.12.0.0 son decenas de miles de vueltas, y esto corre muchas veces por lectura.
function _primeraLibre(bloque, inicio, prefijo, ocupadas) {
    var t = tamanoRed(prefijo), fin = bloque.n + tamanoRed(bloque.p) - 1;
    var n = Math.ceil(Math.max(inicio !== null ? inicio : 0, bloque.n) / t) * t;
    while (n + t - 1 <= fin) {
        var red = { n: n, p: prefijo }, choca = null;
        for (var i = 0; i < ocupadas.length && choca === null; i++) {
            if (traslapan(red, ocupadas[i])) { choca = ocupadas[i]; }
        }
        if (choca === null) { return red; }
        n = Math.ceil((choca.n + tamanoRed(choca.p)) / t) * t;
    }
    return null;
}

// La red que la práctica ya dice para esta VLAN: la de tu combo, o la que está configurada.
function _redYaDicha(s, p) {
    if (p.combo4 && esIp(p.combo4.red.txt)) { return p.combo4.red.txt; }
    var nombre = s.dueno.esMulticapa ? "Vlan" + p.numero : (s.puertoLan ? s.puertoLan + "." + p.numero : null);
    var ic = nombre ? _config(s.dueno, nombre) : null;
    var r = ic && ic.ip && ic.mascara ? redDe(ic.ip, ic.mascara) : null;
    return r ? direccionDe(r) : null;
}

// Las VLANs con tamaño, en el orden de `criterio`; `dicha` es la dirección que ya traen.
function _peticiones(trabajos, criterio) {
    var lista = [];
    trabajos.forEach(function (t, k) {
        t.pedidas.forEach(function (p, i) {
            var pre = _tamanoPedida(p);
            if (pre !== null && pre >= t.s.bloque.p) {
                lista.push({ id: k + ":" + i, k: k, i: i, pre: pre, numero: p.numero, s: t.s, rango: t.rango,
                             dicha: t.dichas[i] === null ? null : ipAEntero(t.dichas[i]) });
            }
        });
    });
    return ordenar(lista, function (q) { return _claveReparto(criterio, q); });
}

// [{redes, modo, aviso}] por trabajo, en el orden de `criterio`, sin tocar `ocupadasBase`.
// `aparte` son las VLANs que no entran en la cuenta: las que traen una dirección que cuadra con
// su diagonal se quedan ahí, y las demás las saltan.
function _asignarRedes(trabajos, ocupadasBase, criterio, orden, aparte) {
    var ocupadas = ocupadasBase.slice();
    var salida = trabajos.map(function (t) {
        return { redes: t.pedidas.map(function () { return null; }), modo: "por tamaño", aviso: null };
    });
    function poner(q, red) {
        if (red) {
            salida[q.k].redes[q.i] = red;
            ocupadas.push(red);
        }
    }
    function porPartes(t, k) {
        var quedan = [];
        t.pedidas.forEach(function (p, i) { if (!aparte[k + ":" + i]) { quedan.push(i); } });
        if (!quedan.length) { return; }
        var d = _dividir(t.s.bloque, t.s.inicio, quedan.map(function (i) { return t.pedidas[i]; }), ocupadas);
        d.redes.forEach(function (r, j) {
            salida[k].redes[quedan[j]] = r;
            if (r) { ocupadas.push(r); }
        });
        salida[k].modo = d.modo;
        salida[k].aviso = d.aviso;
    }
    var enCuenta = orden.filter(function (q) { return !aparte[q.id]; });
    var escritas = enCuenta.filter(function (q) { return q.dicha !== null; }).map(function (q) {
        return { n: q.dicha - q.dicha % tamanoRed(q.pre), p: q.pre };
    });
    var aCorregir = [], sinDireccion = [];
    orden.filter(function (q) { return aparte[q.id]; }).forEach(function (q) {
        var red = q.dicha !== null && !q.lejos && q.dicha % tamanoRed(q.pre) === 0 ? { n: q.dicha, p: q.pre } : null;
        var libre = red && subredDe(red, q.s.bloque) && !ocupadas.concat(escritas).some(function (o) { return traslapan(red, o); });
        if (libre) { poner(q, red); } else { (q.dicha !== null ? aCorregir : sinDireccion).push(q); }
    });
    function primera(q, desde) {
        var tomadas = ocupadas.concat(escritas);
        return _primeraLibre(q.s.bloque, desde, q.pre, tomadas) || _primeraLibre(q.s.bloque, q.s.inicio, q.pre, tomadas);
    }
    // La que no cuadra se corrige ahí donde ibas contando, antes de repartir las que no traen nada.
    // La que se fue lejos, desde donde le tocaba.
    aCorregir.forEach(function (q) { poner(q, primera(q, q.lejos ? q.desde : q.dicha - q.dicha % tamanoRed(q.pre))); });
    if (criterio.orden === "sitio") {
        trabajos.forEach(porPartes);
    } else {
        enCuenta.forEach(function (q) { poner(q, _primeraLibre(q.s.bloque, q.s.inicio, q.pre, ocupadas)); });
    }
    // Las que no dicen dirección y no les dejaron lugar van después de la última.
    sinDireccion.forEach(function (q) {
        var desde = null;
        ocupadas.forEach(function (o) {
            if (subredDe(o, q.s.bloque)) { desde = Math.max(desde === null ? 0 : desde, o.n + tamanoRed(o.p)); }
        });
        poner(q, primera(q, desde));
    });
    // Los sitios que no dicen tamaños van en partes iguales, con lo que quedó libre.
    if (criterio.orden !== "sitio") {
        trabajos.forEach(function (t, k) {
            if (!t.pedidas.some(function (p) { return _tamanoPedida(p) !== null; })) { porPartes(t, k); }
        });
    }
    return salida;
}

// Las que van fuera de orden: no entran en la secuencia más larga de direcciones crecientes
// y debieron ir antes que otra con una dirección más baja. Así se ve un combo olvidado que
// se agregó contando desde el último. En un empate salen las direcciones más altas.
// Sirve de la más chica a la más grande: sólo así cada red queda arriba de las anteriores.
function _fueraDeOrden(orden) {
    var dichas = orden.filter(function (q) { return q.dicha !== null; });
    var largo = [], previo = [], fin = -1, i, j;
    for (i = 0; i < dichas.length; i++) {
        largo[i] = 1;
        previo[i] = -1;
        for (j = 0; j < i; j++) {
            if (dichas[j].dicha < dichas[i].dicha
                && (largo[j] + 1 > largo[i] || (largo[j] + 1 === largo[i] && dichas[j].dicha < dichas[previo[i]].dicha))) {
                largo[i] = largo[j] + 1;
                previo[i] = j;
            }
        }
        if (fin < 0 || largo[i] > largo[fin] || (largo[i] === largo[fin] && dichas[i].dicha < dichas[fin].dicha)) { fin = i; }
    }
    var enOrden = {};
    for (i = fin; i >= 0; i = previo[i]) { enOrden[dichas[i].id] = true; }
    var fuera = dichas.filter(function (q, a) {
        return !enOrden[q.id] && dichas.slice(a + 1).some(function (o) { return enOrden[o.id] && o.dicha < q.dicha; });
    });
    return ordenar(fuera, function (q) { return -q.dicha; });
}

// Cuántas de las que ya dice la práctica caen justo donde tocan. Lo apartado no cuenta: si no,
// cualquier criterio ganaría con todo 'fuera de orden'. Una VLAN fuera de orden se aparta sólo
// si así coinciden más: es la olvidada, la que recorría a las de después.
function _probarReparto(trabajos, ocupadas, criterio, sinCombo) {
    var orden = criterio.orden === "sitio" ? [] : _peticiones(trabajos, criterio);
    function intenta(aparte) {
        var redes = _asignarRedes(trabajos, ocupadas, criterio, orden, aparte), n = 0, total = 0;
        trabajos.forEach(function (t, k) {
            t.dichas.forEach(function (dicha, i) {
                var red = redes[k].redes[i];
                if (dicha !== null && red && direccionDe(red) === dicha) {
                    total++;
                    if (!aparte[k + ":" + i]) { n++; }
                }
            });
        });
        return { redes: redes, puntos: n, total: total, aparte: aparte, criterio: criterio };
    }
    var aparte = {};
    if (sinCombo) { orden.forEach(function (q) { if (q.dicha === null) { aparte[q.id] = true; } }); }
    var mejor = intenta(aparte);
    if (criterio.orden !== "chica") { return mejor; }
    _fueraDeOrden(orden).forEach(function (q) {
        var otra = {};
        Object.keys(mejor.aparte).forEach(function (id) { otra[id] = true; });
        otra[q.id] = true;
        var r = intenta(otra);
        if (r.puntos > mejor.puntos) { mejor = r; }
    });
    return mejor;
}

// El primer bloque de ese tamaño después de la red que tiene abajo: ahí empieza a contar quien
// olvidó un combo.
function _trasLaAnterior(q, tomadas) {
    var t = tamanoRed(q.pre), base = q.dicha - q.dicha % t;
    var fin = Math.max(q.s.inicio !== null ? q.s.inicio : 0, q.s.bloque.n);
    tomadas.forEach(function (o) {
        if (o.n < base) { fin = Math.max(fin, o.n + tamanoRed(o.p)); }
    });
    return Math.ceil(fin / t) * t;
}

// Lo escrito se queda donde lo escribiste si cuadra con su diagonal, no se encima con otra red y
// no se aleja más de un bloque de donde le toca: por la cuenta o, si va fuera de orden como una
// olvidada, contando desde la red que tiene abajo. Desplazada no es un error, y nadie se recorre.
// La cuenta decide además las que no traen dirección y quién gana si dos se enciman: las que sí
// coinciden.
function _respetarEscritas(plan, trabajos, ocupadas, r) {
    var coinciden = [], otras = [], aparte = {}, fuera = {};
    var orden = _peticiones(trabajos, r.criterio), tomadas = ocupadas.slice();
    if (r.criterio.orden === "chica") { _fueraDeOrden(orden).forEach(function (q) { fuera[q.id] = true; }); }
    orden.forEach(function (q) {
        if (q.dicha !== null) { tomadas.push({ n: q.dicha - q.dicha % tamanoRed(q.pre), p: q.pre }); }
    });
    plan.desplazadas = {};
    orden.forEach(function (q) {
        var red = r.redes[q.k].redes[q.i];
        if (q.dicha !== null && red && red.n === q.dicha && !r.aparte[q.id]) {
            coinciden.push(q);
        } else {
            otras.push(q);
            if (q.dicha !== null || r.aparte[q.id]) { plan.desplazadas[q.id] = red; }
        }
        if (q.dicha === null) {
            if (r.aparte[q.id]) { aparte[q.id] = true; }
            return;
        }
        aparte[q.id] = true;
        var t = tamanoRed(q.pre), base = q.dicha - q.dicha % t;
        var cuenta = red && !r.aparte[q.id] ? red.n : null;
        var tras = fuera[q.id] ? _trasLaAnterior(q, tomadas) : null;
        if (!(cuenta !== null && Math.abs(base - cuenta) <= t) && !(tras !== null && Math.abs(base - tras) <= t)) {
            q.lejos = true;
            q.desde = cuenta !== null ? cuenta : (tras !== null ? tras : q.s.inicio);
        }
    });
    return _asignarRedes(trabajos, ocupadas, r.criterio, coinciden.concat(otras), aparte);
}

function _elegirReparto(plan, trabajos, ocupadas) {
    var hay = 0, faltan = 0, porUsuarios = false;
    trabajos.forEach(function (t) {
        t.dichas = t.pedidas.map(function (p) { return _redYaDicha(t.s, p); });
        t.pedidas.forEach(function (p, i) {
            if (t.dichas[i] !== null) { hay++; }
            else if (_tamanoPedida(p) !== null) { faltan++; }
            if (p.usuarios && p.prefijo === null) { porUsuarios = true; }
        });
    });
    // Con usuarios en vez de diagonales: VLSM clásico, de la más grande a la más chica.
    var candidatos = porUsuarios ? [_REPARTOS[_REPARTOS.length - 1]].concat(_REPARTOS) : _REPARTOS;
    var mejor = null;
    // Primero lo que va en orden, luego todo lo que respeta y, si empatan, lo que aparta menos.
    function valor(r) { return [r.puntos, r.total, -Object.keys(r.aparte).length]; }
    function compara(r) {
        if (mejor === null || _cmpValor(valor(r), valor(mejor)) > 0) { mejor = r; }
    }
    candidatos.forEach(function (criterio) {
        compara(_probarReparto(trabajos, ocupadas, criterio, false));
        // Si tus combos no contaron a las VLANs que no traen el suyo, ésas van después del último.
        if (hay && faltan && criterio.orden === "chica") { compara(_probarReparto(trabajos, ocupadas, criterio, true)); }
    });
    var elegido = mejor.criterio;
    var porTamano = trabajos.some(function (t) { return t.pedidas.some(function (p) { return _tamanoPedida(p) !== null; }); });
    if (porTamano && !hay && !porUsuarios) { plan.supuestos.push("las redes salieron " + elegido.texto); }
    else if (porTamano && hay && elegido !== _REPARTOS[0]) { plan.supuestos.push("tus redes ya van " + elegido.texto + ": se respetó ese orden"); }
    plan.reparto = elegido;
    plan.desplazadas = {};
    return hay ? _respetarEscritas(plan, trabajos, ocupadas, mejor) : mejor.redes;
}

// Las redes que los combos de las notas dicen, de cada lista de VLANs pedidas.
function redesEscritas(listas) {
    var salida = [];
    listas.forEach(function (pedidas) {
        pedidas.forEach(function (p) {
            var pre = _tamanoPedida(p);
            if (pre !== null && p.combo4 && esIp(p.combo4.red.txt)) { salida.push(red4(p.combo4.red.txt, pre)); }
        });
    });
    return salida;
}

// El otro lado de su cable es un ruteador y está en la misma red.
function _esEnlaceConfigurado(topo, d, i, r) {
    var puerto = i.nombre.toLowerCase();
    return topo.enlaces.some(function (e) {
        var otro = null, suyo = null;
        if (e.a === d.nombre && e.pa.toLowerCase() === puerto) { otro = e.b; suyo = e.pb; }
        else if (e.b === d.nombre && e.pb.toLowerCase() === puerto) { otro = e.a; suyo = e.pa; }
        var o = otro ? topo.porNombre(otro) : null;
        var io = o && o.esRuteador ? o.interfaz(suyo) : null;
        return !!(io && io.configurada && contiene(r, io.ip));
    });
}

function _repartir(plan, topo, aviso, error) {
    var duenos = {};
    plan.sitios.forEach(function (s) { duenos[s.dueno.nombre] = true; });
    var ocupadas = [];
    plan.enlaces = [];
    plan.sitios.forEach(function (s) { s.vlans.forEach(function (v) { ocupadas.push(v.red); }); });
    // Lo configurado aparta su red para la cuenta, pero sólo un enlace le gana a lo que escribiste:
    // cualquier otra cosa encima de un combo es lo que está mal, y al equipo le toca borrarse.
    var escritas = redesEscritas(plan.sitios.map(function (s) { return s.pedidas; }));
    topo.ruteadores.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            var nombre = i.nombre.toLowerCase();
            if (i.planeada || (duenos[d.nombre] && (nombre.indexOf("vlan") === 0 || nombre.indexOf(".") >= 0))) { return; }
            var r = redDe(i.ip, i.mascara);
            if (r && (_esEnlaceConfigurado(topo, d, i, r) || !escritas.some(function (e) { return traslapan(e, r); }))) {
                ocupadas.push(r);
                plan.enlaces.push(r);
            }
        });
    });
    var trabajos = [];
    plan.sitios.forEach(function (s) {
        var dueno = s.dueno.nombre;
        var ya = {};
        s.vlans.forEach(function (v) { ya[v.numero] = true; });
        var pedidas = [], vistas = {};
        Object.keys(ya).forEach(function (k) { vistas[k] = true; });
        s.pedidas.forEach(function (p) {
            if (!vistas[p.numero]) {
                pedidas.push(p);
                vistas[p.numero] = true;
            } else if (p.combo4 && esIp(p.combo4.red.txt)) {
                aviso(dueno, "la VLAN " + p.numero + " aparece dos veces en la nota: se usó la primera y se ignoró " + p.combo4.red.txt);
            }
        });
        if (s.bloque === null) {
            pedidas.forEach(function (p) {
                aviso(dueno, "VLAN " + p.numero + ": no trae su red, y la nota no tiene una red base de dónde sacarla");
            });
            return;
        }
        s.vlans.forEach(function (v) {
            if (!subredDe(v.red, s.bloque)) {
                aviso(dueno, "la VLAN " + v.numero + " (" + textoRed(v.red) + ") queda fuera de su red base " + textoRed(s.bloque));
            }
        });
        if (!s.pedidas.length) {
            var numeros = {};
            s.pcs.forEach(function (pc) { if (pc.vlan !== null && !ya[pc.vlan]) { numeros[pc.vlan] = true; } });
            pedidas = ordenar(Object.keys(numeros).map(Number), function (n) { return n; }).map(function (n) {
                return { pedida: true, numero: n, nombre: null, usuarios: null, prefijo: null, combo4: null, combo6: null };
            });
        }
        if (!pedidas.length) {
            if (!s.vlans.length) {
                error(dueno, "tiene la red base " + textoRed(s.bloque) + ", pero no se sabe qué VLANs lleva: ponle a cada PC su VLAN en el nombre ('PC1 V3') o escríbelas en la nota ('VLAN 3/24')");
            }
            return;
        }
        trabajos.push({ s: s, pedidas: pedidas, rango: _rangoPorRouter(s, topo) });
    });
    var reparto = _elegirReparto(plan, trabajos, ocupadas);
    trabajos.forEach(function (t, k) {
        var s = t.s, dueno = s.dueno.nombre, pedidas = t.pedidas, d = reparto[k];
        s.reparto = d.modo;
        if (d.aviso) { aviso(dueno, d.aviso); }
        var conTamano = pedidas.some(function (p) { return _tamanoPedida(p) !== null; });
        pedidas.forEach(function (p, i) {
            var red = d.redes[i], tam = _tamanoPedida(p);
            if (red === null && conTamano && tam === null) {
                error(dueno, "la VLAN " + p.numero + " no dice de qué tamaño es: ponle su diagonal ('VLAN " + p.numero + "/24')");
                return;
            }
            if (red === null) {
                error(dueno, "la VLAN " + p.numero + (tam !== null ? " (/" + tam + ")" : "") + " no cabe en la red base " + textoRed(s.bloque));
                return;
            }
            if (p.usuarios && p.usuarios > tamanoRed(red.p) - 2) {
                aviso(dueno, "VLAN " + p.numero + ": en " + textoRed(red) + " caben " + (tamanoRed(red.p) - 2) + " equipos y la nota pide " + p.usuarios);
            }
            var v = _nuevaVlan(p.numero, red, p.nombre || nombrePorOmision(p.numero), ultimaDe(red));
            v.combo4 = p.combo4;
            v.combo6 = p.combo6;
            v.nota = p.nota;
            v.repartida = true;
            _agregarVlan(s, v, error);
            var tocaba = plan.desplazadas[k + ":" + i];
            if (tocaba !== undefined) {
                var quien = (s.rotulo || _nombreVisto(s.dueno)) + " vlan " + p.numero;
                if (t.dichas[i] === null) {
                    plan.supuestos.push((quien + " no trae combo: se contó desde el último, " + textoRed(red)).toLowerCase());
                } else if (direccionDe(red) === t.dichas[i]) {
                    plan.supuestos.push((quien + " (" + textoRed(red) + ") va desplazada"
                                         + (tocaba && tocaba.n !== red.n ? ", le tocaba " + direccionDe(tocaba) : "")
                                         + ": se dejó donde la escribiste").toLowerCase());
                }
            }
        });
    });
}

function _revisarTraslapes(plan, topo, error) {
    var todas = [];
    plan.sitios.forEach(function (s) { s.vlans.forEach(function (v) { todas.push([s, v]); }); });
    for (var i = 0; i < todas.length; i++) {
        for (var j = i + 1; j < todas.length; j++) {
            if (traslapan(todas[i][1].red, todas[j][1].red)) {
                error("plan", "la VLAN " + todas[i][1].numero + " de " + (todas[i][0].dueno.hostnameNota || todas[i][0].dueno.hostname || todas[i][0].dueno.nombre)
                      + " (" + textoRed(todas[i][1].red) + ") se encima con la VLAN " + todas[j][1].numero + " de "
                      + (todas[j][0].dueno.hostnameNota || todas[j][0].dueno.hostname || todas[j][0].dueno.nombre) + " (" + textoRed(todas[j][1].red) + ")");
            }
        }
    }
}

function _armarSitios(plan, g, aviso, error) {
    var duenos = {};
    plan.sitios.forEach(function (s) { duenos[s.dueno.nombre] = s; });
    var distancia = {}, deQuien = {}, empatados = {}, cola = [];
    Object.keys(duenos).forEach(function (n) {
        distancia[n] = 0;
        deQuien[n] = n;
        cola.push(n);
    });
    while (cola.length) {
        var u = cola.shift();
        (g.ady[u] || []).forEach(function (par) {
            var v = par[0];
            if (!g.equipos[v].esSwitch) { return; }
            if (distancia[v] !== undefined) {
                if (deQuien[v] !== deQuien[u] && distancia[v] === distancia[u] + 1) { empatados[v] = true; }
                return;
            }
            distancia[v] = distancia[u] + 1;
            deQuien[v] = deQuien[u];
            cola.push(v);
        });
    }
    Object.keys(empatados).sort().forEach(function (v) {
        aviso(v, "queda a la misma distancia de dos sitios; se tomó el de " + (g.equipos[deQuien[v]].hostname || deQuien[v]));
    });

    plan.sitios.forEach(function (s) {
        var dueno = s.dueno.nombre;
        s.switches = {};
        Object.keys(distancia).forEach(function (n) {
            if (deQuien[n] === dueno && n !== dueno) { s.switches[n] = distancia[n]; }
        });
        var miembros = {};
        Object.keys(s.switches).forEach(function (n) { miembros[n] = true; });
        miembros[dueno] = true;
        var propios = g.cables.filter(function (c) { return miembros[c[0]] && miembros[c[2]]; });
        if (!s.dueno.esMulticapa) {
            var lan = [];
            propios.forEach(function (c) {
                if (c[0] === dueno) { lan.push(c[1]); }
                else if (c[2] === dueno) { lan.push(c[3]); }
            });
            lan.sort();
            // Sin switch propio, el cable sin IP al multicapa: por ahí va su red, como una troncal.
            var alCore = (g.ady[dueno] || []).filter(function (par) { return g.equipos[par[0]].esMulticapa; })[0];
            if (!lan.length && alCore) {
                s.puertoLan = alCore[1];
                s.core = { equipo: alCore[0], puerto: alCore[2] };
            } else if (!lan.length) {
                // Un hostname tecleado en el equipo equivocado se ve así.
                error(dueno, "no tiene ningún switch cableado para las VLANs del plan (se necesita un puerto sin IP hacia la LAN)"
                      + (s.dueno.hostname && s.dueno.hostname !== dueno ? "; en el lienzo es " + dueno + ": revisa que ese hostname sea de este equipo" : ""));
            } else {
                s.puertoLan = lan[0];
                if (lan.some(function (p) { return p !== lan[0]; })) {
                    aviso(dueno, "tiene varios puertos hacia la LAN; las subinterfaces se ponen en " + lan[0]);
                }
            }
        }
        g.cables.forEach(function (c) {
            [[c[0], c[2], c[3]], [c[2], c[0], c[1]]].forEach(function (t) {
                var pc = t[0], equipo = t[1], puerto = t[2];
                if (g.equipos[pc].esHost && miembros[equipo] && (equipo !== dueno || s.dueno.esMulticapa)) {
                    var vf = _vlanDePc(g.equipos[pc], g.equipos[equipo], puerto, s);
                    s.pcs.push({ pc: pc, equipo: equipo, puerto: puerto, vlan: vf[0], fuente: vf[1] });
                }
                if ((g.equipos[pc].esAp || g.equipos[pc].esControladora) && miembros[equipo]) {
                    s.inalambricos.push({ d: g.equipos[pc], equipo: equipo, puerto: puerto });
                }
            });
        });
        s.pcs = ordenar(s.pcs, function (p) { return [p.equipo, p.puerto]; });

        // EtherChannel: dos o más cables entre los mismos dos equipos.
        var porPar = {};
        propios.forEach(function (c) {
            var a = c[0], pa = c[1], b = c[2], pb = c[3];
            if (g.equipos[a].esHost || g.equipos[b].esHost) { return; }
            if (!s.dueno.esMulticapa && (dueno === a || dueno === b)) { return; }
            var uno = [a, pa], dos = [b, pb];
            var par = _cmpValor(uno, dos) <= 0 ? [uno, dos] : [dos, uno];
            var k = par[0][0] + "\u0000" + par[1][0];
            (porPar[k] = porPar[k] || []).push([par[0][1], par[1][1]]);
        });
        var grupos = {};
        function rangoDe(e) { return [distancia[e] || 0, g.equipos[e].hostname || e]; }
        Object.keys(porPar).sort().forEach(function (k) {
            var puertos = porPar[k];
            if (puertos.length < 2) { return; }
            var par = k.split("\u0000"), x = par[0], y = par[1];
            var activoEsX = _cmpValor(rangoDe(x), rangoDe(y)) <= 0;
            var activo = activoEsX ? x : y, pasivo = activoEsX ? y : x;
            var px = puertos.map(function (p) { return activoEsX ? p[0] : p[1]; }).sort();
            var py = puertos.map(function (p) { return activoEsX ? p[1] : p[0]; }).sort();
            grupos[activo] = (grupos[activo] || 0) + 1;
            grupos[pasivo] = (grupos[pasivo] || 0) + 1;
            s.canales.push({ a: activo, puertosA: px, modoA: "active", grupoA: grupos[activo],
                             b: pasivo, puertosB: py, modoB: "passive", grupoB: grupos[pasivo] });
        });

        // Raíz de STP: el switch pegado al dueño con más vecinos, sólo si hay
        // switches colgados de otros.
        var dists = Object.keys(s.switches).map(function (n) { return s.switches[n]; });
        if (dists.length && Math.max.apply(null, dists) >= 2) {
            var vecinos = {};
            propios.forEach(function (c) {
                (vecinos[c[0]] = vecinos[c[0]] || {})[c[2]] = true;
                (vecinos[c[2]] = vecinos[c[2]] || {})[c[0]] = true;
            });
            var pegados = Object.keys(s.switches).filter(function (n) { return s.switches[n] === 1; });
            if (pegados.length) {
                s.raiz = ordenar(pegados, function (n) {
                    return [-Object.keys(vecinos[n] || {}).length, g.equipos[n].hostname || n];
                })[0];
            }
        }
    });
    plan.sitios.forEach(function (s) {
        ordenar(Object.keys(s.switches), function (n) { return [s.switches[n], n]; }).forEach(function (n) {
            plan.switchesEnOrden.push(n);
        });
    });
}

// `deLaNota`: las VLANs que valen. Antes de repartir las redes todavía no se saben.
function _vlanDePc(pc, equipo, puerto, s, deLaNota) {
    var m = _RE_VLAN_PC.exec(pc.nombre);
    if (m) { return [+m[1], "nombre"]; }
    var ic = _config(equipo, puerto);
    if (ic && ic.accesoVlan && (!deLaNota || deLaNota.indexOf(ic.accesoVlan) >= 0)) { return [ic.accesoVlan, "switch"]; }
    var i, j;
    var ips = pc.interfacesIp();
    for (i = 0; i < ips.length; i++) {
        for (j = 0; j < s.vlans.length; j++) {
            if (contiene(s.vlans[j].red, ips[i].ip)) { return [s.vlans[j].numero, "IP"]; }
        }
    }
    if (pc.gateway) {
        for (j = 0; j < s.vlans.length; j++) {
            if (contiene(s.vlans[j].red, pc.gateway)) { return [s.vlans[j].numero, "puerta de enlace"]; }
        }
    }
    return [null, ""];
}

// PCs que no dicen su VLAN por ningún lado: se reparten por orden de puerto, en
// partes iguales y las primeras VLANs con las que sobren (3 PCs y 2 VLANs: 2 y 1).
// Contando toda su red, cada VLAN de la nota se queda con al menos una PC: si a
// alguna no le tocó, se la cede la VLAN que tenga más. Si no alcanzan, se avisa.
function _repartirPcs(s, g, plan, aviso) {
    var numeros = s.vlans.map(function (v) { return v.numero; }).sort(function (a, b) { return a - b; });
    if (!numeros.length) { return; }
    // Las notas mandan: el puerto puesto en una VLAN que ninguna nota dice está mal, y esa PC se
    // reparte como las que no dicen su VLAN. La que otra nota sí dice se respeta: puede venir
    // por otro cable, como la V6 de un router con lo inalámbrico. Y su nombre manda, y se avisa.
    var enLasNotas = [];
    plan.sitios.forEach(function (o) { o.vlans.forEach(function (v) { enLasNotas.push(v.numero); }); });
    // La PC pegada al switch de la controladora, la más cercana a ella, es la que la configura: va en
    // la red nativa. Sólo su nombre le gana.
    var wlc = s.inalambricos.filter(function (x) { return x.d.esControladora; })[0];
    if (s.nativa && wlc) {
        var cerca = ordenar(s.pcs.filter(function (p) { return p.equipo === wlc.equipo && p.fuente !== "nombre" && !g.equipos[p.pc].esServidor; }), function (p) {
            var d = g.equipos[p.pc];
            return d.x === null || wlc.d.x === null ? 0 : _distancia(d.x, d.y, wlc.d.x, wlc.d.y);
        })[0];
        if (cerca) {
            cerca.vlan = s.nativa.numero;
            cerca.fuente = "controladora";
        }
    }
    s.pcs.forEach(function (p) {
        if (p.vlan !== null && p.fuente !== "nombre" && enLasNotas.indexOf(p.vlan) < 0) { p.vlan = null; }
    });
    // Las que aún no se sabían pueden salir ahora de la puerta de enlace o la IP.
    s.pcs.forEach(function (p) {
        if (p.vlan === null) {
            var vf = _vlanDePc(g.equipos[p.pc], g.equipos[p.equipo], p.puerto, s, enLasNotas);
            p.vlan = vf[0];
            p.fuente = vf[1];
        }
    });
    var porEquipo = {};
    s.pcs.forEach(function (p) { if (p.vlan === null) { (porEquipo[p.equipo] = porEquipo[p.equipo] || []).push(p); } });
    var equipos = ordenar(Object.keys(porEquipo), natural);
    if (!equipos.length) { return; }
    var repartidas = [];
    equipos.forEach(function (equipo) {
        var pcs = porEquipo[equipo] = ordenar(porEquipo[equipo], function (p) { return natural(p.puerto); });
        var base = Math.floor(pcs.length / numeros.length), extra = pcs.length % numeros.length, k = 0;
        numeros.forEach(function (n, i) {
            var cuantos = base + (i < extra ? 1 : 0);
            for (var c = 0; c < cuantos; c++, k++) {
                pcs[k].vlan = n;
                pcs[k].fuente = "reparto";
            }
        });
        repartidas = repartidas.concat(pcs);
    });
    function cuantas(n) { return s.pcs.filter(function (p) { return p.vlan === n; }).length; }
    numeros.filter(function (n) { return cuantas(n) === 0; }).forEach(function (falta) {
        // De la VLAN con más PCs, la última que se repartió.
        var donante = null;
        for (var i = repartidas.length - 1; i >= 0; i--) {
            var p = repartidas[i];
            if (cuantas(p.vlan) >= 2 && (donante === null || cuantas(p.vlan) > cuantas(donante.vlan))) { donante = p; }
        }
        if (donante === null) {
            aviso(s.dueno.nombre, "VLAN " + falta + ": no alcanzan las PCs, se queda sin ninguna");
            return;
        }
        donante.vlan = falta;
    });
    equipos.forEach(function (equipo) {
        var pcs = porEquipo[equipo];
        var vlans = pcs.map(function (p) { return p.vlan; }).sort(function (a, b) { return a - b; });
        pcs.forEach(function (p, i) { p.vlan = vlans[i]; });
        plan.supuestos.push(pcs.map(function (p) { return p.pc + " vlan " + p.vlan; }).join(", ").toLowerCase());
    });
}

function _revisarPcs(s, aviso, error) {
    var dueno = s.dueno.nombre;
    var numeros = _vlansDelSitio(s).map(function (v) { return v.numero; });
    s.pcs.forEach(function (p) {
        if (p.vlan !== null && numeros.indexOf(p.vlan) < 0) {
            error(dueno, p.pc + " va en la VLAN " + p.vlan + " (según su " + p.fuente + "), pero el sitio sólo tiene " + numeros.slice().sort(function (a, b) { return a - b; }).join(", "));
        }
    });
}

// --- Comandos ------------------------------------------------------------------------------

function rangoPuertos(puertos) {
    var grupos = new Map();
    puertos.forEach(function (p) {
        var m = /^(.*?)(\d+)$/.exec(p);
        if (m) {
            if (!grupos.has(m[1])) { grupos.set(m[1], []); }
            grupos.get(m[1]).push(+m[2]);
        }
    });
    var partes = [];
    grupos.forEach(function (numeros, base) {
        numeros = numeros.filter(function (n, i) { return numeros.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
        var inicio = numeros[0], previo = numeros[0];
        numeros.slice(1).concat([null]).forEach(function (n) {
            if (n !== null && n === previo + 1) {
                previo = n;
                return;
            }
            partes.push(inicio === previo ? base + inicio : base + inicio + " - " + previo);
            if (n !== null) { inicio = previo = n; }
        });
    });
    return partes.join(" , ");
}

function _cabecera(puertos) {
    return puertos.length === 1 ? "interface " + puertos[0] : "interface range " + rangoPuertos(puertos);
}

function _vlansBd(d, vlans) {
    var existentes = {};
    d.vlans.forEach(function (v) { existentes[v[0] + "\u0000" + (v[1] || "").trim().toLowerCase()] = true; });
    return vlans.filter(function (v) { return v.numero !== 1; }).map(function (v) {
        return _orden("vlan", ["vlan " + v.numero, " name " + v.nombre], existentes[v.numero + "\u0000" + v.nombre.toLowerCase()]);
    });
}

// Un 3560 no deja poner una troncal sin decirle la encapsulación, aunque aquí sólo haga de switch.
// Un 3650 sólo conoce dot1Q y esa línea se la rechaza.
function _pideEncapsulacion(d) {
    return d.capazCapa3 && _alguno(_TIPOS_SWITCH, d.desc) && !/3650|3850|9[2-5]00/.test(d.desc);
}

// Lo que un puerto de troncal o de canal ya trae y no debe; null si nada.
function _malEnTroncal(ic, puerto, s) {
    if (!ic) { return null; }
    if (ic.ruteado) { return puerto + " tiene no switchport, y es una troncal"; }
    if (ic.apagada) { return puerto + " está apagado, y es una troncal"; }
    if (ic.modo === "access") { return puerto + " está en modo acceso, y es una troncal"; }
    if (ic.permitidas) {
        var faltan = _vlansDelSitio(s).filter(function (v) { return ic.permitidas.indexOf(v.numero) < 0; }).map(function (v) { return v.numero; });
        if (faltan.length) { return puerto + " no deja pasar la vlan " + faltan.join(", "); }
    }
    if (s.nativa && ic.nativaTroncal !== null && ic.nativaTroncal !== s.nativa.numero) {
        return puerto + " tiene la nativa " + ic.nativaTroncal + ", y es la " + s.nativa.numero;
    }
    return null;
}

// Con red nativa, toda troncal la lleva.
function _lineasNativa(s) {
    return s.nativa ? [" switchport trunk native vlan " + s.nativa.numero, " no shutdown"] : [];
}

function _traeNativa(ic, s) {
    return !s.nativa || !!(ic && ic.nativaTroncal === s.nativa.numero);
}

function _troncal(d, puerto, s) {
    var ic = _config(d, puerto);
    var lineas = ["interface " + puerto];
    if (_pideEncapsulacion(d)) { lineas.push(" switchport trunk encapsulation dot1q"); }
    lineas.push(" switchport mode trunk");
    lineas = lineas.concat(_lineasNativa(s));
    return _orden("troncal", lineas, !!(ic && ic.modo === "trunk" && _traeNativa(ic, s)), _malEnTroncal(ic, puerto, s));
}

function _canal(d, puertos, grupo, modo, s) {
    var lineas = [_cabecera(puertos)];
    if (_pideEncapsulacion(d)) { lineas.push(" switchport trunk encapsulation dot1q"); }
    lineas.push(" switchport mode trunk");
    lineas = lineas.concat(_lineasNativa(s), [" channel-group " + grupo + " mode " + modo]);
    var mal = null;
    puertos.forEach(function (p) {
        var ic = _config(d, p);
        mal = mal || _malEnTroncal(ic, p, s);
        // En el canal y sin troncal: agregarla después no le llega al Port-channel.
        if (!mal && ic && ic.canal !== null && ic.modo !== "trunk") { mal = p + " está en un canal sin ser troncal"; }
    });
    return _orden("canal", lineas, puertos.every(function (p) {
        var ic = _config(d, p);
        return ic !== null && ic.canal !== null && ic.modo === "trunk" && _traeNativa(ic, s);
    }), mal);
}

function _malEnAcceso(ic, puerto, vlan) {
    if (!ic) { return null; }
    if (ic.ruteado) { return puerto + " tiene no switchport, y es de una pc"; }
    if (ic.apagada) { return puerto + " está apagado, y es de una pc"; }
    if (ic.modo === "trunk") { return puerto + " es troncal, y es de una pc"; }
    if (ic.accesoVlan !== null && ic.accesoVlan !== vlan) { return puerto + " está en la vlan " + ic.accesoVlan + ", y su pc es de la vlan " + vlan; }
    return null;
}

function _accesos(d, pcs) {
    var porVlan = {};
    pcs.forEach(function (p) {
        if (p.equipo === d.nombre && p.vlan !== null) { (porVlan[p.vlan] = porVlan[p.vlan] || []).push(p.puerto); }
    });
    return Object.keys(porVlan).map(Number).sort(function (a, b) { return a - b; }).map(function (vlan) {
        var puertos = ordenar(porVlan[vlan], natural), mal = null;
        puertos.forEach(function (p) { mal = mal || _malEnAcceso(_config(d, p), p, vlan); });
        var presente = puertos.every(function (p) {
            var ic = _config(d, p);
            return ic !== null && ic.accesoVlan === vlan;
        });
        return _orden("acceso", [_cabecera(puertos), " switchport mode access", " switchport access vlan " + vlan], presente, mal);
    });
}

function _pool(d, v) {
    var presente = !!d.cfg && d.cfg.pools.some(function (p) {
        return p.red === direccionDe(v.red) && p.mascara === mascaraDe(v.red.p) && p.gateway === v.gateway;
    });
    return _orden("dhcp", ["ip dhcp pool VLAN" + (v.enLista ? v.nombre : v.numero), " network " + direccionDe(v.red) + " " + mascaraDe(v.red.p),
                           " default-router " + v.gateway], presente);
}

// La línea IPv6 de una interfaz. Las que sobren se quitan, porque 'ipv6 address'
// agrega en vez de reemplazar como 'ip address'.
function lineasIpv6(ic, objetivo) {
    var quita = [], tiene = false;
    var obj = parseV6Prefijo(objetivo);
    (ic ? ic.ipv6 : []).forEach(function (actual) {
        var a = parseV6Prefijo(actual);
        if (a && a.p === obj.p && iguales6(a.g, obj.g)) { tiene = true; }
        else { quita.push(" no ipv6 address " + actual); }
    });
    return { quita: quita, linea: " ipv6 address " + texto6(obj.g) + "/" + obj.p, bien: tiene && !quita.length };
}

function parseV6Prefijo(t) {
    var p = String(t).split("/");
    var g = parse6(p[0]);
    return g ? { g: g, p: p.length > 1 ? +p[1] : 128 } : null;
}

function generarOrdenes(plan) {
    var g = plan.g;
    plan.sitios.forEach(function (s) {
        var dueno = s.dueno;
        var enCanal = {};
        s.canales.forEach(function (c) {
            c.puertosA.forEach(function (p) { enCanal[c.a + "\u0000" + p] = true; });
            c.puertosB.forEach(function (p) { enCanal[c.b + "\u0000" + p] = true; });
        });
        var troncales = {};
        _cablesDelSitio(s, g).forEach(function (c) {
            [[c[0], c[1]], [c[2], c[3]]].forEach(function (par) {
                if (enCanal[par[0] + "\u0000" + par[1]]) { return; }
                if (par[0] === dueno.nombre && !dueno.esMulticapa) { return; }
                (troncales[par[0]] = troncales[par[0]] || []).push(par[1]);
            });
        });

        // Con red nativa, también son troncales los puertos de la controladora y los AP, y el segundo
        // cable del router que la lleva.
        if (s.nativa) {
            s.inalambricos.forEach(function (x) { (troncales[x.equipo] = troncales[x.equipo] || []).push(x.puerto); });
            if (s.routerNativa) { (troncales[dueno.nombre] = troncales[dueno.nombre] || []).push(s.routerNativa.core.puerto); }
        }

        var ordenes = [];
        function ipv6De(v, ic) {
            if (!v.red6 || v.reservado6) { return { lineas: [], bien: true, sobra: false }; }
            var l = lineasIpv6(ic, texto6(v.gw6) + "/" + v.red6.p);
            return { lineas: l.quita.concat([l.linea]), bien: l.bien, sobra: l.quita.length > 0 };
        }
        // Lo que una SVI o subinterfaz ya trae y no es lo de su nota. Que le falte algo no es error.
        function malEn(nombre, ic, v, seis) {
            if (!ic) { return null; }
            var mascara = mascaraDe(v.red.p);
            if (ic.ip && (ic.ip !== v.gateway || ic.mascara !== mascara)) {
                return nombre + " tiene " + ic.ip + " " + ic.mascara + ", y le toca " + v.gateway + " " + mascara;
            }
            // La VLAN 1 viene apagada de fábrica.
            if (ic.apagada && (ic.ip || v.numero !== 1)) { return nombre + " está apagada"; }
            return seis.sobra ? nombre + " tiene una ipv6 que no es la de su nota" : null;
        }
        if (dueno.esMulticapa) {
            ordenes = ordenes.concat(_vlansBd(dueno, _vlansDelSitio(s)));
            s.vlans.forEach(function (v) {
                var ic = _config(dueno, "Vlan" + v.numero);
                var seis = ipv6De(v, ic);
                ordenes.push(_orden("svi", ["interface Vlan" + v.numero, " ip address " + v.gateway + " " + mascaraDe(v.red.p)]
                    .concat(seis.lineas, [" no shutdown"]),
                    !!(ic && ic.ip === v.gateway && ic.mascara === mascaraDe(v.red.p) && !ic.apagada && seis.bien),
                    malEn("Vlan" + v.numero, ic, v, seis)));
                if (!v.reservado) { ordenes.push(_pool(dueno, v)); }
            });
        } else if (s.puertoLan) {
            var ic0 = _config(dueno, s.puertoLan);
            ordenes.push(_orden("puerto", ["interface " + s.puertoLan, " no shutdown"], !!(ic0 && !ic0.apagada)));
            s.vlans.forEach(function (v) {
                var sub = s.puertoLan + "." + v.numero;
                var ic = _config(dueno, sub);
                var seis = ipv6De(v, ic);
                ordenes.push(_orden("subinterfaz", ["interface " + sub, " encapsulation dot1Q " + v.numero + (v.nativa ? " native" : ""),
                                                    " ip address " + v.gateway + " " + mascaraDe(v.red.p)].concat(seis.lineas),
                    !!(ic && ic.vlan === v.numero && (ic.nativa || !v.nativa) && ic.ip === v.gateway && ic.mascara === mascaraDe(v.red.p) && !ic.apagada && seis.bien),
                    malEn(sub, ic, v, seis) || (ic && ic.vlan === v.numero && v.nativa && !ic.nativa ? sub + " no es nativa, y su vlan sí" : null)));
                if (!v.reservado) { ordenes.push(_pool(dueno, v)); }
            });
        }
        ordenes = ordenes.concat(_ordenesDeSwitch(dueno, s, troncales, false));
        plan.ordenes[dueno.nombre] = ordenes;
        ordenar(Object.keys(s.switches), function (n) { return [s.switches[n], n]; }).forEach(function (n) {
            plan.ordenes[n] = _ordenesDeSwitch(g.equipos[n], s, troncales, true);
        });
    });
    (plan.ina ? plan.ina.servidores : []).forEach(function (srv) { _ordenesDelServidor(plan, srv); });
}

// La puerta del server, y lo que dejó donde estaba antes.
function _ordenesDelServidor(plan, srv) {
    function de(n) { return (plan.ordenes[n] = plan.ordenes[n] || []); }
    var d = plan.g.equipos[srv.router], ic = _config(d, srv.puertoRouter), lineas = ["interface " + srv.puertoRouter];
    if (srv.vlan) { lineas.push(" encapsulation dot1Q " + srv.vlan); }
    if (d.esMulticapa) { lineas.push(" no switchport"); }
    lineas.push(" ip address " + srv.gw + " " + srv.mascara, " no shutdown");
    de(srv.router).push(_orden("servidor", lineas, !!(ic && ic.ip === srv.gw && ic.mascara === srv.mascara && !ic.apagada
        && (!d.esMulticapa || ic.ruteado) && (!srv.vlan || ic.vlan === srv.vlan))));
    if (srv.acceso) {
        var ia = _config(plan.g.equipos[srv.acceso.equipo], srv.acceso.puerto);
        de(srv.acceso.equipo).push(_orden("acceso", ["interface " + srv.acceso.puerto, " switchport mode access", " switchport access vlan " + srv.vlan, " no shutdown"],
            !!(ia && ia.accesoVlan === srv.vlan && !ia.ruteado && !ia.apagada)));
    }
    srv.viejos.forEach(function (v) { de(v.equipo).push(_orden("servidor", ["interface " + v.puerto, " no ip address"], false)); });
    srv.rutasDeSobra.forEach(function (r) { de(srv.router).push(_orden("servidor", ["no ip route " + r.join(" ")], false)); });
}

function _cablesDelSitio(s, g) {
    var miembros = {};
    Object.keys(s.switches).forEach(function (n) { miembros[n] = true; });
    miembros[s.dueno.nombre] = true;
    return g.cables.filter(function (c) {
        return miembros[c[0]] && miembros[c[2]] && !g.equipos[c[0]].esHost && !g.equipos[c[2]].esHost;
    });
}

function _ordenesDeSwitch(d, s, troncales, incluirVlans) {
    var ordenes = incluirVlans ? _vlansBd(d, _vlansDelSitio(s)) : [];
    if (s.raiz === d.nombre) {
        var presente = !!d.cfg && d.cfg.stp[1] !== undefined && d.cfg.stp[1] <= PRIORIDAD_RAIZ;
        ordenes.push(_orden("stp", ["spanning-tree vlan 1 priority " + PRIORIDAD_RAIZ], presente));
    }
    (troncales[d.nombre] || []).slice().sort().forEach(function (p) {
        ordenes.push(_troncal(d, p, s));
    });
    s.canales.forEach(function (c) {
        if (c.a === d.nombre) { ordenes.push(_canal(d, c.puertosA, c.grupoA, c.modoA, s)); }
        if (c.b === d.nombre) { ordenes.push(_canal(d, c.puertosB, c.grupoB, c.modoB, s)); }
    });
    return ordenes.concat(_accesos(d, s.pcs));
}

// Las puertas de enlace del plan entran al modelo, así el ruteo ya ve esas redes. Y la IP que
// traiga un puerto que el plan usa en capa 2 sale: sobra, y su red no debe rutearse.
function aplicarAlModelo(plan, topo) {
    (plan.ina ? plan.ina.servidores : []).forEach(function (srv) {
        var d = topo.porNombre(srv.router), i = d.interfaz(srv.puertoRouter);
        if (!i && srv.vlan) {
            i = _nuevaIfaz(srv.puertoRouter);
            _insertarIfaz(d.interfaces, i, srv.puertoRouter.split(".")[0]);
        }
        if (i) {
            i.ip = srv.gw;
            i.mascara = srv.mascara;
            i.encendida = true;
            i.planeada = true;
            if (srv.vlan) { i.vlan = String(srv.vlan); }
        }
        srv.viejos.forEach(function (v) {
            var o = topo.porNombre(v.equipo).interfaz(v.puerto);
            o.ip = o.mascara = null;
        });
        d.rutas = d.rutas.filter(function (r) { return srv.rutasDeSobra.indexOf(r) < 0; });
    });
    plan.sitios.forEach(function (s) {
        var dueno = s.dueno;
        _cablesDelSitio(s, plan.g).forEach(function (c) {
            [[c[0], c[1]], [c[2], c[3]]].forEach(function (par) {
                if (par[0] === dueno.nombre && !dueno.esMulticapa) { return; }
                var i = plan.g.equipos[par[0]].interfaz(par[1]);
                if (i && i.configurada) { i.ip = i.mascara = null; }
            });
        });
        if (!dueno.esMulticapa && s.puertoLan && ipSuelta(topo, dueno, s.puertoLan)) {
            var lan = dueno.interfaz(s.puertoLan);
            if (lan) { lan.ip = lan.mascara = null; }
        }
        if (!dueno.esMulticapa && !s.puertoLan) { return; }
        s.vlans.forEach(function (v) {
            var nombre = dueno.esMulticapa ? "Vlan" + v.numero : s.puertoLan + "." + v.numero;
            var mascara = mascaraDe(v.red.p);
            var actual = dueno.interfaz(nombre);
            if (actual === null) {
                actual = _nuevaIfaz(nombre);
                _insertarIfaz(dueno.interfaces, actual, dueno.esMulticapa ? null : s.puertoLan);
            }
            if (actual.ip !== v.gateway || actual.mascara !== mascara) { actual.planeada = true; }
            actual.ip = v.gateway;
            actual.mascara = mascara;
            actual.encendida = true;
            actual.vlan = String(v.numero);
            actual.red6 = v.red6 && !v.reservado6 ? v.red6 : null;
            actual.gw6 = v.red6 && !v.reservado6 ? v.gw6 : null;
        });
    });
}
