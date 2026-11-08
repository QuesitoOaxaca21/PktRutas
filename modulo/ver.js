// Uso: node ver.js practica.pkt [--completo]
// Muestra lo que el módulo ve y lo que aplicaría, sin Packet Tracer.
const fs = require("fs");
const { cargar } = require("./cargar_node");

const ruta = process.argv[2];
const completo = process.argv.includes("--completo");
const m = cargar();
m.__bytes = fs.readFileSync(ruta);
const t0 = Date.now();
const xml = require("vm").runInContext("descifrarPkt(__bytes)", m);
const t1 = Date.now();
m.__xml = xml;
const ctx = require("vm").runInContext("analizarXml(__xml)", m);
const t2 = Date.now();
console.log("descifrar %d ms, analizar %d ms", t1 - t0, t2 - t1);
console.log("--- combos: %d de %d bien (%d%%), pánico: %s", ctx.combos.bien, ctx.combos.total, ctx.combos.porcentaje, ctx.combos.panico);
m.__ctx = ctx;
console.log(require("vm").runInContext("textoProblemas(__ctx)", m));
console.log("--- supuestos:", JSON.stringify(ctx.plan.supuestos.concat(ctx.correcciones.supuestos)));
console.log("--- pcs:", JSON.stringify(ctx.pcs));
const bloques = completo ? ctx.completos : ctx.bloques;
console.log("--- comandos (%s)", completo ? "completos" : "pendientes");
console.log(bloques.map((b) => "[" + b.equipo + " / " + b.nombre + "]\n" + b.texto).join("\n===\n"));
