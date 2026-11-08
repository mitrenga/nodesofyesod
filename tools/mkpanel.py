#!/usr/bin/env python3
"""Vytáhne **panel** z originálu do `data/panel.json` – dlaždice, sestavu i barvy.

    PYTHONPATH=tools/vendor ./tools/mkpanel.py \
        [--ram build/nodesofyesod-48k.bin] \
        [--frame sources/media/screens/gameplay_surface.scr] [--dst data/panel.json]

Panel není v originálu nakreslený znak po znaku textem – je poskládaný
z **vlastní dlaždicové tabulky** (M1, `sources/docs/disasm_notes.md`):

* **`$73E6`** – tabulka dlaždic, **8 bajtů na dlaždici** (jedna znaková buňka).
  Index 0 je prázdná buňka. Dlaždice 1–9 jsou figurka vlevo (3 × 3 buňky),
  10–17 druhá figurka (nakreslená není – otevřená otázka), 18–34 rámečky
  a nápisy `ALCHIEMS`, 35–37 nápis `LIFE`, 38–40 nápis `TIME`, 41 je `:`,
  42–51 číslice `0`–`9`, 52–77 písmena `A`–`Z`, 78 je `©`.
* **`$7387`–`$73E5`** – **display list**: posloupnost bloků, každý začíná
  řídicím bajtem `šířka<<4 | výška` a pak následuje `šířka*výška` indexů
  dlaždic po řádcích. Seznam končí přesně tam, kde začíná tabulka dlaždic.
* **`$5D99`** – 96 bajtů atributů panelu (3 znakové řádky × 32).

Kde který blok na obrazovce leží, v display listu **není** – to si nese
kreslicí rutina. Tenhle nástroj proto polohu **změří**: každý blok najde ve
videopaměti zachyceného snímku běžící hry a rovnou tím ověří, že sedí bajt po
bajtu. Buňky, které se liší, jsou právě ty, do kterých hra za běhu zapisuje
(číslo životů, hodiny, oscilograf) – vypíšou se a stanou se z nich `fields`.

Nic se tu nedokresluje: co v tabulce není, v `panel.json` není.
"""
import argparse, base64, json, os

TILE_TABLE = 0x73E6         # tabulka dlaždic, 8 B na dlaždici
DISPLAY_LIST = 0x7387       # display list panelu, končí na TILE_TABLE
ATTRS = 0x5D99            # 96 B atributů panelu
TILE_COUNT = 79             # 0 … 78 (`©`) – dál se pokračování tabulky neověřilo
PANEL_ROW = 21              # první znakový řádek panelu (screen_layout.md §1)
PANEL_ROWS = 3


def screen_offset(y):
    third, char_row, pix = y >> 6, (y >> 3) & 7, y & 7
    return (third << 11) | (pix << 8) | (char_row << 5)


class Ram:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        if len(self.data) != 49152:
            raise SystemExit('cekam 49152 B RAM ($4000-$FFFF), mam %d' % len(self.data))

    def peek(self, addr, count=1):
        return self.data[addr-0x4000:addr-0x4000+count]


def read_display_list(ram):
    """Bloky display listu jako [{'width','height','tiles'}]."""
    blocks = []
    addr = DISPLAY_LIST
    while addr < TILE_TABLE:
        control = ram.peek(addr)[0]
        width, height = control >> 4, control & 0x0F
        if width == 0 or height == 0 or addr+1+width*height > TILE_TABLE:
            raise SystemExit('display list nesedi na %04X (ridici bajt %02X)'
                             % (addr, control))
        blocks.append({'width': width, 'height': height,
                       'tiles': list(ram.peek(addr+1, width*height)),
                       'address': '$%04X' % addr})
        addr += 1+width*height
    return blocks


def frame_cell(scr, col, row):
    return bytes(scr[screen_offset(row*8+pixel)+col] for pixel in range(8))


def locate(block, tiles, scr):
    """Najde blok ve snímku; vrátí (sloupec, řádek, seznam odlišných buněk)."""
    best = None
    for row in range(PANEL_ROW, PANEL_ROW+PANEL_ROWS-block['height']+1):
        for col in range(0, 33-block['width']):
            diff = [(x, y) for y in range(block['height'])
                    for x in range(block['width'])
                    if frame_cell(scr, col+x, row+y) != tiles[block['tiles'][y*block['width']+x]]]
            if best is None or len(diff) < len(best[2]):
                best = (col, row, diff)
    return best


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ram', default=os.path.join(root, 'build/nodesofyesod-48k.bin'))
    ap.add_argument('--frame', default=os.path.join(root, 'sources/media/screens/gameplay_surface.scr'))
    ap.add_argument('--dst', default=os.path.join(root, 'data/panel.json'))
    args = ap.parse_args()

    ram = Ram(args.ram)
    scr = open(args.frame, 'rb').read()
    if len(scr) != 6912:
        raise SystemExit('cekam 6912 B .scr, mam %d' % len(scr))

    tiles = [ram.peek(TILE_TABLE+8*i, 8) for i in range(TILE_COUNT)]
    blocks = read_display_list(ram)
    attributes = ram.peek(ATTRS, PANEL_ROWS*32)
    frame_attributes = scr[6144+PANEL_ROW*32:6144+(PANEL_ROW+PANEL_ROWS)*32]
    if attributes != frame_attributes:
        raise SystemExit('atributy z $%04X nesouhlasi se snimkem' % ATTRS)

    out_blocks, runtime = [], []
    for index, block in enumerate(blocks):
        col, row, diff = locate(block, tiles, scr)
        # blok se považuje za nakreslený, jen když sedí skoro celý; jinak je to
        # varianta, kterou hra v tomhle snímku nekreslí (druhá figurka)
        cells = block['width']*block['height']
        drawn = len(diff) <= max(1, cells//4)
        out_blocks.append({
            'address': block['address'],
            'width': block['width'], 'height': block['height'],
            'column': col if drawn else None,
            'row': (row-PANEL_ROW) if drawn else None,
            'tiles': block['tiles'],
            'drawn': drawn
        })
        print('blok %d  %s  %d x %d  -> %s  (%d odlisnych bunek)'
              % (index, block['address'], block['width'], block['height'],
                 ('sloupec %d, radek %d' % (col, row)) if drawn else 've snimku neni',
                 len(diff)))
        if drawn:
            for x, y in diff:
                runtime.append((col+x, row+y-PANEL_ROW))
                print('    za behu prepsana bunka (sloupec %d, radek panelu %d)'
                      % (col+x, row+y-PANEL_ROW))

    data = {
        'note': 'M1: panel originálu (tools/mkpanel.py). Dlaždice z $73E6 po 8 B, '
                'sestava z display listu $7387–$73E5 (řídicí bajt = šířka<<4|výška), '
                'atributy z $5D99. Polohy bloků jsou změřené proti snímku běžící hry '
                '(sources/media/screens/gameplay_surface.scr).',
        'tileTable': '$%04X' % TILE_TABLE,
        'displayList': '$%04X' % DISPLAY_LIST,
        'attributeTable': '$%04X' % ATTRS,
        'screenRow': PANEL_ROW,
        'rows': PANEL_ROWS, 'columns': 32,
        'tiles': [tile.hex().upper() for tile in tiles],
        'blocks': out_blocks,
        'attributes': base64.b64encode(attributes).decode('ascii'),
        # buňky, do kterých hra zapisuje za běhu – zjištěné jako rozdíl mezi
        # display listem a snímkem, potvrzené třemi snímky (dva z jeskyně)
        'fields': {
            'alchiems': {'row': 1, 'column': 6, 'count': 8,
                         'note': 'osm políček; co do nich hra kreslí po sebrání '
                                 'alchiemu, je otevřená otázka (M5)'},
            'energy': {'row': 1, 'column': 17, 'columns': 2,
                       'note': 'oscilograf – Crash 19: „the little oscilloscope which '
                               'shows your energy level". Průběh je otevřená otázka (M5)'},
            'lives': {'row': 1, 'column': 19, 'length': 1,
                      'note': 'počet životů, na startu 3 ($5B09)'},
            'time': {'row': 1, 'column': 23, 'length': 7,
                     'note': 'hodiny H:MM:SS, běží od začátku hry'}
        },
        'runtimeCells': sorted(set(runtime))
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('%s (%d dlazdic, %d bloku)' % (args.dst, len(tiles), len(out_blocks)))


if __name__ == '__main__':
    main()
