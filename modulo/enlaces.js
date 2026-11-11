// Los enlaces entre ruteadores. La nota junto al cable manda ('.4'): el enlace va en ese /30
// aunque ya tenga otra red. Los que no tienen nota toman el primero libre, y los que la traen
// mal se corrigen. Es pkt/enlaces.py, más la dirección IPv6 de cada enlace.

var _DISTANCIA_MAXIMA = 200;

function _redIfaz(i) { return redDe(i.ip, i.mascara); }

function _ordenEq(d, vis) { return [d.esMulticapa ? 1 : 0, natural(vis[d.nombre])]; }

function _para_lan(d, ifaz) {
    var base = ifaz.nombre.toLowerCase() + ".";
    if (d.interfaces.some(function (i) { return i.nombre.toLowerCase().indexOf(base) === 0; })) { return true; }
    var ic = d.cfg ? d.cfg.porNombre(ifaz.nombre) : null;
    return !!(ic && !ic.ruteado && (ic.modo || ic.accesoVlan || ic.canal));
}

function _cablesL3(topo, vis) {
    var salida = [];
    topo.enlaces.forEach(function (e) {
        var a = topo.porNombre(e.a), b = topo.porNombre(e.b);
        if (!a || !b || !a.esRuteador || !b.esRuteador) { return; }
        var ia = a.interfaz(e.pa), ib = b.interfaz(e.pb);
        if (!ia || !ib) { return; }
        if (_cmpValor(_ordenEq(b, vis), _ordenEq(a, vis)) < 0) { salida.push([b, ib, a, ia]); }
        else { salida.push([a, ia, b, ib]); }
    });
    return ordenar(salida, function (t) { return [_ordenEq(t[0], vis), natural(t[1].nombre)]; });
}

function _mascaraComun(cables) {
    var cuenta = [];
    cables.forEach(function (c) {
        if (c[1].configurada && c[3].configurada) {
            var ra = _redIfaz(c[1]), rb = _redIfaz(c[3]);
            if (ra && rb && mismaRed(ra, rb)) { cuenta.push(c[1].mascara); }
        }
    });
    if (!cuenta.length) {
        cables.forEach(function (c) {
            if (c[1].configurada) { cuenta.push(c[1].mascara); }
            if (c[3].configurada) { cuenta.push(c[3].mascara); }
        });
    }
    return cuenta.length ? masComun(cuenta) : null;
}

function _conIp(topo, ip, excepto) {
    var salida = [];
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            if (i.ip === ip && i !== excepto) { salida.push(d); }
        });
    });
    return salida;
}

function _dentroDe(topo, red, excepto) {
    var salida = [];
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            if (excepto.indexOf(i) < 0 && esIp(i.ip) && contiene(red, i.ip)) { salida.push(d); }
        });
    });
    return salida;
}

function _hostLibre(topo, red, preferida, excepto) {
    var ocupadas = {};
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) { if (i !== excepto) { ocupadas[i.ip] = true; } });
    });
    var candidatas = [];
    var t = tamanoRed(red.p);
    if (preferida !== null && preferida !== undefined) { candidatas.push(red.n + (ipAEntero(preferida) % t)); }
    for (var h = 1; h < t - 1 && h <= 1024; h++) { candidatas.push(red.n + h); }
    for (var k = 0; k < candidatas.length; k++) {
        var c = candidatas[k];
        if (c !== red.n && c !== red.n + t - 1 && !ocupadas[enteroAIp(c)]) { return enteroAIp(c); }
    }
    return null;
}

function _listaVis(vis, equipos) {
    var nombres = [];
    equipos.forEach(function (d) { if (nombres.indexOf(vis[d.nombre]) < 0) { nombres.push(vis[d.nombre]); } });
    nombres = ordenar(nombres, natural);
    return nombres.length === 1 ? nombres[0] : nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1];
}

function _sospechas(topo, vis, vlans, comun, ifaz, vecina) {
    var motivos = [], red = _redIfaz(ifaz);
    var dup = _conIp(topo, ifaz.ip, ifaz);
    if (dup.length) { motivos.push("la ip " + ifaz.ip + " ya es de " + _listaVis(vis, dup)); }
    var ajenos = _dentroDe(topo, red, [ifaz, vecina]);
    if (ajenos.length) { motivos.push("la red " + textoRed(red) + " ya la usa " + _listaVis(vis, ajenos)); }
    if (comun && ifaz.mascara !== comun && vecina.mascara === comun) { motivos.push("tus enlaces usan " + comun); }
    for (var i = 0; i < vlans.length; i++) {
        if (traslapan(red, vlans[i][0].red)) {
            motivos.push(textoRed(red) + " cae en la vlan " + vlans[i][0].numero + " de " + vlans[i][1]);
            break;
        }
    }
    return motivos;
}

// Este lado del cable ya está en el /30 que dice la nota. '.4' sólo dice el último número.
function _ladoCuadra(i, nota) {
    var r = i.configurada ? _redIfaz(i) : null;
    if (r === null || r.p !== 30 || nota.octeto > 255 || r.n % 256 !== nota.octeto - nota.octeto % 4) { return false; }
    return !nota.prefijo || direccionDe(r).indexOf(nota.prefijo + ".") === 0;
}

// Cada nota, con el cable que le queda más cerca. Primero con el que ya está en su red: dos
// cables juntos pueden quedar más cerca de la nota del otro, y aquí la nota manda.
function _etiquetar(cables, notas) {
    var pares = [];
    notas.forEach(function (nota, k) {
        cables.forEach(function (c, j) {
            if (c[0].x === null || c[2].x === null) { return; }
            var d = _distancia(nota.x, nota.y, (c[0].x + c[2].x) / 2, (c[0].y + c[2].y) / 2);
            if (d <= _DISTANCIA_MAXIMA) { pares.push([(_ladoCuadra(c[1], nota) ? 0 : 1) + (_ladoCuadra(c[3], nota) ? 0 : 1), d, k, j]); }
        });
    });
    var asignadas = {}, usadas = {};
    ordenar(pares, function (p) { return p; }).forEach(function (p) {
        if (!usadas[p[2]] && asignadas[p[3]] === undefined) {
            asignadas[p[3]] = notas[p[2]];
            usadas[p[2]] = true;
        }
    });
    return asignadas;
}

function _tresOctetos(ip) { return ip.split(".").slice(0, 3).join("."); }

// De dónde salen los primeros números de una nota corta. Lo que dicen las notas completas manda.
// '.4' no los dice: son los de los enlaces que ya cuadran con su nota. Si ninguno cuadra, lo
// configurado no vale y se toman de tus combos.
function _baseEnlaces(cables, bases, etiquetas, inferida) {
    var cuenta = [], indices = Object.keys(etiquetas);
    indices.forEach(function (j) { if (etiquetas[j].prefijo) { cuenta.push(etiquetas[j].prefijo); } });
    if (!cuenta.length) {
        indices.forEach(function (j) {
            [cables[j][1], cables[j][3]].forEach(function (i) {
                if (_ladoCuadra(i, etiquetas[j])) { cuenta.push(_tresOctetos(direccionDe(_redIfaz(i)))); }
            });
        });
    }
    if (!cuenta.length && indices.length && inferida !== null) { return _tresOctetos(enteroAIp(inferida.inicio)); }
    if (!cuenta.length) {
        cables.forEach(function (c) {
            [c[1], c[3]].forEach(function (i) {
                var r = i.configurada ? _redIfaz(i) : null;
                if (r !== null && r.p === 30) { cuenta.push(_tresOctetos(direccionDe(r))); }
            });
        });
    }
    if (!cuenta.length) { bases.forEach(function (b) { cuenta.push(_tresOctetos(enteroAIp(b))); }); }
    return cuenta.length ? masComun(cuenta) : null;
}

function _redDeNota(nota, base) {
    var prefijo = nota.prefijo || base;
    if (prefijo === null || nota.octeto > 255) { return null; }
    var ip = prefijo + "." + (nota.octeto - nota.octeto % 4);
    return esIp(ip) ? red4(ip, 30) : null;
}

function _ocupadasLink(topo, vlans) {
    var redes = vlans.map(function (v) { return v[0].red; });
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            var r = _redIfaz(i);
            if (r !== null) { redes.push(r); }
        });
    });
    return redes;
}

function _clave(a, pa, b, pb) {
    var x = a + "\u0000" + pa.toLowerCase(), y = b + "\u0000" + pb.toLowerCase();
    return x < y ? x + "\u0001" + y : y + "\u0001" + x;
}

function _anotarMal(c, d, texto) {
    (c.mal[d.nombre] = c.mal[d.nombre] || []).push(texto);
}

function _aplicarEnlace(c, d, ifaz, ip, mascara) {
    if (ifaz.configurada && (ifaz.ip !== ip || ifaz.mascara !== mascara)) {
        _anotarMal(c, d, ifaz.nombre + " tiene " + ifaz.ip + " " + ifaz.mascara + ", y le toca " + ip + " " + mascara);
    }
    ifaz.ip = ip;
    ifaz.mascara = mascara;
    ifaz.encendida = true;
    var lineas = ["interface " + ifaz.nombre];
    if (d.esMulticapa) { lineas.push(" no switchport"); }
    lineas.push(" ip address " + ip + " " + mascara, " no shutdown");
    (c.ordenes[d.nombre] = c.ordenes[d.nombre] || []).push(_orden("enlace", lineas));
}

// La nota manda: los dos lados van en su /30. Lo que ya esté bien se queda como está.
function _conNota(c, cable, red) {
    var a = cable[0], ia = cable[1], b = cable[2], ib = cable[3];
    var mascara = mascaraDe(30), h1 = enteroAIp(red.n + 1), h2 = enteroAIp(red.n + 2);
    function bien(i) { return i.configurada && i.mascara === mascara && (i.ip === h1 || i.ip === h2); }
    c.revisados[_clave(a.nombre, ia.nombre, b.nombre, ib.nombre)] = true;
    [[a, ia], [b, ib]].forEach(function (lado) {
        if (_para_lan(lado[0], lado[1])) { _anotarMal(c, lado[0], lado[1].nombre + " está de puerto de lan, y su nota dice que es un enlace"); }
    });
    var ipA = h1, ipB = h2;
    if (bien(ia) && bien(ib) && ia.ip !== ib.ip) {
        ipA = ia.ip;
        ipB = ib.ip;
    } else if (bien(ia)) {
        ipA = ia.ip;
        ipB = ipA === h1 ? h2 : h1;
    } else if (bien(ib)) {
        ipB = ib.ip;
        ipA = ipB === h1 ? h2 : h1;
    }
    if (ia.ip !== ipA || ia.mascara !== mascara) { _aplicarEnlace(c, a, ia, ipA, mascara); }
    if (ib.ip !== ipB || ib.mascara !== mascara) { _aplicarEnlace(c, b, ib, ipB, mascara); }
}

function _dosLados(topo, c, vis, vlans, comun, cable) {
    var a = cable[0], ia = cable[1], b = cable[2], ib = cable[3];
    var ra = _redIfaz(ia), rb = _redIfaz(ib);
    if (ra === null || rb === null) { return; }
    if (mismaRed(ra, rb)) {
        if (ia.ip === ib.ip) { _mismaIp(topo, c, vis, ra, cable); }
        return;
    }
    var llave = _clave(a.nombre, ia.nombre, b.nombre, ib.nombre);
    var sa = _sospechas(topo, vis, vlans, comun, ia, ib);
    var sb = _sospechas(topo, vis, vlans, comun, ib, ia);
    if (!!sa.length === !!sb.length) {
        sa = [];
        sb = ["adivinado"];
    }
    var malEs = sa.length ? [a, ia, b, ib] : [b, ib, a, ia];
    var mal = malEs[0], imal = malEs[1], bien = malEs[2], ibien = malEs[3];
    var red = _redIfaz(ibien);
    var nueva = _hostLibre(topo, red, imal.ip, imal);
    if (nueva === null) { return; }
    c.revisados[llave] = true;
    c.avisos.push(vis[mal.nombre] + " " + imal.nombre + ": se corrige a " + nueva + " " + ibien.mascara + " para que cuadre con " + vis[bien.nombre]);
    _aplicarEnlace(c, mal, imal, nueva, ibien.mascara);
}

function _mismaIp(topo, c, vis, red, cable) {
    var a = cable[0], ia = cable[1], b = cable[2], ib = cable[3];
    if (red.p !== 30) { return; }
    var primera = enteroAIp(red.n + 1), segunda = enteroAIp(red.n + 2);
    var t = ia.ip === primera ? [b, ib, a, ia, segunda] : [a, ia, b, ib, primera];
    if (_conIp(topo, t[4]).length) { return; }
    c.revisados[_clave(a.nombre, ia.nombre, b.nombre, ib.nombre)] = true;
    c.avisos.push(vis[t[0].nombre] + " " + t[1].nombre + " tiene la misma ip que su vecino: se corrige a " + t[4]);
    _aplicarEnlace(c, t[0], t[1], t[4], t[1].mascara);
}

function _unLado(topo, c, vis, cable) {
    var a = cable[0], ia = cable[1], b = cable[2], ib = cable[3];
    var t = ia.configurada ? [a, ia, b, ib] : [b, ib, a, ia];
    var red = _redIfaz(t[1]);
    if (red === null || red.p !== 30 || _para_lan(t[2], t[3])) { return; }
    var otra = _hostLibre(topo, red);
    if (otra === null) { return; }
    c.revisados[_clave(a.nombre, ia.nombre, b.nombre, ib.nombre)] = true;
    _aplicarEnlace(c, t[2], t[3], otra, t[1].mascara);
}

function _siguiente30(topo, vlans, base, reservadas) {
    var enlaces = [];
    topo.ruteadores.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            var r = i.planeada ? null : _redIfaz(i);
            if (r !== null && r.p === 30) { enlaces.push(r.n); }
        });
    });
    var ocupadas = _ocupadasLink(topo, vlans).concat(reservadas);
    var siguiente;
    if (base !== null) { siguiente = ipAEntero(base + ".4"); }
    else if (enlaces.length) { siguiente = Math.max.apply(null, enlaces) + 4; }
    else { return null; }
    for (var k = 0; k < 65536 && siguiente <= 4294967292; k++) {
        var cand = { n: siguiente, p: 30 };
        if (!ocupadas.some(function (o) { return traslapan(cand, o); })) { return cand; }
        siguiente += 4;
    }
    return null;
}

function _textoCable(vis, t) { return vis[t[0].nombre] + " " + t[1].nombre + " - " + vis[t[2].nombre] + " " + t[3].nombre; }

// Un cable sin IP y sin una nota que se pueda cumplir. `pedida`: la red de su nota, si otra nota ya
// la tomó. Las que sí se pueden cumplir ya se aplicaron. Si la tomó otra nota (`repetida`), eso se
// avisa al final, con las dos notas.
function _sinIp(topo, c, vis, vlans, cable, nota, pedida, base, reservadas, repetida) {
    var a = cable[0], ia = cable[1], b = cable[2], ib = cable[3];
    if ((a.esMulticapa && b.esMulticapa && !nota) || _para_lan(a, ia) || _para_lan(b, ib)) { return; }
    c.revisados[_clave(a.nombre, ia.nombre, b.nombre, ib.nombre)] = true;
    var texto = _textoCable(vis, cable);
    if (nota && pedida === null && nota.octeto <= 255 && base === null) {
        c.avisos.push("el cable " + texto + " tiene la nota '" + nota.texto + "', pero no se sabe en qué red van tus enlaces");
        return;
    }
    if (nota && pedida === null) {
        c.avisos.push("la nota '" + nota.texto + "' junto al cable " + texto + " no es una dirección válida: se eligió otro /30");
    }
    var red = _siguiente30(topo, vlans, base, reservadas);
    if (pedida !== null && !repetida) {
        var dentro = _dentroDe(topo, pedida, []);
        var deQuien = dentro.length ? ", que ya " + (dentro.length > 1 ? "usan " : "usa ") + _listaVis(vis, dentro) : ", que ya está ocupada";
        c.avisos.push("la nota '" + nota.texto + "' junto al cable " + texto + " cae en " + textoRed(pedida) + deQuien
                      + (red !== null ? ": se eligió " + textoRed(red) : ""));
    }
    if (red === null) {
        c.avisos.push("el cable " + texto + " no tiene ip y no hay de dónde tomar la numeración: ponle una nota con la dirección completa ('12.0.0.4')");
        return;
    }
    if (pedida === null) {
        c.supuestos.push("enlace " + texto + ": se eligió " + textoRed(red) + ", el primero libre");
    }
    _aplicarEnlace(c, a, ia, enteroAIp(red.n + 1), mascaraDe(30));
    _aplicarEnlace(c, b, ib, enteroAIp(red.n + 2), mascaraDe(30));
}

function _revisarNotas(c, vis, cables, etiquetas, base, repetidas) {
    Object.keys(etiquetas).map(Number).sort(function (x, y) { return x - y; }).forEach(function (j) {
        var t = cables[j], nota = etiquetas[j];
        if (repetidas[j] !== undefined || c.revisados[_clave(t[0].nombre, t[1].nombre, t[2].nombre, t[3].nombre)]) { return; }
        if (!t[1].configurada || !t[3].configurada) { return; }
        var red = _redIfaz(t[1]), rb = _redIfaz(t[3]);
        if (!red || !rb || !mismaRed(red, rb)) { return; }
        var esperada = _redDeNota(nota, base);
        var texto = vis[t[0].nombre] + " - " + vis[t[2].nombre];
        if (esperada === null) {
            c.avisos.push("la nota '" + nota.texto + "' junto al enlace " + texto + " no es una dirección válida; el enlace tiene " + textoRed(red));
        } else if (!mismaRed(esperada, red)) {
            c.avisos.push("la nota '" + nota.texto + "' junto al enlace " + texto + " dice " + textoRed(esperada) + ", pero el enlace tiene " + textoRed(red));
        }
    });
}

// Dos notas que piden el mismo /30 ('.52' en dos cables): una de las dos está mal. Se queda con él la
// que va antes en `conNota`, y se dice en qué red quedó el cable de la otra.
function _avisarRepetidas(c, vis, cables, etiquetas, repetidas, pedidas) {
    Object.keys(repetidas).map(Number).sort(function (x, y) { return x - y; }).forEach(function (j) {
        var t = cables[j], k = repetidas[j];
        var ra = t[1].configurada ? _redIfaz(t[1]) : null, rb = t[3].configurada ? _redIfaz(t[3]) : null;
        var queda = ra && rb && mismaRed(ra, rb) && !traslapan(ra, pedidas[j]);
        c.avisos.push("la nota '" + etiquetas[j].texto + "' junto al cable " + _textoCable(vis, t) + " repite la red de la nota '"
                      + etiquetas[k].texto + "' junto al cable " + _textoCable(vis, cables[k]) + " (" + textoRed(pedidas[j]) + ")"
                      + (queda ? ": a " + vis[t[0].nombre] + " - " + vis[t[2].nombre] + " le toca " + textoRed(ra) + " hasta que corrijas una" : ": corrige una"));
    });
}

function _apagadas(topo, c) {
    var cableados = {};
    topo.enlaces.forEach(function (e) {
        cableados[e.a + "\u0000" + e.pa.toLowerCase()] = true;
        cableados[e.b + "\u0000" + e.pb.toLowerCase()] = true;
    });
    topo.ruteadores.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            if (i.encendida || i.planeada || !cableados[d.nombre + "\u0000" + i.nombre.toLowerCase()]) { return; }
            i.encendida = true;
            (c.ordenes[d.nombre] = c.ordenes[d.nombre] || []).push(_orden("enlace", ["interface " + i.nombre, " no shutdown"]));
        });
    });
}

function porPuerto(orden) {
    for (var k = 0; k < orden.lineas.length; k++) {
        if (orden.lineas[k].indexOf("interface ") === 0) {
            return (orden.lineas[k].match(/\d+/g) || []).map(Number);
        }
    }
    return [];
}

// Dos cables entre un router con nota y un multicapa: uno es el enlace, y el que queda sin nota y sin
// IP es la troncal de la red del router (la nativa, con lo inalámbrico). Ese no lleva IP.
function _reservarTroncales(c, cables, etiquetas, res) {
    var pares = {};
    cables.forEach(function (t, j) {
        var k = t[0].nombre + "\u0000" + t[2].nombre;
        (pares[k] = pares[k] || []).push(j);
    });
    Object.keys(pares).forEach(function (k) {
        var js = pares[k];
        if (js.length < 2) { return; }
        var r = cables[js[0]][0], m = cables[js[0]][2];
        if (r.esMulticapa === m.esMulticapa) { return; }
        var router = r.esMulticapa ? m : r;
        if (!res.tramos.some(function (t) { return t.util && t.dueno === router; })) { return; }
        function vacio(j) { return !etiquetas[j] && !cables[j][1].configurada && !cables[j][3].configurada; }
        var libres = js.filter(vacio);
        // Si todos están vacíos, el primero es el enlace.
        if (libres.length === js.length) { libres = libres.slice(1); }
        libres.forEach(function (j) {
            var t = cables[j];
            c.revisados[_clave(t[0].nombre, t[1].nombre, t[2].nombre, t[3].nombre)] = true;
        });
    });
}

function corregirEnlaces(topo, res) {
    var c = { ordenes: {}, avisos: [], supuestos: [], revisados: {}, cables: [], etiquetas: {}, mal: {} };
    var vis = topo.visibles();
    var cables = _cablesL3(topo, vis);
    var rn = redesDeNotas(res);
    var comun = _mascaraComun(cables);
    var etiquetas = _etiquetar(cables, res.enlacesNota);
    var base = _baseEnlaces(cables, rn.bases, etiquetas, baseInferida(res));
    c.cables = cables;
    c.etiquetas = etiquetas;

    // Primero las notas, y lo configurado no les estorba: lo que esté en su red se borra después.
    // Sólo otra nota puede ganarle a una. Las que dicen justo el inicio de su bloque van antes:
    // '.44' le gana a '.47'; entre dos iguales, la del cable que ya está hecho como dice. `repetidas`:
    // el cable cuya nota pide la red de otra nota, con el de esa.
    var tomadas = rn.vlans.map(function (v) { return v[0].red; }), pedidas = {}, deNotas = [], repetidas = {};
    var conNota = ordenar(Object.keys(etiquetas).map(Number), function (j) {
        var nota = etiquetas[j], faltan = (_ladoCuadra(cables[j][1], nota) ? 0 : 1) + (_ladoCuadra(cables[j][3], nota) ? 0 : 1);
        return [nota.octeto % 4 !== 0 ? 1 : 0, faltan, j];
    });
    conNota.forEach(function (j) {
        var red = _redDeNota(etiquetas[j], base);
        if (red === null) { return; }
        var otra = deNotas.filter(function (x) { return traslapan(red, x.red); })[0];
        if (otra) { repetidas[j] = otra.j; }
        if (tomadas.some(function (o) { return traslapan(red, o); })) {
            pedidas[j] = red;
            return;
        }
        tomadas.push(red);
        deNotas.push({ red: red, j: j });
        _conNota(c, cables[j], red);
    });
    function cumplida(t) { return c.revisados[_clave(t[0].nombre, t[1].nombre, t[2].nombre, t[3].nombre)]; }
    _reservarTroncales(c, cables, etiquetas, res);

    cables.forEach(function (t) {
        if (!cumplida(t) && t[1].configurada && t[3].configurada) { _dosLados(topo, c, vis, rn.vlans, comun, t); }
    });
    cables.forEach(function (t) {
        if (!cumplida(t) && t[1].configurada !== t[3].configurada) { _unLado(topo, c, vis, t); }
    });
    cables.forEach(function (t, j) {
        if (cumplida(t)) { return; }
        // Lo que el cable de una nota repetida ya tenga en la red de la otra choca con ella (la misma ip
        // en dos routers): ese cable va al primer /30 libre, como uno vacío.
        var repetida = repetidas[j] !== undefined;
        var choca = repetida && [t[1], t[3]].some(function (i) { return i.configurada && contiene(pedidas[j], i.ip); });
        if (choca || (!t[1].configurada && !t[3].configurada)) {
            _sinIp(topo, c, vis, rn.vlans, t, etiquetas[j], pedidas[j] || null, base, redesEscritas(res.tramos.map(function (tramo) { return tramo.leido.pedidas; })), repetida);
        }
    });
    _apagadas(topo, c);
    _revisarNotas(c, vis, cables, etiquetas, base, repetidas);
    _avisarRepetidas(c, vis, cables, etiquetas, repetidas, pedidas);
    Object.keys(c.ordenes).forEach(function (k) { c.ordenes[k] = ordenar(c.ordenes[k], porPuerto); });
    return c;
}

// IPv6 de los enlaces: lo que ya traen si cuadra (un /127 en los dos lados), lo que
// diga su nota ('.4 ::/127'), o el primer /127 libre de la base de tus combos. Al
// primer equipo le toca la dirección más baja, como en IPv4.
function asignarIpv6Enlaces(topo, c, plan) {
    var base6 = plan.base6;
    if (!base6) { return; }
    var ocupadas = [];
    plan.sitios.forEach(function (s) {
        s.vlans.forEach(function (v) { if (v.red6 && !v.reservado6) { ocupadas.push(v.red6); } });
    });
    var porRed = c.cables.map(function (t, j) { return [j, t]; });
    porRed = ordenar(porRed, function (x) {
        var r = x[1][1].configurada ? _redIfaz(x[1][1]) : null;
        return [r ? r.n : 0, x[0]];
    });
    function propia(i) {
        for (var k = 0; k < i.ipv6.length; k++) {
            var a = parseV6Prefijo(i.ipv6[k]);
            if (a && a.p === 127) { return a; }
        }
        return null;
    }
    // Primero las que ya están o las que apartan las notas, para no pisarlas.
    var asignadas = {};
    porRed.forEach(function (x) {
        var j = x[0], t = x[1], nota = c.etiquetas[j];
        var pa = propia(t[1]), pb = propia(t[3]);
        var red = null;
        if (nota && nota.v6) {
            var escrita = nota.v6.split("/");
            var g = parse6(escrita[0]);
            if (g) { red = red6(g, escrita.length > 1 ? +escrita[1] : 127); }
        } else if (pa && pb && iguales6(red6(pa.g, 127).g, red6(pb.g, 127).g) && !iguales6(pa.g, pb.g)
                   && !ocupadas.some(function (o) { return traslapan6(red6(pa.g, 127), o); })) {
            asignadas[j] = [pa.g, pb.g];
            ocupadas.push(red6(pa.g, 127));
            return;
        }
        if (red) {
            asignadas[j] = [red.g, ultima6(red)];
            ocupadas.push(red);
        }
    });
    var siguiente = red6(base6.g, 64).g;
    porRed.forEach(function (x) {
        var j = x[0];
        if (asignadas[j]) { return; }
        for (var k = 0; k < 65536; k++) {
            var cand = { g: siguiente, p: 127 };
            siguiente = mas6(siguiente, 2);
            if (!ocupadas.some(function (o) { return traslapan6(cand, o); })) {
                asignadas[j] = [cand.g, ultima6(cand)];
                ocupadas.push(cand);
                return;
            }
        }
    });
    porRed.forEach(function (x) {
        var j = x[0], t = x[1];
        if (!asignadas[j]) { return; }
        [[t[0], t[1], asignadas[j][0]], [t[2], t[3], asignadas[j][1]]].forEach(function (lado) {
            var d = lado[0], i = lado[1], g = lado[2];
            i.gw6 = g;
            i.red6 = red6(g, 127);
            var ic = d.cfg ? d.cfg.porNombre(i.nombre) : null;
            var l = lineasIpv6(ic || { ipv6: i.ipv6 }, texto6(g) + "/127");
            if (l.bien) { return; }
            var lista = c.ordenes[d.nombre] = c.ordenes[d.nombre] || [];
            var deEsaIfaz = lista.filter(function (o) { return o.lineas.indexOf("interface " + i.nombre) >= 0; })[0];
            if (deEsaIfaz) {
                // El mismo párrafo que su IPv4, antes del 'no shutdown'.
                var fin = deEsaIfaz.lineas.indexOf(" no shutdown");
                if (fin < 0) { fin = deEsaIfaz.lineas.length; }
                Array.prototype.splice.apply(deEsaIfaz.lineas, [fin, 0].concat(l.quita, [l.linea]));
            } else {
                lista.push(_orden("enlace", ["interface " + i.nombre].concat(l.quita, [l.linea])));
            }
        });
    });
    Object.keys(c.ordenes).forEach(function (k) { c.ordenes[k] = ordenar(c.ordenes[k], porPuerto); });
}
