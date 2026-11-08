#!/usr/bin/env python3
"""Vyřízne hrací plochu ze snímku běžícího originálu do `data/roomNNN.json`.

    ./tools/mkroom.py <snimek.scr> [data/room000.json] [--name "MOON SURFACE"]

Hrací plocha je **256 × 168**, znakové řádky 0–20; panel jsou tři znakové řádky
dole (21–23) – změřeno na originálu, `sources/docs/screen_layout.md` §1. Uloží
se bitmapa po pixelových řádcích (5376 B) a atributy (672 B), obojí base64,
tedy **skutečné bajty videopaměti**, ne překreslený obrázek.

Pozor na to, co v tom obrázku je: je to jeden snímek běžící hry, takže v něm
je i všechno, co v tu chvíli hra do plochy nakreslila (kulisa i pohyblivé
věci). Rozdělit to na kulisu a sprity jde teprve tabulkou spritů a rutinou
kreslení místnosti, což je **M2** (`tools/dumpgfx.py`, `tools/dumpsprites.py`,
`tools/dumprooms.py`). Do té doby je to v remaku jedna statická obrazovka
a nic jiného se o ní netvrdí.
"""
import argparse, base64, json, os

PANEL_ROWS = 3                  # znakové řádky 21–23
PLAY_ROWS = 24-PANEL_ROWS       # 21 znakových řádků hrací plochy
PLAY_LINES = PLAY_ROWS*8        # 168 px


def screen_offset(y):
    third, char_row, pix = y >> 6, (y >> 3) & 7, y & 7
    return (third << 11) | (pix << 8) | (char_row << 5)


def play_area(scr):
    """Hrací plocha jako (bitmapa 5376 B po řádcích, atributy 672 B)."""
    bitmap = bytearray()
    for y in range(PLAY_LINES):
        base = screen_offset(y)
        bitmap += scr[base:base+32]
    return bytes(bitmap), bytes(scr[6144:6144+PLAY_ROWS*32])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('dst', nargs='?', default='data/room000.json')
    ap.add_argument('--name', default='ROOM')
    args = ap.parse_args()

    scr = open(args.src, 'rb').read()
    if len(scr) != 6912:
        raise SystemExit('cekam 6912 B .scr, mam %d' % len(scr))
    bitmap, attrs = play_area(scr)

    data = {
        'note': 'M1: hrací plocha ze snímku běžícího originálu (tools/mkroom.py). '
                'Skutečné bajty videopaměti, ne překreslený obrázek. Rozdělení na '
                'kulisu a sprity je M2 (tools/dumprooms.py) – zatím je to jedna '
                'statická obrazovka.',
        'name': args.name,
        'source': os.path.basename(args.src),
        'width': 256, 'height': PLAY_LINES,
        'bitmap': base64.b64encode(bitmap).decode('ascii'),
        'attributes': base64.b64encode(attrs).decode('ascii')
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('%s -> %s (%d B bitmapy, %d B atributu)'
          % (args.src, args.dst, len(bitmap), len(attrs)))


if __name__ == '__main__':
    main()
