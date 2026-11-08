#!/usr/bin/env python3
"""Ověří **model světa remaku proti originálu**: torus 16 × 16, stav místností
a geometrii průchodu po prokousané stěně.

    PYTHONPATH=tools/vendor ./tools/checkworld.py

Tři nezávislé kontroly, všechny proti **běžícímu originálu**, ne proti odhadu:

1. **Přechody.** Rutina `$882B` se spustí pro **všech 256 místností a všechny
   čtyři směry** (1024 kombinací) a vždycky jen ta její aritmetická část, která
   spočítá číslo místnosti; výsledek se porovná s `data/world.json`. Tím se
   ověří, že svět je opravdu torus a že číslování je `řádek*16 + sloupec`.

2. **Stav místností.** Bajt `$B600 + místnost` z **rozehrané hry** se porovná
   s tím, co si z něj remake vzal do `data/world.json` (bity 0, 1, 2 a 7).
   Bity 3 až 6 se neporovnávají a je to napsané: bit 3 je značka muggera a bity
   4-6 alchiemy, které si hra **losuje z registru `R`** (`$86EA`) – to je M5.

3. **Průchod po prokousané stěně.** U každé prokousatelné stěny se v originálu
   nastaví bit 0, spustí se jeho **vlastní** kreslicí rutina a zkontroluje se,
   že v obdélníku 2 × 6 buněk na sloupci 30 (a u sousedky vpravo na sloupci 0)
   opravdu zmizel bit 7 atributu – tedy že tou dírou jde projít.

Rozbor je v `sources/docs/disasm_notes.md` §8.5 a §11.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import roomlib                                                  # noqa: E402
from skoolkit.simutils import A, PC                             # noqa: E402

WORLD = os.path.join(HERE, '..', 'data', 'world.json')
MOLE  = os.path.join(HERE, '..', 'data', 'mole.json')

TRANSITION = 0x882B         # rutina přechodu; aritmetika končí na $8854
TRANSITION_END = 0x8854
DIRECTIONS = [('right', 1), ('left', 2), ('down', 4), ('up', 8)]

# bity $B600, které si remake bere do dat (§8.5); zbytek patří M5
STATE_BITS = 0x87


def load(path):
    with open(path) as f:
        return json.load(f)


def room_entry(world, room):
    rooms = world['rooms']
    return rooms[room] if isinstance(rooms, list) else rooms[str(room)]


def check_transitions(simulator, world):
    """Rutina `$882B` pro všech 256 × 4 kombinací proti `data/world.json`."""
    memory = simulator.memory
    registers = simulator.registers
    bad = []
    for room in range(256):
        entry = room_entry(world, room)
        for name, mask in DIRECTIONS:
            memory[roomlib.ROOM] = room
            memory[roomlib.ROOM + 1] = 0
            registers[A] = mask
            registers[PC] = TRANSITION
            simulator.run(TRANSITION, TRANSITION_END)
            got = registers[A]
            want = entry[name]
            if got != want:
                bad.append((room, name, got, want))
    return bad


def check_state(simulator, world):
    """Bajt `$B600 + místnost` z rozehrané hry proti `data/world.json`."""
    memory = simulator.memory
    bad, dug_at_load = [], 0
    for room in range(256):
        entry = room_entry(world, room)
        byte = memory[roomlib.ROOM_FLAGS + room]
        if byte & 0x01:
            dug_at_load += 1
        want = 0
        if entry['diggableRight']:
            want |= 0x02
        if entry['floorGap']:
            want |= 0x04
        if entry['special']:
            want |= 0x80
        if (byte & STATE_BITS & ~0x01) != want:
            bad.append((room, byte, want))
    return bad, dug_at_load


def check_gaps(simulator, world, image):
    """U každé prokousatelné stěny nastavit bit 0 a nechat originál nakreslit."""
    memory = simulator.memory
    gap = world['wallGap']
    columns = world['grid']['columns']
    bad = []
    diggable = [room for room in range(256)
                if room_entry(world, room)['diggableRight']]
    for room in diggable:
        # týž bit otevře pravou stěnu téhle místnosti a levou stěnu její
        # sousedky **vpravo** ($87DB čte stav sousedky vlevo, tedy tenhle bajt)
        right_neighbour = (room & ~(columns - 1)) | ((room + 1) & (columns - 1))
        roomlib.restore_memory(simulator, image)
        memory[roomlib.ROOM_FLAGS + room] |= 0x01
        for number, column in ((room, gap['xRight']), (right_neighbour, gap['xLeft'])):
            unused, attrs = roomlib.draw_room(simulator, number)
            solid = 0
            for row in range(gap['y'], gap['y'] + gap['height']):
                for col in range(column, column + gap['width']):
                    if attrs[row * roomlib.PLAY_COLS + col] & 0x80:
                        solid += 1
            if solid:
                bad.append((room, number, column, solid))
    return diggable, bad


def check_holes(mole, world):
    """Tabulka děr na povrchu: musí to být povrchové místnosti a body v ploše."""
    bad = []
    for hole in mole['surfaceHoles']:
        if hole['room'] >= 0x10:
            bad.append((hole['room'], 'neni povrchova mistnost'))
        for key in ('even', 'odd'):
            x, y = hole[key]
            if not (0 <= x < 256 and 0 <= y < 168):
                bad.append((hole['room'], '%s (%d,%d) mimo hraci plochu' % (key, x, y)))
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--quick', action='store_true',
                    help='vynechá kontrolu průchodů (kreslí 78 místností)')
    args = ap.parse_args()

    world = load(WORLD)
    mole = load(MOLE)
    simulator = roomlib.boot()
    image = roomlib.snapshot_memory(simulator)
    failures = 0

    bad = check_transitions(simulator, world)
    print('prechody ($882B, 256 mistnosti x 4 smery): %d rozdilu z 1024'
          % len(bad))
    for room, name, got, want in bad[:5]:
        print('  mistnost $%02X %s: original $%02X, data $%02X' % (room, name, got, want))
    failures += len(bad)

    roomlib.restore_memory(simulator, image)
    bad, dug = check_state(simulator, world)
    print('stav mistnosti ($B600, bity $%02X): %d rozdilu z 256' % (STATE_BITS, len(bad)))
    for room, byte, want in bad[:5]:
        print('  mistnost $%02X: original $%02X, data ceka $%02X' % (room, byte, want))
    print('  prokousanych sten v rozehrane hre: %d (na zacatku hry ma byt 0)' % dug)
    failures += len(bad) + dug

    if not args.quick:
        diggable, bad = check_gaps(simulator, world, image)
        print('prochody po prokousane stene: %d prokousatelnych, %d se neotevrelo'
              % (len(diggable), len(bad)))
        for room, number, column, solid in bad[:5]:
            print('  mistnost $%02X (kreslena $%02X, sloupec %d): %d bunek zustalo pevnych'
                  % (room, number, column, solid))
        failures += len(bad)

    bad = check_holes(mole, world)
    print('tabulka der na povrchu: %d der, %d problemu'
          % (len(mole['surfaceHoles']), len(bad)))
    for room, what in bad[:5]:
        print('  mistnost $%02X: %s' % (room, what))
    failures += len(bad)

    print('\nmodel sveta remaku proti originalu: %s'
          % ('NESOUHLASI' if failures else 'NULA ROZDILU'))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
