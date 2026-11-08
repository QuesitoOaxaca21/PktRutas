// Aritmética de direcciones. El motor de Packet Tracer no tiene BigInt, así que
// IPv6 son arreglos de 8 grupos de 16 bits. Una red IPv4 es {n, p} (entero sin
// signo y diagonal); una IPv6, {g, p}.

function esIp(t) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t || "");
    return !!m && +m[1] < 256 && +m[2] < 256 && +m[3] < 256 && +m[4] < 256;
}

function ipAEntero(t) {
    var o = t.split(".");
    return ((+o[0] * 16777216) + (+o[1] << 16) + (+o[2] << 8) + +o[3]);
}

function enteroAIp(n) {
    return Math.floor(n / 16777216) % 256 + "." + (Math.floor(n / 65536) % 256) + "." +
        (Math.floor(n / 256) % 256) + "." + (n % 256);
}

function esMascara(t) {
    if (!esIp(t)) { return false; }
    var v = ipAEntero(t);
    if (v === 0) { return false; }
    var inversa = 4294967295 - v;
    return ((inversa & (inversa + 1)) >>> 0) === 0;
}

function prefijoDeMascara(t) {
    var v = ipAEntero(t), p = 0;
    while (p < 32 && Math.floor(v / Math.pow(2, 31 - p)) % 2 === 1) { p++; }
    return p;
}

function tamanoRed(p) { return Math.pow(2, 32 - p); }
function mascaraDe(p) { return enteroAIp(4294967296 - tamanoRed(p)); }

function red4(ip, pre) {
    var n = typeof ip === "string" ? ipAEntero(ip) : ip;
    var t = tamanoRed(pre);
    return { n: Math.floor(n / t) * t, p: pre };
}

// Red a partir de 'ip' y 'máscara'; null si no se puede.
function redDe(ip, mascara) {
    // 0.0.0.0 no es máscara de interfaz, pero sí la de una ruta por omisión.
    if (!esIp(ip) || !(esMascara(mascara) || mascara === "0.0.0.0")) { return null; }
    return red4(ip, prefijoDeMascara(mascara));
}

function direccionDe(r) { return enteroAIp(r.n); }
function difusionDe(r) { return enteroAIp(r.n + tamanoRed(r.p) - 1); }
function ultimaDe(r) { return enteroAIp(r.n + tamanoRed(r.p) - 2); }
function textoRed(r) { return enteroAIp(r.n) + "/" + r.p; }
function mismaRed(a, b) { return a.n === b.n && a.p === b.p; }
function traslapan(a, b) { return a.n < b.n + tamanoRed(b.p) && b.n < a.n + tamanoRed(a.p); }
function contiene(r, ip) {
    var n = typeof ip === "string" ? ipAEntero(ip) : ip;
    return n >= r.n && n < r.n + tamanoRed(r.p);
}
function subredDe(a, b) { return a.p >= b.p && contiene(b, a.n); }

function prefijoPorClase(direccion) {
    var primero = +direccion.split(".")[0];
    return primero < 128 ? 8 : primero < 192 ? 16 : primero < 224 ? 24 : null;
}

// --- IPv6 ---------------------------------------------------------------------

function parse6(t) {
    t = (t || "").trim();
    if (!/^[0-9a-fA-F:]+$/.test(t) || t.indexOf(":::") >= 0) { return null; }
    var partes = t.split("::");
    if (partes.length > 2) { return null; }
    var izq = partes[0] ? partes[0].split(":") : [];
    var der = partes.length === 2 && partes[1] ? partes[1].split(":") : [];
    if (partes.length === 1 && izq.length !== 8) { return null; }
    if (partes.length === 2 && izq.length + der.length > 7) { return null; }
    var todos = izq.concat(der);
    for (var i = 0; i < todos.length; i++) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(todos[i])) { return null; }
    }
    var g = [];
    izq.forEach(function (x) { g.push(parseInt(x, 16)); });
    for (var c = 8 - izq.length - der.length; c > 0; c--) { g.push(0); }
    der.forEach(function (x) { g.push(parseInt(x, 16)); });
    return g;
}

// Como la muestra IOS: mayúsculas y la corrida de ceros más larga como '::'.
function texto6(g) {
    var mejorIni = -1, mejorLar = 0, i = 0;
    while (i < 8) {
        if (g[i] === 0) {
            var j = i;
            while (j < 8 && g[j] === 0) { j++; }
            if (j - i > mejorLar && j - i >= 2) { mejorIni = i; mejorLar = j - i; }
            i = j;
        } else {
            i++;
        }
    }
    function hex(lista) {
        return lista.map(function (x) { return x.toString(16).toUpperCase(); }).join(":");
    }
    if (mejorIni < 0) { return hex(g); }
    return hex(g.slice(0, mejorIni)) + "::" + hex(g.slice(mejorIni + mejorLar));
}

function iguales6(a, b) {
    for (var i = 0; i < 8; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}

function red6(g, p) {
    var s = [];
    for (var i = 0; i < 8; i++) {
        var bits = Math.max(0, Math.min(16, p - 16 * i));
        s.push(g[i] & (0xFFFF << (16 - bits)) & 0xFFFF);
    }
    return { g: s, p: p };
}

function ultima6(r) {
    var s = [];
    for (var i = 0; i < 8; i++) {
        var bits = Math.max(0, Math.min(16, r.p - 16 * i));
        s.push((r.g[i] | (0xFFFF >> bits)) & 0xFFFF);
    }
    return s;
}

function mas6(g, n) {
    var s = g.slice(), i = 7;
    while (n > 0 && i >= 0) {
        var v = s[i] + n;
        s[i] = v % 65536;
        n = Math.floor(v / 65536);
        i--;
    }
    return s;
}

// a - b como número, si cabe (para medir qué tan lejos quedó un error).
function distancia6(a, b) {
    var d = 0;
    for (var i = 0; i < 8; i++) {
        d = d * 65536 + (a[i] - b[i]);
        if (Math.abs(d) > 1e12) { return d > 0 ? Infinity : -Infinity; }
    }
    return d;
}

function comparar6(a, b) {
    for (var i = 0; i < 8; i++) {
        if (a[i] !== b[i]) { return a[i] < b[i] ? -1 : 1; }
    }
    return 0;
}

function dentro6(r, g) { return iguales6(red6(g, r.p).g, r.g); }
function traslapan6(a, b) { return dentro6(a, b.g) || dentro6(b, a.g); }
function textoRed6(r) { return texto6(r.g) + "/" + r.p; }

// --- utilidades de orden, como las tuplas de Python ------------------------------

function _cmpValor(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        var n = Math.min(a.length, b.length);
        for (var i = 0; i < n; i++) {
            var c = _cmpValor(a[i], b[i]);
            if (c) { return c; }
        }
        return a.length - b.length;
    }
    if (typeof a === typeof b) { return a < b ? -1 : a > b ? 1 : 0; }
    if (typeof a === "boolean") { return (a ? 1 : 0) - b; }
    if (typeof b === "boolean") { return a - (b ? 1 : 0); }
    return typeof a < typeof b ? -1 : 1;     // número contra texto, como natural()
}

// Orden estable con clave, como sorted(lista, key=...).
function ordenar(lista, clave) {
    var deco = lista.map(function (x, i) { return [clave(x), i, x]; });
    deco.sort(function (a, b) { return _cmpValor(a[0], b[0]) || a[1] - b[1]; });
    return deco.map(function (d) { return d[2]; });
}

// 'R10' después de 'R2', como se lee.
function natural(texto) {
    return String(texto).split(/(\d+)/).map(function (t) {
        return /^\d+$/.test(t) ? +t : t.toLowerCase();
    });
}

function masComun(lista) {
    var cuenta = new Map(), mejor = null, n = 0;
    lista.forEach(function (x) { cuenta.set(x, (cuenta.get(x) || 0) + 1); });
    cuenta.forEach(function (c, x) {
        if (c > n) { mejor = x; n = c; }
    });
    return mejor;
}
