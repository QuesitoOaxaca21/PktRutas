"""Cifrador por bloques Twofish (128 bits) en Python puro.

Solo se usa la operacion de cifrado de bloque: los modos CTR y CMAC que
necesita EAX nunca invocan el descifrado. Aun asi se incluye decrypt_block
para poder validar la implementacion con una prueba de ida y vuelta.

Referencia: B. Schneier et al., "Twofish: A 128-Bit Block Cipher" (1998).
"""

from __future__ import annotations

M32 = 0xFFFFFFFF


def _rol(x: int, n: int) -> int:
    return ((x << n) | (x >> (32 - n))) & M32


def _ror(x: int, n: int) -> int:
    return ((x >> n) | (x << (32 - n))) & M32


# --- permutaciones q0 / q1 -------------------------------------------------
# Cada permutacion de 8 bits se construye a partir de cuatro tablas de 4 bits.

_T_Q0 = (
    (0x8, 0x1, 0x7, 0xD, 0x6, 0xF, 0x3, 0x2, 0x0, 0xB, 0x5, 0x9, 0xE, 0xC, 0xA, 0x4),
    (0xE, 0xC, 0xB, 0x8, 0x1, 0x2, 0x3, 0x5, 0xF, 0x4, 0xA, 0x6, 0x7, 0x0, 0x9, 0xD),
    (0xB, 0xA, 0x5, 0xE, 0x6, 0xD, 0x9, 0x0, 0xC, 0x8, 0xF, 0x3, 0x2, 0x4, 0x7, 0x1),
    (0xD, 0x7, 0xF, 0x4, 0x1, 0x2, 0x6, 0xE, 0x9, 0xB, 0x3, 0x0, 0x8, 0x5, 0xC, 0xA),
)

_T_Q1 = (
    (0x2, 0x8, 0xB, 0xD, 0xF, 0x7, 0x6, 0xE, 0x3, 0x1, 0x9, 0x4, 0x0, 0xA, 0xC, 0x5),
    (0x1, 0xE, 0x2, 0xB, 0x4, 0xC, 0x3, 0x7, 0x6, 0xD, 0xA, 0x5, 0xF, 0x9, 0x0, 0x8),
    (0x4, 0xC, 0x7, 0x5, 0x1, 0x6, 0x9, 0xA, 0x0, 0xE, 0xD, 0x8, 0x2, 0xB, 0x3, 0xF),
    (0xB, 0x9, 0x5, 0x1, 0xC, 0x3, 0xD, 0xE, 0x6, 0x4, 0x7, 0xF, 0x2, 0x0, 0x8, 0xA),
)


def _build_q(t) -> tuple:
    q = []
    for x in range(256):
        a, b = x >> 4, x & 0xF
        a, b = a ^ b, (a ^ ((b >> 1) | ((b << 3) & 0xF)) ^ ((a << 3) & 0xF)) & 0xF
        a, b = t[0][a], t[1][b]
        a, b = a ^ b, (a ^ ((b >> 1) | ((b << 3) & 0xF)) ^ ((a << 3) & 0xF)) & 0xF
        a, b = t[2][a], t[3][b]
        q.append((b << 4) | a)
    return tuple(q)


Q0 = _build_q(_T_Q0)
Q1 = _build_q(_T_Q1)
_Q = (Q0, Q1)


# --- aritmetica en GF(2^8) -------------------------------------------------

def _gf_mul(a: int, b: int, poly: int) -> int:
    r = 0
    while b:
        if b & 1:
            r ^= a
        b >>= 1
        a <<= 1
        if a & 0x100:
            a ^= poly
    return r & 0xFF


_MDS_POLY = 0x169  # x^8 + x^6 + x^5 + x^3 + 1
_RS_POLY = 0x14D   # x^8 + x^6 + x^3 + x^2 + 1

_MDS = (
    (0x01, 0xEF, 0x5B, 0x5B),
    (0x5B, 0xEF, 0xEF, 0x01),
    (0xEF, 0x5B, 0x01, 0xEF),
    (0xEF, 0x01, 0xEF, 0x5B),
)

_RS = (
    (0x01, 0xA4, 0x55, 0x87, 0x5A, 0x58, 0xDB, 0x9E),
    (0xA4, 0x56, 0x82, 0xF3, 0x1E, 0xC6, 0x68, 0xE5),
    (0x02, 0xA1, 0xFC, 0xC1, 0x47, 0xAE, 0x3D, 0x19),
    (0xA4, 0x55, 0x87, 0x5A, 0x58, 0xDB, 0x9E, 0x03),
)

# _MDS_COL[i][s] = palabra de 32 bits que aporta el byte s en la columna i.
_MDS_COL = tuple(
    tuple(
        _gf_mul(_MDS[0][i], s, _MDS_POLY)
        | (_gf_mul(_MDS[1][i], s, _MDS_POLY) << 8)
        | (_gf_mul(_MDS[2][i], s, _MDS_POLY) << 16)
        | (_gf_mul(_MDS[3][i], s, _MDS_POLY) << 24)
        for s in range(256)
    )
    for i in range(4)
)

# Secuencia de permutaciones q por posicion de byte dentro de la funcion h.
# (k=4, k=3, interna, media, externa) -- 0 = q0, 1 = q1
_QSEQ = ((1, 1, 0, 0, 1), (0, 1, 1, 0, 0), (0, 0, 0, 1, 1), (1, 0, 1, 1, 0))


def _sbox_byte(i: int, b: int, L, k: int) -> int:
    s = _QSEQ[i]
    sh = 8 * i
    if k == 4:
        b = _Q[s[0]][b] ^ ((L[3] >> sh) & 0xFF)
    if k >= 3:
        b = _Q[s[1]][b] ^ ((L[2] >> sh) & 0xFF)
    b = _Q[s[2]][b] ^ ((L[1] >> sh) & 0xFF)
    b = _Q[s[3]][b] ^ ((L[0] >> sh) & 0xFF)
    return _Q[s[4]][b]


def _h(x: int, L, k: int) -> int:
    z = 0
    for i in range(4):
        z ^= _MDS_COL[i][_sbox_byte(i, (x >> (8 * i)) & 0xFF, L, k)]
    return z


class Twofish:
    """Twofish con clave de 128, 192 o 256 bits."""

    block_size = 16

    def __init__(self, key: bytes):
        if len(key) not in (16, 24, 32):
            raise ValueError("la clave Twofish debe ser de 16, 24 o 32 bytes")
        k = len(key) // 8
        words = [int.from_bytes(key[4 * i:4 * i + 4], "little") for i in range(2 * k)]
        me = [words[2 * i] for i in range(k)]
        mo = [words[2 * i + 1] for i in range(k)]

        # Vector S = RS * clave, en orden invertido.
        svec = []
        for i in range(k):
            blk = key[8 * i:8 * i + 8]
            word = 0
            for j in range(4):
                acc = 0
                for c in range(8):
                    acc ^= _gf_mul(_RS[j][c], blk[c], _RS_POLY)
                word |= acc << (8 * j)
            svec.append(word)
        svec.reverse()

        # 40 subclaves.
        rho = 0x01010101
        self._k = []
        for i in range(20):
            a = _h((2 * i) * rho & M32, me, k)
            b = _rol(_h((2 * i + 1) * rho & M32, mo, k), 8)
            self._k.append((a + b) & M32)
            self._k.append(_rol((a + 2 * b) & M32, 9))

        # Tablas rapidas para g(x) con las cajas S dependientes de la clave.
        self._g = tuple(
            tuple(_MDS_COL[i][_sbox_byte(i, b, svec, k)] for b in range(256))
            for i in range(4)
        )

    def _g_of(self, x: int) -> int:
        g = self._g
        return (g[0][x & 0xFF] ^ g[1][(x >> 8) & 0xFF]
                ^ g[2][(x >> 16) & 0xFF] ^ g[3][(x >> 24) & 0xFF])

    def encrypt(self, block: bytes) -> bytes:
        if len(block) != 16:
            raise ValueError("el bloque debe ser de 16 bytes")
        K = self._k
        g = self._g_of
        r0 = int.from_bytes(block[0:4], "little") ^ K[0]
        r1 = int.from_bytes(block[4:8], "little") ^ K[1]
        r2 = int.from_bytes(block[8:12], "little") ^ K[2]
        r3 = int.from_bytes(block[12:16], "little") ^ K[3]
        for r in range(16):
            t0 = g(r0)
            t1 = g(_rol(r1, 8))
            f0 = (t0 + t1 + K[2 * r + 8]) & M32
            f1 = (t0 + 2 * t1 + K[2 * r + 9]) & M32
            n2 = _ror(r2 ^ f0, 1)
            n3 = _rol(r3, 1) ^ f1
            r0, r1, r2, r3 = n2, n3, r0, r1
        out = ((r2 ^ K[4]), (r3 ^ K[5]), (r0 ^ K[6]), (r1 ^ K[7]))
        return b"".join(w.to_bytes(4, "little") for w in out)

    def decrypt(self, block: bytes) -> bytes:
        if len(block) != 16:
            raise ValueError("el bloque debe ser de 16 bytes")
        K = self._k
        g = self._g_of
        c0 = int.from_bytes(block[0:4], "little")
        c1 = int.from_bytes(block[4:8], "little")
        c2 = int.from_bytes(block[8:12], "little")
        c3 = int.from_bytes(block[12:16], "little")
        r0, r1, r2, r3 = c2 ^ K[6], c3 ^ K[7], c0 ^ K[4], c1 ^ K[5]
        for r in range(15, -1, -1):
            # r2, r3 son las mitades izquierdas previas a la ronda.
            a0, a1 = r2, r3
            t0 = g(a0)
            t1 = g(_rol(a1, 8))
            f0 = (t0 + t1 + K[2 * r + 8]) & M32
            f1 = (t0 + 2 * t1 + K[2 * r + 9]) & M32
            a2 = _rol(r0, 1) ^ f0
            a3 = _ror(r1 ^ f1, 1)
            r0, r1, r2, r3 = a0, a1, a2, a3
        out = ((r0 ^ K[0]), (r1 ^ K[1]), (r2 ^ K[2]), (r3 ^ K[3]))
        return b"".join(w.to_bytes(4, "little") for w in out)


def selftest() -> None:
    """Vectores de prueba oficiales de Twofish (ecb_ival)."""
    casos = (
        (bytes(16), bytes(16), "9F589F5CF6122C32B6BFEC2F2AE8C35A"),
        (bytes(24), bytes(16), "EFA71F788965BD4453F860178FC19101"),
        (bytes(32), bytes(16), "57FF739D4DC92C1BD7FC01700CC8216F"),
    )
    for key, pt, esperado in casos:
        tf = Twofish(key)
        ct = tf.encrypt(pt)
        obtenido = ct.hex().upper()
        assert obtenido == esperado, f"clave de {len(key)*8} bits: {obtenido} != {esperado}"
        assert tf.decrypt(ct) == pt, "el descifrado no revierte el cifrado"


if __name__ == "__main__":
    selftest()
    print("Twofish OK")
