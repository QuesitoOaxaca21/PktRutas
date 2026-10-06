"""Descifra archivos .pkt / .pka de Cisco Packet Tracer y devuelve el XML.

Packet Tracer ha usado dos formatos:

  * Clasico (hasta ~PT 8.1): XOR posicional descendente + qCompress (zlib).
  * Moderno (PT 8.2 y posteriores, incluido 9.x): una capa extra de
    ofuscacion, cifrado Twofish en modo EAX con clave e IV fijos, y despues
    el mismo XOR + zlib del formato clasico.

Se prueban todas las combinaciones conocidas y se devuelve la primera que
produzca XML valido, asi el programa funciona sin saber de antemano con que
version se guardo el archivo.
"""

from __future__ import annotations

import struct
import zlib

from .twofish import Twofish

BLOQUE = 16

# Clave e IV fijos que Packet Tracer incrusta en el ejecutable.
_CLAVE = bytes([0x89]) * 16
_IV = bytes([0x10]) * 16


# --------------------------------------------------------------------------
# Utilidades de bytes
# --------------------------------------------------------------------------

def _xor(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def _xor_grande(datos: bytes, patron: bytes) -> bytes:
    """XOR de un buffer largo contra un patron de 256 bytes que se repite.

    Usa enteros grandes en lugar de un bucle por byte: para archivos de
    varios MB la diferencia es de segundos.
    """
    n = len(datos)
    if n == 0:
        return b""
    completo = (patron * (n // len(patron) + 1))[:n]
    return (int.from_bytes(datos, "big") ^ int.from_bytes(completo, "big")).to_bytes(n, "big")


def desofuscar_1(datos: bytes) -> bytes:
    """Etapa 1: invierte el orden de los bytes y aplica una mascara posicional."""
    n = len(datos)
    patron = bytes(((n - i * n) & 0xFF) for i in range(256))
    return _xor_grande(datos[::-1], patron)


def desofuscar_2(datos: bytes) -> bytes:
    """Etapa 2: XOR con un contador que decrece desde la longitud del archivo."""
    n = len(datos)
    patron = bytes(((n - i) & 0xFF) for i in range(256))
    return _xor_grande(datos, patron)


def descomprimir_qt(blob: bytes) -> bytes:
    """Deshace qCompress de Qt: 4 bytes big-endian de tamano + flujo zlib."""
    if len(blob) < 5:
        raise ValueError("bloque comprimido demasiado corto")
    tam = struct.unpack(">I", blob[:4])[0]
    return zlib.decompress(blob[4:])[:tam]


# --------------------------------------------------------------------------
# CMAC / CTR / EAX sobre Twofish
# --------------------------------------------------------------------------

def _dbl(bloque: bytes) -> bytes:
    v = int.from_bytes(bloque, "big") << 1
    if bloque[0] & 0x80:
        v ^= 0x87
    return (v & ((1 << 128) - 1)).to_bytes(16, "big")


class CMAC:
    def __init__(self, cifrar):
        self.cifrar = cifrar
        k1 = _dbl(cifrar(bytes(BLOQUE)))
        self.k1 = k1
        self.k2 = _dbl(k1)

    def digest(self, mensaje: bytes) -> bytes:
        n = len(mensaje)
        if n and n % BLOQUE == 0:
            cuerpo, ultimo = mensaje[:-BLOQUE], _xor(mensaje[-BLOQUE:], self.k1)
        else:
            resto = n % BLOQUE
            relleno = mensaje[n - resto:] + b"\x80"
            relleno += b"\x00" * (BLOQUE - len(relleno))
            cuerpo, ultimo = mensaje[:n - resto], _xor(relleno, self.k2)
        x = bytes(BLOQUE)
        for i in range(0, len(cuerpo), BLOQUE):
            x = self.cifrar(_xor(x, cuerpo[i:i + BLOQUE]))
        return self.cifrar(_xor(x, ultimo))


def _ctr(cifrar, contador: bytes, datos: bytes) -> bytes:
    c = int.from_bytes(contador, "big")
    salida = bytearray(len(datos))
    tope = 1 << 128
    for i in range(0, len(datos), BLOQUE):
        flujo = cifrar((c % tope).to_bytes(16, "big"))
        trozo = datos[i:i + BLOQUE]
        salida[i:i + len(trozo)] = _xor(trozo, flujo[:len(trozo)])
        c += 1
    return bytes(salida)


def _omac(cmac: CMAC, t: int, datos: bytes) -> bytes:
    return cmac.digest(bytes(BLOQUE - 1) + bytes([t]) + datos)


def eax_descifrar(clave, nonce, texto, tag=None, verificar=False) -> bytes:
    """EAX sobre Twofish.

    La verificacion del tag es opcional: recorrer todo el texto cifrado con
    CMAC duplica el tiempo y para leer el XML no hace falta autenticar.
    """
    tf = Twofish(clave)
    cmac = CMAC(tf.encrypt)
    n_tag = _omac(cmac, 0x00, nonce)
    claro = _ctr(tf.encrypt, n_tag, texto)
    if verificar:
        if tag is None:
            raise ValueError("falta el tag de autenticacion")
        esperado = _xor(_xor(n_tag, _omac(cmac, 0x01, b"")), _omac(cmac, 0x02, texto))
        if esperado != tag:
            raise ValueError("fallo la autenticacion EAX")
    return claro


def eax_cifrar(clave, nonce, claro, aad=b""):
    """El inverso de eax_descifrar; con cifrar_pkt arma un .pkt nuevo."""
    tf = Twofish(clave)
    cmac = CMAC(tf.encrypt)
    n_tag = _omac(cmac, 0x00, nonce)
    texto = _ctr(tf.encrypt, n_tag, claro)
    tag = _xor(_xor(n_tag, _omac(cmac, 0x01, aad)), _omac(cmac, 0x02, texto))
    return texto, tag


# --------------------------------------------------------------------------
# Canalizaciones completas
# --------------------------------------------------------------------------

def _pipeline_moderno(datos: bytes, verificar: bool) -> bytes:
    etapa1 = desofuscar_1(datos)
    if len(etapa1) <= BLOQUE:
        raise ValueError("archivo demasiado corto")
    claro = eax_descifrar(_CLAVE, _IV, etapa1[:-BLOQUE], etapa1[-BLOQUE:], verificar)
    return descomprimir_qt(desofuscar_2(claro))


def _pipeline_clasico(datos: bytes) -> bytes:
    return descomprimir_qt(desofuscar_2(datos))


def _pipeline_clasico_invertido(datos: bytes) -> bytes:
    return descomprimir_qt(desofuscar_1(datos))


def _pipeline_zlib_directo(datos: bytes) -> bytes:
    return zlib.decompress(desofuscar_2(datos))


_ESTRATEGIAS = (
    ("PT 8.2 - 9.x (Twofish/EAX)", lambda d: _pipeline_moderno(d, False)),
    ("PT 5 - 8.1 (XOR + zlib)", _pipeline_clasico),
    ("PT clasico invertido", _pipeline_clasico_invertido),
    ("zlib sin cabecera de tamano", _pipeline_zlib_directo),
)


def _parece_xml(datos: bytes) -> bool:
    cabeza = datos.lstrip()[:200].lower()
    return cabeza.startswith(b"<?xml") or cabeza.startswith(b"<")


def descifrar_pkt(datos: bytes):
    """Devuelve (xml, nombre_de_la_estrategia_que_funciono)."""
    if datos[:2] == b"PK":
        raise ValueError(
            "El archivo parece un .pkz (comprimido). Abrelo en Packet Tracer y "
            "guardalo como .pkt antes de analizarlo."
        )
    errores = []
    for nombre, fn in _ESTRATEGIAS:
        try:
            xml = fn(datos)
        except Exception as exc:  # cada estrategia falla de forma distinta
            errores.append("  - %s: %s" % (nombre, exc))
            continue
        if _parece_xml(xml):
            return xml, nombre
        errores.append("  - %s: descomprimio pero no produjo XML" % nombre)
    raise ValueError(
        "No se pudo descifrar el archivo con ningun formato conocido.\n"
        + "\n".join(errores)
    )


def descifrar_archivo(ruta):
    with open(ruta, "rb") as f:
        return descifrar_pkt(f.read())


def cifrar_pkt(xml: bytes, nivel: int = 6) -> bytes:
    """Arma un .pkt del formato de PT 8.2 - 9.x: el camino inverso de
    _pipeline_moderno (qCompress, contador XOR, Twofish-EAX, máscara e
    inversión). Las dos capas XOR son su propia inversa."""
    comprimido = struct.pack(">I", len(xml)) + zlib.compress(xml, nivel)
    texto, tag = eax_cifrar(_CLAVE, _IV, desofuscar_2(comprimido))
    bruto = texto + tag
    n = len(bruto)
    patron = bytes(((n - i * n) & 0xFF) for i in range(256))
    return _xor_grande(bruto, patron)[::-1]
