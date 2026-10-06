"""Prueba de ida y vuelta del descifrado: arma un .pkt sintetico y lo abre."""
import struct
import zlib

from pkt import descifrar as d
from pkt.twofish import selftest


def ofuscar_1(x: bytes) -> bytes:
    """Inversa de desofuscar_1 (lo que hace Packet Tracer al guardar)."""
    n = len(x)
    patron = bytes(((n - i * n) & 0xFF) for i in range(256))
    return d._xor_grande(x, patron)[::-1]


def main():
    selftest()
    print("[ok] Twofish contra los vectores oficiales")

    xml = b'<?xml version="1.0"?><PACKETTRACER5><NETWORK/></PACKETTRACER5>' * 40
    comp = struct.pack(">I", len(xml)) + zlib.compress(xml)

    clasico = d.desofuscar_2(comp)
    salida, cual = d.descifrar_pkt(clasico)
    assert salida == xml, "fallo el formato clasico"
    print("[ok] formato clasico ->", cual)

    etapa2 = d.desofuscar_2(comp)
    texto, tag = d.eax_cifrar(d._CLAVE, d._IV, etapa2)
    moderno = ofuscar_1(texto + tag)
    assert d.desofuscar_1(moderno) == texto + tag, "la etapa 1 no se invierte"
    salida, cual = d.descifrar_pkt(moderno)
    assert salida == xml, "fallo el formato moderno"
    print("[ok] formato moderno ->", cual)

    et1 = d.desofuscar_1(moderno)
    d.eax_descifrar(d._CLAVE, d._IV, et1[:-16], et1[-16:], verificar=True)
    print("[ok] tag EAX verificado")


if __name__ == "__main__":
    main()
