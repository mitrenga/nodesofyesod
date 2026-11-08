#!/usr/bin/env python3
"""Vytáhne z originálu **krtka a stav světa** do `data/mole.json`.

    PYTHONPATH=tools/vendor ./tools/dumpmole.py [--show]

Stejná disciplína jako `dumpphysics.py` (M3), protože krtek je **tatáž entita
s týmiž rutinami**, jen jiným záznamem (`$FDC0` místo `$FDE0`, v originálu to
je doslova jiné `IX`):

* **konstanty jsou operandy skutečných instrukcí.** U každé se kontroluje, že
  na té adrese ta instrukce opravdu stojí; když ne, nástroj skončí chybou.
* **skripty a seznamy rámců jsou bajty originálu.** Krtek má obojí – jezdí se
  na něm podle **seznamu rámců** (`$A2B8`, bajt na průchod), ale vylézá z díry
  a prokousává stěnu podle **bajtkódového skriptu** téhož interpretu `$8EB2`.
* **tabulka děr na povrchu** (`$A299`, 6 × 5 B) je bajty originálu.
* **výchozí záznam krtka** se čte z **rozehrané hry, do které se nesahá**:
  krtek na povrchu vylézá sám (`$A21A`, místnost `$06` je v tabulce děr).

Kontrola úplnosti: každý bajt obou bloků (`$A2B8–$A2E4` a `$5B6A–$5B8D`) musí
být dosažitelný z některého vstupního bodu. Co dosažitelné není, nástroj
**vypíše** – v tomhle případě dva bajty, a je to vysvětlené (viz `--show`).

Rozbor je v `sources/docs/disasm_notes.md` §11.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import physlib                                                  # noqa: E402

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
OUT   = os.path.join(HERE, '..', 'data', 'mole.json')

MOLE = 0xFDC0

# ---------------------------------------------------------------- konstanty
# (jméno, adresa, bajty instrukce s '..' místo operandu, k čemu je)
CONSTANTS = [
    # --- záznam krtka a jeho místo v tabulce entit
    ('moleRecord',      0xA0F8, 'DD 21 .. ..', 'zaznam krtka (LD IX,nn); Charlie je nasledujici'),
    ('entityStride',    0xA024, '11 .. ..',    'krok tabulky entit ($9FED)'),
    ('monsterFirst',    0x9FFF, 'DD 21 .. ..', 'prvni zaznam, ktery krtek zere ($9FED)'),
    ('monsterCount',    0xA003, '3A .. ..',    'kolik zaznamu se prochazi (LD A,(nn)) - M5'),
    ('monsterSkipA',    0xA018, 'FE ..',       'ramec, ktery se preskoci ($9FED)'),
    ('monsterSkipB',    0xA01C, 'FE ..',       'druhy takovy ramec'),
    ('monsterHitVar',   0xA041, '3A .. ..',    'co se pri zabiti snizi (LD A,(nn)) - M5'),
    # --- ulovení krtka: Charlie stojí nad ním ($9DD6)
    ('mountDyMin',      0x9DFB, 'FE ..',       'nejmensi rozdil y pod povrchem (CP n)'),
    ('mountDyMax',      0x9DFF, 'FE ..',       'nejvetsi rozdil y'),
    ('mountDxRight',    0x9E09, '0E ..',       'nejvetsi rozdil x, Charlie vpravo (LD C,n)'),
    ('mountDxLeft',     0x9E0F, '0E ..',       'totez, Charlie vlevo'),
    # --- vypuštění krtka ($A098), tj. přepnutí astronaut -> krtek
    ('spawnMaxX',       0xA0BD, 'C6 ..',       'x + n nesmi pretect (ADD A,n)'),
    ('spawnMaxY',       0xA0C9, 'FE ..',       'y musi byt mensi (CP n)'),
    ('dirInit',         0xA0D5, '3E ..',       'pocatecni hodnota $5B69 = "jeste nic" (LD A,n)'),
    ('moleFlags',       0xA0FC, 'DD 36 00 ..', 'priznaky krtka: bit 4 (kolize) NEMA'),
    ('moleScriptLo',    0xA10C, 'DD 36 09 ..', 'seznam ramcu, kdyz se na krtkovi jezdi (dolni bajt)'),
    ('moleScriptHi',    0xA110, 'DD 36 0A ..', 'totez, horni bajt'),
    ('moleFrame',       0xA114, 'DD 36 1E ..', 'prvni ramec krtka'),
    ('moleDelay',       0xA118, 'DD 36 0B ..', 'pocitadlo skriptu'),
    ('molePeriod',      0xA11C, 'DD 36 0C ..', 'perioda: $80 = krok kazdy pruchod'),
    ('moleStep',        0xA120, 'DD 36 06 ..', 'delka kroku skriptu v px'),
    ('moleMove',        0xA1AB, '1E ..',       'o kolik px se krtek posune za pruchod (LD E,n)'),
    ('panelTheme',      0xA0DD, '3E ..',       'sada dlazdic panelu ($89D9)'),
    ('panelIconMole',   0xA0E2, '3E ..',       'index bloku display listu: krtek'),
    ('panelIconAt',     0xA0E4, '11 .. ..',    'kam se blok polozi: D sloupec, E znakovy radek'),
    ('panelAttrMole',   0xA0EA, '3E ..',       'atribut bunek ikony, kdyz jde krtek'),
    ('panelIconMan',    0x8278, 'AF',          'index bloku display listu: clovek (XOR A = 0)'),
    ('panelAttrManHi',  0x827F, '3E ..',       'atribut prostredni bunky, kdyz jde clovek ($8273)'),
    ('panelAttrManLo',  0x8284, '3D',          'DEC A: ostatni dve bunky maji o jednu mensi'),
    ('panelAttrCellA',  0x8281, '32 .. ..',    'prostredni bunka atributu ikony (LD (nn),A)'),
    ('panelAttrCellB',  0x8285, '32 .. ..',    'druha bunka'),
    ('panelAttrCellC',  0x8288, '32 .. ..',    'treti bunka'),
    # --- sesednutí ($A124 -> $A05A) a jeho animace
    ('dismountScript',  0xA05A, '11 .. ..',    'seznam ramcu sesedani (LD DE,nn)'),
    # --- prokousávání stěny ($A1B3, $A1DD)
    ('digYMin',         0xA1C4, 'FE ..', 'y krtka, od ktereho se kouse (CP n)'),
    ('digYMax',         0xA1C7, 'FE ..',       'y krtka, do ktereho se kouse'),
    ('digXLeftMax',     0xA1CD, 'FE ..',       'x, pod kterym se kouse LEVA stena'),
    ('digXRightMin',    0xA1D4, 'FE ..',       'x + sirka, od ktereho se kouse PRAVA stena'),
    ('digStateMask',    0xA1DD, 'E6 ..',       'maska bitu stavu mistnosti (AND n)'),
    ('digStateReady',   0xA1DF, 'FE ..',       'jeho hodnota, kdy se kousat da (CP n)'),
    ('digXRight',       0xA1EF, 'DD 36 01 ..', 'kam se krtek postavi, kdyz kouse pravou stenu'),
    ('digXLeft',        0xA20B, 'DD 36 01 ..', 'totez pro levou stenu'),
    ('digY',            0xA20F, 'DD 36 02 ..', 'y, na ktere se krtek zarovna'),
    ('digScriptRight',  0xA1EC, '21 .. ..',    'skript kousani vpravo (LD HL,nn)'),
    ('digScriptLeft',   0xA205, '21 .. ..',    'skript kousani vlevo'),
    ('digCounter',      0x9B76, '3E ..',       'kolik pruchodu se stena zere (LD A,n)'),
    ('digCounterVar',   0x9B78, '32 .. ..',    'kde to pocitadlo bydli (LD (nn),A)'),
    # --- díra po prokousané stěně ($9C5D): stínové atributy, ne obrazovka
    ('gapAttrLeft',     0x9C5D, '21 .. ..',    'leva dira ve stinovych atributech (LD HL,nn)'),
    ('gapAttrRight',    0x9C64, '21 .. ..',    'prava dira'),
    ('gapRows',         0x9C68, '06 ..',       'kolik radku se vycisti (LD B,n)'),
    ('gapStride',       0x9C6A, '11 .. ..',    'krok na dalsi radek po dvou bunkach (LD DE,nn)'),
    # --- žraní stěny po kouscích ($9B9D vpravo, $9BE1 vlevo)
    ('eatStreamRight',  0x9B85, '21 .. ..',    'proud kousku, prava stena (LD HL,nn)'),
    ('eatStreamLeft',   0x9B90, '21 .. ..',    'tentyz proud, leva stena'),
    ('eatRowMask',      0x9BA2, 'E6 ..',       'z bajtu proudu: index dvojice pixelovych radku (AND n)'),
    ('eatChunkMask',    0x9BA9, 'E6 ..',       'z bajtu proudu: ktery kousek radku (AND n)'),
    ('eatMaskSeedRight', 0x9BD9, '3E ..',      'maska kousku, vpravo se rotuje vlevo (LD A,n)'),
    ('eatMaskSeedLeft', 0x9C19, '3E ..',       'totez vlevo, rotuje se vpravo'),
    ('eatColumnRight',  0x9BCF, 'C6 ..',       'levy sloupec prave diry (ADD A,n)'),
    ('eatBufferRow',    0x9C29, '16 ..',       'horni bajt adresy radku 13 ve stinovem bufferu (LD D,n)'),
    ('eatBufferStride', 0x9C35, '11 .. ..',    'krok na dalsi pixelovy radek (LD DE,nn)'),
    # --- krtek na povrchu ($A21A)
    ('surfaceMaxRoom',  0xA21D, 'FE ..',       'jen mistnosti pod timhle cislem = povrch (CP n)'),
    ('surfaceHoleCount', 0xA239, '06 ..',      'kolik der ma tabulka (LD B,n)'),
    ('surfaceHoleTable', 0xA23B, '21 .. ..',   'tabulka der (LD HL,nn)'),
    ('surfaceHoleStride', 0xA23E, '11 .. ..',  'delka zaznamu tabulky (LD DE,nn)'),
    ('surfaceFlags',    0xA25C, 'DD 36 00 ..', 'priznaky vylezajiciho krtka'),
    ('surfaceScriptLo', 0xA260, 'DD 36 09 ..', 'skript vylezani (dolni bajt)'),
    ('surfaceScriptHi', 0xA264, 'DD 36 0A ..', 'totez, horni bajt'),
    ('surfaceFrame',    0xA268, 'DD 36 1E ..', 'prvni ramec vylezani'),
    ('surfaceDelay',    0xA26C, 'DD 36 0B ..', 'pocitadlo skriptu'),
    ('surfacePeriod',   0xA270, 'DD 36 0C ..', 'perioda: krok jednou za n+1 snimku'),
    ('surfaceStep',     0xA274, 'DD 36 06 ..', 'delka kroku skriptu v px'),
    ('surfaceEndFrame', 0xA280, 'FE ..',       'ramec, kterym vylezani konci (CP n)'),
    ('clockVar',        0xA22B, '3A .. ..',    'ktera promenna rozhoduje, kdy krtek vyleze'),
    # --- výstup šachtou ($9FC2 a $9E33): "gusty up draught"
    ('updraftRoom',     0x9FC5, 'FE ..',       'mistnost, ve ktere skok znamena vystup (CP n)'),
    ('risePeriod',      0x9FCF, 'DD 36 0C ..', 'perioda ramcu pri vystupu'),
    ('riseFrameFirst',  0x9FD8, 'C6 ..',       'prvni ramec vystupu (ADD A,n)'),
    ('riseFrameWrap',   0x9E43, 'FE ..',       'ramec, na kterem se cyklus vraci (CP n)'),
    ('riseFrameBase',   0x9E4A, 'C6 ..',       'kam se vraci (ADD A,n)'),
    ('riseNoDriftRoom', 0x9E52, 'FE ..',       'v teto mistnosti se pri vystupu neuhyba do stran'),
    ('riseWalkRight',   0x9E8E, '21 .. ..',    'skript, kterym vystup konci (LD HL,nn)'),
    ('riseWalkLeft',    0x9E94, '21 .. ..',    'totez vlevo'),
    ('updraftStep',     0x8FA7, 'C6 ..',       'o kolik px updraft posune y u stropu (ADD A,n)'),
    # --- whirlwind ($8019): odnese Charlieho vzhůru a roztočí ho
    ('whirlFrameLow',   0x801E, 'FE ..',       'nejnizsi ramec toceni (CP n)'),
    ('whirlFrameAdd',   0x8074, 'C6 ..',       'o kolik se ramec posune na druhe kolo (ADD A,n)'),
    ('whirlDriftLeft',  0x8039, '11 .. ..',    'unos doleva: D smery, E vzdalenost (LD DE,nn)'),
    ('whirlDriftRight', 0x8049, '11 .. ..',    'unos doprava'),
    ('whirlLift',       0x805C, '11 .. ..',    'unos vzhuru'),
    ('whirlWalkRight',  0x8081, '21 .. ..',    'skript, kterym toceni konci'),
    ('whirlWalkLeft',   0x8088, '21 .. ..',    'totez vlevo'),
]

# bity globálního příznaku $A2B7, jak je čte a píše kód
A2B7_BITS = {
    '0': 'krtek je uloveny - Charlie ho ma a muze ho vypustit ($9E20 SET, $A0B5 test)',
    '1': 'na povrchu prave vylezl krtek z diry ($A27B SET, $A226 test, $8FC4 RES)',
    '4': 'whirlwind: Charlie je unaseny ($7FF3 SET, $7FAA test, $809F/$8545 RES)',
    '6': 'rizeny sestup - dopad neresetuje pocitadlo padu ($80B6/$9E81 SET, $81C2 RES)',
    '7': 'vystup sachtou ($9FCD SET, $80D7 a $810A test, $9E7F RES)',
}

# bity $5B0A, které patří krtkovi a světu (zbytek je v physics.json / §10)
FLAG_BITS = {
    '2': 'krtek sesedava - bezi seznam ramcu $A2DF ($A160 SET, $A07E/$8FC9 RES)',
    '3': 'zere se PRAVA stena teto mistnosti ($A1E7 SET, $9C4D RES)',
    '4': 'zere se LEVA stena, tj. prava stena sousedky vlevo ($A203 SET, $9C4F RES)',
    '5': 'prave se vymenuje mistnost, preruseni netika pocitadla ($882E SET)',
}

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


def walk_frames(image, start, visited):
    """Seznam rámců: bajt na průchod, nula je konec (`$A177`)."""
    addr, frames = start, []
    while True:
        byte = image[addr - 0x4000]
        visited.add(addr)
        addr += 1
        if byte == 0:
            break
        frames.append(byte)
    return {'entry': start, 'frames': frames, 'end': addr - 1}


def walk_script(image, start, visited, stop_frame=None):
    """Bajtkódový skript interpretu `$8EB2` – týž rozbor jako v dumpphysics.py."""
    addr, steps = start, []
    while True:
        if addr in visited:
            steps.append({'at': addr, 'goto': addr})
            break
        frame = image[addr - 0x4000]
        step = {'at': addr, 'frame': frame, 'commands': []}
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
        if stop_frame is not None and frame == stop_frame:
            break                       # $A27D: ramec $35 vylezani ukonci
        if last['op'] == 'call':
            addr = last['target']
        if last['op'] == 'return':
            break
    return {'entry': start, 'steps': steps}


def directions(mask):
    names = [n for bit, n in ((1, 'vpravo'), (2, 'vlevo'), (4, 'dolu'), (8, 'nahoru'))
             if mask & bit]
    return '+'.join(names) if names else '-'


def surface_holes(image, table, count, stride):
    """Tabulka `$A299`: místnost a **dvě** polohy díry; kterou vzít, říká bit 0
    jednotek hodin (`$5B0E`), tj. tatáž proměnná, která rozhoduje i o tom,
    jestli krtek vůbec vyleze."""
    holes = []
    for i in range(count):
        base = table + i * stride - 0x4000
        holes.append({'room': image[base],
                      'even': [image[base + 1], image[base + 2]],
                      'odd':  [image[base + 3], image[base + 4]]})
    return holes


def eat_stream(image, base, count, row_mask, chunk_mask, rows):
    """Proud kousků, po kterých se stěna žere (`$7666`).

    Každý bajt je jedna dvojice **(dvojice pixelových řádků, kousek řádku)**:
    dolních 5 bitů je index dvojice řádků (`(bajt<<1) & $3E`, tj. `bajt & $1F`),
    horní 3 bity vyberou jeden z osmi dvoupixelových kousků na řádku
    (dva sloupce × čtyři polohy masky). Díra je 2 × 6 buněk = 48 pixelových
    řádků = 24 dvojic, tedy **24 × 8 = 192 kousků** – přesně tolik, kolik je
    počítadlo `$C0`.

    Kontrola úplnosti: prvních `count` bajtů musí být **permutace všech
    kombinací**, každá právě jednou. Co nesedí, se vypíše.
    """
    bytes_ = list(image[base - 0x4000:base - 0x4000 + count])
    chunks = chunk_mask + 1
    if rows * chunks != count:
        raise SystemExit('%d dvojic radku x %d kousku != pocitadlo %d'
                         % (rows, chunks, count))
    seen, problems = set(), []
    for i, byte in enumerate(bytes_):
        row, chunk = byte & (row_mask >> 1), byte >> 5
        if row >= rows or ((byte << 1) & row_mask) != row * 2:
            problems.append('bajt %d ($%02X): radek %d je mimo 0-%d' % (i, byte, row, rows - 1))
        if (row, chunk) in seen:
            problems.append('bajt %d ($%02X): (%d,%d) uz bylo' % (i, byte, row, chunk))
        seen.add((row, chunk))
    return {'base': base, 'count': count, 'rows': rows, 'chunks': chunks,
            'bytes': bytes_, 'complete': len(seen) == rows * chunks and not problems,
            'problems': problems}


def panel_icon(constants):
    """Ikona **člověk / krtek** v panelu.

    M1 našla v display listu panelu dva bloky 3 × 3 na tomtéž místě a druhý
    z nich neumístila (`data/panel.json`, `"drawn": false`). ★ **M4 na to
    odpovídá**: je to ikona krtka. `$8273` položí blok 0 (člověk), `$A0DD`
    blok 1 (krtek), oba na `(D = sloupec, E = znakový řádek)` z téhož operandu,
    a k tomu přepíšou tři buňky atributů.
    """
    at = constants['panelIconAt']
    row = at & 0xFF                              # E = znakový řádek
    column = at >> 8                             # D = sloupec
    panel_row = 21                               # panel začíná na řádku 21 (§4)
    cells = []
    for key in ('panelAttrCellA', 'panelAttrCellB', 'panelAttrCellC'):
        address = constants[key] - 0x5800
        cells.append([address % 32, address // 32 - panel_row])
    man = constants['panelAttrManHi']
    return {'theme': constants['panelTheme'],
            'blockMan': constants['panelIconMan'],
            'blockMole': constants['panelIconMole'],
            'column': column, 'screenRow': row, 'row': row - panel_row,
            'attrCells': cells,
            'attrMan': [man, man - 1, man - 1],
            'attrMole': [constants['panelAttrMole']]*3,
            'note': ('$8273 kresli cloveka (blok 0), $A0DD krtka (blok 1); '
                     'tim je zodpovezena otevrena otazka M1 o druhem bloku '
                     'display listu panelu.')}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--show', action='store_true', help='vypsat skripty a tabulku čitelně')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    image = read_image()
    constants, notes = {}, {}
    for name, addr, pattern, note in CONSTANTS:
        value, width = operand(image, addr, pattern, name)
        constants[name] = value
        notes[name] = {'at': '$%04X' % addr, 'instruction': pattern, 'what': note,
                       'value': ('$%04X' if width == 2 else '$%02X') % value}

    ridden = constants['moleScriptLo'] + 256 * constants['moleScriptHi']
    surface = constants['surfaceScriptLo'] + 256 * constants['surfaceScriptHi']
    constants['riddenScript'] = ridden
    constants['surfaceScript'] = surface
    notes['riddenScript'] = {'at': '$A10C+$A110', 'instruction': 'DD 36 09 .. / DD 36 0A ..',
                             'what': 'seznam ramcu, kdyz se na krtkovi jezdi',
                             'value': '$%04X' % ridden}
    notes['surfaceScript'] = {'at': '$A260+$A264', 'instruction': 'DD 36 09 .. / DD 36 0A ..',
                              'what': 'skript vylezani z diry na povrchu',
                              'value': '$%04X' % surface}

    # --- bloky: seznamy rámců a skripty, projít od všech vstupních bodů
    visited = set()
    lists = {
        'ridden':   walk_frames(image, ridden, visited),
        'dismount': walk_frames(image, constants['dismountScript'], visited),
    }
    scripts = {
        'surface':  walk_script(image, surface, visited,
                                stop_frame=constants['surfaceEndFrame']),
        'digRight': walk_script(image, constants['digScriptRight'], visited),
        'digLeft':  walk_script(image, constants['digScriptLeft'], visited),
    }

    if constants['eatStreamLeft'] != constants['eatStreamRight']:
        raise SystemExit('proud kousku se u leve a prave steny lisi - to je novy nalez')
    # díra je gapRows buněk vysoká, tj. gapRows*8 pixelových řádků; proud jich
    # bere po dvou (`$9C35 ADD HL,$0020` je ten druhý řádek)
    eating = eat_stream(image, constants['eatStreamRight'], constants['digCounter'],
                        constants['eatRowMask'], constants['eatChunkMask'],
                        constants['gapRows'] * 8 // 2)

    blocks = {}
    for key, lo, hi in (('anim', 0xA2B8, 0xA2E4), ('dig', 0x5B6A, 0x5B8D)):
        blocks[key] = {'base': lo, 'end': hi,
                       'bytes': list(image[lo - 0x4000:hi + 1 - 0x4000])}
    gaps = sorted(a for key in blocks
                  for a in range(blocks[key]['base'], blocks[key]['end'] + 1)
                  if a not in visited)

    # --- výchozí záznam krtka z rozehrané hry, do které se **nesahá**:
    #     na povrchu (místnost $06 je v tabulce děr) krtek vyleze sám.
    session = physlib.Session().boot(physlib.GAME_FRAME)
    record, spotted = None, None
    def watch(frame):
        nonlocal record, spotted
        if record is None and session.memory[MOLE] & 0x01:
            record = list(session.memory[MOLE:MOLE + 32])
            spotted = frame
    session.run(physlib.GAME_FRAME + 600, list(physlib.MENU), on_frame=watch)
    if record is None:
        raise SystemExit('krtek na povrchu se v okne nepodaril zastihnout')

    data = {
        'note': ('Krtek a stav sveta vytazene z originalu: konstanty jsou operandy '
                 'skutecnych instrukci, seznamy ramcu a skripty jsou bajty '
                 'originalu. Viz sources/docs/disasm_notes.md par. 11.'),
        'constants': constants,
        'constantNotes': notes,
        'globalBits': {'a2b7': A2B7_BITS, 'flags5B0A': FLAG_BITS},
        'blocks': blocks,
        'frameLists': lists,
        'scripts': scripts,
        'panelIcon': panel_icon(constants),
        'eatStream': eating,
        'surfaceHoles': surface_holes(image, constants['surfaceHoleTable'],
                                      constants['surfaceHoleCount'],
                                      constants['surfaceHoleStride']),
        'mole': {
            'record': record,
            'spottedAtFrame': spotted,
            'room': session.memory[physlib.ROOM],
            'note': ('Zaznam vylezajiciho krtka z NEZMENENE rozehrane hry. Zaznam '
                     'krtka, na kterem se jezdi, si $A098 sklada z konstant '
                     'moleFlags/moleFrame/moleDelay/molePeriod/moleStep a ze '
                     'souradnic Charlieho.')
        },
        'unreachable': ['$%04X' % a for a in gaps],
    }
    with open(args.out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
        f.write('\n')

    print('konstanty: %d (vsechny jako operandy overenych instrukci)' % len(CONSTANTS))
    for key, block in sorted(blocks.items()):
        print('blok %-5s $%04X-$%04X, %d B'
              % (key, block['base'], block['end'],
                 block['end'] - block['base'] + 1))
    print('nedosazitelnych bajtu: %d%s'
          % (len(gaps), (' (' + ' '.join('$%04X' % a for a in gaps) + ')') if gaps else ''))
    if gaps:
        print('  vysvetleni: $A27D testuje ramec JESTE PRED krokem, takze posledni')
        print('  krok skriptu vylezani ($A2DD "35 94") se nikdy neudela.')
    print('proud kousku steny: $%04X, %d bajtu, %d dvojic radku x %d kousku -> %s'
          % (eating['base'], eating['count'], eating['rows'], eating['chunks'],
             'permutace bez zbytku' if eating['complete'] else 'NESEDI'))
    for problem in eating['problems'][:5]:
        print('  %s' % problem)
    print('seznam ramcu pri jizde: %s' % ' '.join('%02X' % f for f in lists['ridden']['frames']))
    print('seznam ramcu pri sesedani: %s' % ' '.join('%02X' % f for f in lists['dismount']['frames']))
    icon = data['panelIcon']
    print('ikona v panelu: blok %d clovek / %d krtek na (sloupec %d, znakovy radek %d),'
          ' bunky atributu %s'
          % (icon['blockMan'], icon['blockMole'], icon['column'], icon['screenRow'],
             icon['attrCells']))
    print('der na povrchu: %d (mistnosti %s)'
          % (len(data['surfaceHoles']),
             ' '.join('$%02X' % h['room'] for h in data['surfaceHoles'])))
    print('zaznam krtka z rozehrane hry (mistnost $%02X, snimek %d):'
          % (data['mole']['room'], spotted))
    print('  %s' % ' '.join('%02X' % b for b in record))
    print('  x=$%02X y=$%02X sirka=%d vyska=%d ramec=$%02X krok=%d perioda=$%02X'
          % (record[1], record[2], record[3], record[4], record[0x1E],
             record[6], record[0x0C]))
    print('ulozeno %s' % args.out)

    if args.show:
        print('\ntabulka der na povrchu ($%04X):' % constants['surfaceHoleTable'])
        for hole in data['surfaceHoles']:
            print('  mistnost $%02X   jednotky hodin sude: x=$%02X y=$%02X   '
                  'nesude: x=$%02X y=$%02X'
                  % (hole['room'], hole['even'][0], hole['even'][1],
                     hole['odd'][0], hole['odd'][1]))
        for name, script in sorted(scripts.items()):
            print('\nskript %s  $%04X' % (name, script['entry']))
            for step in script['steps']:
                if 'goto' in step:
                    print('  $%04X  -> smycka' % step['at'])
                    continue
                parts = []
                for c in step['commands']:
                    if c['op'] == 'move':
                        parts.append('move %s' % directions(c['arg']))
                    elif c['op'] == 'move2':
                        parts.append('move2 %s+%s dist %02X'
                                     % (directions(c['arg'] & 0x0C),
                                        directions(c['arg'] & 3), c['distances']))
                    elif c['op'] == 'call':
                        parts.append('call $%04X' % c['target'])
                    else:
                        parts.append(c['op'])
                print('  $%04X  ramec %02X  %s' % (step['at'], step['frame'], ', '.join(parts)))
        print('\nbity $A2B7:')
        for bit, what in sorted(A2B7_BITS.items()):
            print('  bit %s  %s' % (bit, what))
        print('\nbity $5B0A, ktere patri krtkovi a svetu:')
        for bit, what in sorted(FLAG_BITS.items()):
            print('  bit %s  %s' % (bit, what))


if __name__ == '__main__':
    main()
