// Del XML de Packet Tracer al modelo: equipos, cables, notas y running-config.
// Es pkt/modelo.py y pkt/configuracion.py, sólo con lo que el módulo necesita.

var _TIPOS_RUTEO = ["router", "multilayer", "layer3", "l3", "firewall", "asa"];
var _TIPOS_SWITCH = ["switch", "bridge", "hub", "repeater", "access point", "wrt"];
var _TIPOS_HOST = ["pc", "laptop", "server", "printer", "tablet", "phone", "tv",
                   "host", "iot", "camera", "sbc", "mcu"];
var _MODELOS_L3 = ["3560", "3650", "3750", "3850", "4500", "6500", "6800",
                   "9200", "9300", "9400", "9500"];

function _alguno(lista, texto) {
    return lista.some(function (p) { return texto.indexOf(p) >= 0; });
}

function _entidades(t) {
    if (t.indexOf("&") < 0) { return t; }
    return t.replace(/&(lt|gt|amp|apos|quot|#\d+|#x[0-9a-fA-F]+);/g, function (_, e) {
        if (e === "lt") { return "<"; }
        if (e === "gt") { return ">"; }
        if (e === "amp") { return "&"; }
        if (e === "apos") { return "'"; }
        if (e === "quot") { return '"'; }
        return String.fromCharCode(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
}

function _etiqueta(trozo, nombre) {
    var abre = trozo.indexOf("<" + nombre + ">"), ini = abre + nombre.length + 2;
    if (abre < 0) {
        // Con atributos: <TEXT translate="true">.
        abre = trozo.indexOf("<" + nombre + " ");
        if (abre < 0) { return ""; }
        ini = trozo.indexOf(">", abre) + 1;
    }
    var fin = trozo.indexOf("</" + nombre + ">", ini);
    if (fin < 0) { return ""; }
    var t = trozo.substring(ini, fin);
    if (t.indexOf("<![CDATA[") === 0) { return t.substring(9, t.length - 3); }
    return _entidades(t);
}

function _atributo(attrs, nombre) {
    var m = new RegExp("\\b" + nombre + '="([^"]*)"').exec(attrs);
    return m ? _entidades(m[1]) : "";
}

// --- running-config --------------------------------------------------------------

function _nuevaIfazCfg(nombre) {
    return { nombre: nombre, ip: null, mascara: null, ipv6: [], apagada: false, vlan: null,
             nativa: false, accesoVlan: null, modo: null, canal: null, modoCanal: null,
             encapsulacion: null, ruteado: false, permitidas: null, nativaTroncal: null,
             esSub: nombre.indexOf(".") >= 0, padre: nombre.indexOf(".") >= 0 ? nombre.split(".")[0] : null };
}

function expandirVlans(texto) {
    var salida = [];
    (texto || "").split(",").forEach(function (parte) {
        var d = parte.trim().split("-");
        var a = parseInt(d[0], 10), b = d.length > 1 ? parseInt(d[1], 10) : a;
        if (!isNaN(a) && !isNaN(b)) {
            for (var n = a; n <= b; n++) { salida.push(n); }
        }
    });
    return salida;
}

function analizarConfig(lineas) {
    var cfg = { hostname: "", interfaces: [], rutas: [], rutas6: [], ruteoIp: null, ruteoIpv6: false,
                pools: [], vlans: [], stp: {}, excluidas: [], sinDhcp: false, lineas: lineas.slice(),
                porNombre: function (n) {
                    n = (n || "").toLowerCase();
                    for (var i = 0; i < this.interfaces.length; i++) {
                        if (this.interfaces[i].nombre.toLowerCase() === n) { return this.interfaces[i]; }
                    }
                    return null;
                } };
    var ifaz = null, pool = null, vlanActual = null;
    lineas.forEach(function (cruda) {
        var linea = (cruda || "").replace(/\s+$/, "");
        if (!linea.trim() || linea.trim() === "!") { return; }
        var sangrada = linea[0] === " ";
        var p = linea.trim().split(/\s+/);
        var clave = p[0].toLowerCase();
        if (!sangrada) {
            ifaz = pool = vlanActual = null;
            if (clave === "hostname" && p.length > 1) {
                cfg.hostname = p[1];
            } else if (clave === "interface" && p.length > 1) {
                ifaz = _nuevaIfazCfg(p[1]);
                cfg.interfaces.push(ifaz);
            } else if (clave === "vlan" && p.length > 1 && /^\d+$/.test(p[1])) {
                vlanActual = +p[1];
                cfg.vlans.push([vlanActual, ""]);
            } else if (clave === "ip" && p.length >= 2) {
                var sub = p[1].toLowerCase();
                if (sub === "routing") {
                    cfg.ruteoIp = true;
                } else if (sub === "route" && p.length >= 5 && esIp(p[2])) {
                    cfg.rutas.push([p[2], p[3], p[4]]);
                } else if (sub === "dhcp" && p.length >= 4 && p[2].toLowerCase() === "pool") {
                    pool = { nombre: p[3], red: null, mascara: null, gateway: null };
                    cfg.pools.push(pool);
                } else if (sub === "dhcp" && p.length >= 4 && p[2].toLowerCase() === "excluded-address" && esIp(p[3])) {
                    cfg.excluidas.push([ipAEntero(p[3]), ipAEntero(p.length > 4 && esIp(p[4]) ? p[4] : p[3])]);
                }
            } else if (clave === "no" && p.length >= 3 && p[1].toLowerCase() === "ip"
                       && p[2].toLowerCase() === "routing") {
                cfg.ruteoIp = false;
            } else if (clave === "no" && p.length >= 3 && p[1].toLowerCase() === "service"
                       && p[2].toLowerCase() === "dhcp") {
                cfg.sinDhcp = true;
            } else if (clave === "ipv6" && p.length >= 2) {
                var sub6 = p[1].toLowerCase();
                if (sub6 === "unicast-routing") {
                    cfg.ruteoIpv6 = true;
                } else if (sub6 === "route" && p.length >= 4) {
                    cfg.rutas6.push([p[2], p[3]]);
                }
            } else if (clave === "spanning-tree" && p.length >= 5 && p[1].toLowerCase() === "vlan"
                       && p[3].toLowerCase() === "priority") {
                expandirVlans(p[2]).forEach(function (n) { cfg.stp[n] = parseInt(p[4], 10); });
            }
            return;
        }
        if (ifaz !== null) {
            _lineaIfaz(ifaz, p);
        } else if (pool !== null) {
            if (clave === "network" && p.length >= 3) { pool.red = p[1]; pool.mascara = p[2]; }
            else if (clave === "default-router" && p.length >= 2) { pool.gateway = p[1]; }
        } else if (vlanActual !== null && clave === "name" && p.length > 1) {
            var nombre = p.slice(1).join(" ");
            cfg.vlans.forEach(function (v) {
                if (v[0] === vlanActual) { v[1] = nombre; }
            });
        }
    });
    return cfg;
}

function _lineaIfaz(i, p) {
    var c = p[0].toLowerCase(), c1 = p.length > 1 ? p[1].toLowerCase() : "";
    if (c === "shutdown") {
        i.apagada = true;
    } else if (c === "no" && c1 === "shutdown") {
        i.apagada = false;
    } else if (c === "no" && c1 === "switchport") {
        i.ruteado = true;
    } else if (c === "channel-group" && p.length >= 2) {
        i.canal = parseInt(p[1], 10);
        if (p.length >= 4 && p[2].toLowerCase() === "mode") { i.modoCanal = p[3].toLowerCase(); }
    } else if (c === "encapsulation" && p.length >= 3) {
        i.vlan = parseInt(p[2], 10);
        i.nativa = p.length > 3 && p[3].toLowerCase() === "native";
    } else if (c === "ip" && p.length >= 4 && c1 === "address") {
        if (esIp(p[2]) && esIp(p[3])) { i.ip = p[2]; i.mascara = p[3]; }
    } else if (c === "ipv6" && p.length >= 3 && c1 === "address") {
        if (p[2].indexOf(":") >= 0) { i.ipv6.push(p[2]); }
    } else if (c === "switchport" && p.length >= 2) {
        if (c1 === "mode" && p.length > 2) {
            i.modo = p[2].toLowerCase();
        } else if (c1 === "trunk" && p.length >= 4 && p[2].toLowerCase() === "encapsulation") {
            i.encapsulacion = p[3].toLowerCase();
        } else if (c1 === "trunk" && p.length >= 5 && p[2].toLowerCase() === "allowed" && p[3].toLowerCase() === "vlan") {
            i.permitidas = expandirVlans(p.slice(4).join(""));
        } else if (c1 === "trunk" && p.length >= 5 && p[2].toLowerCase() === "native" && p[3].toLowerCase() === "vlan") {
            i.nativaTroncal = parseInt(p[4], 10);
        } else if (c1 === "access" && p.length >= 4 && p[2].toLowerCase() === "vlan") {
            i.accesoVlan = parseInt(p[3], 10);
            i.modo = i.modo || "access";
        }
    }
}

// --- equipos ----------------------------------------------------------------------

function _nuevaIfaz(nombre) {
    return { nombre: nombre, ip: null, mascara: null, encendida: true, vlan: null, planeada: false,
             ipv6: [], red6: null, gw6: null,
             get configurada() { return !!this.ip && this.ip !== "0.0.0.0" && !!this.mascara; } };
}

function Equipo(nombre, tipo, modelo) {
    this.nombre = nombre;
    this.tipo = tipo;
    this.modelo = modelo;
    this.desc = (tipo + " " + modelo).toLowerCase();
    this.interfaces = [];
    this.gateway = null;
    this.rutas = [];
    this.ruteoIp = null;
    this.vlans = [];
    this.hostname = "";
    this.pools = [];
    this.cfg = null;
    this.x = null;
    this.y = null;
    this.soloCapa2 = false;      // multicapa que aquí sólo hace de switch
}

Equipo.prototype.interfacesIp = function () {
    return this.interfaces.filter(function (i) { return i.configurada; });
};

Equipo.prototype.redes = function () {
    var salida = [];
    this.interfacesIp().forEach(function (i) {
        var r = redDe(i.ip, i.mascara);
        if (r && !salida.some(function (o) { return mismaRed(o, r); })) { salida.push(r); }
    });
    return salida;
};

Equipo.prototype.interfaz = function (puerto) {
    var n = puerto.toLowerCase();
    for (var i = 0; i < this.interfaces.length; i++) {
        if (this.interfaces[i].nombre.toLowerCase() === n) { return this.interfaces[i]; }
    }
    return null;
};

Object.defineProperties(Equipo.prototype, {
    esRuteador: { get: function () {
        if (this.soloCapa2) { return false; }
        if (_alguno(_TIPOS_RUTEO, this.desc) || _alguno(_MODELOS_L3, this.desc)) { return true; }
        if (_alguno(_TIPOS_HOST, this.desc)) { return false; }
        return this.redes().length >= 2;
    } },
    esMulticapa: { get: function () { return this.esRuteador && _alguno(_TIPOS_SWITCH, this.desc); } },
    esHost: { get: function () { return _alguno(_TIPOS_HOST, this.desc); } },
    esControladora: { get: function () { return this.tipo === "WirelessLanController"; } },
    esAp: { get: function () { return this.tipo === "LightWeightAccessPoint"; } },
    esServidor: { get: function () { return this.tipo === "Server"; } },
    esTelefono: { get: function () { return this.tipo === "Pda" || this.tipo === "TabletPC"; } },
    esSwitch: { get: function () { return !this.esRuteador && _alguno(_TIPOS_SWITCH, this.desc); } },
    capazCapa3: { get: function () {
        return _alguno(_TIPOS_RUTEO, this.desc) || _alguno(_MODELOS_L3, this.desc);
    } }
});

function _insertarIfaz(lista, ifaz, padre) {
    if (padre) {
        var objetivo = padre.toLowerCase();
        for (var k = lista.length - 1; k >= 0; k--) {
            var actual = lista[k].nombre.toLowerCase();
            if (actual === objetivo || actual.indexOf(objetivo + ".") === 0) {
                lista.splice(k + 1, 0, ifaz);
                return;
            }
        }
    }
    lista.push(ifaz);
}

function _aplicarConfig(d, cfg) {
    d.hostname = cfg.hostname;
    cfg.interfaces.forEach(function (ic) {
        var actual = d.interfaz(ic.nombre);
        if (actual === null) {
            actual = _nuevaIfaz(ic.nombre);
            _insertarIfaz(d.interfaces, actual, ic.padre);
        }
        actual.ip = ic.ip;
        actual.mascara = ic.mascara;
        actual.ipv6 = ic.ipv6.slice();
        actual.encendida = !ic.apagada;
        if (ic.vlan !== null) { actual.vlan = String(ic.vlan); }
        else if (ic.accesoVlan !== null) { actual.vlan = String(ic.accesoVlan); }
    });
    if (cfg.rutas.length) { d.rutas = cfg.rutas.slice(); }
    if (cfg.ruteoIp !== null) { d.ruteoIp = cfg.ruteoIp; }
    else if (_alguno(_TIPOS_SWITCH, d.desc)) { d.ruteoIp = false; }
    d.pools = cfg.pools.slice();
    var nombres = {};
    cfg.vlans.forEach(function (v) { if (v[1]) { nombres[v[0]] = v[1]; } });
    d.vlans = d.vlans.length
        ? d.vlans.map(function (v) { return [v[0], nombres[v[0]] || v[1]]; })
        : cfg.vlans;
}

function _lineasDe(bloque, nombre) {
    var abre = bloque.indexOf("<" + nombre + ">");
    if (abre < 0) { return []; }
    var fin = bloque.indexOf("</" + nombre + ">", abre);
    if (fin < 0) { return []; }
    var trozo = bloque.substring(abre, fin), salida = [], re = /<LINE>([^<]*)<\/LINE>|<LINE\/>/g, m;
    while ((m = re.exec(trozo)) !== null) { salida.push(_entidades(m[1] || "").replace(/\s+$/, "")); }
    return salida;
}

function _leerEquipo(b) {
    var ini = b.indexOf("<ENGINE>");
    if (ini < 0) { return null; }
    var mt = /<TYPE([^>]*)>([^<]*)<\/TYPE>/.exec(b.substring(ini, ini + 400));
    var mn = /<NAME[^>]*>([^<]*)<\/NAME>/.exec(b.substring(ini, ini + 800));
    if (!mt || !mn || !mn[1].trim()) { return null; }
    var tipo = mt[2].trim();
    var modelo = (_atributo(mt[1], "model") + " " + _atributo(mt[1], "customModel")).trim();
    var d = new Equipo(_entidades(mn[1]).trim(), tipo, modelo);

    // Lo que cuelga directo de ENGINE; los puertos (de hosts) van aparte.
    var g = /<GATEWAY>([^<]*)<\/GATEWAY>/.exec(b);
    if (g && esIp(g[1].trim()) && g[1].trim() !== "0.0.0.0") { d.gateway = g[1].trim(); }

    // La última: las de antes son copias en los vlan.dat de FILE_MANAGER, que
    // pueden ir atrasadas; la de ENGINE es la que vale.
    var ve = b.lastIndexOf("<VLANS>");
    if (ve >= 0) {
        var trozo = b.substring(ve, b.indexOf("</VLANS>", ve));
        var rv = /<VLAN\b([^>]*)\/?>/g, mv;
        while ((mv = rv.exec(trozo)) !== null) {
            var numero = _atributo(mv[1], "number");
            if (/^\d+$/.test(numero) && +numero < 1002) { d.vlans.push([+numero, _atributo(mv[1], "name")]); }
        }
        d.vlans = ordenar(d.vlans, function (v) { return v[0]; });
    }

    if (d.esHost) {
        // En una PC sólo importa si trae IP: de ahí se deduce su VLAN.
        var rp = /<PORT>[\s\S]*?<\/PORT>/g, mp;
        while ((mp = rp.exec(b)) !== null) {
            var ip = _etiqueta(mp[0], "IP").trim(), sub = _etiqueta(mp[0], "SUBNET").trim();
            if (esIp(ip) && ip !== "0.0.0.0" && esIp(sub)) {
                var ifz = _nuevaIfaz("puerto" + d.interfaces.length);
                ifz.ip = ip;
                ifz.mascara = sub;
                d.interfaces.push(ifz);
            }
        }
    } else {
        var lineas = _lineasDe(b, "RUNNINGCONFIG");
        if (!lineas.length) { lineas = _lineasDe(b, "STARTUPCONFIG"); }
        if (lineas.length) {
            d.cfg = analizarConfig(lineas);
            _aplicarConfig(d, d.cfg);
        }
    }

    var lo = b.indexOf("<LOGICAL>");
    if (lo >= 0) {
        var seg = b.substring(lo, lo + 200);
        var x = parseFloat(_etiqueta(seg, "X")), y = parseFloat(_etiqueta(seg, "Y"));
        if (!isNaN(x) && !isNaN(y)) { d.x = x; d.y = y; }
    }
    leerInalambrico(d, b);
    var ref = _etiqueta(b, "SAVE_REF_ID").trim();
    return { equipo: d, ref: ref };
}

// El texto se queda igual de largo (sin tabuladores ni \r): así las posiciones
// valen también en el original, que es el que se corrige con el botón de pánico.
function _leerNotas(xml) {
    var notas = [], re = /<NOTE\b([^>]*)>([\s\S]*?)<\/NOTE>/g, m;
    while ((m = re.exec(xml)) !== null) {
        var x = parseFloat(_etiqueta(m[2], "X")), y = parseFloat(_etiqueta(m[2], "Y"));
        var original = _etiqueta(m[2], "TEXT");
        var texto = original.replace(/\r/g, "\n").replace(/\t/g, " ");
        if (texto.trim()) {
            notas.push({ x: isNaN(x) ? null : x, y: isNaN(y) ? null : y, z: parseFloat(_etiqueta(m[2], "Z")) || 0,
                         uuid: _atributo(m[1], "uuid"), original: original, texto: texto });
        }
    }
    return notas;
}

function leerTopologia(xml) {
    var topo = { dispositivos: [], enlaces: [], notas: [], avisos: [],
                 get ruteadores() { return this.dispositivos.filter(function (d) { return d.esRuteador; }); },
                 porNombre: function (n) {
                     for (var i = 0; i < this.dispositivos.length; i++) {
                         if (this.dispositivos[i].nombre === n) { return this.dispositivos[i]; }
                     }
                     return null;
                 },
                 visibles: function () { return nombresVisibles(this); } };
    var refs = {}, pos = 0;
    for (;;) {
        var ini = xml.indexOf("<DEVICE>", pos);
        if (ini < 0) { break; }
        var fin = xml.indexOf("</DEVICE>", ini);
        if (fin < 0) { break; }
        var leido = _leerEquipo(xml.substring(ini, fin));
        pos = fin + 9;
        if (leido === null) { continue; }
        topo.dispositivos.push(leido.equipo);
        if (leido.ref) { refs[leido.ref] = leido.equipo.nombre; }
    }
    var rc = /<CABLE>([\s\S]*?)<\/CABLE>/g, mc;
    while ((mc = rc.exec(xml)) !== null) {
        var desde = refs[_etiqueta(mc[1], "FROM").trim()], hasta = refs[_etiqueta(mc[1], "TO").trim()];
        var puertos = [], rp = /<PORT>([^<]*)<\/PORT>/g, mp;
        while ((mp = rp.exec(mc[1])) !== null) { puertos.push(mp[1].trim()); }
        if (desde && hasta && puertos.length >= 2) {
            topo.enlaces.push({ a: desde, pa: puertos[0], b: hasta, pb: puertos[1] });
        }
    }
    // Cada puerto con cable existe, aunque el running-config no lo nombre.
    topo.enlaces.forEach(function (e) {
        [[e.a, e.pa], [e.b, e.pb]].forEach(function (par) {
            var d = topo.porNombre(par[0]);
            if (d && !d.esHost && d.interfaz(par[1]) === null) { d.interfaces.push(_nuevaIfaz(par[1])); }
        });
    });
    topo.notas = _leerNotas(xml);
    return topo;
}

function nombresVisibles(topo) {
    var repetidos = {};
    topo.dispositivos.forEach(function (d) {
        if (d.hostname) { repetidos[d.hostname] = (repetidos[d.hostname] || 0) + 1; }
    });
    var salida = {};
    topo.dispositivos.forEach(function (d) {
        if (!d.hostname || d.hostname === d.nombre) { salida[d.nombre] = d.nombre; }
        else if (repetidos[d.hostname] === 1) { salida[d.nombre] = d.hostname; }
        else { salida[d.nombre] = d.hostname + " (" + d.nombre + ")"; }
    });
    return salida;
}
