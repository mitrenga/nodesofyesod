#!/usr/bin/env python3
"""Vytáhne z obrazu RAM **kulisové bloky místností a pravidla jejich skládání**.

    ./tools/dumpgfx.py [--out data/scenery.json] [--png sources/media/scenery] [--show]

Co se v M2 našlo (`sources/docs/disasm_notes.md` §8):

* `$62AC` **tabulka sad**, 5 položek po 4 bajtech: `(ukazatel na dlaždice,
  ukazatel na display list)`. Sady 0–3 jsou kulisa místností, sada 4 je panel
  (tu našla už M1, `tools/mkpanel.py`).
* **dlaždice kulisy: 9 bajtů** – 8 bajtů bitmapy znakové buňky a devátý je
  atribut. (Panel je výjimka: jeho dlaždice mají 8 bajtů a atributy leží zvlášť
  na `$5D99` – to našla M1.)
* Index dlaždice s **bitem 7** znamená *vodorovné zrcadlení*. Hra na to má
  tabulku obrácených bajtů na `$FE00`, ale **ta v obrazu po nahrání není** –
  hra si ji dopočítá při startu. Skript ji proto ověřuje v rozehrané hře.
* **display list**: bloky za sebou, každý začíná bajtem `šířka<<4 | výška`
  a pak jdou indexy dlaždic po řádcích. Táž kódování jako u panelu.

Kontrola úplnosti (přejímací podmínka tohoto skriptu): tabulka dlaždic každé
sady musí **beze zbytku** vyplnit svůj rozsah paměti – tj. délka od začátku
tabulky po začátek dalšího bloku musí být dělitelná devíti – a display list
musí končit **přesně** tam, kde tabulka dlaždic začíná.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scr2png import write_png                                   # noqa: E402

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
THEME_TABLE = 0x62AC
THEMES = 5                      # 0-3 kulisa, 4 panel
PANEL_THEME = 4
TILE_BYTES = 9                  # kulisa: 8 bajtů bitmapy + atribut
PANEL_TILE_BYTES = 8            # panel má atributy zvlášť na $5D99 (našla M1)
MIRROR_TAB = 0xFE00
# Kde grafika končí: za panelem (sada 4) už jsou data hry, konec našla M1.
PANEL_TILES_END = 0x767E

# barvy ZX pro náhledy
PALETTE = [(0, 0, 0), (0, 0, 215), (215, 0, 0), (215, 0, 215),
           (0, 215, 0), (0, 215, 215), (215, 215, 0), (215, 215, 215),
           (0, 0, 0), (0, 0, 255), (255, 0, 0), (255, 0, 255),
           (0, 255, 0), (0, 255, 255), (255, 255, 0), (255, 255, 255)]


class Image:
    def __init__(self, path=IMAGE):
        self.data = bytearray(open(path, 'rb').read())
        if len(self.data) != 0xC000:
            raise SystemExit('cekam 49152 B obrazu RAM $4000-$FFFF, mam %d' % len(self.data))

    def poke(self, addr, value):
        """Přepíše bajt obrazu tím, co je na té adrese v **rozehrané hře**.

        Některé tabulky si hra dopočítá až při rozehrání a v obrazu po nahrání
        jsou nulové (`data/README.md`, „Ne všechno je v obrazu po nahrání").
        """
        self.data[addr - 0x4000] = value & 0xFF

    def byte(self, addr):
        return self.data[addr - 0x4000]

    def bytes(self, addr, count):
        return self.data[addr - 0x4000:addr - 0x4000 + count]

    def word(self, addr):
        return self.byte(addr) | (self.byte(addr + 1) << 8)


def theme_table(image):
    """(ukazatel na dlaždice, ukazatel na display list) pro každou sadu."""
    return [(image.word(THEME_TABLE + 4 * i), image.word(THEME_TABLE + 4 * i + 2))
            for i in range(THEMES)]


def display_list(image, base, end):
    """Bloky display listu: řídicí bajt `šířka<<4 | výška`, pak indexy dlaždic."""
    blocks, addr = [], base
    while addr < end:
        control = image.byte(addr)
        width, height = control >> 4, control & 0x0F
        size = width * height
        if size == 0 or addr + 1 + size > end:
            break
        blocks.append({'index': len(blocks), 'address': addr,
                       'width': width, 'height': height,
                       'tiles': list(image.bytes(addr + 1, size))})
        addr += 1 + size
    return blocks, addr


def tiles_png(path, tiles, per_row=16, scale=3):
    """Náhled sady dlaždic: mřížka 8 × 8 px buněk s vlastními atributy."""
    rows_count = (len(tiles) + per_row - 1) // per_row
    width = per_row * 8
    rows = [bytearray(b'\x00\x00\x00' * width) for _ in range(rows_count * 8)]
    for n, tile in enumerate(tiles):
        cx, cy = (n % per_row) * 8, (n // per_row) * 8
        attr = tile[8] if len(tile) > 8 else 0x47
        bright = 8 if attr & 0x40 else 0
        ink = bytes(PALETTE[(attr & 0x07) + bright])
        paper = bytes(PALETTE[((attr >> 3) & 0x07) + bright])
        for y in range(8):
            line, row = tile[y], rows[cy + y]
            for x in range(8):
                row[(cx + x) * 3:(cx + x) * 3 + 3] = ink if line & (0x80 >> x) else paper
    write_png(path, [bytes(r) for r in rows], width, scale)


def check_mirror_table(image):
    """Tabulka obrácených bajtů na `$FE00`.

    V obrazu po nahrání je tam **samá nula** – hra si tabulku dopočítá při
    startu. Ověřuje se proto na rozehrané hře, ne ve statickém obrazu.
    """
    expected = bytes(int('{:08b}'.format(b)[::-1], 2) for b in range(256))
    if bytes(image.bytes(MIRROR_TAB, 256)) == expected:
        return True, 'tabulka obracenych bajtu je uz v obrazu po nahrani'
    import roomlib
    simulator = roomlib.boot()
    live = bytes(bytearray(simulator.memory[MIRROR_TAB:MIRROR_TAB + 256]))
    if live == expected:
        return True, ('v obrazu po nahrani je prazdna, ale rozehrana hra si ji '
                      'dopocita – overeno bajt po bajtu')
    if all(b == 0 for b in image.bytes(MIRROR_TAB, 256)):
        return False, 'v obrazu je prazdna a rozehrana hra ji nedopocitala'
    return False, 'ani v obrazu, ani v rozehrane hre to neni tabulka obracenych bajtu'


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--image', default=IMAGE)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'scenery.json'))
    ap.add_argument('--png', default=os.path.join(HERE, '..', 'sources', 'media', 'scenery'),
                    help='kam ulozit nahledy sad (vychozi sources/media/scenery)')
    ap.add_argument('--show', action='store_true', help='vypsat přehled na terminál')
    args = ap.parse_args()

    image = Image(args.image)
    table = theme_table(image)

    # konec tabulky dlaždic každé sady = začátek nejbližšího dalšího bloku grafiky
    marks = sorted({addr for pair in table for addr in pair} | {PANEL_TILES_END})
    problems, themes = [], []
    for index, (tiles_at, list_at) in enumerate(table):
        tiles_end = min(a for a in marks if a > tiles_at)
        span = tiles_end - tiles_at
        stride = PANEL_TILE_BYTES if index == PANEL_THEME else TILE_BYTES
        if span % stride:
            problems.append('sada %d: tabulka dlazdic $%04X-$%04X je %d B, '
                            'coz neni delitelne %d' % (index, tiles_at, tiles_end - 1,
                                                       span, stride))
        count = span // stride
        tiles = [list(image.bytes(tiles_at + n * stride, stride))
                 for n in range(count)]
        blocks, list_end = display_list(image, list_at, tiles_at)
        if list_end != tiles_at:
            problems.append('sada %d: display list $%04X konci na $%04X, '
                            'ale tabulka dlazdic zacina na $%04X'
                            % (index, list_at, list_end, tiles_at))
        themes.append({
            'index': index,
            'role': 'panel' if index == THEMES - 1 else 'kulisa',
            'tiles': {'address': tiles_at, 'count': count, 'bytesPerTile': stride,
                      'data': base64.b64encode(bytes(b for t in tiles for b in t)).decode()},
            'displayList': {'address': list_at, 'blocks': blocks},
        })
        if args.png:
            os.makedirs(args.png, exist_ok=True)
            tiles_png(os.path.join(args.png, 'tiles%d.png' % index), tiles)
        if args.show:
            print('sada %d: dlazdice $%04X-$%04X (%d ks), display list $%04X-$%04X (%d bloku)'
                  % (index, tiles_at, tiles_end - 1, count, list_at, list_end - 1, len(blocks)))
            for block in blocks[:12]:
                print('   blok %2d $%04X  %d x %d' % (block['index'], block['address'],
                                                      block['width'], block['height']))

    mirror_ok, mirror_note = check_mirror_table(image)
    if not mirror_ok:
        problems.append('tabulka zrcadleni na $%04X nesouhlasi: %s' % (MIRROR_TAB, mirror_note))

    data = {
        'note': 'M2: kulisové bloky a pravidla skládání, vytažené z obrazu RAM '
                '(tools/dumpgfx.py). Dlaždice je 9 bajtů: 8 bitmapy + atribut. '
                'Bit 7 indexu dlaždice = vodorovné zrcadlení.',
        'source': os.path.basename(args.image),
        'themeTable': THEME_TABLE,
        'mirrorTable': {'address': MIRROR_TAB, 'isByteReverse': mirror_ok,
                        'builtAtRuntime': True, 'note': mirror_note},
        'themes': themes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')

    total = sum(t['tiles']['count'] for t in themes)
    blocks = sum(len(t['displayList']['blocks']) for t in themes)
    print('%s: %d sad, %d dlazdic, %d bloku' % (args.out, len(themes), total, blocks))
    print('tabulka zrcadleni $%04X: %s' % (MIRROR_TAB, mirror_note))
    if problems:
        print('\nKONTROLA UPLNOSTI SELHALA:')
        for problem in problems:
            print('  ' + problem)
        return 1
    print('kontrola uplnosti: kazda tabulka dlazdic vyplnuje svuj rozsah beze zbytku '
          'a kazdy display list konci presne na ni')
    return 0


if __name__ == '__main__':
    sys.exit(main())
