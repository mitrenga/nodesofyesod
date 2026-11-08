#!/usr/bin/env python3
"""Spustí hru v Z80 simulátoru, odsimuluje stisky kláves a uloží snímky obrazovky.

    PYTHONPATH=tools/vendor ./tools/playtrace.py [--frames N] [--out DIR] [--map FILE]

Klávesnice se adresuje po **půlřádcích** stejně jako na skutečném Spectru
(viz sources/docs/hw_notes.md §6). Skript kláves je dole v `SCRIPT`:
`(snímek_od, snímek_do, 'půlřádek', bit)`.

Snímky obrazovky se ukládají jako PNG přes `scr2png.py`.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor'))
sys.path.insert(0, HERE)

from scr2png import scr_to_rgb, write_png                      # noqa: E402
from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.simutils import from_snapshot                     # noqa: E402
from skoolkit.trace import Tracer                               # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                             # pragma: no cover
    CSimulator = None

# půlřádek -> index v poli keyboard[] simulátoru (bit A8..A15 portu $xxFE)
ROWS = {'$FEFE': 0, '$FDFE': 1, '$FBFE': 2, '$F7FE': 3,
        '$EFFE': 4, '$DFFE': 5, '$BFFE': 6, '$7FFE': 7}
KEYS = {  # klávesa -> (půlřádek, bit); celá matice, viz sources/docs/hw_notes.md §6
    'CAPS': ('$FEFE', 0), 'Z': ('$FEFE', 1), 'X': ('$FEFE', 2), 'C': ('$FEFE', 3), 'V': ('$FEFE', 4),
    'A': ('$FDFE', 0), 'S': ('$FDFE', 1), 'D': ('$FDFE', 2), 'F': ('$FDFE', 3), 'G': ('$FDFE', 4),
    'Q': ('$FBFE', 0), 'W': ('$FBFE', 1), 'E': ('$FBFE', 2), 'R': ('$FBFE', 3), 'T': ('$FBFE', 4),
    '1': ('$F7FE', 0), '2': ('$F7FE', 1), '3': ('$F7FE', 2), '4': ('$F7FE', 3), '5': ('$F7FE', 4),
    '0': ('$EFFE', 0), '9': ('$EFFE', 1), '8': ('$EFFE', 2), '7': ('$EFFE', 3), '6': ('$EFFE', 4),
    'P': ('$DFFE', 0), 'O': ('$DFFE', 1), 'I': ('$DFFE', 2), 'U': ('$DFFE', 3), 'Y': ('$DFFE', 4),
    'ENTER': ('$BFFE', 0), 'L': ('$BFFE', 1), 'K': ('$BFFE', 2), 'J': ('$BFFE', 3), 'H': ('$BFFE', 4),
    'SPACE': ('$7FFE', 0), 'SYMSHIFT': ('$7FFE', 1), 'M': ('$7FFE', 2), 'N': ('$7FFE', 3), 'B': ('$7FFE', 4),
}

# (od snímku, do snímku, klávesa) – snímky se počítají od začátku běhu.
# 48K snapshot startuje s loading screenem (PC=$E21D); nabídka ovládání
# (1 KEYBOARD / 2 KEMPSTON / 3 CURSOR / 4 INTERFACE II) přijde kolem snímku 1000.
# Přepsat lze z příkazové řádky: --keys 1250:1270:1
SCRIPT = [
    (1250, 1270, '1'),      # volba ovládání: klávesnice
]
# ve kterých snímcích uložit obrazovku (--shots 1,50,...)
SHOTS = (1, 200, 600, 1000, 1240, 1300, 1400, 1600, 2000)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('snapshot', nargs='?', default=os.path.join(HERE, '..', 'build/nodesofyesod-48k.z80'))
    ap.add_argument('--frames', type=int, default=1300, help='kolik snímků odsimulovat')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build'), help='kam ukládat PNG')
    ap.add_argument('--map', help='soubor pro mapu pokrytí (adresy provedených instrukcí)')
    ap.add_argument('--keys', action='append', default=[], metavar='OD:DO:KLAVESA',
                    help='přepíše SCRIPT: stisk klávesy mezi snímky OD a DO (lze víckrát)')
    ap.add_argument('--shots', help='ve kterých snímcích uložit obrazovku (čísla oddělená čárkou)')
    args = ap.parse_args()

    script = SCRIPT
    if args.keys:
        script = []
        for spec in args.keys:
            start, end, key = spec.split(':')
            script.append((int(start), int(end), key.upper()))
    shots = tuple(int(n) for n in args.shots.split(',')) if args.shots else SHOTS

    snapshot = Snapshot.get(args.snapshot)
    if snapshot is None:
        raise SystemExit('nelze nacist snapshot %s' % args.snapshot)
    cls = CSimulator or Simulator
    simulator = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                              {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Tracer(simulator, snapshot.border, snapshot.out7ffd, snapshot.outfffd,
                    list(snapshot.ay), snapshot.outfe, True)
    simulator.set_tracer(tracer)

    os.makedirs(args.out, exist_ok=True)
    saved = []

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = KEYS[key]
                keyboard[ROWS[row]] |= 1 << bit
        if frame in shots:
            path = os.path.join(args.out, 'frame%05d.png' % frame)
            write_png(path, scr_to_rgb(bytes(scr)), 256)
            with open(path[:-4] + '.scr', 'wb') as f:
                f.write(bytes(scr))
            saved.append(path)
        return frame < args.frames

    exec_map = set() if args.map else None
    tracer.run(snapshot.pc, -1, 0, 0, True, draw, exec_map, None, None, '$', '04X', '04X')
    for p in saved:
        print('ulozeno', p)
    if exec_map is not None:
        with open(args.map, 'w') as f:
            for a in sorted(exec_map):
                f.write('$%04X\n' % a)
        print('mapa pokryti: %s (%d adres)' % (args.map, len(exec_map)))


if __name__ == '__main__':
    main()
