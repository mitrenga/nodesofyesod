#!/usr/bin/env python3
"""Porovná panel remaku se snímkem z běžícího originálu, bajt po bajtu.

    ./tools/matchpanel.py [snimek.scr] [--lives 3] [--time 7]

Sestaví znakové řádky 21–23 přesně tak, jak je staví `app/screenComposer.js`
(`composePanel`): bloky z display listu originálu podle `data/panel.json`,
číslice z `data/font.json`, atributy z tabulky `$5D99` – a porovná je
s videopamětí zachyceného snímku. Cíl je **nula rozdílů**.

Dvě buňky oscilografu (energie) se porovnávají taky, ale hlásí se **zvlášť**:
co do nich originál kreslí, je otevřená otázka (`ZADANI.md` §8), takže je
remake nechává tak, jak je má display list. Neschovává se to – vypíše se to.
"""
import argparse, base64, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PANEL_ROW = 21
PANEL_ROWS = 3
COLS = 32


def screen_offset(y):
    third, char_row, pix = y >> 6, (y >> 3) & 7, y & 7
    return (third << 11) | (pix << 8) | (char_row << 5)


def clock(seconds):
    """H:MM:SS – formát změřený na originálu."""
    total = max(0, int(seconds))
    return '%d:%02d:%02d' % (min(9, total//3600), (total//60) % 60, total % 60)


def build_panel(lives, seconds):
    """Panel tak, jak ho staví app/screenComposer.js composePanel()."""
    panel = json.load(open(os.path.join(ROOT, 'data/panel.json')))
    font = json.load(open(os.path.join(ROOT, 'data/font.json')))['glyphs']
    tiles = [bytes.fromhex(tile) for tile in panel['tiles']]

    bitmap = bytearray(COLS*8*PANEL_ROWS)
    attrs = bytearray(base64.b64decode(panel['attributes']))

    def cell(row, col, data):
        for pixel in range(8):
            bitmap[(row*8+pixel)*COLS+col] = data[pixel]

    for block in panel['blocks']:
        if not block['drawn']:
            continue
        for y in range(block['height']):
            for x in range(block['width']):
                cell(block['row']+y, block['column']+x,
                     tiles[block['tiles'][y*block['width']+x]])

    def text(row, col, value):
        for i, char in enumerate(value):
            cell(row, col+i, bytes.fromhex(font[char]))

    fields = panel['fields']
    text(fields['lives']['row'], fields['lives']['column'], str(max(0, min(9, lives))))
    text(fields['time']['row'], fields['time']['column'], clock(seconds))
    energy = fields['energy']
    open_cells = {(energy['column']+i, energy['row']) for i in range(energy['columns'])}
    return bitmap, attrs, open_cells


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('frame', nargs='?',
                    default=os.path.join(ROOT, 'sources/media/screens/gameplay_surface.scr'))
    ap.add_argument('--lives', type=int, default=3)
    ap.add_argument('--time', type=int, default=7, help='uplynulé sekundy hry')
    args = ap.parse_args()

    bitmap, attrs, open_cells = build_panel(args.lives, args.time)
    scr = open(args.frame, 'rb').read()
    if len(scr) != 6912:
        raise SystemExit('cekam 6912 B .scr, mam %d' % len(scr))
    original = bytearray()
    for y in range(PANEL_ROW*8, 192):
        original += scr[screen_offset(y):screen_offset(y)+32]
    original_attrs = scr[6144+PANEL_ROW*COLS:6144+24*COLS]

    bad_bits, open_bits = [], set()
    for i in range(len(bitmap)):
        if bitmap[i] == original[i]:
            continue
        col, row = i % COLS, i//COLS//8
        if (col, row) in open_cells:
            open_bits.add((col, row))
        else:
            bad_bits.append(i)
    bad_attrs = [i for i in range(len(attrs)) if attrs[i] != original_attrs[i]]

    print('%s:' % os.path.basename(args.frame))
    print('  bitmapa:  %d / %d bajtu se lisi' % (len(bad_bits), len(bitmap)))
    print('  atributy: %d / %d bajtu se lisi' % (len(bad_attrs), len(attrs)))
    for i in bad_bits[:16]:
        print('    bitmapa sloupec %d, radek panelu %d: %02X != %02X'
              % (i % COLS, i//COLS//8, bitmap[i], original[i]))
    for i in bad_attrs[:16]:
        print('    atribut sloupec %d, radek panelu %d: %02X != %02X'
              % (i % COLS, i//COLS, attrs[i], original_attrs[i]))
    for col, row in sorted(open_bits):
        print('    OTEVRENA OTAZKA: oscilograf energie, bunka (%d,%d) - remake ji '
              'nekresli (ZADANI.md par. 8)' % (col, row))
    if bad_bits or bad_attrs:
        sys.exit(1)
    print('  panel souhlasi s originalem bajt po bajtu')


if __name__ == '__main__':
    main()
