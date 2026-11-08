// Carga los scripts del módulo en Node, en el mismo orden y con el mismo alcance
// global que en Packet Tracer.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ARCHIVOS = ["bytes.js", "ipv.js", "modelo.js", "plan.js", "enlaces.js", "rutas.js", "combos.js", "inalambrico.js", "comandos.js"];

function cargar() {
    const ctx = vm.createContext({ console });
    for (const a of ARCHIVOS) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, a), "utf8"), ctx, { filename: a });
    }
    return ctx;
}

module.exports = { cargar, ARCHIVOS };
