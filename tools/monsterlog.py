#!/usr/bin/env python3
"""Nahraje **běh originálu s nepřáteli** – tabulku entit, objekty a globály M5.

    PYTHONPATH=tools/vendor ./tools/monsterlog.py --suite

Tentýž způsob jako `physlog.py` (M3) a `molelog.py` (M4), jen se vzorkuje jinde:
na **`$A48F`**, tedy na začátku rutiny `$A479`, kterou hlavní smyčka volá jednou
za průchod a která udělá **nejdřív poletující objekty a pak nepřátele**.
Zapisuje se všechno, na co M5 sahá:

* **počítadlo `+$0B`** z okamžiku, kdy ho originál sám testuje (`$A66D`) –
  vede ho přerušení, ne dispečer, přesně jako v M3 a M4,
* **kolizní mapa** (stínové atributy `$F900`, 672 B) – bez ní se nepřátelé
  nemají o co zarazit,
* celá **tabulka entit `$FC00–$FDFF`** (16 záznamů po `$20` B) – v ní jsou
  objekty (`$FC00`+), tři nepřátelé (`$FD00`, `$FD20`, `$FD40`), alchiem nebo
  mugger (`$FD80`), gravity stick (`$FDA0`), krtek (`$FDC0`) a Charlie (`$FDE0`),
* celá **tabulka poletujících objektů `$AAED–$ADDC`** (94 × 8 B) a jejich
  počítadla `$E180`,
* globály `$AAE2`–`$AAE6` (mugger kradl, kolik nepřátel zbývá, zvláštní účinek,
  y prvního typu 3), `$7DDE` (gravity stick), `$7EE0`, `$5B00`–`$5B02`,
  `$5B33` (kolik hledaných alchiemů), `$5B09`, `$5B12`, `$ADCF`/`$ADD7`
  (místnost ukazatele a monolitu),
* **paměť posledních pěti místností** `$5B34` (50 B) – tam se nepřátelé ukládají
  při odchodu z místnosti (`$A2F4`),
* **perzistentní stav světa** `$B600` (256 B) pokaždé, když se změní – tam
  bydlí alchiemy (bit 6 + číslo v bitech 4–5) a muggeři (bit 3).

★ Losování se **nahrává, ne reprodukuje**. Originál si typ i pozici nepřítele
bere z registru `R` (`$A436`, `$A5E0`) a rozmístění alchiemů taky (`$86EA`).
Nahrávka proto u každého průchodu nese i to, **co originálu vyšlo**, a
`matchmonsters.js` to remaku podstrčí – jinak by se porovnávaly dvě různé hry.
Co se podstrčilo, matcher **vypisuje**.

Nahrávky jdou do `build/monruns/`, tedy **mimo git**.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

OBJ_STEP_TEST = 0xA4A2      # $A4A2 BIT 7,(HL) – totéž pro počítadlo objektu
STEP_TEST     = 0xA66D      # $A66D BIT 7,(IX+$0B) – tady si originál sám čte
                            # počítadlo, které mu vede přerušení ($9CC7)
# ★ Vzorkuje se na **`$A48F`**, tedy na začátku celé rutiny `$A479`, kterou
# hlavní smyčka volá jednou za průchod. Dispečer typů (`$A5C6`) by nestačil:
# na povrchu se do něj vůbec nevstoupí (`$A5B6 CP $10 / JP C,$A838`), takže by
# se nenahrál žádný průchod nad zemí – a poletující objekty jsou hlavně tam.
PASS_ENTRY    = 0xA48F      # $A48F PUSH IY – začátek $A479: objekty, pak nepřátelé
# ★ Kde originál sahá na registr `R`. Reprodukovat to nejde, takže se **nahrává
# hodnota, která z toho vyšla** – ne adresa, ale to, co se z ní opravdu použilo.
# `exec_map` se v SkoolKitu volá **po** provedení instrukce, takže klíčem je
# rovnou adresa toho `LD A,R` – kromě dvou míst, kde se hodnota ještě upraví,
# než se použije: `$A45C` (`LD L,A / LD H,A / LD A,(HL)`, tedy bajt paměti, na
# který R ukazuje) a `$A5E0` (`XOR` se sebemodifikovaným seedem na `$A5DE`).
RANDOM_SITES = {
    0xA3BB: 'typ 1: kterym smerem se rodi',
    0xA436: 'losovani: pocitadlo skriptu',
    0xA43B: 'losovani: y',
    0xA444: 'losovani: x',
    0xA460: 'losovani: typ z bajtu pameti, na ktery ukazuje R ($A45C LD L,A/LD H,A)',
    0xA46B: 'losovani: rozhodnuti mezi typy',
    0xA5E2: 'sance na objeveni: R XOR sebemodifikovany seed ($A5DE)',
    0xA6FB: 'typ 1: barva okraje',
    0xA701: 'typ 1: ma se otocit?',
    0xA707: 'typ 1: kterym smerem',
    0xA71C: 'typ 2: ma se otocit za Charliem?',
    0xA860: 'konec hry: vyska tonu',
}

ENTITIES  = 0xFC00          # 16 záznamů po $20
OBJECTS   = 0xAAED          # 94 záznamů po 8
OBJ_COUNT = 0x5E
TICKS     = 0xE180          # počítadlo skriptu objektu, bajt na objekt
CACHE     = 0x5B34          # paměť posledních pěti místností, 5 x 10 B
STATE     = 0xB600

VARS = {'room': 0x5B04, 'flags': 0x5B0A, 'input': 0x5B0B, 'lives': 0x5B09,
        'wanted': 0x5B00, 'alchiemMask': 0x5B01, 'alchiemListLo': 0x5B02,
        'alchiemListHi': 0x5B03, 'wantedCount': 0x5B33, 'objectIndex': 0x5B12,
        'mugged': 0xAAE2, 'energy': 0xAAE3, 'live': 0xAAE4, 'special': 0xAAE5,
        'type3Seen': 0xAAE6, 'stickLo': 0x7DDE, 'stickHi': 0x7DDF,
        'sticks': 0x7EE0, 'f7ed9': 0x7ED9, 'a2b7': 0xA2B7,
        'wantedRoom': 0xADCF, 'monolithRoom': 0xADD7,
        'monolithX': 0xADD9, 'monolithY': 0xADDA,
        'wantedFrame': 0xADE2, 'monolithFrame': 0xADE6}

OUT = os.path.join(HERE, '..', 'build', 'monruns')


def record_run(keys, start, end, snapshot=physlib.SNAPSHOT):
    session = physlib.Session(snapshot).boot(start, keys)
    machine = session.to_python()
    memory = machine.memory
    registers = machine.simulator.registers
    samples = []
    pools = {'states': [], 'objects': [], 'caches': [], 'maps': []}
    state = {'frame': 0, 'random': [], 'delays': [], 'ticks': []}

    def intern(pool, value):
        if not pools[pool] or pools[pool][-1] != value:
            pools[pool].append(value)
        return len(pools[pool]) - 1

    class Probe:
        def add(self, pc):
            if pc == OBJ_STEP_TEST:
                # Počítadlo objektu ($E180) snižuje totéž přerušení jako `+$0B`
                # entity, takže se nahrává tam, kde ho originál sám testuje.
                hl = registers[7] + 256*registers[6]
                state['ticks'].append([hl - TICKS, memory[hl]])
                return
            if pc == STEP_TEST:
                # ★ Jako v M3 a M4: `+$0B` vede **přerušení**, ne dispečer, a
                # průchod se se snímkem nekryje jedna ku jedné. Nahrává se
                # proto hodnota z okamžiku, kdy ji originál sám testuje.
                ix = registers[9] + 256*registers[8]
                state['delays'].append([ix - ENTITIES, memory[ix + 0x0B]])
                return
            if pc in RANDOM_SITES:
                # Tohle je `LD A,R` a zpátky se to nedopočítá, takže se nahrává
                # **hodnota, která z něj vyšla**, a matcher ji remaku podstrčí
                # ve stejném pořadí. Když se pořadí nebo počet rozejde, je to
                # v porovnání vidět – neschová se to.
                state['random'].append(registers[0])
                return
            if pc != PASS_ENTRY:
                return
            sample = {
                'frame': state['frame'],
                'entities': list(memory[ENTITIES:ENTITIES + 0x200]),
                'objects': intern(
                    'objects',
                    bytes(bytearray(memory[OBJECTS:OBJECTS + OBJ_COUNT*8]))
                    + bytes(bytearray(memory[TICKS:TICKS + OBJ_COUNT]))),
                'state': intern('states', bytes(bytearray(memory[STATE:STATE + 256]))),
                'map': intern('maps', bytes(bytearray(
                    memory[physlib.BUF_ATTRS:physlib.BUF_ATTRS + 672]))),
                'cache': intern('caches', bytes(bytearray(memory[CACHE:CACHE + 50]))),
                'random': state['random'],
                'delays': state['delays'],
                'ticks': state['ticks'],
            }
            state['random'] = []
            state['delays'] = []
            state['ticks'] = []
            for name, addr in VARS.items():
                sample[name] = memory[addr]
            samples.append(sample)

    def on_frame(frame):
        state['frame'] = frame

    machine.run(end, keys, on_frame=on_frame, exec_map=Probe())
    return {'keys': [list(k) for k in keys], 'start': start, 'end': end,
            'passes': samples,
            'states': [base64.b64encode(m).decode('ascii') for m in pools['states']],
            'objects': [base64.b64encode(m).decode('ascii') for m in pools['objects']],
            'caches': [base64.b64encode(m).decode('ascii') for m in pools['caches']],
            'maps': [base64.b64encode(m).decode('ascii') for m in pools['maps']]}


# Cesty, na kterých se nepřátelé opravdu potkají. Nepřátelé jsou **jen pod
# povrchem** ($A5B6 CP $10), takže každý běh musí Charlieho nejdřív dostat
# dolů; na povrchu je tabulka entit prázdná a dispečer se hned vrátí.
TO_CAVE       = ['1450:1500:B', '1505:1910:Q', '1915:2280:X']
TO_CAVE_RIGHT = ['1450:1500:B', '1505:1910:Q', '1915:2250:B']

SUITE = [
    # --- pod povrchem: **nepřátelé**. Losují se, chodí za Charliem, berou
    #     energii a mizí; místnost $14 je uzavřená kapsa, takže se v ní dá
    #     dlouho stát a nechat dispečer pracovat.
    ('cave',      TO_CAVE,                                    2280, 3600),
    ('cave2',     TO_CAVE_RIGHT,                              2250, 3600),
    ('touch',     TO_CAVE + ['2300:2700:B', '2750:3200:X',
                             '3250:3600:B'],                  2280, 3600),
    ('idle',      TO_CAVE,                                    2280, 4600),
    # --- na povrchu: **poletující objekty**. Nepřátelé tu nejsou ($A5B6 CP
    #     $10), zato objekty se hýbou po celém světě a Charlie do nich chodí –
    #     každý takový dotek je dvě jednotky energie a whirlwind ($7FE8).
    ('surface',   ['1450:1900:B', '1910:2400:X',
                   '2410:2900:B', '2910:3600:X'],             1400, 3600),
    ('surfacer',  ['1450:3600:B'],                            1400, 3600),
]



def record_suite(names=None):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, keys, start, end in SUITE:
        run = record_run(list(physlib.MENU) + physlib.parse_keys(keys), start, end) \
            if (not names or name in names) else None
        if run is None:
            continue
        path = os.path.join(OUT, name + '.json')
        with open(path, 'w') as f:
            json.dump(run, f, separators=(',', ':'))
            f.write('\n')
        rooms = sorted({p['room'] for p in run['passes']})
        alive = sum(1 for p in run['passes']
                    for s in (0x100, 0x120, 0x140) if p['entities'][s] & 1)
        spawns = sum(len(p['random']) for p in run['passes'])
        total += len(run['passes'])
        print('%-9s %4d pruchodu, mistnosti %s, nepratel videt %dx, '
              'hodnot z R %d, stavu sveta %d -> %s'
              % (name, len(run['passes']), ['$%02X' % r for r in rooms],
                 alive, spawns, len(run['states']), os.path.relpath(path)))
    print('celkem %d pruchodu' % total)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--suite', action='store_true', help='nahraje celou sadu běhů M5')
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
    print('%d pruchodu, %d stavu sveta, %d snimku objektu -> %s'
          % (len(run['passes']), len(run['states']), len(run['objects']), path))


if __name__ == '__main__':
    main()
