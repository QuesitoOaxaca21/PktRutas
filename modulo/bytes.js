// Del archivo que da Packet Tracer (fileSaveToBytes) al XML en texto.
//
// Es lo mismo que pkt/descifrar.py: etapa 1, Twofish en modo EAX con clave e IV
// fijos, etapa 2 y qCompress. Corre igual dentro de Packet Tracer que en Node,
// así las pruebas leen los .pkt de verdad.

var _TF = (function () {
    var T_Q0 = [
        [0x8, 0x1, 0x7, 0xD, 0x6, 0xF, 0x3, 0x2, 0x0, 0xB, 0x5, 0x9, 0xE, 0xC, 0xA, 0x4],
        [0xE, 0xC, 0xB, 0x8, 0x1, 0x2, 0x3, 0x5, 0xF, 0x4, 0xA, 0x6, 0x7, 0x0, 0x9, 0xD],
        [0xB, 0xA, 0x5, 0xE, 0x6, 0xD, 0x9, 0x0, 0xC, 0x8, 0xF, 0x3, 0x2, 0x4, 0x7, 0x1],
        [0xD, 0x7, 0xF, 0x4, 0x1, 0x2, 0x6, 0xE, 0x9, 0xB, 0x3, 0x0, 0x8, 0x5, 0xC, 0xA]];
    var T_Q1 = [
        [0x2, 0x8, 0xB, 0xD, 0xF, 0x7, 0x6, 0xE, 0x3, 0x1, 0x9, 0x4, 0x0, 0xA, 0xC, 0x5],
        [0x1, 0xE, 0x2, 0xB, 0x4, 0xC, 0x3, 0x7, 0x6, 0xD, 0xA, 0x5, 0xF, 0x9, 0x0, 0x8],
        [0x4, 0xC, 0x7, 0x5, 0x1, 0x6, 0x9, 0xA, 0x0, 0xE, 0xD, 0x8, 0x2, 0xB, 0x3, 0xF],
        [0xB, 0x9, 0x5, 0x1, 0xC, 0x3, 0xD, 0xE, 0x6, 0x4, 0x7, 0xF, 0x2, 0x0, 0x8, 0xA]];

    function armarQ(t) {
        var q = new Array(256);
        for (var x = 0; x < 256; x++) {
            var a = x >> 4, b = x & 0xF, a2, b2;
            a2 = a ^ b;
            b2 = (a ^ ((b >> 1) | ((b << 3) & 0xF)) ^ ((a << 3) & 0xF)) & 0xF;
            a = t[0][a2]; b = t[1][b2];
            a2 = a ^ b;
            b2 = (a ^ ((b >> 1) | ((b << 3) & 0xF)) ^ ((a << 3) & 0xF)) & 0xF;
            a = t[2][a2]; b = t[3][b2];
            q[x] = (b << 4) | a;
        }
        return q;
    }
    var Q = [armarQ(T_Q0), armarQ(T_Q1)];

    function gfMul(a, b, poli) {
        var r = 0;
        while (b) {
            if (b & 1) { r ^= a; }
            b >>= 1;
            a <<= 1;
            if (a & 0x100) { a ^= poli; }
        }
        return r & 0xFF;
    }
    var POLI_MDS = 0x169, POLI_RS = 0x14D;
    var MDS = [[0x01, 0xEF, 0x5B, 0x5B], [0x5B, 0xEF, 0xEF, 0x01],
               [0xEF, 0x5B, 0x01, 0xEF], [0xEF, 0x01, 0xEF, 0x5B]];
    var RS = [[0x01, 0xA4, 0x55, 0x87, 0x5A, 0x58, 0xDB, 0x9E],
              [0xA4, 0x56, 0x82, 0xF3, 0x1E, 0xC6, 0x68, 0xE5],
              [0x02, 0xA1, 0xFC, 0xC1, 0x47, 0xAE, 0x3D, 0x19],
              [0xA4, 0x55, 0x87, 0x5A, 0x58, 0xDB, 0x9E, 0x03]];
    var COL = [];
    for (var i = 0; i < 4; i++) {
        var col = new Int32Array(256);
        for (var s = 0; s < 256; s++) {
            col[s] = gfMul(MDS[0][i], s, POLI_MDS) | (gfMul(MDS[1][i], s, POLI_MDS) << 8)
                | (gfMul(MDS[2][i], s, POLI_MDS) << 16) | (gfMul(MDS[3][i], s, POLI_MDS) << 24);
        }
        COL.push(col);
    }
    // Permutaciones por posición de byte dentro de h (sólo claves de 128 bits).
    var QSEQ = [[0, 0, 1], [1, 0, 0], [0, 1, 1], [1, 1, 0]];

    function sboxByte(i, b, L) {
        var s = QSEQ[i], sh = 8 * i;
        b = Q[s[0]][b] ^ ((L[1] >>> sh) & 0xFF);
        b = Q[s[1]][b] ^ ((L[0] >>> sh) & 0xFF);
        return Q[s[2]][b];
    }
    function h(x, L) {
        var z = 0;
        for (var i = 0; i < 4; i++) {
            z ^= COL[i][sboxByte(i, (x >>> (8 * i)) & 0xFF, L)];
        }
        return z;
    }
    function rol(x, n) { return (x << n) | (x >>> (32 - n)); }

    function nuevo(clave) {
        function palabra(j) {
            return clave[j] | (clave[j + 1] << 8) | (clave[j + 2] << 16) | (clave[j + 3] << 24);
        }
        var me = [palabra(0), palabra(8)], mo = [palabra(4), palabra(12)];
        var svec = [];
        for (var i = 0; i < 2; i++) {
            var w = 0;
            for (var j = 0; j < 4; j++) {
                var acc = 0;
                for (var c = 0; c < 8; c++) { acc ^= gfMul(RS[j][c], clave[8 * i + c], POLI_RS); }
                w |= acc << (8 * j);
            }
            svec.push(w);
        }
        svec.reverse();
        var K = new Int32Array(40);
        for (var r = 0; r < 20; r++) {
            var a = h(Math.imul(2 * r, 0x01010101), me);
            var b = rol(h(Math.imul(2 * r + 1, 0x01010101), mo), 8);
            K[2 * r] = (a + b) | 0;
            K[2 * r + 1] = rol((a + 2 * b) | 0, 9);
        }
        var G = [];
        for (var g = 0; g < 4; g++) {
            var tabla = new Int32Array(256);
            for (var v = 0; v < 256; v++) { tabla[v] = COL[g][sboxByte(g, v, svec)]; }
            G.push(tabla);
        }
        var g0 = G[0], g1 = G[1], g2 = G[2], g3 = G[3];

        // Cifra los 16 bytes de `ent` en `sal` (mismo arreglo permitido).
        return function (ent, sal) {
            var r0 = (ent[0] | (ent[1] << 8) | (ent[2] << 16) | (ent[3] << 24)) ^ K[0];
            var r1 = (ent[4] | (ent[5] << 8) | (ent[6] << 16) | (ent[7] << 24)) ^ K[1];
            var r2 = (ent[8] | (ent[9] << 8) | (ent[10] << 16) | (ent[11] << 24)) ^ K[2];
            var r3 = (ent[12] | (ent[13] << 8) | (ent[14] << 16) | (ent[15] << 24)) ^ K[3];
            for (var n = 0; n < 16; n++) {
                var t0 = g0[r0 & 0xFF] ^ g1[(r0 >>> 8) & 0xFF] ^ g2[(r0 >>> 16) & 0xFF] ^ g3[r0 >>> 24];
                var x1 = (r1 << 8) | (r1 >>> 24);
                var t1 = g0[x1 & 0xFF] ^ g1[(x1 >>> 8) & 0xFF] ^ g2[(x1 >>> 16) & 0xFF] ^ g3[x1 >>> 24];
                var f0 = (t0 + t1 + K[2 * n + 8]) | 0;
                var f1 = (t0 + 2 * t1 + K[2 * n + 9]) | 0;
                var y2 = r2 ^ f0;
                var n2 = (y2 >>> 1) | (y2 << 31);
                var n3 = ((r3 << 1) | (r3 >>> 31)) ^ f1;
                r2 = r0; r3 = r1; r0 = n2; r1 = n3;
            }
            var o0 = r2 ^ K[4], o1 = r3 ^ K[5], o2 = r0 ^ K[6], o3 = r1 ^ K[7];
            sal[0] = o0 & 255; sal[1] = (o0 >>> 8) & 255; sal[2] = (o0 >>> 16) & 255; sal[3] = o0 >>> 24;
            sal[4] = o1 & 255; sal[5] = (o1 >>> 8) & 255; sal[6] = (o1 >>> 16) & 255; sal[7] = o1 >>> 24;
            sal[8] = o2 & 255; sal[9] = (o2 >>> 8) & 255; sal[10] = (o2 >>> 16) & 255; sal[11] = o2 >>> 24;
            sal[12] = o3 & 255; sal[13] = (o3 >>> 8) & 255; sal[14] = (o3 >>> 16) & 255; sal[15] = o3 >>> 24;
        };
    }
    return { nuevo: nuevo };
})();

// El contador inicial de EAX: OMAC con t=0 sobre el nonce.
function _omacNonce(cifra, nonce) {
    var ceros = new Uint8Array(16), l = new Uint8Array(16), k1 = new Uint8Array(16);
    cifra(ceros, l);
    function dbl(ent, sal) {
        var acarreo = 0;
        for (var i = 15; i >= 0; i--) {
            var v = (ent[i] << 1) | acarreo;
            sal[i] = v & 0xFF;
            acarreo = v >> 8;
        }
        if (ent[0] & 0x80) { sal[15] ^= 0x87; }
    }
    dbl(l, k1);
    // Mensaje de dos bloques: 15 ceros y t=0, luego el nonce (bloque completo).
    var x = new Uint8Array(16), y = new Uint8Array(16);
    cifra(ceros, x);                    // el primer bloque es todo ceros
    for (var i = 0; i < 16; i++) { y[i] = x[i] ^ nonce[i] ^ k1[i]; }
    cifra(y, x);
    return x;
}

function descifrarPkt(bytes) {
    var n = bytes.length;
    if (n <= 16) { throw new Error("archivo demasiado corto"); }
    var e1 = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
        e1[i] = (bytes[n - 1 - i] & 0xFF) ^ ((n - (i & 255) * n) & 0xFF);
    }
    var largo = n - 16;
    var clave = new Uint8Array(16), nonce = new Uint8Array(16);
    for (var c = 0; c < 16; c++) { clave[c] = 0x89; nonce[c] = 0x10; }
    var cifra = _TF.nuevo(clave);
    var cont = _omacNonce(cifra, nonce);
    var flujo = new Uint8Array(16);
    var claro = new Uint8Array(largo);
    for (var p = 0; p < largo; p += 16) {
        cifra(cont, flujo);
        var fin = Math.min(16, largo - p);
        for (var j = 0; j < fin; j++) { claro[p + j] = e1[p + j] ^ flujo[j]; }
        for (var k = 15; k >= 0; k--) {
            cont[k] = (cont[k] + 1) & 0xFF;
            if (cont[k] !== 0) { break; }
        }
    }
    for (var q = 0; q < largo; q++) { claro[q] ^= (largo - (q & 255)) & 0xFF; }
    var tam = ((claro[0] << 24) | (claro[1] << 16) | (claro[2] << 8) | claro[3]) >>> 0;
    if ((claro[4] & 0x0F) !== 8) { throw new Error("no es un .pkt de Packet Tracer 8.2 o posterior"); }
    return _utf8(_inflar(claro, 6, tam));
}

// El camino inverso, para abrir la práctica con lo que no tiene comando (la controladora). Sin
// comprimir: Packet Tracer lo lee igual, y al guardar lo comprime él.
function cifrarPkt(texto) {
    var datos = _aUtf8(texto), n0 = datos.length;
    var bloques = Math.max(1, Math.ceil(n0 / 65535));
    var largo = 4 + 2 + n0 + 5 * bloques + 4;
    var claro = new Uint8Array(largo), o = 0;
    claro[o++] = (n0 >>> 24) & 255; claro[o++] = (n0 >>> 16) & 255; claro[o++] = (n0 >>> 8) & 255; claro[o++] = n0 & 255;
    claro[o++] = 0x78; claro[o++] = 0x01;
    var a = 1, b = 0, i, j;
    for (i = 0, j = 0; i < bloques; i++) {
        var tam = Math.min(65535, n0 - j);
        claro[o++] = i === bloques - 1 ? 1 : 0;
        claro[o++] = tam & 255; claro[o++] = tam >> 8; claro[o++] = ~tam & 255; claro[o++] = (~tam >> 8) & 255;
        for (var fin = j + tam; j < fin; j++) {
            claro[o++] = datos[j];
            a += datos[j];
            if (a >= 65521) { a -= 65521; }
            b += a;
            if (b >= 65521) { b -= 65521; }
        }
    }
    claro[o++] = b >> 8; claro[o++] = b & 255; claro[o++] = a >> 8; claro[o++] = a & 255;
    for (var q = 0; q < largo; q++) { claro[q] ^= (largo - (q & 255)) & 0xFF; }

    var clave = new Uint8Array(16), nonce = new Uint8Array(16), c;
    for (c = 0; c < 16; c++) { clave[c] = 0x89; nonce[c] = 0x10; }
    var cifra = _TF.nuevo(clave);
    var n = largo + 16, bruto = new Uint8Array(n);

    // CTR, y de una vez el OMAC del texto cifrado (t=2), con su bloque de encabezado.
    var cont = _omacNonce(cifra, nonce), nTag = cont.slice(0);
    var ceros = new Uint8Array(16), l = new Uint8Array(16), k1 = new Uint8Array(16), k2 = new Uint8Array(16);
    function dbl(ent, sal) {
        var acarreo = 0;
        for (var d = 15; d >= 0; d--) {
            var v = (ent[d] << 1) | acarreo;
            sal[d] = v & 0xFF;
            acarreo = v >> 8;
        }
        if (ent[0] & 0x80) { sal[15] ^= 0x87; }
    }
    cifra(ceros, l);
    dbl(l, k1);
    dbl(k1, k2);
    var x = new Uint8Array(16), y = new Uint8Array(16), flujo = new Uint8Array(16);
    y[15] = 2;
    cifra(y, x);
    for (var p = 0; p < largo; p += 16) {
        cifra(cont, flujo);
        var cuantos = Math.min(16, largo - p);
        for (var m = 0; m < cuantos; m++) { bruto[p + m] = claro[p + m] ^ flujo[m]; }
        for (var k = 15; k >= 0; k--) {
            cont[k] = (cont[k] + 1) & 0xFF;
            if (cont[k] !== 0) { break; }
        }
        if (p + 16 < largo) {
            for (m = 0; m < 16; m++) { y[m] = x[m] ^ bruto[p + m]; }
            cifra(y, x);
        } else {
            for (m = 0; m < 16; m++) { y[m] = x[m]; }
            for (m = 0; m < cuantos; m++) { y[m] ^= bruto[p + m]; }
            if (cuantos === 16) {
                for (m = 0; m < 16; m++) { y[m] ^= k1[m]; }
            } else {
                y[cuantos] ^= 0x80;
                for (m = 0; m < 16; m++) { y[m] ^= k2[m]; }
            }
            cifra(y, x);
        }
    }
    // OMAC del encabezado vacío (t=1): un solo bloque completo.
    var h = new Uint8Array(16), z = new Uint8Array(16);
    h[15] = 1;
    for (m = 0; m < 16; m++) { h[m] ^= k1[m]; }
    cifra(h, z);
    for (m = 0; m < 16; m++) { bruto[largo + m] = nTag[m] ^ z[m] ^ x[m]; }

    var sal = new Array(n);
    for (i = 0; i < n; i++) { sal[n - 1 - i] = bruto[i] ^ ((n - (i & 255) * n) & 0xFF); }
    return sal;
}

function _aUtf8(s) {
    var n = s.length, sal = new Uint8Array(n * 3), o = 0;
    for (var i = 0; i < n; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0xD800 && c < 0xDC00 && i + 1 < n) { c = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00); }
        if (c < 0x80) {
            sal[o++] = c;
        } else if (c < 0x800) {
            sal[o++] = 0xC0 | (c >> 6);
            sal[o++] = 0x80 | (c & 63);
        } else if (c < 0x10000) {
            sal[o++] = 0xE0 | (c >> 12);
            sal[o++] = 0x80 | ((c >> 6) & 63);
            sal[o++] = 0x80 | (c & 63);
        } else {
            sal[o++] = 0xF0 | (c >> 18);
            sal[o++] = 0x80 | ((c >> 12) & 63);
            sal[o++] = 0x80 | ((c >> 6) & 63);
            sal[o++] = 0x80 | (c & 63);
        }
    }
    return sal.subarray(0, o);
}

// DEFLATE (RFC 1951), al estilo de 'puff': lento por bit pero muy corto.
function _inflar(ent, pos, tam) {
    var sal = new Uint8Array(tam), o = 0, bitBuf = 0, bitCnt = 0;
    function bits(n) {
        while (bitCnt < n) {
            bitBuf |= ent[pos++] << bitCnt;
            bitCnt += 8;
        }
        var v = bitBuf & ((1 << n) - 1);
        bitBuf >>>= n;
        bitCnt -= n;
        return v;
    }
    function tabla(largos, ini, n) {
        var cuenta = new Uint16Array(16), simbolos = new Uint16Array(n), des = new Uint16Array(16), i;
        for (i = 0; i < n; i++) { cuenta[largos[ini + i]]++; }
        for (i = 1; i < 15; i++) { des[i + 1] = des[i] + cuenta[i]; }
        for (i = 0; i < n; i++) {
            if (largos[ini + i]) { simbolos[des[largos[ini + i]]++] = i; }
        }
        cuenta[0] = 0;
        return { cuenta: cuenta, simbolos: simbolos };
    }
    function decodificar(t) {
        var codigo = 0, primero = 0, indice = 0;
        for (var l = 1; l <= 15; l++) {
            if (bitCnt === 0) { bitBuf = ent[pos++]; bitCnt = 8; }
            codigo |= bitBuf & 1;
            bitBuf >>>= 1;
            bitCnt--;
            var c = t.cuenta[l];
            if (codigo - c < primero) { return t.simbolos[indice + (codigo - primero)]; }
            indice += c;
            primero += c;
            primero <<= 1;
            codigo <<= 1;
        }
        throw new Error("flujo comprimido dañado");
    }
    var BASE_L = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var EXTRA_L = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var BASE_D = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var EXTRA_D = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var ORDEN = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    var fijaL = null, fijaD = null;

    function cuerpo(tl, td) {
        for (;;) {
            var s = decodificar(tl);
            if (s < 256) {
                sal[o++] = s;
            } else if (s === 256) {
                return;
            } else {
                s -= 257;
                var largo = BASE_L[s] + bits(EXTRA_L[s]);
                var sd = decodificar(td);
                var dist = BASE_D[sd] + bits(EXTRA_D[sd]);
                for (var i = 0; i < largo; i++, o++) { sal[o] = sal[o - dist]; }
            }
        }
    }
    var ultimo = 0;
    while (!ultimo) {
        ultimo = bits(1);
        var tipo = bits(2);
        if (tipo === 0) {
            bitBuf = 0; bitCnt = 0;
            var len = ent[pos] | (ent[pos + 1] << 8);
            pos += 4;
            for (var c = 0; c < len; c++) { sal[o++] = ent[pos++]; }
        } else if (tipo === 1) {
            if (fijaL === null) {
                var lf = new Uint8Array(288), df = new Uint8Array(30), i;
                for (i = 0; i < 144; i++) { lf[i] = 8; }
                for (; i < 256; i++) { lf[i] = 9; }
                for (; i < 280; i++) { lf[i] = 7; }
                for (; i < 288; i++) { lf[i] = 8; }
                for (i = 0; i < 30; i++) { df[i] = 5; }
                fijaL = tabla(lf, 0, 288);
                fijaD = tabla(df, 0, 30);
            }
            cuerpo(fijaL, fijaD);
        } else if (tipo === 2) {
            var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
            var largos = new Uint8Array(320), j;
            for (j = 0; j < nc; j++) { largos[ORDEN[j]] = bits(3); }
            var tc = tabla(largos, 0, 19);
            largos = new Uint8Array(320);
            j = 0;
            while (j < nl + nd) {
                var sim = decodificar(tc);
                if (sim < 16) {
                    largos[j++] = sim;
                } else {
                    var ant = 0, rep;
                    if (sim === 16) { ant = largos[j - 1]; rep = 3 + bits(2); }
                    else if (sim === 17) { rep = 3 + bits(3); }
                    else { rep = 11 + bits(7); }
                    while (rep--) { largos[j++] = ant; }
                }
            }
            cuerpo(tabla(largos, 0, nl), tabla(largos, nl, nd));
        } else {
            throw new Error("bloque comprimido inválido");
        }
    }
    return sal;
}

function _utf8(b) {
    var partes = [], tramo = [], i = 0, n = b.length;
    while (i < n) {
        var c = b[i++];
        if (c >= 0xF0) {
            var u = ((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63);
            i += 3;
            u -= 0x10000;
            tramo.push(0xD800 + (u >> 10), 0xDC00 + (u & 1023));
        } else if (c >= 0xE0) {
            tramo.push(((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63));
            i += 2;
        } else if (c >= 0xC0) {
            tramo.push(((c & 31) << 6) | (b[i] & 63));
            i += 1;
        } else {
            tramo.push(c);
        }
        if (tramo.length >= 4096) {
            partes.push(String.fromCharCode.apply(null, tramo));
            tramo = [];
        }
    }
    partes.push(String.fromCharCode.apply(null, tramo));
    return partes.join("");
}
