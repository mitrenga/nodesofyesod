#!/usr/bin/env python3
"""Nahraje **běh originálu** jako záznam Charlieho krok po kroku.

    PYTHONPATH=tools/vendor ./tools/physlog.py --keys 1450:1600:B --out build/physruns/walk.json

Vzorkuje se na `$8F44`, tj. **na začátku průchodu, který originál dělá s
Charliem** (`$7DD3 CALL $8F44`, viz `sources/docs/disasm_notes.md` §10). V tu
chvíli je v `$5B0B` vstup přečtený na konci minulého průchodu – přesně ten, který
tenhle průchod spotřebuje. Zapisuje se:

* celý **32bajtový záznam** Charlieho (`$FDE0`),
* **počítadlo `(+$0B)` v okamžiku, kdy se testuje jeho bit 7** (`$8EB2`, `$80E5`):
  snižuje ho přerušení, a to může padnout doprostřed průchodu, takže hodnota na
  začátku průchodu není ta, podle které se krok skriptu rozhoduje,
* proměnné, na které fyzika sahá: `$5B0A`, `$5B0B`, `$5BAE`, `$5B04`, `$A2B7`,
  `$7ED9`, `$7EE0` a obě sebemodifikovaná místa pádu (`$8180`, `$81A4`),
* **kolizní mapa** (stínové atributy `$F900`, 672 B) pokaždé, když se změní.

Z toho pak `tools/matchphysics.js` pustí `app/charliePhysics.js` krok po kroku
a trvá na tom, že vyjde tentýž záznam.

`--suite` nahraje rovnou celou sadu devíti běhů, na které se M3 ověřuje (chůze oběma
směry, skok, skok s rozběhem, pády, přechody ve všech čtyřech směrech, povrch
i jeskyně). Nahrávky jdou do `build/`, tedy **mimo git** – dělají se znovu jedním
příkazem, stejně jako referenční buffery místností z M2.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

PASS_ENTRY = 0x8F44         # $7DD3 CALL $8F44 – začátek průchodu s Charliem
STEP_TEST  = (0x8EB2, 0x80E5)   # kde se testuje bit 7 počítadla $(+0B)
VARS = {'flags': 0x5B0A, 'input': 0x5B0B, 'lastDir': 0x5BAE, 'room': 0x5B04,
        'a2b7': 0xA2B7, 'f7ed9': 0x7ED9, 'f7ee0': 0x7EE0,
        'fallCounter': 0x8180, 'fallStepLo': 0x81A4, 'fallStepHi': 0x81A5,
        'fallFrame': 0x81D5}
OUT = os.path.join(HERE, '..', 'build', 'physruns')


def record_run(keys, start, end, snapshot=physlib.SNAPSHOT):
    session = physlib.Session(snapshot).boot(start, keys)
    machine = session.to_python()
    memory = machine.memory
    registers = machine.simulator.registers
    samples, maps, last_map = [], [], None
    state = {'frame': 0}

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
            nonlocal_map = attrs
            if not maps or maps[-1] != nonlocal_map:
                maps.append(nonlocal_map)
            sample = {'frame': state['frame'], 'map': len(maps) - 1,
                      'delayAtStep': None,
                      'record': list(memory[physlib.CHARLIE:physlib.CHARLIE + 32])}
            for name, addr in VARS.items():
                sample[name] = memory[addr]
            samples.append(sample)

    def on_frame(frame):
        state['frame'] = frame

    machine.run(end, keys, on_frame=on_frame, exec_map=Probe())
    return {'keys': [list(k) for k in keys], 'start': start, 'end': end,
            'passes': samples,
            'maps': [base64.b64encode(m).decode('ascii') for m in maps]}


# Sada běhů, na které se ověřuje M3 (`tools/matchphysics.js`). Je tady schválně
# vypsaná, aby se dala zopakovat jedním příkazem: chůze oběma směry, skok na místě,
# skok s rozběhem, pády, přechody mezi místnostmi ve všech čtyřech směrech,
# povrch i jeskyně.
SUITE = [
    ('walk',      ['1450:1560:B'],                1440, 1570),
    ('walkleft',  ['1450:1600:X'],                1440, 1610),
    ('jump',      ['1450:1600:Q'],                1440, 1610),
    ('runjump',   ['1450:1900:B', '1470:1900:Q'], 1440, 1910),
    ('long',      ['1450:2600:B'],                1440, 2610),
    ('cave',      ['1450:2600:B'],                1750, 2600),
    ('leftjump',  ['1450:2000:X', '1600:2000:Q'], 1440, 2000),
    ('down',      ['1450:1900:B', '1500:1900:A'], 1440, 1900),
    ('cavejump',  ['1450:3000:B', '1500:3000:Q'], 1900, 3000),
]


def record_suite():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, keys, start, end in SUITE:
        run = record_run(list(physlib.MENU) + physlib.parse_keys(keys), start, end)
        path = os.path.join(OUT, name + '.json')
        with open(path, 'w') as f:
            json.dump(run, f, separators=(',', ':'))
            f.write('\n')
        rooms = sorted({p['room'] for p in run['passes']})
        total += len(run['passes'])
        print('%-10s %4d pruchodu, mistnosti %s -> %s'
              % (name, len(run['passes']), rooms, os.path.relpath(path)))
    print('celkem %d pruchodu v %d bezich' % (total, len(SUITE)))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--suite', action='store_true',
                    help='nahraje celou sadu běhů, na které se ověřuje M3')
    ap.add_argument('--keys', action='append', default=[], metavar='OD:DO:KLAVESA',
                    help='stisk klávesy mezi snímky (lze víckrát)')
    ap.add_argument('--start', type=int, default=physlib.GAME_FRAME,
                    help='od kterého snímku se vzorkuje (předtím se jen rozehrává)')
    ap.add_argument('--end', type=int, default=physlib.GAME_FRAME + 200)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    if args.suite:
        record_suite()
        return

    keys = list(physlib.MENU) + physlib.parse_keys(args.keys)
    run = record_run(keys, args.start, args.end)
    os.makedirs(OUT, exist_ok=True)
    path = args.out or os.path.join(OUT, 'run.json')
    with open(path, 'w') as f:
        json.dump(run, f, separators=(',', ':'))
        f.write('\n')
    print('%d pruchodu, %d koliznich map, snimky %d-%d -> %s'
          % (len(run['passes']), len(run['maps']), args.start, args.end, path))
    if run['passes']:
        first, last = run['passes'][0], run['passes'][-1]
        print('  x %02X -> %02X, y %02X -> %02X, mistnost %d -> %d'
              % (first['record'][1], last['record'][1], first['record'][2],
                 last['record'][2], first['room'], last['room']))


if __name__ == '__main__':
    main()
