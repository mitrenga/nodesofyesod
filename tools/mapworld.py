#!/usr/bin/env python3
"""Složí **mapu světa z dat remaku** a volitelně ji porovná s dobovou
screenshotovou mapou.

    ./tools/mapworld.py [--out build/mapworld.png] [--scale 1] [--check]

Mapa se skládá **z týchž dat, ze kterých kreslí remake** (`data/scenery.json`
+ `data/rooms.json`, složeno stejně jako v `tools/matchscreen.py`), ne
z obrázků. `room = řádek*16 + sloupec` – hypotéza mřížky **16 × 16**.

`--check` porovná každé pole s dobovou mapou `sources/media/maps/`
(4110 × 3213 px, mřížka změřená v `tools/mapcut.py`). Dobová mapa je snímek
běžící hry, takže jsou v ní i pohyblivé věci a remake je nekreslí – proto se
nečeká shoda bajt po bajtu. Testuje se něco jiného a silnějšího: **ke které
místnosti remaku má které pole mapy nejblíž**. Když mřížka 16 × 16 a číslování
`řádek*16 + sloupec` platí, musí nejbližší místnost vyjít ta na tomtéž místě.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mapcut                                                   # noqa: E402
import matchscreen                                              # noqa: E402
from scr2png import PALETTE, scr_to_rgb                         # noqa: E402
import roomlib                                                  # noqa: E402

DATA = os.path.join(HERE, '..', 'data')
COLS, ROWS = 16, 16
CW, CH = 256, 168


def room_rgb(scenery, room):
    """Hrací plocha místnosti složená z bloků a pravidel, jako RGB řádky."""
    bitmap, attrs, _ = matchscreen.compose(scenery, room)
    return scr_to_rgb(roomlib.buffer_to_scr(bitmap, attrs))


def quantize(rows, width):
    """RGB -> index barvy ZX (0-15); dobová mapa má trochu jiné odstíny."""
    table = {}
    out = []
    for row in rows:
        line = bytearray(width)
        for x in range(width):
            key = row[x * 3:x * 3 + 3]
            index = table.get(key)
            if index is None:
                r, g, b = key
                index = min(range(16), key=lambda n: (r - PALETTE[n][0]) ** 2
                            + (g - PALETTE[n][1]) ** 2 + (b - PALETTE[n][2]) ** 2)
                table[key] = index
            line[x] = index
        out.append(bytes(line))
    return out


def signature(rows, width):
    """Otisk místnosti: převažující barva každé znakové buňky 8 x 8.

    Pohyblivé věci na dobové mapě zaberou v buňce menšinu pixelů, takže otisk
    popisuje kulisu a sprity ho nerozhodí.
    """
    out = bytearray()
    for cy in range(0, len(rows) - 7, 8):
        for cx in range(0, width - 7, 8):
            counts = {}
            for y in range(8):
                line = rows[cy + y]
                for x in range(8):
                    value = line[cx + x]
                    counts[value] = counts.get(value, 0) + 1
            out.append(max(counts, key=counts.get))
    return bytes(out)


def map_cell(image, col, row):
    width, height, pixels, palette = image
    x0, y0 = mapcut.XS[col], mapcut.YS[row]
    span = min(CW, width - x0)
    rows = []
    for y in range(y0, min(y0 + CH, height)):
        src = pixels[y]
        line = bytearray()
        for x in range(x0, x0 + span):
            line += palette[src[x] * 3:src[x] * 3 + 3]
        rows.append(bytes(line))
    return quantize(rows, span), span


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenery', default=os.path.join(DATA, 'scenery.json'))
    ap.add_argument('--rooms-file', default=os.path.join(DATA, 'rooms.json'))
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build', 'mapworld.png'))
    ap.add_argument('--scale', type=int, default=1)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--map', default=mapcut.SRC)
    args = ap.parse_args()

    scenery = matchscreen.Scenery(args.scenery)
    rooms = json.load(open(args.rooms_file))['rooms']
    composed = {n: room_rgb(scenery, rooms[str(n)]) for n in range(COLS * ROWS)}

    if args.out:
        step = max(1, args.scale) if args.scale > 0 else 1
        lines = []
        for row in range(ROWS):
            band = [bytearray() for _ in range(0, CH, step)]
            for col in range(COLS):
                cell = composed[row * COLS + col]
                for n, y in enumerate(range(0, CH, step)):
                    src = cell[y]
                    band[n] += b''.join(src[x * 3:x * 3 + 3] for x in range(0, CW, step))
            lines.extend(bytes(b) for b in band)
        mapcut.write_png(args.out, lines, (CW // step) * COLS)
        print('%s: mapa sveta %d x %d mistnosti z dat remaku'
              % (args.out, COLS, ROWS))

    if not args.check:
        return 0

    print('nacitam dobovou mapu %s ...' % os.path.basename(args.map))
    image = mapcut.load(args.map)
    mine = {n: signature(quantize(composed[n], CW), CW) for n in composed}

    best_of = {}
    for row in range(ROWS):
        for col in range(COLS):
            pixels, span = map_cell(image, col, row)
            if len(pixels) < CH:
                continue
            cell = signature(pixels, span)
            scores = sorted(((sum(1 for a, b in zip(cell, mine[n])
                                  if a == b), n) for n in range(COLS * ROWS)),
                            reverse=True)
            top = scores[0][0]
            best_of[(col, row)] = (scores[0][1], top, cell,
                                   {n for score, n in scores if score == top})

    # dobová mapa nemusí začínat na tomtéž sloupci jako číslování hry (svět
    # se v řádku zacyklí), takže se posun nepředpokládá – hledá se
    offsets = {}
    for (col, row), (best, _, _, _) in best_of.items():
        key = ((best % COLS - col) % COLS, (best // COLS - row) % ROWS)
        offsets[key] = offsets.get(key, 0) + 1
    (dcol, drow), votes = max(offsets.items(), key=lambda kv: kv[1])

    hits, ties, blank, report = 0, 0, 0, []
    for (col, row), (best, score, cell, equals) in sorted(best_of.items(),
                                                          key=lambda kv: kv[0][::-1]):
        expected = ((row + drow) % ROWS) * COLS + (col + dcol) % COLS
        if score == 0:
            # pole, které autor dobové mapy nikdy nenavštívil – v mapě je černé
            blank += 1
        elif expected in equals:
            hits += 1
            if best != expected:
                ties += 1
        else:
            own = sum(1 for a, b in zip(cell, mine[expected]) if a == b)
            report.append((col, row, expected, best, score, own))

    checked = len(best_of)
    print('\npoli mapy porovnano: %d' % checked)
    print('posun dobove mapy proti cislovani hry: sloupce %+d, radky %+d '
          '(%d z %d poli)' % (dcol, drow, votes, checked))
    print('nejblizsi mistnost remaku je ta ocekavana: %d z %d '
          '(z toho %d shodou skore s jinou, stejne vypadajici mistnosti)'
          % (hits, checked, ties))
    if blank:
        print('prazdnych poli dobove mapy (autor je nenavstivil): %d' % blank)
    if report:
        print('\nkde to nesedi (pole -> nejblizsi mistnost, skore nejlepsi/ocekavane '
              'z 672 bunek):')
        for col, row, expected, best, score, own in report[:32]:
            print('  sloupec %2d radek %2d: ocekavano $%02X, nejblizsi $%02X  (%d vs %d)'
                  % (col, row, expected, best, score, own))
    decided = checked - blank
    print('\nmrizka 16 x 16 a cislovani radek*16+sloupec: %s (%d z %d rozhodnutelnych poli)'
          % ('POTVRZENO' if hits == decided else 'NEPOTVRZENO', hits, decided))
    return 0


if __name__ == '__main__':
    sys.exit(main())
