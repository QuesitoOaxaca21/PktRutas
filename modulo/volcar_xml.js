// Descifra con el núcleo cada .pkt de una lista y deja su XML: así la comparación
// con la versión en Python no gasta minutos de CPU en su Twofish puro.
// Uso: node volcar_xml.js lista.txt carpeta
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { cargar } = require("./cargar_node");
const m = cargar();
const lista = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean);
const indice = {};
let bien = 0, mal = 0;
lista.forEach((ruta, i) => {
    try {
        m.__b = fs.readFileSync(ruta);
        const xml = vm.runInContext("descifrarPkt(__b)", m);
        const nombre = i + ".xml";
        fs.writeFileSync(path.join(process.argv[3], nombre), xml, "utf8");
        indice[ruta] = nombre;
        bien++;
    } catch (e) {
        console.log("no se pudo:", ruta.split(/[\/]/).pop(), String(e.message || e).substring(0, 70));
        mal++;
    }
});
fs.writeFileSync(path.join(process.argv[3], "indice.json"), JSON.stringify(indice, null, 0));
console.log("descifrados %d, sin descifrar %d", bien, mal);
