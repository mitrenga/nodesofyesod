#!/usr/bin/env python3
"""Nahraje **běh originálu s krtkem** – záznam krtka, stav světa a žranou stěnu.

    PYTHONPATH=tools/vendor ./tools/molelog.py --suite

Tentýž způsob jako `physlog.py` (M3): vzorkuje se na `$8F44`, tj. **na začátku
průchodu, který originál dělá s Charliem**, a zapisuje se všechno, na co M4
sahá:

* celý **32bajtový záznam krtka** (`$FDC0`) i Charlieho (`$FDE0`),
* proměnné `$5B0A`, `$5B0B`, `$5B0E` (jednotky hodin), `$5B11` (počítadlo
  žraní), `$5B69` (poslední směr krtka), `$5BAE`, `$5B04`, `$A2B7`, `$7ED9`,
  `$7EE0` a sebemodifikovaná místa pádu,
* **perzistentní stav světa** `$B600` (256 B) pokaždé, když se změní – to je ta
  věc, kterou krtek mění,
* **kolizní mapa** (stínové atributy `$F900`, 672 B) pokaždé, když se změní –
  tam se po dožrání stěny vyřeže díra,
* **bitmapa obou průchodů** (2 × 6 buněk vlevo a vpravo, `$F100` a `$F11E`) –
  to je to, co se při žraní ubývá po dvoupixelových kouscích.

Sada běhů je vypsaná ve `SUITE` schválně tak, aby se dala zopakovat jedním
příkazem, a pokrývá to, co je v `MILNIKY.md` u M4: **ulovení krtka na povrchu**
(Charlie na něj musí skočit – krtek je nad ním, viz §11), **vypuštění pod
povrchem**, **jízdu**, **prokousání pravé i levé stěny včetně celého žraní**,
**sesednutí**, **průchod Charlieho novou dírou do sousední místnosti** a
**whirlwind**.

Nahrávky jdou do `build/molruns/`, tedy **mimo git**.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

PASS_ENTRY = 0x8F44         # $7DD3 CALL $8F44 – začátek průchodu s Charliem
STEP_TEST  = (0x8EB2, 0x80E5)
MOLE = 0xFDC0
STATE = 0xB600              # perzistentní stav místností
BUFFER = 0xE400             # stínový buffer hrací plochy

# proměnné, na které M3 i M4 sahají (M4 přidala clock, moleDir a digCounter)
VARS = {'flags': 0x5B0A, 'input': 0x5B0B, 'lastDir': 0x5BAE, 'room': 0x5B04,
        'a2b7': 0xA2B7, 'f7ed9': 0x7ED9, 'f7ee0': 0x7EE0,
        'clock': 0x5B0E, 'moleDir': 0x5B69, 'digCounter': 0x5B11,
        'fallCounter': 0x8180, 'fallStepLo': 0x81A4, 'fallStepHi': 0x81A5,
        'fallFrame': 0x81D5}

# průchod je 2 buňky široký a 6 vysoký; v bufferu leží znakový řádek r na
# +r*256 a v něm pixelová řádka l na +l*32 (§8.1)
GAP_ROW, GAP_ROWS, GAP_COLS = 13, 6, 2
GAPS = {'left': 0, 'right': 30}

OUT = os.path.join(HERE, '..', 'build', 'molruns')


def gap_bytes(memory):
    """Bitmapa obou průchodů ze stínového bufferu, 2 × 96 B."""
    out = bytearray()
    for name in ('left', 'right'):
        column = GAPS[name]
        for row in range(GAP_ROW, GAP_ROW + GAP_ROWS):
            for line in range(8):
                base = BUFFER + row*256 + line*32 + column
                out += bytes(bytearray(memory[base:base + GAP_COLS]))
    return bytes(out)


def record_run(keys, start, end, snapshot=physlib.SNAPSHOT):
    session = physlib.Session(snapshot).boot(start, keys)
    machine = session.to_python()
    memory = machine.memory
    registers = machine.simulator.registers
    samples = []
    pools = {'maps': [], 'states': [], 'gaps': []}
    state = {'frame': 0}

    def intern(pool, value):
        """Do nahrávky jde jen změna; index je to, co se opakuje."""
        if not pools[pool] or pools[pool][-1] != value:
            pools[pool].append(value)
        return len(pools[pool]) - 1

    class Probe:
        def add(self, pc):
            if pc in STEP_TEST and samples:
                if pc == 0x80E5 or registers[9] + 256*registers[8] == physlib.CHARLIE:
                    if samples[-1].get('delayAtStep') is None:
                        samples[-1]['delayAtStep'] = memory[physlib.CHARLIE + 0x0B]
                return
            if pc != PASS_ENTRY or registers[9] + 256*registers[8] != physlib.CHARLIE:
                return
            attrs = bytes(bytearray(memory[physlib.BUF_ATTRS:physlib.BUF_ATTRS + 672]))
            world = bytes(bytearray(memory[STATE:STATE + 256]))
            sample = {'frame': state['frame'], 'delayAtStep': None,
                      'map': intern('maps', attrs),
                      'state': intern('states', world),
                      'gap': intern('gaps', gap_bytes(memory)),
                      'charlie': list(memory[physlib.CHARLIE:physlib.CHARLIE + 32]),
                      'mole': list(memory[MOLE:MOLE + 32])}
            for name, addr in VARS.items():
                sample[name] = memory[addr]
            samples.append(sample)

    def on_frame(frame):
        state['frame'] = frame

    machine.run(end, keys, on_frame=on_frame, exec_map=Probe())
    return {'keys': [list(k) for k in keys], 'start': start, 'end': end,
            'passes': samples,
            'maps': [base64.b64encode(m).decode('ascii') for m in pools['maps']],
            'states': [base64.b64encode(m).decode('ascii') for m in pools['states']],
            'gaps': [base64.b64encode(m).decode('ascii') for m in pools['gaps']]}


# Cesta, na které to jde nahrát bez jediného sáhnutí do paměti hry:
#   1450-1500  B   Charlie jde od startu doprava k díře v místnosti $06
#   1505-1910  Q   skáče na místě; když z díry vyleze krtek, skočí na něj
#                  a tím ho uloví ($9DD6) – krtek je NAD Charliem, ne pod ním
#   1915-...   X   jde doleva a propadne se do jeskyně $14 (prokousatelná
#                  pravá stěna)
CATCH = ['1450:1500:B', '1505:1910:Q']
TO_CAVE = CATCH + ['1915:2280:X']
# a druhá cesta: po ulovení doprava, tam se propadne do jeskyně $17, jejíž
# **levá** stěna je pravá stěna prokousatelné místnosti $16
TO_CAVE_RIGHT = CATCH + ['1915:2250:B']

SUITE = [
    # ulovení krtka na povrchu: vyleze z díry a Charlie na něj skočí
    ('catch',     CATCH,                                          1440, 1960),
    # vypuštění krtka pod povrchem a jízda doprava
    ('spawn',     TO_CAVE + ['2300:2310:1', '2320:2500:B'],        2280, 2520),
    # prokousání PRAVÉ stěny místnosti $14 včetně celého žraní (193 průchodů)
    ('digright',  TO_CAVE + ['2300:2310:1', '2320:2900:B',
                             '2400:2900:A'],                      2280, 2900),
    # a hned za ním průchod Charlieho novou dírou do sousední místnosti
    ('cross',     TO_CAVE + ['2300:2310:1', '2320:2900:B',
                             '2400:2900:A', '2905:2915:1',
                             '2960:3400:B'],                      2890, 3400),
    # prokousání LEVÉ stěny (= pravé stěny sousedky vlevo): v místnosti $17
    # jede krtek doleva a dolů
    ('digleft',   TO_CAVE_RIGHT + ['2300:2310:1', '2320:2850:X',
                                   '2405:2412:A'],                2290, 2850),
    # sesednutí: přepínač podruhé
    ('dismount',  TO_CAVE + ['2300:2310:1', '2320:2400:B',
                             '2450:2460:1'],                      2280, 2560),
]


def record_suite(names=None):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, keys, start, end in SUITE:
        if names and name not in names:
            continue
        run = record_run(list(physlib.MENU) + physlib.parse_keys(keys), start, end)
        path = os.path.join(OUT, name + '.json')
        with open(path, 'w') as f:
            json.dump(run, f, separators=(',', ':'))
            f.write('\n')
        rooms = sorted({p['room'] for p in run['passes']})
        moles = sum(1 for p in run['passes'] if p['mole'][0] & 1)
        digs = sum(1 for p in run['passes'] if p['flags'] & 0x18)
        total += len(run['passes'])
        print('%-9s %4d pruchodu, mistnosti %s, krtek videt %dx, zere %dx, '
              'stavu sveta %d, map %d, bitmap prochodu %d -> %s'
              % (name, len(run['passes']), ['$%02X' % r for r in rooms],
                 moles, digs, len(run['states']), len(run['maps']),
                 len(run['gaps']), os.path.relpath(path)))
    print('celkem %d pruchodu' % total)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--suite', action='store_true', help='nahraje celou sadu běhů M4')
    ap.add_argument('--only', action='append', default=[], help='jen tyhle běhy')
    ap.add_argument('--keys', action='append', default=[], metavar='OD:DO:KLAVESA')
    ap.add_argument('--start', type=int, default=physlib.GAME_FRAME)
    ap.add_argument('--end', type=int, default=physlib.GAME_FRAME + 200)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    if args.suite or args.only:
        record_suite(args.only or None)
        return

    keys = list(physlib.MENU) + physlib.parse_keys(args.keys)
    run = record_run(keys, args.start, args.end)
    os.makedirs(OUT, exist_ok=True)
    path = args.out or os.path.join(OUT, 'run.json')
    with open(path, 'w') as f:
        json.dump(run, f, separators=(',', ':'))
        f.write('\n')
    print('%d pruchodu, %d stavu sveta, %d map, %d bitmap prochodu -> %s'
          % (len(run['passes']), len(run['states']), len(run['maps']),
             len(run['gaps']), path))
    if run['passes']:
        first, last = run['passes'][0], run['passes'][-1]
        print('  krtek $%02X -> $%02X, A2B7 $%02X -> $%02X, mistnost $%02X -> $%02X'
              % (first['mole'][0], last['mole'][0], first['a2b7'], last['a2b7'],
                 first['room'], last['room']))


if __name__ == '__main__':
    main()
