#!/usr/bin/env python3
"""Vytáhne znakovou sadu hry z dlaždicové tabulky do `data/font.json`.

    ./tools/mkfont.py [--ram build/nodesofyesod-48k.bin] [--dst data/font.json] [--show]

Hra nemá zvláštní font – znaky jsou **dlaždice téže tabulky, ze které je
poskládaný panel** (`$73E6`, 8 bajtů na buňku, viz `tools/mkpanel.py`
a `sources/docs/disasm_notes.md`). Indexy jsou změřené:

| index | znak |
|---|---|
| 0 | prázdná buňka (mezera) |
| 41 | `:` |
| 42–51 | `0`–`9` |
| 52–77 | `A`–`Z` |
| 78 | `©` |

Ověření: dlaždice 42 (`0`) je bajt po bajtu ta, kterou hodiny `TIME` kreslí do
buňky (23, 22) zachyceného snímku, a dlaždice 45 (`3`) je číslice v `LIFE`.
Malá písmena, interpunkci ani číslice jiné šířky sada **nemá** – co v tabulce
není, tady není. Nápisy `ALCHIEMS`, `LIFE` a `TIME` v panelu nejsou psané tímhle
fontem, jsou to hotové dlaždice (menší, 5px sada) – proto zůstávají v
`data/panel.json`, ne tady.
"""
import argparse, json, os

TILE_TABLE = 0x73E6
INDEX = {' ': 0, ':': 41}
for digit in range(10):
    INDEX[chr(ord('0')+digit)] = 42+digit
for letter in range(26):
    INDEX[chr(ord('A')+letter)] = 52+letter
INDEX['©'] = 78


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ram', default=os.path.join(root, 'build/nodesofyesod-48k.bin'))
    ap.add_argument('--dst', default=os.path.join(root, 'data/font.json'))
    ap.add_argument('--show', action='store_true', help='vypíše sadu jako ASCII')
    args = ap.parse_args()

    ram = open(args.ram, 'rb').read()
    if len(ram) != 49152:
        raise SystemExit('cekam 49152 B RAM ($4000-$FFFF), mam %d' % len(ram))

    glyphs = {}
    for char, index in INDEX.items():
        addr = TILE_TABLE+8*index
        glyphs[char] = ram[addr-0x4000:addr-0x4000+8].hex().upper()
        if args.show:
            print(char, ' '.join(''.join('#' if byte >> (7-bit) & 1 else '.'
                                         for bit in range(8))
                                 for byte in bytes.fromhex(glyphs[char])))

    font = {
        'note': 'znaková sada hry – dlaždice tabulky $73E6 (tools/mkfont.py). '
                'Jen mezera, dvojtečka, číslice, velká písmena a ©; víc originál nemá.',
        'base': '$%04X' % TILE_TABLE,
        'width': 8, 'height': 8,
        'index': {char: INDEX[char] for char in sorted(INDEX)},
        'glyphs': glyphs
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(font, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write('\n')
    print('%s (%d glyfu)' % (args.dst, len(glyphs)))


if __name__ == '__main__':
    main()
