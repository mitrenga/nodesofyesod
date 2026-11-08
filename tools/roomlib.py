#!/usr/bin/env python3
"""Společný základ dumperů M2: rozehraný originál v simulátoru a jeho vlastní
rutina kreslení místnosti.

Co se v M2 našlo (podrobně `sources/docs/disasm_notes.md` §8):

* `$5B04`   číslo aktuální místnosti, **mřížka 16 × 16** (`room = řádek*16 + sloupec`)
* `$E400`   stínový buffer hrací plochy, 5376 B: znakový řádek `r` leží na
            `$E400 + r*256`, v něm pixelový řádek `l` na `+ l*32`
* `$F900`   stínové atributy, 672 B (21 × 32)
* `$8857`   rutina „nakresli místnost do bufferu a překlop ji na obrazovku";
            končí na `$88B5`

Tím pádem se místnosti **nekreslí nástrojem**: nastaví se `$5B04`, spustí se
rutina originálu a přečte se, co po ní v bufferu zůstalo.
"""
import io, os, sys
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor'))
sys.path.insert(0, HERE)

from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.simutils import from_snapshot                     # noqa: E402
from skoolkit.trace import Tracer                               # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                             # pragma: no cover
    CSimulator = None

SNAPSHOT = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.z80')

ROOM        = 0x5B04        # číslo místnosti
VISITED     = 0x5B13        # bitmapa navštívených místností, 32 B
BUF_BITMAP  = 0xE400        # stínový buffer hrací plochy
BUF_ATTRS   = 0xF900        # stínové atributy
DRAW_ROOM   = 0x8857        # vstup do kreslení místnosti
DRAW_END    = 0x88B5        # kam doběhne
ROOM_FLAGS  = 0xB600        # 256 B: bit 0 = průchod vpravo (viz §8)
ROOM_SCENE  = 0xB500        # 256 B: bity 7-6 sada dlaždic, bity 5-0 popis kulisy
THEME_TABLE = 0x62AC        # 4 × (ukazatel na dlaždice, ukazatel na display list)
OBJECT_LIST = 0xDBFD        # seznam kulisových doplňků po místnostech (od místnosti $10)
MIRROR_TAB  = 0xFE00        # tabulka zrcadlení bajtu (dlaždice s bitem 7 v indexu)

PLAY_ROWS, PLAY_COLS = 21, 32
PLAY_LINES = PLAY_ROWS * 8

# klávesa -> (index půlřádku, bit); stejné jako v playtrace.py
KEYS = {'1': (3, 0), 'B': (7, 4), 'Z': (0, 1), 'Q': (2, 0)}
MENU = [(1250, 1270, '1')]      # nabídka ovládání: 1 = KEYBOARD


def boot(frames=1400, script=None, snapshot_path=SNAPSHOT):
    """Rozehraje originál do zvoleného snímku a vrátí simulátor.

    Výchozí 1400 = hra už běží (nabídka ovládání odkliknutá kolem 1250)
    a Charlie stojí na povrchu.
    """
    snapshot = Snapshot.get(snapshot_path)
    if snapshot is None:
        raise SystemExit('nelze nacist snapshot %s' % snapshot_path)
    cls = CSimulator or Simulator
    simulator = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                              {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Tracer(simulator, snapshot.border, snapshot.out7ffd, snapshot.outfffd,
                    list(snapshot.ay), snapshot.outfe, True)
    simulator.set_tracer(tracer)
    script = MENU if script is None else script

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = KEYS[key]
                keyboard[row] |= 1 << bit
        return frame < frames

    with redirect_stdout(io.StringIO()):
        tracer.run(snapshot.pc, -1, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
    simulator.set_tracer(None)
    return simulator


def snapshot_memory(simulator):
    return bytearray(simulator.memory[0x4000:0x10000])


def restore_memory(simulator, image):
    memory = simulator.memory
    memory[0x4000:0x10000] = list(image)


def draw_room(simulator, room):
    """Nakreslí místnost `room` **rutinou originálu** a vrátí obsah bufferů.

    Vrací (bitmapa 5376 B, atributy 672 B) – skutečné bajty, které po rutině
    v bufferu zůstaly, ne nic překresleného.
    """
    memory = simulator.memory
    memory[ROOM] = room
    memory[ROOM + 1] = 0
    simulator.run(DRAW_ROOM, DRAW_END)
    return (bytes(bytearray(memory[BUF_BITMAP:BUF_BITMAP + PLAY_LINES * 32])),
            bytes(bytearray(memory[BUF_ATTRS:BUF_ATTRS + PLAY_ROWS * 32])))


def screen_offset(y):
    """Nelineární adresování obrazovky ZX: pixelový řádek -> offset v .scr."""
    third, char_row, pix = y >> 6, (y >> 3) & 7, y & 7
    return (third << 11) | (pix << 8) | (char_row << 5)


def buffer_to_scr(bitmap, attrs, panel=None):
    """Z bufferu (lineárně po řádcích) udělá .scr 6912 B; panel se dá přidat."""
    scr = bytearray(6912)
    for y in range(PLAY_LINES):
        scr[screen_offset(y):screen_offset(y) + 32] = bitmap[y * 32:y * 32 + 32]
    scr[6144:6144 + len(attrs)] = attrs
    if panel is not None:
        pbits, pattrs = panel
        for y in range(PLAY_LINES, 192):
            off = screen_offset(y)
            scr[off:off + 32] = pbits[(y - PLAY_LINES) * 32:(y - PLAY_LINES) * 32 + 32]
        scr[6144 + len(attrs):6912] = pattrs
    return bytes(scr)
