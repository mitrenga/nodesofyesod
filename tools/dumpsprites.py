#!/usr/bin/env python3
"""Vytáhne **všechny typy spritů z tabulky spritů** do `data/spriteframes.json`.

    ./tools/dumpsprites.py [--show] [--png sources/media/sprites]

Co se v M2 našlo (`sources/docs/disasm_notes.md` §9):

* **dvě tabulky rámců** po 128 dvoubajtových ukazatelích: `$B700` a `$C700`.
  Která se použije, rozhoduje **bit 6 příznaků entity** (`$8E87 BIT 6,(IX+$00)`;
  rutina počítá `HL = $B700 + index*2` a pro druhou banku přičte `$1000`).
* **rámec** = tříbajtová hlavička `(šířka v pixelech, výška v řádcích, atribut)`
  a za ní bitmapa po řádcích, `ceil(šířka/8)` bajtů na řádek.
* ★ **Doplněno v M5:** pět slotů (`$C7C4`–`$C7CD`, tedy rámce `$62`–`$66` –
  **čtyři alchiemy a mugger**) je v obrazu po nahrání **nulových** a hra si je
  vyplní až při rozehrání; jejich bitmapy navíc leží mimo obě hlavní oblasti.
  Tabulky se proto čtou **z rozehrané hry** (jako u dumperů M2, `data/README.md`)
  a oblast bitmap, kam ukazují, se dopočítá z ukazatelů – nezadává se ručně.
* Kreslí se **XOR** (`$9508`–`$9532`) s předsunutím o 0–7 pixelů, tj. o bajt
  širší, než je uložený rámec. Attribute clash se tím reprodukuje sám –
  proto sprity zůstávají v **ZX bajtech + atributu**, ne ve formátu
  `spriteTool.js` (`ZADANI.md` §7).
* ★ **Atribut rámce se nezapisuje celý** (`$940E`–`$9445`): z rámce se vezme
  `AND $C7` (flash, bright a **ink**), papír zůstane z pozadí (`AND $38`),
  a zapisuje se **jen do buněk, které jsou pozadí** – tedy jejichž atribut ve
  stínovém bufferu je po `AND $3F` nula, nebo se rovná „barvě pozadí" té části
  světa (`$8871`–`$8887`: `$09` na povrchu, `$07` v jeskyních). Konstanty toho
  pravidla jsou v `attributes` a jsou to **operandy skutečných instrukcí**.

Kontrola úplnosti: rámce musí **beze zbytku** vyplnit svůj rozsah paměti, tj.
velikost odvozená z hlavičky musí sedět na adresu následujícího rámce.
Co nesedí, se **vypíše** – nezamlčí.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scr2png import write_png                                   # noqa: E402
from dumpgfx import Image, PALETTE                              # noqa: E402

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
TABLES = (0xB700, 0xC700)       # banka 0 / banka 1, 128 ukazatelů po 2 B
TABLE_SLOTS = 128
DATA_LO, DATA_HI = 0x5B00, 0xDBFD    # kde vůbec můžou ležet bitmapy
MAX_WIDTH, MAX_HEIGHT = 32, 48


REGIONS = ((0xB754, 0xC700), (0xC7E0, DATA_HI))     # mezi nimi leží tabulka $C700


# ★ Pravidlo, jak se zapisuje atribut spritu ($940E-$9445 a $8871-$8887).
# Formát je týž jako u CONSTANTS v dumpphysics.py: operand ověřené instrukce.
ATTR_RULE = [
    ('frameMask',      0x9419, 'E6 ..', 'z atributu ramce se bere jen tohle (AND n): flash, bright, ink'),
    ('paperMask',      0x9421, 'E6 ..', 'papir zustava z pozadi (AND n)'),
    ('shadowMask',     0x942E, 'E6 ..', 'stinovy atribut se porovnava az po AND n (bez bright a kolizniho bitu)'),
    ('surfaceMaxRoom', 0x8874, 'FE ..', 'mistnost, od ktere zacinaji jeskyne (CP n)'),
    ('guardCave',      0x8878, '06 ..', 'barva pozadi v jeskynich (LD B,n)'),
    ('guardSurface',   0x887F, '06 ..', 'barva pozadi na povrchu (LD B,n)'),
]


def operand(image, addr, pattern, name):
    """Přečte operand instrukce a ověří, že na té adrese ta instrukce opravdu je."""
    parts = pattern.split()
    got = [image.bytes(addr, len(parts))[i] for i in range(len(parts))]
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


def attribute_rule(image):
    """Konstanty pravidla zápisu atributu spritu jako operandy instrukcí."""
    values, notes = {}, {}
    for name, addr, pattern, note in ATTR_RULE:
        value, width = operand(image, addr, pattern, name)
        values[name] = value
        notes[name] = {'at': '$%04X' % addr, 'instruction': pattern, 'what': note,
                       'value': ('$%04X' if width == 2 else '$%02X') % value}
    return values, notes


def plausible(width, height):
    return 0 < width <= MAX_WIDTH and 0 < height <= MAX_HEIGHT


def runtime_tables(image):
    """Tabulky rámců **z rozehrané hry**, ne ze statického obrazu.

    ★ Pět slotů (`$C7C4`–`$C7CD`) je po nahrání nulových a hra je vyplní až při
    rozehrání – jsou to čtyři alchiemy a mugger (M5). Ze statického obrazu by
    se ty rámce nedaly najít vůbec.
    """
    try:
        import physlib
    except ImportError:                                         # pragma: no cover
        return None
    memory = physlib.Session().boot().memory
    changed = [a for a in range(TABLES[0], TABLES[1] + 2 * TABLE_SLOTS)
               if memory[a] != image.byte(a)]
    for addr in changed:
        image.poke(addr, memory[addr])
    return changed


def extra_region(image, patched):
    """Oblast bitmap, na kterou míří **sloty, které vyplnila až rozehraná hra**.

    Nezadává se ručně a nehádá se z rozsahu všech ukazatelů (v nepoužitých
    slotech jsou náhodná data): bere se přesně těch pár slotů, které se proti
    obrazu po nahrání změnily, a mezi jejich nejnižším a nejvyšším ukazatelem
    se jede řetězem rámců.
    """
    if not patched:
        return None
    slots = {addr & ~1 for addr in patched}
    targets = {image.word(addr) for addr in slots}
    targets = {t for t in targets if DATA_LO <= t < DATA_HI
               and not any(lo <= t < hi for lo, hi in REGIONS)}
    if not targets:
        return None
    lo, hi = min(targets), max(targets)
    width, height = image.byte(hi), image.byte(hi + 1)
    if not plausible(width, height):
        return None
    return (lo, hi + 3 + height * ((width + 7) // 8))


def mirror_rows(data, width, height, stride):
    """Vodorovně **zrcadlený** rámec: bitmapa pro druhý směr chůze.

    ★ **Oprava nálezu M3.** `sources/docs/disasm_notes.md` §10.3 správně zjistil, že
    `$8E80` zahodí bit 7 čísla rámce (`A*2 mod 256`), takže rámec `$80` míří na
    **tutéž bitmapu** jako `$00` – a vyvodil z toho, že se nezrcadlí. To je
    o krok dál, než data dovolují: skript chůze vlevo (`$5BC8`) jede rámce
    `$80`–`$87`, a kdyby se nezrcadlily, chodil by Charlie doleva **čelem
    doprava**. Přesně to remake dělal. Zrcadlení tedy nedělá `$8E80`, ale až
    kreslení – a hra na to má, co potřebuje: **tabulku obrácených bajtů na
    `$FE00`**, kterou si dopočítá při startu (§8.2) a která u dlaždic kulisy
    zrcadlí právě podle bitu 7 indexu (`$8A70`).

    Zrcadlí se **v šířce samotného rámce**, ne v celých `stride*8` bitech:
    obálka spritu tak zůstane na svém místě. Rámců se širokých na celé bajty
    (`width % 8 == 0`) se ten rozdíl netýká – u ostatních by mířil o
    `stride*8 - width` pixelů vedle.
    """
    out = bytearray(len(data))
    for y in range(height):
        row = y * stride
        for x in range(width):
            source = x
            byte = data[row + (source >> 3)]
            if not byte & (0x80 >> (source & 7)):
                continue
            target = width - 1 - x
            out[row + (target >> 3)] |= 0x80 >> (target & 7)
    return bytes(out)


def stray_pixels(data, width, height, stride):
    """Kolik pixelů leží **za deklarovanou šířkou** rámce, ve výplni posledního
    bajtu řádku. Blit originálu kreslí celé bajty (o jeden víc kvůli
    předsunutí), takže se nakreslí i ty – v zrcadlení v šířce rámce ale nemají
    kam jít. Vypsat, ne schovat.
    """
    pad = stride * 8 - width
    if not pad:
        return 0
    mask = (0xFF >> (8 - pad)) & 0xFF
    return sum(bin(data[y * stride + stride - 1] & mask).count('1')
               for y in range(height))


def collect(image, regions):
    """Rámce se čtou **řetězem** – rámec za rámcem, jak leží v paměti.

    Ukazatele z tabulek slouží jako kontrola (a jako vodítko tam, kde se dva
    rámce o bajt překrývají). Sloty tabulek, které na začátek rámce nemíří,
    jsou nepoužité – v obrazu v nich zůstala náhodná data.
    """
    pointers = {}
    for bank, base in enumerate(TABLES):
        for slot in range(TABLE_SLOTS):
            pointers.setdefault(image.word(base + 2 * slot), []).append((bank, slot))
    referenced = sorted(p for p in pointers if DATA_LO <= p < DATA_HI)

    frames, problems = [], []
    for lo, hi in regions:
        addr = lo
        while addr < hi:
            width, height, attr = (image.byte(addr), image.byte(addr + 1),
                                   image.byte(addr + 2))
            if not plausible(width, height):
                break
            stride = (width + 7) // 8
            size = 3 + height * stride
            bitmap = image.bytes(addr + 3, height * stride)
            frames.append({
                'address': addr, 'width': width, 'height': height,
                'attribute': attr, 'bytesPerLine': stride,
                'data': base64.b64encode(bitmap).decode(),
                # rámec pro druhý směr chůze; viz mirror_rows()
                'mirror': base64.b64encode(
                    mirror_rows(bitmap, width, height, stride)).decode(),
            })
            stray = stray_pixels(bitmap, width, height, stride)
            if stray:
                problems.append('$%04X: %d x %d ma %d pixelu za svou sirkou '
                                '(vypln posledniho bajtu radku) – v zrcadlenem '
                                'ramci nejsou' % (addr, width, height, stray))
            following = next((p for p in referenced if p > addr), None)
            shared = (following is not None and 0 < addr + size - following <= 2
                      and plausible(image.byte(following), image.byte(following + 1)))
            if shared:
                # dva rámce sdílejí bajt – hra si tím šetří místo; vypsat, ne schovat
                problems.append('$%04X: %d x %d konci na $%04X, ale dalsi odkazovany '
                                'ramec zacina uz na $%04X (prekryv %d B)'
                                % (addr, width, height, addr + size, following,
                                   addr + size - following))
                addr = following
            else:
                addr += size
        rest = image.bytes(addr, hi - addr)
        if any(rest):
            problems.append('$%04X-$%04X: za poslednim ramcem oblasti neni vypln '
                            'nulami' % (addr, hi - 1))

    by_addr = {f['address']: n for n, f in enumerate(frames)}
    for frame in frames:
        frame['slots'] = [{'bank': b, 'index': s}
                          for b, s in sorted(pointers.get(frame['address'], []))]
    unused = [(b, s) for addr, slots in pointers.items() for b, s in slots
              if addr not in by_addr]
    return frames, problems, by_addr, sorted(unused)


def sheet_png(path, image, frames, per_row=8, scale=2):
    """Náhledový list všech rámců, každý ve své barvě a s ořezem na svou šířku."""
    cell_w = MAX_WIDTH + 2
    cell_h = MAX_HEIGHT + 2
    rows_count = (len(frames) + per_row - 1) // per_row
    width = per_row * cell_w
    rows = [bytearray(b'\x00\x00\x00' * width) for _ in range(rows_count * cell_h)]
    for n, frame in enumerate(frames):
        ox, oy = (n % per_row) * cell_w + 1, (n // per_row) * cell_h + 1
        attr = frame['attribute']
        bright = 8 if attr & 0x40 else 0
        ink = bytes(PALETTE[(attr & 0x07) + bright])
        paper = bytes(PALETTE[((attr >> 3) & 0x07) + bright])
        stride = frame['bytesPerLine']
        data = image.bytes(frame['address'] + 3, frame['height'] * stride)
        for y in range(frame['height']):
            row = rows[oy + y]
            for x in range(frame['width']):
                byte = data[y * stride + (x >> 3)]
                on = byte & (0x80 >> (x & 7))
                row[(ox + x) * 3:(ox + x) * 3 + 3] = ink if on else paper
    write_png(path, [bytes(r) for r in rows], width, scale)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--image', default=IMAGE)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'spriteframes.json'))
    ap.add_argument('--png', default=os.path.join(HERE, '..', 'sources', 'media', 'sprites'),
                    help='kam ulozit nahledovy list (vychozi sources/media/sprites)')
    ap.add_argument('--show', action='store_true')
    args = ap.parse_args()

    image = Image(args.image)
    patched = runtime_tables(image)
    regions = list(REGIONS)
    extra = extra_region(image, patched)
    if extra:
        regions.append(extra)
    frames, problems, by_addr, unused = collect(image, regions)
    attr_rule, attr_notes = attribute_rule(image)

    banks = []
    for bank, base in enumerate(TABLES):
        entries = []
        for slot in range(TABLE_SLOTS):
            addr = image.word(base + 2 * slot)
            entries.append(by_addr.get(addr, -1))
        banks.append({'index': bank, 'address': base, 'frames': entries,
                      'used': sum(1 for e in entries if e >= 0)})

    data = {
        'note': 'M2: tabulka spritů z obrazu RAM (tools/dumpsprites.py). Rámec je '
                'tříbajtová hlavička (šířka, výška, atribut) a bitmapa po řádcích. '
                'Zůstává v ZX bajtech a atributech – kreslí se XOR s předsunutím '
                'o 0–7 pixelů, takže attribute clash se reprodukuje z bajtů. '
                'Oprava M3: ke každému rámci je i „mirror“, tedy tatáž bitmapa vodorovně '
                'zrcadlená v šířce rámce – rámec s bitem 7 (pohled doleva) míří na '
                'tutéž bitmapu, a hra ji zrcadlí tabulkou obrácených bajtů na $FE00. '
                'Oprava M6: „attributes“ je pravidlo, jak se atribut rámce zapisuje '
                'do buňky ($940E–$9445) – papír zůstává z pozadí a zapisuje se jen '
                'do buněk pozadí. Bez něj remake maloval kolem spritů černé obdélníky.',
        'source': os.path.basename(args.image),
        'banks': banks,
        'regions': [{'from': lo, 'to': hi - 1} for lo, hi in regions],
        'unusedSlots': [{'bank': b, 'index': s} for b, s in unused],
        'attributes': attr_rule,
        'attributeNotes': attr_notes,
        'frames': frames,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
        f.write('\n')

    if args.png:
        os.makedirs(args.png, exist_ok=True)
        sheet = os.path.join(args.png, 'spriteframes.png')
        sheet_png(sheet, image, frames)
        print('  nahledovy list: %s' % sheet)

    covered = sum(3 + f['height'] * f['bytesPerLine'] for f in frames)
    print('%s: %d ramcu, %d B dat' % (args.out, len(frames), covered))
    print('  oblasti: ' + ', '.join('$%04X-$%04X' % (lo, hi - 1) for lo, hi in regions))
    if patched:
        print('  ★ %d bajtu tabulek vyplnila az rozehrana hra ($%04X-$%04X) – '
              'v obrazu po nahrani jsou nulove'
              % (len(patched), min(patched), max(patched)))
    print('  nepouzitych slotu tabulek: %d z %d (v obrazu v nich zustala '
          'nahodna data)' % (len(unused), len(TABLES) * TABLE_SLOTS))
    for bank in banks:
        print('  tabulka $%04X: %d ze %d slotu miri na ramec'
              % (bank['address'], bank['used'], TABLE_SLOTS))
    if args.show:
        for n, frame in enumerate(frames):
            print('  %3d $%04X %2d x %2d  atribut $%02X  sloty %s'
                  % (n, frame['address'], frame['width'], frame['height'],
                     frame['attribute'],
                     ' '.join('%d/%d' % (s['bank'], s['index']) for s in frame['slots'])))
    if problems:
        print('\nnenavazuje (vypsano, ne schovano):')
        for problem in problems:
            print('  ' + problem)
    else:
        print('kontrola uplnosti: ramce navazuji beze zbytku')
    return 0


if __name__ == '__main__':
    sys.exit(main())
