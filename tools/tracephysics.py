#!/usr/bin/env python3
"""Změří **kadenci hlavní smyčky** originálu – jako histogram, ne jako průměr.

    PYTHONPATH=tools/vendor ./tools/tracephysics.py [--frames 600]

Poučení z underwurlde M8 je, že se nesmí pevně předpokládat „jeden průchod =
jeden snímek": délka průchodu se mění podle toho, co se zrovna kreslí, a průměr
to schová. Proto se tady měří **rozdělení**, a to ve víc scénách.

Co se počítá:

* **průchod** = jedno provedení `$8F44` se záznamem Charlieho, tj. začátek toho,
  co hlavní smyčka dělá s hráčem (`$7DD3`, `sources/docs/disasm_notes.md` §10);
* **snímek** = přerušení ULA, tj. 1/50,08 s. Přerušení taky snižuje počítadlo
  skriptu `(+$0B)`, takže na téhle kadenci stojí rychlost chůze i pádu;
* **krok skriptu** = provedení `$8EB2` se záznamem Charlieho.

Vypíše se histogram délky průchodu ve snímcích a kolik snímků připadá na jeden
krok skriptu – to je „herní tik" z `MILNIKY.md` M3.
"""
import argparse, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

PASS_ENTRY = 0x8F44
SCRIPT_STEP = 0x8EBA   # až za testem bitu 7 – tady se krok opravdu dělá

SCENES = [
    ('povrch, Charlie stojí',        []),
    ('povrch, chůze doprava',        [(1450, 9000, 'B')]),
    ('povrch, skok',                 [(1450, 9000, 'Q')]),
    ('jeskyně po pádu (chůze)',      [(1450, 9000, 'B')]),
]
SCENE_START = [1440, 1440, 1440, 1750]


def measure(keys, start, frames):
    session = physlib.Session().boot(start, list(physlib.MENU) + keys)
    machine = session.to_python()
    registers = machine.simulator.registers
    state = {'frame': start, 'lastPass': None}
    lengths, steps = Counter(), []

    class Probe:
        def add(self, pc):
            if registers[9] + 256*registers[8] != physlib.CHARLIE:
                return
            if pc == PASS_ENTRY:
                if state['lastPass'] is not None:
                    lengths[state['frame'] - state['lastPass']] += 1
                state['lastPass'] = state['frame']
            elif pc == SCRIPT_STEP:
                steps.append(state['frame'])

    def on_frame(frame):
        state['frame'] = frame

    machine.run(start + frames, list(physlib.MENU) + keys,
                on_frame=on_frame, exec_map=Probe())
    return lengths, steps, frames


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--frames', type=int, default=400, help='délka měření ve snímcích')
    args = ap.parse_args()

    total = Counter()
    for (name, keys), start in zip(SCENES, SCENE_START):
        lengths, steps, frames = measure(keys, start, args.frames)
        total.update(lengths)
        passes = sum(lengths.values())
        gaps = Counter(b - a for a, b in zip(steps, steps[1:])) if len(steps) > 1 else Counter()
        print('\n%s (snímky %d-%d)' % (name, start, start + frames))
        print('  průchodů: %d, snímků: %d  ->  %.3f snímku na průchod'
              % (passes, frames, frames/passes if passes else 0))
        print('  délka průchodu ve snímcích: %s'
              % ', '.join('%d x %d' % (n, length) for length, n in sorted(lengths.items())))
        if gaps:
            print('  kroků skriptu Charlieho: %d, odstup ve snímcích: %s'
                  % (len(steps), ', '.join('%d x %d' % (n, g) for g, n in sorted(gaps.items()))))

    print('\ncelkem, histogram délky průchodu ve snímcích:')
    passes = sum(total.values())
    for length, n in sorted(total.items()):
        print('  %2d snímku: %5d x  (%5.1f %%)' % (length, n, 100.0*n/passes))
    print('\nJeden průchod je %s.'
          % ('konstantně 1 snímek' if list(total) == [1]
             else 'proměnný – délka NENÍ konstantní, viz histogram'))


if __name__ == '__main__':
    main()
