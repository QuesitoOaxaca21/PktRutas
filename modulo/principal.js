// El módulo dentro de Packet Tracer: el menú, la barra y lo que toca los equipos.
// La lógica está en los demás archivos, que no saben de Packet Tracer.

var ANCHO = 280, ALTO = 24; // hasta que la página diga cuánto mide, en sus píxeles
var FONDO = 0xffffffff;     // para que no destelle en otro color mientras carga la página
var CADA = 500;             // cada cuánto se mira si abrieron otra práctica, en ms
var PASADAS = 3;            // cuántas veces se aplica mientras siga faltando algo
var VER = " (Ctrl+R)";      // al final de un aviso: Ver > Problemas tiene el detalle
var PISTA = "Todavía no hay notas con VLANs en el lienzo.\n\n" +
    "Pon una nota por router, con su nombre y sus VLANs:\n\n" +
    "    R1\n\n    VLAN 2/22\n        11.0.4.0 - 11.0.7.254 - 255.255.252.0\n" +
    "        ABCD:AB:AC:AD::4A0/126 - ABCD:AB:AC:AD::4A3/126\n\n" +
    "y otra junto a cada cable entre routers, con su enlace (.4).\n" +
    "Luego, Archivo > Volver a cargar (F5).";
var ARCHIVO_MODO = "pktrutas_modo.txt";    // en la carpeta de usuario de Packet Tracer
var _MENU = null, _VENTANA = null, _CTX = null, _BLOC = null, _REINTENTOS = null, _VIGIA = null, _LEIDO = "", _X = null, _Y = null, _ANCHO = 0, _ALTO = 0;
var _MODO = "activo";
// El Bloc de notas sólo se abre cuando pides los problemas. Lo que dejó lo último que hiciste (lo
// que IOS rechazó, las PCs sin IP, el pánico, un error) se guarda para entonces.
var _HECHO = [], _FALLO_LEER = "";

function main() {
    _cargarModo();
    var menu = ipc.appWindow().getMenuBar().getExtensionsPopupMenu();
    _MENU = menu.insertItem("", "PktRutas");
    menu.getMenuItemByUuid(_MENU).registerEvent("onClicked", null, abrirVentana);
    if (typeof AUTOABRIR !== "undefined" && AUTOABRIR) { abrirVentana(); }
}

function cleanUp() {
    if (_REINTENTOS !== null) { clearTimeout(_REINTENTOS); }
    if (_VIGIA !== null) { clearTimeout(_VIGIA); }
    if (_VENTANA !== null) { _VENTANA.close(); }
    if (_MENU !== null) { ipc.appWindow().getMenuBar().getExtensionsPopupMenu().removeItemUuid(_MENU); }
}

function abrirVentana() {
    if (_VENTANA === null) {
        _VENTANA = webViewManager.createWebView("PktRutas", "this-sm:ventana.htm", ANCHO, ALTO);
        _VENTANA.setBackgroundColor(FONDO);
        _VENTANA.enableRightClickMenu(false);
        // Dentro del lienzo de Packet Tracer, como una barra suya: se mueve con él, no se le
        // queda detrás ni tapa otras aplicaciones.
        _VENTANA.attachToMainViewArea();
        _colocar();
        _VENTANA.registerEvent("closed", null, function () { _VENTANA = null; });
        _VENTANA.show();
        _VENTANA.raise();
    } else {
        _VENTANA.show();
        _VENTANA.raise();
        _aUi("expandir", true);     // quien la pide en el menú quiere verla completa
        uiLista();
    }
}

// Packet Tracer amplía sus vistas según la escala de la pantalla (1.3 al 125 %), pero el
// tamaño se le da en píxeles reales. Abre en la esquina del lienzo, bajo sus barras, o donde
// la hayan dejado.
function _colocar() {
    var z = _VENTANA.getZoomFactor() || 1;
    if (_X === null) {
        _X = Math.round(8 * z);
        _Y = Math.round(4 * z);
    }
    _ANCHO = Math.ceil(ANCHO * z);
    _ALTO = Math.ceil(ALTO * z);
    _acomodar();
}

// La deja en su lugar sin salirse del lienzo. Un menú que no quepa hacia abajo la sube
// mientras esté abierto, y al cerrarlo regresa.
function _acomodar() {
    var a = ipc.appWindow();
    _VENTANA.setGeometry(Math.max(0, Math.min(_X, a.getMainViewAreaWidth() - _ANCHO)),
                         Math.max(0, Math.min(_Y, a.getMainViewAreaHeight() - _ALTO)), _ANCHO, _ALTO);
}

// La página pide lo que mide lo que enseña: una vista no dibuja fuera de su rectángulo, así
// que crece mientras haya un menú abierto. Se encima en el lienzo y no mueve nada de él.
function uiTamano(ancho, alto) {
    if (_VENTANA === null) { return; }
    var z = _VENTANA.getZoomFactor() || 1;
    _ANCHO = Math.ceil(ancho * z);
    _ALTO = Math.ceil(alto * z);
    _acomodar();
}

// Lo que se movió el ratón arrastrando el asa de la barra, en píxeles de pantalla.
function uiMover(dx, dy) {
    if (_VENTANA === null) { return; }
    var a = ipc.appWindow();
    _X = Math.max(0, Math.min(_X + dx, a.getMainViewAreaWidth() - _ANCHO));
    _Y = Math.max(0, Math.min(_Y + dy, a.getMainViewAreaHeight() - _ALTO));
    _acomodar();
}

function _aUi(funcion, datos) {
    if (_VENTANA !== null) { _VENTANA.evaluateJavaScriptAsync(funcion + "(" + JSON.stringify(datos) + ")"); }
}

function _nombreArchivo() {
    try {
        var guardado = ipc.appWindow().getActiveFile().getSavedFilename();
        if (guardado) { return guardado.split(/[\\/]/).pop(); }
    } catch (e) { }
    return "";
}

// Lo que haya que decir: un renglón bajo la barra, que se va solo.
function _aviso(mensaje) {
    _aUi("avisar", mensaje);
}

// --- leer ------------------------------------------------------------------------------

// Cuál archivo está abierto. Cada apertura crea un objeto nuevo, también al reabrir el
// mismo: por eso se compara esto y no el nombre.
function _idArchivo() {
    try { return String(ipc.appWindow().getActiveFile().getObjectUuid()); } catch (e) { return ""; }
}

function _leer(opciones) {
    _LEIDO = _idArchivo();      // antes de leer: si la lectura falla, no se reintenta sola
    _CTX = null;                // ni se queda lo de la práctica anterior
    _CTX = analizarXml(descifrarPkt(ipc.appWindow().fileSaveToBytes()),
                       { modo: _MODO, borrarTodo: !!(opciones && opciones.borrarTodo), cumplian: opciones && opciones.cumplian ? opciones.cumplian : null });
    return _CTX;
}

// --- el modo de Aplicar ------------------------------------------------------------------------
// Se guarda en un archivo: si eliges un modo pasivo, sigue así al volver a abrir Packet Tracer.

function _archivoModo() {
    var w = ipc.appWindow(), carpeta = "";
    try { carpeta = String(w.getUserFolder() || ""); } catch (e) { }
    if (!carpeta) { carpeta = String(w.getTempFileLocation()); }
    return carpeta.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + ARCHIVO_MODO;
}

function _cargarModo() {
    try {
        var f = ipc.systemFileManager(), ruta = _archivoModo();
        var m = f.fileExists(ruta) ? String(f.getFileContents(ruta)).trim() : "";
        if (MODOS.hasOwnProperty(m)) { _MODO = m; }
    } catch (e) { }
}

function _guardarModo() {
    try { ipc.systemFileManager().writePlainTextToFile(_archivoModo(), _MODO + "\n"); } catch (e) { }
}

// "Pasivo estricto: " delante de lo que diga el aviso, o nada en activo.
function _conModo(texto) {
    var p = _CTX ? _CTX.pasivo : null;
    if (!p) { return texto; }
    var nombre = MODOS[p.modo].nombre, fuera = p.noCumplen.length;
    return nombre.charAt(0).toUpperCase() + nombre.substring(1) + ": " + texto.charAt(0).toLowerCase() + texto.substring(1)
        + (fuera && p.cumplen.length ? ", " + fuera + " no " + (fuera === 1 ? "cumple" : "cumplen") : "");
}

// La página ya lo eligió. Se vuelve a leer: cambia lo que se aplica y lo que se avisa.
function uiModo(m) {
    if (!MODOS.hasOwnProperty(m)) { return; }
    _MODO = m;
    _guardarModo();
    _aUi("modo", _MODO);
    try {
        _leer();
    } catch (e) {
        _falloLeer(e);
        return;
    }
    var estado = _estadoLeido();
    _mostrar(_MODO === "activo" ? "Activo: " + estado.charAt(0).toLowerCase() + estado.substring(1) : estado);
}

// Con la barra abierta, abrir una práctica la actualiza sola. Packet Tracer pone su lienzo
// nuevo encima de la barra: hay que volver a subirla.
function _vigilar() {
    _VIGIA = null;
    if (_VENTANA === null) { return; }
    _acomodar();        // por si Packet Tracer cambió de tamaño
    if (_idArchivo() !== _LEIDO) {
        _VENTANA.raise();
        _revisar(false);
    }
    _VIGIA = setTimeout(_vigilar, CADA);
}

function _estadoLeido() {
    if (!_CTX.plan.sitios.length) { return "Sin notas con VLANs"; }
    // Lo inalámbrico se pone en cualquier modo: Aplicar sirve aunque nadie cumpla.
    if (_CTX.pasivo && !_CTX.pasivo.cumplen.length) {
        return _conModo("Ningún equipo cumple todavía" + (_CTX.inalambrico.pendiente ? "; falta lo inalámbrico" : ""));
    }
    return _conModo(_pendiente());
}

function _pendiente() {
    var c = _CTX.combos, pend = _CTX.bloques.length, malos = Object.keys(_CTX.motivos).length;
    if (!pend && !c.malos && _CTX.inalambrico.pendiente) { return "Falta lo inalámbrico"; }
    if (pend && c.malos) { return pend + " por configurar, " + c.malos + (c.malos === 1 ? " combo mal" : " combos mal"); }
    if (pend && malos) { return pend + " por configurar, " + malos + (malos === 1 ? " se borra" : " se borran"); }
    if (pend) { return pend + (pend === 1 ? " equipo" : " equipos") + " por configurar"; }
    if (c.malos) { return c.malos + (c.malos === 1 ? " combo mal" : " combos mal") + " en las notas"; }
    var r = _CTX.renombres.length;
    if (r) { return r + (r === 1 ? " PC por renombrar" : " PCs por renombrar"); }
    return "No falta nada";
}

function _mostrar(mensaje) {
    _aviso(mensaje || _estadoLeido());
    _aUi("mostrar", { pendientes: _CTX.bloques.length + (_CTX.inalambrico.pendiente ? 1 : 0) + (_CTX.renombres.length ? 1 : 0),
                      panico: _CTX.combos.panico, modo: _MODO });
}

// Lo que salió mal: el aviso dice qué, y Ver > Problemas el detalle.
function _fallo(titulo, detalle) {
    _anotar((titulo + ": " + detalle).toLowerCase());
    _aviso(titulo + VER);
    _aUi("fallo", true);
}

// Sin la práctica leída no hay problemas que enseñar: Ver dice por qué no se pudo leer.
function _falloLeer(e) {
    _FALLO_LEER = ("no se pudo leer la práctica: " + e).toLowerCase();
    _aviso("No se pudo leer la práctica" + VER);
    _aUi("fallo", true);
}

function _anotar(texto) {
    if (_HECHO.indexOf(texto) < 0) { _HECHO.push(texto); }
}

// Para el final de un aviso, si lo último que hiciste dejó algo en Ver > Problemas.
function _pista() {
    return _HECHO.length ? VER : "";
}

function uiLista() {
    _aUi("modo", _MODO);       // aunque la práctica no se pueda leer, la barra dice en qué modo está
    _revisar(false);
    if (_VIGIA === null) { _VIGIA = setTimeout(_vigilar, CADA); }
}

function uiReleer() { _revisar(true); }

// Lee la práctica y dice en el aviso cómo va; no abre nada. Lo que dejó lo último que hiciste se
// olvida al abrir otra práctica, o con F5 (reiniciar).
function _revisar(reiniciar) {
    if (reiniciar || _idArchivo() !== _LEIDO) {
        _HECHO = [];
        _BLOC = null;
    }
    try {
        _leer();
    } catch (e) {
        _falloLeer(e);
        return;
    }
    _mostrar();
}

// Lo de la práctica abierta, o lo vuelve a leer si no se pudo antes. Si tampoco, null.
function _contexto() {
    if (_CTX === null) {
        try {
            _leer();
        } catch (e) {
            _falloLeer(e);
        }
    }
    return _CTX;
}

// Si ya no falta nada, la configuración completa.
function _comandos() {
    return _CTX.bloques.length ? _CTX.bloques : _CTX.completos;
}

// Los problemas de las notas; al pie, lo que se supuso y lo inalámbrico que falta. Eso no lleva
// comandos (aplicar lo escribe en la práctica): va aquí por si lo quieres ver, con sus mayúsculas.
function _textoProblemas() {
    var partes = [textoProblemas(_CTX).replace(/\n+$/, "")];
    var supuestos = _CTX.plan.supuestos.concat(_CTX.correcciones.supuestos, _CTX.inalambrico.supuestos);
    if (supuestos.length) { partes.push("se supuso:\n" + supuestos.join("\n").toLowerCase()); }
    if (_CTX.inalambrico.pendiente) { partes.push("lo inalámbrico lo pone aplicar, sin comandos:\n" + textoInalambrico(_CTX.inalambrico).join("\n")); }
    return partes.filter(function (p) { return p; }).join("\n\n") || "sin problemas";
}

// --- Bloc de notas ---------------------------------------------------------------------

function _rutaBloc() {
    var nombre = _nombreArchivo().replace(/\.[^.]*$/, "") || "practica";
    var hora = new Date().toTimeString().substring(0, 8).replace(/:/g, "");
    return ipc.appWindow().getTempFileLocation().replace(/\\/g, "/") + "/" + nombre + "_problemas_" + hora + ".txt";
}

// Un texto nuevo va en un archivo nuevo: el Bloc de notas no vuelve a cargar el que ya tiene abierto.
function _abrirBloc(texto) {
    var igual = _BLOC !== null && _BLOC.texto === texto;
    var ruta = igual ? _BLOC.ruta : _rutaBloc();
    if (!igual) { ipc.systemFileManager().writePlainTextToFile(ruta, texto.replace(/\n+$/, "") + "\n"); }
    _BLOC = { texto: texto, ruta: ruta };
    ipc.appWindow().openURL("file:///" + encodeURI(ruta).replace(/#/g, "%23"));
}

// Lo único que abre el Bloc de notas. Arriba va lo que dejó lo último que hiciste, y luego los
// problemas de las notas; sin notas, cómo escribirlas.
function uiVerProblemas() {
    var partes = _HECHO.slice();
    partes.push(!_contexto() ? _FALLO_LEER : _CTX.plan.sitios.length ? _textoProblemas() : PISTA);
    _abrirBloc(partes.join("\n\n"));
}

// --- copiar y guardar ------------------------------------------------------------------

function _aPortapapeles(texto) {
    ipc.appWindow().setClipboardText(texto);
}

function uiCopiarTodo() {
    if (!_contexto()) { return; }
    var lista = _comandos();
    if (!lista.length) {
        _aviso("Todavía no hay comandos");
        return;
    }
    _aPortapapeles(textoBloques(lista));
    _aviso("Copiados " + lista.length + (lista.length === 1 ? " equipo" : " equipos"));
}

function uiGuardarComandos() {
    if (!_contexto()) { return; }
    var lista = _comandos();
    if (!lista.length) {
        _aviso("Todavía no hay comandos");
        return;
    }
    var f = ipc.systemFileManager();
    var w = ipc.appWindow();
    var guardado = "";
    try { guardado = w.getActiveFile().getSavedFilename() || ""; } catch (e) { }
    var sugerido = guardado ? guardado.replace(/\.[^.\\/]*$/, "") + "_comandos.txt" : w.getDefaultFileSaveLocation() + "/comandos.txt";
    var ruta = f.getSaveFileName("Guardar comandos", sugerido, "Texto (*.txt);;Todos (*.*)");
    if (!ruta) { return; }
    if (f.writePlainTextToFile(ruta, textoBloques(lista))) {
        _aviso("Guardado " + ruta.split(/[\\/]/).pop());
    } else {
        _fallo("No se pudo guardar", ruta);
    }
}

function uiCerrar() {
    if (_VENTANA !== null) { _VENTANA.close(); }
}

// --- aplicar ----------------------------------------------------------------------------

function _aPrivilegiado(t) {
    var modo = t.getMode();
    if (modo === "logout" || modo === "") {
        t.enterCommand("");
        modo = t.getMode();
    }
    // El diálogo de la primera vez: 'Continue with configuration dialog? [yes/no]'.
    if (modo === "setup" || /yes\/no/i.test(t.getPrompt())) {
        t.enterCommand("no");
        t.enterCommand("");
        modo = t.getMode();
    }
    if (modo !== "user" && modo !== "enable") {
        t.enterCommand("end");
        modo = t.getMode();
    }
    if (modo === "user") { t.enterCommand("enable"); }
    return t.getMode() === "enable";
}

// Devuelve lo que IOS rechazó, en minúsculas. Un 3560 no conoce IPv6 hasta cambiar
// su plantilla SDM y reiniciarse: ese se deja reiniciando y se termina al volver.
function _aplicarEquipo(b, reinician) {
    var d = ipc.network().getDevice(b.equipo);
    if (!d) { return [b.nombre + ": no está en la red"]; }
    if (d.isBooting && d.isBooting()) { return [b.nombre + ": sigue arrancando; vuelve a aplicar en un momento"]; }
    var t = d.getCommandLine();
    if (!_aPrivilegiado(t)) { return [b.nombre + ": no se pudo entrar a modo privilegiado (¿tiene contraseña?)"]; }
    var eco = "";
    var oyente = function (src, args) { eco += args.newOutput; };
    t.registerEvent("outputWritten", null, oyente);
    var errores = [], cortar = false, borrando = false;
    function manda(c, callado) {
        eco = "";
        t.enterCommand(c);
        var m = /^(?:% |Command rejected).*$/m.exec(eco);
        if (m && !callado) { errores.push((b.nombre + ": " + c + " -> " + m[0]).toLowerCase()); }
        return !m;
    }
    manda("configure terminal");
    b.lineas.forEach(function (l) {
        var c = l.trim();
        if (c === MARCA_BORRA || c === MARCA_PONE) { borrando = c === MARCA_BORRA; }
        if (cortar || !c || c[0] === "!") { return; }
        if (c === "ipv6 unicast-routing" && !manda(c, true)) {
            if (reinician && manda("sdm prefer dual-ipv4-and-ipv6 default", true)) {
                manda("end");
                manda("write memory");
                t.enterCommand("reload");
                t.enterCommand("");
                reinician.push(b.equipo);
                cortar = true;
            } else {
                errores.push((b.nombre + ": " + c + " -> no lo acepta").toLowerCase());
            }
            return;
        }
        manda(c, borrando);
    });
    if (!cortar) {
        manda("end");
        manda("write memory");
    }
    t.unregisterEvent("outputWritten", null, oyente);
    return errores;
}

// Sin IP, o con una que no es de su VLAN: la que traía de antes, de un pool mal puesto.
function _pcsMal() {
    var malas = [];
    (_CTX ? _CTX.pcs : []).forEach(function (p) {
        if (p.reservado) { return; }
        var d = ipc.network().getDevice(p.pc);
        if (!d) { return; }
        var ip = String(d.getPortAt(0).getIpAddress());
        if (ip === "0.0.0.0" || ip === "" || ip.indexOf("169.254.") === 0 || (p.red && !contiene(p.red, ip))) { malas.push(p); }
    });
    return malas;
}

// La IP de su red, pero la puerta de otro: su puerta sólo se ve en el archivo.
function _pcsConOtraPuerta() {
    var malas = [];
    try {
        var topo = leerTopologia(descifrarPkt(ipc.appWindow().fileSaveToBytes()));
        (_CTX ? _CTX.pcs : []).forEach(function (p) {
            var d = topo.porNombre(p.pc);
            if (!p.reservado && !p.telefono && d && p.gateway && d.gateway !== p.gateway) { malas.push(p); }
        });
    } catch (e) { }
    return malas;
}

function _pedirDhcp(pcs) {
    pcs.forEach(function (p) {
        var d = p.telefono ? null : ipc.network().getDevice(p.pc);
        if (d) {
            d.setDhcpFlag(false);
            d.setDhcpFlag(true);
        }
    });
}

// Las PCs en DHCP. Las de un equipo al que se le puso su pool piden otra vez aunque tengan IP: la
// que traen puede ser de un pool malo, o darse de nuevo a otra PC. Mientras el switch levanta sus
// puertos el pedido no llega al router: se reintenta unas veces y el aviso dice cuántas ya están
// bien. Si ya abrieron otra práctica se deja: sus PCs pueden llamarse igual y no se aplicó nada ahí.
function _pedirIps(intento, archivo, renovar) {
    _REINTENTOS = null;
    if (_CTX === null || _idArchivo() !== archivo) { return; }
    var total = _CTX.pcs.filter(function (p) { return !p.reservado; }).length;
    if (!total) { return; }
    var siguiente = function () { _REINTENTOS = setTimeout(function () { _pedirIps(intento + 1, archivo); }, 5000); };
    if (intento === 0 && renovar) {
        var de = _CTX.pcs.filter(function (p) { return !p.reservado && renovar[p.dueno]; });
        if (de.length) {
            _pedirDhcp(de);
            _aviso("DHCP: pidiendo IP a " + de.length + " PCs...");
            siguiente();
            return;
        }
    }
    var faltan = _pcsMal();
    if (!faltan.length) { faltan = _pcsConOtraPuerta(); }
    if (!faltan.length) {
        _aviso(total + " de " + total + " PCs con IP" + _pista());
        return;
    }
    // Un teléfono tarda más: espera a que su AP se una a la controladora. Tras reabrir la práctica, con
    // el core arrancando, en Packet Tracer se midieron de 100 a 160 s.
    if (intento >= (faltan.some(function (p) { return p.telefono; }) ? 48 : 14)) {
        _anotar("se pidió dhcp y estas pcs no quedaron en su red: " + faltan.map(function (p) { return p.pc; }).join(", ").toLowerCase());
        _aviso((total - faltan.length) + " de " + total + " PCs con IP; revísalas" + _pista());
        return;
    }
    _pedirDhcp(faltan);
    _aviso("DHCP: " + (total - faltan.length) + " de " + total + " PCs con IP...");
    siguiente();
}

function _ponerDhcp() {
    (_CTX ? _CTX.pcs : []).forEach(function (p) {
        var d = p.telefono ? null : ipc.network().getDevice(p.pc);
        if (d && d.getDhcpFlag && !d.getDhcpFlag()) { d.setDhcpFlag(true); }
    });
}

// Las PCs que traían su VLAN en el nombre ('PC1 V3') vuelven a su nombre original en cuanto esa VLAN
// quedó en su puerto: analizarXml las junta en `renombres`. Un nombre que ya es de otro, no.
function _renombrar() {
    var red = ipc.network(), hechas = 0;
    _CTX.renombres.forEach(function (r) {
        var d = red.getDevice(r.pc);
        if (d && !red.getDevice(r.nuevo)) {
            d.setName(r.nuevo);
            hechas++;
        }
    });
    return hechas;
}

// Lo que no tiene comando se escribe en la práctica y se vuelve a abrir desde memoria: los equipos
// reinician con su configuración, y el archivo guardado no se toca hasta que tú guardes.
function _aplicarInalambrico() {
    var w = ipc.appWindow();
    var nuevo = parchearInalambrico(descifrarPkt(w.fileSaveToBytes()), _CTX.inalambrico);
    var ruta = "";
    try { ruta = w.getActiveFile().getSavedFilename() || ""; } catch (e) { }
    var r = w.fileOpenFromBytes(cifrarPkt(nuevo), ruta);
    if (String(r) !== "0") { throw new Error("packet tracer no pudo abrirla (" + r + ")"); }
    _LEIDO = _idArchivo();
    // Su lienzo nuevo queda encima de la barra, y tarda un momento en aparecer.
    [0, 500, 1500].forEach(function (ms) {
        setTimeout(function () { if (_VENTANA !== null) { _VENTANA.raise(); } }, ms);
    });
}

function _aplicarTodo(mensaje, alTerminar, opciones) {
    _leer(opciones);
    // En pasivo, lo que cumple al empezar sigue hasta terminar: a media aplicación un equipo puede
    // estar borrado, o reiniciando para IPv6, y ya no traer lo que el modo pide.
    var cumplian = _CTX.pasivo ? _CTX.pasivo.cumplen.slice() : null;
    function releer() { _leer({ cumplian: cumplian }); }
    var archivo = _LEIDO, errores = [], reinician = [], conPool = {}, borrados = {};
    function pasada(cuales, quienReinicia) {
        errores = [];
        cuales.forEach(function (b) {
            if (b.lineas.indexOf(MARCA_BORRA) >= 0) { borrados[b.equipo] = true; }
            if (b.lineas.some(function (l) { return l.indexOf("ip dhcp pool ") === 0 || l.indexOf("no ip dhcp pool ") === 0; })) { conPool[b.equipo] = true; }
            errores = errores.concat(_aplicarEquipo(b, quienReinicia));
        });
    }
    var aplicados = _CTX.bloques.length;
    pasada(_CTX.bloques, reinician);
    _ponerDhcp();

    function terminar() {
        releer();
        // Lo que todavía falte se intenta otra vez: un equipo recién borrado ya no estorba.
        for (var n = 1; n < PASADAS && _CTX.bloques.length; n++) {
            pasada(_CTX.bloques, null);
            releer();
        }
        var inalambrico = _CTX.inalambrico.pendiente;
        if (inalambrico) {
            _aplicarInalambrico();
            archivo = _LEIDO;
            releer();
        }
        var renombradas = _renombrar();
        if (renombradas) { releer(); }     // las PCs de DHCP, ya con su nombre
        var cuantos = Object.keys(borrados).length;
        var hecho = aplicados || !inalambrico ? "Aplicado a " + aplicados + (aplicados === 1 ? " equipo" : " equipos") + (inalambrico ? " y lo inalámbrico" : "")
            : "Aplicado lo inalámbrico";
        if (renombradas && !aplicados && !inalambrico) { hecho = renombradas + (renombradas === 1 ? " PC volvió a su nombre" : " PCs volvieron a su nombre"); }
        if (errores.length) { _anotar("ios rechazó:\n" + errores.join("\n")); }
        _mostrar((mensaje || (_conModo(hecho + (cuantos ? ", " + cuantos + (cuantos === 1 ? " se borró" : " se borraron") : ""))
                              + (inalambrico ? "; guarda la práctica" : ""))) + _pista());
        if (_REINTENTOS !== null) { clearTimeout(_REINTENTOS); }
        _REINTENTOS = setTimeout(function () { _pedirIps(0, archivo, conPool); }, 3000);
        if (alTerminar) { alTerminar(errores); }
    }
    if (!reinician.length) {
        terminar();
        return;
    }
    // Los que reiniciaron por IPv6 (arrancan en unos segundos): se termina con ellos.
    var vueltas = 0;
    function espera() {
        if (_idArchivo() !== archivo) { return; }   // abrieron otra: ésos ya no están
        var siguen = reinician.filter(function (n) {
            var d = ipc.network().getDevice(n);
            return d && d.isBooting();
        });
        if (siguen.length && vueltas++ < 45) {
            _aviso("Reiniciando " + siguen.length + " para IPv6...");
            setTimeout(_seguro(espera), 2000);
            return;
        }
        releer();
        pasada(_CTX.bloques.filter(function (b) { return reinician.indexOf(b.equipo) >= 0; }), null);
        terminar();
    }
    setTimeout(_seguro(espera), 2000);
}

// Lo que corre después, en un temporizador, también avisa si falla: si no, los botones se
// quedarían apagados para siempre.
function _seguro(f) {
    return function () {
        try {
            f();
        } catch (e) {
            _fallo("No se pudo aplicar", e);
        }
    };
}

// Empieza algo nuevo (aplicar, borrar todo, el pánico): lo que dejó lo anterior ya no cuenta.
function _ocupado(texto) {
    _HECHO = [];
    _aviso(texto);
    _aUi("ocupado", true);
}

function uiAplicar() {
    _ocupado("Aplicando...");
    // Un respiro para que la ventana pinte antes de ponerse a teclear en los equipos.
    setTimeout(_seguro(function () { _aplicarTodo(); }), 30);
}

// La página ya pidió que se confirme.
function uiBorrarTodo() {
    _ocupado("Borrando y aplicando...");
    setTimeout(_seguro(function () { _aplicarTodo(undefined, undefined, { borrarTodo: true }); }), 30);
}

// --- pánico -----------------------------------------------------------------------------

function _reescribirNotas(cambios) {
    var w = ipc.appWindow().getActiveWorkspace().getLogicalWorkspace();
    var todas = _CTX.topo.notas;
    var nuevos = new Map();
    cambios.forEach(function (x) { nuevos.set(x.nota, x.texto); });
    // Cada nota se quita y se vuelve a poner: changeNoteText guarda el texto, pero la deja
    // sin dibujar hasta reabrir el archivo. Y una pegada con Ctrl+V comparte su uuid con la
    // original y la API sólo alcanza a la primera: las hermanas van juntas y cada una
    // queda con uuid propio.
    var porUuid = {};
    todas.forEach(function (n) { (porUuid[n.uuid] = porUuid[n.uuid] || []).push(n); });
    var hechas = {};
    cambios.forEach(function (x) {
        var u = x.nota.uuid;
        if (hechas[u]) { return; }
        hechas[u] = true;
        var hermanas = porUuid[u];
        hermanas.forEach(function () { w.removeCanvasItem(u); });
        hermanas.forEach(function (n) {
            var texto = nuevos.has(n) ? nuevos.get(n) : n.original;
            var id = w.addNote(n.x, n.y, n.z, texto);
            w.setCanvasItemRealPos(id, n.x, n.y);
        });
    });
}

function uiPanico() {
    _ocupado("Pánico...");
    setTimeout(function () {
        try {
            _leer();
            if (!_CTX.combos.panico) {
                _mostrar("Pánico: no hace falta");
                return;
            }
            var sel = seleccionPanico(_CTX.combos);
            var antes = _CTX.combos.porcentaje;
            if (!sel.elegidos.length) {
                _anotar("pánico: ningún error es pequeño, no se tocó nada");
                _mostrar("Pánico: ningún error es pequeño" + _pista());
                return;
            }
            var hechos = sel.elegidos.map(function (c) {
                return ("corregido: " + c.equipo + " vlan " + c.vlan + (c.familia === "ipv6" ? " ipv6" : "")).toLowerCase();
            });
            _reescribirNotas(notasCorregidas(sel.elegidos));
            _leer();
            var despues = _CTX.combos.porcentaje;
            _anotar("pánico: de " + antes + "% a " + despues + "% de combos bien\n" + hechos.join("\n"));
            _aplicarTodo("Pánico: de " + antes + "% a " + despues + "% bien");
        } catch (e) {
            _fallo("Pánico: no se pudo", e);
        }
    }, 30);
}
