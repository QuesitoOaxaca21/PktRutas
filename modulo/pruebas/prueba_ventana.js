// Prueba la barra del módulo (ventana.htm) en Edge o Chrome sin ventana, con ratón y
// teclado de verdad por el protocolo de DevTools. No abre nada en pantalla, no toca el
// portapapeles y usa un perfil temporal. Simula lo que Packet Tracer le hace a la página:
// su hoja de estilos y un $se que llega tarde y pierde los textos con saltos de línea.
// Lo que el módulo hace con lo que la página le pide se prueba en prueba_nucleo.js.
//
//   node modulo/pruebas/prueba_ventana.js [carpeta para las capturas]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HTM = path.join(__dirname, "..", "ventana.htm");
const CAPTURAS = process.argv[2] || "";
const NAVEGADORES = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

// Tal cual la inyecta Packet Tracer 9.0.1.
const HOJA_PT = `:root { --pt-bg-color: rgb(255,255,255); --pt-text-color: rgb(0,0,0); --pt-link-color: rgb(0,62,146); --pt-border-color: rgb(0,0,0); --pt-accent-color: rgb(0,62,146); --pt-input-bg-color: rgb(255,255,255); }
html, body { background-color: var(--pt-bg-color) !important; color: var(--pt-text-color) !important; }
a, a:link, a:visited { color: var(--pt-link-color) !important; }
table, th, td { border: 1px solid var(--pt-border-color) !important; }`;

const DATOS = { pendientes: 2, panico: true };

const SIMULACION = `
window.__llamadas = [];
window.__datos = ${JSON.stringify(DATOS)};
setTimeout(function () {
    window.$se = function (f) {
        var a = Array.prototype.slice.call(arguments);
        if (a.some(function (x) { return typeof x === "string" && /[\\r\\n]/.test(x); })) { return; }
        __llamadas.push(a);
        if (f === "uiLista" || f === "uiReleer") { setTimeout(function () { mostrar(__datos); }, 0); }
    };
}, 100);
document.addEventListener("DOMContentLoaded", function () {
    var s = document.createElement("style");
    s.textContent = ${JSON.stringify(HOJA_PT)};
    document.head.appendChild(s);
});`;

const CTRL = 2, MAYUS = 8;
let cdp = null, malas = 0, buenas = 0;

function ok(nombre, condicion, detalle) {
    if (condicion) { buenas++; console.log("[ok] " + nombre); }
    else { malas++; console.log("[MAL] " + nombre + (detalle !== undefined ? ": " + JSON.stringify(detalle) : "")); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function conectar(perfil) {
    const archivo = path.join(perfil, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(archivo); i++) { await espera(150); }
    const puerto = fs.readFileSync(archivo, "utf8").split("\n")[0].trim();
    const lista = await (await fetch("http://127.0.0.1:" + puerto + "/json/list")).json();
    const ws = new WebSocket(lista.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r, m) => { ws.onopen = r; ws.onerror = m; });
    let id = 0;
    const pendientes = new Map();
    ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.id && pendientes.has(d.id)) {
            const p = pendientes.get(d.id);
            pendientes.delete(d.id);
            if (d.error) { p.m(new Error(d.error.message)); } else { p.r(d.result); }
        }
    };
    return { enviar: (metodo, params) => new Promise((r, m) => { const n = ++id; pendientes.set(n, { r, m }); ws.send(JSON.stringify({ id: n, method: metodo, params: params || {} })); }), ws };
}

async function val(expr) {
    const r = await cdp.enviar("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.exceptionDetails) { throw new Error(expr + " -> " + r.exceptionDetails.exception.description); }
    return r.result.value;
}
const estilo = (sel, prop) => val(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]`);
const caja = (sel) => val(`(function(){var r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
const llamadas = () => val("__llamadas");
const borrar = () => val("__llamadas.length=0");
const menuAbierto = () => val("!document.getElementById('desplegado').hidden");
const filas = () => val("Array.prototype.map.call(document.querySelectorAll('#desplegado .entrada'),function(f){return f.children[0].textContent;})");

async function mover(x, y) { await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await espera(30); }
async function arrastrar(x, y) { await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await espera(30); }
async function abajo(x, y) { await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await espera(30); }
async function arriba(x, y) { await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await espera(30); }
async function clic(x, y) { await mover(x, y); await abajo(x, y); await arriba(x, y); }
async function clicEn(sel) { const c = await caja(sel); await clic(c.cx, c.cy); }
async function tecla(key, vk, modifiers) {
    const m = modifiers || 0;
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key, windowsVirtualKeyCode: vk, modifiers: m });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: vk, modifiers: m });
    await espera(40);
}
async function entrada(texto) {
    const c = await val(`(function(){var f=Array.prototype.filter.call(document.querySelectorAll('#desplegado .entrada'),function(e){return e.children[0].textContent===${JSON.stringify(texto)};})[0];var r=f.getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
    await clic(c.cx, c.cy);
    await espera(40);
}
const titulo = (n) => `.titulo[data-menu=${n}]`;
async function abrir(n) { await clicEn(titulo(n)); await espera(40); }

async function foto(nombre) {
    if (!CAPTURAS) { return; }
    const r = await cdp.enviar("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(CAPTURAS, nombre + ".png"), Buffer.from(r.data, "base64"));
}
async function tamano(w, h) { await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1.3, mobile: false }); await espera(120); }

// Hace con la vista lo que Packet Tracer con la ventana: la deja del tamaño que pidió la página.
async function seguirTamano() {
    const t = (await llamadas()).filter((l) => l[0] === "uiTamano").pop();
    if (t) { await tamano(t[1], t[2]); }
    return t;
}
const altoPedido = async () => ((await llamadas()).filter((l) => l[0] === "uiTamano").pop() || [])[2];
const cuantos = async (f) => (await llamadas()).filter((l) => l[0] === f).length;
const soloLlamo = async (f) => JSON.stringify((await llamadas()).filter((l) => l[0] !== "uiTamano")) === JSON.stringify([[f]]);

async function pruebas() {
    await cdp.enviar("Page.enable");
    await cdp.enviar("Runtime.enable");
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await tamano(280, 24);
    // Con Windows en oscuro: Packet Tracer sigue blanco, y la barra también.
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await cdp.enviar("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACION });
    await cdp.enviar("Page.navigate", { url: "file:///" + HTM.replace(/\\/g, "/") });
    await espera(600);

    console.log("--- al abrir");
    const l = await llamadas();
    ok("en cuanto $se existe pide su tamaño y los datos, una sola vez", l.length === 2 && l[0][0] === "uiTamano" && l[1][0] === "uiLista", l);
    const ancho = l[0][1], alto = l[0][2];
    ok("es una tira: 24 de alto", alto === 24, alto);
    ok("y angosta", ancho > 180 && ancho < 330, ancho);
    await seguirTamano();
    ok("la hoja de Packet Tracer no le gana: fondo blanco", await estilo("body", "backgroundColor") === "rgb(255, 255, 255)", await estilo("body", "backgroundColor"));
    ok("texto negro", await estilo("body", "color") === "rgb(0, 0, 0)", await estilo("body", "color"));
    ok("no hay hoja ni barra de estado", await val("!document.querySelector('textarea,#hoja,#pie,#mensaje')"));
    ok("el asa y los títulos, en orden", (await val("Array.prototype.map.call(document.querySelectorAll('nav > *'),function(e){return e.id==='asa'?'asa':e.textContent;}).join()")) === "asa,‹,Archivo,Editar,Ver,Activo,Aplicar,Pánico");
    const ver = await caja(titulo("Ver")), aplica = await caja("#aplicar"), pan = await caja("#panico");
    ok("Aplicar y Pánico, a la derecha y sin salirse", aplica.x >= ver.x + ver.w && Math.round(pan.x + pan.w) === ancho - 1, { ver, aplica, pan, ancho });
    ok("no hay menú Ayuda", !(await val("!!document.querySelector('[data-menu=Ayuda]')")));
    ok("con borde, para verse sobre el lienzo blanco", await estilo("#barra", "borderTopColor") === "rgb(196, 196, 196)" && await estilo("#barra", "borderTopWidth") === "1px");
    ok("nada se desborda", await val("document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight"));
    ok("Pánico habilitado va en rojo", await estilo("#panico", "backgroundColor") === "rgb(196, 43, 28)", await estilo("#panico", "backgroundColor"));
    ok("y Aplicar, con su texto negro", await estilo("#aplicar", "color") === "rgb(0, 0, 0)");
    await foto("barra");

    console.log("--- menús");
    let c = await caja(titulo("Editar"));
    await mover(c.cx, c.cy);
    ok("el título se resalta como en Packet Tracer", await estilo(titulo("Editar"), "backgroundColor") === "rgb(149, 205, 251)", await estilo(titulo("Editar"), "backgroundColor"));
    await borrar();
    await abrir("Archivo");
    ok("clic abre el menú", await menuAbierto());
    const d = await caja("#desplegado");
    ok("y la ventana crece lo justo, sin ensancharse", JSON.stringify((await llamadas()).pop()) === JSON.stringify(["uiTamano", ancho, 23 + d.h]), { l: await llamadas(), d });
    await seguirTamano();
    ok("el menú, de su color", await estilo("#desplegado", "backgroundColor") === "rgb(249, 249, 249)");
    ok("las entradas se leen: texto negro", await estilo("#desplegado .entrada", "color") === "rgb(0, 0, 0)");
    c = await caja("#desplegado .entrada");
    await mover(c.cx, c.cy);
    ok("la entrada se resalta como en Packet Tracer", await estilo("#desplegado .entrada", "backgroundColor") === "rgb(149, 205, 251)", await estilo("#desplegado .entrada", "backgroundColor"));
    await foto("menu");
    c = await caja(titulo("Ver"));
    await mover(c.cx, c.cy);
    await espera(40);
    ok("con un menú abierto, pasar a otro título lo cambia", (await filas())[0] === "Problemas en el Bloc de notas", await filas());
    await seguirTamano();
    await tecla("Escape", 27);
    ok("Esc cierra el menú", !(await menuAbierto()));
    ok("y la ventana vuelve a la tira", await altoPedido() === 24, await altoPedido());
    await seguirTamano();
    for (const n of ["Archivo", "Editar", "Ver", "Modo"]) {
        await abrir(n);
        const t = await seguirTamano();
        const m = await caja("#desplegado");
        ok("el menú " + n + " cabe sin ensanchar la ventana", t[1] === ancho && m.x >= 0 && m.x + m.w <= ancho + 0.5 && m.y + m.h <= t[2] + 0.5, { t, m });
        await foto("menu_" + n);
        await tecla("Escape", 27);
        await seguirTamano();
    }
    await abrir("Archivo");
    await seguirTamano();
    c = await caja("#barra");
    await clic(c.cx, c.y + c.h + 120);
    ok("clic afuera cierra el menú", !(await menuAbierto()));
    await seguirTamano();
    await abrir("Archivo");
    await val("window.dispatchEvent(new Event('blur'))");
    ok("irse a otra ventana lo cierra", !(await menuAbierto()) && await altoPedido() === 24);
    await seguirTamano();
    await abrir("Archivo");
    await seguirTamano();
    await abrir("Archivo");
    ok("clic en su título lo cierra", !(await menuAbierto()));
    await seguirTamano();
    await abrir("Archivo");
    await seguirTamano();
    await borrar();
    await tecla("ArrowDown", 40);
    await tecla("Enter", 13);
    await espera(40);
    ok("flechas y Entrar eligen en el menú", await cuantos("uiReleer") === 1 && !(await menuAbierto()), await llamadas());
    await seguirTamano();

    console.log("--- sin nada que aplicar");
    await val("mostrar({pendientes:0,panico:false})");
    await borrar();
    await clicEn("#panico");
    await clicEn("#aplicar");
    ok("botones deshabilitados no llaman a nadie", !(await llamadas()).length, await llamadas());
    ok("ni colapsan la barra", !(await val("document.body.classList.contains('colapsada')")));
    ok("y se ven tenues", await estilo("#panico", "color") === "rgb(138, 138, 138)" && await estilo("#panico", "backgroundColor") === "rgba(0, 0, 0, 0)", await estilo("#panico", "backgroundColor"));
    await foto("apagados");
    await val("mostrar(__datos)");

    console.log("--- lo que manda cada entrada");
    const ENTRADAS = [["Archivo", "Volver a cargar", "uiReleer"], ["Archivo", "Guardar comandos como...", "uiGuardarComandos"], ["Archivo", "Cerrar", "uiCerrar"],
                      ["Editar", "Copiar todo", "uiCopiarTodo"], ["Ver", "Problemas en el Bloc de notas", "uiVerProblemas"]];
    for (const [m, e, f] of ENTRADAS) {
        await abrir(m);
        await seguirTamano();
        await borrar();
        await entrada(e);
        ok(m + " > " + e, await soloLlamo(f) && !(await menuAbierto()), await llamadas());
        await seguirTamano();
    }

    console.log("--- borrar todo se pide dos veces");
    await abrir("Archivo");
    await seguirTamano();
    await borrar();
    await entrada("Borrar todo y aplicar");
    ok("la primera vez sólo avisa", !(await llamadas()).some((c) => c[0] !== "uiTamano") && (await val("document.getElementById('aviso').textContent")).includes("otra vez"), await llamadas());
    await seguirTamano();
    await abrir("Archivo");
    await seguirTamano();
    await borrar();
    await entrada("Borrar todo y aplicar");
    ok("la segunda, borra", await soloLlamo("uiBorrarTodo"), await llamadas());
    await seguirTamano();
    await val("(pedidoBorrar = Date.now() - DURA_AVISO - 1, 0)");
    await abrir("Archivo");
    await seguirTamano();
    await borrar();
    await entrada("Borrar todo y aplicar");
    ok("pasado el aviso, hay que pedirlo otra vez", !(await llamadas()).some((c) => c[0] !== "uiTamano"), await llamadas());
    await val("(pedidoBorrar = 0, avisar(''), 0)");
    await seguirTamano();

    console.log("--- el modo");
    const textoModo = () => val("document.getElementById('modo').textContent");
    const pintado = () => val("document.getElementById('modo').classList.contains('pasivo')");
    const sinTamano = async () => JSON.stringify((await llamadas()).filter((l) => l[0] !== "uiTamano"));
    ok("empieza en activo, sin pintarse", await textoModo() === "Activo" && !(await pintado()));
    ok("dice qué hace al pasarle encima", (await val("document.getElementById('modo').title")).indexOf("Activo: aplicar hace todo") === 0);
    const bm = await caja("#modo");
    ok("va entre Ver y Aplicar, pegado a Aplicar", bm.x > ver.x + ver.w && Math.abs(bm.x + bm.w - (await caja("#aplicar")).x) < 1, bm);
    await abrir("Modo");
    const tm = await seguirTamano();
    const mm = await caja("#desplegado");
    ok("su menú trae los cuatro y cabe sin ensanchar la barra", JSON.stringify(await filas()) === JSON.stringify(["Activo", "Pasivo estricto", "Pasivo medio", "Pasivo bajo"])
       && tm[1] === ancho && mm.x >= 0 && mm.x + mm.w <= ancho + 0.5, { f: await filas(), tm, mm });
    ok("con la palomita en el que está", await val("Array.prototype.map.call(document.querySelectorAll('#desplegado .entrada'),function(f){return f.getAttribute('aria-checked')+':'+getComputedStyle(f.children[0],'::before').content;}).join()")
       === 'true:"✓",false:"",false:"",false:""', await val("Array.prototype.map.call(document.querySelectorAll('#desplegado .entrada'),function(f){return getComputedStyle(f.children[0],'::before').content;}).join()"));
    ok("y lo que hace cada uno, en gris", await estilo("#desplegado .entrada .detalle", "color") === "rgb(138, 138, 138)");
    await foto("menu_modo");
    await borrar();
    await entrada("Pasivo estricto");
    ok("elegir uno se lo pide al módulo, y nada más", await sinTamano() === '[["uiModo","estricto"]]' && !(await menuAbierto()), await llamadas());
    ok("el botón dice el nuevo y se pinta", await textoModo() === "Estricto" && await pintado() && await estilo("#modo", "backgroundColor") === "rgb(255, 241, 194)", await estilo("#modo", "backgroundColor"));
    ok("y al pasarle encima dice que lo inalámbrico va siempre", /; lo inalámbrico, siempre$/.test(await val("document.getElementById('modo').title")), await val("document.getElementById('modo').title"));
    ok("sin cambiar el ancho de la barra", (await llamadas()).every((l) => l[0] !== "uiTamano" || l[1] === ancho), await llamadas());
    await seguirTamano();
    await foto("modo_pasivo");
    for (const [nombre, m, etiqueta] of [["Pasivo medio", "medio", "Medio"], ["Pasivo bajo", "bajo", "Bajo"], ["Activo", "activo", "Activo"]]) {
        await abrir("Modo");
        await seguirTamano();
        await borrar();
        await entrada(nombre);
        ok("Modo > " + nombre, await sinTamano() === JSON.stringify([["uiModo", m]]) && await textoModo() === etiqueta, { l: await llamadas(), t: await textoModo() });
        await seguirTamano();
    }
    ok("en activo se despinta", !(await pintado()));
    await val("mostrar({pendientes:2,panico:true,modo:'medio'})");
    ok("el módulo lo dice al mostrar", await textoModo() === "Medio" && await pintado());
    await val("modo('turbo')");
    ok("uno que no existe no cambia nada", await textoModo() === "Medio");
    await val("ocupado(true)");
    await abrir("Modo");
    await seguirTamano();
    await borrar();
    await entrada("Activo");
    ok("mientras aplica no se cambia", !(await llamadas()).some((l) => l[0] === "uiModo") && await val("document.querySelectorAll('#desplegado .entrada.apagada').length") === 4, await llamadas());
    await tecla("Escape", 27);
    await seguirTamano();
    await val("mostrar(__datos)");
    await val("modo('activo')");

    console.log("--- atajos y botones");
    const ATAJOS = [["F5", "F5", 116, 0, "uiReleer"], ["Ctrl+Mayús+C", "C", 67, CTRL | MAYUS, "uiCopiarTodo"], ["Ctrl+Mayús+S", "S", 83, CTRL | MAYUS, "uiAplicar"],
                    ["Ctrl+S", "s", 83, CTRL, "uiGuardarComandos"], ["Ctrl+R", "r", 82, CTRL, "uiVerProblemas"], ["Ctrl+Q", "q", 81, CTRL, "uiCerrar"]];
    for (const [nombre, k, vk, mod, f] of ATAJOS) {
        await borrar();
        await tecla(k, vk, mod);
        await espera(20);
        ok(nombre, await soloLlamo(f), await llamadas());
        if (f === "uiAplicar") {
            ok("y colapsa la barra, como el botón", await val("document.body.classList.contains('colapsada')"));
            await val("expandir()");
        }
    }
    await borrar();
    await clicEn("#aplicar");
    ok("el botón Aplicar", await soloLlamo("uiAplicar"), await llamadas());
    const alAplicar = await llamadas();
    ok("colapsa la barra antes de que empiece a teclear", await val("document.body.classList.contains('colapsada')")
       && alAplicar.length === 2 && alAplicar[0][0] === "uiTamano" && alAplicar[0][1] <= 20 && alAplicar[0][2] === 24 && alAplicar[1][0] === "uiAplicar", alAplicar);
    await seguirTamano();
    ok("sólo queda el asa", await val("Array.prototype.filter.call(document.querySelectorAll('nav > *'),function(e){return e.offsetWidth>0;}).map(function(e){return e.id;}).join()") === "asa");
    await foto("aplicando");
    await val("expandir()");
    await seguirTamano();
    await borrar();
    await clicEn("#panico");
    ok("el botón Pánico", await soloLlamo("uiPanico"), await llamadas());
    const mandan = await val("Object.keys(MENUS).reduce(function(s,m){return s+MENUS[m].filter(Boolean).length;},0)");
    ok("todas las entradas tienen prueba", mandan === ENTRADAS.length + 1 + 4, mandan);
    await borrar();
    await tecla("Enter", 13, CTRL);
    await tecla("m", 77, CTRL);
    await espera(20);
    ok("los atajos de lo que se quitó ya no hacen nada", !(await llamadas()).length, await llamadas());

    console.log("--- mientras aplica");
    await val("ocupado(true)");
    ok("los botones se apagan", await val("document.getElementById('aplicar').disabled&&document.getElementById('panico').disabled"));
    await borrar();
    await tecla("F5", 116);
    await tecla("C", 67, CTRL | MAYUS);
    await tecla("S", 83, CTRL | MAYUS);
    ok("F5 y lo demás no interrumpen", !(await llamadas()).length, await llamadas());
    ok("ni Aplicar otra vez colapsa la barra", !(await val("document.body.classList.contains('colapsada')")));
    await abrir("Archivo");
    await seguirTamano();
    ok("Volver a cargar, apagado", await val("document.querySelector('#desplegado .entrada').classList.contains('apagada')"));
    await tecla("Escape", 27);
    await seguirTamano();
    await val("mostrar(__datos)");
    ok("al terminar, todo vuelve", !(await val("document.getElementById('aplicar').disabled||document.getElementById('panico').disabled")));

    console.log("--- si no se pudo leer");
    await val("fallo(true)");
    ok("los botones se apagan", await val("document.getElementById('aplicar').disabled&&document.getElementById('panico').disabled"));
    await borrar();
    await tecla("C", 67, CTRL | MAYUS);
    ok("copiar no intenta", !(await llamadas()).length, await llamadas());
    await abrir("Editar");
    await seguirTamano();
    await borrar();
    await entrada("Copiar todo");
    ok("una entrada apagada no hace nada", await menuAbierto() && !(await llamadas()).length, await llamadas());
    ok("y se ve apagada", await estilo("#desplegado .entrada.apagada", "color") === "rgb(138, 138, 138)");
    await tecla("Escape", 27);
    await seguirTamano();
    await borrar();
    await tecla("F5", 116);
    await espera(40);
    ok("pero F5 sí vuelve a intentar", await cuantos("uiReleer") === 1, await llamadas());
    ok("y si ya se pudo, vuelve todo", !(await val("document.getElementById('aplicar').disabled")));

    console.log("--- avisos");
    await seguirTamano();
    await val("DURA_AVISO=300");
    await borrar();
    await val("avisar('Copiado R1 (1 de 2)')");
    ok("sale bajo la barra", await val("!document.getElementById('aviso').hidden") && await val("document.getElementById('aviso').textContent") === "Copiado R1 (1 de 2)");
    let av = await caja("#aviso");
    ok("y la barra crece lo justo", await altoPedido() === 23 + av.h && av.y === 23, { av, alto: await altoPedido() });
    await seguirTamano();
    await foto("aviso");
    await espera(450);
    ok("se va solo", await val("document.getElementById('aviso').hidden") && await altoPedido() === 24, await altoPedido());
    await seguirTamano();
    await val("avisar('Aplicando...')");
    await seguirTamano();
    await espera(450);
    ok("lo que sigue en curso se queda", await val("!document.getElementById('aviso').hidden"));
    await val("avisar('Aplicado a 2 equipos')");
    await espera(450);
    ok("hasta que termina", await val("document.getElementById('aviso').hidden"));
    await seguirTamano();
    await val("avisar('Uno')");
    await espera(200);
    await val("avisar('Dos')");
    await espera(200);
    ok("uno nuevo reinicia el tiempo", await val("document.getElementById('aviso').textContent") === "Dos");
    await espera(250);
    await seguirTamano();
    await val("avisar('" + "Un aviso muy largo que no cabe ".repeat(4) + "')");
    await seguirTamano();
    ok("uno largo se corta y no ensancha nada", await val("(function(){var a=document.getElementById('aviso');return a.scrollWidth>a.clientWidth&&a.getBoundingClientRect().width<=innerWidth;})()"));
    await abrir("Archivo");
    const conMenu = await seguirTamano();
    const md = await caja("#desplegado");
    ok("un menú abierto esconde el aviso, y cabe", conMenu[2] === 23 + md.h && await estilo("#aviso", "visibility") === "hidden", await estilo("#aviso", "visibility"));
    await tecla("Escape", 27);
    await seguirTamano();
    ok("y al cerrarlo vuelve", await estilo("#aviso", "visibility") === "visible");
    await val("DURA_AVISO=6000;avisar('')");
    await seguirTamano();

    console.log("--- moverla");
    const asa = await caja("#asa");
    ok("el asa se ve y se puede agarrar", asa.w >= 6 && asa.h >= 12 && await estilo("#asa", "cursor") === "move", asa);
    await borrar();
    await mover(asa.cx, asa.cy);
    await abajo(asa.cx, asa.cy);
    await arrastrar(asa.cx + 30, asa.cy + 12);
    await arrastrar(asa.cx + 25, asa.cy + 40);
    await arriba(asa.cx + 25, asa.cy + 40);
    const mv = (await llamadas()).filter((x) => x[0] === "uiMover");
    ok("arrastrarla manda cuánto se movió", mv.length === 2 && mv.reduce((s, x) => s + x[1], 0) === 25 && mv.reduce((s, x) => s + x[2], 0) === 40, mv);
    await borrar();
    await mover(asa.cx + 80, asa.cy + 80);
    ok("al soltarla ya no la sigue", !(await llamadas()).length, await llamadas());
    await mover(asa.cx, asa.cy);
    await abajo(asa.cx, asa.cy);
    await borrar();
    await mover(asa.cx + 20, asa.cy + 2);
    ok("si se soltó donde la página no lo vio, tampoco", !(await llamadas()).length && await val("agarre===null"), await llamadas());
    await arriba(asa.cx + 20, asa.cy + 2);
    await mover(10, 200);
    await abrir("Archivo");
    await seguirTamano();
    await clicEn("#asa");
    ok("agarrarla cierra el menú abierto", !(await menuAbierto()));
    await seguirTamano();

    console.log("--- colapsarla");
    const colapsada = () => val("document.body.classList.contains('colapsada')");
    const flecha = await caja("#colapsar");
    ok("el botón es chico y va entre el asa y Archivo", flecha.w <= 16 && flecha.x >= asa.x + asa.w - 0.5 && flecha.x + flecha.w <= (await caja(titulo("Archivo"))).x + 0.5, flecha);
    await mover(flecha.cx, flecha.cy);
    ok("se resalta como lo demás", await estilo("#colapsar", "backgroundColor") === "rgb(149, 205, 251)");
    await foto("con_boton");
    await val("avisar('Aplicando...')");
    await seguirTamano();
    await abrir("Archivo");
    await seguirTamano();
    await borrar();
    await clicEn("#colapsar");
    ok("cierra el menú abierto", !(await menuAbierto()));
    const chica = await seguirTamano();
    ok("sólo queda el asa", await val("Array.prototype.filter.call(document.querySelectorAll('nav > *'),function(e){return e.offsetWidth>0;}).map(function(e){return e.id;}).join()") === "asa");
    ok("del tamaño del asa, con el mismo alto", chica[1] <= 20 && chica[2] === 24, chica);
    ok("no se desborda", await val("document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight"));
    ok("el asa no se movió de lugar", (await caja("#barra")).x === 0 && (await caja("#asa")).x < 2, await caja("#asa"));
    ok("el aviso no se ve", await estilo("#aviso", "display") === "none");
    await foto("colapsada");
    const asaC = await caja("#asa");
    ok("toda la tira agarra", asaC.w >= 12 && asaC.h >= 20, asaC);
    await borrar();
    await tecla("r", 82, CTRL);
    ok("los atajos siguen funcionando", await soloLlamo("uiVerProblemas"), await llamadas());
    await borrar();
    await mover(asaC.cx, asaC.cy);
    await abajo(asaC.cx, asaC.cy);
    await arrastrar(asaC.cx + 30, asaC.cy + 10);
    await arriba(asaC.cx + 30, asaC.cy + 10);
    let mvC = (await llamadas()).filter((x) => x[0] === "uiMover");
    ok("arrastrarla la mueve y no la abre", mvC.length === 1 && mvC[0][1] === 30 && mvC[0][2] === 10 && await colapsada(), mvC);
    await borrar();
    await mover(asaC.cx, asaC.cy);
    await abajo(asaC.cx, asaC.cy);
    await arrastrar(asaC.cx + 2, asaC.cy + 1);
    await arriba(asaC.cx + 2, asaC.cy + 1);
    mvC = (await llamadas()).filter((x) => x[0] === "uiMover");
    ok("un clic, aunque tiemble el pulso, la abre sin moverla", !mvC.length && !(await colapsada()), { mvC, l: await llamadas() });
    const grande = await seguirTamano();
    ok("vuelve a su tamaño, con el aviso que seguía", grande[1] === ancho && grande[2] === 23 + (await caja("#aviso")).h && await estilo("#aviso", "display") === "block", grande);
    await val("avisar('')");
    await seguirTamano();
    await clicEn("#asa");
    ok("abierta, un clic en el asa no la colapsa", !(await colapsada()));
    await clicEn("#colapsar");
    await seguirTamano();
    await borrar();
    await val("expandir(true)");
    ok("el módulo la puede abrir", !(await colapsada()) && JSON.stringify((await llamadas()).pop()) === JSON.stringify(["uiTamano", ancho, 24]), await llamadas());

    // Aplicar la colapsa y tarda: cómo terminó tiene que esperar a que la abran.
    await seguirTamano();
    await val("DURA_AVISO=500");
    await clicEn("#aplicar");
    await seguirTamano();
    await val("avisar('DHCP: 3 de 6 PCs con IP...')");
    await val("avisar('6 de 6 PCs con IP')");
    await espera(700);
    ok("colapsada, el aviso de cómo terminó no se va", await colapsada() && await val("document.getElementById('aviso').textContent") === "6 de 6 PCs con IP");
    await clicEn("#asa");
    const conAviso = await seguirTamano();
    ok("se ve al abrirla", !(await colapsada()) && await estilo("#aviso", "display") === "block" && conAviso[2] === 23 + (await caja("#aviso")).h, conAviso);
    await espera(150);
    ok("y se queda su rato completo", await val("!document.getElementById('aviso').hidden"));
    await espera(400);
    ok("luego se va solo", await val("document.getElementById('aviso').hidden") && await altoPedido() === 24, await altoPedido());
    await val("DURA_AVISO=6000");
}

async function main() {
    const exe = NAVEGADORES.find((n) => fs.existsSync(n));
    if (!exe) { throw new Error("no encontré Edge ni Chrome"); }
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "pktrutas_ventana_"));
    const nav = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                            "--disable-sync", "--disable-background-networking", "--remote-debugging-port=0", "--user-data-dir=" + perfil, "about:blank"],
                      { stdio: "ignore" });
    try {
        cdp = await conectar(perfil);
        await pruebas();
    } finally {
        const salio = new Promise((r) => nav.once("exit", r));
        try { await Promise.race([cdp && cdp.enviar("Browser.close"), espera(1500)]); } catch (e) { }
        await Promise.race([salio, espera(3000)]);
        nav.kill();
        try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { }
    }
    console.log(malas ? malas + " MAL, " + buenas + " bien" : buenas + " pruebas bien");
    process.exit(malas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
