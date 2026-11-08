#!/usr/bin/env python3
"""Vytáhne **všech 256 místností** – ne tak, že by je nástroj kreslil, ale tak,
že se v simulátoru spustí **kreslicí rutina originálu** a zaznamená se, které
bloky a dlaždice kam položila.

    ./tools/dumprooms.py [--rooms 0-255] [--png build/rooms] [--show]

Jak to funguje (`sources/docs/disasm_notes.md` §8):

1. Hra se rozehraje do chvíle, kdy běží (`tools/roomlib.py`).
2. Nastaví se `$5B04` (číslo místnosti) a zavolá se `$8857`, tj. rutina
   „nakresli místnost do stínového bufferu a překlop ji na obrazovku".
3. Krokuje se po instrukcích a zapisuje se:
   * `$8A87` – **položení bloku** z display listu na (sloupec, řádek),
   * `$8A3B` – **položení jedné dlaždice** (bloky se z nich skládají; některé
     dlaždice ale rutina pokládá i mimo bloky – tak se vyřezávají průchody
     v bočních stěnách),
   * `$89B7` – **vyplnění bufferu** (atribut pozadí),
   * `$8C2E` a `$87E1` – **shození bitu 7 atributů** v obdélníku 4 × 3 (povrch),
     resp. 8 × 2 na (12, 19) (díra v podlaze, `$B600` bit 2). Bit 7 atributu
     není blikání – obrazovkový blit ho maskuje `AND $7F` – je to příznak hry,
   * `$8915` – **hvězda**: jeden pixel (`SET 3`) na povrchu, souřadnice
     z pevné tabulky na `$5D59`. Hvězdy tedy losované nejsou; losuje se až
     jejich blikání za běhu (`$8939`, registr `R`).
4. Po doběhnutí se přečte stínový buffer `$E400`/`$F900` – to jsou skutečné
   bajty, proti kterým pak `tools/matchscreen.py` porovnává složeninu remaku.

Výstup: `data/world.json` (popis světa, jde do appData) a `data/rooms.json`
(placementy po místnostech, dotahuje se na vyžádání).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor'))
sys.path.insert(0, HERE)

import roomlib                                                  # noqa: E402

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
from scr2png import scr_to_rgb, write_png                       # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simutils import from_snapshot                     # noqa: E402

# adresy, na kterých se odposlouchává (viz docstring)
PUT_BLOCK, PUT_BLOCK_RET = 0x8A87, 0x8AC7
PUT_TILE = 0x8A3C           # $8A3B je EX AF,AF' – až za ní je v A index dlaždice
CLEAR_BUFFERS = 0x89B7
SKY_FILL = 0x8BD7           # povrch: horních 6 znakových řádků atributem $40
ATTR_CLEAR = 0x8C2E         # povrch: RES 7 v atributech, obdélník 4 x 3
FLOOR_GAP = 0x87E1          # jeskyně: RES 7 v atributech, obdélník 8 x 2 na (12, 19)
FLOOR_GAP_RECT = (12, 19, 8, 2)
STAR = 0x8915               # povrch: SET 3,(HL) – jedna hvězda v bitmapě
SKY_ROWS, SKY_ATTR = 6, 0x40

# indexy registrů v poli simulátoru
rA, rD, rE, rH, rL, rPC = 0, 4, 5, 6, 7, 24

ROWS, COLS = roomlib.PLAY_ROWS, roomlib.PLAY_COLS


class Recorder:
    """Pythonový simulátor nasazený na paměť rozehrané hry, krokovaný po instrukcích."""

    def __init__(self, snapshot_path=roomlib.SNAPSHOT, frames=1400,
                 image_path=None):
        live = roomlib.boot(frames, snapshot_path=snapshot_path)
        snapshot = Snapshot.get(snapshot_path)
        self.sim = from_snapshot(Simulator, snapshot, {}, {'ay': [None] * 16},
                                 {'fast_djnz': False, 'fast_ldir': False}, None)
        for i in range(min(len(self.sim.registers), len(live.registers))):
            self.sim.registers[i] = live.registers[i]
        self.image = roomlib.snapshot_memory(live)
        # Stav světa na začátku hry: `$B600` bit 0 = **prokousaná pravá stěna**.
        # V obrazu po nahrání je nastavený u všech prokousatelných stěn a hra
        # ho při startu shodí; kvůli určitosti ho tady shodíme taky, takže
        # výstup je svět **na začátku hry**, ne v půlce rozehrané partie.
        for room in range(256):
            self.image[roomlib.ROOM_FLAGS - 0x4000 + room] &= ~0x01
        # co je v obrazu po nahrání (bity 4-7 hra při startu losuje – viz §8)
        self.at_load = open(image_path or IMAGE, 'rb').read()
        self.memory = self.sim.memory

    def room(self, room):
        """Nakreslí místnost a vrátí, co při tom rutina originálu udělala."""
        memory, regs, step = self.memory, self.sim.registers, self.sim.run
        memory[0x4000:0x10000] = list(self.image)
        memory[roomlib.ROOM] = room
        memory[roomlib.ROOM + 1] = 0
        regs[rPC] = roomlib.DRAW_ROOM

        blocks, tiles, clears, pixels = [], [], [], []
        fill_attr, sky = None, False
        block = None
        while True:
            pc = regs[rPC]
            if pc == roomlib.DRAW_END:
                break
            if pc == PUT_BLOCK:
                block = [regs[rA], regs[rD], regs[rE], []]
                blocks.append(block)
            elif pc == PUT_BLOCK_RET:
                block = None
            elif pc == PUT_TILE:
                placement = (regs[rA], regs[rD], regs[rE])
                if block is not None:
                    block[3].append(placement)
                else:
                    tiles.append(placement)
            elif pc == CLEAR_BUFFERS:
                fill_attr = regs[rA]
            elif pc == SKY_FILL:
                sky = True
            elif pc == ATTR_CLEAR:
                clears.append((regs[rD], regs[rE] + 1, 4, 3))
            elif pc == FLOOR_GAP:
                clears.append(FLOOR_GAP_RECT)
            elif pc == STAR:
                pixels.append(((regs[rH] << 8 | regs[rL]) - roomlib.BUF_BITMAP, 0x08))
            step()

        bitmap = bytes(bytearray(memory[roomlib.BUF_BITMAP:
                                        roomlib.BUF_BITMAP + ROWS * 8 * 32]))
        attrs = bytes(bytearray(memory[roomlib.BUF_ATTRS:
                                       roomlib.BUF_ATTRS + ROWS * 32]))
        return {
            'room': room,
            'scene': self.image[0xB500 - 0x4000 + room],
            'flags': self.image[0xB600 - 0x4000 + room],
            'fillAttr': fill_attr,
            'skyAttr': SKY_ATTR if sky else None,
            'skyRows': SKY_ROWS if sky else 0,
            'blocks': [[b[0], b[1], b[2]] for b in blocks],
            'looseTiles': [list(t) for t in tiles],
            'attrClear': [list(c) for c in clears],
            'pixelSet': [list(p) for p in pixels],
            'bitmap': bitmap, 'attrs': attrs,
        }


def visible(placements):
    """Dlaždice, které se do hrací plochy vešly (rutina originálu ostatní zahodí)."""
    return [(t, x, y) for t, x, y in placements if x < COLS and y < ROWS]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rooms', default='0-255', help='rozsah mistnosti, napr. 0-255 nebo 23')
    ap.add_argument('--world', default=os.path.join(HERE, '..', 'data', 'world.json'))
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'rooms.json'))
    ap.add_argument('--png', default='', help='adresar pro nahledy PNG (nepovinne)')
    ap.add_argument('--dump', default=os.path.join(HERE, '..', 'build', 'rooms'),
                    help='kam ulozit referencni buffery pro matchscreen.py')
    ap.add_argument('--show', action='store_true')
    args = ap.parse_args()

    if '-' in args.rooms:
        lo, hi = (int(x) for x in args.rooms.split('-'))
        wanted = range(lo, hi + 1)
    else:
        wanted = [int(args.rooms, 0)]

    recorder = Recorder()
    rooms, world = {}, {}
    if args.dump:
        os.makedirs(args.dump, exist_ok=True)
    if args.png:
        os.makedirs(args.png, exist_ok=True)

    for room in wanted:
        result = recorder.room(room)
        scene = result['scene']
        theme, shape = scene >> 6, scene & 0x3F
        at_load = recorder.at_load[roomlib.ROOM_FLAGS - 0x4000 + room]
        col, row = room & 0x0F, room >> 4
        rooms['%d' % room] = {
            'theme': theme,
            'fillAttr': result['fillAttr'],
            'skyAttr': result['skyAttr'],
            'skyRows': result['skyRows'],
            'blocks': result['blocks'],
            'looseTiles': result['looseTiles'],
            'attrClear': result['attrClear'],
            'pixelSet': result['pixelSet'],
        }
        world['%d' % room] = {
            'theme': theme, 'shape': shape, 'scene': scene,
            'flagsAtLoad': at_load,
            'diggableRight': bool(at_load & 0x02),
            'floorGap': bool(at_load & 0x04),
            'special': bool(at_load & 0x80),
            'right': (row << 4) | ((col + 1) & 0x0F),
            'left': (row << 4) | ((col - 1) & 0x0F),
            'down': (((row + 1) & 0x0F) << 4) | col,
            'up': (((row - 1) & 0x0F) << 4) | col,
        }
        if args.dump:
            with open(os.path.join(args.dump, 'room%03d.bin' % room), 'wb') as f:
                f.write(result['bitmap'] + result['attrs'])
        if args.png:
            scr = roomlib.buffer_to_scr(result['bitmap'], result['attrs'])
            write_png(os.path.join(args.png, 'room%03d.png' % room),
                      scr_to_rgb(scr), 256)
        if args.show:
            print('mistnost %3d ($%02X) sada %d tvar %2d  bloku %3d  volnych dlazdic %3d'
                  % (room, room, theme, shape, len(result['blocks']),
                     len(result['looseTiles'])))

    payload = {
        'note': 'M2: co v místnosti položila kreslicí rutina originálu '
                '(tools/dumprooms.py). Bloky jsou indexy do display listu sady '
                '(data/scenery.json), volné dlaždice jsou indexy dlaždic. '
                'Souřadnice jsou znakové buňky a berou se v bajtové aritmetice: '
                'sloupec i řádek se počítají mod 256 a co vypadne z 32 x 21, '
                'se zahazuje – přesně jako v originálu.',
        'grid': {'columns': 16, 'rows': 16},
        'playArea': {'columns': COLS, 'rows': ROWS},
        'rooms': rooms,
    }
    with open(args.out, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
        f.write('\n')
    with open(args.world, 'w') as f:
        json.dump({
            'note': 'M2: popis světa (tools/dumprooms.py). room = řádek*16 + '
                    'sloupec; svět je **torus** – v řádku i ve sloupci se '
                    'zacykluje (odvozeno z rutiny přechodu $882B). `scene` je '
                    'bajt z $B500: bity 7-6 sada dlaždic, bity 5-0 index tvaru. '
                    '`flagsAtLoad` je bajt z $B600 v obrazu po nahrání.',
            'grid': {'columns': 16, 'rows': 16},
            'stateBits': {
                'note': 'Bajt na $B600 + číslo místnosti je **perzistentní stav '
                        'místnosti**, ne pevná vlastnost. Tohle je hlavní nález '
                        'M2 – datový model remaku ho musí mít od začátku.',
                '0': 'pravá stěna je prokousaná – hra pak do kulisy vyřeže '
                     'průchod 2 x 6 buněk; sousedovi vlevo se týmž bitem vyřeže '
                     'průchod v levé stěně. Krtek ho nastaví ($A1E2 SET 0,(HL), '
                     'jen když je nastavený bit 1). Při startu hry se shazuje.',
                '1': 'pravá stěna je prokousatelná (pevná vlastnost místnosti)',
                '2': 'díra v podlaze – obdélník 8 x 2 na (12, 19) má shozený '
                     'bit 7 atributu ($87E1)',
                '3': 'místnost je označená (obsluha muggera, $83B8 SET 3,(HL))',
                '6': 'v místnosti leží alchiem',
                '7': 'zvláštní místnost – má záznam v tabulce na $5D68 ($88DB)',
                'runtime': 'Bity 0 a 3-7 se za hry mění. Bity 4-7 hra **losuje '
                           'při startu** ($86EA čte registr R), takže rozmístění '
                           'alchiemů není v datech a v remaku se losuje taky.',
            },
            'wallGap': {'note': 'co hra vyřeže do kulisy při prokousané stěně '
                                '($87C7 vpravo, $87DB vlevo)',
                        'tile': 0, 'width': 2, 'height': 6,
                        'y': 13, 'xRight': 30, 'xLeft': 0},
            'rooms': world,
        }, f, separators=(',', ':'))
        f.write('\n')

    print('%s: %d mistnosti' % (args.out, len(rooms)))
    print('%s: mrizka 16 x 16' % args.world)
    if args.dump:
        print('%s: referencni buffery pro matchscreen.py' % args.dump)


if __name__ == '__main__':
    main()
