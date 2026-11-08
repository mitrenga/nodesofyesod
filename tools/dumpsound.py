#!/usr/bin/env python3
"""Vytáhne z originálu **zvuk 48K edice** do `data/sound.json`.

    PYTHONPATH=tools/vendor ./tools/dumpsound.py [--show]

Zvuk téhle hry je jeden bit portu `$FE`, takže se nedá „nasamplovat" – dá se jen
**přepsat rutina, která ten bit klepe**. Do dat proto jde tohle a nic víc:

* **konstanty jsou operandy skutečných instrukcí** (táž disciplína jako
  `dumpphysics.py`): u každé se ověří, že na té adrese ta instrukce opravdu
  stojí, jinak nástroj skončí chybou místo aby vydal číslo;
* **tabulka period a melodie jsou bajty originálu** – tabulka `$614C` (48 tónů)
  a šest melodií, na které ukazují seznamy `$613C` (titulní hudba, 7 dílů)
  a `$614A` (závěrečná obrazovka);
* **časy smyček jsou změřené v simulátoru**, ne spočítané z tabulky časů
  instrukcí: každá smyčka se pustí pro několik parametrů, na naměřené délky
  pulzů se proloží model `k*parametr + q` a nástroj **trvá na tom, že sedí
  přesně** (jinak skončí chybou). Model pak umí `app/soundEffects.js`
  a `tools/matchsound.js` ho porovnává proti dalším měřením;
* ★ **digitalizovaná řeč**: 4246 bajtů 1bitového vzorku na `$E23E`, které
  přehrává vstupní rutina `$E200`. **Je v paměti**, nemusí se shánět kazeta
  (`MILNIKY.md`, riziko 2b).

Kontrola úplnosti: tabulka period a všech šest melodií musí **beze zbytku
vyplnit blok `$614C`–`$62AB`**, tedy přesně to, co leží mezi ukazatelem na
tabulku period a začátkem tabulky kulisových sad `$62AC` (M2). Co by zbylo,
nástroj vypíše jako `unreachable`.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import soundlib                                                 # noqa: E402
from soundlib import operand, read_image                        # noqa: E402
from skoolkit.simutils import A                                 # noqa: E402

OUT = os.path.join(HERE, '..', 'data', 'sound.json')

SCENERY_TABLE = 0x62AC      # zacatek tabulky kulisovych sad (M2) = konec bloku zvuku

# ---------------------------------------------------------------- konstanty
# (jméno, adresa, očekávané bajty instrukce s '..' místo operandu, k čemu to je)
CONSTANTS = [
    # --- prehravac tonu ($873C -> $8747 -> $876E), disasm_notes.md §13.1
    ('noteMask',       0x873D, 'E6 ..',    'bity vysky v bajtu noty (AND n)'),
    ('noteTable',      0x8742, '11 .. ..', 'tabulka period tonu (LD DE,nn)'),
    ('toneMask',       0x8749, '3E ..',    'maska prepinace reproduktoru (bit 4) a MIC (bit 3)'),
    ('durationMask',   0x875F, 'E6 ..',    'bity delky v bajtu noty (AND n)'),
    ('durationUnit',   0x8766, 'C6 ..',    'delka jedne jednotky noty (ADD A,n), prepisuje se'),
    ('durationLow',    0x876C, '2E ..',    'spodni bajt pocitadla delky (LD L,n)'),
    # --- seznamy melodii ($8704, $870D)
    ('titleTuneCount', 0x8704, '06 ..',    'kolik dilu ma titulni hudba (LD B,n)'),
    ('titleTuneList',  0x8706, '21 .. ..', 'seznam ukazatelu na dily titulni hudby'),
    ('endTuneCount',   0x870D, '06 ..',    'kolik dilu ma hudba zaverecne obrazovky'),
    ('endTuneList',    0x870F, '21 .. ..', 'seznam ukazatelu na dily zaverecne hudby'),
    # --- prerusovaci sloty ($9C81 a $9C9B), disasm_notes.md §13.2
    ('slot1Value',     0x9C81, '3E ..',    'slot 1: hodnota (LD A,n), prepisuje se pri spusteni'),
    ('slot1Step',      0x9C86, 'C6 ..',    'slot 1: prirustek po snimku (ADD A,n), prepisuje se'),
    ('slot1Cycles',    0x9C8C, '0E ..',    'slot 1: kolik pulvln za snimek (LD C,n)'),
    ('slot1Mask',      0x9C92, 'EE ..',    'slot 1: maska prepinace (XOR n)'),
    ('slot2Cycles',    0x9CA2, '06 ..',    'slot 2: kolik OUT za snimek (LD B,n)'),
    ('slot2Value',     0x9CA4, '0E ..',    'slot 2: hodnota (LD C,n), prepisuje se pri spusteni'),
    ('slot2Mask',      0x9CAB, 'EE ..',    'slot 2: maska prepinace (XOR n)'),
    # --- vestavene efekty
    ('fanfareStart',   0x83BB, '06 ..',    'dopadeny mugger: pocatecni delitel (LD B,n)'),
    ('fanfareMask',    0x83C1, 'EE ..',    'dopadeny mugger: maska prepinace'),
    ('modeCount',      0xA2E6, '06 ..',    'prepnuti clovek/krtek: kolik pulvln'),
    ('modeDelay',      0xA2E8, '0E ..',    'prepnuti clovek/krtek: delitel'),
    ('modeMask',       0xA2ED, 'EE ..',    'prepnuti clovek/krtek: maska prepinace'),
    ('teleportUnit',   0x8417, '3E ..',    'teleport: delka noty po dobu efektu'),
    ('teleportUnitEnd', 0x8430, '3E ..',   'teleport: delka noty zpatky po efektu'),
    ('teleportStart',  0x841E, '3E ..',    'teleport: pocatecni perioda (LD A,n), snizuje se o 1'),
    ('noiseMask',      0xA6FD, 'E6 ..',    'sum typu 3: maska bitu z registru R (AND n)'),
    # --- digitalizovana rec ($E200), disasm_notes.md §13.4
    ('speechData',     0xE210, '21 .. ..', 'vzorek reci (LD HL,nn)'),
    ('speechBytes',    0xE213, '11 .. ..', 'delka vzorku v bajtech (LD DE,nn)'),
    ('speechBits',     0xE216, '06 ..',    'bitu v bajtu (LD B,n)'),
    ('speechDelay',    0xE218, '0E ..',    'delitel vzorkovaci frekvence (LD C,n)'),
    ('speechOn',       0xE21D, '3E ..',    'hodnota portu pro bit 1 (LD A,n)'),
    ('speechOff',      0xE229, 'E6 ..',    'maska pro bit 0 (AND n)'),
]

# Kde hra zvuk spouští: (jméno, adresa instrukce, vzor, slot, co to je).
# Slot 1 i 2 jsou bajty, které si volající přepíše; efekt pak dohraje přerušení.
TRIGGERS = [
    ('alchiem',   0x830E, '3E ..', 1, 'sebrany alchiem ($8305)'),
    ('kill',      0xA657, '3E ..', 1, 'zabita entita ($A64F)'),
    ('steal',     0xA7C3, '3E ..', 1, 'mugger ukradl alchiem ($A771)'),
    ('monolith',  0xA840, '3E ..', 1, 'monolit odnasi Charlieho ($A838)'),
]

# Zvuky, které si hodnotu neberou z konstanty, ale z herního stavu.
# Do dat jde adresa a co tam hra dává – hodnotu dodá worker za běhu.
LIVE_TRIGGERS = {
    'stick':  {'at': '$7F3C', 'slot': 2,
               'what': 'polozeny gravity stick: vyska tonu je jeho pocitadlo (IX+$0B) zaznamu $FDA0'},
    'dig':    {'at': '$9BFD', 'slot': 2,
               'what': 'krtek zere stenu: vyska tonu je registr R, tedy sum ($9BB9, nalez M4)'},
    'death':  {'at': '$8503', 'slot': 2,
               'what': 'animace smrti: vyska tonu je odpocet $8552'},
    'endNoise': {'at': '$A860', 'slot': 2,
                 'what': 'zaverecny odlet: vyska tonu je registr R, tedy sum'},
    'monster3': {'at': '$A73D', 'slot': 2,
                 'what': 'nepritel typu 3: vyska tonu je jeho y, a jen prvni takovy v mistnosti ($AAE6)'},
    'monster3Click': {'at': '$A6FB', 'slot': None,
                      'what': 'nepritel typu 3 navic klepne primo v hlavni smycce: '
                              'LD A,R / AND $18 / OUT ($FE),A, tedy sum z registru R'},
}


def word(image, addr):
    return image[addr - 0x4000] | (image[addr - 0x4000 + 1] << 8)


def bytes_at(image, addr, count):
    return list(image[addr - 0x4000:addr - 0x4000 + count])


# ---------------------------------------------------------------- casy smycek
def fit_linear(samples, name):
    """Proloží `pulz = k*parametr + q` a **trvá na přesné shodě** ve všech bodech."""
    (p0, t0), (p1, t1) = samples[0], samples[1]
    if p0 == p1:
        raise SystemExit('%s: dva stejne parametry, nelze prolozit' % name)
    if (t1 - t0) % (p1 - p0):
        raise SystemExit('%s: delky pulzu nejsou linearni v parametru' % name)
    k = (t1 - t0) // (p1 - p0)
    q = t0 - k * p0
    for p, t in samples:
        if k * p + q != t:
            raise SystemExit('%s: model %d*%d%+d = %d, zmereno %d'
                             % (name, k, p, q, k * p + q, t))
    return k, q


def measure_fixed_loop(beeper, address, params, make_poke, name):
    """Změří smyčku s pevnou periodou: všechny pulzy musí být stejně dlouhé."""
    samples = []
    for value in params:
        pulses, _ = beeper.pulses(address, None, make_poke(value))
        if not pulses:
            raise SystemExit('%s: parametr %d nedal zadny pulz' % (name, value))
        if len(set(pulses)) != 1:
            raise SystemExit('%s: parametr %d dal ruzne dlouhe pulzy %s'
                             % (name, value, sorted(set(pulses))[:5]))
        samples.append((value, pulses[0]))
    return fit_linear(samples, name)


def tone_loop(periods, note, unit, base, reload_b, reload_c):
    """Průchod tónovou smyčkou `$876E` tak, jak ho dělá Z80.

    Vrací `(casy prepnuti reproduktoru, cely cas smycky)` v T-stavech. Dva
    čítače (B s periodou `perioda`, C s periodou `perioda-1`) přepínají tentýž
    bit, takže se tón **rozeznívá sám do sebe** – proto se nedá popsat jednou
    frekvencí a proto se počítá průchod po průchodu.
    """
    period = periods[note & 0x3F]
    count = ((note & 0xC0) >> 6) + 1
    iterations = ((unit * count) & 0xFF) * 256 + 0xFF
    b, c = period, (period - 1) & 0xFF
    time, toggles = 0, []
    for _ in range(iterations):
        step, flip = base, 0
        b = (b - 1) & 0xFF
        if b == 0:
            step += reload_b
            b = period
            flip ^= 1
        c = (c - 1) & 0xFF
        if c == 0:
            step += reload_c
            c = (period - 1) & 0xFF
            flip ^= 1
        time += step
        if flip and period:
            toggles.append(time)
    return toggles, time


def measure_tone_loop(beeper, periods, duration_unit):
    """Zjistí tři ceny průchodu tónovou smyčkou a **ověří je na všech tónech**.

    Ceny se nehádají z tabulky časů instrukcí: hledají se tak, aby model
    odklepal přesně ty pulzy, které v simulátoru odklepal originál. Pak se
    ověří na **48 tónech × 4 délkách**; kdyby model nesedl, nástroj skončí
    chybou.
    """
    probes = [0x01, 0x18, 0x2F]
    measured = {n: beeper.pulses(soundlib.TONE, {A: n})[0] for n in probes}

    def deltas(note, base, rb, rc):
        toggles, _ = tone_loop(periods, note, duration_unit, base, rb, rc)
        return [y - x for x, y in zip(toggles, toggles[1:])]

    for base in range(60, 120):
        for reload_b in range(0, 24):
            for reload_c in range(0, 24):
                if all(deltas(n, base, reload_b, reload_c) == measured[n] for n in probes):
                    return base, reload_b, reload_c
    raise SystemExit('tonova smycka: nepodarilo se najit ceny pruchodu')


def measure_tone_overheads(beeper, model_time, model_toggles, unit):
    """Změří, co tónová rutina stojí **mimo** vlastní smyčku.

    Bez toho by melodie ujížděla: mezi notami je krátká pauza (rozehnání
    rutiny, čtení klávesnice v přehrávači) a ta se musí do vlny dostat taky.
    Nic se nepočítá z tabulky časů instrukcí – všechno se měří.
    """
    def probe(note):
        times, total = beeper.run(soundlib.TONE, {A: note})
        return times, total

    # náběh: o kolik je první přepnutí později, než ho čeká model smyčky
    times, total = probe(0x01)
    prologue = times[0] - model_toggles(0x01, unit)[0]
    times4, total4 = probe(0xC1)
    prologue_unit = (times4[0] - model_toggles(0xC1, unit)[0] - prologue) // 3
    overhead_note = total - model_time(0x01, unit)
    _, total_rest = probe(0x00)
    overhead_rest = total_rest - model_time(0x00, unit)
    if total4 - model_time(0xC1, unit) != overhead_note + 3 * prologue_unit:
        raise SystemExit('ton: rezie nesedi na delku noty')
    return {'prologue': prologue, 'prologueUnit': prologue_unit,
            'overheadNote': overhead_note, 'overheadRest': overhead_rest,
            'what': 'rezie rutiny $873C mimo smycku: naběh k prvnimu pulzu '
                    'a cely pruchod bez smycky (o jednotku delky navic '
                    'prologueUnit)'}


def measure_tune_overhead(beeper, routine_time, unit):
    """Změří, co stojí přehrávač melodie `$8726` na jednu notu a na vstup.

    Poskládá se pár krátkých melodií do volného místa v paměti a proloží se
    `celkem = pocet*naNotu + vstup`; nástroj **trvá na přesné shodě**.
    """
    from skoolkit.simutils import H, L
    addr = 0x5B40                       # volné místo mezi proměnnými hry
    note = 0x2F
    samples = []
    for count in (1, 2, 3, 4):
        poke = {addr: count}
        for i in range(count):
            poke[addr + 1 + i] = note
        _, total = beeper.run(0x8726, {H: addr >> 8, L: addr & 0xFF}, poke)
        samples.append((count, total - count * routine_time(note, unit)))
    per_note, entry = fit_linear(samples, 'tuneOverhead')
    return {'perNote': per_note, 'entry': entry,
            'what': 'rezie prehravace $8726: na notu a na vstup do rutiny'}


def read_tune(image, addr):
    count = image[addr - 0x4000]
    return {'address': addr, 'count': count,
            'notes': bytes_at(image, addr + 1, count),
            'end': addr + 1 + count}


def collect(image, constants):
    """Tabulka period a melodie; vrací i bajty, které se nepodařilo přiřadit."""
    base = constants['noteTable']
    lists = {}
    for key, count_key in (('title', 'titleTuneCount'), ('end', 'endTuneCount')):
        addr = constants[key + 'TuneList']
        parts = [word(image, addr + 2 * i) for i in range(constants[count_key])]
        lists[key] = {'address': addr, 'parts': parts}

    tunes, used = {}, set()
    for spec in lists.values():
        for part in spec['parts']:
            if part in tunes:
                continue
            tunes[part] = read_tune(image, part)
    for tune in tunes.values():
        used.update(range(tune['address'], tune['end']))

    # tabulka period končí tam, kde začíná první melodie
    first = min(tunes) if tunes else SCENERY_TABLE
    periods = bytes_at(image, base, first - base)
    used.update(range(base, first))
    # ukazatele na melodie leží těsně před tabulkou period
    for spec in lists.values():
        used.update(range(spec['address'], spec['address'] + 2 * len(spec['parts'])))

    span = range(min(min(s['address'] for s in lists.values()), base), SCENERY_TABLE)
    unreachable = [addr for addr in span if addr not in used]
    return periods, lists, tunes, unreachable


# ---------------------------------------------------------------- hlavni beh
def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--show', action='store_true', help='vypsat, co se naslo')
    args = parser.parse_args()

    image = read_image()
    constants, notes = {}, {}
    for name, addr, pattern, what in CONSTANTS:
        value, width = operand(image, addr, pattern, name)
        constants[name] = value
        notes[name] = {'at': '$%04X' % addr, 'instruction': pattern, 'what': what,
                       'value': '$%0*X' % (2 * width, value)}
    for name, addr, pattern, slot, what in TRIGGERS:
        value, width = operand(image, addr, pattern, name)
        constants['trigger_' + name] = value
        notes['trigger_' + name] = {'at': '$%04X' % addr, 'instruction': pattern,
                                    'what': what, 'value': '$%02X' % value}

    periods, lists, tunes, unreachable = collect(image, constants)

    beeper = soundlib.Beeper()
    # pevné smyčky: délka pulzu je lineární v parametru (změřeno, ne spočítáno)
    mode_k, mode_q = measure_fixed_loop(
        beeper, soundlib.MODE_BEEP, [0x0A, 0x1E, 0x40],
        lambda v: {0xA2E9: v}, 'modeBeep')
    # slot 1 se měří s nulovým přírůstkem, aby dělitelem byla přímo hodnota
    slot1_k, slot1_q = measure_fixed_loop(
        beeper, soundlib.SLOT1, [0x08, 0x20, 0x60],
        lambda v: {soundlib.VAR_SLOT1_VALUE: v, soundlib.VAR_SLOT1_STEP: 0}, 'slot1')
    slot2_k, slot2_q = measure_fixed_loop(
        beeper, soundlib.SLOT2, [0x08, 0x20, 0x60],
        lambda v: {soundlib.VAR_SLOT2_VALUE: v}, 'slot2')
    # fanfára je táž smyčka jako přepnutí režimu, jen se dělitel po každé půlvlně snižuje
    fanfare = beeper.pulses(soundlib.FANFARE)[0]
    expected = [mode_k * b + mode_q for b in range(constants['fanfareStart'] - 1, 0, -1)]
    if fanfare != expected:
        raise SystemExit('fanfara nesedi na model pevne smycky')

    unit = constants['durationUnit']
    base, reload_b, reload_c = measure_tone_loop(beeper, periods, unit)

    def model_toggles(note, unit_value):
        return tone_loop(periods, note, unit_value, base, reload_b, reload_c)[0]

    def model_time(note, unit_value):
        return tone_loop(periods, note, unit_value, base, reload_b, reload_c)[1]

    # ověření modelu tónu na všech 48 tónech a všech čtyřech délkách
    checked = 0
    for length in range(4):
        for index in range(len(periods)):
            note = (length << 6) | index
            toggles = model_toggles(note, unit)
            want = [y - x for x, y in zip(toggles, toggles[1:])]
            if want != beeper.pulses(soundlib.TONE, {A: note})[0]:
                raise SystemExit('tonovy model nesedi na notu $%02X' % note)
            checked += 1

    tone_overheads = measure_tone_overheads(beeper, model_time, model_toggles, unit)
    def routine_time(note, unit_value):
        count = ((note & 0xC0) >> 6) + 1
        base_cost = (tone_overheads['overheadRest'] if not periods[note & 0x3F]
                     else tone_overheads['overheadNote'])
        return (model_time(note, unit_value) + base_cost
                + tone_overheads['prologueUnit'] * (count - 1))

    tune_overhead = measure_tune_overhead(beeper, routine_time, unit)

    # ★ přejímací kontrola melodie: celá závěrečná melodie ($627A) musí modelu
    # sednout na T-stav, jinak by hudba remaku ujížděla proti originálu
    end_tune = read_tune(image, constants['endTuneList'] and
                         word(image, constants['endTuneList']))
    want = tune_overhead['entry'] + sum(routine_time(n, unit) + tune_overhead['perNote']
                                        for n in end_tune['notes'])
    _, measured_total = beeper.run(0x8726, {0x06: end_tune['address'] >> 8,
                                            0x07: end_tune['address'] & 0xFF})
    if want != measured_total:
        raise SystemExit('melodie $%04X: model %d T, original %d T'
                         % (end_tune['address'], want, measured_total))

    speech = bytes_at(image, constants['speechData'], constants['speechBytes'])
    # perioda jednoho bitu vzorku: změřená, ne spočítaná
    bit_period, byte_extra = measure_speech_period(beeper, constants)

    data = {
        'note': ('Zvuk 48K edice vytazeny z originalu: konstanty jsou operandy '
                 'skutecnych instrukci, tabulka period a melodie jsou bajty '
                 'originalu a casy smycek jsou zmerene v simulatoru. '
                 'Viz sources/docs/disasm_notes.md par. 13.'),
        'constants': constants,
        'constantNotes': notes,
        'periods': {'address': constants['noteTable'], 'count': len(periods),
                    'values': periods},
        'tuneLists': lists,
        'tunes': {'$%04X' % addr: tune for addr, tune in sorted(tunes.items())},
        'timing': {
            'tone': {'base': base, 'reloadB': reload_b, 'reloadC': reload_c,
                     'what': 'cena pruchodu smyckou $876E v T-stavech: zaklad a priplatek '
                             'za pretoceni citace B nebo C'},
            'toneOverhead': tone_overheads,
            'tuneOverhead': tune_overhead,
            'fixed': {'slope': mode_k, 'offset': mode_q,
                      'what': 'pulvlna smycek $A2E5 a $83BA: delitel*slope + offset'},
            'slot1': {'slope': slot1_k, 'offset': slot1_q},
            'slot2': {'slope': slot2_k, 'offset': slot2_q},
            'speechBit': bit_period,
            'speechByteExtra': byte_extra,
            'clock': 3500000,
            'frame': 69888,
            'frameWhat': 'T-statu na snimek ULA (50,08 Hz) - v tomhle taktu bezi oba prerusovaci sloty; konstanta stroje, ZADANI.md par. 1',
        },
        'liveTriggers': LIVE_TRIGGERS,
        'speech': {'address': constants['speechData'], 'bytes': speech,
                   'bits': len(speech) * 8, 'bitPeriod': bit_period,
                   'byteExtra': byte_extra,
                   'sampleRate': 3500000.0 / bit_period,
                   'what': ('digitalizovana rec, kterou hraje vstupni rutina $E200 '
                            'pri startu; 1 bit na vzorek')},
        'unreachable': ['$%04X' % a for a in unreachable],
    }

    with open(OUT, 'w') as handle:
        json.dump(data, handle, indent=1)
        handle.write('\n')

    print('%s: %d konstant, %d tonu, %d melodii, %d B reci (%.0f Hz, %.2f s)'
          % (os.path.relpath(OUT), len(constants), len(periods), len(tunes),
             len(speech), data['speech']['sampleRate'],
             (len(speech) * 8 * bit_period + len(speech) * byte_extra) / 3500000.0))
    print('tonova smycka: pruchod %d T, pretoceni B +%d T, C +%d T (%d tonu overeno)'
          % (base, reload_b, reload_c, checked))
    print('nedosazitelne bajty bloku $%04X-$%04X: %d'
          % (constants['titleTuneList'], SCENERY_TABLE - 1, len(unreachable)))

    if args.show:
        show(data)


def measure_speech_period(beeper, constants):
    """Perioda jednoho bitu vzorku řeči – změřená, ne spočítaná z tabulky časů.

    Pustí se pár bajtů `$AA` (střídavé bity od jedničky), takže se reproduktor přepne
    **na každém bitu**: v naměřených rozestupech je pak vidět jak perioda bitu,
    tak příplatek za přechod na další bajt. Nástroj trvá na tom, že jsou v běhu
    jen tyhle dvě hodnoty a že leží tam, kde mají.
    """
    count = 4
    poke = {0xE214: count, 0xE215: 0x00}
    for i in range(count):
        poke[constants['speechData'] + i] = 0xAA
    # Rutina nekončí `RET`, ale skokem do hry, takže se zastavuje na tom skoku.
    times, _ = beeper.run(0xE210, None, poke, 4000000, stop=0xE23B)
    steps = [b - a for a, b in zip(times, times[1:])]
    if len(steps) != count * 8 - 1:
        raise SystemExit('rec: cekalo se %d prepnuti, zmereno %d'
                         % (count * 8, len(times)))
    period = min(steps)
    extra = max(steps) - period
    for index, step in enumerate(steps):
        # přechod na další bajt je po každé osmé půlvlně
        want = period + (extra if (index + 1) % 8 == 0 else 0)
        if step != want:
            raise SystemExit('rec: bit %d ma %d T, ceka se %d' % (index, step, want))
    return period, extra


def show(data):
    periods = data['periods']['values']
    print('\ntabulka period $%04X (%d):' % (data['periods']['address'], len(periods)))
    for row in range(0, len(periods), 12):
        print('  %02d: %s' % (row, ' '.join('%02X' % p for p in periods[row:row + 12])))
    print('\nmelodie:')
    for key, spec in data['tuneLists'].items():
        print('  %-6s seznam $%04X: %s' % (key, spec['address'],
                                           ' '.join('$%04X' % p for p in spec['parts'])))
    for key, tune in data['tunes'].items():
        print('  %s %3d not' % (key, tune['count']))
    print('\nspousteni:')
    for name, note in sorted(data['constantNotes'].items()):
        if name.startswith('trigger_'):
            print('  %-16s %s  %s = %s' % (name[8:], note['at'], note['instruction'],
                                           note['value']))
    for name, spec in sorted(data['liveTriggers'].items()):
        print('  %-16s %s  slot %s: %s' % (name, spec['at'], spec['slot'], spec['what']))


if __name__ == '__main__':
    main()
