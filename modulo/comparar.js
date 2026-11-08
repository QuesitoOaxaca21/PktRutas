// Compara el núcleo en JavaScript contra la salida de la versión en Python
// (JSON de comparar_py.py) para cada práctica real. Uso: node comparar.js salida.json
const fs = require("fs");
const vm = require("vm");
const { cargar } = require("./cargar_node");
const py = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const m = cargar();
let iguales = 0, distintos = 0, malos = 0;
const detalle = process.argv.includes("--detalle");
for (const ruta of Object.keys(py)) {
    const p = py[ruta];
    const nombre = ruta.split(/[\/]/).pop();
    if (p.error) { console.log("PY-ERROR", nombre, p.error.substring(0, 80)); malos++; continue; }
    let ctx;
    try {
        m.__bytes = fs.readFileSync(ruta);
        ctx = vm.runInContext("analizarXml(descifrarPkt(__bytes))", m);
    } catch (e) {
        console.log("JS-ERROR", nombre, String(e.stack || e).substring(0, 400));
        malos++;
        continue;
    }
    m.__b1 = ctx.bloques; m.__b2 = ctx.completos;
    const pend = vm.runInContext("textoBloques(__b1)", m);
    const comp = vm.runInContext("textoBloques(__b2)", m);
    const normal = (t) => t.replace(/\s+$/, "");
    const a = normal(pend) === normal(p.pend), b = normal(comp) === normal(p.comp);
    const reh = JSON.stringify(Object.keys(ctx.motivos).sort()) === JSON.stringify(p.rehechos);
    if (a && b && reh) { iguales++; console.log("igual   ", nombre); continue; }
    distintos++;
    console.log("DISTINTO", nombre, "pend:", a, "comp:", b, "rehechos:", reh, JSON.stringify(p.rehechos), JSON.stringify(Object.keys(ctx.motivos)));
    if (detalle) {
        const dif = (x, y) => {
            const lx = normal(x).split("\n"), ly = normal(y).split("\n");
            const sy = new Set(ly), sx = new Set(lx);
            return { soloPy: lx.filter((l) => !sy.has(l)).slice(0, 12), soloJs: ly.filter((l) => !sx.has(l)).slice(0, 12) };
        };
        if (!a) { console.log("   pend", JSON.stringify(dif(p.pend, pend))); }
        if (!b) { console.log("   comp", JSON.stringify(dif(p.comp, comp))); }
    }
}
console.log("iguales %d, distintos %d, con error %d", iguales, distintos, malos);
