// De la revisión a los comandos: estilo de las prácticas (pkt/formato.py), equipos
// que se rehacen (pkt/rehacer.py) y lo que falta por equipo (pkt/reporte.py).

var SEPARADOR = "===";
var _ABREVIADOS = [["enable", "EN"], ["configure terminal", "CONF T"], ["interface range", "INT RANGE"],
                   ["interface", "INT"], ["no interface", "NO INT"], ["ip address", "IP ADD"],
                   ["no ip address", "NO IP ADD"], ["no shutdown", "NO SHUT"]];
var _TIPOS_IFAZ = { gigabitethernet: "GI", fastethernet: "FA", ethernet: "ETH", serial: "SE",
                    "port-channel": "PO", loopback: "LO", vlan: "VLAN " };
var _CON_NOMBRE = ["hostname ", "name ", "ip dhcp pool ", "no ip dhcp pool "];

function _interfazEstilo(texto) {
    return texto.replace(/\b(gigabitethernet|port-channel|fastethernet|ethernet|loopback|serial|vlan)\s*(?=\d)/ig, function (_, t) {
        return _TIPOS_IFAZ[t.toLowerCase()];
    }).toUpperCase();
}

function renglon(linea) {
    var s = linea.trim(), bajo = s.toLowerCase(), i;
    for (i = 0; i < _ABREVIADOS.length; i++) {
        var completo = _ABREVIADOS[i][0], corto = _ABREVIADOS[i][1];
        if (bajo === completo || bajo.indexOf(completo + " ") === 0) {
            var resto = s.substring(completo.length);
            return corto + (completo.indexOf("interface") >= 0 ? _interfazEstilo(resto) : resto.toUpperCase());
        }
    }
    for (i = 0; i < _CON_NOMBRE.length; i++) {
        if (bajo.indexOf(_CON_NOMBRE[i]) === 0) { return _CON_NOMBRE[i].toUpperCase() + s.substring(_CON_NOMBRE[i].length); }
    }
    return s.toUpperCase();
}

function estilo(lineas) {
    var ios = lineas.filter(function (l) { return l.trim(); }).map(function (l) { return l.replace(/\s+$/, ""); });
    var salida = ["EN", "CONF T"], enModo = false, corte = false;
    ios.forEach(function (linea, i) {
        if (linea.trim().indexOf("!") === 0) {
            corte = true;
            return;
        }
        var sangria = linea[0] === " ";
        var siguiente = "";
        for (var j = i + 1; j < ios.length; j++) {
            if (ios[j].trim().indexOf("!") !== 0) { siguiente = ios[j]; break; }
        }
        var abre = !sangria && siguiente[0] === " ";
        if (!sangria && (abre || enModo || corte) && salida[salida.length - 1] !== "") { salida.push(""); }
        corte = false;
        salida.push(renglon(linea));
        enModo = sangria || abre;
    });
    return salida;
}

function textoBloques(bloques) {
    return bloques.map(function (b) { return b.texto.replace(/\n+$/, ""); }).join("\n" + SEPARADOR + "\n") + (bloques.length ? "\n" : "");
}

// --- hostnames -----------------------------------------------------------------------------

var _LIENZO_DE_FABRICA = /^(Router|Switch|Multilayer Switch)\d+(\(\d+\))*$/;
var _CON_IOS = /^(Router|Switch|MultiLayerSwitch)$/;

function _hostnameDe(etiqueta) {
    var limpio = etiqueta.trim().replace(/[^A-Za-z0-9\-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").substring(0, 63).replace(/-+$/, "");
    return limpio && /^[A-Za-z]/.test(limpio) ? limpio : null;
}

function generarNombres(topo) {
    var res = { ordenes: {}, avisos: [] };
    topo.dispositivos.forEach(function (d) {
        // El nombre que dice la nota manda.
        if (d.hostnameNota) {
            var de = _hostnameDe(d.hostnameNota);
            if (de && de !== d.hostname) {
                d.hostname = de;
                res.ordenes[d.nombre] = [_orden("hostname", ["hostname " + de])];
            }
            return;
        }
        // Sin configuración puede ser un equipo sin IOS o uno que apenas está arrancando: justo
        // al abrir la práctica, el archivo aún no trae la de fábrica que tendrá en unos segundos.
        if (d.esHost || _LIENZO_DE_FABRICA.test(d.nombre) || (d.cfg === null && !_CON_IOS.test(d.tipo))) { return; }
        var actual = (d.hostname || "").toLowerCase();
        if (actual !== "" && actual !== "router" && actual !== "switch") { return; }
        var nuevo = _hostnameDe(d.nombre);
        if (nuevo === null) {
            res.avisos.push(d.nombre + ": su nombre en el lienzo no sirve como hostname");
            return;
        }
        if (nuevo === d.hostname) { return; }
        d.hostname = nuevo;
        res.ordenes[d.nombre] = [_orden("hostname", ["hostname " + nuevo])];
    });
    return res;
}

// --- equipos que se rehacen -------------------------------------------------------------------

function _forman(a, b) {
    var par = [a, b].sort().join("+");
    return par === "on+on" || par === "active+active" || par === "active+passive"
        || par === "desirable+desirable" || par === "auto+desirable";
}

function ipSuelta(topo, d, puerto) {
    var i = d.interfaz(puerto);
    if (i === null || !i.configurada) { return true; }
    var red = redDe(i.ip, i.mascara);
    return red !== null && !topo.dispositivos.some(function (o) {
        return o !== d && o.interfacesIp().some(function (x) { return contiene(red, x.ip); });
    });
}

// Cuántas direcciones le quedan a la VLAN para sus PCs: sin su puerta y sin lo excluido.
function _libresDeVlan(v, excluidas) {
    var primera = v.red.n + 1, ultima = v.red.n + tamanoRed(v.red.p) - 2, puerta = ipAEntero(v.gateway);
    var tramos = excluidas.concat([[puerta, puerta]]).map(function (x) {
        return [Math.max(x[0], primera), Math.min(x[1], ultima)];
    }).filter(function (x) { return x[0] <= x[1]; }).sort(function (a, b) { return a[0] - b[0]; });
    var libres = ultima - primera + 1, hasta = primera - 1;
    tramos.forEach(function (x) {
        if (x[1] > hasta) {
            libres -= x[1] - Math.max(x[0], hasta + 1) + 1;
            hasta = x[1];
        }
    });
    return libres;
}

// Una interfaz con IP encima de lo que dice el plan y que no es la que le toca: IOS no deja poner
// la buena mientras exista, así que su equipo se borra. Es lo que queda al intercambiar las redes
// de dos VLANs, al poner una máscara de más o una SVI que sobra.
function _estorbanAlPlan(topo, plan, correcciones, anota) {
    var planeadas = [];
    plan.sitios.forEach(function (s) {
        if (!s.dueno.esMulticapa && !s.puertoLan) { return; }
        s.vlans.forEach(function (v) {
            var suya = (s.dueno.esMulticapa ? "Vlan" + v.numero : s.puertoLan + "." + v.numero).toLowerCase();
            planeadas.push({ red: v.red, vlan: v.numero, gateway: v.gateway, suyas: [s.dueno.nombre + "\u0000" + suya],
                             texto: "la vlan " + v.numero + " de " + _nombreSitio(s) });
        });
    });
    correcciones.cables.forEach(function (t) {
        var r = t[1].configurada ? redDe(t[1].ip, t[1].mascara) : null;
        if (r !== null) {
            planeadas.push({ red: r, vlan: null, gateway: null, texto: "el enlace " + textoRed(r),
                             suyas: [t[0].nombre + "\u0000" + t[1].nombre.toLowerCase(), t[2].nombre + "\u0000" + t[3].nombre.toLowerCase()] });
        }
    });
    topo.dispositivos.forEach(function (d) {
        (d.cfg ? d.cfg.interfaces : []).forEach(function (ic) {
            var red = ic.ip && ic.mascara ? redDe(ic.ip, ic.mascara) : null;
            if (red === null) { return; }
            var clave = d.nombre + "\u0000" + ic.nombre.toLowerCase(), nombre = ic.nombre.toLowerCase();
            // Si es justo lo que dicen las notas no estorba, aunque otra nota se le encime: eso
            // no se arregla borrando el equipo.
            if (planeadas.some(function (x) { return x.suyas.indexOf(clave) >= 0 && mismaRed(red, x.red); })) { return; }
            var choca = planeadas.filter(function (x) {
                if (!traslapan(red, x.red) || x.suyas.indexOf(clave) >= 0) { return false; }
                // La SVI de administración de un switch, en su misma VLAN.
                return !(d.esSwitch && nombre === "vlan" + x.vlan && ic.ip !== x.gateway);
            })[0];
            if (choca) { anota(d, ic.nombre + " (" + textoRed(red) + ") se encima con " + choca.texto); }
        });
    });
}

function motivosRehacer(topo, plan, rutas, correcciones) {
    var salida = {};
    var vis = topo.visibles();
    function anota(d, t) {
        var lista = salida[d.nombre] = salida[d.nombre] || [];
        if (lista.indexOf(t) < 0) { lista.push(t); }
    }
    topo.ruteadores.forEach(function (router) {
        (rutas[router.nombre] || []).forEach(function (r) {
            if (r.malPuesta) {
                anota(router, "la ruta a " + textoRed(r.red) + " va por " + r.saltoConfigurado + ", que no lleva hacia allá (va por " + r.salto + ")");
            }
        });
    });
    var sitios = plan.sitios;
    var vlans = [];
    sitios.forEach(function (s) { s.vlans.forEach(function (v) { vlans.push([s.dueno.nombre, v]); }); });
    topo.dispositivos.forEach(function (d) {
        var propias = vlans.filter(function (x) { return x[0] === d.nombre; }).map(function (x) { return x[1]; });
        (d.cfg ? d.cfg.pools : []).forEach(function (pool) {
            var red = pool.red && pool.mascara ? redDe(pool.red, pool.mascara) : null;
            // Sin puerta todavía es un pool a medias: sólo le falta.
            if (red === null || propias.some(function (v) {
                return pool.red === direccionDe(v.red) && pool.mascara === mascaraDe(v.red.p) && (pool.gateway === v.gateway || pool.gateway === null);
            })) { return; }
            var choca = propias.filter(function (v) { return traslapan(red, v.red); });
            if (!choca.length) { choca = vlans.map(function (x) { return x[1]; }).filter(function (v) { return traslapan(red, v.red); }); }
            if (choca.length) {
                anota(d, "el pool " + pool.nombre + " (" + textoRed(red) + ", puerta " + (pool.gateway || "ninguna") + ") no es el de la vlan " + choca[0].numero + " (" + textoRed(choca[0].red) + ", puerta " + choca[0].gateway + ")");
            }
        });
    });
    sitios.forEach(function (s) {
        var planeados = {};
        s.canales.forEach(function (c) {
            var puntas = [[c.a, c.puertosA, c.modoA], [c.b, c.puertosB, c.modoB]].map(function (t) {
                var d = topo.porNombre(t[0]);
                t[1].forEach(function (p) { planeados[t[0] + "\u0000" + p.toLowerCase()] = true; });
                var hoy = {};
                t[1].forEach(function (p) {
                    var ic = d && d.cfg ? d.cfg.porNombre(p) : null;
                    var k = ic && ic.canal !== null ? ic.canal + "|" + (ic.modoCanal || "on") : "ninguno";
                    hoy[k] = true;
                });
                return { d: d, puertos: t[1], modo: t[2], hoy: Object.keys(hoy) };
            });
            puntas.forEach(function (x) {
                if (x.hoy.length > 1) { anota(x.d, "los puertos " + x.puertos.join(", ") + " de su etherchannel no están todos en el mismo canal y modo"); }
            });
            var pa = puntas[0], pb = puntas[1];
            if (pa.hoy.length > 1 || pb.hoy.length > 1 || (pa.hoy[0] === "ninguno" && pb.hoy[0] === "ninguno")) { return; }
            var ma = pa.hoy[0] === "ninguno" ? pa.modo : pa.hoy[0].split("|")[1];
            var mb = pb.hoy[0] === "ninguno" ? pb.modo : pb.hoy[0].split("|")[1];
            if (!_forman(ma, mb)) {
                [[pa, mb], [pb, ma]].forEach(function (y) {
                    if (y[0].hoy[0] !== "ninguno") {
                        anota(y[0].d, "su etherchannel en " + y[0].puertos.join(", ") + " está en modo " + y[0].hoy[0].split("|")[1] + " y del otro lado va " + y[1] + ": así no se forma");
                    }
                });
            }
        });
        Object.keys(s.switches).concat([s.dueno.nombre]).forEach(function (nombre) {
            var d = topo.porNombre(nombre);
            var ics = d && d.cfg ? d.cfg.interfaces : [];
            for (var i = 0; i < ics.length; i++) {
                var ic = ics[i];
                if (ic.canal !== null && ic.nombre.toLowerCase().indexOf("port-channel") !== 0 && !planeados[nombre + "\u0000" + ic.nombre.toLowerCase()]) {
                    anota(d, ic.nombre + " está en el canal " + ic.canal + ", y ese puerto no va en etherchannel");
                    break;
                }
            }
        });
        if (s.raiz !== null) {
            Object.keys(s.switches).concat([s.dueno.nombre]).forEach(function (nombre) {
                var d = topo.porNombre(nombre);
                if (nombre === s.raiz || !d || !d.cfg) { return; }
                if (d.cfg.stp[1] !== undefined && d.cfg.stp[1] <= PRIORIDAD_RAIZ) {
                    anota(d, "tiene prioridad de stp en la vlan 1, y la raíz de su red es " + vis[s.raiz]);
                }
            });
        }
        var dueno = s.dueno, lan = s.puertoLan;
        if (dueno.esMulticapa || !lan || !dueno.cfg) { return; }
        var nums = _vlansDelSitio(s).map(function (v) { return v.numero; });
        dueno.cfg.interfaces.forEach(function (ic) {
            var nombre = ic.nombre.toLowerCase();
            if (nombre === lan.toLowerCase() && ic.ip && ipSuelta(topo, dueno, ic.nombre)) {
                anota(dueno, ic.nombre + " tiene la ip " + ic.ip + ", que no comparte nadie, y es el puerto de las subinterfaces de sus vlans");
            } else if (nombre.indexOf("vlan") === 0 && ic.ip) {
                anota(dueno, "tiene ip en " + ic.nombre + "; en un router las vlans van en subinterfaces");
            } else if (ic.esSub && ic.padre.toLowerCase() === lan.toLowerCase()) {
                var sufijo = ic.nombre.split(".")[1];
                var numero = /^\d+$/.test(sufijo) ? +sufijo : null;
                if (ic.vlan !== null && ic.vlan !== numero) {
                    anota(dueno, ic.nombre + " tiene encapsulation dot1q " + ic.vlan);
                } else if (nums.indexOf(numero) < 0 && (ic.ip || ic.vlan !== null)) {
                    anota(dueno, ic.nombre + " es de la vlan " + sufijo + ", que su red no tiene");
                }
            }
        });
    });

    // Lo que se vio al comparar cada orden y cada enlace con lo que hay.
    Object.keys(plan.ordenes).forEach(function (n) {
        plan.ordenes[n].forEach(function (o) { if (o.mal) { anota(topo.porNombre(n), o.mal); } });
    });
    Object.keys(correcciones.mal).forEach(function (n) {
        correcciones.mal[n].forEach(function (m) { anota(topo.porNombre(n), m); });
    });
    Object.keys(correcciones.ordenes).forEach(function (n) {
        correcciones.ordenes[n].forEach(function (o) {
            if (o.lineas.some(function (l) { return l.indexOf(" no ipv6 address") === 0; })) {
                anota(topo.porNombre(n), o.lineas[0].substring(10) + " tiene una ipv6 que no es la de su enlace");
            }
        });
    });
    _estorbanAlPlan(topo, plan, correcciones, anota);

    // Lo que deja a las PCs sin IP aunque el pool esté bien.
    sitios.forEach(function (s) {
        var cfg = s.dueno.cfg, activas = s.vlans.filter(function (v) { return !v.reservado; });
        if (!cfg || !activas.length) { return; }
        if (cfg.sinDhcp) { anota(s.dueno, "tiene apagado el dhcp (no service dhcp)"); }
        activas.forEach(function (v) {
            var pcs = s.pcs.filter(function (x) { return x.vlan === v.numero; }).length;
            var libres = cfg.excluidas.length ? _libresDeVlan(v, cfg.excluidas) : pcs;
            if (libres < pcs) {
                anota(s.dueno, "con sus excluded-address le quedan " + libres + " direcciones a la vlan " + v.numero + ", que tiene " + pcs + " pcs");
            }
        });
    });
    return salida;
}

// Lo que se borra de un equipo: todo lo de red. Sus contraseñas, su banner y sus consolas se quedan,
// porque las notas no dicen nada de eso y no hay de dónde volver a ponerlos.
var _BORRA_LINEA = /^(ip route |ipv6 route |ip dhcp excluded-address |ip nat )/;
var _BORRA_BLOQUE = /^(ip dhcp pool |router |ipv6 router |ip access-list |ipv6 access-list )/;
// Las interfaces que sólo existen porque alguien las creó.
var _INTERFAZ_CREADA = /\.|^port-channel|^loopback|^tunnel|^vlan(?!1$)/;
// Lo que se quita de un puerto sin decir su valor.
var _SIN_VALOR = /^(description|speed|duplex|mdix|bandwidth|delay|mtu|clock rate|switchport access vlan|switchport voice vlan|switchport trunk encapsulation|switchport trunk native vlan|switchport trunk allowed vlan)\b/;

function _quitarDePuerto(cuerpo, conSwitchport) {
    var deja = [], quita = [], alFinal = [];
    cuerpo.forEach(function (x) {
        var s = x.trim(), bajo = s.toLowerCase(), m;
        if (bajo === "no switchport") {
            alFinal.push(" switchport");
        } else if (bajo.indexOf("no ") === 0 || /^(duplex|speed|mdix) auto\b/.test(bajo) || bajo.indexOf("mac-address ") === 0) {
            deja.push(x);
        } else if (bajo === "shutdown") {
            // Apagado es como viene un puerto de router; el de un switch viene encendido.
            if (conSwitchport) { quita.push(" no shutdown"); } else { deja.push(x); }
        } else if (bajo.indexOf("ip address ") === 0) {
            quita.push(" no ip address");
            deja.push(" no ip address");
        } else if (bajo.indexOf("channel-group ") === 0) {
            // Y en Packet Tracer, si se borra el Port-channel antes, el puerto queda apagado.
            quita.push(" no channel-group", " no shutdown");
        } else if (bajo.indexOf("switchport mode ") === 0) {
            // Al último: con 'switchport nonegotiate' puesto no se deja quitar.
            alFinal.unshift(" no switchport mode");
        } else if ((m = _SIN_VALOR.exec(bajo))) {
            quita.push(" no " + m[1]);
        } else {
            quita.push(" no " + s);
        }
    });
    return { deja: deja, quita: quita.concat(alFinal) };
}

function quitarConfig(lineas, conSwitchport) {
    var limpias = [], arriba = [], puertos = [], creadas = [], i = 0;
    while (i < lineas.length) {
        var linea = lineas[i].replace(/\s+$/, "");
        var j = i + 1;
        while (j < lineas.length && lineas[j][0] === " ") { j++; }
        var cuerpo = lineas.slice(i + 1, j).map(function (x) { return x.replace(/\s+$/, ""); });
        var s = linea.trim(), bajo = s.toLowerCase();
        i = j;
        if (_BORRA_LINEA.test(bajo) || _BORRA_BLOQUE.test(bajo)) {
            arriba.push("no " + s);
            continue;
        }
        if (bajo === "no service dhcp") {
            arriba.push("service dhcp");
            continue;
        }
        // Si le toca capa 3, se vuelve a poner; si sólo hace de switch, no debe quedarse.
        if (bajo === "ip routing") {
            arriba.push("no ip routing");
            continue;
        }
        if (bajo.indexOf("ip default-gateway ") === 0) {
            arriba.push("no ip default-gateway");
            continue;
        }
        // Una lista de varias líneas se borra una sola vez.
        var lista = /^access-list (\S+)/.exec(bajo);
        if (lista) {
            if (arriba.indexOf("no access-list " + lista[1]) < 0) { arriba.push("no access-list " + lista[1]); }
            continue;
        }
        var m = /^spanning-tree vlan (\S+) priority \d+$/.exec(bajo);
        if (m) {
            arriba.push("no spanning-tree vlan " + m[1] + " priority");
            continue;
        }
        if (bajo.indexOf("interface ") === 0) {
            var nombre = s.split(/\s+/).slice(1).join(" "), tipo = nombre.toLowerCase();
            // Al último, ya con sus puertos sueltos.
            if (_INTERFAZ_CREADA.test(tipo)) {
                creadas.push("no interface " + nombre);
                continue;
            }
            var q = _quitarDePuerto(cuerpo, conSwitchport && tipo !== "vlan1");
            if (q.quita.length) { puertos = puertos.concat(["interface " + nombre], q.quita); }
            limpias = limpias.concat([linea], q.deja);
            continue;
        }
        if (s === "!" && limpias.length && limpias[limpias.length - 1].trim() === "!") { continue; }
        limpias = limpias.concat([linea], cuerpo);
    }
    return { limpias: limpias, comandos: arriba.concat(puertos, creadas) };
}

// Deja al equipo en el modelo como quedará al borrarlo. De sus puertos sólo se queda la IP de los
// que tienen cable: un enlace sin nota sigue siendo tuyo, y lo demás ya se ve en su turno. Sus redes
// de antes se recuerdan: de ellas sale de quién es una nota sin nombre.
function _limpiarEquipo(d, topo) {
    d.redesDeAntes = _redesConfiguradas(d);
    var q = quitarConfig(d.cfg.lineas, _alguno(_TIPOS_SWITCH, d.desc));
    d.cfg = analizarConfig(q.limpias);
    d.rutas = [];
    d.pools = [];
    d.ruteoIp = _alguno(_TIPOS_SWITCH, d.desc) ? false : d.ruteoIp;
    var cableados = {};
    topo.enlaces.forEach(function (e) {
        if (e.a === d.nombre) { cableados[e.pa.toLowerCase()] = true; }
        if (e.b === d.nombre) { cableados[e.pb.toLowerCase()] = true; }
    });
    d.interfaces = d.interfaces.filter(function (i) { return !_INTERFAZ_CREADA.test(i.nombre.toLowerCase()) && i.nombre.toLowerCase() !== "vlan1"; });
    d.interfaces.forEach(function (i) {
        i.ipv6 = [];
        i.vlan = null;
        i.encendida = true;
        if (!cableados[i.nombre.toLowerCase()]) { i.ip = i.mascara = null; }
    });
    return q.comandos;
}

// Las VLANs que el equipo trae y su red no lleva.
function _vlansDeSobra(plan, d) {
    var s = plan.sitios.filter(function (x) { return x.dueno === d || x.switches[d.nombre] !== undefined; })[0];
    if (!s) { return []; }
    var quiero = _vlansDelSitio(s).map(function (v) { return v.numero; });
    return d.vlans.filter(function (v) { return v[0] !== 1 && quiero.indexOf(v[0]) < 0; }).map(function (v) { return "no vlan " + v[0]; });
}

// --- lo que le falta a cada equipo ----------------------------------------------------------------

function _ordenRuteador(vis) {
    return function (d) { return [d.esMulticapa ? 1 : 0, natural(d.hostname || d.nombre)]; };
}

function _equiposConSalida(ctx) {
    var topo = ctx.topo, vis = topo.visibles();
    var equipos = ordenar(topo.ruteadores, _ordenRuteador(vis));
    var ya = {};
    equipos.forEach(function (d) { ya[d.nombre] = true; });
    ctx.plan.switchesEnOrden.forEach(function (n) {
        var d = topo.porNombre(n);
        if (d && !ya[n]) {
            equipos.push(d);
            ya[n] = true;
        }
    });
    Object.keys(ctx.nombres.ordenes).sort().concat(Object.keys(ctx.borrar).sort()).forEach(function (n) {
        var d = topo.porNombre(n);
        if (d && !ya[n]) {
            equipos.push(d);
            ya[n] = true;
        }
    });
    return equipos;
}

function _ordenesDe(ctx, d) {
    return (ctx.nombres.ordenes[d.nombre] || []).concat(ctx.correcciones.ordenes[d.nombre] || [], ctx.plan.ordenes[d.nombre] || []);
}

// Todo lo de un equipo: también los puertos con IP que ya estaban bien.
function _ordenesCompletas(ctx, d) {
    var ordenes = _ordenesDe(ctx, d);
    var enlaces = ordenes.filter(function (o) { return o.tipo === "enlace"; });
    var nombradas = {}, sinIpv4 = {};
    enlaces.forEach(function (o, k) {
        // Una orden puede traer sólo su IPv6 o su 'no shutdown': su IPv4 todavía hay que ponerla.
        var conIp = o.lineas.some(function (l) { return l.indexOf(" ip address ") === 0; });
        o.lineas.forEach(function (l) {
            if (l.indexOf("interface ") === 0) {
                var n = l.substring(10).trim().toLowerCase();
                if (conIp) { nombradas[n] = true; } else { sinIpv4[n] = k; }
            }
        });
    });
    ctx.plan.sitios.forEach(function (s) {
        if (s.dueno === d && s.puertoLan && ipSuelta(ctx.topo, d, s.puertoLan)) { nombradas[s.puertoLan.toLowerCase()] = true; }
    });
    d.interfaces.forEach(function (i) {
        var nombre = i.nombre.toLowerCase();
        if (!i.configurada || i.planeada || nombre.indexOf(".") >= 0 || nombradas[nombre]
            || nombre.indexOf("vlan") === 0 || nombre.indexOf("port-channel") === 0) { return; }
        var lineas = ["interface " + i.nombre];
        if (d.esMulticapa) { lineas.push(" no switchport"); }
        lineas.push(" ip address " + i.ip + " " + i.mascara);
        var k = sinIpv4[nombre];
        if (k !== undefined) {
            lineas = lineas.concat(enlaces[k].lineas.slice(1).filter(function (l) { return l !== " no shutdown"; }));
        } else if (i.gw6) {
            lineas.push(" ipv6 address " + texto6(i.gw6) + "/" + i.red6.p);
        }
        lineas.push(" no shutdown");
        if (k !== undefined) { enlaces[k] = _orden("enlace", lineas, true); }
        else { enlaces.push(_orden("enlace", lineas, true)); }
    });
    enlaces = ordenar(enlaces, porPuerto);
    return ordenes.filter(function (o) { return o.tipo === "hostname"; }).concat(enlaces,
        ordenes.filter(function (o) { return o.tipo !== "hostname" && o.tipo !== "enlace"; }));
}

function _rutas6Pendientes(ctx, d, completa) {
    if (!ctx.plan.base6) { return []; }       // sin IPv6 en las notas, no se toca
    var objetivo = ctx.rutas6[d.nombre] || [];
    var cfg = d.cfg ? d.cfg.rutas6 : [];
    function clave(red, salto) { return textoRed6(red) + " " + texto6(salto); }
    var actuales = {};
    cfg.forEach(function (r) {
        var red = parseV6Prefijo(r[0]), salto = parse6(r[1]);
        if (red && salto) { actuales[clave(red6(red.g, red.p), salto)] = r; }
    });
    var quiero = {}, agregar = [];
    objetivo.forEach(function (r) {
        var k = clave(r.red, r.salto);
        quiero[k] = true;
        if (completa || !actuales[k]) { agregar.push("ipv6 route " + k); }
    });
    var sobran = completa ? [] : Object.keys(actuales).filter(function (k) { return !quiero[k]; }).map(function (k) {
        return "no ipv6 route " + actuales[k][0] + " " + actuales[k][1];
    });
    return sobran.concat(agregar);
}

function _usaIpv6(d) {
    return d.interfaces.some(function (i) { return i.gw6; });
}

// Lo que va entre estas dos se teclea sin avisar si IOS lo rechaza: no todo tiene su 'no', y lo
// que importa se comprueba después, al volver a leer el equipo.
var MARCA_BORRA = "! se borra lo que tenía", MARCA_PONE = "! y se pone todo de nuevo";

function _lineasIos(d, ordenes, rutas, rutas6, ipRouting, ipv6Routing, borrar) {
    var lin = [];
    ordenes.forEach(function (o) { if (o.tipo === "hostname") { lin = lin.concat(o.lineas); } });
    var actual = (d.hostname || "").toLowerCase();
    if (!lin.length && actual !== "" && actual !== "router" && actual !== "switch") { lin.push("hostname " + d.hostname); }
    if (borrar && borrar.length) { lin = lin.concat([MARCA_BORRA], borrar, [MARCA_PONE]); }
    if (ipRouting) { lin.push("ip routing"); }
    if (ipv6Routing) { lin.push("ipv6 unicast-routing"); }
    ordenes.forEach(function (o) { if (o.tipo !== "hostname") { lin = lin.concat(o.lineas); } });
    rutas.forEach(function (r) { lin.push("ip route " + direccionDe(r.red) + " " + mascaraDe(r.red.p) + " " + r.salto); });
    return lin.concat(rutas6);
}

function comandosPorEquipo(ctx, completa) {
    var vis = ctx.topo.visibles(), salida = [];
    _equiposConSalida(ctx).forEach(function (d) {
        var ordenes, rutasSel, ipRouting, rutas6, ipv6Routing, borrar = [];
        if (completa) {
            ordenes = _ordenesCompletas(ctx, d);
            rutasSel = ctx.rutas[d.nombre] || [];
            ipRouting = d.esMulticapa;
            rutas6 = _rutas6Pendientes(ctx, d, true);
            ipv6Routing = _usaIpv6(d);
        } else if (ctx.borrar[d.nombre]) {
            ordenes = _ordenesCompletas(ctx, d);
            rutasSel = ctx.rutas[d.nombre] || [];
            ipRouting = d.esMulticapa;
            rutas6 = _rutas6Pendientes(ctx, d, true);
            ipv6Routing = _usaIpv6(d);
            borrar = ctx.borrar[d.nombre];
        } else {
            ordenes = _ordenesDe(ctx, d).filter(function (o) { return !o.presente; });
            rutasSel = (ctx.rutas[d.nombre] || []).filter(function (r) { return !r.yaConfigurada; });
            ipRouting = d.esMulticapa && d.ruteoIp !== true;
            rutas6 = _rutas6Pendientes(ctx, d, false);
            ipv6Routing = _usaIpv6(d) && !(d.cfg && d.cfg.ruteoIpv6);
        }
        if (ordenes.length || rutasSel.length || ipRouting || rutas6.length || ipv6Routing || borrar.length) {
            var lineas = _lineasIos(d, ordenes, rutasSel, rutas6, ipRouting, ipv6Routing, borrar);
            salida.push({ equipo: d.nombre, nombre: vis[d.nombre], lineas: lineas, texto: estilo(lineas).join("\n") });
        }
    });
    return salida;
}

// --- los modos de Aplicar ----------------------------------------------------------------------------

// Activo hace todo el ejercicio. Los pasivos sólo tocan lo que ya empezaste, y cada uno pide más de lo
// tuyo antes de tocar un router o core. El que cumple se configura igual que en activo (también se
// rehace si trae algo mal), y con él los switches que cuelgan de él. El que no, no se toca: ni se
// borra, ni se le pone nada, ni a sus PCs se les pide DHCP. Lo inalámbrico que no es IOS (controladora,
// server, AP y teléfonos) se pone en cualquier modo: sale de las notas, no de lo que hayas tecleado.
var MODOS = {
    activo: { nombre: "activo", pide: [] },
    estricto: { nombre: "pasivo estricto", pide: ["empezado", "enlaces", "dhcp"],
                explica: "ya traen completos y bien su dhcp y sus enlaces /30, y los switches que cuelgan de ellos" },
    medio: { nombre: "pasivo medio", pide: ["empezado", "enlaces"],
             explica: "ya traen completos y bien sus enlaces /30, y los switches que cuelgan de ellos; su dhcp lo pone aplicar" },
    bajo: { nombre: "pasivo bajo", pide: ["empezado"],
            explica: "ya empezaste (con alguna ip, pool o ruta), y los switches que cuelgan de ellos" }
};

// Algo de red puesto por ti: una IP, un pool o una ruta. El hostname no cuenta: puede venir puesto.
function _empezado(d) {
    var c = d.cfg;
    return !!c && (c.pools.length > 0 || c.rutas.length > 0 || c.interfaces.some(function (i) { return !!i.ip; }));
}

// Lo que a sus enlaces /30 les falta o tienen mal: lo mismo que aplicar les pondría.
function _faltasEnlaces(ctx, d) {
    var vis = ctx.topo.visibles(), faltas = (ctx.correcciones.mal[d.nombre] || []).slice();
    (ctx.correcciones.ordenes[d.nombre] || []).forEach(function (o) {
        if (!o.lineas.some(function (l) { return l.indexOf(" ip address ") === 0; })) { return; }
        var puerto = o.lineas[0].substring("interface ".length), ic = d.cfg ? d.cfg.porNombre(puerto) : null;
        if (ic && ic.ip) { return; }        // ése ya lo dice lo que trae mal
        var vecino = null;
        ctx.correcciones.cables.forEach(function (t) {
            if (t[0] === d && t[1].nombre === puerto) { vecino = t[2]; }
            if (t[2] === d && t[3].nombre === puerto) { vecino = t[0]; }
        });
        faltas.push(puerto + " no tiene ip, y es su enlace" + (vecino ? " con " + vis[vecino.nombre] : ""));
    });
    return faltas;
}

// Un pool por cada VLAN de su nota, con su red y su puerta; también las que tienen el combo mal, si
// ya lo pusiste con la red buena.
function _faltasDhcp(ctx, d) {
    var s = ctx.plan.sitioDe(d.nombre), c = d.cfg, faltas = [];
    if (!s || !c) { return faltas; }
    if (c.sinDhcp) { faltas.push("tiene apagado el dhcp (no service dhcp)"); }
    s.vlans.forEach(function (v) {
        var red = direccionDe(v.red), mascara = mascaraDe(v.red.p);
        if (c.pools.some(function (p) { return p.red === red && p.mascara === mascara && p.gateway === v.gateway; })) {
            var pcs = s.pcs.filter(function (x) { return x.vlan === v.numero; }).length;
            var libres = c.excluidas.length ? _libresDeVlan(v, c.excluidas) : pcs;
            if (libres < pcs) { faltas.push("con sus excluded-address le quedan " + libres + " direcciones a la vlan " + v.numero + ", que tiene " + pcs + " pcs"); }
            return;
        }
        var mismo = c.pools.filter(function (p) { return p.red === red && p.mascara === mascara; })[0];
        var otro = c.pools.filter(function (p) {
            var r = p.red && p.mascara ? redDe(p.red, p.mascara) : null;
            return r !== null && traslapan(r, v.red);
        })[0];
        if (mismo && !mismo.gateway) { faltas.push("al pool " + mismo.nombre + " le falta su default-router"); }
        else if (mismo) { faltas.push("el pool " + mismo.nombre + " tiene la puerta " + mismo.gateway + ", y le toca " + v.gateway); }
        else if (otro) { faltas.push("el pool " + otro.nombre + " (" + textoRed(redDe(otro.red, otro.mascara)) + ") no es el de la vlan " + v.numero + " (" + textoRed(v.red) + ")"); }
        else { faltas.push("le falta el pool de la vlan " + v.numero); }
    });
    return faltas;
}

// Quiénes cumplen con lo que pide el modo, y qué le falta a cada uno de los que no. Se mide en la
// primera lectura, con todo como está: un equipo que se va a borrar ya no traería nada. `cumplian`: los
// que cumplían al empezar a aplicar, que siguen hasta terminar aunque a media aplicación estén borrados
// o reiniciando (un 3560 se reinicia para IPv6 con sólo lo que se le borró).
function _pasivo(ctx, modo, cumplian) {
    var pide = MODOS[modo].pide, vis = ctx.topo.visibles();
    var p = { modo: modo, elegibles: {}, cumplen: [], noCumplen: [], faltas: [] };
    ordenar(ctx.topo.ruteadores, _ordenRuteador(vis)).forEach(function (d) {
        var faltas = [], sigue = !!cumplian && cumplian.indexOf(d.nombre) >= 0;
        if (!sigue && pide.indexOf("empezado") >= 0 && !_empezado(d)) {
            faltas.push("todavía no trae nada tuyo: ni una ip, ni un pool, ni una ruta");
        } else if (!sigue) {
            if (pide.indexOf("enlaces") >= 0) { faltas = faltas.concat(_faltasEnlaces(ctx, d)); }
            if (pide.indexOf("dhcp") >= 0) { faltas = faltas.concat(_faltasDhcp(ctx, d)); }
        }
        if (faltas.length) {
            p.noCumplen.push(d.nombre);
            faltas.forEach(function (f) { p.faltas.push([d.nombre, f.toLowerCase()]); });
        } else {
            p.cumplen.push(d.nombre);
            p.elegibles[d.nombre] = true;
        }
    });
    ctx.plan.sitios.forEach(function (s) {
        if (p.elegibles[s.dueno.nombre]) { Object.keys(s.switches).forEach(function (n) { p.elegibles[n] = true; }); }
    });
    return p;
}

// Los routers y cores que llevan la parte en IOS de lo inalámbrico: el del sitio de la controladora,
// el de su nativa si es otro, y el de la puerta del server. En pasivo van con lo que pide el modo.
function _iosDelInalambrico(ctx) {
    var nombres = [];
    function suma(d) { if (d && nombres.indexOf(d.nombre) < 0) { nombres.push(d.nombre); } }
    ctx.plan.sitios.forEach(function (s) {
        if (!s.nativa || !s.inalambricos.some(function (x) { return x.d.esControladora; })) { return; }
        suma(s.dueno);
        if (s.routerNativa) { suma(s.routerNativa.dueno); }
    });
    ctx.inalambrico.servidores.forEach(function (srv) { suma(ctx.topo.porNombre(srv.router)); });
    return nombres;
}

// --- todo junto ---------------------------------------------------------------------------------------

// Una lectura de la práctica, con los equipos de `quitar` ya como quedarán al borrarlos.
function _analizar(xml, quitar) {
    var topo = leerTopologia(xml);
    var borrar = {};
    Object.keys(quitar).forEach(function (n) {
        var d = topo.porNombre(n);
        if (d && d.cfg) { borrar[n] = _limpiarEquipo(d, topo); }
    });
    var res = resolverNotas(topo);
    var nombres = generarNombres(topo);
    var correcciones = corregirEnlaces(topo, res);
    var plan = leerPlan(topo, res);
    var combos = plan.sitios.length ? revisarCombos(plan) : { lista: [], total: 0, malos: 0, bien: 0, porcentaje: 100, panico: false };
    plan.ina = plan.sitios.length ? planInalambrico(topo, res, plan)
        : { controladoras: [], servidores: [], aps: [], telefonos: [], avisos: [], supuestos: [], pendiente: false };
    if (plan.sitios.length) { aplicarAlModelo(plan, topo); }
    var subredes = construirSubredes(topo);
    var calculo = calcularRutas(topo, subredes);
    asignarIpv6Enlaces(topo, correcciones, plan);
    var rutas6 = calcularRutas6(topo, calculo.rutas);
    if (plan.sitios.length) { generarOrdenes(plan); }
    Object.keys(borrar).forEach(function (n) { borrar[n] = borrar[n].concat(_vlansDeSobra(plan, topo.porNombre(n))); });
    return { topo: topo, plan: plan, nombres: nombres, correcciones: correcciones, rutas: calculo.rutas, rutas6: rutas6,
             motivos: motivosRehacer(topo, plan, calculo.rutas, correcciones), borrar: borrar, combos: combos, inalambrico: plan.ina };
}

// Los que el programa configura de principio a fin.
function _equiposDelPlan(ctx) {
    var nombres = ctx.topo.ruteadores.map(function (d) { return d.nombre; });
    ctx.plan.switchesEnOrden.forEach(function (n) { if (nombres.indexOf(n) < 0) { nombres.push(n); } });
    return nombres.filter(function (n) { return ctx.topo.porNombre(n).cfg; });
}

// Las notas mandan: lo que falta se agrega, y el equipo que traiga algo que las contradiga se borra
// y se vuelve a configurar. Con más de la mitad así, o si se pide (borrarTodo), se borran todos.
// Se lee otra vez cada que alguien se suma a los borrados: lo que tenía ya no cuenta para nadie, y
// eso puede dejar a la vista lo que otro tiene mal. En un modo pasivo (opciones.modo), todo eso
// sólo con los equipos que cumplen, o que cumplían al empezar a aplicar (opciones.cumplian).
function analizarXml(xml, opciones) {
    var pedido = !!(opciones && opciones.borrarTodo), todos = false;
    var modo = opciones && MODOS.hasOwnProperty(opciones.modo) ? opciones.modo : "activo";
    var quitar = {}, motivos = {}, ctx = null, pasivo = null;
    function puede(n) { return pasivo === null || pasivo.elegibles[n] === true; }
    for (var vuelta = 0; vuelta < 8; vuelta++) {
        ctx = _analizar(xml, quitar);
        if (vuelta === 0 && MODOS[modo].pide.length) { pasivo = _pasivo(ctx, modo, opciones && opciones.cumplian ? opciones.cumplian : null); }
        var nuevos = 0;
        Object.keys(ctx.motivos).forEach(function (n) {
            if (!puede(n)) { return; }
            motivos[n] = motivos[n] || [];
            ctx.motivos[n].forEach(function (m) { if (motivos[n].indexOf(m) < 0) { motivos[n].push(m); } });
            if (!quitar[n] && ctx.topo.porNombre(n).cfg) {
                quitar[n] = true;
                nuevos++;
            }
        });
        var delPlan = _equiposDelPlan(ctx).filter(puede);
        if (!todos && (pedido || Object.keys(quitar).length * 2 > delPlan.length)) {
            todos = true;
            delPlan.forEach(function (n) {
                if (!quitar[n]) {
                    quitar[n] = true;
                    nuevos++;
                }
            });
        }
        if (!nuevos) { break; }
    }
    ctx.motivos = motivos;
    ctx.modo = modo;
    ctx.pasivo = pasivo;
    ctx.borraTodos = todos && !pedido ? Object.keys(motivos).length + " de " + _equiposDelPlan(ctx).filter(puede).length : null;
    ctx.bloques = comandosPorEquipo(ctx, false).filter(function (b) { return puede(b.equipo); });
    ctx.completos = comandosPorEquipo(ctx, true).filter(function (b) { return puede(b.equipo); });
    ctx.pcs = [];
    ctx.plan.sitios.forEach(function (s) {
        if (!puede(s.dueno.nombre)) { return; }
        s.pcs.forEach(function (p) {
            var v = null;
            _vlansDelSitio(s).forEach(function (x) { if (x.numero === p.vlan) { v = x; } });
            ctx.pcs.push({ pc: p.pc, vlan: p.vlan, reservado: !v || v.reservado, dueno: s.dueno.nombre,
                           red: v ? v.red : null, gateway: v ? v.gateway : null });
        });
    });
    // Todos los teléfonos se configuran, pero su IP sólo se espera donde su router o core cumple, igual
    // que con las PCs.
    ctx.inalambrico.telefonos.forEach(function (t) {
        if (!puede(t.dueno)) { return; }
        ctx.pcs.push({ pc: t.equipo, vlan: t.vlan, reservado: t.reservado, dueno: t.dueno, red: t.red, gateway: t.gateway, telefono: true });
    });
    var nombres = _renombresDePcs(ctx, puede);
    ctx.renombres = nombres.lista;
    ctx.sinRenombre = nombres.choques;
    return ctx;
}

// 'PC1 V3' -> 'PC1', 'V4 PC2' -> 'PC2', 'PC7 VLAN5' -> 'PC7': el nombre sin la VLAN que se le puso
// para el programa. Igual que nombre_original en pkt/escribir.py.
function nombreOriginal(nombre) {
    var m = _RE_VLAN_PC.exec(nombre);
    if (!m) { return nombre; }
    var limpio = (nombre.substring(0, m.index) + " " + nombre.substring(m.index + m[0].length)).replace(/\s+/g, " ");
    return limpio.replace(/^[ \-_#]+|[ \-_#]+$/g, "");
}

// Las PCs que traen su VLAN en el nombre vuelven a su nombre original en cuanto esa VLAN quedó en su
// puerto de acceso, como en la copia que guarda el programa: ahí ya vive, y al volver a leer la
// práctica sale igual del switch. Sólo con una VLAN de la nota de su sitio (otra, sin el nombre, se
// repartiría) y fuera del switch de la controladora, donde la PC más cercana va en la nativa salvo que
// su nombre diga otra. Si el nombre limpio ya es de otro equipo, se queda como está.
function _renombresDePcs(ctx, puede) {
    var usados = {}, vistas = {}, lista = [], choques = [];
    ctx.topo.dispositivos.forEach(function (d) { usados[d.nombre] = true; });
    ctx.plan.sitios.forEach(function (s) {
        if (!puede(s.dueno.nombre)) { return; }
        var numeros = s.vlans.map(function (v) { return v.numero; });
        var wlc = s.nativa ? (s.inalambricos || []).filter(function (x) { return x.d.esControladora; })[0] : null;
        s.pcs.forEach(function (p) {
            if (vistas[p.pc] || p.fuente !== "nombre" || numeros.indexOf(p.vlan) < 0 || (wlc && p.equipo === wlc.equipo)) { return; }
            var sw = ctx.topo.porNombre(p.equipo), ic = sw && sw.cfg ? sw.cfg.porNombre(p.puerto) : null;
            if (!ic || ic.accesoVlan !== p.vlan) { return; }
            var nuevo = nombreOriginal(p.pc);
            if (!nuevo || nuevo === p.pc) { return; }
            vistas[p.pc] = true;
            if (usados[nuevo]) {
                choques.push({ pc: p.pc, nuevo: nuevo });
                return;
            }
            usados[nuevo] = true;
            lista.push({ pc: p.pc, nuevo: nuevo });
        });
    });
    return { lista: lista, choques: choques };
}

// Lo que se abre en el Bloc de notas: en minúsculas y sin rodeos.
function textoProblemas(ctx, nombreArchivo) {
    var lineas = [], c = ctx.combos;
    var vis = ctx.topo.visibles();
    if (c.total) {
        lineas.push("combos bien: " + c.bien + " de " + c.total + " (" + c.porcentaje + "%)");
        lineas.push("");
    }
    // En el orden en que se cuentan las redes. El de los comandos, routers y luego core, haría
    // creer que así se reparten: R4 salía arriba de SWR2 aunque SWR2 toma el primer bloque.
    var malos = ordenar(c.lista.filter(function (x) { return !x.ok; }), function (x) {
        return x.familia === "ipv4" ? [0, ipAEntero(x.es.red)] : [1, 0];
    });
    malos.forEach(function (x) { lineas.push(x.mensaje); });
    // El que ya trae su pool puesto a mano no se queda sin DHCP.
    var sinDhcp = malos.filter(function (x) {
        if (x.familia !== "ipv4") { return false; }
        var d = ctx.topo.porNombre(x.canvas);
        return !(d && d.cfg && d.cfg.pools.some(function (p) { return p.red === x.es.red && p.mascara === x.es.mascara; }));
    }).map(function (x) {
        return (x.equipo + " vlan " + x.vlan).toLowerCase();
    });
    var sin6 = malos.filter(function (x) { return x.familia === "ipv6"; }).map(function (x) {
        return (x.equipo + " vlan " + x.vlan).toLowerCase();
    });
    if (sinDhcp.length || sin6.length) { lineas.push(""); }
    if (sinDhcp.length) { lineas.push("sin dhcp hasta que la nota quede igual: " + sinDhcp.join(", ")); }
    if (sin6.length) { lineas.push("sin ipv6 hasta que la nota quede igual: " + sin6.join(", ")); }
    var otros = [];
    function etiqueta(e) { return (vis[e] || e); }
    ctx.plan.errores.concat(ctx.plan.avisos).forEach(function (a) {
        otros.push((a[0] === "plan" ? a[1] : etiqueta(a[0]) + ": " + a[1]).toLowerCase());
    });
    ctx.correcciones.avisos.concat(ctx.nombres.avisos, ctx.inalambrico.avisos).forEach(function (a) { otros.push(a.toLowerCase()); });
    (ctx.sinRenombre || []).forEach(function (r) {
        otros.push((r.pc + " se queda con su vlan en el nombre: " + r.nuevo + " ya es de otro equipo").toLowerCase());
    });
    if (ctx.borraTodos) { otros.push("se rehacen todos los equipos: " + ctx.borraTodos + " traen algo mal"); }
    Object.keys(ctx.motivos).forEach(function (n) {
        ctx.motivos[n].forEach(function (m) { otros.push(("se rehace " + etiqueta(n) + ": " + m).toLowerCase()); });
    });
    if (otros.length) {
        if (lineas.length) { lineas.push(""); }
        lineas = lineas.concat(otros);
    }
    var texto = lineas.join("\n");
    // En pasivo va primero qué se toca y qué no: es lo que cambia lo que hace aplicar.
    if (ctx.pasivo) {
        var p = ctx.pasivo, total = p.cumplen.length + p.noCumplen.length;
        var cabeza = ["modo " + MODOS[p.modo].nombre + ": aplicar sólo toca los routers y cores que " + MODOS[p.modo].explica];
        if (ctx.inalambrico.controladoras.length) {
            var fuera = _iosDelInalambrico(ctx).filter(function (n) { return !p.elegibles[n]; });
            var ina = "lo inalámbrico (controladora, server, ap y teléfonos) sí lo pone, en cualquier modo";
            if (fuera.length) {
                ina += "; lo que lleva en ios (la nativa, " + (ctx.inalambrico.servidores.length ? "la puerta del server, " : "") + "las troncales) va con "
                    + _listaVis(vis, fuera.map(function (n) { return ctx.topo.porNombre(n); })) + ", que no " + (fuera.length === 1 ? "cumple" : "cumplen");
            }
            cabeza.push(ina.toLowerCase());
        }
        cabeza.push(("cumplen " + p.cumplen.length + " de " + total
                     + (p.cumplen.length ? ": " + p.cumplen.map(function (n) { return vis[n]; }).join(", ") : "")).toLowerCase());
        p.faltas.forEach(function (f) { cabeza.push(("no se toca " + vis[f[0]] + ": " + f[1]).toLowerCase()); });
        texto = cabeza.join("\n") + (texto ? "\n\n" + texto : "");
    }
    return texto;
}
