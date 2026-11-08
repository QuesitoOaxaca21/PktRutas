// Prueba dentro de Packet Tracer: se mete a una copia de la práctica junto con el
// módulo, corre sin clics y deja el resultado en un JSON. Nunca va en el .pts.
var AUTOABRIR = true;
var _PRUEBA = { salida: "", pasos: PASOS_PRUEBA };
var _R = { pasos: [], bloc: [] };

function _anota(k, v) {
    _R[k] = v;
    ipc.systemFileManager().writePlainTextToFile(SALIDA_PRUEBA, JSON.stringify(_R, null, 1));
}

function _configDe(nombre) {
    var x = ipc.network().getDevice(nombre).serializeToXml();
    var i = x.indexOf("<RUNNINGCONFIG>"), f = x.indexOf("</RUNNINGCONFIG>", i);
    if (i < 0) { return []; }
    var utiles = [];
    x.substring(i, f).split("<LINE>").slice(1).forEach(function (l) {
        var t = l.split("</LINE>")[0];
        if (t.trim() && t.trim() !== "!" && !/^(version|no service|service |spanning-tree mode|line |login|end|no ip cef|no ipv6 cef|ip cef| duplex| speed|license|ip flow-export|ip classless| password)/.test(t)) {
            utiles.push(t);
        }
    });
    return utiles;
}

function _fotografia(etiqueta) {
    var red = ipc.network(), foto = { equipos: {}, pcs: {} };
    for (var i = 0; i < red.getDeviceCount(); i++) {
        var d = red.getDeviceAt(i), nombre = d.getName(), tipo = d.getType();
        if (tipo === 8) {
            var p = d.getPortAt(0);
            foto.pcs[nombre] = { ip: String(p.getIpAddress()), mascara: String(p.getSubnetMask()), dhcp: d.getDhcpFlag(),
                                 gw: String(d.getDefaultGateway ? d.getDefaultGateway() : "") };
        } else if (tipo === 0 || tipo === 1 || tipo === 16 || tipo === 17) {
            foto.equipos[nombre] = _configDe(nombre);
        }
    }
    _anota(etiqueta, foto);
}

function _modos() {
    var red = ipc.network(), m = {};
    for (var i = 0; i < red.getDeviceCount(); i++) {
        var d = red.getDeviceAt(i), tipo = d.getType();
        if (tipo === 0 || tipo === 1 || tipo === 16 || tipo === 17) {
            var t = d.getCommandLine();
            m[d.getName()] = { modo: t.getMode(), prompt: t.getPrompt() };
        }
    }
    return m;
}

var _mainReal = main;
main = function () {
    _abrirBloc = function (tipo, texto, siempre) { _R.bloc.push(texto); _anota("bloc", _R.bloc); return true; };
    _aPortapapeles = function () { };
    _mainReal();
    setTimeout(_siguientePaso, 1500);
};

var _ipaso = 0;
function _siguientePaso() {
    if (_ipaso >= _PRUEBA.pasos.length) {
        _anota("fin", new Date().toString());
        return;
    }
    var paso = _PRUEBA.pasos[_ipaso++];
    try {
        paso[1]();
        _R.pasos.push(paso[0] + ": ok");
    } catch (e) {
        _R.pasos.push(paso[0] + ": ERROR " + e + " " + (e.stack || ""));
    }
    _anota("pasos", _R.pasos);
    setTimeout(_siguientePaso, paso[2] || 500);
}
