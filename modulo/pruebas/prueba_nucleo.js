// Pruebas del núcleo con prácticas sintéticas: node pruebas/prueba_nucleo.js
const assert = require("assert");
const vm = require("vm");
const { cargar } = require("../cargar_node");

const m = cargar();
function analizar(xml, opciones) {
    m.__xml = xml;
    m.__ops = opciones;
    return vm.runInContext("analizarXml(__xml, __ops)", m);
}
function llama(f, ...args) {
    m.__args = args;
    return vm.runInContext(f + ".apply(null, __args)", m);
}

// --- una práctica mínima en XML, como la deja Packet Tracer -------------------------

function equipo(ref, nombre, tipo, modelo, x, y, cfg = [], extra = "") {
    const lineas = cfg.map((l) => `<LINE>${l}</LINE>`).join("");
    return `<DEVICE><ENGINE><TYPE model="${modelo}">${tipo}</TYPE><NAME translate="true">${nombre}</NAME>
<RUNNINGCONFIG>${lineas}</RUNNINGCONFIG>${extra}<SAVE_REF_ID>${ref}</SAVE_REF_ID></ENGINE>
<WORKSPACE><LOGICAL><X>${x}</X><Y>${y}</Y></LOGICAL></WORKSPACE></DEVICE>`;
}

function cable(a, pa, b, pb) {
    return `<LINK><CABLE><FROM>${a}</FROM><PORT>${pa}</PORT><TO>${b}</TO><PORT>${pb}</PORT></CABLE></LINK>`;
}

function nota(uuid, x, y, texto) {
    return `<NOTE uuid="${uuid}"><X>${x}</X><Y>${y}</Y><Z>40001</Z><TEXT translate="true">${texto}</TEXT></NOTE>`;
}

const ROUTER = ["hostname Router", "interface FastEthernet0/0", " no ip address", " shutdown",
                "interface FastEthernet0/1", " no ip address", " shutdown"];
const SWITCH = ["hostname Switch", "interface FastEthernet0/1", "interface FastEthernet0/2",
                "interface FastEthernet0/3", "interface FastEthernet0/4"];

function practica(notaR1, notaR2, opciones = {}) {
    const devs = [
        equipo("r1", "Router0", "Router", "2811", 1000, 500, opciones.cfgR1 || ROUTER),
        equipo("r2", "Router1", "Router", "2811", 1500, 500, opciones.cfgR2 || ROUTER),
        equipo("s1", "Switch0", "Switch", "2960-24TT", 1000, 750, opciones.cfgS1 || SWITCH),
        equipo("s2", "Switch1", "Switch", "2960-24TT", 1500, 750, opciones.cfgS2 || SWITCH),
        equipo("p0", "PC0", "Pc", "PC-PT", 900, 850), equipo("p1", "PC1", "Pc", "PC-PT", 1000, 950),
        equipo("p2", "PC2", "Pc", "PC-PT", 1100, 850),
        equipo("p3", "PC3", "Pc", "PC-PT", 1400, 850), equipo("p4", "PC4", "Pc", "PC-PT", 1500, 950),
        equipo("p5", "PC5", "Pc", "PC-PT", 1600, 850),
    ].join("");
    const cables = [
        cable("r1", "FastEthernet0/0", "r2", "FastEthernet0/0"),
        cable("r1", "FastEthernet0/1", "s1", "FastEthernet0/1"),
        cable("r2", "FastEthernet0/1", "s2", "FastEthernet0/1"),
        cable("s1", "FastEthernet0/2", "p1", "FastEthernet0"), cable("s1", "FastEthernet0/3", "p0", "FastEthernet0"),
        cable("s1", "FastEthernet0/4", "p2", "FastEthernet0"),
        cable("s2", "FastEthernet0/2", "p3", "FastEthernet0"), cable("s2", "FastEthernet0/3", "p4", "FastEthernet0"),
        cable("s2", "FastEthernet0/4", "p5", "FastEthernet0"),
    ].join("");
    const notas = [nota("{a}", 1250, 480, ".4"), nota("{b}", 620, 490, notaR1),
                   nota(opciones.uuidR2 || "{c}", 1600, 500, notaR2)].join("");
    return `<PACKETTRACER5><NETWORK><DEVICES>${devs}</DEVICES><LINKS>${cables}</LINKS></NETWORK>
<PHYSICALWORKSPACE><NOTES>${notas}</NOTES></PHYSICALWORKSPACE></PACKETTRACER5>`;
}

function notaDe(nombre, v2, v6a, v3, v6b) {
    return `${nombre}\n\nVLAN 2/22\n\n\t\t${v2}\n\t${v6a}\t\n\nVLAN 3/28\n\t\n\t\t${v3}\n\t${v6b}\t`;
}

const R1_BIEN = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.252.0",
                       "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126",
                       "11.0.0.16\t-\t11.0.0.30\t-\t255.255.255.240",
                       "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");
const R2_BIEN = notaDe("R2", "11.0.8.0\t-\t11.0.11.254\t-\t255.255.252.0",
                       "ABCD:AB:AC:AD::8B0/126\t-\tABCD:AB:AC:AD::8B3/126",
                       "11.0.0.32\t-\t11.0.0.46\t-\t255.255.255.240",
                       "ABCD:AB:AC:AD::32B0/125\t-\tABCD:AB:AC:AD::32B7/125");

let pruebas = 0;
function prueba(nombre, f) {
    f();
    pruebas++;
    console.log("[ok] " + nombre);
}

prueba("los scripts que van a Packet Tracer no traen errores de sintaxis", () => {
    const fs = require("fs"), path = require("path");
    const raiz = path.join(__dirname, "..");
    new vm.Script(fs.readFileSync(path.join(raiz, "principal.js"), "utf8"), { filename: "principal.js" });
    const html = fs.readFileSync(path.join(raiz, "ventana.htm"), "utf8");
    new vm.Script(/<script>([\s\S]*)<\/script>/.exec(html)[1], { filename: "ventana.htm" });
});

// --- bytes e IPv6 -------------------------------------------------------------------------

prueba("IPv6: lectura, formato y bloques", () => {
    const g = llama("parse6", "ABCD:AB:AC:AD::4A1");
    assert.deepStrictEqual(Array.from(g), [0xABCD, 0xAB, 0xAC, 0xAD, 0, 0, 0, 0x4A1]);
    assert.strictEqual(llama("texto6", g), "ABCD:AB:AC:AD::4A1");
    assert.strictEqual(llama("parse6", "ABCD:AB:AC:4A0"), null);       // sin '::' ni 8 grupos
    const r = llama("red6", g, 126);
    assert.strictEqual(llama("texto6", r.g), "ABCD:AB:AC:AD::4A0");
    assert.strictEqual(llama("texto6", llama("ultima6", r)), "ABCD:AB:AC:AD::4A3");
    assert.strictEqual(llama("texto6", llama("parse6", "ABCD:AB:AC:AD::")), "ABCD:AB:AC:AD::");
});

// --- las notas bien escritas ------------------------------------------------------------------

prueba("todo bien: sin problemas y sale la configuración completa", () => {
    const c = analizar(practica(R1_BIEN, R2_BIEN));
    assert.strictEqual(c.combos.total, 8);
    assert.strictEqual(c.combos.malos, 0);
    assert.strictEqual(c.combos.panico, false);
    const r1 = c.bloques.find((b) => b.equipo === "Router0");
    const r2 = c.bloques.find((b) => b.equipo === "Router1");
    assert.ok(r1.lineas.includes("hostname R1"), "el nombre sale de la nota");
    assert.ok(r2.lineas.includes("hostname R2"));
    for (const l of ["ipv6 unicast-routing", " ip address 11.0.0.5 255.255.255.252", " ipv6 address ABCD:AB:AC:AD::/127",
                     " encapsulation dot1Q 2", " ip address 11.0.7.254 255.255.252.0", " ipv6 address ABCD:AB:AC:AD::4A3/126",
                     "ip dhcp pool VLAN2", " network 11.0.4.0 255.255.252.0", " default-router 11.0.7.254",
                     "ip dhcp pool VLAN3", " network 11.0.0.16 255.255.255.240", " default-router 11.0.0.30",
                     "ip route 11.0.8.0 255.255.252.0 11.0.0.6", "ip route 11.0.0.32 255.255.255.240 11.0.0.6",
                     "ipv6 route ABCD:AB:AC:AD::8B0/126 ABCD:AB:AC:AD::1", "ipv6 route ABCD:AB:AC:AD::32B0/125 ABCD:AB:AC:AD::1"]) {
        assert.ok(r1.lineas.includes(l), "falta en R1: " + l);
    }
    assert.ok(r2.lineas.includes(" ipv6 address ABCD:AB:AC:AD::1/127"));
    assert.ok(r2.lineas.includes("ipv6 route ABCD:AB:AC:AD::4A0/126 ABCD:AB:AC:AD::"));
});

prueba("las PCs sin VLAN se reparten por puerto y las VLANs llevan su nombre", () => {
    const c = analizar(practica(R1_BIEN, R2_BIEN));
    const s = c.bloques.find((b) => b.equipo === "Switch0").lineas;
    assert.ok(s.includes(" name DOS") && s.includes(" name TRES"));
    assert.ok(s.includes("interface range FastEthernet0/2 - 3"), s.join("|"));
    assert.ok(s.includes(" switchport access vlan 2"));
    assert.ok(s.includes("interface FastEthernet0/4"));
    assert.ok(s.includes(" switchport access vlan 3"));
    assert.ok(s.includes(" switchport mode trunk"));
});

// Un router con dos switches en cadena; `pcs` = [[equipo, puerto, nombre], ...].
function redConPcs(textoNota, pcs) {
    const devs = [equipo("r", "Router0", "Router", "2811", 100, 100, ROUTER),
                  equipo("s0", "Switch0", "Switch", "2960-24TT", 100, 300, SWITCH),
                  equipo("s1", "Switch1", "Switch", "2960-24TT", 300, 300, SWITCH)];
    const cables = [cable("r", "FastEthernet0/1", "s0", "FastEthernet0/1"),
                    cable("s0", "FastEthernet0/24", "s1", "FastEthernet0/24")];
    pcs.forEach((p, i) => {
        devs.push(equipo("p" + i, p[2], "Pc", "PC-PT", 100 + 50 * i, 500));
        cables.push(cable(p[0], p[1], "p" + i, "FastEthernet0"));
    });
    return `<X><DEVICES>${devs.join("")}</DEVICES>${cables.join("")}<NOTES>${nota("{n}", 50, 50, textoNota)}</NOTES></X>`;
}

function vlanDe(c, pc) {
    return c.pcs.find((p) => p.pc === pc).vlan;
}

const DOS_VLANS = "R1 10.0.0.0\nVLAN 2/24\nVLAN 3/24";
const TRES_VLANS = "R1 10.0.0.0\nVLAN 2/24\nVLAN 3/24\nVLAN 4/24";

prueba("cada VLAN de la nota se queda con al menos una PC, aunque estén en switches distintos", () => {
    const c = analizar(redConPcs(DOS_VLANS, [["s0", "FastEthernet0/2", "PC0"], ["s1", "FastEthernet0/2", "PC1"]]));
    assert.strictEqual(vlanDe(c, "PC0"), 2);
    assert.strictEqual(vlanDe(c, "PC1"), 3);
    assert.strictEqual(llama("textoProblemas", c), "");
    const d = analizar(redConPcs(TRES_VLANS, [["s0", "FastEthernet0/2", "PC0"], ["s0", "FastEthernet0/3", "PC1"],
                                              ["s1", "FastEthernet0/2", "PC2"], ["s1", "FastEthernet0/3", "PC3"]]));
    assert.deepStrictEqual(["PC0", "PC1", "PC2", "PC3"].map((n) => vlanDe(d, n)), [2, 3, 2, 4]);
});

prueba("una PC con su VLAN en el nombre cuenta para esa VLAN", () => {
    const c = analizar(redConPcs(DOS_VLANS, [["s0", "FastEthernet0/2", "PC0 V2"], ["s0", "FastEthernet0/3", "PC1"]]));
    assert.strictEqual(vlanDe(c, "PC0 V2"), 2);
    assert.strictEqual(vlanDe(c, "PC1"), 3);
});

prueba("si no alcanzan las PCs para todas las VLANs, lo avisa", () => {
    const c = analizar(redConPcs(TRES_VLANS, [["s0", "FastEthernet0/2", "PC0"], ["s0", "FastEthernet0/3", "PC1"]]));
    assert.deepStrictEqual(["PC0", "PC1"].map((n) => vlanDe(c, n)), [2, 3]);
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("vlan 4: no alcanzan las pcs, se queda sin ninguna"), t);
});

prueba("la hoja usa el estilo de las prácticas", () => {
    const c = analizar(practica(R1_BIEN, R2_BIEN));
    const t = llama("textoBloques", c.bloques);
    assert.ok(t.startsWith("EN\nCONF T\nHOSTNAME R1\nIPV6 UNICAST-ROUTING\n\nINT FA0/0\nIP ADD 11.0.0.5 255.255.255.252\nIPV6 ADDRESS ABCD:AB:AC:AD::/127\nNO SHUT\n"), t.substring(0, 120));
    assert.ok(t.includes("\n===\n"));
});

// --- combos mal hechos ------------------------------------------------------------------------

const R1_V3_MAL = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.252.0",
                         "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126",
                         "11.0.0.16\t-\t11.0.0.31\t-\t255.255.240.0",
                         "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");

prueba("un combo mal: se reserva su DHCP y lo demás sí se aplica", () => {
    const c = analizar(practica(R1_V3_MAL, R2_BIEN));
    assert.strictEqual(c.combos.malos, 1);
    const r1 = c.bloques.find((b) => b.equipo === "Router0").lineas;
    assert.ok(!r1.includes("ip dhcp pool VLAN3"), "el pool de esa red se reserva");
    assert.ok(r1.includes("ip dhcp pool VLAN2"));
    assert.ok(r1.includes(" ip address 11.0.0.30 255.255.255.240"), "la subinterfaz sí, con los valores buenos");
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("r1 vlan 3: saltos erróneos, es 11.0.0.16 - 11.0.0.30, con máscara 255.255.255.240"), t);
    assert.ok(t.includes("sin dhcp hasta que la nota quede igual: r1 vlan 3"), t);
    assert.strictEqual(t, t.toLowerCase(), "en minúsculas");
});

prueba("sólo la máscara mal lo dice así", () => {
    const n = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.248.0",
                     "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126",
                     "11.0.0.16\t-\t11.0.0.30\t-\t255.255.255.240",
                     "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");
    const t = llama("textoProblemas", analizar(practica(n, R2_BIEN)));
    assert.ok(t.includes("r1 vlan 2: máscara errónea, es 255.255.252.0"), t);
});

const R2_V3 = (rango) => notaDe("R2", "11.0.8.0\t-\t11.0.11.254\t-\t255.255.252.0",
                                "ABCD:AB:AC:AD::8B0/126\t-\tABCD:AB:AC:AD::8B3/126",
                                rango + "\t-\t255.255.255.240",
                                "ABCD:AB:AC:AD::32B0/125\t-\tABCD:AB:AC:AD::32B7/125");

prueba("una red desplazada que cuadra con su diagonal se queda donde la escribiste", () => {
    const c = analizar(practica(R1_BIEN, R2_V3("11.0.0.48\t-\t11.0.0.62")));
    assert.strictEqual(c.combos.malos, 0);
    const r2 = c.bloques.find((b) => b.equipo === "Router1").lineas;
    assert.ok(r2.includes(" ip address 11.0.0.62 255.255.255.240"), r2.join("|"));
    assert.ok(r2.includes("ip dhcp pool VLAN3"), "lleva su DHCP");
    assert.ok(c.plan.supuestos.includes("r2 vlan 3 (11.0.0.48/28) va desplazada, le tocaba 11.0.0.32: se dejó donde la escribiste"), c.plan.supuestos.join("|"));
});

prueba("una red que no empieza donde dice su diagonal sí está mal, y se corrige ahí mismo", () => {
    const c = analizar(practica(R1_BIEN, R2_V3("11.0.0.40\t-\t11.0.0.54")));
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("r2 vlan 3: saltos erróneos, es 11.0.0.32 - 11.0.0.46, con máscara 255.255.255.240"), t);
    const r2 = c.bloques.find((b) => b.equipo === "Router1").lineas;
    assert.ok(r2.includes(" ip address 11.0.0.46 255.255.255.240"), "usa la red buena");
    assert.ok(!r2.includes("ip dhcp pool VLAN3"), "y se reserva su DHCP");
});

prueba("IPv6 mal: se reserva su dirección y sus rutas", () => {
    const n = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.252.0",
                     "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A7/126",
                     "11.0.0.16\t-\t11.0.0.30\t-\t255.255.255.240",
                     "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");
    const c = analizar(practica(n, R2_BIEN));
    assert.strictEqual(c.combos.malos, 1);
    const r1 = c.bloques.find((b) => b.equipo === "Router0").lineas;
    const r2 = c.bloques.find((b) => b.equipo === "Router1").lineas;
    assert.ok(!r1.some((l) => l.includes("::4A")), r1.join("|"));
    assert.ok(!r2.some((l) => l.includes("::4A0")), r2.join("|"));
    assert.ok(r1.includes("ip dhcp pool VLAN2"), "el IPv4 de esa VLAN sigue");
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("r1 vlan 2 ipv6: saltos erróneos, es abcd:ab:ac:ad::4a0 - abcd:ab:ac:ad::4a3, con diagonal /126"), t);
    assert.ok(t.includes("sin ipv6 hasta que la nota quede igual: r1 vlan 2"), t);
});

prueba("IPv6: sólo la red con su diagonal también sirve", () => {
    const n = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.252.0", "ABCD:AB:AC:AD::4A0/126",
                     "11.0.0.16\t-\t11.0.0.30\t-\t255.255.255.240", "ABCD:AB:AC:AD::16A0/125");
    const c = analizar(practica(n, R2_BIEN));
    assert.strictEqual(c.combos.malos, 0);
    assert.ok(c.bloques.find((b) => b.equipo === "Router0").lineas.includes(" ipv6 address ABCD:AB:AC:AD::4A3/126"));
});

prueba("IPv6: dos redes encimadas", () => {
    const n = notaDe("R2", "11.0.8.0\t-\t11.0.11.254\t-\t255.255.252.0", "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126",
                     "11.0.0.32\t-\t11.0.0.46\t-\t255.255.255.240", "ABCD:AB:AC:AD::32B0/125\t-\tABCD:AB:AC:AD::32B7/125");
    const t = llama("textoProblemas", analizar(practica(R1_BIEN, n)));
    assert.ok(t.includes("r2 vlan 2 ipv6: se encima con r1 vlan 2"), t);
});

// --- botón de pánico ------------------------------------------------------------------------------

const R1_MUY_MAL = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.0.0",
                          "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A7/126",
                          "11.0.0.16\t-\t11.0.0.31\t-\t255.255.240.0",
                          "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");
const R2_MUY_MAL = notaDe("R2", "11.0.8.0\t-\t11.0.11.255\t-\t255.255.252.0",
                          "ABCD:AB:AC:AD::8B0/126\t-\tABCD:AB:AC:AD::8B3/126",
                          "11.0.0.32\t-\t11.0.0.47\t-\t255.255.240.0",
                          "ABCD:AB:AC:AD::32B0/125\t-\tABCD:AB:AC:AD::32B7/125");

prueba("el pánico se habilita con más del 50% mal, no con el 50% justo", () => {
    assert.strictEqual(analizar(practica(R1_V3_MAL, R2_BIEN)).combos.panico, false);
    const c = analizar(practica(R1_MUY_MAL, R2_MUY_MAL));
    assert.strictEqual(c.combos.malos, 5);
    assert.strictEqual(c.combos.panico, true);
    const cuatro = notaDe("R2", "11.0.8.0\t-\t11.0.11.255\t-\t255.255.252.0",
                          "ABCD:AB:AC:AD::8B0/126\t-\tABCD:AB:AC:AD::8B3/126",
                          "11.0.0.32\t-\t11.0.0.47\t-\t255.255.240.0",
                          "ABCD:AB:AC:AD::32B0/125\t-\tABCD:AB:AC:AD::32B7/125");
    const justo = notaDe("R1", "11.0.4.0\t-\t11.0.7.254\t-\t255.255.0.0",
                         "ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126",
                         "11.0.0.16\t-\t11.0.0.31\t-\t255.255.240.0",
                         "ABCD:AB:AC:AD::16A0/125\t-\tABCD:AB:AC:AD::16A7/125");
    const c2 = analizar(practica(justo, cuatro));
    assert.strictEqual(c2.combos.malos, 4);
    assert.strictEqual(c2.combos.panico, false, "4 de 8 es 50%: todavía no");
});

prueba("el pánico corrige lo más chico primero hasta llegar al 70%", () => {
    const c = analizar(practica(R1_MUY_MAL, R2_MUY_MAL));
    const sel = llama("seleccionPanico", c.combos);
    assert.strictEqual(sel.meta, 6);
    const nombres = sel.elegidos.map((x) => x.equipo + " " + x.vlan + " " + x.familia);
    assert.deepStrictEqual(Array.from(nombres), ["R2 2 ipv4", "R1 2 ipv6", "R1 2 ipv4"]);
});

prueba("el pánico cambia sólo esos números en las notas", () => {
    const c = analizar(practica(R1_MUY_MAL, R2_MUY_MAL));
    const sel = llama("seleccionPanico", c.combos);
    const cambios = llama("notasCorregidas", sel.elegidos);
    const textos = Array.from(cambios).map((x) => x.texto);
    const r1 = textos.find((t) => t.startsWith("R1"));
    const r2 = textos.find((t) => t.startsWith("R2"));
    assert.ok(r1.includes("11.0.4.0\t-\t11.0.7.254\t-\t255.255.252.0"), r1);
    assert.ok(r1.includes("ABCD:AB:AC:AD::4A0/126\t-\tABCD:AB:AC:AD::4A3/126"), r1);
    assert.ok(r1.includes("11.0.0.16\t-\t11.0.0.31\t-\t255.255.240.0"), "el de la VLAN 3 no se toca");
    assert.ok(r2.includes("11.0.8.0\t-\t11.0.11.254\t-\t255.255.252.0"), r2);
    // Con las notas ya corregidas, 6 de 8 quedan bien.
    const de = analizar(practica(r1, r2));
    assert.strictEqual(de.combos.bien, 6);
    assert.strictEqual(de.combos.panico, false);
});

prueba("un error grande no se justifica", () => {
    const n = notaDe("R1", "200.1.1.0\t-\t200.1.1.254\t-\t255.255.255.0",
                     "ABCD:AB:AC:AD::4A1/126\t-\tZZZZ::1/126",
                     "12.9.9.0\t-\t12.9.9.9\t-\t255.0.0.0",
                     "ABCD:AB:AC:AE::16A0/125\t-\tABCD:AB:AC:AE::16A7/125");
    const c = analizar(practica(n, R2_BIEN));
    const grandes = c.combos.lista.filter((x) => !x.ok && !x.pequeno).map((x) => x.equipo + " " + x.vlan + " " + x.familia);
    assert.ok(grandes.includes("R1 2 ipv4"), grandes.join("|"));
    assert.ok(grandes.includes("R1 3 ipv4"), grandes.join("|"));
    assert.ok(grandes.includes("R1 3 ipv6"), "de otra base no se justifica: " + grandes.join("|"));
});

// --- con configuración previa -------------------------------------------------------------------------

function configR1(ipv6Enlace) {
    return ["hostname R1", "ipv6 unicast-routing", "interface FastEthernet0/0", " ip address 11.0.0.5 255.255.255.252",
            " ipv6 address " + ipv6Enlace, "interface FastEthernet0/1", " no ip address",
            "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.7.254 255.255.252.0",
            " ipv6 address ABCD:AB:AC:AD::4A3/126", "ip dhcp pool VLAN2", " network 11.0.4.0 255.255.252.0",
            " default-router 11.0.7.254"];
}

prueba("lo que ya está no se repite", () => {
    const c = analizar(practica(R1_BIEN, R2_BIEN, { cfgR1: configR1("ABCD:AB:AC:AD::/127") }));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
    const r1 = c.bloques.find((b) => b.equipo === "Router0").lineas;
    assert.ok(!r1.includes("ip dhcp pool VLAN2"), r1.join("|"));
    assert.ok(!r1.includes("interface FastEthernet0/1.2"), r1.join("|"));
    assert.ok(!r1.includes("interface FastEthernet0/0"), r1.join("|"));
    assert.ok(r1.includes("interface FastEthernet0/1.3"));
});

prueba("una IPv6 de más: el equipo se borra y se pone completo, con la IPv4 de su enlace", () => {
    const c = analizar(practica(R1_BIEN, R2_BIEN, { cfgR1: configR1("ABCD:AB:AC:AD::9/127") }));
    assert.ok(c.motivos.Router0.some((m) => m.includes("una ipv6 que no es la de su enlace")), JSON.stringify(c.motivos));
    const r1 = c.bloques.find((b) => b.equipo === "Router0").lineas;
    assert.ok(r1.includes(" no ipv6 address ABCD:AB:AC:AD::9/127"), r1.join("|"));
    assert.ok(r1.includes("ip dhcp pool VLAN2"), "se vuelve a poner: " + r1.join("|"));
    const i = r1.lastIndexOf("interface FastEthernet0/0");
    assert.deepStrictEqual(Array.from(r1.slice(i + 1, i + 4)), [" ip address 11.0.0.5 255.255.255.252", " ipv6 address ABCD:AB:AC:AD::/127", " no shutdown"], r1.join("|"));
});

prueba("sin IPv6 en las notas no se toca IPv6", () => {
    const n1 = "R1\nVLAN 2/22\n11.0.4.0 - 11.0.7.254 - 255.255.252.0\nVLAN 3/28\n11.0.0.16 - 11.0.0.30 - 255.255.255.240";
    const n2 = "R2\nVLAN 2/22\n11.0.8.0 - 11.0.11.254 - 255.255.252.0\nVLAN 3/28\n11.0.0.32 - 11.0.0.46 - 255.255.255.240";
    const c = analizar(practica(n1, n2));
    assert.strictEqual(c.combos.total, 4);
    assert.strictEqual(c.combos.malos, 0);
    const t = llama("textoBloques", c.bloques);
    assert.ok(!t.includes("IPV6"), t.substring(0, 200));
});

prueba("el formato de antes sigue: red base y diagonales sin rango, sin combos que revisar", () => {
    const n1 = "R1 11.0.0.0\nVLAN 2/22\nVLAN 3/28";
    const n2 = "R2 11.0.0.0\nVLAN 2/22\nVLAN 3/28";
    const c = analizar(practica(n1, n2));
    assert.strictEqual(c.combos.total, 0);
    const r1 = c.bloques.find((b) => b.equipo === "Router0").lineas;
    assert.ok(r1.includes(" network 11.0.4.0 255.255.252.0"), r1.join("|"));
    assert.ok(r1.includes(" network 11.0.0.16 255.255.255.240"), r1.join("|"));
});

prueba("la raíz de STP lleva la prioridad sólo en la VLAN 1", () => {
    // Router - Switch0 - Switch1 - PCs: al colgar un switch de otro, el pegado al router es la raíz.
    const con = (cfgRaiz, cfgOtro) => {
        const devs = equipo("r", "Router0", "Router", "2811", 100, 100, ROUTER)
            + equipo("a", "Switch0", "Switch", "2960-24TT", 100, 300, SWITCH.concat(cfgRaiz))
            + equipo("b", "Switch1", "Switch", "2960-24TT", 100, 500, SWITCH.concat(cfgOtro))
            + equipo("p0", "PC0 VLAN2", "Pc", "PC-PT", 50, 700) + equipo("p1", "PC1 VLAN3", "Pc", "PC-PT", 150, 700);
        const cables = cable("r", "FastEthernet0/1", "a", "FastEthernet0/1") + cable("a", "FastEthernet0/2", "b", "FastEthernet0/1")
            + cable("b", "FastEthernet0/2", "p0", "FastEthernet0") + cable("b", "FastEthernet0/3", "p1", "FastEthernet0");
        return analizar(`<X><DEVICES>${devs}</DEVICES>${cables}<NOTES>${nota("{n}", 50, 50, "R1 10.0.0.0\nVLAN 2/24\nVLAN 3/24")}</NOTES></X>`);
    };
    const stp = (c, equipoLienzo) => {
        const b = c.bloques.find((x) => x.equipo === equipoLienzo);
        return b ? Array.from(b.lineas).filter((l) => l.includes("spanning-tree")) : [];
    };
    let c = con([], []);
    assert.strictEqual(c.plan.sitios[0].raiz, "Switch0");
    assert.deepStrictEqual(stp(c, "Switch0"), ["spanning-tree vlan 1 priority 4096"]);
    assert.deepStrictEqual(stp(c, "Switch1"), [], "el otro switch no lleva");
    assert.ok(llama("textoBloques", c.bloques).includes("SPANNING-TREE VLAN 1 PRIORITY 4096\n"));

    c = con(["spanning-tree vlan 1 priority 4096"], []);
    assert.deepStrictEqual(stp(c, "Switch0"), [], "con la VLAN 1 puesta ya no falta nada de STP");

    c = con(["spanning-tree vlan 1,2,3 priority 4096"], []);
    assert.deepStrictEqual(stp(c, "Switch0"), [], "lo que ya traiga de más no se toca");
    assert.strictEqual(Object.keys(c.motivos).length, 0);

    c = con(["spanning-tree vlan 2 priority 4096"], []);
    assert.deepStrictEqual(stp(c, "Switch0"), ["spanning-tree vlan 1 priority 4096"], "otra VLAN no cuenta como la 1");

    c = con([], ["spanning-tree vlan 2 priority 4096"]);
    assert.strictEqual(Object.keys(c.motivos).length, 0, "otra VLAN en otro switch no le compite a la raíz");

    c = con([], ["spanning-tree vlan 1 priority 4096"]);
    assert.ok(c.motivos.Switch1.some((m) => m.includes("prioridad de stp en la vlan 1")), JSON.stringify(c.motivos));
});

prueba("el hostname sale aunque el equipo aún no arranque y el archivo no traiga su configuración", () => {
    const sinArrancar = (ref, nombre, tipo, modelo, x) => `<DEVICE><ENGINE><TYPE model="${modelo}">${tipo}</TYPE><NAME translate="true">${nombre}</NAME>
<SAVE_REF_ID>${ref}</SAVE_REF_ID></ENGINE><WORKSPACE><LOGICAL><X>${x}</X><Y>100</Y></LOGICAL></WORKSPACE></DEVICE>`;
    const xml = `<X><DEVICES>${sinArrancar("r", "R7", "Router", "2811", 100)}${sinArrancar("s", "SW7", "Switch", "2960-24TT", 300)}
${sinArrancar("m", "M7", "MultiLayerSwitch", "3560-24PS", 500)}${sinArrancar("f", "Router0", "Router", "2811", 700)}
${sinArrancar("p", "Fuente de poder", "Power Distribution Device", "Power Distribution Device", 900)}</DEVICES><NOTES></NOTES></X>`;
    const c = analizar(xml);
    assert.ok(c.topo.dispositivos.every((d) => d.cfg === null));
    const nombres = c.bloques.map((b) => b.lineas.join("|")).sort();
    assert.deepStrictEqual(Array.from(nombres), ["hostname M7", "hostname R7", "hostname SW7"], "el de fábrica y la fuente, no");
});

prueba("un multicapa sin nota ni IP es sólo un switch", () => {
    const devs = equipo("r", "Router0", "Router", "2811", 100, 100, ROUTER)
        + equipo("m", "Multilayer Switch0", "MultiLayerSwitch", "3650-24PS", 100, 300, ["hostname Switch", "interface GigabitEthernet1/0/1"]);
    const xml = `<X><DEVICES>${devs}</DEVICES>${cable("r", "FastEthernet0/0", "m", "GigabitEthernet1/0/1")}
<NOTES>${nota("{n}", 50, 50, "R1 10.0.0.0\nVLAN 10/24\nVLAN 20/24")}</NOTES></X>`;
    const c = analizar(xml);
    assert.ok(!c.bloques.some((b) => b.lineas.includes("ip routing")), "no le pide ip routing");
    const r = c.bloques.find((b) => b.equipo === "Router0").lineas;
    assert.ok(r.includes("interface FastEthernet0/0.10"), r.join("|"));
    const m2 = c.bloques.find((b) => b.equipo === "Multilayer Switch0").lineas;
    assert.ok(m2.includes(" switchport mode trunk"), m2.join("|"));
    assert.ok(!m2.includes(" switchport trunk encapsulation dot1q"), "un 3650 rechaza esa línea: " + m2.join("|"));
    // Un 3560, en cambio, no deja poner la troncal sin ella, aunque sólo haga de switch.
    const c3560 = analizar(xml.replace("3650-24PS", "3560-24PS"));
    const m3 = c3560.bloques.find((b) => b.equipo === "Multilayer Switch0").lineas;
    assert.ok(m3.includes(" switchport trunk encapsulation dot1q") && m3.indexOf(" switchport trunk encapsulation dot1q") < m3.indexOf(" switchport mode trunk"), m3.join("|"));
});

// --- en qué orden salen las redes y qué pasa cuando se enciman -----------------------------------

// R1 - R2 - R3 - R4, con SWR1 colgando de R1 y SWR2 de R3, como en P4_P3: `notas` son los textos
// de VLAN; `enlaces` son las notas junto a cada cable, por omisión del .4 al .20.
const R4T = ["hostname Router", "interface FastEthernet0/0", " no ip address", " shutdown",
             "interface FastEthernet0/1", " no ip address", " shutdown"];
function cuatroRouters(notas, enlaces = [".4", ".8", ".12", ".16", ".20"], cfg = {}) {
    const lugares = { R1: [100, 100], R2: [1000, 100], R3: [2000, 100], R4: [3000, 100], SWR1: [100, 1000], SWR2: [2000, 1000],
                      S1: [100, 1500], S2: [1000, 600], S3: [2000, 1500], S4: [3000, 600] };
    const devs = [], cables = [];
    ["R1", "R2", "R3", "R4"].forEach((n) => devs.push(equipo(n, n, "Router", "2811", lugares[n][0], lugares[n][1], cfg[n] || R4T)));
    ["SWR1", "SWR2"].forEach((n) => devs.push(equipo(n, n, "MultiLayerSwitch", "3560-24PS", lugares[n][0], lugares[n][1], cfg[n] || ["hostname Switch"])));
    ["S1", "S2", "S3", "S4"].forEach((n) => devs.push(equipo(n, n, "Switch", "2960-24TT", lugares[n][0], lugares[n][1], SWITCH)));
    const par = (a, pa, b, pb) => cables.push(cable(a, pa, b, pb));
    par("R1", "FastEthernet0/0", "R2", "FastEthernet0/0");
    par("R2", "FastEthernet0/1", "R3", "FastEthernet0/0");
    par("R3", "FastEthernet0/1", "R4", "FastEthernet0/0");
    par("R1", "Ethernet0/0/0", "SWR1", "FastEthernet0/1");
    par("R3", "Ethernet0/0/0", "SWR2", "FastEthernet0/1");
    par("SWR1", "FastEthernet0/2", "S1", "FastEthernet0/1");
    par("R2", "Ethernet0/0/0", "S2", "FastEthernet0/1");
    par("SWR2", "FastEthernet0/2", "S3", "FastEthernet0/1");
    par("R4", "FastEthernet0/1", "S4", "FastEthernet0/1");
    let pc = 0;
    ["S1", "S2", "S3", "S4"].forEach((s) => {
        for (let i = 2; i <= 5; i++) {
            devs.push(equipo("p" + pc, "PC" + pc, "Pc", "PC-PT", lugares[s][0], lugares[s][1] + 200));
            par(s, "FastEthernet0/" + i, "p" + pc, "FastEthernet0");
            pc++;
        }
    });
    const medios = [[550, 100], [1500, 100], [2500, 100], [100, 550], [2000, 550]];
    const textos = enlaces.map((t, i) => nota("{e" + i + "}", medios[i][0], medios[i][1], t));
    notas.forEach((t, i) => textos.push(nota("{n" + i + "}", 500 + 300 * i, 3000, t)));
    return `<X><DEVICES>${devs.join("")}</DEVICES>${cables.join("")}<NOTES>${textos.join("")}</NOTES></X>`;
}

function redesDe(c, sitio) {
    const s = c.plan.sitios.find((x) => (x.rotulo || x.dueno.hostname || x.dueno.nombre) === sitio);
    return Array.from(s.vlans).map((v) => v.numero + " " + llama("textoRed", v.red));
}

// Tal como en las hojas de P4_P3: una tabla por VLAN, de la más chica a la más grande.
const COMO_P4 = [
    "R2\nVLAN 2/17\n 16.0.128.0 - 16.0.255.254 - 255.255.128.0\nVLAN 3/22\n 16.0.8.0 - 16.0.11.254 - 255.255.252.0\nVLAN 4/24\n 16.0.1.0 - 16.0.1.254 - 255.255.255.0",
    "R3\nVLAN 2/17\n 16.1.0.0 - 16.1.127.254 - 255.255.128.0\nVLAN 3/22\n 16.0.12.0 - 16.0.15.254 - 255.255.252.0\nVLAN 4/24\n 16.0.2.0 - 16.0.2.254 - 255.255.255.0\nVLAN 5/15\n 16.2.0.0 - 16.3.255.254 - 255.254.0.0",
    "R4\nVLAN 3/22\n 16.0.16.0 - 16.0.19.254 - 255.255.252.0\nVLAN 4/24\n 16.0.3.0 - 16.0.3.254 - 255.255.255.0\nVLAN 5/15\n 16.4.0.0 - 16.5.255.254 - 255.254.0.0",
    "SWR1\nVLAN 3/22\n 16.0.4.0 - 16.0.7.254 - 255.255.252.0",
];

prueba("las redes salen una tabla por VLAN, de la más chica a la más grande, y el multicapa en el lugar de su router", () => {
    const c = analizar(cuatroRouters(COMO_P4));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 11 de 11 (100%)\n");
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22"], "SWR1 cuelga de R1: va primero en la VLAN 3");
    assert.deepStrictEqual(redesDe(c, "R2"), ["2 16.0.128.0/17", "3 16.0.8.0/22", "4 16.0.1.0/24"]);
    assert.deepStrictEqual(redesDe(c, "R4"), ["3 16.0.16.0/22", "4 16.0.3.0/24", "5 16.4.0.0/15"], "2.0.0 ya es de R3");
});

prueba("sin nada escrito sale el mismo orden, y lo dice", () => {
    const c = analizar(cuatroRouters(["R2 16.0.0.0\nVLAN 2/17\nVLAN 3/22\nVLAN 4/24", "R3 16.0.0.0\nVLAN 2/17\nVLAN 3/22\nVLAN 4/24\nVLAN 5/15",
                                      "R4 16.0.0.0\nVLAN 3/22\nVLAN 4/24\nVLAN 5/15", "SWR1 16.0.0.0\nVLAN 3/22"]));
    assert.deepStrictEqual(redesDe(c, "R4"), ["3 16.0.16.0/22", "4 16.0.3.0/24", "5 16.4.0.0/15"]);
    assert.ok(c.plan.supuestos.includes("las redes salieron de la más chica a la más grande, vlan por vlan y por número de router"), c.plan.supuestos.join("|"));
});

prueba("lo que ya está configurado manda sobre el orden", () => {
    const cfg = ["hostname R1", "interface FastEthernet0/0", " no ip address", "interface FastEthernet0/1", " no ip address",
                 "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.1.254 255.255.255.0"];
    const n1 = "R1 11.0.0.0\nVLAN 2/24\nVLAN 3/25", n2 = "R2 11.0.0.0\nVLAN 3/25";
    const c = analizar(practica(n1, n2, { cfgR1: cfg }));
    assert.deepStrictEqual(redesDe(c, "R1"), ["2 11.0.1.0/24", "3 11.0.0.128/25"], "su V2 no se mueve");
    assert.deepStrictEqual(redesDe(c, "R2"), ["3 11.0.2.0/25"]);
    assert.ok(c.plan.supuestos.some((s) => s.startsWith("tus redes ya van de la más grande a la más chica")), c.plan.supuestos.join("|"));
    const sin = analizar(practica(n1, n2));
    assert.deepStrictEqual(redesDe(sin, "R1"), ["2 11.0.2.0/24", "3 11.0.0.128/25"], "sin config, de la más chica a la más grande");
});

prueba("con usuarios sigue el VLSM de siempre, de la más grande a la más chica", () => {
    const c = analizar(practica("R1 11.0.0.0\nVLAN 2 200\nVLAN 3 100\nVLAN 4 100", "R2 11.0.0.0\nVLAN 5 100"));
    assert.deepStrictEqual(redesDe(c, "R1"), ["2 11.0.1.0/24", "3 11.0.0.128/25", "4 11.0.2.0/25"]);
});

prueba("una diagonal mal en el título: el rango y la máscara mandan, se dice y se reserva su DHCP", () => {
    const mal = COMO_P4.map((t) => t.split("VLAN 5/15").join("VLAN 5/16"));
    const c = analizar(cuatroRouters(mal));
    assert.deepStrictEqual(redesDe(c, "R4"), ["3 16.0.16.0/22", "4 16.0.3.0/24", "5 16.4.0.0/15"], "las demás no se mueven");
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("r4 vlan 5: la nota dice /16, pero tu rango y tu máscara son de /15"), t);
    assert.ok(t.includes("sin dhcp hasta que la nota quede igual: r3 vlan 5, r4 vlan 5"), t);
    assert.strictEqual(c.combos.malos, 2);
    const r4 = c.bloques.find((b) => b.equipo === "R4").lineas;
    assert.ok(r4.includes(" ip address 16.5.255.254 255.254.0.0"), r4.join("|"));
    assert.ok(!r4.some((l) => l.includes("ip dhcp pool VLAN5")), r4.join("|"));
    // El pánico también la corrige.
    const elegidos = c.combos.lista.filter((x) => !x.ok);
    const cambios = llama("notasCorregidas", elegidos);
    const nuevos = Array.from(cambios).map((x) => x.texto);
    assert.ok(nuevos.every((n) => n.includes("VLAN 5/15") && !n.includes("VLAN 5/16")), nuevos.join("||"));
});

prueba("si el rango y la máscara tampoco se ponen de acuerdo, manda el título", () => {
    const c = analizar(practica(R1_V3_MAL, R2_BIEN));
    assert.deepStrictEqual(redesDe(c, "R1"), ["2 11.0.4.0/22", "3 11.0.0.16/28"]);
    assert.ok(!llama("textoProblemas", c).includes("la nota dice"));
});

prueba("una red en el lugar equivocado dice con quién choca", () => {
    const encima = COMO_P4.slice();
    encima[2] = "R4\nVLAN 3/22\n 16.0.8.0 - 16.0.11.254 - 255.255.252.0\nVLAN 4/24\n 16.0.0.0 - 16.0.0.254 - 255.255.255.0\nVLAN 5/15\n 16.0.0.0 - 16.1.255.254 - 255.254.0.0";
    const t = llama("textoProblemas", analizar(cuatroRouters(encima)));
    assert.ok(t.includes("r4 vlan 3: se encima con r2 vlan 3 (16.0.8.0/22), es 16.0.16.0 - 16.0.19.254, con máscara 255.255.252.0"), t);
    assert.ok(t.includes("r4 vlan 4: se encima con un enlace (16.0.0.4/30), es 16.0.3.0 - 16.0.3.254, con máscara 255.255.255.0"), t);
    assert.ok(t.includes("r4 vlan 5: se encima con r2 vlan 2 (16.0.128.0/17), es"), t);
    assert.ok(!t.includes("r2 vlan 3:"), "la que está bien no se marca: " + t);
});

prueba("la nota de un router sin LAN propia va en el multicapa que cuelga de él", () => {
    const c = analizar(cuatroRouters(COMO_P4));
    const s = c.plan.sitios.find((x) => x.rotulo === "R3");
    assert.strictEqual(s.dueno.nombre, "SWR2");
    assert.ok(c.plan.supuestos.includes("la nota de r3 se aplicó a swr2: r3 no tiene lan propia"), c.plan.supuestos.join("|"));
    const swr2 = c.bloques.find((b) => b.equipo === "SWR2").lineas;
    assert.ok(swr2.includes("interface Vlan2"), swr2.join("|"));
    assert.ok(swr2.includes(" ip address 16.1.127.254 255.255.128.0"), swr2.join("|"));
    assert.ok(swr2.includes("ip dhcp pool VLAN2"), swr2.join("|"));
    assert.ok(!c.bloques.find((b) => b.equipo === "R3").lineas.some((l) => /^interface .*\.\d+$/.test(l)), "R3 no lleva subinterfaces");
    assert.strictEqual(c.plan.errores.length, 0, JSON.stringify(c.plan.errores));
    // Si el multicapa ya tiene su nota, la de R3 sí es un error que hay que decir.
    const dos = analizar(cuatroRouters(COMO_P4.concat(["SWR2\nVLAN 9/24\n 16.0.9.0 - 16.0.9.254 - 255.255.255.0"])));
    assert.ok(dos.plan.errores.some((e) => e[1].includes("no tiene ningún switch cableado")), JSON.stringify(dos.plan.errores));
});

prueba("dos notas de enlace en el mismo /30: gana la que dice su inicio y se avisa quién lo usa", () => {
    const c = analizar(cuatroRouters(COMO_P4, [".47", ".8", ".44", ".16", ".20"]));
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("la nota '.47' junto al cable r1 fastethernet0/0 - r2 fastethernet0/0 cae en 16.0.0.44/30, que ya usan r3 y r4: se eligió 16.0.0.4/30"), t);
    assert.ok(c.bloques.find((b) => b.equipo === "R3").lineas.includes(" ip address 16.0.0.45 255.255.255.252"));
    assert.ok(c.bloques.find((b) => b.equipo === "R1").lineas.includes(" ip address 16.0.0.5 255.255.255.252"));
});

prueba("un rango con la última utilizable no se traga la red por una máscara mal", () => {
    // SWR1 con 255.0.0.0: antes se quedaba con todo 16.0.0.0/8 y a los demás no les cabía nada.
    const c = analizar(cuatroRouters(["SWR1 16.0.0.0\nVLAN 6\n 16.1.0.0 - 16.1.255.254 - 255.0.0.0", "R2 16.0.0.0\nVLAN 3/24"]));
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["6 16.1.0.0/16"]);
    assert.deepStrictEqual(redesDe(c, "R2"), ["3 16.0.1.0/24"]);
    assert.ok(llama("textoProblemas", c).includes("la máscara 255.0.0.0 no cuadra con 16.1.0.0/16"), llama("textoProblemas", c));
});

prueba("el bloc lista las redes en el orden en que se cuentan, no routers y luego core", () => {
    // La VLAN 5 mal hecha: SWR2 tiene el primer bloque y R4 el segundo, aunque R4 sea router.
    const notas = COMO_P4.map((t) => t.replace(/^R3\n/, "SWR2\n")
        .replace("16.4.0.0 - 16.5.255.254", "16.4.0.5 - 16.5.255.254")
        .replace("16.2.0.0 - 16.3.255.254", "16.2.0.5 - 16.3.255.254"));
    const t = llama("textoProblemas", analizar(cuatroRouters(notas)));
    assert.ok(t.includes("swr2 vlan 5: saltos erróneos, es 16.2.0.0 - 16.3.255.254, con máscara 255.254.0.0\nr4 vlan 5: saltos erróneos, es 16.4.0.0 - 16.5.255.254"), t);
    assert.ok(t.includes("sin dhcp hasta que la nota quede igual: swr2 vlan 5, r4 vlan 5"), t);
});

// --- combos olvidados: se agregan contando desde el último, que en COMO_P4 termina en 16.5.255.255 --

const OLVIDADA = (...texto) => COMO_P4.slice(0, 3).concat([COMO_P4[3] + "\n" + texto.join("\n")]);
const V4_OLVIDADA = (rango) => OLVIDADA("VLAN 4/24\n " + rango + " - 255.255.255.0");

prueba("un combo olvidado, contado desde el último, no recorre a los demás", () => {
    // Por su orden, SWR1 iría primero en la tabla de la VLAN 4 y movería a las otras tres.
    const c = analizar(cuatroRouters(V4_OLVIDADA("16.6.0.0 - 16.6.0.254")));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 12 de 12 (100%)\n");
    assert.strictEqual(c.combos.panico, false);
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22", "4 16.6.0.0/24"]);
    assert.deepStrictEqual(redesDe(c, "R2"), ["2 16.0.128.0/17", "3 16.0.8.0/22", "4 16.0.1.0/24"]);
    assert.ok(c.plan.supuestos.includes("swr1 vlan 4 (16.6.0.0/24) va desplazada: se dejó donde la escribiste"), c.plan.supuestos.join("|"));
    assert.ok(c.completos.find((b) => b.equipo === "SWR1").lineas.includes("ip dhcp pool VLAN4"), "lleva su DHCP");
});

prueba("una VLAN escrita dos veces en la nota se dice: no se ignora en silencio", () => {
    const c = analizar(cuatroRouters(OLVIDADA("VLAN 3/22\n 16.6.0.0 - 16.6.3.254 - 255.255.252.0")));
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("swr1: la vlan 3 aparece dos veces en la nota: se usó la primera y se ignoró 16.6.0.0"), t);
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22"]);
    assert.strictEqual(c.combos.malos, 0);
});

prueba("varios olvidados de distintos tamaños, uno tras otro", () => {
    const c = analizar(cuatroRouters(OLVIDADA("VLAN 6/28\n 16.6.0.0 - 16.6.0.14 - 255.255.255.240", "VLAN 7/24\n 16.6.1.0 - 16.6.1.254 - 255.255.255.0")));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 13 de 13 (100%)\n");
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22", "6 16.6.0.0/28", "7 16.6.1.0/24"]);
});

prueba("un olvidado a media hoja: las de después lo saltan", () => {
    // La VLAN 6/22 de R4 se contó después del /24 olvidado: 16.0.20.0 ya no estaba libre.
    const notas = V4_OLVIDADA("16.0.20.0 - 16.0.20.254");
    notas[2] += "\nVLAN 6/22\n 16.0.24.0 - 16.0.27.254 - 255.255.252.0";
    const c = analizar(cuatroRouters(notas));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 13 de 13 (100%)\n");
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22", "4 16.0.20.0/24"]);
});

prueba("un olvidado que no cuadra con su diagonal se corrige ahí donde ibas contando", () => {
    const corrido = llama("textoProblemas", analizar(cuatroRouters(V4_OLVIDADA("16.6.0.5 - 16.6.1.4"))));
    assert.ok(corrido.startsWith("combos bien: 11 de 12 (92%)\n\nswr1 vlan 4: saltos erróneos, es 16.6.0.0 - 16.6.0.254, con máscara 255.255.255.0\n"), corrido);
    assert.ok(corrido.includes("sin dhcp hasta que la nota quede igual: swr1 vlan 4"), corrido);
    const largo = llama("textoProblemas", analizar(cuatroRouters(OLVIDADA("VLAN 6/28\n 16.6.0.0 - 16.6.0.30 - 255.255.255.240"))));
    assert.ok(largo.includes("swr1 vlan 6: saltos erróneos, es 16.6.0.0 - 16.6.0.14, con máscara 255.255.255.240"), largo);
    const mascara = llama("textoProblemas", analizar(cuatroRouters(OLVIDADA("VLAN 6/28\n 16.6.0.0 - 16.6.0.14 - 255.255.255.0"))));
    assert.ok(mascara.includes("swr1 vlan 6: máscara errónea, es 255.255.255.240"), mascara);
    const titulo = analizar(cuatroRouters(OLVIDADA("VLAN 4/25\n 16.6.0.0 - 16.6.0.254 - 255.255.255.0")));
    assert.ok(llama("textoProblemas", titulo).includes("swr1 vlan 4: la nota dice /25, pero tu rango y tu máscara son de /24"), llama("textoProblemas", titulo));
    assert.deepStrictEqual(redesDe(titulo, "R2"), ["2 16.0.128.0/17", "3 16.0.8.0/22", "4 16.0.1.0/24"], "las demás no se mueven");
});

prueba("un olvidado encima de otra red dice con quién choca y a dónde va", () => {
    const c = analizar(cuatroRouters(V4_OLVIDADA("16.4.0.0 - 16.4.0.254")));
    assert.ok(llama("textoProblemas", c).includes("swr1 vlan 4: se encima con r4 vlan 5 (16.4.0.0/15), es 16.6.0.0 - 16.6.0.254, con máscara 255.255.255.0"), llama("textoProblemas", c));
    assert.strictEqual(c.combos.malos, 1, "las demás siguen bien");
});

prueba("una VLAN con diagonal y sin combo se cuenta desde el último si tus combos no la contaron", () => {
    const c = analizar(cuatroRouters(OLVIDADA("VLAN 4/24")));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 11 de 11 (100%)\n");
    assert.deepStrictEqual(redesDe(c, "SWR1"), ["3 16.0.4.0/22", "4 16.6.0.0/24"]);
    assert.ok(c.plan.supuestos.includes("swr1 vlan 4 no trae combo: se contó desde el último, 16.6.0.0/24"), c.plan.supuestos.join("|"));
    // Si cabe sin mover a nadie, se queda en su lugar de la tabla.
    const hueco = analizar(cuatroRouters(OLVIDADA("VLAN 6/28")));
    assert.deepStrictEqual(redesDe(hueco, "SWR1"), ["3 16.0.4.0/22", "6 16.0.0.32/28"]);
    assert.ok(!hueco.plan.supuestos.some((s) => s.includes("no trae combo")), hueco.plan.supuestos.join("|"));
});

prueba("una tabla entera desplazada está bien: sólo se revisa su diagonal, y se dice qué le tocaba", () => {
    // Como la VLAN 5 de P4_P3 cuando se copió un bloque de más.
    const notas = COMO_P4.map((t) => t.replace("16.4.0.0 - 16.5.255.254", "16.6.0.0 - 16.7.255.254")
        .replace("16.2.0.0 - 16.3.255.254", "16.4.0.0 - 16.5.255.254"));
    const c = analizar(cuatroRouters(notas));
    assert.strictEqual(llama("textoProblemas", c), "combos bien: 11 de 11 (100%)\n");
    assert.deepStrictEqual(redesDe(c, "R4"), ["3 16.0.16.0/22", "4 16.0.3.0/24", "5 16.6.0.0/15"]);
    assert.ok(c.plan.supuestos.includes("r3 vlan 5 (16.4.0.0/15) va desplazada, le tocaba 16.2.0.0: se dejó donde la escribiste"), c.plan.supuestos.join("|"));
    assert.ok(c.plan.supuestos.includes("r4 vlan 5 (16.6.0.0/15) va desplazada, le tocaba 16.4.0.0: se dejó donde la escribiste"), c.plan.supuestos.join("|"));
    assert.ok(c.bloques.find((b) => b.equipo === "R4").lineas.includes("ip dhcp pool VLAN5"), "lleva su DHCP");
});

prueba("más de un bloque de desplazamiento ya es error, y se dice cuál le toca", () => {
    // Dos bloques: 16.8.0.0 en vez de 16.4.0.0.
    const dos = COMO_P4.slice();
    dos[2] = dos[2].replace("16.4.0.0 - 16.5.255.254", "16.8.0.0 - 16.9.255.254");
    const c2 = analizar(cuatroRouters(dos));
    assert.ok(llama("textoProblemas", c2).includes("r4 vlan 5: saltos erróneos, es 16.4.0.0 - 16.5.255.254, con máscara 255.254.0.0"), llama("textoProblemas", c2));
    assert.strictEqual(c2.combos.malos, 1);
    assert.ok(!c2.bloques.find((b) => b.equipo === "R4").lineas.includes("ip dhcp pool VLAN5"), "se reserva su DHCP");
    // Lejos, a media tabla: las demás contaron su lugar y no se mueven.
    const lejos = COMO_P4.slice();
    lejos[0] = lejos[0].replace("16.0.1.0 - 16.0.1.254", "16.200.0.0 - 16.200.0.254");
    const c = analizar(cuatroRouters(lejos));
    assert.ok(llama("textoProblemas", c).includes("r2 vlan 4: saltos erróneos, es 16.0.1.0 - 16.0.1.254"), llama("textoProblemas", c));
    assert.strictEqual(c.combos.malos, 1);
    assert.deepStrictEqual(redesDe(c, "R3"), ["2 16.1.0.0/17", "3 16.0.12.0/22", "4 16.0.2.0/24", "5 16.2.0.0/15"]);
    // En un hueco, sin mover a nadie.
    const hueco = COMO_P4.slice();
    hueco[2] = hueco[2].replace("16.0.3.0 - 16.0.3.254", "16.0.40.0 - 16.0.40.254");
    assert.ok(llama("textoProblemas", analizar(cuatroRouters(hueco))).includes("r4 vlan 4: saltos erróneos, es 16.0.3.0 - 16.0.3.254"));
    // Un bloque y otro más se suman: R3 va un bloque adelante y R4, dos.
    const suma = COMO_P4.map((t) => t.replace("16.4.0.0 - 16.5.255.254", "16.8.0.0 - 16.9.255.254")
        .replace("16.2.0.0 - 16.3.255.254", "16.4.0.0 - 16.5.255.254"));
    const cs = analizar(cuatroRouters(suma));
    assert.ok(llama("textoProblemas", cs).includes("r4 vlan 5: saltos erróneos, es 16.6.0.0 - 16.7.255.254"), llama("textoProblemas", cs));
    assert.deepStrictEqual(redesDe(cs, "R3"), ["2 16.1.0.0/17", "3 16.0.12.0/22", "4 16.0.2.0/24", "5 16.4.0.0/15"], "R3 se queda, y R4 sigue después de él");
});

prueba("un olvidado también tiene un solo bloque de margen, contando desde la red de abajo", () => {
    const uno = analizar(cuatroRouters(V4_OLVIDADA("16.6.1.0 - 16.6.1.254")));
    assert.strictEqual(uno.combos.malos, 0, llama("textoProblemas", uno));
    assert.deepStrictEqual(redesDe(uno, "SWR1"), ["3 16.0.4.0/22", "4 16.6.1.0/24"]);
    const dos = analizar(cuatroRouters(V4_OLVIDADA("16.6.2.0 - 16.6.2.254")));
    assert.ok(llama("textoProblemas", dos).includes("swr1 vlan 4: saltos erróneos, es 16.6.0.0 - 16.6.0.254"), llama("textoProblemas", dos));
    assert.strictEqual(dos.combos.malos, 1, "las demás no se recorren");
});

prueba("dos redes escritas encima: gana la que coincide con la cuenta", () => {
    const dos = COMO_P4.slice();
    dos[2] = dos[2].replace("16.0.3.0 - 16.0.3.254", "16.0.2.0 - 16.0.2.254");
    const c = analizar(cuatroRouters(dos));
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("r4 vlan 4: se encima con r3 vlan 4 (16.0.2.0/24), es 16.0.3.0 - 16.0.3.254"), t);
    assert.strictEqual(c.combos.malos, 1);
    assert.deepStrictEqual(redesDe(c, "R3"), ["2 16.1.0.0/17", "3 16.0.12.0/22", "4 16.0.2.0/24", "5 16.2.0.0/15"]);
});

// --- las notas mandan: lo que falta se agrega y lo que las contradice se borra ----------------

const N1 = "R1\nVLAN 2/22\n11.0.4.0 - 11.0.7.254 - 255.255.252.0\nVLAN 3/28\n11.0.0.16 - 11.0.0.30 - 255.255.255.240";
const N2 = "R2\nVLAN 2/22\n11.0.8.0 - 11.0.11.254 - 255.255.252.0\nVLAN 3/28\n11.0.0.32 - 11.0.0.46 - 255.255.255.240";
const motivosDe = (c, equipo) => (c.motivos[equipo] || []).join(" | ");
const bloqueDe = (c, equipo) => Array.from(c.bloques.find((b) => b.equipo === equipo).lineas);

prueba("a medias no es estar mal: sólo se agrega lo que falta, sin borrar", () => {
    const cfg = ["hostname R1", "interface FastEthernet0/0", " ip address 11.0.0.5 255.255.255.252", "interface FastEthernet0/1", " no ip address",
                 "interface FastEthernet0/1.2", " encapsulation dot1Q 2", "ip dhcp pool VLAN2", " network 11.0.4.0 255.255.252.0"];
    const s1 = ["hostname Switch", "interface FastEthernet0/1", " switchport mode trunk", "interface FastEthernet0/2", " switchport mode access",
                "interface FastEthernet0/3", "interface FastEthernet0/4"];
    const c = analizar(practica(N1, N2, { cfgR1: cfg, cfgS1: s1 }));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
    assert.strictEqual(Object.keys(c.borrar).length, 0);
    const r1 = bloqueDe(c, "Router0");
    assert.ok(!r1.some((l) => /^no /.test(l.trim())), r1.join("|"));
    assert.ok(r1.includes(" ip address 11.0.7.254 255.255.252.0"), r1.join("|"));
    assert.ok(r1.includes(" default-router 11.0.7.254"), "el pool a medias se completa: " + r1.join("|"));
});

function conProblema(opciones) { return analizar(practica(N1, N2, opciones)); }

prueba("lo que ya trae un equipo y las notas contradicen lo borra completo", () => {
    const casos = [
        ["subinterfaz con otra ip", { cfgR1: ["hostname R1", "interface FastEthernet0/1", "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.4.1 255.255.252.0"] }, "Router0", "fastethernet0/1.2 tiene 11.0.4.1 255.255.252.0, y le toca 11.0.7.254 255.255.252.0"],
        ["subinterfaz apagada", { cfgR1: ["hostname R1", "interface FastEthernet0/1", "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.7.254 255.255.252.0", " shutdown"] }, "Router0", "fastethernet0/1.2 está apagada"],
        ["puerto de pc apagado", { cfgS1: ["hostname Switch", "interface FastEthernet0/3", " shutdown"] }, "Switch0", "fastethernet0/3 está apagado, y es de una pc"],
        ["puerto de pc de troncal", { cfgS1: ["hostname Switch", "interface FastEthernet0/3", " switchport mode trunk"] }, "Switch0", "fastethernet0/3 es troncal, y es de una pc"],
        ["troncal en acceso", { cfgS1: ["hostname Switch", "interface FastEthernet0/1", " switchport mode access"] }, "Switch0", "fastethernet0/1 está en modo acceso, y es una troncal"],
        ["troncal apagada", { cfgS1: ["hostname Switch", "interface FastEthernet0/1", " switchport mode trunk", " shutdown"] }, "Switch0", "fastethernet0/1 está apagado, y es una troncal"],
        ["troncal que no deja pasar una vlan", { cfgS1: ["hostname Switch", "interface FastEthernet0/1", " switchport trunk allowed vlan 3,5-6", " switchport mode trunk"] }, "Switch0", "fastethernet0/1 no deja pasar la vlan 2"],
        ["excluded-address que se come la vlan", { cfgR1: ["hostname R1", "interface FastEthernet0/1", "ip dhcp excluded-address 11.0.0.17 11.0.0.29"] }, "Router0", "le quedan 0 direcciones a la vlan 3"],
        ["dhcp apagado", { cfgR1: ["no service dhcp", "hostname R1", "interface FastEthernet0/1"] }, "Router0", "no service dhcp"],
        ["otra interfaz con la red de una vlan", { cfgR1: ["hostname R1", "interface FastEthernet0/1", "interface Loopback0", " ip address 11.0.4.1 255.255.255.0"] }, "Router0", "loopback0 (11.0.4.0/24) se encima con la vlan 2 de r1"],
    ];
    casos.forEach(([nombre, opciones, equipo, texto]) => {
        const c = conProblema(opciones);
        assert.ok(motivosDe(c, equipo).toLowerCase().includes(texto), nombre + ": " + JSON.stringify(c.motivos));
        assert.ok(c.borrar[equipo], nombre + " se borra");
        assert.ok(bloqueDe(c, equipo).includes("! se borra lo que tenía") || c.borrar[equipo].length === 0, nombre);
    });
});

prueba("un excluded-address normal no estorba", () => {
    const c = conProblema({ cfgR1: ["hostname R1", "interface FastEthernet0/1", "ip dhcp excluded-address 11.0.0.17 11.0.0.20", "ip dhcp excluded-address 11.0.7.254"] });
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("una VLAN de sobra sin red en común no estorba, y una troncal con todas las VLANs tampoco", () => {
    const c = conProblema({ cfgR1: ["hostname R1", "interface FastEthernet0/1", "interface Loopback0", " ip address 192.168.9.1 255.255.255.0"],
                            cfgS1: ["hostname Switch", "interface FastEthernet0/1", " switchport trunk native vlan 6", " switchport trunk allowed vlan 2-3", " switchport mode trunk"] });
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("dos VLANs con las redes intercambiadas: se borra, y nada de lo viejo se rutea", () => {
    const cfg = ["hostname R1", "interface FastEthernet0/1", " no ip address",
                 "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.0.30 255.255.255.240",
                 "interface FastEthernet0/1.3", " encapsulation dot1Q 3", " ip address 11.0.7.254 255.255.252.0"];
    const c = conProblema({ cfgR1: cfg });
    assert.ok(motivosDe(c, "Router0").includes("le toca"), JSON.stringify(c.motivos));
    const r1 = bloqueDe(c, "Router0");
    const borra = r1.indexOf("no interface FastEthernet0/1.2"), pone = r1.indexOf("interface FastEthernet0/1.2");
    assert.ok(borra >= 0 && borra < r1.indexOf("! y se pone todo de nuevo") && r1.indexOf("! y se pone todo de nuevo") < pone, r1.join("|"));
});

prueba("lo que un equipo tenía y se borra ya no cuenta para nadie: su red no se rutea", () => {
    const cfg = ["hostname R1", "interface FastEthernet0/1", " ip address 11.0.4.1 255.255.255.0",
                 "interface FastEthernet0/1.3", " encapsulation dot1Q 3", " ip address 11.0.0.30 255.255.255.240"];
    const c = conProblema({ cfgR1: cfg });
    assert.ok(c.borrar.Router0, JSON.stringify(c.motivos));
    assert.ok(!bloqueDe(c, "Router1").some((l) => l.indexOf("ip route 11.0.4.0 255.255.255.0") === 0), bloqueDe(c, "Router1").join("|"));
    assert.ok(bloqueDe(c, "Router1").includes("ip route 11.0.4.0 255.255.252.0 11.0.0.5"), bloqueDe(c, "Router1").join("|"));
});

prueba("el borrado deja al puerto como de fábrica y el Port-channel se va al último", () => {
    const q = llama("quitarConfig", ["hostname Switch", "enable secret 5 abc", "banner motd #hola#", "ip default-gateway 16.0.0.1", "spanning-tree mode pvst", "spanning-tree vlan 1 priority 4096",
                                     "interface Port-channel1", " switchport mode trunk",
                                     "interface FastEthernet0/1", " description hola", " switchport trunk native vlan 9", " switchport trunk allowed vlan 5,9", " switchport mode trunk", " switchport nonegotiate", " duplex full", " speed 100", " shutdown",
                                     "interface FastEthernet0/3", " switchport mode trunk", " channel-group 1 mode active", " duplex auto", " speed auto",
                                     "interface Vlan1", " ip address 16.0.0.5 255.0.0.0", "interface Vlan5", " ip address 172.16.0.5 255.255.0.0",
                                     "line vty 0 4", " password x", " login"], true);
    assert.deepStrictEqual(Array.from(q.comandos), [
        "no ip default-gateway", "no spanning-tree vlan 1 priority",
        "interface FastEthernet0/1", " no description", " no switchport trunk native vlan", " no switchport trunk allowed vlan", " no switchport nonegotiate", " no duplex", " no speed", " no shutdown", " no switchport mode",
        "interface FastEthernet0/3", " no channel-group", " no shutdown", " no switchport mode",
        "interface Vlan1", " no ip address",
        "no interface Port-channel1", "no interface Vlan5"]);
    const quedan = Array.from(q.limpias);
    ["enable secret 5 abc", "banner motd #hola#", "line vty 0 4", " password x", "hostname Switch"].forEach((l) => assert.ok(quedan.includes(l), l));
});

prueba("del router y del multicapa se borra todo lo de red", () => {
    const q = llama("quitarConfig", ["no service dhcp", "hostname R1", "ip dhcp excluded-address 1.1.1.1", "ip dhcp pool P1", " network 1.1.1.0 255.255.255.0", "ip routing",
                                     "interface FastEthernet0/0", " ip address 16.0.0.1 255.255.255.252", " ip nat inside", " ipv6 address ABCD::1/127", " ip access-group 1 in", " duplex auto", " shutdown",
                                     "interface FastEthernet0/1", " no switchport", " ip address 16.0.0.5 255.255.255.252",
                                     "interface FastEthernet0/1.3", " encapsulation dot1Q 3", "interface Loopback0", " ip address 1.1.1.1 255.255.255.255", "interface Tunnel0",
                                     "router ospf 1", " network 16.0.0.0 0.255.255.255 area 0", "router rip", "ip route 8.8.8.0 255.255.255.0 16.0.0.2", "ipv6 route ABCD:2::/64 ABCD::2",
                                     "access-list 1 permit any", "access-list 1 deny any", "ip access-list standard AA", " permit any", "ip nat inside source list 1 interface FastEthernet0/0 overload"], false);
    assert.deepStrictEqual(Array.from(q.comandos), [
        "service dhcp", "no ip dhcp excluded-address 1.1.1.1", "no ip dhcp pool P1", "no ip routing", "no router ospf 1", "no router rip", "no ip route 8.8.8.0 255.255.255.0 16.0.0.2", "no ipv6 route ABCD:2::/64 ABCD::2",
        "no access-list 1", "no ip access-list standard AA", "no ip nat inside source list 1 interface FastEthernet0/0 overload",
        "interface FastEthernet0/0", " no ip address", " no ip nat inside", " no ipv6 address ABCD::1/127", " no ip access-group 1 in",
        "interface FastEthernet0/1", " no ip address", " switchport",
        "no interface FastEthernet0/1.3", "no interface Loopback0", "no interface Tunnel0"]);
    assert.ok(Array.from(q.limpias).includes(" shutdown"), "un puerto de router viene apagado");
});

prueba("con más de la mitad mal se borran todos; con la mitad justa, sólo los que están mal", () => {
    const mal = ["hostname Switch", "interface FastEthernet0/3", " shutdown"];
    const dos = analizar(practica(N1, N2, { cfgS1: mal, cfgS2: mal }));     // 2 de 4
    assert.strictEqual(dos.borraTodos, null);
    assert.deepStrictEqual(Object.keys(dos.borrar).sort(), ["Switch0", "Switch1"]);
    assert.ok(!llama("textoProblemas", dos).includes("se rehacen todos"));
    const r1Mal = ["hostname R1", "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.4.1 255.255.252.0"];
    const tres = analizar(practica(N1, N2, { cfgR1: r1Mal, cfgS1: mal, cfgS2: mal }));
    assert.strictEqual(tres.borraTodos, "3 de 4");
    assert.deepStrictEqual(Object.keys(tres.borrar).sort(), ["Router0", "Router1", "Switch0", "Switch1"]);
    assert.ok(llama("textoProblemas", tres).includes("se rehacen todos los equipos: 3 de 4 traen algo mal"), llama("textoProblemas", tres));
});

prueba("borrar todo, a pedido, aunque nada esté mal", () => {
    const cfg = ["hostname R1", "interface FastEthernet0/0", " ip address 11.0.0.5 255.255.255.252", "router ospf 1", " network 11.0.0.0 0.255.255.255 area 0"];
    m.__xml = practica(N1, N2, { cfgR1: cfg });
    const c = vm.runInContext("analizarXml(__xml, { borrarTodo: true })", m);
    assert.strictEqual(c.borraTodos, null, "no se reporta como que estaba mal");
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
    assert.deepStrictEqual(Object.keys(c.borrar).sort(), ["Router0", "Router1", "Switch0", "Switch1"]);
    const r1 = bloqueDe(c, "Router0");
    assert.ok(r1.includes("no router ospf 1"), r1.join("|"));
    assert.ok(r1.includes(" ip address 11.0.0.5 255.255.255.252"), "el enlace vuelve: " + r1.join("|"));
    assert.ok(llama("textoProblemas", c).indexOf("se rehace") < 0);
    const sin = analizar(practica(N1, N2, { cfgR1: cfg }));
    assert.strictEqual(Object.keys(sin.borrar).length, 0, "sin pedirlo, lo de más se queda");
});

prueba("al borrar un switch también se van las VLANs que su red no lleva", () => {
    const xml = practica(N1, N2, { cfgS1: ["hostname Switch", "interface FastEthernet0/3", " shutdown"] })
        .replace("</RUNNINGCONFIG><SAVE_REF_ID>s1", "</RUNNINGCONFIG><VLANS><VLAN number=\"1\" name=\"default\"/><VLAN number=\"2\" name=\"DOS\"/><VLAN number=\"99\" name=\"SOBRA\"/></VLANS><SAVE_REF_ID>s1");
    const c = analizar(xml);
    assert.ok(c.borrar.Switch0.includes("no vlan 99"), Array.from(c.borrar.Switch0).join("|"));
    assert.ok(!c.borrar.Switch0.includes("no vlan 2"));
});

prueba("una PC cuyo puerto está en una VLAN que ninguna nota dice se reparte; la que otra nota dice se respeta", () => {
    const s1 = ["hostname Switch", "interface FastEthernet0/1", "interface FastEthernet0/2", " switchport mode access", " switchport access vlan 9",
                "interface FastEthernet0/3", "interface FastEthernet0/4"];
    const c = analizar(practica(N1, N2, { cfgS1: s1 }));
    const pc1 = Array.from(c.pcs).find((p) => p.pc === "PC1");
    assert.ok(pc1.vlan === 2 || pc1.vlan === 3, "PC1 en la " + pc1.vlan);
    assert.ok(motivosDe(c, "Switch0").includes("fastethernet0/2".replace("fastethernet", "FastEthernet")), JSON.stringify(c.motivos));
    assert.ok(!c.plan.errores.some((e) => e[1].includes("PC1")), JSON.stringify(c.plan.errores));
    // V5 es de R2: puede llegar por otro cable, como lo inalámbrico. Se dice y no se toca.
    const n2 = N2 + "\nVLAN 5/28\n11.0.0.48 - 11.0.0.62 - 255.255.255.240";
    const otra = analizar(practica(N1, n2, { cfgS1: s1.join("\n").replace("vlan 9", "vlan 5").split("\n") }));
    assert.strictEqual(Array.from(otra.pcs).find((p) => p.pc === "PC1").vlan, 5);
    assert.strictEqual(motivosDe(otra, "Switch0"), "");
    assert.ok(otra.plan.errores.some((e) => e[1].includes("PC1 va en la VLAN 5")), JSON.stringify(otra.plan.errores));
});

prueba("la nota del enlace manda: uno completo y que funciona en otra red se pasa a su nota", () => {
    const r2 = R4T.concat(["hostname R2", "interface FastEthernet0/1", " ip address 16.0.0.201 255.255.255.252"]);
    const r3 = R4T.concat(["hostname R3", "interface FastEthernet0/0", " ip address 16.0.0.202 255.255.255.252"]);
    const c = analizar(cuatroRouters(COMO_P4, undefined, { R2: r2, R3: r3 }));
    assert.ok(motivosDe(c, "R2").includes("fastethernet0/1".replace("fastethernet", "FastEthernet") + " tiene 16.0.0.201 255.255.255.252, y le toca 16.0.0.9 255.255.255.252"), JSON.stringify(c.motivos));
    assert.ok(bloqueDe(c, "R2").includes(" ip address 16.0.0.9 255.255.255.252"), bloqueDe(c, "R2").join("|"));
    assert.ok(bloqueDe(c, "R3").includes(" ip address 16.0.0.10 255.255.255.252"), bloqueDe(c, "R3").join("|"));
    // Y las demás notas se siguen creyendo, aunque el único enlace puesto no cuadre con la suya.
    assert.ok(bloqueDe(c, "R1").includes(" ip address 16.0.0.5 255.255.255.252"), bloqueDe(c, "R1").join("|"));
    assert.ok(!llama("textoProblemas", c).includes("el primero libre"), llama("textoProblemas", c));
});

prueba("un solo lado mal se corrige al otro, sin mover lo que ya está en su nota", () => {
    const r2 = R4T.concat(["interface FastEthernet0/1", " ip address 16.0.0.10 255.255.255.252"]);
    const r3 = R4T.concat(["interface FastEthernet0/0", " ip address 16.0.0.57 255.255.255.252"]);
    const c = analizar(cuatroRouters(COMO_P4, undefined, { R2: r2, R3: r3 }));
    assert.strictEqual(motivosDe(c, "R2"), "", "R2 ya está en la nota, aunque en la otra punta del /30");
    assert.ok(motivosDe(c, "R3").includes("le toca 16.0.0.9 255.255.255.252"), JSON.stringify(c.motivos));
});

prueba("'.4' sólo dice el último número: los primeros son los de los enlaces que ya cuadran", () => {
    const r1 = R4T.concat(["interface FastEthernet0/0", " ip address 16.5.5.5 255.255.255.252"]);
    const r2 = R4T.concat(["interface FastEthernet0/0", " ip address 16.5.5.6 255.255.255.252"]);
    const c = analizar(cuatroRouters(COMO_P4, undefined, { R1: r1, R2: r2 }));
    assert.strictEqual(motivosDe(c, "R1"), "", JSON.stringify(c.motivos));
    assert.ok(bloqueDe(c, "R2").includes(" ip address 16.5.5.9 255.255.255.252"), bloqueDe(c, "R2").join("|"));
});

prueba("una SVI con máscara de más no saca al enlace de su nota", () => {
    const swr2 = ["hostname SWR2", "ip routing", "interface FastEthernet0/1", "interface Vlan4", " ip address 16.0.2.254 255.254.0.0"];
    const c = analizar(cuatroRouters(COMO_P4, undefined, { SWR2: swr2 }));
    assert.ok(motivosDe(c, "SWR2").includes("Vlan4 tiene 16.0.2.254 255.254.0.0, y le toca 16.0.2.254 255.255.255.0"), JSON.stringify(c.motivos));
    assert.ok(bloqueDe(c, "SWR2").includes("no interface Vlan4"), bloqueDe(c, "SWR2").join("|"));
    assert.ok(bloqueDe(c, "SWR2").includes(" ip address 16.0.0.22 255.255.255.252"), bloqueDe(c, "SWR2").join("|"));
    assert.ok(bloqueDe(c, "R3").includes(" ip address 16.0.0.21 255.255.255.252"), bloqueDe(c, "R3").join("|"));
    assert.strictEqual(motivosDe(c, "R3"), "");
});

prueba("una nota se queda con el cable que ya está en su red, aunque quede más cerca del otro", () => {
    const cfg = (n, i) => ["hostname " + n].concat(i);
    const devs = equipo("a", "R1", "Router", "2811", 100, 100, cfg("R1", ["interface FastEthernet0/0", " ip address 16.0.0.5 255.255.255.252"]))
        + equipo("b", "R2", "Router", "2811", 300, 100, cfg("R2", ["interface FastEthernet0/0", " ip address 16.0.0.6 255.255.255.252", "interface FastEthernet0/1", " ip address 16.0.0.9 255.255.255.252"]))
        + equipo("c", "R3", "Router", "2811", 500, 100, cfg("R3", ["interface FastEthernet0/0", " ip address 16.0.0.10 255.255.255.252"]));
    const xml = `<X><DEVICES>${devs}</DEVICES>${cable("a", "FastEthernet0/0", "b", "FastEthernet0/0")}${cable("b", "FastEthernet0/1", "c", "FastEthernet0/0")}
<NOTES>${nota("{1}", 290, 100, ".8")}${nota("{2}", 310, 100, ".4")}</NOTES></X>`;
    const c = analizar(xml);
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
    assert.strictEqual(c.correcciones.avisos.length, 0, Array.from(c.correcciones.avisos).join("|"));
});

prueba("un puerto suelto encima de un combo no le gana a lo que escribiste", () => {
    const r2 = R4T.concat(["hostname R2", "interface Ethernet0/3/0", " ip address 16.0.1.1 255.255.255.0"]);
    const c = analizar(cuatroRouters(COMO_P4, undefined, { R2: r2 }));
    assert.strictEqual(c.combos.malos, 0, llama("textoProblemas", c));
    assert.deepStrictEqual(redesDe(c, "R2"), ["2 16.0.128.0/17", "3 16.0.8.0/22", "4 16.0.1.0/24"]);
    assert.ok(c.borrar.R2, JSON.stringify(c.motivos));
    assert.ok(bloqueDe(c, "R2").includes(" no ip address"), bloqueDe(c, "R2").join("|"));
});

prueba("un canal sin troncal se borra; uno con su troncal, no", () => {
    const devs = [equipo("r", "R1", "Router", "2811", 100, 100, ROUTER),
                  equipo("s", "S1", "Switch", "2960-24TT", 100, 300, ["hostname S1", "interface FastEthernet0/1", " switchport mode trunk", "interface FastEthernet0/2", " channel-group 1 mode active", "interface FastEthernet0/3", " channel-group 1 mode active"]),
                  equipo("t", "S2", "Switch", "2960-24TT", 100, 500, ["hostname S2", "interface FastEthernet0/1", " switchport mode trunk", " channel-group 1 mode passive", "interface FastEthernet0/2", " switchport mode trunk", " channel-group 1 mode passive"]),
                  equipo("u", "S3", "Switch", "2960-24TT", 300, 500, ["hostname S3"]),
                  equipo("p", "PC1", "Pc", "PC-PT", 100, 700)].join("");
    const xml = `<X><DEVICES>${devs}</DEVICES>${cable("r", "FastEthernet0/1", "s", "FastEthernet0/1")}${cable("s", "FastEthernet0/2", "t", "FastEthernet0/1")}${cable("s", "FastEthernet0/3", "t", "FastEthernet0/2")}
${cable("t", "FastEthernet0/3", "p", "FastEthernet0")}<NOTES>${nota("{n}", 50, 50, "R1 10.0.0.0\nVLAN 3/24")}</NOTES></X>`;
    const c = analizar(xml);
    assert.ok(motivosDe(c, "S1").includes("está en un canal sin ser troncal"), JSON.stringify(c.motivos));
    assert.strictEqual(motivosDe(c, "S2"), "", JSON.stringify(c.motivos));
    const s1 = bloqueDe(c, "S1");
    assert.ok(s1.indexOf(" no channel-group") >= 0 && s1.indexOf(" channel-group 1 mode active") > s1.indexOf(" no channel-group"), s1.join("|"));
});

// --- lo inalámbrico ---------------------------------------------------------------------------------

function puertoWlc(nombre, ip, mascara, mac, manager) {
    const dir = ip ? `<IP>${ip}</IP><SUBNET>${mascara}</SUBNET>` : "<IP/><SUBNET/>";
    return `<PORT><MACADDRESS>${mac}</MACADDRESS><BIA>${mac}</BIA><UP_METHOD>5</UP_METHOD>${dir}<PORT_GATEWAY/><PORT_DHCP_ENABLE>false</PORT_DHCP_ENABLE>`
        + `<IPV6_DEFAULT_LINK_LOCAL>FE80::2D0:97FF:FE76:235C</IPV6_DEFAULT_LINK_LOCAL><DHCP_SERVER_IP>0.0.0.0</DHCP_SERVER_IP><NAME>${nombre}</NAME><VLAN_NUMBER>0</VLAN_NUMBER>`
        + `<PHYSICAL_PORT_NUMBER>${manager ? 1 : 0}</PHYSICAL_PORT_NUMBER><DYNAMIC_AP_MANAGER_ENABLED>${manager}</DYNAMIC_AP_MANAGER_ENABLED></PORT>`;
}
// Como sale de la caja.
const WLC_FABRICA = "<SYS_NAME>WLC</SYS_NAME><HOSTNAME>WLC</HOSTNAME><MANAGEMENT_INTERFACE><PORT><MACADDRESS>00D0.BCEB.30B3</MACADDRESS><UP_METHOD>5</UP_METHOD><IP>192.168.1.1</IP><SUBNET>255.255.255.240</SUBNET><PORT_GATEWAY/></PORT></MANAGEMENT_INTERFACE>"
    + "<WLC_INTERFACES>" + puertoWlc("management", "192.168.1.1", "255.255.255.240", "00D0.9776.235C", true) + puertoWlc("virtual", "", "", "0060.5C5E.7774", false) + "</WLC_INTERFACES>"
    + "<CAPWAP_AC><PRIMARY_AC>0.0.0.0</PRIMARY_AC><WLANS/><AP_GROUPS><AP_GROUP><NAME>default-group</NAME><DESCRIPTION/><WLANS/></AP_GROUP></AP_GROUPS><APS/><RADIUS_SERVERS/><LOCAL_USERS/><TIMEZONE/></CAPWAP_AC><IN_SETUP_MODE>true</IN_SETUP_MODE>";
const AP_FABRICA = (mac) => `<MODULE><PORT><MACADDRESS>${mac}</MACADDRESS></PORT></MODULE><CAPWAP><PRIMARY_AC>0.0.0.0</PRIMARY_AC><WLANS/></CAPWAP>`;
const SRV_FABRICA = "<MODULE><PORT><UP_METHOD>5</UP_METHOD><IP/><SUBNET/><PORT_GATEWAY/><PORT_DHCP_ENABLE>false</PORT_DHCP_ENABLE></PORT></MODULE><GATEWAY/><GATEWAYV6/><ACS_SERVER><ENABLED>0</ENABLED><USERS/><ACS_CLIENTS/><RADIUS_SETTINGS><AUTH_PORT>1645</AUTH_PORT></RADIUS_SETTINGS></ACS_SERVER>";
const TEL_FABRICA = "<WIRELESS_CLIENT><WIRELESS_COMMON><NETWORK_MODE>7</NETWORK_MODE><SSID>Default</SSID><ENCRYPT_TYPE>0</ENCRYPT_TYPE><AUTHEN_TYPE>0</AUTHEN_TYPE><STANDARD_CHANNEL5G>112</STANDARD_CHANNEL5G></WIRELESS_COMMON>"
    + "<PROFILES><WIRELESS_PROFILE><NAME>Default</NAME><SSID>Default</SSID><AUTHEN_TYPE>0</AUTHEN_TYPE><ENCRYPT_TYPE>0</ENCRYPT_TYPE><WPA_EAP_USERID></WPA_EAP_USERID><WPA_EAP_PASSWORD></WPA_EAP_PASSWORD><DHCP_ENABLED>1</DHCP_ENABLED></WIRELESS_PROFILE></PROFILES>"
    + "<CURRENT_PROFILE><WIRELESS_PROFILE><NAME>Default</NAME><SSID>Default</SSID><AUTHEN_TYPE>0</AUTHEN_TYPE><ENCRYPT_TYPE>0</ENCRYPT_TYPE><WPA_EAP_USERID></WPA_EAP_USERID><WPA_EAP_PASSWORD></WPA_EAP_PASSWORD><DHCP_ENABLED>1</DHCP_ENABLED></WIRELESS_PROFILE></CURRENT_PROFILE></WIRELESS_CLIENT>";

const NOMBRES_WIFI = "VLAN 2/24\nALUMNOS\n\nVLAN 3/24\nDOCENTES\n\nVLAN 6/28\nNATIVA";
const R1_WIFI = "R1\n\nVLAN 6/28\n\t16.0.0.16\t-\t16.0.0.30\t-\t255.255.255.240";
const SWR1_WIFI = "SWR1\n\nVLAN 2/24\n\t16.0.1.0\t-\t16.0.1.254\t-\t255.255.255.0\n\nVLAN 3/24\n\t16.0.2.0\t-\t16.0.2.254\t-\t255.255.255.0";

// Como P4_P3: el router llega al multicapa con dos cables, uno de enlace y otro para la nativa; los AP
// cuelgan de un switch y la controladora y su PC, del multicapa.
function wifi(opciones = {}) {
    const notas = opciones.notas || [R1_WIFI, SWR1_WIFI, NOMBRES_WIFI, "AP1\nALUMNOS\nDOCENTES", "AP2\nALUMNOS\nDOCENTES"];
    const cfg = opciones.cfg || {};
    const devs = [
        equipo("r1", "R1", "Router", "2811", 1000, 500, cfg.R1 || ROUTER), equipo("r2", "R2", "Router", "2811", 1500, 500, cfg.R2 || ROUTER),
        equipo("m1", "SWR1", "MultiLayerSwitch", "3560-24PS", 1000, 800, cfg.SWR1 || ["hostname Switch"]),
        equipo("s1", "S1", "Switch", "2960-24TT", 800, 1000, cfg.S1 || SWITCH),
        equipo("a1", "AP1", "LightWeightAccessPoint", "3702i", 700, 1200, [], AP_FABRICA("0002.4AED.ED86")),
        equipo("a2", "AP2", "LightWeightAccessPoint", "3702i", 900, 1200, [], AP_FABRICA("0060.2FCE.E147")),
        equipo("w1", "WLC0", "WirelessLanController", "WLC-3504", 1300, 800, [], WLC_FABRICA),
        equipo("pc", "PC0", "Pc", "PC-PT", 1200, 900), equipo("pl", "PC1", "Pc", "PC-PT", 800, 1200),
        equipo("sv", "Server0", "Server", "Server-PT", 1200, 300, [], opciones.srv || SRV_FABRICA),
        equipo("t0", "Smartphone0", "Pda", "SMARTPHONE-PT", 650, 1300, [], TEL_FABRICA), equipo("t1", "Smartphone1", "Pda", "SMARTPHONE-PT", 950, 1300, [], TEL_FABRICA),
    ].join("");
    const cables = [
        cable("r1", "FastEthernet0/0", "r2", "FastEthernet0/0"), cable("r1", "Ethernet0/1/0", "m1", "FastEthernet0/1"), cable("r1", "Ethernet0/3/0", "m1", "FastEthernet0/3"),
        opciones.serverEn ? cable(opciones.serverEn[0], opciones.serverEn[1], "sv", "FastEthernet0") : cable("r1", "Ethernet0/2/0", "sv", "FastEthernet0"),
        cable("m1", "FastEthernet0/2", "s1", "FastEthernet0/1"), cable("m1", "FastEthernet0/4", "w1", "GigabitEthernet1"),
        cable("m1", "FastEthernet0/5", "pc", "FastEthernet0"), cable("s1", "FastEthernet0/2", "a1", "GigabitEthernet0"), cable("s1", "FastEthernet0/3", "a2", "GigabitEthernet0"),
        cable("s1", "FastEthernet0/4", "pl", "FastEthernet0"),
    ].join("");
    const textos = [nota("{e1}", 1250, 500, ".8"), nota("{e2}", 1000, 650, ".4")];
    notas.forEach((n, i) => textos.push(nota("{n" + i + "}", 100 + 300 * i, 2000, n)));
    return `<X><DEVICES>${devs}</DEVICES>${cables}<NOTES>${textos.join("")}</NOTES></X>`;
}

const lineasDe = (b, cab) => {
    const i = b.indexOf(cab);
    const fin = b.findIndex((l, k) => k > i && l[0] !== " ");
    return i < 0 ? [] : b.slice(i + 1, fin < 0 ? b.length : fin);
};

prueba("la lista de nombres no es la nota de nadie, y los nombres le llegan a todos", () => {
    const c = analizar(wifi());
    assert.strictEqual(c.plan.errores.length, 0, JSON.stringify(c.plan.errores));
    assert.ok(!llama("textoProblemas", c).includes("por cercanía"), llama("textoProblemas", c));
    const swr1 = bloqueDe(c, "SWR1");
    assert.deepStrictEqual(lineasDe(swr1, "vlan 2"), [" name ALUMNOS"]);
    assert.deepStrictEqual(lineasDe(swr1, "vlan 6"), [" name NATIVA"], "el multicapa conoce la nativa, aunque sea del router");
    assert.ok(swr1.includes("ip dhcp pool VLANALUMNOS"), swr1.join("|"));
});

prueba("el segundo cable del router al multicapa no lleva ip: es la troncal de la nativa", () => {
    const c = analizar(wifi());
    const r1 = bloqueDe(c, "R1");
    assert.deepStrictEqual(lineasDe(r1, "interface Ethernet0/3/0"), [" no shutdown"], r1.join("|"));
    assert.deepStrictEqual(lineasDe(r1, "interface Ethernet0/3/0.6"), [" encapsulation dot1Q 6 native", " ip address 16.0.0.30 255.255.255.240"]);
    assert.deepStrictEqual(lineasDe(r1, "ip dhcp pool VLANNATIVA"), [" network 16.0.0.16 255.255.255.240", " default-router 16.0.0.30"]);
    assert.deepStrictEqual(lineasDe(r1, "interface Ethernet0/1/0"), [" ip address 16.0.0.5 255.255.255.252", " no shutdown"], "el otro cable es el enlace de la nota");
    const m = bloqueDe(c, "SWR1");
    const troncal = [" switchport trunk encapsulation dot1q", " switchport mode trunk", " switchport trunk native vlan 6", " no shutdown"];
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/3"), troncal, m.join("|"));
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/4"), troncal, "el de la controladora");
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/2"), troncal, "el del switch");
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/1"), [" no switchport", " ip address 16.0.0.6 255.255.255.252", " no shutdown"]);
    assert.ok(!m.includes("interface Vlan6"), "la nativa es del router");
});

prueba("los AP van en troncal con la nativa, y la PC de la controladora va en la nativa", () => {
    const c = analizar(wifi());
    const s1 = bloqueDe(c, "S1");
    const troncal = [" switchport mode trunk", " switchport trunk native vlan 6", " no shutdown"];
    ["FastEthernet0/1", "FastEthernet0/2", "FastEthernet0/3"].forEach((n) => assert.deepStrictEqual(lineasDe(s1, "interface " + n), troncal, s1.join("|")));
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "SWR1"), "interface FastEthernet0/5"), [" switchport mode access", " switchport access vlan 6"]);
    const pc = Array.from(c.pcs).find((p) => p.pc === "PC0");
    assert.strictEqual(pc.vlan, 6);
    assert.strictEqual(pc.gateway, "16.0.0.30");
    assert.strictEqual(pc.reservado, false);
    assert.notStrictEqual(Array.from(c.pcs).find((p) => p.pc === "PC1").vlan, 6, "la que cuelga de otro switch no");
});

prueba("el server lleva su red 192.168 en el router, y todos llegan a ella", () => {
    const c = analizar(wifi());
    const r1 = bloqueDe(c, "R1");
    assert.deepStrictEqual(lineasDe(r1, "interface Ethernet0/2/0"), [" ip address 192.168.1.254 255.255.255.0", " no shutdown"], r1.join("|"));
    assert.ok(bloqueDe(c, "R2").includes("ip route 192.168.1.0 255.255.255.0 16.0.0.9"), bloqueDe(c, "R2").join("|"));
    const s = c.inalambrico.servidores[0];
    assert.deepStrictEqual([s.equipo, s.ip, s.mascara, s.gw, s.puerto], ["Server0", "192.168.1.1", "255.255.255.0", "192.168.1.254", 1812]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.clientes)), [{ ip: "16.0.0.29", clave: "majli", nombre: "majli", tipo: "RADIUS" }], "su cliente es la penúltima del combo");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.usuarios)), [{ nombre: "majli", clave: "majli" }]);
});

prueba("la red del server que ya está puesta se respeta", () => {
    const r1 = ROUTER.concat(["interface Ethernet0/2/0", " ip address 192.168.7.254 255.255.255.0"]);
    const c = analizar(wifi({ cfg: { R1: r1 } }));
    assert.strictEqual(c.inalambrico.servidores[0].ip, "192.168.7.1");
    assert.strictEqual(c.inalambrico.servidores[0].gw, "192.168.7.254");
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

const EN_CORE = ["m1", "FastEthernet0/6"];

prueba("el server directo al core multicapa: su mismo puerto es su puerta, y todos llegan a su red", () => {
    const c = analizar(wifi({ serverEn: EN_CORE }));
    const m = bloqueDe(c, "SWR1");
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"], m.join("|"));
    assert.ok(bloqueDe(c, "R1").includes("ip route 192.168.1.0 255.255.255.0 16.0.0.6"), bloqueDe(c, "R1").join("|"));
    assert.ok(m.includes("ip route 16.0.0.16 255.255.255.240 16.0.0.5"), "el core llega a la controladora por el router: " + m.join("|"));
    const s = c.inalambrico.servidores[0];
    assert.deepStrictEqual([s.equipo, s.ip, s.mascara, s.gw, s.puerto, s.router, s.puertoRouter], ["Server0", "192.168.1.1", "255.255.255.0", "192.168.1.254", 1812, "SWR1", "FastEthernet0/6"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.clientes)), [{ ip: "16.0.0.29", clave: "majli", nombre: "majli", tipo: "RADIUS" }]);
    const w = c.inalambrico.controladoras[0];
    assert.strictEqual(w.radius[0].ip, "192.168.1.1");
    assert.deepStrictEqual([w.ip, w.gw], ["16.0.0.29", "16.0.0.30"], "la controladora sigue en la nativa del router");
    assert.ok(!Array.from(c.pcs).some((p) => p.pc === "Server0"), "no es una pc más");
    assert.strictEqual(Array.from(c.pcs).find((p) => p.pc === "PC0").vlan, 6, "la PC de la controladora sigue en la nativa");
    assert.strictEqual(c.inalambrico.avisos.length, 0, Array.from(c.inalambrico.avisos).join("|"));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("el server en el core respeta la red que ya trae, y lo ya tecleado no se repite", () => {
    const srv = SRV_FABRICA.replace("<IP/><SUBNET/><PORT_GATEWAY/>", "<IP>192.168.7.1</IP><SUBNET>255.255.255.0</SUBNET><PORT_GATEWAY>192.168.7.254</PORT_GATEWAY>");
    const c = analizar(wifi({ serverEn: EN_CORE, srv }));
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "SWR1"), "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.7.254 255.255.255.0", " no shutdown"]);
    const m = ["hostname SWR1", "ip routing", "interface FastEthernet0/6", " no switchport", " ip address 192.168.7.254 255.255.255.0"];
    const ya = analizar(wifi({ serverEn: EN_CORE, cfg: { SWR1: m } }));
    assert.strictEqual(ya.inalambrico.servidores[0].gw, "192.168.7.254");
    assert.deepStrictEqual(lineasDe(bloqueDe(ya, "SWR1"), "interface FastEthernet0/6"), [], "ya está");
    assert.strictEqual(Object.keys(ya.motivos).length, 0, JSON.stringify(ya.motivos));
});

prueba("el server siempre va en 192.168: si su puerto trae otra red, se cambia", () => {
    const srv = SRV_FABRICA.replace("<IP/><SUBNET/><PORT_GATEWAY/>", "<IP>40.0.0.1</IP><SUBNET>255.255.255.0</SUBNET><PORT_GATEWAY>40.0.0.254</PORT_GATEWAY>");
    const m = ["hostname SWR1", "ip routing", "interface FastEthernet0/6", " no switchport", " ip address 40.0.0.254 255.255.255.0"];
    const c = analizar(wifi({ serverEn: EN_CORE, srv, cfg: { SWR1: m } }));
    const s = c.inalambrico.servidores[0];
    assert.deepStrictEqual([s.ip, s.mascara, s.gw], ["192.168.1.1", "255.255.255.0", "192.168.1.254"]);
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "SWR1"), "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    assert.ok(bloqueDe(c, "R1").includes("ip route 192.168.1.0 255.255.255.0 16.0.0.6"), bloqueDe(c, "R1").join("|"));
    assert.strictEqual(c.inalambrico.controladoras[0].radius[0].ip, "192.168.1.1");
    const r1 = ROUTER.concat(["interface Ethernet0/2/0", " ip address 40.0.0.254 255.255.255.0"]);
    const enRouter = analizar(wifi({ cfg: { R1: r1 } }));
    assert.strictEqual(enRouter.inalambrico.servidores[0].gw, "192.168.1.254", "lo mismo si sigue cableado al router");
    assert.deepStrictEqual(lineasDe(bloqueDe(enRouter, "R1"), "interface Ethernet0/2/0"), [" ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
});

prueba("si la puerta del server es la .1, el server no repite su IP", () => {
    const m = ["hostname SWR1", "ip routing", "interface FastEthernet0/6", " no switchport", " ip address 192.168.7.1 255.255.255.0"];
    const vacio = analizar(wifi({ serverEn: EN_CORE, cfg: { SWR1: m } })).inalambrico.servidores[0];
    assert.deepStrictEqual([vacio.ip, vacio.gw], ["192.168.7.2", "192.168.7.1"], "el server sin IP");
    const srv = SRV_FABRICA.replace("<IP/><SUBNET/><PORT_GATEWAY/>", "<IP>192.168.7.1</IP><SUBNET>255.255.255.0</SUBNET><PORT_GATEWAY>192.168.7.254</PORT_GATEWAY>");
    const igual = analizar(wifi({ serverEn: EN_CORE, srv, cfg: { SWR1: m } })).inalambrico.servidores[0];
    assert.deepStrictEqual([igual.ip, igual.gw], ["192.168.7.2", "192.168.7.1"], "el server con la misma IP que su puerta");
    const srv5 = srv.replace("<IP>192.168.7.1</IP>", "<IP>192.168.7.5</IP>");
    const suya = analizar(wifi({ serverEn: EN_CORE, srv: srv5, cfg: { SWR1: m } })).inalambrico.servidores[0];
    assert.deepStrictEqual([suya.ip, suya.gw], ["192.168.7.5", "192.168.7.1"], "la que ya traiga, si no choca, se queda");
});

prueba("al mover el server del router al core, lo que dejó en el router se quita", () => {
    const r1 = ROUTER.concat(["interface Ethernet0/2/0", " ip address 192.168.1.254 255.255.255.0"]);
    const m = ["hostname SWR1", "ip routing", "ip route 192.168.1.0 255.255.255.0 16.0.0.5"];
    const c = analizar(wifi({ serverEn: EN_CORE, cfg: { R1: r1, SWR1: m } }));
    const br = bloqueDe(c, "R1"), bm = bloqueDe(c, "SWR1");
    assert.deepStrictEqual(lineasDe(br, "interface Ethernet0/2/0"), [" no ip address"], br.join("|"));
    assert.ok(br.includes("ip route 192.168.1.0 255.255.255.0 16.0.0.6"), "el router ya no la tiene conectada: " + br.join("|"));
    assert.ok(bm.includes("no ip route 192.168.1.0 255.255.255.0 16.0.0.5"), bm.join("|"));
    assert.deepStrictEqual(lineasDe(bm, "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("borrar todo con el server en el core: su puerto vuelve a capa 2 y se configura de nuevo", () => {
    const m = ["hostname SWR1", "ip routing", "interface FastEthernet0/6", " no switchport", " ip address 192.168.1.254 255.255.255.0"];
    const c = analizar(wifi({ serverEn: EN_CORE, cfg: { SWR1: m } }), { borrarTodo: true });
    const b = bloqueDe(c, "SWR1");
    const i = b.indexOf("interface FastEthernet0/6"), j = b.lastIndexOf("interface FastEthernet0/6");
    assert.ok(i >= 0 && j > i, b.join("|"));
    assert.deepStrictEqual(b.slice(i, i + 3), ["interface FastEthernet0/6", " no ip address", " switchport"]);
    assert.deepStrictEqual(b.slice(j + 1, j + 4), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    assert.strictEqual(b.filter((l) => l === " ip address 192.168.1.254 255.255.255.0").length, 1, "una sola vez");
});

prueba("con la nativa en la nota del propio core, el server en el core también funciona", () => {
    const notas = ["SWR1\n\nVLAN 2/24\n\t16.0.1.0\t-\t16.0.1.254\t-\t255.255.255.0\n\nVLAN 3/24\n\t16.0.2.0\t-\t16.0.2.254\t-\t255.255.255.0\n\nVLAN 6/28\n\t16.0.0.16\t-\t16.0.0.30\t-\t255.255.255.240", NOMBRES_WIFI];
    const c = analizar(wifi({ serverEn: EN_CORE, notas }));
    const m = bloqueDe(c, "SWR1");
    assert.deepStrictEqual(lineasDe(m, "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"], m.join("|"));
    assert.ok(m.includes("interface Vlan6"), m.join("|"));
    assert.strictEqual(c.inalambrico.controladoras[0].gw, "16.0.0.30");
    assert.strictEqual(c.inalambrico.controladoras[0].radius[0].ip, "192.168.1.1");
    assert.strictEqual(c.inalambrico.avisos.filter((a) => a.includes("radius")).length, 0, Array.from(c.inalambrico.avisos).join("|"));
});

prueba("un server colgado de un switch de abajo, con core multicapa, no es el de radius y se avisa", () => {
    const c = analizar(wifi({ serverEn: ["s1", "FastEthernet0/9"] }));
    assert.strictEqual(c.inalambrico.servidores.length, 0);
    assert.ok(c.inalambrico.avisos.some((a) => a.includes("no hay un server cableado a su core")), Array.from(c.inalambrico.avisos).join("|"));
    assert.ok(Array.from(c.pcs).some((p) => p.pc === "Server0"), "sigue siendo un host");
});

prueba("sin controladora, un server en el core sigue siendo un host como cualquiera", () => {
    const xml = wifi({ serverEn: EN_CORE }).replace("<TYPE model=\"WLC-3504\">WirelessLanController</TYPE>", "<TYPE model=\"PC-PT\">Pc</TYPE>");
    const c = analizar(xml);
    assert.ok(Array.from(c.pcs).some((p) => p.pc === "Server0"));
    assert.ok(!bloqueDe(c, "SWR1").includes(" no switchport") || lineasDe(bloqueDe(c, "SWR1"), "interface FastEthernet0/6").every((l) => l !== " no switchport"));
});

// Como P3_P3: el router y un 3650 que sólo hace de switch.
function wifiCapa2(cfg = {}, extra = "", enRouter = false) {
    const devs = [equipo("r", "R1", "Router", "2811", 100, 100, cfg.R1 || ROUTER), equipo("m", "SW", "MultiLayerSwitch", "3650-24PS", 100, 300, cfg.SW || ["hostname Switch"]),
                  equipo("w", "WLC0", "WirelessLanController", "WLC-3504", 300, 300, [], WLC_FABRICA), equipo("a", "AP1", "LightWeightAccessPoint", "3702i", 100, 500, [], AP_FABRICA("0002.4AED.ED86")),
                  equipo("v", "Server0", "Server", "Server-PT", 300, 100, [], SRV_FABRICA), equipo("p", "PC0", "Pc", "PC-PT", 300, 500)].join("");
    const cs = cable("r", "FastEthernet0/0", "m", "GigabitEthernet1/0/1") + cable("m", "GigabitEthernet1/0/2", "w", "GigabitEthernet1") + cable("m", "GigabitEthernet1/0/3", "a", "GigabitEthernet0")
        + cable("m", "GigabitEthernet1/0/5", "p", "FastEthernet0") + (enRouter ? cable("r", "FastEthernet0/1", "v", "FastEthernet0") : cable("m", "GigabitEthernet1/0/6", "v", "FastEthernet0"));
    return `<X><DEVICES>${devs}</DEVICES>${cs}<NOTES>${nota("{n}", 50, 50, "R1\nVLAN 10 10.0.0.0/24 NATIVA\nVLAN 20 20.0.0.0/24 ALUMNOS\nVLAN 30 30.0.0.0/24 ADMINISTRATIVOS" + extra)}</NOTES></X>`;
}

prueba("el server en un core de capa 2 va en una vlan propia, con su puerta en el router", () => {
    const c = analizar(wifiCapa2());
    const r = bloqueDe(c, "R1"), m = bloqueDe(c, "SW");
    assert.deepStrictEqual(lineasDe(r, "interface FastEthernet0/0.192"), [" encapsulation dot1Q 192", " ip address 192.168.1.254 255.255.255.0", " no shutdown"], r.join("|"));
    assert.ok(!r.includes("ip dhcp pool VLAN192") && !r.includes("ip dhcp pool VLANSERVIDOR"), "no reparte direcciones");
    assert.deepStrictEqual(lineasDe(m, "vlan 192"), [" name SERVIDOR"], m.join("|"));
    assert.deepStrictEqual(lineasDe(m, "interface GigabitEthernet1/0/6"), [" switchport mode access", " switchport access vlan 192", " no shutdown"]);
    assert.ok(!m.includes("ip routing"), "el 3650 sigue siendo sólo switch");
    assert.ok(!m.includes(" no switchport"), m.join("|"));
    const s = c.inalambrico.servidores[0];
    assert.deepStrictEqual([s.ip, s.gw, s.vlan], ["192.168.1.1", "192.168.1.254", 192]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.clientes)).map((x) => x.ip), ["10.0.0.253"]);
    assert.ok(!Array.from(c.pcs).some((p) => p.pc === "Server0"));
    assert.ok(c.inalambrico.supuestos.some((x) => x.includes("vlan 192")), Array.from(c.inalambrico.supuestos).join("|"));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("lo ya puesto de esa vlan no se repite ni se ve como algo que sobra", () => {
    const r1 = ["hostname R1", "interface FastEthernet0/0", " no shutdown", "interface FastEthernet0/0.192", " encapsulation dot1Q 192", " ip address 192.168.1.254 255.255.255.0"];
    const sw = ["hostname SW", "vlan 192", " name SERVIDOR", "interface GigabitEthernet1/0/6", " switchport mode access", " switchport access vlan 192"];
    const c = analizar(wifiCapa2({ R1: r1, SW: sw }));
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "R1"), "interface FastEthernet0/0.192"), [], "ya está");
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "SW"), "interface GigabitEthernet1/0/6"), [], "ya está");
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("si la vlan 192 ya es de tus notas, el server toma la siguiente", () => {
    const c = analizar(wifiCapa2({}, "\nVLAN 192 40.0.0.0/24 OTRA"));
    assert.strictEqual(c.inalambrico.servidores[0].vlan, 193);
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "SW"), "vlan 193"), [" name SERVIDOR"]);
});

prueba("una red 192.168 de tus notas no se le da al server", () => {
    const c = analizar(wifiCapa2({}, "\nVLAN 40 192.168.1.0/24 OTRA"));
    assert.strictEqual(c.inalambrico.servidores[0].ip, "192.168.2.1");
});

prueba("con el server todavía en el router, nada cambia", () => {
    const c = analizar(wifiCapa2({}, "", true));
    assert.deepStrictEqual(lineasDe(bloqueDe(c, "R1"), "interface FastEthernet0/1"), [" ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    assert.strictEqual(c.inalambrico.servidores[0].vlan, null);
    assert.ok(!bloqueDe(c, "SW").includes("vlan 192"));
});

prueba("ALUMNO en la nota de un AP y ALUMNOS en la lista son la misma red, y se dice", () => {
    const c = analizar(wifi({ notas: [R1_WIFI, SWR1_WIFI, NOMBRES_WIFI, "AP1\nALUMNO\nDOCENTE", "AP2\nALUMNOS\nDOCENTE"] }));
    assert.strictEqual(c.inalambrico.avisos.length, 0, Array.from(c.inalambrico.avisos).join("|"));
    const w = c.inalambrico.controladoras[0];
    assert.deepStrictEqual(Array.from(w.wlans).map((x) => x.ssid), ["WLC", "ALUMNOS", "DOCENTES"]);
    assert.strictEqual(w.grupos.length, 1, "los dos dan lo mismo");
    const dichos = Array.from(c.inalambrico.supuestos);
    assert.ok(dichos.includes("la red alumno de la nota de un ap se tomó como alumnos"), dichos.join("|"));
    assert.ok(dichos.includes("la red docente de la nota de un ap se tomó como docentes"), dichos.join("|"));
    assert.strictEqual(dichos.filter((x) => x.includes("docente de la nota")).length, 1, "una sola vez");
});

prueba("un hostname tecleado en el router equivocado se dice en el error", () => {
    const devs = [equipo("r", "Router0", "Router", "2811", 100, 100, ["hostname SWR1", "interface FastEthernet0/0", "interface Ethernet0/3/0"]),
                  equipo("x", "Multilayer Switch2", "MultiLayerSwitch", "3560-24PS", 100, 300, ["hostname Switch"]), equipo("p", "PC0", "Pc", "PC-PT", 100, 500)].join("");
    const cs = cable("r", "Ethernet0/3/0", "x", "FastEthernet0/1") + cable("x", "FastEthernet0/5", "p", "FastEthernet0");
    const c = analizar(`<X><DEVICES>${devs}</DEVICES>${cs}<NOTES>${nota("{e}", 100, 200, ".4")}${nota("{a}", 50, 50, "SWR1\n\nVLAN 2/24\n 15.0.1.0 - 15.0.1.254 - 255.255.255.0")}${nota("{b}", 60, 300, "SWR3\n\nVLAN 2/24\n 15.0.3.0 - 15.0.3.254 - 255.255.255.0")}</NOTES></X>`);
    assert.ok(c.plan.errores.some((e) => e[1].includes("en el lienzo es Router0: revisa que ese hostname sea de este equipo")), JSON.stringify(c.plan.errores));
});

// Como O5_P3: la nativa en la nota del core, y los AP, la controladora, la PC y el server pegados a él.
prueba("todo pegado al core, con la nativa en su nota: su puerta es la SVI y de ahí sale el dhcp", () => {
    const devs = [equipo("r", "Router0", "Router", "2811", 400, 300, ROUTER), equipo("x", "Multilayer Switch2", "MultiLayerSwitch", "3560-24PS", 100, 300, ["hostname Switch"]),
                  equipo("w", "WLC0", "WirelessLanController", "WLC-3504", 0, 300, [], WLC_FABRICA), equipo("a", "Light Weight Access Point0", "LightWeightAccessPoint", "3702i", 100, 500, [], AP_FABRICA("0002.4AED.ED86")),
                  equipo("b", "Light Weight Access Point1", "LightWeightAccessPoint", "3702i", 0, 100, [], AP_FABRICA("0060.2FCE.E147")), equipo("p", "PC0", "Pc", "PC-PT", 0, 500),
                  equipo("v", "Server0", "Server", "Server-PT", 300, 100, [], SRV_FABRICA)].join("");
    const cs = cable("r", "Ethernet0/3/0", "x", "FastEthernet0/1") + cable("a", "GigabitEthernet0", "x", "FastEthernet0/2") + cable("b", "GigabitEthernet0", "x", "FastEthernet0/3")
        + cable("w", "GigabitEthernet1", "x", "FastEthernet0/4") + cable("p", "FastEthernet0", "x", "FastEthernet0/5") + cable("x", "FastEthernet0/6", "v", "FastEthernet0");
    const swr1 = "SWR1 \n\nVLAN 2/24\n 15.0.1.0 - 15.0.1.254 - 255.255.255.0\n\nVLAN 3/14\n 15.4.0.0 - 15.7.255.254 - 255.252.0.0\n\nVLAN 5/28\n 15.0.0.32 - 15.0.0.46 - 255.255.255.240";
    const notas = [swr1, "VLAN 2/24\nALUMNOS\n\nVLAN 3/14 \nDOCENTES\n\nVLAN 5/28\nNATIVA\n ", "AP1\nALUMNO\nDOCENTE", "AP2\nALUMNO\nDOCENTE"].map((n, i) => nota("{" + i + "}", 120 + 200 * i, 350, n)).join("");
    const c = analizar(`<X><DEVICES>${devs}</DEVICES>${cs}<NOTES>${nota("{e}", 250, 300, ".4")}${notas}</NOTES></X>`);
    assert.strictEqual(c.plan.errores.length, 0, JSON.stringify(c.plan.errores));
    const b = bloqueDe(c, "Multilayer Switch2");
    assert.ok(b.includes("hostname SWR1") && b.includes("ip routing"), b.join("|"));
    assert.deepStrictEqual(lineasDe(b, "interface Vlan5"), [" ip address 15.0.0.46 255.255.255.240", " no shutdown"], b.join("|"));
    assert.deepStrictEqual(lineasDe(b, "ip dhcp pool VLANNATIVA"), [" network 15.0.0.32 255.255.255.240", " default-router 15.0.0.46"]);
    assert.deepStrictEqual(lineasDe(b, "interface FastEthernet0/1"), [" no switchport", " ip address 15.0.0.6 255.255.255.252", " no shutdown"]);
    assert.deepStrictEqual(lineasDe(b, "interface FastEthernet0/6"), [" no switchport", " ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    const troncal = [" switchport trunk encapsulation dot1q", " switchport mode trunk", " switchport trunk native vlan 5", " no shutdown"];
    ["2", "3", "4"].forEach((n) => assert.deepStrictEqual(lineasDe(b, "interface FastEthernet0/" + n), troncal, b.join("|")));
    assert.deepStrictEqual(lineasDe(b, "interface FastEthernet0/5"), [" switchport mode access", " switchport access vlan 5"]);
    const w = c.inalambrico.controladoras[0];
    assert.deepStrictEqual([w.ip, w.mascara, w.gw, w.radius[0].ip, w.radius[0].puerto], ["15.0.0.45", "255.255.255.240", "15.0.0.46", "192.168.1.1", 1812]);
    assert.deepStrictEqual(Array.from(w.wlans).map((x) => x.ssid), ["WLC", "ALUMNOS", "DOCENTES"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(c.inalambrico.servidores[0].clientes)).map((x) => x.ip), ["15.0.0.45"]);
    assert.ok(bloqueDe(c, "Router0").includes("ip route 192.168.1.0 255.255.255.0 15.0.0.6"), bloqueDe(c, "Router0").join("|"));
    assert.strictEqual(c.inalambrico.avisos.length, 0, Array.from(c.inalambrico.avisos).join("|"));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
});

prueba("la controladora: su ip es la penúltima de la nativa, y cada vlan de sus AP es una interfaz y una wlan", () => {
    const w = analizar(wifi()).inalambrico.controladoras[0];
    assert.deepStrictEqual([w.equipo, w.hostname, w.ip, w.mascara, w.gw], ["WLC0", "WLC", "16.0.0.29", "255.255.255.240", "16.0.0.30"]);
    const i = Array.from(w.interfaces).find((x) => x.nombre === "ALUMNOS");
    assert.deepStrictEqual([i.ip, i.mascara, i.gw, i.vlan, i.dhcp], ["16.0.1.253", "255.255.255.0", "16.0.1.254", 2, "16.0.1.254"]);
    const e = Array.from(w.wlans).find((x) => x.nombre === "DOCENTES");
    assert.deepStrictEqual([e.ssid, e.authen, e.encrypt, e.radiusIp, e.radiusPuerto, e.radiusClave, e.vlan, e.interfaz], ["DOCENTES", 5, 4, "192.168.1.1", 1812, "majli", 3, "DOCENTES"]);
    assert.ok(Array.from(w.wlans).some((x) => x.nombre === "WLC"), "la red que pide el portal");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.grupos)), [{ nombre: "default-group", wlans: ["ALUMNOS", "DOCENTES"] }], "esa red no la dan los AP");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.usuarios)), [{ id: "admin", clave: "Abc1234" }]);
});

prueba("cada AP da las redes de su nota: si son distintas, va en otro grupo", () => {
    const c = analizar(wifi({ notas: [R1_WIFI, SWR1_WIFI, NOMBRES_WIFI, "AP1\nALUMNOS\n\nAP2\nDOCENTES"] }));
    const w = c.inalambrico.controladoras[0];
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.grupos)), [{ nombre: "default-group", wlans: ["ALUMNOS"] }, { nombre: "GRUPO2", wlans: ["DOCENTES"] }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.aps)), [{ mac: "0002.4AED.ED86", grupo: "default-group" }, { mac: "0060.2FCE.E147", grupo: "GRUPO2" }]);
    assert.deepStrictEqual(Array.from(c.inalambrico.aps.find((a) => a.equipo === "AP2").wlans), ["DOCENTES"]);
});

prueba("sin nota, un AP da todas las redes de su sitio y se dice; una red que no existe se avisa", () => {
    const c = analizar(wifi({ notas: [R1_WIFI, SWR1_WIFI, NOMBRES_WIFI, "AP1\nALUMNOS\nVENTAS"] }));
    assert.ok(c.inalambrico.supuestos.some((s) => s.includes("AP2 no tiene nota")), Array.from(c.inalambrico.supuestos).join("|"));
    assert.ok(llama("textoProblemas", c).includes("ap1: la red ventas de su nota no es una vlan de swr1"), llama("textoProblemas", c));
});

prueba("una nota de AP con otro nombre le toca al AP más cercano", () => {
    const c = analizar(wifi({ notas: [R1_WIFI, SWR1_WIFI, NOMBRES_WIFI, "AP9\nDOCENTES"] }).replace('<X>600</X><Y>2000</Y>', "<X>600</X><Y>2000</Y>"));
    const con = c.inalambrico.aps.filter((a) => a.wlans.length === 1);
    assert.strictEqual(con.length, 1, JSON.stringify(c.inalambrico.supuestos));
});

prueba("la PC con su vlan en el nombre no se mueve a la nativa", () => {
    const xml = wifi().replace('<NAME translate="true">PC0</NAME>', '<NAME translate="true">PC0 V3</NAME>').replace(/>pc</g, ">pc<");
    const c = analizar(xml);
    assert.strictEqual(Array.from(c.pcs).find((p) => p.pc === "PC0 V3").vlan, 3);
});

prueba("una troncal con otra nativa, o la subinterfaz nativa sin serlo, están mal", () => {
    const s1 = ["hostname Switch", "interface FastEthernet0/1", " switchport trunk native vlan 9", " switchport mode trunk"];
    const r1 = ROUTER.concat(["interface Ethernet0/3/0.6", " encapsulation dot1Q 6", " ip address 16.0.0.30 255.255.255.240"]);
    const c = analizar(wifi({ cfg: { S1: s1, R1: r1 } }));
    assert.ok(motivosDe(c, "S1").includes("tiene la nativa 9, y es la 6"), JSON.stringify(c.motivos));
    assert.ok(motivosDe(c, "R1").includes("no es nativa, y su vlan sí"), JSON.stringify(c.motivos));
    const r = bloqueDe(c, "R1");
    assert.ok(r.includes(" encapsulation dot1Q 6 native"), r.join("|"));
});

prueba("lo que ya tecleaste de la nativa no se repite", () => {
    const m = ["hostname SWR1", "ip routing", "vlan 2", "interface FastEthernet0/3", " switchport trunk native vlan 6", " switchport trunk encapsulation dot1q", " switchport mode trunk"];
    const r1 = ROUTER.concat(["interface Ethernet0/3/0", " no ip address", "interface Ethernet0/3/0.6", " encapsulation dot1Q 6 native", " ip address 16.0.0.30 255.255.255.240"]);
    const c = analizar(wifi({ cfg: { SWR1: m, R1: r1 } }));
    assert.strictEqual(Object.keys(c.motivos).length, 0, JSON.stringify(c.motivos));
    assert.ok(!bloqueDe(c, "R1").includes("interface Ethernet0/3/0.6"), bloqueDe(c, "R1").join("|"));
    assert.ok(!bloqueDe(c, "SWR1").includes("interface FastEthernet0/3"), bloqueDe(c, "SWR1").join("|"));
});

prueba("un multicapa que sólo hace de switch sigue siéndolo al borrarlo, aunque traiga ip routing", () => {
    const devs = [equipo("r", "R1", "Router", "2811", 100, 100, ROUTER),
                  equipo("m", "SW", "MultiLayerSwitch", "3560-24PS", 100, 300, ["hostname Switch", "interface FastEthernet0/1", " switchport trunk encapsulation dot1q", " switchport mode trunk"]),
                  equipo("p", "PC0", "Pc", "PC-PT", 300, 500)].join("");
    const xml = `<X><DEVICES>${devs}</DEVICES>${cable("r", "FastEthernet0/0", "m", "FastEthernet0/1")}${cable("m", "FastEthernet0/2", "p", "FastEthernet0")}<NOTES>${nota("{n}", 50, 50, "R1 10.0.0.0\nVLAN 10/24")}</NOTES></X>`;
    m.__xml = xml;
    const c = vm.runInContext("analizarXml(__xml, { borrarTodo: true })", m);
    const sw = bloqueDe(c, "SW");
    assert.ok(!sw.includes("ip routing"), sw.join("|"));
    assert.ok(sw.includes(" switchport mode trunk"), sw.join("|"));
    assert.ok(sw.includes(" switchport access vlan 10"), sw.join("|"));
});

prueba("con el router y su switch de siempre, la nativa va en el mismo sitio", () => {
    const devs = [equipo("r", "R1", "Router", "2811", 100, 100, ROUTER), equipo("m", "SW", "MultiLayerSwitch", "3650-24PS", 100, 300, ["hostname Switch"]),
                  equipo("w", "WLC0", "WirelessLanController", "WLC-3504", 300, 300, [], WLC_FABRICA), equipo("a", "AP1", "LightWeightAccessPoint", "3702i", 100, 500, [], AP_FABRICA("0002.4AED.ED86")),
                  equipo("v", "Server0", "Server", "Server-PT", 300, 100, [], SRV_FABRICA), equipo("p", "PC0", "Pc", "PC-PT", 300, 500)].join("");
    const cs = cable("r", "FastEthernet0/0", "m", "GigabitEthernet1/0/1") + cable("r", "FastEthernet0/1", "v", "FastEthernet0") + cable("m", "GigabitEthernet1/0/2", "w", "GigabitEthernet1")
        + cable("m", "GigabitEthernet1/0/3", "a", "GigabitEthernet0") + cable("m", "GigabitEthernet1/0/5", "p", "FastEthernet0");
    const xml = `<X><DEVICES>${devs}</DEVICES>${cs}<NOTES>${nota("{n}", 50, 50, "R1\nVLAN 10 10.0.0.0/24 NATIVA\nVLAN 20 20.0.0.0/24 ALUMNOS\nVLAN 30 30.0.0.0/24 ADMINISTRATIVOS")}</NOTES></X>`;
    const c = analizar(xml);
    const r = bloqueDe(c, "Router0" === "x" ? "" : "R1");
    assert.deepStrictEqual(lineasDe(r, "interface FastEthernet0/0.10"), [" encapsulation dot1Q 10 native", " ip address 10.0.0.254 255.255.255.0"], r.join("|"));
    assert.deepStrictEqual(lineasDe(r, "interface FastEthernet0/1"), [" ip address 192.168.1.254 255.255.255.0", " no shutdown"]);
    const m = bloqueDe(c, "SW");
    const troncal = [" switchport mode trunk", " switchport trunk native vlan 10", " no shutdown"];
    ["1", "2", "3"].forEach((n) => assert.deepStrictEqual(lineasDe(m, "interface GigabitEthernet1/0/" + n), troncal, m.join("|")));
    assert.deepStrictEqual(lineasDe(m, "interface GigabitEthernet1/0/5"), [" switchport mode access", " switchport access vlan 10"]);
    assert.strictEqual(c.inalambrico.controladoras[0].ip, "10.0.0.253");
});

prueba("sin controladora nada cambia, y un AP sin ella se avisa", () => {
    const c = analizar(practica(N1, N2));
    assert.strictEqual(c.inalambrico.pendiente, false);
    assert.strictEqual(c.inalambrico.controladoras.length, 0);
    const sin = analizar(wifi().replace("<TYPE model=\"WLC-3504\">WirelessLanController</TYPE>", "<TYPE model=\"PC-PT\">Pc</TYPE>"));
    assert.ok(sin.inalambrico.avisos.some((a) => a.includes("ninguna controladora")), Array.from(sin.inalambrico.avisos).join("|"));
});

prueba("una controladora sin vlan que se llame nativa se avisa", () => {
    const c = analizar(wifi({ notas: [SWR1_WIFI, "VLAN 2/24\nALUMNOS\n\nVLAN 3/24\nDOCENTES"] }));
    assert.ok(llama("textoProblemas", c).includes("ninguna vlan se llama nativa"), llama("textoProblemas", c));
});

prueba("los teléfonos: cada uno con el AP más cerca, turnándose las redes", () => {
    const c = analizar(wifi());
    assert.deepStrictEqual(Array.from(c.inalambrico.telefonos).map((t) => t.equipo + " " + t.ssid + " " + t.vlan), ["Smartphone0 ALUMNOS 2", "Smartphone1 DOCENTES 3"]);
    const tel = Array.from(c.pcs).find((p) => p.pc === "Smartphone1");
    assert.strictEqual(tel.telefono, true);
    assert.strictEqual(tel.gateway, "16.0.2.254");
});

prueba("escrito en el archivo queda igual a lo que tocaba: ya no hay nada pendiente", () => {
    const xml = wifi();
    const c = analizar(xml);
    assert.strictEqual(c.inalambrico.pendiente, true);
    m.__xml = xml;
    m.__ina = c.inalambrico;
    const nuevo = vm.runInContext("parchearInalambrico(__xml, __ina)", m);
    const d = analizar(nuevo);
    assert.strictEqual(d.inalambrico.pendiente, false, JSON.stringify(d.inalambrico.controladoras.concat(d.inalambrico.servidores, d.inalambrico.aps, d.inalambrico.telefonos).filter((x) => x.pendiente).map((x) => x.equipo)));
    const w = d.topo.porNombre("WLC0").wlc;
    assert.strictEqual(w.enAsistente, false, "ya no pide el asistente");
    assert.strictEqual(w.interfaces.find((i) => i.nombre === "virtual").ip, "192.0.2.1");
    assert.ok(nuevo.includes("<AUTH_PORT>1812</AUTH_PORT>") && !nuevo.includes("<AUTH_PORT>1645</AUTH_PORT>"));
    assert.ok(nuevo.includes("<WPA_EAP_USERID>majli</WPA_EAP_USERID>"));
    assert.ok(nuevo.includes("<USERID>majli</USERID>"));
    assert.strictEqual(d.topo.porNombre("Server0").gateway, "192.168.1.254");
    assert.deepStrictEqual(Array.from(d.topo.porNombre("AP1").ssids), ["ALUMNOS", "DOCENTES"]);
    const macs = Array.from(nuevo.matchAll(/<NAME>(ALUMNOS|DOCENTES)<\/NAME><VLAN_NUMBER>/g)).length;
    assert.strictEqual(macs, 2, "una interfaz por vlan");
    assert.strictEqual(analizar(vm.runInContext("parchearInalambrico(__n, __i)", Object.assign(m, { __n: nuevo, __i: d.inalambrico }))).inalambrico.pendiente, false, "y otra vez no cambia nada");
});

prueba("un AP con DHCP en su radio se corrige: así nadie se le puede asociar", () => {
    const radio = (dhcp, metodo) => `<PORT><TYPE>eAccessPointWirelessN</TYPE><UP_METHOD>${metodo}</UP_METHOD><PORT_DHCP_ENABLE>${dhcp}</PORT_DHCP_ENABLE></PORT>`;
    const xml = wifi().replace("<MODULE><PORT><MACADDRESS>0002.4AED.ED86</MACADDRESS></PORT></MODULE>", "<MODULE><PORT><MACADDRESS>0002.4AED.ED86</MACADDRESS></PORT>" + radio(true, 5) + "</MODULE>");
    const c = analizar(xml);
    assert.strictEqual(c.inalambrico.aps.find((a) => a.equipo === "AP1").pendiente, true);
    m.__xml = xml;
    m.__ina = c.inalambrico;
    const nuevo = vm.runInContext("parchearInalambrico(__xml, __ina)", m);
    assert.ok(nuevo.includes(radio(false, 0)), "queda como los demás");
    assert.strictEqual(analizar(nuevo).topo.porNombre("AP1").radioBien, true);
    assert.strictEqual(analizar(nuevo).inalambrico.pendiente, false);
});

prueba("un AP de fábrica no pide IP por su cable: se le enciende el DHCP", () => {
    const gig = (metodo, dhcp) => `<PORT><TYPE>eCopperGigabitEthernet</TYPE><UP_METHOD>${metodo}</UP_METHOD><PORT_DHCP_ENABLE>${dhcp}</PORT_DHCP_ENABLE><MACADDRESS>0002.4AED.ED86</MACADDRESS></PORT>`;
    const radio = '<PORT><TYPE>eAccessPointWirelessN</TYPE><UP_METHOD>0</UP_METHOD><PORT_DHCP_ENABLE>false</PORT_DHCP_ENABLE></PORT>';
    const xml = wifi().replace("<MODULE><PORT><MACADDRESS>0002.4AED.ED86</MACADDRESS></PORT></MODULE>", "<MODULE>" + gig(0, false) + radio + "</MODULE>");
    const c = analizar(xml);
    assert.strictEqual(c.inalambrico.aps.find((a) => a.equipo === "AP1").pendiente, true);
    m.__xml = xml;
    m.__ina = c.inalambrico;
    const nuevo = vm.runInContext("parchearInalambrico(__xml, __ina)", m);
    assert.ok(nuevo.includes(gig(1, true) + radio), "el cable pide IP y el radio se queda sin ella");
    assert.strictEqual(analizar(nuevo).topo.porNombre("AP1").cableBien, true);
    assert.strictEqual(analizar(nuevo).inalambrico.pendiente, false);
});

// --- los modos de Aplicar ------------------------------------------------------------------------------

// R1 con su /30 (.5, por la nota '.4') y sus dos pools, como lo dejaría quien hace a mano su parte.
const R1_DHCP_30 = ["hostname R1", "interface FastEthernet0/0", " ip address 11.0.0.5 255.255.255.252", "interface FastEthernet0/1", " no ip address",
                    "ip dhcp pool VLAN2", " network 11.0.4.0 255.255.252.0", " default-router 11.0.7.254",
                    "ip dhcp pool VLAN3", " network 11.0.0.16 255.255.255.240", " default-router 11.0.0.30"];
const R2_SOLO_30 = ["hostname R2", "interface FastEthernet0/0", " ip address 11.0.0.6 255.255.255.252", "interface FastEthernet0/1", " no ip address"];
const R2_POOLS = ["ip dhcp pool VLAN2", " network 11.0.8.0 255.255.252.0", " default-router 11.0.11.254",
                  "ip dhcp pool VLAN3", " network 11.0.0.32 255.255.255.240", " default-router 11.0.0.46"];
const conModo = (modo, opciones) => analizar(practica(N1, N2, opciones), { modo });
const equiposDe = (c) => Array.from(c.bloques.map((b) => b.equipo)).sort();

prueba("activo es como siempre: sin modo, o con uno que no existe", () => {
    const opciones = { cfgR2: R2_SOLO_30 };
    const sin = analizar(practica(N1, N2, opciones));
    for (const c of [conModo("activo", opciones), conModo("otro", opciones)]) {
        assert.strictEqual(c.modo, "activo");
        assert.strictEqual(c.pasivo, null);
        assert.deepStrictEqual(equiposDe(c), equiposDe(sin));
        assert.strictEqual(llama("textoProblemas", c), llama("textoProblemas", sin));
    }
});

prueba("pasivo estricto: sólo se toca el router con su DHCP y su /30 bien, y los switches que cuelgan de él", () => {
    const c = conModo("estricto", { cfgR1: R1_DHCP_30, cfgR2: R2_SOLO_30 });
    assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router0"]);
    assert.deepStrictEqual(Array.from(c.pasivo.noCumplen), ["Router1"]);
    assert.deepStrictEqual(equiposDe(c), ["Router0", "Switch0"]);
    const r1 = bloqueDe(c, "Router0");
    for (const l of [" encapsulation dot1Q 2", " ip address 11.0.7.254 255.255.252.0", "ip route 11.0.8.0 255.255.252.0 11.0.0.6"]) {
        assert.ok(r1.includes(l), "falta en R1: " + l + " | " + r1.join("|"));
    }
    assert.ok(!r1.some((l) => l.indexOf("ip dhcp pool") === 0), "su DHCP ya estaba: " + r1.join("|"));
    assert.deepStrictEqual(Array.from(new Set(c.pcs.map((p) => p.dueno))), ["Router0"], "las PCs de R2 no se tocan");
    const t = llama("textoProblemas", c);
    assert.ok(t.startsWith("modo pasivo estricto: aplicar sólo toca los routers y cores que ya traen completos y bien su dhcp y sus enlaces /30, y los switches que cuelgan de ellos\n"
                           + "cumplen 1 de 2: r1\nno se toca r2: le falta el pool de la vlan 2\nno se toca r2: le falta el pool de la vlan 3\n\ncombos bien"), t);
    assert.ok(llama("hayProblemas", c));
    const ambos = conModo("estricto", { cfgR1: R1_DHCP_30, cfgR2: R2_SOLO_30.concat(R2_POOLS) });
    assert.deepStrictEqual(Array.from(ambos.pasivo.cumplen), ["Router0", "Router1"]);
    assert.deepStrictEqual(equiposDe(ambos), ["Router0", "Router1", "Switch0", "Switch1"]);
    assert.ok(llama("textoProblemas", ambos).startsWith("modo pasivo estricto: aplicar sólo toca"), "sigue diciendo el modo");
    assert.ok(llama("textoProblemas", ambos).includes("cumplen 2 de 2: r1, r2\n"), llama("textoProblemas", ambos));
});

prueba("pasivo estricto: un /30 sin IP o con otra, o un pool a medias, dejan fuera al router y se dice qué", () => {
    const casos = [
        [["hostname R2", "interface FastEthernet0/0", " no ip address"].concat(R2_POOLS), "fastethernet0/0 no tiene ip, y es su enlace con r1"],
        [["hostname R2", "interface FastEthernet0/0", " ip address 11.0.0.9 255.255.255.252"].concat(R2_POOLS), "fastethernet0/0 tiene 11.0.0.9 255.255.255.252, y le toca 11.0.0.6 255.255.255.252"],
        [R2_SOLO_30.concat(R2_POOLS.slice(0, 5)), "al pool vlan3 le falta su default-router"],
        [R2_SOLO_30.concat(R2_POOLS.slice(0, 5), [" default-router 11.0.0.45"]), "el pool vlan3 tiene la puerta 11.0.0.45, y le toca 11.0.0.46"],
        [R2_SOLO_30.concat(R2_POOLS.slice(0, 3), ["ip dhcp pool OTRO", " network 11.0.0.32 255.255.255.248", " default-router 11.0.0.38"]), "el pool otro (11.0.0.32/29) no es el de la vlan 3 (11.0.0.32/28)"],
        [["no service dhcp"].concat(R2_SOLO_30, R2_POOLS), "tiene apagado el dhcp (no service dhcp)"],
    ];
    for (const [cfg, falta] of casos) {
        const c = conModo("estricto", { cfgR1: R1_DHCP_30, cfgR2: cfg });
        assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router0"], falta);
        assert.ok(llama("textoProblemas", c).includes("no se toca r2: " + falta + "\n"), falta + " | " + llama("textoProblemas", c));
        assert.deepStrictEqual(equiposDe(c), ["Router0", "Switch0"], falta);
    }
});

prueba("pasivo medio: bastan los /30 bien, y el DHCP lo pone aplicar", () => {
    const c = conModo("medio", { cfgR1: R1_DHCP_30.slice(0, 5), cfgR2: R2_SOLO_30 });
    assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router0", "Router1"]);
    assert.deepStrictEqual(equiposDe(c), ["Router0", "Router1", "Switch0", "Switch1"]);
    assert.ok(bloqueDe(c, "Router1").includes(" default-router 11.0.11.254"), bloqueDe(c, "Router1").join("|"));
    assert.ok(!llama("hayProblemas", c), llama("textoProblemas", c));
    assert.ok(llama("textoProblemas", c).startsWith("modo pasivo medio: aplicar sólo toca los routers y cores que ya traen completos y bien sus enlaces /30"));
    const nada = conModo("medio", { cfgR2: R2_SOLO_30 });
    assert.deepStrictEqual(Array.from(nada.pasivo.cumplen), ["Router1"]);
    assert.ok(llama("textoProblemas", nada).includes("no se toca r1: todavía no trae nada tuyo: ni una ip, ni un pool, ni una ruta"), llama("textoProblemas", nada));
});

prueba("pasivo bajo: basta con haberlo empezado, y lo que traiga mal se rehace como en activo", () => {
    const r2Mal = ["hostname R2", "interface FastEthernet0/0", " ip address 11.0.0.9 255.255.255.252", "interface FastEthernet0/1"];
    const c = conModo("bajo", { cfgR2: r2Mal });
    assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router1"]);
    assert.deepStrictEqual(equiposDe(c), ["Router1", "Switch1"]);
    assert.ok(c.borrar.Router1, JSON.stringify(c.motivos));
    assert.ok(bloqueDe(c, "Router1").includes(" ip address 11.0.0.6 255.255.255.252"), bloqueDe(c, "Router1").join("|"));
    const ruta = conModo("bajo", { cfgR1: ["hostname R1", "ip route 0.0.0.0 0.0.0.0 11.0.0.6"] });
    assert.deepStrictEqual(Array.from(ruta.pasivo.cumplen), ["Router0"], "una ruta también es empezar");
    const nombre = conModo("bajo", { cfgR1: ["hostname R1"] });
    assert.deepStrictEqual(Array.from(nombre.pasivo.cumplen), [], "el hostname solo, no");
    assert.deepStrictEqual(equiposDe(nombre), []);
});

prueba("en pasivo lo que no cumple no se borra, ni con más de la mitad mal; lo que cumple sí se rehace", () => {
    const r1Mal = ["hostname R1", "interface FastEthernet0/1.2", " encapsulation dot1Q 2", " ip address 11.0.4.1 255.255.252.0"];
    const s1Mal = ["hostname Switch", "interface FastEthernet0/3", " shutdown"];
    const opciones = { cfgR1: r1Mal, cfgR2: R2_SOLO_30, cfgS1: s1Mal, cfgS2: s1Mal };
    const activo = conModo("activo", opciones);
    assert.strictEqual(activo.borraTodos, "3 de 4", "en activo se borrarían todos");
    const c = conModo("medio", opciones);
    assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router1"]);
    assert.deepStrictEqual(Object.keys(c.borrar), ["Switch1"]);
    assert.deepStrictEqual(Object.keys(c.motivos), ["Switch1"], "sólo se reporta lo que se rehace");
    assert.strictEqual(c.borraTodos, null);
    const t = llama("textoProblemas", c);
    assert.ok(t.includes("no se toca r1: fastethernet0/0 no tiene ip, y es su enlace con r2") && !t.includes("se rehace r1"), t);
    assert.ok(t.includes("se rehace switch (switch1): fastethernet0/3 está apagado, y es de una pc"), t);
    m.__xml = practica(N1, N2, { cfgR1: r1Mal, cfgR2: R2_SOLO_30 });
    const todo = vm.runInContext("analizarXml(__xml, { borrarTodo: true, modo: 'medio' })", m);
    assert.deepStrictEqual(Object.keys(todo.borrar).sort(), ["Router1", "Switch1"], "borrar todo sólo borra lo que cumple");
});

prueba("en pasivo, lo que cumplía al empezar a aplicar sigue cumpliendo hasta terminar, aunque ya no traiga nada", () => {
    m.__xml = practica(N1, N2);
    const c = vm.runInContext("analizarXml(__xml, { modo: 'bajo', cumplian: ['Router1'] })", m);
    assert.deepStrictEqual(Array.from(c.pasivo.cumplen), ["Router1"]);
    assert.deepStrictEqual(Array.from(c.pasivo.noCumplen), ["Router0"]);
    assert.deepStrictEqual(equiposDe(c), ["Router1", "Switch1"]);
    assert.deepStrictEqual(equiposDe(conModo("bajo", {})), [], "sin eso, nada");
});

prueba("en pasivo lo inalámbrico va con el sitio de su controladora", () => {
    const nada = analizar(wifi(), { modo: "bajo" });
    assert.strictEqual(nada.pasivo.cumplen.length, 0);
    assert.strictEqual(nada.inalambrico.pendiente, false);
    assert.strictEqual(nada.inalambrico.controladoras.length + nada.inalambrico.aps.length + nada.inalambrico.telefonos.length, 0);
    assert.strictEqual(nada.pcs.length, 0);
    assert.strictEqual(nada.bloques.length, 0);
    const swr1 = analizar(wifi({ cfg: { SWR1: ["hostname SWR1", "interface Vlan2", " ip address 16.0.1.254 255.255.255.0"] } }), { modo: "bajo" });
    assert.deepStrictEqual(Array.from(swr1.pasivo.cumplen), ["SWR1"]);
    assert.strictEqual(swr1.inalambrico.controladoras.length, 1);
    assert.strictEqual(swr1.inalambrico.aps.length, 2);
    assert.strictEqual(swr1.inalambrico.telefonos.length, 2);
    assert.strictEqual(swr1.inalambrico.pendiente, true);
    assert.deepStrictEqual(equiposDe(swr1), ["S1", "SWR1"], "R1, que lleva la nativa, no cumple");
});

prueba("cifrar y descifrar dan lo mismo, con acentos y más de un bloque", () => {
    const fs = require("fs"), path = require("path");
    m.__x = "<a>ñandú 😀</a>" + "x".repeat(200000);
    m.__s = vm.runInContext("cifrarPkt(__x)", m);
    assert.strictEqual(vm.runInContext("descifrarPkt(__s)", m), m.__x);
});

// --- el módulo, con un Packet Tracer de mentira: qué abre, qué copia y qué dice ---------------

function ptDeMentira(xml, archivo) {
    const fs = require("fs"), path = require("path");
    const ctx = cargar();
    const pt = { xml, archivo, uuid: "{uno}", blocs: [], copias: [], aviso: "", ui: [], subidas: 0, temporizadores: [], escritos: {},
                 guardar: "", noSeGuarda: false, roto: null, area: [2000, 1200] };
    const ventana = {
        setBackgroundColor() { }, enableRightClickMenu() { }, show() { },
        attachToMainViewArea() { pt.adentro = true; },
        raise() { pt.subidas++; },
        getZoomFactor: () => 1.3,
        setGeometry(...g) { pt.geometria = g; },
        evaluateJavaScriptAsync(c) {
            const m = /^avisar\((.*)\)$/.exec(c);
            if (m) { pt.aviso = JSON.parse(m[1]); } else { pt.ui.push(c); }
        },
        registerEvent(n, o, f) { pt.alCerrar = f; },
        close() { pt.alCerrar(); },
    };
    const app = {
        getMainViewAreaWidth: () => pt.area[0], getMainViewAreaHeight: () => pt.area[1],
        getActiveFile: () => ({ getSavedFilename: () => pt.archivo, getObjectUuid: () => pt.uuid }),
        fileSaveToBytes: () => { if (pt.roto) { throw new Error(pt.roto); } return pt.xml; },
        getTempFileLocation: () => "T:\\temp", getDefaultFileSaveLocation: () => "D:/saves", getUserFolder: () => pt.usuario || "",
        openURL: (u) => {
            const ruta = decodeURIComponent(u).replace("file:///", "");
            pt.blocs.push({ url: u, ruta, texto: pt.escritos[ruta] });
        },
        setClipboardText: (t) => pt.copias.push(t),
        fileOpenFromBytes: (b, r) => {
            pt.reabierta = { ruta: r };
            pt.xml = b;
            pt.uuid = "{reabierta}";
            return pt.noAbre ? 3 : 0;
        },
    };
    ctx.ipc = {
        appWindow: () => app,
        network: () => ({ getDevice: (n) => (pt.red ? pt.red[n] || null : null) }),
        systemFileManager: () => ({
            writePlainTextToFile: (r, t) => {
                if (pt.noSeGuarda && r === pt.guardar) { return false; }
                pt.escritos[r] = t;
                return true;
            },
            getSaveFileName: () => pt.guardar,
            fileExists: (r) => Object.prototype.hasOwnProperty.call(pt.escritos, r),
            getFileContents: (r) => pt.escritos[r],
        }),
    };
    ctx.webViewManager = { createWebView: () => ventana };
    ctx.setTimeout = (f) => { pt.temporizadores.push(f); return pt.temporizadores.length; };
    ctx.clearTimeout = () => { };
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "principal.js"), "utf8"), ctx, { filename: "principal.js" });
    vm.runInContext("descifrarPkt = function (x) { return x; }; cifrarPkt = function (x) { return x; };", ctx);     // el XML va directo
    pt.ev = (s) => vm.runInContext(s, ctx);
    pt.llama = (f, ...args) => { ctx.__args = args; return vm.runInContext(f + ".apply(null, __args)", ctx); };
    // Corre lo que estaba programado; lo que eso programe se queda para la siguiente.
    pt.correr = () => { const ts = pt.temporizadores; pt.temporizadores = []; ts.forEach((f) => f()); };
    pt.abrir = () => { pt.llama("abrirVentana"); pt.llama("uiLista"); };    // como la página al cargar
    pt.ultimaUi = () => pt.ui[pt.ui.length - 1];
    return pt;
}

const practicaSinNotas = () => `<X><DEVICES>${equipo("r", "Router0", "Router", "2811", 100, 100, ROUTER)}</DEVICES><NOTES></NOTES></X>`;

prueba("módulo: al abrir, los comandos van al Bloc de notas y a la página sólo lo de los botones", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    assert.strictEqual(pt.blocs.length, 1);
    assert.ok(/^T:\/temp\/P1_comandos_\d{6}\.txt$/.test(pt.blocs[0].ruta), pt.blocs[0].ruta);
    assert.strictEqual(pt.blocs[0].texto, pt.ev("textoBloques(_CTX.bloques)"));
    assert.ok(/^mostrar\(/.test(pt.ultimaUi()), pt.ultimaUi());
    const d = JSON.parse(pt.ultimaUi().slice(8, -1));
    assert.deepStrictEqual(Object.keys(d).sort(), ["modo", "panico", "pendientes"]);
    assert.strictEqual(d.modo, "activo");
    assert.strictEqual(d.pendientes, pt.ev("_CTX.bloques.length"));
    assert.strictEqual(pt.aviso, d.pendientes + " equipos por configurar");
    assert.strictEqual(pt.copias.length, 0, "abrir no toca el portapapeles");
});

prueba("módulo: la barra va dentro del lienzo, crece sin moverse y no se sale de él", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    assert.strictEqual(pt.adentro, true);
    assert.deepStrictEqual(pt.geometria, [10, 5, 364, 32]);
    pt.llama("uiTamano", 259, 24);
    assert.deepStrictEqual(pt.geometria, [10, 5, 337, 32]);
    pt.llama("uiTamano", 259, 154);
    assert.deepStrictEqual(pt.geometria, [10, 5, 337, 201], "con un menú crece hacia abajo");
    pt.llama("uiTamano", 259, 24);
    pt.llama("uiMover", 100, 50);
    assert.deepStrictEqual(pt.geometria, [110, 55, 337, 32], "el asa la mueve");
    pt.llama("uiMover", 5000, 5000);
    assert.deepStrictEqual(pt.geometria, [2000 - 337, 1200 - 32, 337, 32], "hasta la orilla");
    pt.llama("uiTamano", 259, 154);
    assert.deepStrictEqual(pt.geometria, [2000 - 337, 1200 - 201, 337, 201], "un menú que no cabe la sube");
    pt.llama("uiTamano", 259, 24);
    assert.deepStrictEqual(pt.geometria, [2000 - 337, 1200 - 32, 337, 32], "y al cerrarlo regresa");
    pt.area = [800, 600];
    pt.correr();
    assert.deepStrictEqual(pt.geometria, [800 - 337, 600 - 32, 337, 32], "si Packet Tracer se achica, no se pierde");
    pt.area = [2000, 1200];
    pt.correr();
    assert.deepStrictEqual(pt.geometria, [2000 - 337, 1200 - 32, 337, 32], "y si vuelve a crecer, regresa");
    pt.llama("uiCerrar");
    pt.abrir();
    assert.strictEqual(pt.geometria[0], 2000 - 364, "al reabrirla sigue donde la dejaron");
});

prueba("módulo: una práctica nueva queda encima de la barra: se vuelve a subir", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    const antes = pt.subidas;
    pt.correr();
    assert.strictEqual(pt.subidas, antes, "sin cambios no hace nada");
    pt.uuid = "{dos}";
    pt.correr();
    assert.strictEqual(pt.subidas, antes + 1);
});

prueba("módulo: colapsada se queda en su lugar, y al abrirla se recorre si no cabe", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.llama("uiTamano", 14, 24);
    assert.deepStrictEqual(pt.geometria, [10, 5, 19, 32]);
    pt.llama("uiMover", 5000, 0);
    assert.deepStrictEqual(pt.geometria, [2000 - 19, 5, 19, 32], "colapsada llega hasta la orilla");
    pt.llama("uiTamano", 270, 24);
    assert.deepStrictEqual(pt.geometria, [2000 - 351, 5, 351, 32], "al abrirla se recorre para caber");
    pt.llama("uiTamano", 14, 24);
    assert.deepStrictEqual(pt.geometria, [2000 - 19, 5, 19, 32], "y al colapsarla regresa");
});

prueba("módulo: pedirla en el menú de Packet Tracer la abre completa", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    assert.ok(!pt.ui.includes("expandir(true)"), "recién creada no hace falta");
    pt.llama("abrirVentana");
    assert.ok(pt.ui.includes("expandir(true)"));
});

prueba("módulo: con errores en las notas se abren los comandos y luego los problemas, en minúsculas", () => {
    const pt = ptDeMentira(practica(R1_MUY_MAL, R2_MUY_MAL), "P1.pkt");
    pt.abrir();
    assert.strictEqual(pt.blocs.length, 1, "primero los comandos");
    assert.ok(/_comandos_/.test(pt.blocs[0].ruta));
    pt.correr();
    assert.strictEqual(pt.blocs.length, 2, "y al rato los problemas");
    assert.ok(/_problemas_/.test(pt.blocs[1].ruta));
    assert.strictEqual(pt.blocs[1].texto, pt.blocs[1].texto.toLowerCase());
    assert.ok(/^combos bien: \d+ de 8/.test(pt.blocs[1].texto), pt.blocs[1].texto);
    const malos = pt.ev("_CTX.combos.malos");
    assert.strictEqual(pt.aviso, pt.ev("_CTX.bloques.length") + " por configurar, " + malos + " combos mal");
});

prueba("módulo: lo que no cambió no se reabre; F5 sí, en el mismo archivo", () => {
    const pt = ptDeMentira(practica(R1_MUY_MAL, R2_MUY_MAL), "P1.pkt");
    pt.abrir();
    pt.correr();
    const antes = pt.blocs.map((b) => b.ruta);
    pt.llama("uiLista");
    pt.correr();
    assert.strictEqual(pt.blocs.length, 2, "volver a abrir la barra no repite");
    pt.llama("uiReleer");
    pt.correr();
    assert.deepStrictEqual(pt.blocs.slice(2).map((b) => b.ruta), antes, "F5 repite lo mismo");
});

prueba("módulo: si cambian las notas, F5 abre otro archivo con lo nuevo", () => {
    const pt = ptDeMentira(practica(R1_MUY_MAL, R2_MUY_MAL), "P1.pkt");
    pt.abrir();
    pt.correr();
    pt.xml = practica(R1_BIEN, R2_MUY_MAL);
    pt.ev("Date = class extends Date { toTimeString() { return '23:59:59 GMT'; } }");
    pt.llama("uiReleer");
    pt.correr();
    const nuevos = pt.blocs.slice(2);
    assert.strictEqual(nuevos.length, 2);
    assert.ok(nuevos.every((b) => /_235959\.txt$/.test(b.ruta)), nuevos.map((b) => b.ruta).join());
    assert.notStrictEqual(nuevos[1].texto, pt.blocs[1].texto);
    assert.strictEqual(pt.escritos[nuevos[1].ruta], nuevos[1].texto);
});

prueba("módulo: abrir otra práctica, o la misma otra vez, se actualiza y abre todo", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.correr();
    assert.strictEqual(pt.blocs.length, 1, "sin cambios, el vigía no hace nada");
    pt.uuid = "{dos}";
    pt.correr();
    assert.strictEqual(pt.blocs.length, 2, "la misma práctica reabierta");
    pt.uuid = "{tres}";
    pt.archivo = "P2.pkt";
    pt.xml = practicaSinNotas();
    pt.correr();
    assert.strictEqual(pt.blocs.length, 2, "una sin notas no abre nada");
    assert.strictEqual(pt.aviso, "Sin notas con VLANs");
});

prueba("módulo: Ver siempre abre: sin notas, cómo escribirlas; con ellas, los problemas o que no hay", () => {
    const pt = ptDeMentira(practicaSinNotas(), "");
    pt.abrir();
    assert.strictEqual(pt.blocs.length, 0, "no abre nada solo");
    assert.strictEqual(pt.aviso, "Sin notas con VLANs");
    pt.llama("uiVerProblemas");
    assert.ok(/^Todavía no hay notas/.test(pt.blocs[0].texto), pt.blocs[0].texto);
    assert.ok(/^practica_problemas_/.test(pt.blocs[0].ruta.split("/").pop()), pt.blocs[0].ruta);
    const conNotas = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    conNotas.abrir();
    conNotas.llama("uiVerProblemas");
    assert.strictEqual(conNotas.blocs[conNotas.blocs.length - 1].texto.trim(), conNotas.ev("_textoProblemas()"));
});

prueba("módulo: sin nada pendiente, Copiar todo da la configuración completa", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    const completa = pt.ev("textoBloques(_CTX.completos)");
    pt.ev("_CTX.bloques = []");
    pt.llama("uiCopiarTodo");
    assert.strictEqual(pt.copias[pt.copias.length - 1], completa);
});

prueba("módulo: los supuestos van al pie de los problemas, pero solos no abren nada", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.ev("analizarXml = (function (real) { return function (x) { var c = real(x); c.plan.supuestos.push('PC6 sin VLAN en su nombre'); return c; }; })(analizarXml)");
    pt.abrir();
    pt.correr();
    assert.strictEqual(pt.blocs.length, 1, "sólo los comandos");
    pt.llama("uiVerProblemas");
    assert.ok(/\n\nse supuso:\n(.*\n)*pc6 sin vlan en su nombre\n$/.test(pt.blocs[1].texto), pt.blocs[1].texto);
});

prueba("módulo: copiar todo", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    const lista = Array.from(pt.ev("_CTX.bloques"));
    assert.ok(lista.length >= 2);
    pt.llama("uiCopiarTodo");
    assert.strictEqual(pt.copias[0], pt.ev("textoBloques(_CTX.bloques)"));
    assert.strictEqual(pt.aviso, "Copiados " + lista.length + " equipos");
});

prueba("módulo: guardar los comandos, cancelar, y si no se puede lo dice en el Bloc de notas", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    const blocs = pt.blocs.length;
    pt.llama("uiGuardarComandos");
    assert.strictEqual(Object.keys(pt.escritos).length, 1, "cancelar no escribe");
    pt.guardar = "D:/x/mios.txt";
    pt.llama("uiGuardarComandos");
    assert.strictEqual(pt.escritos[pt.guardar], pt.ev("textoBloques(_CTX.bloques)"));
    assert.strictEqual(pt.aviso, "Guardado mios.txt");
    assert.strictEqual(pt.blocs.length, blocs);
    pt.noSeGuarda = true;
    pt.guardar = "D:/x/no.txt";
    pt.llama("uiGuardarComandos");
    assert.strictEqual(pt.blocs.length, blocs + 1);
    assert.strictEqual(pt.blocs[blocs].texto, "no se pudo guardar: d:/x/no.txt\n");
    assert.strictEqual(pt.aviso, "No se pudo guardar");
});

prueba("módulo: si no se puede leer, el error va al Bloc de notas y F5 vuelve a intentar", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.roto = "Archivo RARO";
    pt.llama("uiReleer");
    assert.strictEqual(pt.aviso, "No se pudo leer la práctica");
    assert.strictEqual(pt.ultimaUi(), "fallo(true)");
    const texto = pt.blocs[pt.blocs.length - 1].texto;
    assert.ok(/^no se pudo leer la práctica: error: archivo raro\n$/.test(texto), texto);
    assert.strictEqual(pt.ev("_CTX"), null, "no se queda lo de antes");
    const blocs = pt.blocs.length;
    pt.correr();
    assert.strictEqual(pt.blocs.length, blocs, "el vigía no insiste");
    pt.llama("uiVerProblemas");
    assert.strictEqual(pt.blocs.length, blocs + 1, "Ver también lo intenta, y avisa");
    pt.roto = null;
    pt.llama("uiReleer");
    assert.ok(/^mostrar\(/.test(pt.ultimaUi()), pt.ultimaUi());
    assert.ok(/por configurar/.test(pt.aviso), pt.aviso);
});

prueba("módulo: cerrar y volver a abrir la barra abre otra vez sus Blocs de notas", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.llama("uiCerrar");
    assert.strictEqual(pt.ev("_VENTANA"), null);
    pt.correr();
    assert.strictEqual(pt.temporizadores.length, 0, "cerrada, el vigía se detiene");
    pt.abrir();
    assert.strictEqual(pt.blocs.length, 2);
});

prueba("módulo: aplicar dice qué hace, y lo que IOS rechaza va al Bloc de notas", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.correr();
    const n = pt.ev("_CTX.bloques.length"), blocs = pt.blocs.length;
    pt.llama("uiAplicar");
    assert.strictEqual(pt.aviso, "Aplicando...");
    assert.strictEqual(pt.ultimaUi(), "ocupado(true)");
    pt.correr();
    assert.strictEqual(pt.aviso, "Aplicado a " + n + " equipos");
    assert.ok(/^mostrar\(/.test(pt.ultimaUi()), pt.ultimaUi());
    assert.strictEqual(pt.blocs.length, blocs + 1, "aquí ningún equipo está en la red");
    assert.ok(/ios rechazó:\nr1: no está en la red\n/i.test(pt.blocs[blocs].texto), pt.blocs[blocs].texto);
});

// Un equipo o una PC de mentira, para ver qué teclea y a quién le pide DHCP.
function equipoDeMentira(ip) {
    const d = { tecleado: [], pedidos: 0, ip,
                getCommandLine: () => ({ getMode: () => "enable", getPrompt: () => "R#", enterCommand: (c) => d.tecleado.push(c),
                                         registerEvent() { }, unregisterEvent() { } }),
                getPortAt: () => ({ getIpAddress: () => d.ip }), getDhcpFlag: () => true,
                setDhcpFlag(v) { if (v) { d.pedidos++; } }, isBooting: () => false };
    return d;
}

// PC1 y PC0 van en la V2 de R1, PC2 en su V3; PC3 y PC4 en la V2 de R2, PC5 en su V3.
const IPS_BIEN = ["11.0.4.1", "11.0.4.2", "11.0.0.17", "11.0.8.1", "11.0.8.2", "11.0.0.33"];
const PUERTAS_BIEN = ["11.0.7.254", "11.0.7.254", "11.0.0.30", "11.0.11.254", "11.0.11.254", "11.0.0.46"];

function conPuertas(xml, puertas) {
    puertas.forEach((g, i) => { xml = xml.replace("</RUNNINGCONFIG><SAVE_REF_ID>p" + i + "<", "</RUNNINGCONFIG><GATEWAY>" + g + "</GATEWAY><SAVE_REF_ID>p" + i + "<"); });
    return xml;
}

function redDeMentira(pt, ips) {
    pt.red = {};
    ["Router0", "Router1", "Switch0", "Switch1"].forEach((n) => { pt.red[n] = equipoDeMentira(""); });
    ["PC0", "PC1", "PC2", "PC3", "PC4", "PC5"].forEach((n, i) => { pt.red[n] = equipoDeMentira(ips[i]); });
}

prueba("módulo: aplicar teclea lo que borra sin reportar lo que IOS no acepte, y dice cuántos se borraron", () => {
    const pt = ptDeMentira(practica(N1, N2, { cfgS1: ["hostname Switch", "interface FastEthernet0/3", " shutdown"] }), "P1.pkt");
    redDeMentira(pt, IPS_BIEN);
    pt.abrir();
    pt.correr();
    assert.strictEqual(pt.aviso, "2 por configurar, 1 se borra".replace("2 por", pt.ev("_CTX.bloques.length") + " por"));
    pt.llama("uiAplicar");
    pt.correr();
    assert.ok(/, 1 se borró$/.test(pt.aviso), pt.aviso);
    assert.ok(pt.red.Switch0.tecleado.includes("no shutdown"), pt.red.Switch0.tecleado.join("|"));
    assert.ok(!pt.red.Switch0.tecleado.some((c) => c[0] === "!"), "las marcas no se teclean");
});

prueba("módulo: a las PCs de un equipo al que se le puso su pool se les pide DHCP otra vez, y a las de otra red o con otra puerta", () => {
    const puertas = ["11.0.4.1"].concat(PUERTAS_BIEN.slice(1));
    const pt = ptDeMentira(conPuertas(practica(N1, N2), puertas), "P1.pkt");
    redDeMentira(pt, IPS_BIEN);
    pt.abrir();
    pt.correr();
    pt.llama("uiAplicar");
    pt.correr();
    pt.correr();    // el primer pedido, a todas: los dos routers traen su pool en el bloque
    assert.strictEqual(pt.aviso, "DHCP: pidiendo IP a 6 PCs...");
    ["PC0", "PC1", "PC2", "PC3", "PC4", "PC5"].forEach((n) => assert.strictEqual(pt.red[n].pedidos, 1, n));
    // Una se queda fuera de su red.
    pt.red.PC2.ip = "10.9.9.9";
    pt.correr();
    assert.strictEqual(pt.red.PC2.pedidos, 2);
    assert.strictEqual(pt.red.PC3.pedidos, 1, "las que están bien no se tocan");
    assert.strictEqual(pt.aviso, "DHCP: 5 de 6 PCs con IP...");
    // Ya en su red: falta la que trae otra puerta, que sólo se ve en el archivo.
    pt.red.PC2.ip = "11.0.0.17";
    pt.correr();
    assert.strictEqual(pt.red.PC0.pedidos, 2);
    assert.strictEqual(pt.red.PC2.pedidos, 2);
    pt.xml = conPuertas(practica(N1, N2), PUERTAS_BIEN);
    pt.correr();
    assert.strictEqual(pt.aviso, "6 de 6 PCs con IP");
    assert.strictEqual(pt.temporizadores.filter((f) => /_pedirIps/.test(String(f))).length, 0, "ya no se reintenta");
});

prueba("módulo: si al final una PC no queda en su red, se dice cuál en el Bloc de notas", () => {
    const pt = ptDeMentira(practica(N1, N2), "P1.pkt");
    redDeMentira(pt, ["0.0.0.0"].concat(IPS_BIEN.slice(1)));
    pt.abrir();
    pt.correr();
    pt.llama("uiAplicar");
    pt.correr();
    for (let i = 0; i < 16; i++) { pt.correr(); }
    assert.ok(/PCs con IP; revísalas$/.test(pt.aviso), pt.aviso);
    const texto = pt.blocs[pt.blocs.length - 1].texto;
    assert.ok(/^se pidió dhcp y estas pcs no quedaron en su red: pc0\n/.test(texto), texto);
});

prueba("módulo: borrar todo se aplica a todos los equipos", () => {
    const pt = ptDeMentira(practica(N1, N2), "P1.pkt");
    redDeMentira(pt, IPS_BIEN);
    pt.abrir();
    pt.correr();
    pt.llama("uiBorrarTodo");
    assert.strictEqual(pt.aviso, "Borrando y aplicando...");
    assert.strictEqual(pt.ultimaUi(), "ocupado(true)");
    pt.correr();
    assert.ok(/^Aplicado a 4 equipos/.test(pt.aviso), pt.aviso);
});

prueba("módulo: el modo se elige en la barra, se guarda y cambia lo que se aplica", () => {
    const pt = ptDeMentira(practica(N1, N2, { cfgR1: R1_DHCP_30, cfgR2: R2_SOLO_30 }), "P1.pkt");
    pt.usuario = "C:\\Users\\yo\\Cisco Packet Tracer 9.0.1\\";
    const archivo = "C:/Users/yo/Cisco Packet Tracer 9.0.1/pktrutas_modo.txt";
    redDeMentira(pt, IPS_BIEN);
    pt.abrir();
    pt.correr();
    assert.ok(pt.ui.includes('modo("activo")'), pt.ui.join("|"));
    pt.llama("uiModo", "estricto");
    assert.strictEqual(pt.escritos[archivo], "estricto\n");
    assert.ok(pt.ui.includes('modo("estricto")'), pt.ui.join("|"));
    const d = JSON.parse(pt.ultimaUi().slice(8, -1));
    assert.strictEqual(d.modo, "estricto");
    assert.strictEqual(d.pendientes, 2);
    assert.strictEqual(pt.aviso, "Pasivo estricto: 2 equipos por configurar, 1 no cumple");
    pt.llama("uiAplicar");
    pt.correr();
    assert.strictEqual(pt.aviso, "Pasivo estricto: aplicado a 2 equipos, 1 no cumple");
    assert.ok(pt.red.Router0.tecleado.length && pt.red.Switch0.tecleado.length);
    assert.strictEqual(pt.red.Router1.tecleado.length + pt.red.Switch1.tecleado.length, 0, "R2 y su switch no se tocan");
    for (let i = 0; i < 3; i++) { pt.correr(); }
    assert.ok(pt.red.PC0.pedidos > 0, "a las PCs de R1 sí se les pide DHCP");
    assert.strictEqual(pt.red.PC3.pedidos + pt.red.PC4.pedidos + pt.red.PC5.pedidos, 0, "a las de R2 no");
    pt.llama("uiModo", "activo");
    assert.strictEqual(pt.escritos[archivo], "activo\n");
    assert.ok(/^Activo: \d+ equipos por configurar$/.test(pt.aviso), pt.aviso);
    assert.strictEqual(JSON.parse(pt.ultimaUi().slice(8, -1)).pendientes, pt.ev("_CTX.bloques.length"));
});

prueba("módulo: en pasivo, lo que cumplía al empezar se termina aunque a media aplicación ya no traiga nada", () => {
    const r2Mal = ["hostname R2", "interface FastEthernet0/0", " ip address 11.0.0.9 255.255.255.252", "interface FastEthernet0/1"];
    const pt = ptDeMentira(practica(N1, N2, { cfgR2: r2Mal }), "P1.pkt");
    redDeMentira(pt, IPS_BIEN);
    // Como un 3560 que reinicia para IPv6: al guardar su primer bloque se queda sólo con lo que se le borró.
    const r2 = pt.red.Router1, consola = r2.getCommandLine;
    r2.getCommandLine = () => {
        const t = consola();
        return Object.assign({}, t, { enterCommand: (c) => { t.enterCommand(c); if (c === "write memory") { pt.xml = practica(N1, N2); } } });
    };
    pt.abrir();
    pt.correr();
    pt.llama("uiModo", "bajo");
    assert.strictEqual(pt.aviso, "Pasivo bajo: 2 por configurar, 1 se borra, 1 no cumple");
    pt.llama("uiAplicar");
    pt.correr();
    const vueltas = r2.tecleado.filter((c) => c === "configure terminal").length;
    assert.ok(vueltas >= 2, "R2 se termina en las pasadas que siguen: " + vueltas);
    assert.strictEqual(pt.aviso, "Pasivo bajo: aplicado a 2 equipos, 1 se borró, 1 no cumple");
    assert.strictEqual(pt.red.Router0.tecleado.length, 0, "R1 no cumplía y no se toca");
});

prueba("módulo: al arrancar lee el modo que se guardó; uno que no existe no cuenta", () => {
    const pt = ptDeMentira(practica(N1, N2), "P1.pkt");
    pt.escritos["T:/temp/pktrutas_modo.txt"] = "medio\n";
    pt.llama("_cargarModo");
    pt.abrir();
    assert.ok(pt.ui.includes('modo("medio")'), pt.ui.join("|"));
    assert.strictEqual(pt.aviso, "Pasivo medio: ningún equipo cumple todavía");
    assert.strictEqual(pt.blocs.length, 1, "sin nada que aplicar, sólo los problemas");
    assert.ok(pt.blocs[0].texto.startsWith("modo pasivo medio: "), pt.blocs[0].texto);
    const raro = ptDeMentira(practica(N1, N2), "P1.pkt");
    raro.escritos["T:/temp/pktrutas_modo.txt"] = "turbo\n";
    raro.llama("_cargarModo");
    raro.abrir();
    assert.ok(raro.ui.includes('modo("activo")'), raro.ui.join("|"));
    raro.llama("uiModo", "turbo");
    assert.strictEqual(raro.escritos["T:/temp/pktrutas_modo.txt"], "turbo\n", "lo que no es un modo no se guarda");
});

prueba("módulo: lo inalámbrico se escribe y se reabre al aplicar, y el botón sigue vivo si es lo único que falta", () => {
    const pt = ptDeMentira(wifi(), "C:/saves/P.pkt");
    pt.red = {};
    pt.abrir();
    pt.correr();
    assert.ok(pt.blocs[0].texto.includes("sin comandos, lo pone aplicar:"), pt.blocs[0].texto);
    assert.ok(pt.blocs[0].texto.includes("WLC, entra con admin / Abc1234, ip 16.0.0.29 255.255.255.240, puerta 16.0.0.30"), pt.blocs[0].texto);
    pt.llama("uiCopiarTodo");
    assert.ok(!pt.copias[0].includes("sin comandos"), "lo que no es consola no se copia");
    pt.llama("uiAplicar");
    pt.correr();
    assert.strictEqual(pt.reabierta.ruta, "C:/saves/P.pkt", "conserva su nombre");
    assert.strictEqual(pt.ev("_CTX.inalambrico.pendiente"), false);
    assert.ok(/guarda la práctica$/.test(pt.aviso), pt.aviso);
    const antes = pt.subidas;
    pt.correr();
    assert.strictEqual(pt.ev("_LEIDO"), "{reabierta}", "no se confunde con otra práctica");
    assert.ok(pt.subidas >= antes);
});

prueba("módulo: si sólo falta lo inalámbrico, Aplicar se puede usar", () => {
    const pt = ptDeMentira(wifi(), "P.pkt");
    pt.abrir();
    const c = pt.ev("(_CTX.bloques = [], 0)");
    pt.llama("_mostrar");
    assert.ok(/"pendientes":1/.test(pt.ultimaUi()), pt.ultimaUi());
    assert.strictEqual(pt.aviso, "Falta lo inalámbrico");
});

prueba("módulo: si Packet Tracer no la puede abrir, se dice", () => {
    const pt = ptDeMentira(wifi(), "P.pkt");
    pt.noAbre = true;
    pt.abrir();
    pt.correr();
    pt.llama("uiAplicar");
    pt.correr();
    assert.strictEqual(pt.ultimaUi(), "fallo(true)");
    assert.ok(/packet tracer no pudo abrirla/.test(pt.blocs[pt.blocs.length - 1].texto), pt.blocs[pt.blocs.length - 1].texto);
});

prueba("módulo: si aplicar truena, los botones no se quedan apagados y se avisa", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.correr();
    pt.llama("uiAplicar");
    pt.roto = "Se Rompio";
    pt.correr();
    assert.strictEqual(pt.ultimaUi(), "fallo(true)");
    assert.ok(/^no se pudo aplicar: error: se rompio\n$/.test(pt.blocs[pt.blocs.length - 1].texto), pt.blocs[pt.blocs.length - 1].texto);
});

prueba("módulo: el pánico sin motivo lo dice y no toca nada", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "P1.pkt");
    pt.abrir();
    pt.correr();
    pt.llama("uiPanico");
    assert.strictEqual(pt.aviso, "Pánico...");
    pt.correr();
    assert.strictEqual(pt.aviso, "Pánico: no hace falta");
    assert.ok(/^mostrar\(/.test(pt.ultimaUi()), pt.ultimaUi());
});

prueba("módulo: nombres de práctica raros no rompen la dirección del Bloc de notas", () => {
    const pt = ptDeMentira(practica(R1_BIEN, R2_BIEN), "C:\\saves\\P 1#ñ.pkt");
    pt.abrir();
    assert.ok(/^file:\/\/\/T:\/temp\/P%201%23%C3%B1_comandos_\d{6}\.txt$/.test(pt.blocs[0].url), pt.blocs[0].url);
});

console.log("%d pruebas bien", pruebas);
