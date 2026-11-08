#!/usr/bin/env python3
"""Vytáhne z originálu **fyziku Charlieho** do `data/physics.json`.

    PYTHONPATH=tools/vendor ./tools/dumpphysics.py [--show]

Nic se tu nevymýšlí a nic se nezaokrouhluje:

* **konstanty jsou operandy skutečných instrukcí.** U každé se kontroluje, že na
  té adrese opravdu stojí ta instrukce (bajty opkódu); když ne, nástroj skončí
  chybou, místo aby vydal číslo.
* **skripty jsou bajty originálu.** Charlie se nehýbe podle vzorce, ale podle
  bajtkódového skriptu, který interpretuje rutina `$8EB2` (viz
  `sources/docs/disasm_notes.md` §10). Do dat se ukládá **celý blok skriptů tak,
  jak leží v paměti**, a remake ho interpretuje toutéž rutinou.
* **výchozí záznam Charlieho** se čte z rozehrané hry, ne ze statického obrazu.

Kontrola úplnosti: každý bajt bloku skriptů musí být dosažitelný z některého
vstupního bodu (a musí se dát rozebrat). Co dosažitelné není, nástroj **vypíše**.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
OUT   = os.path.join(HERE, '..', 'data', 'physics.json')

# ---------------------------------------------------------------- konstanty
# (adresa, očekávané bajty instrukce s '..' místo operandu, délka operandu, jméno)
# Rozebráno v sources/docs/disasm_notes.md §10; adresy jsou v coverage_playtrace.txt.
CONSTANTS = [
    # --- skripty, které si volí ovládání astronauta ($9F37)
    ('walkRight',      0x9F7B, '11 .. ..', 'ovladani: chuze vpravo (LD DE,nn)'),
    ('walkLeft',       0x9F81, '11 .. ..', 'ovladani: chuze vlevo'),
    ('jumpRightWalk',  0x9F63, '11 .. ..', 'ovladani: skok s rozbehem vpravo (vstup $11)'),
    ('jumpLeftWalk',   0x9F69, '11 .. ..', 'ovladani: skok s rozbehem vlevo (vstup $12)'),
    ('jumpRight',      0x9FA6, '21 .. ..', 'skok na miste, ciciho vpravo (LD HL,nn)'),
    ('jumpLeft',       0x9FAF, '21 .. ..', 'skok na miste, ciciho vlevo'),
    ('landRight',      0x9F09, '21 .. ..', 'dopad/zastaveni vpravo'),
    ('landLeft',       0x9F0F, '21 .. ..', 'dopad/zastaveni vlevo'),
    # --- skripty padu ($81E0), vybira je bit 7 cisla ramce = smer pohledu
    ('fallRightA',     0x81E0, '21 .. ..', 'pad, pohled vpravo (LD HL,nn)'),
    ('fallRightB',     0x81E3, '11 .. ..', 'pad, pohled vpravo, druhy (LD DE,nn)'),
    ('fallLeftA',      0x81EE, '21 .. ..', 'pad, pohled vlevo'),
    ('fallLeftB',      0x81F1, '11 .. ..', 'pad, pohled vlevo, druhy'),
    # --- pad ($810A)
    ('fallProbe',      0x8149, '11 .. ..', 'zkouska pod nohama: DE = (D smery, E vzdalenost)'),
    ('fallStepSlow',   0x8164, '21 .. ..', 'krok padu v mistnostech $16 a $26'),
    ('fallStepFast',   0x816D, '21 .. ..', 'krok padu jinde'),
    ('slowRoomA',      0x8162, 'FE ..',    'mistnost s pomalejsim padem (CP n)'),
    ('slowRoomB',      0x8169, 'FE ..',    'druha takova mistnost'),
    ('fallCounter',    0x8179, '3E ..',    'pocitadlo padu: kolik kroku jeste neni smrtelnych'),
    ('rollFirstFrame', 0x819A, 'C6 ..',    'prvni ramec kotoulu (ADD A,n)'),
    ('rollBase',       0x8196, 'D6 ..',    'zaklad cyklu ramcu kotoulu (SUB n)'),
    ('deathFrame',     0x81D4, '3E ..',    'ramec, kterym konci smrtelny pad (LD A,n)'),
    # --- okraje hraci plochy ($8F44)
    ('edgeRight',      0x8F4D, 'FE ..',    'x, za kterym se meni mistnost (CP n)'),
    ('edgeWrapLeft',   0x8F51, 'DD 36 01 ..', 'x po prechodu doleva'),
    ('edgeWrapRight',  0x8F64, 'DD 36 01 ..', 'x po prechodu doprava'),
    ('floorCave',      0x8F76, '06 ..',    'y, pod kterym se propada, v jeskyni (LD B,n)'),
    ('floorSurface',   0x8F7C, '06 ..',    'totez na povrchu'),
    # --- pohyb a kolize ($9143, $9072, $90EA, $9397)
    ('moveRejectX',    0x907F, 'FE ..',    'pohyb vpravo se zahodi, kdyz stare x >= n'),
    ('moveRejectY',    0x9116, 'FE ..',    'pohyb dolu se zahodi, kdyz stare y >= n'),
    ('yRangeAdd',      0x9197, 'C6 ..',    'kontrola rozsahu y po pohybu (ADD A,n)'),
    ('yRangeMax',      0x919B, 'FE ..',    'totez, mez (CP n)'),
    ('splitHalf',      0x90FF, 'FE ..',    'ktera polovina obrazovky pri vytlaceni ze zdi'),
    ('cellRound',      0x9397, '1E ..',    'zaokrouhleni bunky (LD E,n)'),
    ('playHeight',     0x939D, 'FE ..',    'vyska hraci plochy v pixelech (CP n)'),
    ('playBottom',     0x93D9, 'C6 ..',    'doplnek vysky hraci plochy do 256 (ADD A,n)'),
]

# vstupní body skriptů, které se procházejí (klíče z CONSTANTS)
SCRIPT_ENTRIES = ['walkRight', 'walkLeft', 'jumpRightWalk', 'jumpLeftWalk',
                  'jumpRight', 'jumpLeft', 'landRight', 'landLeft',
                  'fallRightA', 'fallRightB', 'fallLeftA', 'fallLeftB']

# jak se jmenují opkódy skriptu (rutina $8EB2)
OPCODES = {0: 'none', 1: 'move', 2: 'move2', 5: 'call', 6: 'return'}


def read_image():
    with open(IMAGE, 'rb') as f:
        data = f.read()
    if len(data) != 0xC000:
        raise SystemExit('%s neni obraz RAM $4000-$FFFF' % IMAGE)
    return data


def operand(image, addr, pattern, name):
    """Přečte operand instrukce a ověří, že na té adrese ta instrukce opravdu je."""
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


def walk_script(image, start, steps, visited):
    """Rozebere jeden skript od `start`; vrací seznam kroků a dotčené bajty."""
    addr, out = start, []
    while True:
        if addr in visited:
            out.append({'at': addr, 'goto': addr})
            break
        step = {'at': addr, 'frame': image[addr - 0x4000], 'commands': []}
        visited.add(addr)
        addr += 1
        while True:
            visited.add(addr)
            command = image[addr - 0x4000]
            addr += 1
            op = (command >> 4) & 7
            item = {'op': OPCODES.get(op, 'op%d' % op), 'arg': command & 0x0F}
            if op == 2:
                visited.add(addr)
                item['distances'] = image[addr - 0x4000]
                addr += 1
            elif op == 5:
                visited.add(addr)
                visited.add(addr + 1)
                item['target'] = image[addr - 0x4000] + 256 * image[addr - 0x4000 + 1]
                addr += 2
            step['commands'].append(item)
            if command & 0x80:
                break
        steps.append(step)
        last = step['commands'][-1]
        if last['op'] == 'call':
            addr = last['target']
        if last['op'] == 'return':
            break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--show', action='store_true', help='vypsat skripty čitelně')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    image = read_image()
    constants, notes = {}, {}
    for name, addr, pattern, note in CONSTANTS:
        value, width = operand(image, addr, pattern, name)
        constants[name] = value
        notes[name] = {'at': '$%04X' % addr, 'instruction': pattern, 'what': note,
                       'value': ('$%04X' if width == 2 else '$%02X') % value}

    # --- skripty: projít od všech vstupních bodů a zkontrolovat pokrytí
    scripts, visited = {}, set()
    for key in SCRIPT_ENTRIES:
        start = constants[key]
        steps = []
        walk_script(image, start, steps, visited)
        scripts[key] = {'entry': start, 'steps': steps}
    lo, hi = min(visited), max(visited)
    gaps = [a for a in range(lo, hi + 1) if a not in visited]

    # --- výchozí záznam Charlieho z rozehrané hry (ne ze statického obrazu)
    session = physlib.Session().boot()
    record = list(session.memory[physlib.CHARLIE:physlib.CHARLIE + 32])
    room = session.memory[physlib.ROOM]

    data = {
        'note': ('Fyzika Charlieho vytazena z originalu: konstanty jsou operandy '
                 'skutecnych instrukci, skripty jsou bajty originalu. '
                 'Viz sources/docs/disasm_notes.md par. 10.'),
        'constants': constants,
        'constantNotes': notes,
        'scriptBlock': {'base': lo, 'end': hi, 'bytes': list(image[lo - 0x4000:hi + 1 - 0x4000])},
        'scripts': scripts,
        'charlie': {
            'record': record,
            'room': room,
            'speed': record[0x06],
            'period': record[0x0C],
            'frame': record[0x1E],
            'fields': {'flags': 0, 'x': 1, 'y': 2, 'width': 3, 'height': 4,
                       'attribute': 5, 'speed': 6, 'bitmap': 7, 'script': 9,
                       'delay': 0x0B, 'period': 0x0C, 'return': 0x0D,
                       'frame': 0x1E, 'returnHigh': 0x1F}
        }
    }
    with open(args.out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
        f.write('\n')

    print('konstanty: %d (vsechny jako operandy overenych instrukci)' % len(constants))
    print('blok skriptu: $%04X-$%04X, %d B, %d nedosazitelnych bajtu'
          % (lo, hi, hi - lo + 1, len(gaps)))
    if gaps:
        print('  nedosazitelne: ' + ' '.join('$%04X' % a for a in gaps))
    frames = sorted({s['frame'] for sc in scripts.values() for s in sc['steps'] if 'frame' in s})
    print('ramce spritu, ktere Charlie pouziva: %d (%s)'
          % (len(frames), ' '.join('%02X' % f for f in frames)))
    print('vychozi zaznam Charlieho (mistnost %d): %s'
          % (room, ' '.join('%02X' % b for b in record)))
    print('rychlost chuze (+$06) = %d px, perioda skriptu (+$0C) = %d -> krok kazdy %d. snimek'
          % (record[0x06], record[0x0C], record[0x0C] + 1))
    print('ulozeno %s' % args.out)

    if args.show:
        for key in SCRIPT_ENTRIES:
            print('\n%s  $%04X' % (key, scripts[key]['entry']))
            for step in scripts[key]['steps']:
                if 'goto' in step:
                    print('  $%04X  -> smycka' % step['at'])
                    continue
                parts = []
                for c in step['commands']:
                    if c['op'] == 'move':
                        parts.append('move %s' % directions(c['arg']))
                    elif c['op'] == 'move2':
                        parts.append('move2 %s+%s dist %02X'
                                     % (directions(c['arg'] & 0x0C), directions(c['arg'] & 3),
                                        c['distances']))
                    elif c['op'] == 'call':
                        parts.append('call $%04X' % c['target'])
                    else:
                        parts.append(c['op'])
                print('  $%04X  ramec %02X  %s' % (step['at'], step['frame'], ', '.join(parts)))


def directions(mask):
    names = [n for bit, n in ((1, 'vpravo'), (2, 'vlevo'), (4, 'dolu'), (8, 'nahoru'))
             if mask & bit]
    return '+'.join(names) if names else '-'


if __name__ == '__main__':
    main()
