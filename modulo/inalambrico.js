// Lo inalámbrico que no es IOS: la controladora, los AP, el server RADIUS y los teléfonos. Su
// configuración vive en el archivo de la práctica y la controladora no tiene consola ni API: lo que
// haría su portal se escribe en el XML y la práctica se vuelve a abrir desde memoria.

var WLC_NOMBRE = "WLC", WLC_USUARIO = "admin", WLC_CLAVE = "Abc1234";
var RADIUS_PUERTO = 1812, RADIUS_CLIENTE = "majli", RADIUS_SECRETO = "majli", RADIUS_USUARIO = "majli", RADIUS_CLAVE = "majli";
var WPA2_EAP = 5, WPA2_PSK = 4, AES = 4;
// La vlan del server cuando su core sólo hace de switch: la primera libre desde ésta.
var VLAN_SERVIDOR = 192, NOMBRE_VLAN_SERVIDOR = "SERVIDOR";
// La red que el asistente del portal obliga a crear. Queda en la controladora, sin darla a los AP.
var RED_DEL_PORTAL = { nombre: "WLC", clave: "Abcd1234" };

// 'AP1' y debajo las redes que da. Una nota puede traer varios, separados por un renglón en blanco.
function notaDeAps(texto) {
    var parrafos = texto.split(/\n\s*\n/).map(function (p) {
        return p.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    }).filter(function (p) { return p.length; });
    if (!parrafos.length) { return null; }
    var salida = [];
    for (var i = 0; i < parrafos.length; i++) {
        var p = parrafos[i];
        if (p.length < 2 || !/^(L?AP\s*\d*|Light Weight Access Point.*)$/i.test(p[0])) { return null; }
        if (!p.slice(1).every(function (l) { return /^[A-Za-zÀ-ÿ][\wÀ-ÿ\-]*$/.test(l); })) { return null; }
        salida.push({ nombre: p[0], redes: p.slice(1) });
    }
    return salida;
}

// --- lo que ya tienen ---------------------------------------------------------------------------

function _todas(trozo, nombre) {
    var salida = [], i = 0, abre = "<" + nombre + ">", cierra = "</" + nombre + ">";
    for (;;) {
        i = trozo.indexOf(abre, i);
        if (i < 0) { return salida; }
        var f = trozo.indexOf(cierra, i);
        if (f < 0) { return salida; }
        salida.push(trozo.substring(i + abre.length, f));
        i = f + cierra.length;
    }
}

function leerInalambrico(d, b) {
    if (d.esAp) {
        d.mac = _etiqueta(b, "MACADDRESS");
        d.ssids = _todas(_etiqueta(b, "CAPWAP"), "SSID");
        // El radio no lleva IP. Con DHCP encendido, el AP da la red y nadie se le puede asociar.
        var radio = _todas(b, "PORT").filter(function (p) { return _etiqueta(p, "TYPE").indexOf("AccessPointWireless") >= 0; })[0];
        d.radioBien = !radio || _etiqueta(radio, "PORT_DHCP_ENABLE") !== "true";
        // Su cable va por DHCP. De fábrica no pide IP, y sin ella no llega a la controladora.
        var cable = _todas(b, "PORT").filter(function (p) { return /^eCopper\w*Ethernet/.test(_etiqueta(p, "TYPE")); })[0];
        d.cableBien = !cable || _etiqueta(cable, "PORT_DHCP_ENABLE") === "true";
    } else if (d.esControladora) {
        var cap = _etiqueta(b, "CAPWAP_AC"), mg = _etiqueta(b, "MANAGEMENT_INTERFACE");
        d.wlc = {
            hostname: _etiqueta(b, "HOSTNAME"),
            enAsistente: _etiqueta(b, "IN_SETUP_MODE") === "true",
            ip: _etiqueta(mg, "IP"), mascara: _etiqueta(mg, "SUBNET"), gw: _etiqueta(mg, "PORT_GATEWAY"),
            interfaces: _todas(_etiqueta(b, "WLC_INTERFACES"), "PORT").map(function (p) {
                return { nombre: _etiqueta(p, "NAME"), ip: _etiqueta(p, "IP"), mascara: _etiqueta(p, "SUBNET"), gw: _etiqueta(p, "PORT_GATEWAY"),
                         vlan: +_etiqueta(p, "VLAN_NUMBER"), dhcp: _etiqueta(p, "DHCP_SERVER_IP") };
            }),
            wlans: _todas(cap, "WLAN_CONFIG").map(function (w) {
                return { nombre: _etiqueta(w, "NAME"), ssid: _etiqueta(w, "SSID"), authen: +_etiqueta(w, "AUTHEN_TYPE"), encrypt: +_etiqueta(w, "ENCRYPT_TYPE"),
                         radiusIp: _etiqueta(w, "RADIUS_IP"), radiusPuerto: +_etiqueta(w, "RADIUS_PORT"), radiusClave: _etiqueta(w, "RADIUS_SECRET"),
                         vlan: +_etiqueta(w, "VLAN"), interfaz: _etiqueta(w, "INTERFACE_NAME") };
            }),
            grupos: _todas(_etiqueta(cap, "AP_GROUPS"), "AP_GROUP").map(function (g) {
                return { nombre: _etiqueta(g, "NAME"), wlans: _todas(g, "WLAN").map(function (w) { return _etiqueta(w, "NAME"); }) };
            }),
            aps: _todas(_etiqueta(cap, "APS"), "AP").map(function (a) { return { mac: _etiqueta(a, "MAC"), grupo: _etiqueta(a, "AP_GROUP") }; }),
            radius: _todas(cap, "ACS_SERVER_INFO").map(function (r) { return { ip: _etiqueta(r, "IP"), puerto: +_etiqueta(r, "PORT"), clave: _etiqueta(r, "KEY") }; }),
            usuarios: _todas(_etiqueta(cap, "LOCAL_USERS"), "LOCAL_USER_ID").map(function (u, i) {
                return { id: u, clave: _todas(_etiqueta(cap, "LOCAL_USERS"), "LOCAL_USER_PW")[i] };
            })
        };
    } else if (d.esServidor) {
        var acs = _etiqueta(b, "ACS_SERVER"), puerto = _todas(b, "PORT")[0] || "";
        d.acs = {
            activo: _etiqueta(acs, "ENABLED") === "1", puerto: +_etiqueta(acs, "AUTH_PORT"),
            usuarios: _todas(acs, "USER").map(function (u) { return { nombre: _etiqueta(u, "NAME"), clave: _etiqueta(u, "PASSWORD") }; }),
            clientes: _todas(acs, "CLIENT").map(function (c) { return { ip: _etiqueta(c, "HOST_IP"), clave: _etiqueta(c, "KEY"), nombre: _etiqueta(c, "DESCRIPTION"), tipo: _etiqueta(c, "SERVER_TYPE") }; })
        };
        d.fija = { ip: _etiqueta(puerto, "IP"), mascara: _etiqueta(puerto, "SUBNET"), gw: _etiqueta(puerto, "PORT_GATEWAY"), dhcp: _etiqueta(puerto, "PORT_DHCP_ENABLE") === "true" };
    } else if (d.esTelefono) {
        var perfil = _etiqueta(_etiqueta(b, "CURRENT_PROFILE"), "WIRELESS_PROFILE");
        d.perfil = { ssid: _etiqueta(perfil, "SSID"), authen: +_etiqueta(perfil, "AUTHEN_TYPE"), encrypt: +_etiqueta(perfil, "ENCRYPT_TYPE"),
                     usuario: _etiqueta(perfil, "WPA_EAP_USERID"), clave: _etiqueta(perfil, "WPA_EAP_PASSWORD"), dhcp: _etiqueta(perfil, "DHCP_ENABLED") === "1" };
    }
}

// --- lo que les toca -----------------------------------------------------------------------------

// De qué AP habla cada nota: por su nombre, o el más cercano de los que no tienen la suya.
function _redesPorAp(res, topo, ina) {
    var aps = topo.dispositivos.filter(function (d) { return d.esAp; }), salida = {}, sinNombre = [];
    res.notasAp.forEach(function (n) {
        var d = aps.filter(function (a) { return a.nombre.toLowerCase() === n.nombre.toLowerCase(); })[0];
        if (d) { salida[d.nombre] = n.redes; } else { sinNombre.push(n); }
    });
    sinNombre.forEach(function (n) {
        var libres = aps.filter(function (a) { return !salida[a.nombre] && a.x !== null; });
        var d = n.nota.x === null ? null : ordenar(libres, function (a) { return _distancia(n.nota.x, n.nota.y, a.x, a.y); })[0];
        if (d) {
            salida[d.nombre] = n.redes;
            ina.supuestos.push("la nota de " + n.nombre + " se aplicó a " + d.nombre + ", el ap más cercano");
        } else {
            ina.avisos.push("la nota de " + n.nombre + " no tiene un ap que le corresponda");
        }
    });
    return salida;
}

// Un puerto físico al que ya no le llega ningún cable.
function _sinCable(topo, d, i) {
    var n = i.nombre.toLowerCase();
    return !d.esHost && !_INTERFAZ_CREADA.test(n) && n !== "vlan1" && !topo.enlaces.some(function (e) {
        return (e.a === d.nombre && e.pa.toLowerCase() === n) || (e.b === d.nombre && e.pb.toLowerCase() === n);
    });
}

// Dónde va la puerta del server, según dónde esté su cable. En un core multicapa, en ese mismo puerto.
// Un core de capa 2 no puede llevar IP en un puerto: el server va en una vlan propia, con su subinterfaz
// en el router. Y si sigue cableado al router, en ese puerto.
function _puertaDelServidor(topo, s) {
    if (s.servidor && s.dueno.esMulticapa) {
        return { srv: s.servidor.d, equipo: s.dueno, puerto: s.servidor.puerto, vlan: null, acceso: null };
    }
    if (s.servidor) {
        if (!s.puertoLan) { return null; }
        var vlan = VLAN_SERVIDOR;
        while (_vlansDelSitio(s).some(function (v) { return v.numero === vlan; })) { vlan++; }
        return { srv: s.servidor.d, equipo: s.dueno, puerto: s.puertoLan + "." + vlan, vlan: vlan,
                 acceso: { equipo: s.servidor.equipo, puerto: s.servidor.puerto } };
    }
    var router = s.routerNativa ? s.routerNativa.dueno : (s.dueno.esMulticapa ? null : s.dueno);
    if (!router) { return null; }
    var cable = topo.enlaces.map(function (e) {
        if (e.a === router.nombre) { return [topo.porNombre(e.b), e.pa]; }
        if (e.b === router.nombre) { return [topo.porNombre(e.a), e.pb]; }
        return null;
    }).filter(function (x) { return x && x[0] && x[0].esServidor; })[0];
    return cable ? { srv: cable[0], equipo: router, puerto: cable[1], vlan: null, acceso: null } : null;
}

// El server RADIUS va siempre en una red 192.168.x propia: la que ya tenga se respeta sólo si es de
// esas, y cualquier otra se cambia. Si antes estuvo en otro lado, lo que dejó ahí se quita: el puerto
// sin cable y la ruta que ahora sobra.
function _planServidor(topo, s, tomadas) {
    var p = _puertaDelServidor(topo, s);
    if (!p) { return null; }
    var srv = p.srv, ifaz = p.equipo.interfaz(p.puerto), red = null, puerta = null;
    function libre(r) { return !tomadas.some(function (o) { return traslapan(r, o); }); }
    if (ifaz && ifaz.configurada && /^192\.168\./.test(ifaz.ip)) {
        red = redDe(ifaz.ip, ifaz.mascara);
        puerta = ifaz.ip;
    } else if (srv.fija && /^192\.168\.\d+\.\d+$/.test(srv.fija.ip) && libre(red4(srv.fija.ip, 24))) {
        red = red4(srv.fija.ip, 24);
    } else {
        for (var n = 1; n < 255 && red === null; n++) {
            var prueba = red4("192.168." + n + ".0", 24);
            var ocupada = !libre(prueba) || topo.dispositivos.some(function (d) {
                return d.interfacesIp().some(function (i) { return contiene(prueba, i.ip) && !_sinCable(topo, d, i); }) || (d.fija && d.fija.ip && contiene(prueba, d.fija.ip));
            });
            if (!ocupada) { red = prueba; }
        }
    }
    if (red === null) { return null; }
    tomadas.push(red);
    puerta = puerta || enteroAIp(red.n + tamanoRed(red.p) - 2);
    var primera = enteroAIp(red.n + 1);
    var ip = srv.fija && srv.fija.ip && contiene(red, srv.fija.ip) && srv.fija.ip !== puerta ? srv.fija.ip
        : (primera === puerta ? enteroAIp(red.n + 2) : primera);
    var viejos = [];
    topo.ruteadores.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            if (contiene(red, i.ip) && _sinCable(topo, d, i)) { viejos.push({ equipo: d.nombre, puerto: i.nombre }); }
        });
    });
    if (p.vlan) { s.vlanServidor = { numero: p.vlan, nombre: NOMBRE_VLAN_SERVIDOR, red: red, gateway: puerta }; }
    return { equipo: srv.nombre, ip: ip, mascara: mascaraDe(red.p), gw: puerta, router: p.equipo.nombre, puertoRouter: p.puerto, vlan: p.vlan, acceso: p.acceso,
             viejos: viejos, rutasDeSobra: p.equipo.rutas.filter(function (r) { var x = redDe(r[0], r[1]); return x && mismaRed(x, red); }),
             puerto: RADIUS_PUERTO, clientes: [], usuarios: [{ nombre: RADIUS_USUARIO, clave: RADIUS_CLAVE }], pendiente: false };
}

// 'ALUMNO' en la nota de un AP y 'ALUMNOS' en la lista de nombres son la misma red.
function _mismoNombre(a, b) {
    var x = a.toUpperCase(), y = b.toUpperCase();
    return x === y || x + "S" === y || y + "S" === x || x + "ES" === y || y + "ES" === x;
}

function _wlanEap(v, id, srv) {
    return { nombre: v.nombre, ssid: v.nombre, authen: WPA2_EAP, encrypt: AES, clave: "", radiusIp: srv ? srv.ip : "", radiusPuerto: srv ? srv.puerto : 0,
             radiusClave: srv ? RADIUS_SECRETO : "", radiusIndice: srv ? 1 : 4294967295, vlan: v.numero, id: id, interfaz: v.nombre, modoSwitch: 0, modoAuth: 0 };
}

function _firmaWlc(w) {
    function porNombre(l) { return ordenar(l, function (x) { return natural(x.nombre || x.mac || x.id || x.ip); }); }
    return JSON.stringify({
        hostname: w.hostname, ip: w.ip, mascara: w.mascara, gw: w.gw,
        interfaces: porNombre(w.interfaces.filter(function (i) { return i.nombre !== "virtual"; })).map(function (i) { return [i.nombre, i.ip, i.mascara, i.gw, i.vlan]; }),
        wlans: porNombre(w.wlans).map(function (x) { return [x.nombre, x.ssid, x.authen, x.encrypt, x.radiusIp, x.radiusPuerto, x.radiusClave, x.vlan, x.interfaz]; }),
        grupos: porNombre(w.grupos).map(function (g) { return [g.nombre, g.wlans.slice().sort()]; }),
        aps: porNombre(w.aps).map(function (a) { return [a.mac, a.grupo]; }),
        radius: w.radius.map(function (r) { return [r.ip, r.puerto, r.clave]; }),
        usuarios: w.usuarios.map(function (u) { return [u.id, u.clave]; })
    });
}

function _firmaServidor(fija, acs) {
    return JSON.stringify({
        ip: fija.ip, mascara: fija.mascara, gw: fija.gw, dhcp: !!fija.dhcp, activo: acs.activo, puerto: acs.puerto,
        clientes: acs.clientes.map(function (c) { return [c.ip, c.clave, c.nombre, c.tipo]; }),
        usuarios: acs.usuarios.map(function (u) { return [u.nombre, u.clave]; })
    });
}

function planInalambrico(topo, res, plan) {
    var ina = { controladoras: [], servidores: [], aps: [], telefonos: [], avisos: [], supuestos: [], pendiente: false };
    var redesDeAp = _redesPorAp(res, topo, ina), tomadas = [], redesAps = [];
    plan.sitios.forEach(function (s) { s.vlans.forEach(function (v) { tomadas.push(v.red); }); });
    plan.sitios.forEach(function (s) {
        var wlcs = s.inalambricos.filter(function (x) { return x.d.esControladora; });
        var aps = s.inalambricos.filter(function (x) { return x.d.esAp; });
        if (!wlcs.length) {
            if (aps.length) { ina.avisos.push(_nombreSitio(s) + ": tiene ap y ninguna controladora"); }
            return;
        }
        if (!s.nativa) {
            ina.avisos.push(_nombreSitio(s) + ": tiene controladora, y ninguna vlan se llama nativa en tus notas");
            return;
        }
        var srv = _planServidor(topo, s, tomadas);
        if (srv) {
            srv.sitio = s.dueno.nombre;     // lo inalámbrico va con su sitio (los modos pasivos)
            ina.servidores.push(srv);
            if (srv.vlan) {
                ina.supuestos.push(srv.equipo + " va en la vlan " + srv.vlan + " (" + NOMBRE_VLAN_SERVIDOR.toLowerCase() + "), con su puerta en " + _nombreSitio(s) + ": su core sólo hace de switch y no puede llevar ip en el puerto");
            }
        } else {
            ina.avisos.push(_nombreSitio(s) + ": no hay un server cableado a su core para radius");
        }
        // Las redes que dan sus AP, y de cada una su vlan.
        var porNombre = {}, todas = [];
        s.vlans.forEach(function (v) {
            if (v === s.nativa) { return; }
            porNombre[v.nombre.toUpperCase()] = v;
            todas.push(v.nombre);
        });
        var listas = aps.map(function (a) {
            var nota = redesDeAp[a.d.nombre];
            if (!nota) {
                ina.supuestos.push(a.d.nombre + " no tiene nota: da todas las redes de " + _nombreSitio(s) + " (" + todas.join(", ").toLowerCase() + ")");
                return todas;
            }
            var redes = [];
            nota.forEach(function (r) {
                var k = porNombre[r.toUpperCase()] ? r.toUpperCase() : Object.keys(porNombre).filter(function (n) { return _mismoNombre(n, r); })[0];
                if (!k) {
                    ina.avisos.push(a.d.nombre + ": la red " + r.toLowerCase() + " de su nota no es una vlan de " + _nombreSitio(s));
                    return;
                }
                if (k !== r.toUpperCase()) {
                    var dicho = "la red " + r.toLowerCase() + " de la nota de un ap se tomó como " + k.toLowerCase();
                    if (ina.supuestos.indexOf(dicho) < 0) { ina.supuestos.push(dicho); }
                }
                if (redes.indexOf(porNombre[k].nombre) < 0) { redes.push(porNombre[k].nombre); }
            });
            return redes;
        });
        var usadas = [];
        (listas.length ? listas : [todas]).forEach(function (l) { l.forEach(function (r) { if (usadas.indexOf(r) < 0) { usadas.push(r); } }); });
        var grupos = [], enGrupos = [];
        aps.forEach(function (a, i) {
            var clave = listas[i].join(",");
            var g = grupos.filter(function (x) { return x.clave === clave; })[0];
            if (!g) {
                g = { clave: clave, nombre: grupos.length ? "GRUPO" + (grupos.length + 1) : "default-group", wlans: listas[i] };
                grupos.push(g);
            }
            enGrupos.push({ mac: a.d.mac, grupo: g.nombre });
            ina.aps.push({ equipo: a.d.nombre, grupo: g.nombre, wlans: listas[i], controladora: wlcs[0].d.nombre, plan: null, sitio: s.dueno.nombre });
            redesAps.push({ d: a.d, lista: listas[i], porNombre: porNombre, sitio: s });
        });
        if (!grupos.length) { grupos.push({ nombre: "default-group", wlans: usadas }); }

        wlcs.forEach(function (x, k) {
            var ip = enteroAIp(ipAEntero(s.nativa.gateway) - 1 - k), mascara = mascaraDe(s.nativa.red.p);
            var wlans = [{ nombre: RED_DEL_PORTAL.nombre, ssid: RED_DEL_PORTAL.nombre, authen: WPA2_PSK, encrypt: AES, clave: RED_DEL_PORTAL.clave, radiusIp: "", radiusPuerto: 0,
                           radiusClave: "", radiusIndice: 4294967295, vlan: 0, id: 1, interfaz: "management", modoSwitch: 1, modoAuth: 1 }];
            usadas.forEach(function (r, i) { wlans.push(_wlanEap(porNombre[r.toUpperCase()], i + 2, srv)); });
            var c = {
                equipo: x.d.nombre, sitio: s.dueno.nombre, hostname: WLC_NOMBRE, ip: ip, mascara: mascara, gw: s.nativa.gateway,
                interfaces: [{ nombre: "management", ip: ip, mascara: mascara, gw: s.nativa.gateway, vlan: 0, dhcp: "0.0.0.0" }].concat(usadas.map(function (r) {
                    var v = porNombre[r.toUpperCase()];
                    return { nombre: v.nombre, ip: enteroAIp(ipAEntero(v.gateway) - 1 - k), mascara: mascaraDe(v.red.p), gw: v.gateway, vlan: v.numero, dhcp: v.gateway };
                })),
                wlans: wlans, grupos: grupos.map(function (g) { return { nombre: g.nombre, wlans: g.wlans }; }), aps: enGrupos,
                radius: srv ? [{ ip: srv.ip, puerto: srv.puerto, clave: RADIUS_SECRETO }] : [],
                usuarios: [{ id: WLC_USUARIO, clave: WLC_CLAVE }]
            };
            c.pendiente = x.d.wlc.enAsistente || _firmaWlc(x.d.wlc) !== _firmaWlc(c);
            ina.controladoras.push(c);
            if (srv) { srv.clientes.push({ ip: ip, clave: RADIUS_SECRETO, nombre: RADIUS_CLIENTE, tipo: "RADIUS" }); }
        });
        if (srv) {
            var d = topo.porNombre(srv.equipo);
            srv.pendiente = _firmaServidor(d.fija, d.acs) !== _firmaServidor({ ip: srv.ip, mascara: srv.mascara, gw: srv.gw, dhcp: false },
                                                                             { activo: true, puerto: srv.puerto, clientes: srv.clientes, usuarios: srv.usuarios });
        }
    });
    ina.aps.forEach(function (a) {
        var d = topo.porNombre(a.equipo), c = ina.controladoras.filter(function (x) { return x.equipo === a.controladora; })[0];
        a.plan = c.wlans.filter(function (w) { return a.wlans.indexOf(w.nombre) >= 0; });
        a.pendiente = !d.radioBien || !d.cableBien || JSON.stringify(d.ssids.slice().sort()) !== JSON.stringify(a.plan.map(function (w) { return w.ssid; }).sort());
    });

    // Los teléfonos: cada uno con el AP que le queda más cerca. Si su nombre dice una red, ésa; si ya
    // trae una que su AP da, se queda; si no, se van turnando para que cada red tenga alguno.
    var turnos = {};
    topo.dispositivos.filter(function (d) { return d.esTelefono && d.x !== null; }).forEach(function (t) {
        var ap = ordenar(redesAps.filter(function (a) { return a.d.x !== null && a.lista.length; }), function (a) { return _distancia(t.x, t.y, a.d.x, a.d.y); })[0];
        if (!ap) { return; }
        var deNombre = ap.lista.filter(function (r) { return t.nombre.toUpperCase().indexOf(r.toUpperCase()) >= 0; })[0];
        var ya = ap.lista.filter(function (r) { return r === t.perfil.ssid; })[0];
        var turno = turnos[ap.sitio.dueno.nombre] = turnos[ap.sitio.dueno.nombre] || { n: 0 };
        var ssid = deNombre || ya || ap.lista[turno.n++ % ap.lista.length];
        var v = ap.porNombre[ssid.toUpperCase()];
        ina.telefonos.push({ equipo: t.nombre, ssid: ssid, vlan: v.numero, red: v.red, gateway: v.gateway, reservado: !!v.reservado, dueno: ap.sitio.dueno.nombre,
                             pendiente: t.perfil.ssid !== ssid || t.perfil.authen !== WPA2_EAP || t.perfil.encrypt !== AES
                                 || t.perfil.usuario !== RADIUS_USUARIO || t.perfil.clave !== RADIUS_CLAVE || !t.perfil.dhcp });
    });
    ina.pendiente = ina.controladoras.concat(ina.servidores, ina.aps, ina.telefonos).some(function (x) { return x.pendiente; });
    return ina;
}

// Lo que haría falta en sus pantallas, por si se quiere ver o hacer a mano.
function textoInalambrico(ina) {
    var l = [];
    ina.controladoras.forEach(function (c) {
        l.push(c.equipo + (c.pendiente ? "" : " (ya está)"), "  " + c.hostname + ", entra con " + WLC_USUARIO + " / " + WLC_CLAVE + ", ip " + c.ip + " " + c.mascara + ", puerta " + c.gw);
        c.interfaces.forEach(function (i) { if (i.vlan) { l.push("  interfaz " + i.nombre + ", vlan " + i.vlan + ": " + i.ip + " " + i.mascara + ", puerta y dhcp " + i.gw); } });
        c.wlans.forEach(function (w) { if (w.authen === WPA2_EAP) { l.push("  wlan " + w.ssid + ": wpa2-enterprise aes, radius " + w.radiusIp + ":" + w.radiusPuerto + ", secreto " + w.radiusClave); } });
        c.grupos.forEach(function (g) { l.push("  grupo " + g.nombre + ": " + g.wlans.join(", ")); });
    });
    ina.servidores.forEach(function (s) {
        l.push(s.equipo + (s.pendiente ? "" : " (ya está)"), "  ip " + s.ip + " " + s.mascara + ", puerta " + s.gw + "; aaa encendido, radius " + s.puerto);
        s.clientes.forEach(function (c) { l.push("  cliente " + c.nombre + ", ip " + c.ip + ", secreto " + c.clave); });
        s.usuarios.forEach(function (u) { l.push("  usuario " + u.nombre + " / " + u.clave); });
    });
    ina.telefonos.forEach(function (t) { l.push(t.equipo + (t.pendiente ? "" : " (ya está)") + ": " + t.ssid + ", wpa2-enterprise aes, " + RADIUS_USUARIO + " / " + RADIUS_CLAVE + ", dhcp"); });
    return l;
}

// --- escribirlo en el archivo --------------------------------------------------------------------

function _xml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Cambia una etiqueta sencilla, llena o vacía, a partir de `desde`.
function _poner(b, tag, valor, desde) {
    var i = desde || 0;
    var re = new RegExp("<" + tag + "(?:\\s*/>|>[^<]*</" + tag + ">)", "g");
    re.lastIndex = i;
    var m = re.exec(b);
    if (!m) { return b; }
    return b.substring(0, m.index) + "<" + tag + ">" + _xml(valor) + "</" + tag + ">" + b.substring(m.index + m[0].length);
}

// Cambia el contenido de la primera sección con ese nombre, a partir de `desde`.
function _seccion(b, tag, contenido, desde) {
    var i = desde || 0, abre = b.indexOf("<" + tag + ">", i), vacia = b.indexOf("<" + tag + "/>", i);
    if (vacia >= 0 && (abre < 0 || vacia < abre)) {
        return b.substring(0, vacia) + "<" + tag + ">" + contenido + "</" + tag + ">" + b.substring(vacia + tag.length + 3);
    }
    if (abre < 0) { return b; }
    var fin = b.indexOf("</" + tag + ">", abre);
    if (fin < 0) { return b; }
    return b.substring(0, abre + tag.length + 2) + contenido + b.substring(fin);
}

// Una MAC propia para cada interfaz nueva, siempre la misma para la misma interfaz.
function _macDe(base, nombre) {
    var h = 0;
    for (var i = 0; i < nombre.length; i++) { h = (h * 31 + nombre.charCodeAt(i)) >>> 0; }
    var limpia = base.replace(/\./g, "");
    var hex = ("000000" + (h % 0xFFFFFF).toString(16)).slice(-6).toUpperCase();
    var m = limpia.substring(0, 6) + hex;
    return m.substring(0, 4) + "." + m.substring(4, 8) + "." + m.substring(8, 12);
}

function _enlaceLocal(mac) {
    var h = mac.replace(/\./g, "");
    var p = (parseInt(h.substring(0, 2), 16) ^ 2).toString(16);
    function g(x) { return x.replace(/^0+(?=.)/, ""); }
    return ("FE80::" + g(("0" + p).slice(-2) + h.substring(2, 4)) + ":" + g(h.substring(4, 6) + "FF") + ":" + g("FE" + h.substring(6, 8)) + ":" + g(h.substring(8, 12))).toUpperCase();
}

function _puertoInterfaz(plantilla, i, propio) {
    var p = plantilla;
    if (!propio) {
        var mac = _macDe(_etiqueta(plantilla, "MACADDRESS"), i.nombre);
        p = _poner(p, "MACADDRESS", mac);
        p = _poner(p, "BIA", mac);
        p = _poner(p, "IPV6_DEFAULT_LINK_LOCAL", _enlaceLocal(mac));
    }
    p = _poner(p, "UP_METHOD", 5);
    p = _poner(p, "IP", i.ip);
    p = _poner(p, "SUBNET", i.mascara);
    p = _poner(p, "PORT_GATEWAY", i.gw);
    p = _poner(p, "PORT_DHCP_ENABLE", "false");
    p = _poner(p, "DHCP_SERVER_IP", i.dhcp);
    p = _poner(p, "NAME", i.nombre);
    p = _poner(p, "VLAN_NUMBER", i.vlan);
    p = _poner(p, "PHYSICAL_PORT_NUMBER", 1);
    return _poner(p, "DYNAMIC_AP_MANAGER_ENABLED", i.nombre === "management" ? "true" : "false");
}

function _wlanXml(w) {
    return "<WLAN_CONFIG><NAME>" + _xml(w.nombre) + "</NAME><SSID>" + _xml(w.ssid) + "</SSID><AUTHEN_TYPE>" + w.authen + "</AUTHEN_TYPE><ENCRYPT_TYPE>" + w.encrypt + "</ENCRYPT_TYPE>"
        + "<WEP_KEY>" + _xml(w.clave) + "</WEP_KEY><RADIUS_IP>" + _xml(w.radiusIp) + "</RADIUS_IP><RADIUS_PORT>" + w.radiusPuerto + "</RADIUS_PORT><RADIUS_SECRET>" + _xml(w.radiusClave) + "</RADIUS_SECRET>"
        + "<RADIUS_SERVER_INDEX>" + w.radiusIndice + "</RADIUS_SERVER_INDEX><VLAN>" + w.vlan + "</VLAN><ID>" + w.id + "</ID><ENABLED>true</ENABLED><INTERFACE_NAME>" + _xml(w.interfaz) + "</INTERFACE_NAME>"
        + "<WLAN_SWITCH_MODE>" + w.modoSwitch + "</WLAN_SWITCH_MODE><WLAN_AUTHEN_MODE>" + w.modoAuth + "</WLAN_AUTHEN_MODE></WLAN_CONFIG>";
}

function _parchearControladora(b, c) {
    b = _poner(b, "SYS_NAME", c.hostname);
    b = _poner(b, "HOSTNAME", c.hostname);
    b = _poner(b, "IN_SETUP_MODE", "false");

    var ini = b.indexOf("<MANAGEMENT_INTERFACE>");
    b = _poner(b, "IP", c.ip, ini);
    b = _poner(b, "SUBNET", c.mascara, ini);
    b = _poner(b, "PORT_GATEWAY", c.gw, ini);

    var puertos = _todas(_etiqueta(b, "WLC_INTERFACES"), "PORT");
    function deNombre(n) { return puertos.filter(function (p) { return _etiqueta(p, "NAME") === n; })[0]; }
    var mgmt = deNombre("management"), virtual = deNombre("virtual");
    virtual = _poner(_poner(virtual, "IP", "192.0.2.1"), "SUBNET", "255.255.255.255");
    var nuevas = c.interfaces.map(function (i) {
        var propio = deNombre(i.nombre);
        return "<PORT>" + _puertoInterfaz(propio || mgmt, i, !!propio) + "</PORT>";
    });
    nuevas.splice(1, 0, "<PORT>" + virtual + "</PORT>");
    b = _seccion(b, "WLC_INTERFACES", nuevas.join(""));

    var cap = b.indexOf("<CAPWAP_AC>");
    b = _seccion(b, "WLANS", c.wlans.map(_wlanXml).join(""), cap);
    b = _seccion(b, "AP_GROUPS", c.grupos.map(function (g) {
        return "<AP_GROUP><NAME>" + _xml(g.nombre) + "</NAME><DESCRIPTION/><WLANS>" + g.wlans.map(function (w) { return "<WLAN><NAME>" + _xml(w) + "</NAME></WLAN>"; }).join("") + "</WLANS></AP_GROUP>";
    }).join(""), cap);
    b = _seccion(b, "APS", c.aps.map(function (a) { return "<AP><MAC>" + _xml(a.mac) + "</MAC><AP_GROUP>" + _xml(a.grupo) + "</AP_GROUP></AP>"; }).join(""), cap);
    b = _seccion(b, "RADIUS_SERVERS", c.radius.map(function (r, i) {
        return "<ACS_SERVER_INFO><IP>" + r.ip + "</IP><PORT>" + r.puerto + "</PORT><KEY>" + _xml(r.clave) + "</KEY><IS_SINGLE_CONNECTION>false</IS_SINGLE_CONNECTION><INDEX>" + (i + 1) + "</INDEX><SERVER_NAME/></ACS_SERVER_INFO>";
    }).join(""), cap);
    return _seccion(b, "LOCAL_USERS", c.usuarios.map(function (u) { return "<LOCAL_USER_ID>" + _xml(u.id) + "</LOCAL_USER_ID><LOCAL_USER_PW>" + _xml(u.clave) + "</LOCAL_USER_PW>"; }).join(""), cap);
}

function _parchearServidor(b, s) {
    var p = b.indexOf("<PORT>");
    b = _poner(b, "UP_METHOD", 5, p);
    b = _poner(b, "IP", s.ip, p);
    b = _poner(b, "SUBNET", s.mascara, p);
    b = _poner(b, "PORT_GATEWAY", s.gw, p);
    b = _poner(b, "PORT_DHCP_ENABLE", "false", p);
    b = _poner(b, "GATEWAY", s.gw);
    return _seccion(b, "ACS_SERVER", "<ENABLED>1</ENABLED><USERS>" + s.usuarios.map(function (u) {
        return "<USER><NAME>" + _xml(u.nombre) + "</NAME><PASSWORD>" + _xml(u.clave) + "</PASSWORD><DESCRIPTION/></USER>";
    }).join("") + "</USERS><ACS_CLIENTS>" + s.clientes.map(function (c) {
        return "<CLIENT><HOST_IP>" + c.ip + "</HOST_IP><KEY>" + _xml(c.clave) + "</KEY><DESCRIPTION>" + _xml(c.nombre) + "</DESCRIPTION><SERVER_TYPE>" + c.tipo + "</SERVER_TYPE></CLIENT>";
    }).join("") + "</ACS_CLIENTS><RADIUS_SETTINGS><AUTH_PORT>" + s.puerto + "</AUTH_PORT></RADIUS_SETTINGS>");
}

function _parchearAp(b, a) {
    var radio = b.indexOf("<TYPE>eAccessPointWireless");
    if (radio >= 0) {
        b = _poner(b, "UP_METHOD", 0, radio);
        b = _poner(b, "PORT_DHCP_ENABLE", "false", radio);
    }
    var cable = b.search(/<TYPE>eCopper\w*Ethernet/);
    if (cable >= 0) {
        b = _poner(b, "UP_METHOD", 1, cable);
        b = _poner(b, "PORT_DHCP_ENABLE", "true", cable);
    }
    return _seccion(b, "WLANS", a.plan.map(_wlanXml).join(""), b.indexOf("<CAPWAP>"));
}

function _parchearTelefono(b, t) {
    var wc = b.indexOf("<WIRELESS_COMMON>");
    b = _poner(b, "SSID", t.ssid, wc);
    b = _poner(b, "ENCRYPT_TYPE", AES, wc);
    b = _poner(b, "AUTHEN_TYPE", WPA2_EAP, wc);
    var fin = b.indexOf("</WIRELESS_COMMON>", wc), proceso = b.indexOf("<WEP_PROCESS>", wc);
    var nuevo = "<WEP_PROCESS><KEY></KEY><USERID>" + _xml(RADIUS_USUARIO) + "</USERID><PASSWORD>" + _xml(RADIUS_CLAVE) + "</PASSWORD><ENCRYPTION>" + AES + "</ENCRYPTION></WEP_PROCESS>";
    if (proceso >= 0 && proceso < fin) {
        b = b.substring(0, proceso) + nuevo + b.substring(b.indexOf("</WEP_PROCESS>", proceso) + 14);
    } else {
        var canal = b.indexOf("<STANDARD_CHANNEL5G>", wc);
        b = b.substring(0, canal) + nuevo + b.substring(canal);
    }
    var cp = b.indexOf("<CURRENT_PROFILE>");
    b = _poner(b, "SSID", t.ssid, cp);
    b = _poner(b, "AUTHEN_TYPE", WPA2_EAP, cp);
    b = _poner(b, "ENCRYPT_TYPE", AES, cp);
    b = _poner(b, "WPA_EAP_USERID", RADIUS_USUARIO, cp);
    b = _poner(b, "WPA_EAP_PASSWORD", RADIUS_CLAVE, cp);
    return _poner(b, "DHCP_ENABLED", 1, cp);
}

// La práctica con todo lo inalámbrico en su lugar.
function parchearInalambrico(xml, ina) {
    var cambios = {};
    function agrega(lista, f) { lista.forEach(function (x) { cambios[x.equipo] = function (b) { return f(b, x); }; }); }
    agrega(ina.controladoras, _parchearControladora);
    agrega(ina.servidores, _parchearServidor);
    agrega(ina.aps, _parchearAp);
    agrega(ina.telefonos, _parchearTelefono);
    var partes = [], pos = 0;
    for (;;) {
        var ini = xml.indexOf("<DEVICE>", pos);
        if (ini < 0) { break; }
        var fin = xml.indexOf("</DEVICE>", ini);
        if (fin < 0) { break; }
        var b = xml.substring(ini, fin), e = b.indexOf("<ENGINE>");
        var mn = e < 0 ? null : /<NAME[^>]*>([^<]*)<\/NAME>/.exec(b.substring(e, e + 800));
        var f = mn ? cambios[_entidades(mn[1]).trim()] : null;
        partes.push(xml.substring(pos, ini), f ? f(b) : b);
        pos = fin;
    }
    partes.push(xml.substring(pos));
    return partes.join("");
}
