#!/usr/bin/env python3
"""**Přejímací kritérium M2.** Složí každou místnost z bloků a pravidel remaku
a porovná ji bajt po bajtu s tím, co ve stínovém bufferu nechala kreslicí
rutina originálu.

    ./tools/matchscreen.py [--rooms 0-255] [--verbose]

Vstupy:

* `data/scenery.json`  – dlaždice a display listy (`tools/dumpgfx.py`)
* `data/rooms.json`    – co kam originál položil (`tools/dumprooms.py`)
* `build/rooms/*.bin`  – referenční buffery originálu (tamtéž)

Skládá se **z bloků a pravidel**, ne z rozbalených obrázků: buffer se vyplní
atributem pozadí, pak se pokládají bloky display listu (šířka × výška dlaždic),
volné dlaždice, hvězdy a nakonec se dodělá shození bitu 7 atributů. Pravidla ořezu jsou
tatáž jako v originálu – sloupec i řádek se počítají v bajtu a co vypadne
z 32 × 21, se zahodí.

Hlásí se dvě čísla a obě musí být nula: **rozdíly** proti originálu a
**nevysvětlené buňky** – tj. buňky, do kterých remake nic nepoložil, a přesto
v nich originál něco má.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DATA = os.path.join(HERE, '..', 'data')
DUMP = os.path.join(HERE, '..', 'build', 'rooms')
ROWS, COLS = 21, 32
MIRROR = [int('{:08b}'.format(b)[::-1], 2) for b in range(256)]


class Scenery:
    """Sady dlaždic a display listy z `data/scenery.json`."""

    def __init__(self, path):
        data = json.load(open(path))
        self.themes = []
        for theme in data['themes']:
            stride = theme['tiles']['bytesPerTile']
            raw = base64.b64decode(theme['tiles']['data'])
            tiles = [raw[n * stride:(n + 1) * stride]
                     for n in range(theme['tiles']['count'])]
            self.themes.append({'tiles': tiles, 'stride': stride,
                                'blocks': theme['displayList']['blocks']})

    def tile(self, theme, index):
        return self.themes[theme]['tiles'][index]

    def block(self, theme, index):
        return self.themes[theme]['blocks'][index]


def compose(scenery, room):
    """Složí hrací plochu podle popisu místnosti. Vrací (bitmapa, atributy, dotčeno)."""
    theme = room['theme']
    bitmap = bytearray(ROWS * 8 * 32)
    attrs = bytearray([room['fillAttr']] * (ROWS * 32))
    if room['skyAttr'] is not None:
        for i in range(room['skyRows'] * 32):
            attrs[i] = room['skyAttr']
    touched = set()

    def put_tile(index, x, y):
        # tentýž ořez jako v originálu ($8A3B): mimo 32 x 21 se dlaždice zahodí
        if x >= COLS or y >= ROWS:
            return
        tile = scenery.tile(theme, index & 0x7F)
        mirror = index & 0x80
        base = y * 256 + x
        for line in range(8):
            byte = tile[line]
            bitmap[base + line * 32] = MIRROR[byte] if mirror else byte
        attrs[y * 32 + x] = tile[8]
        touched.add((x, y))

    for index, x0, y0 in room['blocks']:
        block = scenery.block(theme, index)
        width, height = block['width'], block['height']
        for row in range(height):
            y = (y0 + row) & 0xFF
            for col in range(width):
                put_tile(block['tiles'][row * width + col], (x0 + col) & 0xFF, y)

    for index, x, y in room['looseTiles']:
        put_tile(index, x, y)

    for x, y, width, height in room['attrClear']:
        for row in range(height):
            for col in range(width):
                attrs[(y + row) * 32 + x + col] &= 0x7F

    for offset, mask in room['pixelSet']:
        bitmap[offset] |= mask
        touched.add((offset & 0x1F, offset >> 8))

    return bytes(bitmap), bytes(attrs), touched


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenery', default=os.path.join(DATA, 'scenery.json'))
    ap.add_argument('--rooms-file', default=os.path.join(DATA, 'rooms.json'))
    ap.add_argument('--dump', default=DUMP)
    ap.add_argument('--rooms', default='0-255')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    lo, hi = ((int(x) for x in args.rooms.split('-')) if '-' in args.rooms
              else (int(args.rooms, 0), int(args.rooms, 0)))
    scenery = Scenery(args.scenery)
    rooms = json.load(open(args.rooms_file))['rooms']

    total_bits, total_attrs, unexplained, checked, missing = 0, 0, 0, 0, []
    for number in range(lo, hi + 1):
        key = str(number)
        path = os.path.join(args.dump, 'room%03d.bin' % number)
        if key not in rooms or not os.path.exists(path):
            missing.append(number)
            continue
        reference = open(path, 'rb').read()
        ref_bitmap, ref_attrs = reference[:ROWS * 8 * 32], reference[ROWS * 8 * 32:]
        bitmap, attrs, touched = compose(scenery, rooms[key])
        checked += 1

        bits = sum(1 for a, b in zip(bitmap, ref_bitmap) if a != b)
        cells = sum(1 for a, b in zip(attrs, ref_attrs) if a != b)
        blind = 0
        for y in range(ROWS):
            for x in range(COLS):
                if (x, y) in touched:
                    continue
                base = y * 256 + x
                if any(ref_bitmap[base + line * 32] for line in range(8)):
                    blind += 1
        total_bits += bits
        total_attrs += cells
        unexplained += blind
        if args.verbose or bits or cells or blind:
            print('mistnost %3d: %4d rozdilu v bitmape, %3d v atributech, '
                  '%2d nevysvetlenych bunek' % (number, bits, cells, blind))

    print('\nporovnano %d mistnosti' % checked)
    if missing:
        print('CHYBI data pro %d mistnosti: %s' % (len(missing), missing[:16]))
    print('rozdilu v bitmape:   %d z %d B' % (total_bits, checked * ROWS * 8 * 32))
    print('rozdilu v atributech:%d z %d B' % (total_attrs, checked * ROWS * 32))
    print('nevysvetlenych bunek:%d' % unexplained)
    ok = not missing and total_bits == 0 and total_attrs == 0 and unexplained == 0
    print('\nM2 prejimaci kriterium: %s' % ('SPLNENO' if ok else 'NESPLNENO'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
