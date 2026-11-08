// Ruteo estático: una red destino a la vez, cada equipo reenvía al vecino que lo
// acerca. Es pkt/red.py (calcular_rutas y _cotejar); las rutas IPv6 siguen el mismo
// camino que las de IPv4.

function construirSubredes(topo) {
    var mapa = new Map();
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            var r = redDe(i.ip, i.mascara);
            if (r === null) { return; }
            var k = direccionDe(r) + "/" + r.p;
            if (!mapa.has(k)) { mapa.set(k, { red: r, interfaces: [] }); }
            mapa.get(k).interfaces.push([d, i]);
        });
    });
    var lista = [];
    mapa.forEach(function (s) { lista.push(s); });
    return ordenar(lista, function (s) { return [s.red.n, s.red.p]; });
}

function _rtsDe(sub) { return sub.interfaces.filter(function (x) { return x[0].esRuteador; }); }

function _vecinos(subredes) {
    var ady = {};
    subredes.forEach(function (sub) {
        var rts = _rtsDe(sub);
        rts.forEach(function (x) {
            var lista = ady[x[0].nombre] = ady[x[0].nombre] || [];
            rts.forEach(function (y) {
                if (y[0].nombre !== x[0].nombre) { lista.push([y[0].nombre, y[1].ip, x[1].nombre]); }
            });
        });
    });
    Object.keys(ady).forEach(function (k) {
        ady[k] = ordenar(ady[k], function (t) { return [t[0], ipAEntero(t[1])]; });
    });
    return ady;
}

function _distanciasA(destinos, ady) {
    var dist = {}, cola = destinos.slice();
    destinos.forEach(function (n) { dist[n] = 0; });
    while (cola.length) {
        var u = cola.shift();
        (ady[u] || []).forEach(function (t) {
            if (dist[t[0]] === undefined) {
                dist[t[0]] = dist[u] + 1;
                cola.push(t[0]);
            }
        });
    }
    return dist;
}

function _cobertura(rutas) {
    var salida = [];
    rutas.forEach(function (r) {
        var red = redDe(r[0], r[1]);
        if (red !== null) { salida.push([red, r[2]]); }
    });
    return salida;
}

function _cubre(cobertura, destino) {
    var mejor = null;
    cobertura.forEach(function (c) {
        if (subredDe(destino, c[0]) && (mejor === null || c[0].p > mejor[0].p)) { mejor = c; }
    });
    return mejor;
}

function calcularRutas(topo, subredes) {
    var ady = _vecinos(subredes);
    var ruteadores = topo.ruteadores;
    ruteadores.forEach(function (r) { ady[r.nombre] = ady[r.nombre] || []; });
    var rutas = {}, inalcanzables = [];
    ruteadores.forEach(function (r) { rutas[r.nombre] = []; });

    subredes.forEach(function (sub) {
        var duenos = _rtsDe(sub).map(function (x) { return x[0].nombre; });
        if (!duenos.length) { return; }
        var dist = _distanciasA(duenos, ady);
        ruteadores.forEach(function (router) {
            if (duenos.indexOf(router.nombre) >= 0) { return; }
            var propia = dist[router.nombre];
            if (propia === undefined) {
                if (inalcanzables.indexOf(sub) < 0) { inalcanzables.push(sub); }
                return;
            }
            var mejor = null, validos = [];
            ady[router.nombre].forEach(function (t) {
                var cerca = dist[t[0]];
                if (cerca === undefined || cerca >= propia) { return; }
                validos.push(t[1]);
                var clave = [cerca, ipAEntero(t[1])];
                if (mejor === null || _cmpValor(clave, mejor[0]) < 0) { mejor = [clave, t[1], t[2]]; }
            });
            if (mejor === null) { return; }
            rutas[router.nombre].push({ red: sub.red, salto: mejor[1], interfazSalida: mejor[2], destino: duenos[0],
                                        saltos: propia, yaConfigurada: false, cubiertaPor: "", saltoConfigurado: "",
                                        validos: validos, malPuesta: false });
        });
    });
    Object.keys(rutas).forEach(function (k) {
        rutas[k] = ordenar(rutas[k], function (r) { return r.red.n; });
    });
    _cotejar(topo, subredes, rutas, ady);
    return { rutas: rutas, inalcanzables: inalcanzables };
}

function _cotejar(topo, subredes, rutas, ady) {
    var coberturas = {}, vecinos = {}, calculadasDe = {};
    topo.ruteadores.forEach(function (r) { coberturas[r.nombre] = _cobertura(r.rutas); });
    Object.keys(ady).forEach(function (n) {
        vecinos[n] = {};
        ady[n].forEach(function (t) { vecinos[n][t[1]] = t[0]; });
    });
    Object.keys(rutas).forEach(function (n) {
        calculadasDe[n] = rutas[n].map(function (r) { return [r.red, r.salto]; });
    });

    function vecinoPor(nombre, ip, vueltas) {
        vueltas = vueltas || 0;
        var v = (vecinos[nombre] || {})[ip];
        if (v !== undefined) { return v; }
        if (vueltas > 4 || !esIp(ip)) { return null; }
        var hacia = red4(ip, 32);
        var cubre = _cubre(coberturas[nombre] || [], hacia);
        if (cubre) { return vecinoPor(nombre, cubre[1], vueltas + 1); }
        var lista = calculadasDe[nombre] || [];
        for (var i = 0; i < lista.length; i++) {
            if (subredDe(hacia, lista[i][0])) { return vecinoPor(nombre, lista[i][1], vueltas + 1); }
        }
        return null;
    }

    subredes.forEach(function (sub) {
        var duenos = {};
        _rtsDe(sub).forEach(function (x) { duenos[x[0].nombre] = true; });
        var destino = sub.red;
        var calculadas = {};
        Object.keys(rutas).forEach(function (n) {
            rutas[n].forEach(function (r) { if (mismaRed(r.red, sub.red)) { calculadas[n] = r; } });
        });
        if (!Object.keys(duenos).length || !Object.keys(calculadas).length) { return; }

        function salto(nombre) {
            var cubre = _cubre(coberturas[nombre] || [], destino);
            if (cubre) { return cubre[1]; }
            return calculadas[nombre] ? calculadas[nombre].salto : null;
        }
        function llega(nombre) {
            var vistos = {};
            while (!duenos[nombre]) {
                var sig = salto(nombre);
                if (sig === null || vistos[nombre]) { return false; }
                if (!esIp(sig)) { return true; }
                vistos[nombre] = true;
                nombre = vecinoPor(nombre, sig);
                if (nombre === null) { return false; }
            }
            return true;
        }
        Object.keys(calculadas).forEach(function (nombre) {
            var r = calculadas[nombre];
            var cubre = _cubre(coberturas[nombre], destino);
            if (!cubre) { return; }
            r.saltoConfigurado = cubre[1];
            if (esIp(cubre[1]) && r.validos.indexOf(cubre[1]) < 0 && !llega(nombre)) {
                r.malPuesta = mismaRed(cubre[0], destino);
                return;
            }
            r.yaConfigurada = true;
            r.cubiertaPor = mismaRed(cubre[0], destino) ? "" : textoRed(cubre[0]);
        });
    });
}

// Las rutas IPv6: por cada ruta IPv4 hacia una red que también tiene IPv6, otra por
// el mismo vecino, usando la IPv6 de su interfaz.
function calcularRutas6(topo, rutas) {
    var red6De = {}, ifazDe = {};
    topo.dispositivos.forEach(function (d) {
        d.interfacesIp().forEach(function (i) {
            ifazDe[i.ip] = i;
            if (i.red6) { red6De[textoRed(redDe(i.ip, i.mascara))] = i.red6; }
        });
    });
    var salida = {};
    Object.keys(rutas).forEach(function (n) {
        var lista = [];
        rutas[n].forEach(function (r) {
            var destino = red6De[textoRed(r.red)];
            var vecina = ifazDe[r.salto];
            if (destino && vecina && vecina.gw6) { lista.push({ red: destino, salto: vecina.gw6 }); }
        });
        salida[n] = lista;
    });
    return salida;
}
