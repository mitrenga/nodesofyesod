#!/usr/bin/env python3
"""Společný základ nástrojů M3: rozehraný originál, záznam Charlieho a jeho fyzika.

Co se v M3 našlo (podrobně `sources/docs/disasm_notes.md` §10):

* `$FDE0`   **záznam Charlieho** – tentýž tvar jako záznam entity (hlavička spritu
            v `+3..+5`, ukazatel na bitmapu v `+7/+8`), ale na pevné adrese;
            `LD IX,$FDE0` na `$7F9B` i `$81DC`
* `$F900`   stínové atributy hrací plochy; **bit 7 atributu = pevná buňka**
            (blit ho maskuje `AND $7F`, takže se na obrazovku nedostane) –
            tohle je kolizní mapa, se kterou fyzika pracuje

Nástroj běží ve dvou režimech:

* **rychlý** (`CSimulator`) – rozehraje hru a čte paměť po snímcích;
* **instrumentovaný** (`Simulator` v čistém Pythonu s obalenou pamětí) – zapisuje,
  která instrukce kam sáhla. Je řádově pomalejší, proto se jím jede jen krátké okno
  a před ním se hra rozehraje rychlým režimem.
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

CHARLIE     = 0xFDE0        # záznam Charlieho (viz §10)
ROOM        = 0x5B04        # číslo místnosti
LIVES       = 0x5B09
BUF_BITMAP  = 0xE400        # stínový buffer hrací plochy
BUF_ATTRS   = 0xF900        # stínové atributy = kolizní mapa (bit 7 = pevná buňka)
PLAY_ROWS, PLAY_COLS = 21, 32

# klávesa -> (index půlřádku v poli keyboard[], bit); celá matice, hw_notes.md §6
KEYS = {
    'CAPS': (0, 0), 'Z': (0, 1), 'X': (0, 2), 'C': (0, 3), 'V': (0, 4),
    'A': (1, 0), 'S': (1, 1), 'D': (1, 2), 'F': (1, 3), 'G': (1, 4),
    'Q': (2, 0), 'W': (2, 1), 'E': (2, 2), 'R': (2, 3), 'T': (2, 4),
    '1': (3, 0), '2': (3, 1), '3': (3, 2), '4': (3, 3), '5': (3, 4),
    '0': (4, 0), '9': (4, 1), '8': (4, 2), '7': (4, 3), '6': (4, 4),
    'P': (5, 0), 'O': (5, 1), 'I': (5, 2), 'U': (5, 3), 'Y': (5, 4),
    'ENTER': (6, 0), 'L': (6, 1), 'K': (6, 2), 'J': (6, 3), 'H': (6, 4),
    'SPACE': (7, 0), 'SYMSHIFT': (7, 1), 'M': (7, 2), 'N': (7, 3), 'B': (7, 4),
}
# Akce remaku -> klávesa originálu (WORKER-PROTOCOL.md „Akce a proč jsou zrovna tyhle")
ACTION_KEYS = {'left': 'Z', 'right': 'B', 'up': 'Q', 'down': 'A', 'mode': '1'}

MENU = [(1250, 1270, '1')]          # nabídka ovládání: 1 = KEYBOARD
GAME_FRAME = 1400                   # hra běží, Charlie stojí na povrchu


def parse_keys(specs):
    """"1450:1500:B" -> [(1450, 1500, 'B')]"""
    script = []
    for spec in specs:
        for part in filter(None, spec.split(',')):
            start, end, key = part.split(':')
            script.append((int(start), int(end), key.upper()))
    return script


class Session:
    """Rozehraný originál, do kterého se dá mačkat a ze kterého se dá číst."""

    def __init__(self, snapshot_path=SNAPSHOT, python=False):
        self.snapshot = Snapshot.get(snapshot_path)
        if self.snapshot is None:
            raise SystemExit('nelze nacist snapshot %s' % snapshot_path)
        cls = Simulator if python or CSimulator is None else CSimulator
        self.simulator = from_snapshot(cls, self.snapshot, {}, {'ay': [None] * 16},
                                       {'fast_djnz': False, 'fast_ldir': False}, None)
        self._new_tracer()
        self.frame = 0

    def _new_tracer(self):
        snapshot = self.snapshot
        self.tracer = Tracer(self.simulator, snapshot.border, snapshot.out7ffd,
                             snapshot.outfffd, list(snapshot.ay), snapshot.outfe, True)
        self.simulator.set_tracer(self.tracer)

    @property
    def memory(self):
        return self.simulator.memory

    def run(self, until, script=(), on_frame=None, exec_map=None):
        """Doběhne do snímku `until`, drží klávesy podle `script` a po každém
        snímku zavolá `on_frame(frame)`."""
        def draw(scr, frame, border, keyboard):
            for i in range(8):
                keyboard[i] = 0
            for start, end, key in script:
                if start <= frame < end:
                    row, bit = KEYS[key]
                    keyboard[row] |= 1 << bit
            self.frame = frame
            if on_frame is not None:
                on_frame(frame)
            return frame < until
        pc = self.simulator.registers[24] if self.frame else self.snapshot.pc
        with redirect_stdout(io.StringIO()):
            self.tracer.run(pc, -1, 0, 0, True, draw, exec_map, None, None, '$', '04X', '04X')
        return self

    def boot(self, until=GAME_FRAME, script=None):
        """Rozehraje hru: odklikne nabídku ovládání a nechá Charlieho stát na povrchu."""
        return self.run(until, list(MENU) + list(script or []))

    def to_python(self, memory_cls=None):
        """Předá stav simulátoru čistě pythonovému simulátoru (kvůli instrumentaci).

        Vrací nový `Session`; snímkové číslo pokračuje, protože se přenáší i čas
        v T-stavech (`registers[25]`), ze kterého Tracer čísluje snímky.
        """
        other = Session.__new__(Session)
        other.snapshot = self.snapshot
        memory = list(self.simulator.memory)
        if memory_cls is not None:
            memory = memory_cls(memory)
        other.simulator = Simulator(memory, config={'fast_djnz': False, 'fast_ldir': False})
        other.simulator.registers[:] = list(self.simulator.registers)
        other.frame = self.frame
        other._new_tracer()
        return other


def charlie(memory):
    """Záznam Charlieho jako slovník – jen pojmenovaná pole, nic dopočítaného."""
    r = memory[CHARLIE:CHARLIE + 16]
    return {'flags': r[0], 'x': r[1], 'y': r[2], 'w': r[3], 'h': r[4], 'attr': r[5],
            'frame': r[6], 'bitmap': r[7] + 256 * r[8], 'anim': r[9] + 256 * r[10],
            'b11': r[11], 'b12': r[12], 'b13': r[13], 'b14': r[14], 'b15': r[15]}


def solid(memory, col, row):
    """Kolizní mapa: bit 7 stínového atributu na (sloupec, znakový řádek)."""
    if not (0 <= col < PLAY_COLS and 0 <= row < PLAY_ROWS):
        return False
    return bool(memory[BUF_ATTRS + row * PLAY_COLS + col] & 0x80)
