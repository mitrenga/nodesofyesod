#!/usr/bin/env python3
"""Vyřízne jednu místnost ze screenshotové mapy světa.

    ./tools/mapcut.py <sloupec 0-15> <řádek 0-15> [out.png] [--scale=N]
    ./tools/mapcut.py --grid              vypíše změřenou mřížku a skončí

Mapa `sources/media/maps/speccycz_screenshot_map.png` je 8bitové paletové PNG
**4110 × 3213 px**. Mřížka je **změřená z obrázku**, ne odhadnutá (1px černé oddělovače):

* svisle: oddělovače na y = 672, 841, 1010 … 3038, rozteč **169** = buňka 168 px + 1 px
  → 16 řádků, první začíná na y = **504**
* vodorovně: oddělovače na x = 256, 512, 769, 1026 … 3853, rozteč **257** = buňka 256 px
  + 1 px → 16 sloupců, první začíná na x = 0. Sloupec 1 je v mapě o pixel užší
  (chyba skládání mapy) – proto se offsety berou z tabulky, ne z násobení.

Buňka je přesně **hrací plocha** místnosti (256 × 168), panel v mapě není – což je
nezávislé potvrzení rozdělení obrazovky, viz `sources/docs/screen_layout.md`.

Mřížka **16 × 16 = 256 obrazovek** je tím doložená na mapě; autoritou je pořád počet
místností nalezený v datech hry (M2).

Bez závislostí (jen zlib).
"""
import os, sys, zlib, struct

SRC = os.path.join(os.path.dirname(__file__), '..',
                   'sources/media/maps/speccycz_screenshot_map.png')
COLS, ROWS, CW, CH = 16, 16, 256, 168
# levé hrany sloupců a horní hrany řádků – změřené z oddělovačů v mapě
XS = [0, 257, 513, 770, 1027, 1284, 1541, 1798, 2055, 2312, 2569, 2826, 3083, 3340, 3597, 3854]
YS = [504 + 169 * r for r in range(ROWS)]


def load(path):
    d = open(path, 'rb').read()
    i, idat, plte, w, h = 8, b'', None, 0, 0
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        tag, pay = d[i + 4:i + 8], d[i + 8:i + 8 + ln]
        i += 12 + ln
        if tag == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', pay)
            if (bd, ct, il) != (8, 3, 0):
                raise SystemExit('cekam 8bitove paletove PNG bez prokladani, '
                                 'mam bd=%d ct=%d interlace=%d' % (bd, ct, il))
        elif tag == b'PLTE':
            plte = pay
        elif tag == b'IDAT':
            idat += pay
        elif tag == b'IEND':
            break
    raw = zlib.decompress(idat)
    rows, prev, p = [], bytearray(w), 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + w]); p += w
        if f == 1:
            for x in range(1, w):
                line[x] = (line[x] + line[x - 1]) & 255
        elif f == 2:
            for x in range(w):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(w):
                line[x] = (line[x] + ((line[x - 1] if x else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(w):
                a = line[x - 1] if x else 0
                b = prev[x]
                c = prev[x - 1] if x else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        elif f:
            raise SystemExit('necekany PNG filtr %d' % f)
        rows.append(bytes(line)); prev = line
    return w, h, rows, plte


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
    if '--grid' in argv:
        print('mrizka %d x %d, bunka %d x %d px' % (COLS, ROWS, CW, CH))
        print('x levych hran:', XS)
        print('y hornich hran:', YS)
        return
    args = [a for a in argv[1:] if not a.startswith('--')]
    scale = 1
    for a in argv[1:]:
        if a.startswith('--scale='):
            scale = int(a.split('=')[1])
    if len(args) < 2:
        raise SystemExit(__doc__)
    col, row = int(args[0]), int(args[1])
    if not (0 <= col < COLS and 0 <= row < ROWS):
        raise SystemExit('sloupec 0-%d, radek 0-%d' % (COLS - 1, ROWS - 1))
    out = args[2] if len(args) > 2 else 'room_c%02d_r%02d.png' % (col, row)
    w, h, rows, plte = load(SRC)
    x0, y0 = XS[col], YS[row]
    width = min(CW, w - x0)
    lines = []
    for y in range(y0, min(y0 + CH, h)):
        src = rows[y]
        line = bytearray()
        for x in range(x0, x0 + width):
            line += plte[src[x] * 3:src[x] * 3 + 3] * scale
        for _ in range(scale):
            lines.append(bytes(line))
    write_png(out, lines, width * scale)
    print('%s  (sloupec %d, radek %d, %dx%d)' % (out, col, row, width * scale, len(lines)))


if __name__ == '__main__':
    main(sys.argv)
