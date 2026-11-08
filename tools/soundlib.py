#!/usr/bin/env python3
"""Společný základ M7: **jak se z originálu měří zvuk**.

Zvuk 48K edice je jediný bit portu `$FE` (bit 4, reproduktor), takže „zvuk" není
vlnový průběh, ale **posloupnost délek pulzů**. Přesně v tom tvaru ho chce
i svision (`{fragments, pulses}` v `app/soundEffects.js`), takže se nic
nepřevzorkovává: co originál vyklepe na reproduktor, to remake vyklepe taky.

Měří se to tak, že se **rutina originálu pustí v simulátoru** a zapíše se, kdy
sáhla na port. SkoolKit to umí sám: `Tracer` si toggly bitu 4 ukládá do
`audio_log` i s časem v T-stavech, takže se nic nedopočítává z tabulky časů
instrukcí – bere se to, co simulátor opravdu odtikal.

Rutiny se volají **napřímo**: na zásobník se dá návratová adresa-sentinel a běží
se, dokud se na ni nedojde. Není k tomu potřeba rozehraná hra, protože tyhle
rutiny nic z herního stavu nečtou – parametr je v registru A (nebo v bajtu,
který si volající sám přepíše).
"""
import io, os, sys
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor'))
sys.path.insert(0, HERE)

from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.trace import Tracer                               # noqa: E402
from skoolkit.simutils import A, B, C, D, E, H, L, SP, T        # noqa: E402

SNAPSHOT = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.z80')
IMAGE    = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')

# Kam se skočí, až rutina skončí. Adresa v ROM, na kterou hra sama nikdy neskáče,
# takže se nedá splést s vlastním během rutiny.
SENTINEL = 0x0038

# Rutiny, jejichž pulzy se měří (adresa, jméno). Rozebráno v disasm_notes.md §13.
TONE       = 0x873C     # zahraj notu: A = bajt noty (bity 0-5 vyska, 6-7 delka)
TONE_RAW   = 0x8747     # totez, ale A uz je perioda a delka je na zasobniku
FANFARE    = 0x83BA     # dopadeny mugger: rozjizdejici se ton
MODE_BEEP  = 0xA2E5     # prepnuti clovek/krtek
TITLE_TUNE = 0x8704     # titulni hudba (7 dilu)
END_TUNE   = 0x870D     # hudba zaverecne obrazovky
SLOT1      = 0x9C81     # prerusovaci slot 1 (jeden snimek)
SLOT2      = 0x9C9B     # prerusovaci slot 2 (jeden snimek)

# adresy bajtů, které si volající přepisují (self-modifying code)
VAR_SLOT1_VALUE = 0x9C82
VAR_SLOT1_STEP  = 0x9C87
VAR_SLOT2_VALUE = 0x9CA5
VAR_DURATION    = 0x8767


def read_image():
    with open(IMAGE, 'rb') as f:
        data = f.read()
    if len(data) != 0xC000:
        raise SystemExit('%s neni obraz RAM $4000-$FFFF (spust tools/mksnapshot.sh)' % IMAGE)
    return data


def operand(image, addr, pattern, name):
    """Přečte operand instrukce a ověří, že na té adrese ta instrukce opravdu je.

    Táž disciplína jako `dumpphysics.py`: konstanta, která není operandem
    ověřené instrukce, se nevydá – nástroj skončí chybou.
    """
    parts = pattern.split()
    got = [image[addr - 0x4000 + i] for i in range(len(parts))]
    value, width = 0, 0
    for i, part in enumerate(parts):
        if part == '..':
            value |= got[i] << (8 * width)
            width += 1
        elif got[i] != int(part, 16):
            raise SystemExit('$%04X (%s): ceka se %s, v obrazu je %s'
                             % (addr, name, pattern,
                                ' '.join('%02X' % b for b in got)))
    return value, width


class Beeper:
    """Rutina originálu puštěná v simulátoru; z běhu vypadne posloupnost pulzů."""

    def __init__(self, snapshot_path=SNAPSHOT):
        self.snapshot = Snapshot.get(snapshot_path)
        if self.snapshot is None:
            raise SystemExit('nelze nacist snapshot %s' % snapshot_path)

    def run(self, address, registers=None, poke=None, max_tstates=40000000,
            stop=SENTINEL):
        """Zavolá rutinu a vrátí `(delky pulzu v T-stavech, celkovy cas, hladina)`.

        `delky` jsou rozdíly časů sousedních toggle bitu 4 – tedy přesně to,
        čemu svision říká `fragments`/`pulses`. První hodnota je čas **prvního**
        togglu od začátku rutiny (ticho před prvním pulzem).
        """
        memory = list(self.snapshot.memory)
        for addr, value in (poke or {}).items():
            memory[addr] = value
        simulator = Simulator(memory, config={'fast_djnz': False, 'fast_ldir': False})
        tracer = Tracer(simulator, 0, 0, 0, [0] * 16, 0x00, True)
        simulator.set_tracer(tracer)
        # Reproduktor je na začátku vypnutý, jako po zapnutí stroje. Bez toho by
        # Tracer první `OUT` bral jako změnu hladiny a do měření by přibyl pulz,
        # který se ve skutečnosti neozve.
        tracer.spkr = 0
        regs = simulator.registers
        stack = 0xFFFE
        memory[stack] = SENTINEL & 0xFF
        memory[stack + 1] = SENTINEL >> 8
        regs[SP] = stack
        for index, value in (registers or {}).items():
            regs[index] = value
        regs[T] = 0
        with redirect_stdout(io.StringIO()):
            tracer.run(address, stop, 0, max_tstates, False, None, None,
                       None, None, '$', '04X', '04X')
        times = [t for t, reg, _ in tracer.audio_log if reg == 0xFF]
        return times, regs[T]

    def pulses(self, address, registers=None, poke=None, max_tstates=40000000,
               stop=SENTINEL):
        """Jen délky pulzů (rozdíly časů toggle), bez náběhu."""
        times, total = self.run(address, registers, poke, max_tstates, stop)
        return [b - a for a, b in zip(times, times[1:])], total


def tone_pulses(beeper, note):
    """Pulzy jedné noty tak, jak je zahraje `$873C` (A = bajt noty)."""
    return beeper.pulses(TONE, {A: note})


def slot_pulses(beeper, slot, value, step=None):
    """Pulzy jednoho snímku přerušovacího slotu se zadanou hodnotou."""
    if slot == 1:
        poke = {VAR_SLOT1_VALUE: value, VAR_SLOT1_STEP: value if step is None else step}
        return beeper.pulses(SLOT1, None, poke)
    return beeper.pulses(SLOT2, None, {VAR_SLOT2_VALUE: value})
