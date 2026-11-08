// Los 'combos': lo que calculaste a mano en las notas contra lo que establece el
// programa. Un combo mal hecho reserva la configuración de esa red (el DHCP en
// IPv4; la dirección y sus rutas en IPv6) hasta que la nota quede idéntica.
//
// El botón de pánico se habilita con más del 50% de los combos mal. Corrige en
// las notas los errores pequeños, los que se justifican con el mismo combo
// (la red buena con la última o la máscara mal, un salto de diferencia), hasta
// llegar al 70% de combos bien. Los demás se quedan como están.

var PANICO_DESDE = 0.5, PANICO_META = 0.7;

function _evaluar4(es, c, pre) {
    var campos = { red: c.red.txt !== es.red, ultima: !!c.ultima && c.ultima.txt !== es.ultima,
                   mascara: !!c.mascara && c.mascara.txt !== es.mascara, diagonal: !!c.diagonal };
    var puntos = campos.diagonal ? 1 : 0, pequeno = true, t = tamanoRed(pre);
    if (campos.red) {
        if (esIp(c.red.txt) && Math.abs(ipAEntero(c.red.txt) - ipAEntero(es.red)) <= t) { puntos += 1; }
        else { pequeno = false; }
    }
    if (campos.ultima) {
        if (!esIp(c.ultima.txt)) {
            pequeno = false;
        } else {
            var d = Math.abs(ipAEntero(c.ultima.txt) - ipAEntero(es.ultima));
            var deSuRed = esIp(c.red.txt) && ipAEntero(c.ultima.txt) - ipAEntero(c.red.txt);
            if (d <= 2) { puntos += 1; }
            else if (campos.red && (deSuRed === t - 2 || deSuRed === t - 1)) { puntos += 0; }
            else if (d <= t) { puntos += 2; }
            else { pequeno = false; }
        }
    }
    if (campos.mascara) {
        var cerca = false;
        if (esMascara(c.mascara.txt)) {
            var interesante = function (m) {
                return m.split(".").filter(function (o) { return o !== "255" && o !== "0"; }).join(".");
            };
            cerca = Math.abs(prefijoDeMascara(c.mascara.txt) - pre) <= 2
                || (interesante(c.mascara.txt) !== "" && interesante(c.mascara.txt) === interesante(es.mascara));
        }
        puntos += cerca ? 1 : 2;
        if (campos.red && !cerca) { pequeno = false; }
    }
    return { campos: campos, puntos: puntos, pequeno: pequeno };
}

function _mensaje4(quien, es, campos, escrito, choca) {
    var diagonal = campos.diagonal
        ? "la nota dice " + escrito.diagonal.txt + ", pero tu rango y tu máscara son de /" + escrito.diagonal.real : "";
    if (!campos.red && !campos.ultima && !campos.mascara) { return quien + ": " + diagonal; }
    if (!campos.red && !campos.ultima) { return quien + ": máscara errónea, es " + es.mascara + (diagonal ? "; " + diagonal : ""); }
    return quien + ": " + (choca ? "se encima con " + choca : "saltos erróneos") + ", es " + es.red + " - " + es.ultima
        + ", con máscara " + es.mascara + (diagonal ? "; " + diagonal : "");
}

function _base64De(g) { return g.slice(0, 4).join(":"); }

// Como lo escribiste en tu nota: 'R3' aunque sus VLANs vayan en el multicapa de abajo.
function _nombreSitio(s) { return s.rotulo || s.dueno.hostnameNota || s.dueno.hostname || s.dueno.nombre; }

// Una red escrita en el lugar equivocado puede caer encima de otra o de un enlace: se
// dice con quién choca. Las que coinciden con el programa nunca chocan entre sí.
function _revisarEncimadas4(lista, plan) {
    var escritas = lista.filter(function (c) { return c.familia === "ipv4" && esIp(c.escrito.red.txt); });
    escritas.forEach(function (c) { c.redEscrita = red4(c.escrito.red.txt, c.pre); });
    var otras = [];
    plan.sitios.forEach(function (s) {
        s.vlans.forEach(function (v) {
            // Las que puso el programa no cuentan: de eso no tienes la culpa.
            if (!v.combo4 && !v.repartida) { otras.push([_nombreSitio(s) + " vlan " + v.numero, v.red]); }
        });
    });
    (plan.enlaces || []).forEach(function (r) { otras.push(["un enlace", r]); });
    escritas.forEach(function (c, i) {
        if (c.ok || !c.campos.red) { return; }
        var choca = null, j;
        for (j = 0; j < escritas.length && choca === null; j++) {
            var o = escritas[j];
            if (j !== i && (o.ok || !o.campos.red || j < i) && traslapan(c.redEscrita, o.redEscrita)) {
                choca = (o.equipo + " vlan " + o.vlan).toLowerCase() + " (" + textoRed(o.redEscrita) + ")";
            }
        }
        for (j = 0; j < otras.length && choca === null; j++) {
            if (traslapan(c.redEscrita, otras[j][1])) { choca = otras[j][0].toLowerCase() + " (" + textoRed(otras[j][1]) + ")"; }
        }
        if (choca !== null) {
            c.mensaje = _mensaje4((c.equipo + " vlan " + c.vlan).toLowerCase(), c.es, c.campos, c.escrito, choca);
        }
    });
}

function revisarCombos(plan) {
    var lista = [];
    plan.sitios.forEach(function (s) {
        var equipo = _nombreSitio(s);
        s.vlans.forEach(function (v) {
            if (v.combo4) {
                var es = { red: direccionDe(v.red), ultima: ultimaDe(v.red), mascara: mascaraDe(v.red.p) };
                var ev = _evaluar4(es, v.combo4, v.red.p);
                var ok = !ev.campos.red && !ev.campos.ultima && !ev.campos.mascara && !ev.campos.diagonal;
                var quien = (equipo + " vlan " + v.numero).toLowerCase();
                v.reservado = !ok;
                lista.push({ familia: "ipv4", equipo: equipo, canvas: s.dueno.nombre, vlan: v.numero, ok: ok, es: es, nota: v.nota,
                             escrito: v.combo4, campos: ev.campos, puntos: ev.puntos, pequeno: ev.pequeno, pre: v.red.p,
                             mensaje: ok ? "" : _mensaje4(quien, es, ev.campos, v.combo4, null) });
            }
        });
    });
    _revisarEncimadas4(lista, plan);

    // IPv6: el bloque sale de lo que escribiste (la dirección y su diagonal), así que
    // lo que se revisa es que el rango cuadre, que no se encime y que sea de la base.
    var todos6 = [];
    plan.sitios.forEach(function (s) {
        s.vlans.forEach(function (v) { if (v.combo6) { todos6.push([s, v]); } });
    });
    var bases = [];
    todos6.forEach(function (par) {
        var g = par[1].combo6.primera.g;
        if (g) { bases.push(_base64De(g)); }
    });
    var base = bases.length ? masComun(bases) : null;
    if (base !== null) {
        plan.base6 = { g: base.split(":").map(Number).concat([0, 0, 0, 0]), p: 64 };
    }
    var tomadas = [];
    todos6.forEach(function (par) {
        var s = par[0], v = par[1], c = v.combo6;
        var equipo = _nombreSitio(s);
        var quien = (equipo + " vlan " + v.numero + " ipv6").toLowerCase();
        var entrada = { familia: "ipv6", equipo: equipo, canvas: s.dueno.nombre, vlan: v.numero, ok: false, es: null, nota: v.nota,
                        escrito: c, campos: {}, puntos: 0, pequeno: true, mensaje: "" };
        lista.push(entrada);
        v.reservado6 = true;
        if (c.primera.g === null || (c.ultima && c.ultima.g === null)) {
            entrada.pequeno = false;
            entrada.mensaje = quien + ": dirección inválida, " + (c.primera.g === null ? c.primera.txt : c.ultima.txt).toLowerCase();
            return;
        }
        var pre = c.primera.pre !== null ? c.primera.pre : (c.ultima ? c.ultima.pre : null);
        if (pre === null || !(pre >= 1 && pre <= 128)) {
            entrada.pequeno = false;
            entrada.mensaje = quien + ": falta la diagonal";
            return;
        }
        // Los primeros cuatro grupos son los de la base de tus combos.
        var g = c.primera.g.slice();
        var deOtraBase = _base64De(g) !== base;
        if (deOtraBase && pre >= 64) {
            var b = base.split(":").map(Number);
            for (var k = 0; k < 4; k++) { g[k] = b[k]; }
        }
        var red = red6(g, pre), ultima = ultima6(red);
        var tam = pre >= 128 ? 1 : Math.pow(2, Math.min(128 - pre, 40));
        var campos = { base: deOtraBase, primera: !iguales6(c.primera.g, red.g), ultima: !!c.ultima && !iguales6(c.ultima.g, ultima),
                       diagonal: !!c.ultima && c.ultima.pre !== null && c.primera.pre !== null && c.ultima.pre !== c.primera.pre };
        var puntos = 0, pequeno = !deOtraBase;
        if (campos.primera && !deOtraBase) {
            if (Math.abs(distancia6(c.primera.g, red.g)) < tam) { puntos += 1; }
            else { pequeno = false; }
        }
        if (campos.ultima && !deOtraBase) {
            if (Math.abs(distancia6(c.ultima.g, ultima)) <= tam) { puntos += 1; }
            else { pequeno = false; }
        }
        if (campos.diagonal) { puntos += 1; }
        var choca = null;
        for (var t = 0; t < tomadas.length; t++) {
            if (traslapan6(tomadas[t][0], red)) { choca = tomadas[t][1]; break; }
        }
        entrada.es = { red: red, ultima: ultima, pre: pre };
        entrada.campos = campos;
        entrada.puntos = puntos;
        if (choca !== null) {
            entrada.pequeno = false;
            entrada.mensaje = quien + ": se encima con " + choca;
            return;
        }
        tomadas.push([red, quien.replace(" ipv6", "")]);
        entrada.pequeno = pequeno;
        entrada.ok = !campos.base && !campos.primera && !campos.ultima && !campos.diagonal;
        if (entrada.ok) {
            v.reservado6 = false;
            v.red6 = red;
            v.gw6 = ultima;
        } else {
            entrada.mensaje = quien + ": saltos erróneos, es " + texto6(red.g).toLowerCase() + " - " + texto6(ultima).toLowerCase() + ", con diagonal /" + pre;
        }
    });
    var total = lista.length;
    var malos = lista.filter(function (c) { return !c.ok; }).length;
    return { lista: lista, total: total, malos: malos, bien: total - malos,
             porcentaje: total ? Math.round((total - malos) * 100 / total) : 100,
             panico: total > 0 && malos / total > PANICO_DESDE };
}

// Qué corrige el pánico: los errores más chicos primero, hasta llegar a la meta.
function seleccionPanico(combos) {
    var meta = Math.ceil(combos.total * PANICO_META - 1e-9);
    var faltan = meta - combos.bien;
    var candidatos = combos.lista.filter(function (c) { return !c.ok && c.pequeno; });
    candidatos = ordenar(candidatos, function (c) { return [c.puntos, c.familia === "ipv4" ? 0 : 1]; });
    return { meta: meta, elegidos: faltan > 0 ? candidatos.slice(0, faltan) : [], candidatos: candidatos.length };
}

// El texto nuevo de cada nota, con sólo esos números cambiados: [{nota, texto}].
function notasCorregidas(elegidos) {
    var cambios = new Map();
    function agrega(nota, campo, nuevo) {
        if (!campo) { return; }
        if (!cambios.has(nota)) { cambios.set(nota, []); }
        cambios.get(nota).push({ ini: campo.ini, fin: campo.fin, texto: nuevo });
    }
    elegidos.forEach(function (c) {
        if (c.familia === "ipv4") {
            agrega(c.nota, c.escrito.red, c.es.red);
            agrega(c.nota, c.escrito.ultima, c.es.ultima);
            agrega(c.nota, c.escrito.mascara, c.es.mascara);
            if (c.escrito.diagonal) { agrega(c.nota, c.escrito.diagonal, "/" + c.escrito.diagonal.real); }
        } else {
            agrega(c.nota, c.escrito.primera, texto6(c.es.red.g) + "/" + c.es.pre);
            agrega(c.nota, c.escrito.ultima, texto6(c.es.ultima) + "/" + c.es.pre);
        }
    });
    var salida = [];
    cambios.forEach(function (lista, nota) {
        var texto = nota.original;
        ordenar(lista, function (x) { return -x.ini; }).forEach(function (x) {
            texto = texto.substring(0, x.ini) + x.texto + texto.substring(x.fin);
        });
        salida.push({ nota: nota, texto: texto });
    });
    return salida;
}
