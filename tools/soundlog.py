#!/usr/bin/env python3
"""Nahraje **zvuk originálu** do `build/soundruns/*.json` – podklad pro matcher.

    PYTHONPATH=tools/vendor ./tools/soundlog.py [--quick] [--only jmeno]

Táž metodika jako `physlog.py` / `molelog.py` / `monsterlog.py`, jen místo
záznamů entit se nahrávají **pulzy na reproduktoru**: každá zvuková rutina
originálu se pustí v simulátoru a zapíše se, po kolika T-stavech přepnula bit 4
portu `$FE`. Proti tomu pak `tools/matchsound.js` pouští `app/beeper.js`, tedy
**kód, který jde do prohlížeče**, a trvá na nule rozdílů.

Co se nahrává:

* **192 tónů** – 48 period tabulky `$614C` × 4 délky, každý zvlášť (`$873C`);
* **všech šest melodií** originálu, celé (`$8726`);
* **fanfára** dopadeného muggera (`$83BA`) a **pípnutí přepnutí režimu** (`$A2E5`);
* **přerušovací sloty** 1 a 2 pro celou škálu hodnot – jeden snímek každý;
* **surová tónová smyčka** (`$8747`) pro periody, které v tabulce nejsou –
  z těch se skládá zvuk teleportu;
* **digitalizovaná řeč** celá (`$E200`), pokud se nedá `--quick`.

Binárky do gitu nepatří, výstup jde do `build/` jako u ostatních logů.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import soundlib                                                 # noqa: E402
from skoolkit.simutils import A, H, L                           # noqa: E402

OUTDIR = os.path.join(HERE, '..', 'build', 'soundruns')
DATA = os.path.join(HERE, '..', 'data', 'sound.json')

# hodnoty, pro které se nahraje jeden snímek přerušovacího slotu
SLOT_VALUES = [1, 2, 4, 8, 0x10, 0x1F, 0x20, 0x33, 0x40, 0x55, 0x7F,
               0x80, 0xA0, 0xC0, 0xF8, 0xFF, 0]
# periody surové tónové smyčky, na kterých se ověřuje zvuk teleportu
RAW_PERIODS = [0xFF, 0xC0, 0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01]


# Melodie i řeč běží dlouho (titulní hudba je přes minutu strojového času),
# takže se strop T-stavů musí zvednout – jinak by se nahrávka mlčky uřízla.
LIMIT = 2000000000


def pulses(beeper, name, address, registers=None, poke=None, stop=None):
    kwargs = {'max_tstates': LIMIT}
    if stop is not None:
        kwargs['stop'] = stop
    train, total = beeper.pulses(address, registers, poke, **kwargs)
    return {'name': name, 'pulses': train, 'total': total}


def record_tones(beeper, quick):
    lengths = [0] if quick else [0, 1, 2, 3]
    out = []
    for length in lengths:
        for index in range(48):
            note = (length << 6) | index
            out.append(pulses(beeper, 'tone $%02X' % note, soundlib.TONE, {A: note}))
    return out


def record_tunes(beeper, data, quick):
    out = []
    for key in sorted(data['tunes']):
        addr = int(key[1:], 16)
        if quick and data['tunes'][key]['count'] > 30:
            continue
        out.append(pulses(beeper, 'tune %s' % key, 0x8726,
                          {H: addr >> 8, L: addr & 0xFF}))
    return out


def record_slots(beeper):
    out = []
    for value in SLOT_VALUES:
        out.append(pulses(beeper, 'slot1 $%02X' % value, soundlib.SLOT1, None,
                          {soundlib.VAR_SLOT1_VALUE: value,
                           soundlib.VAR_SLOT1_STEP: 0}))
        out.append(pulses(beeper, 'slot2 $%02X' % value, soundlib.SLOT2, None,
                          {soundlib.VAR_SLOT2_VALUE: value}))
    return out


def record_raw(beeper, data):
    """Surová tónová smyčka `$8747`: A je rovnou perioda, délka je na zásobníku.

    Na zásobník se položí slovo, jehož **horní bajt je A** pro `POP AF` na
    `$875E` – tak to dělá i teleport (`$842C PUSH BC`).
    """
    unit = data['constants']['teleportUnit']
    out = []
    for period in RAW_PERIODS:
        poke = {soundlib.VAR_DURATION: unit,
                0xFFFC: 0x00, 0xFFFD: 0x00,        # POP AF: delka = 1 jednotka
                0xFFFE: soundlib.SENTINEL & 0xFF,
                0xFFFF: soundlib.SENTINEL >> 8}
        train, total = beeper.pulses(soundlib.TONE_RAW, {A: period}, poke, LIMIT)
        out.append({'name': 'raw $%02X' % period, 'pulses': train, 'total': total,
                    'period': period, 'unit': unit})
    return out


def record_speech(beeper, data):
    """Celý vzorek řeči: rutina nekončí `RET`, ale skokem do hry."""
    return [pulses(beeper, 'speech', 0xE210, None, None, stop=0xE23B)]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--quick', action='store_true',
                        help='jen kratke behy (bez dlouhych melodii a reci)')
    parser.add_argument('--only', action='append',
                        help='nahrat jen tuhle skupinu (tones, tunes, slots, raw, speech)')
    args = parser.parse_args()

    with open(DATA) as handle:
        data = json.load(handle)
    os.makedirs(OUTDIR, exist_ok=True)
    beeper = soundlib.Beeper()

    groups = {
        'tones':  lambda: record_tones(beeper, args.quick),
        'tunes':  lambda: record_tunes(beeper, data, args.quick),
        'slots':  lambda: record_slots(beeper),
        'raw':    lambda: record_raw(beeper, data),
        'speech': lambda: [] if args.quick else record_speech(beeper, data),
    }
    wanted = args.only or list(groups)
    for name in wanted:
        if name not in groups:
            raise SystemExit('neznama skupina %s' % name)
        runs = groups[name]()
        path = os.path.join(OUTDIR, '%s.json' % name)
        with open(path, 'w') as handle:
            json.dump({'group': name, 'clock': 3500000, 'runs': runs}, handle)
            handle.write('\n')
        total = sum(len(run['pulses']) for run in runs)
        print('%-8s %3d behu, %6d pulzu -> %s'
              % (name, len(runs), total, os.path.relpath(path)))


if __name__ == '__main__':
    main()
