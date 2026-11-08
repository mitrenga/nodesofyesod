#!/usr/bin/env python3
"""Vytáhne z paměti hry originální znakovou sadu do PNG sheetu.

    ./tools/dumpfont.py --base ED24 [--space 3D] [--index ascii|order] \
        [build/nodesofyesod-48k.bin] [sources/media/font_charset.png]

★ **Adresa se našla v M1**: znaková sada je součástí dlaždicové tabulky panelu na
`$73E6` (`sources/docs/disasm_notes.md` §6), číslice `0`–`9` začínají na **`$7536`**
a písmena `A`–`Z` na `$7586`, po 8 bajtech na glyf a v tomhle pořadí. Sheet se udělá:

    ./tools/dumpfont.py --base=7536 --index=order \
        --chars=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ

Adresa přesto **není zadrátovaná** a bez `--base` nástroj odmítne pracovat: kdyby se
ukázalo, že jinde v paměti je ještě jiná sada, nemá se to hádat. Pro remake se sada
vytahuje `tools/mkfont.py` do `data/font.json`.

`--index ascii` (výchozí) čte glyf pro znak `c` na `base + ord(c) * 8` – tak to dělal
Underwurlde. `--index order` čte glyfy po sobě v pořadí znaků `--chars`, což je druhá
obvyklá varianta (tabulka jen pro číslice a velká písmena).

Vstupem je obraz RAM `$4000-$FFFF` (49152 B) z `tools/mksnapshot.sh`.
"""
import os, sys, zlib, struct

CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def write_png(path, lines, width):
    raw = b''.join(b'\x00' + l for l in lines)

    def chunk(tag, p):
        return (struct.pack('>I', len(p)) + tag + p
                + struct.pack('>I', zlib.crc32(tag + p) & 0xFFFFFFFF))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', width, len(lines), 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def main(argv):
    root = os.path.join(os.path.dirname(__file__), '..')
    opts, pos = {}, []
    for a in argv[1:]:
        if a.startswith('--'):
            k, _, v = a.lstrip('-').partition('=')
            opts[k] = v or True
        else:
            pos.append(a)
    if opts.get('base') in (None, True):
        raise SystemExit(__doc__)
    base = int(opts['base'], 16)
    space = int(opts.get('space', '20'), 16)
    order = opts.get('index', 'ascii') == 'order'
    chars_arg = opts.get('chars')
    src = pos[0] if len(pos) > 0 else os.path.join(root, 'build/nodesofyesod-48k.bin')
    dst = pos[1] if len(pos) > 1 else os.path.join(root, 'sources/media/font_charset.png')
    ram = open(src, 'rb').read()
    if len(ram) != 49152:
        raise SystemExit('cekam 49152 B RAM ($4000-$FFFF), mam %d' % len(ram))
    byte = lambda a: ram[a - 0x4000]

    chars = chars_arg if chars_arg and chars_arg is not True else ' ' + CHARS
    lines = []
    for y in range(8):
        row = bytearray()
        for i, c in enumerate(chars):
            idx = i if order else (space if c == ' ' else ord(c))
            b = byte(base + idx * 8 + y)
            for bit in range(7, -1, -1):
                row += b'\xff\xff\xff' if (b >> bit) & 1 else b'\x00\x00\x00'
        lines.append(bytes(row))
    write_png(dst, lines, len(chars) * 8)
    print('%s  (%d znaku, %dx8 px, sheet 8x8 na znak)' % (dst, len(chars), len(chars) * 8))


if __name__ == '__main__':
    main(sys.argv)
