#!/usr/bin/env python3
"""Vytáhne z originálu **nepřátele, alchiemy, muggery a pravidla** do `data/monsters.json`.

    PYTHONPATH=tools/vendor ./tools/dumpmonsters.py [--show]

Táž disciplína jako `dumpphysics.py` (M3) a `dumpmole.py` (M4):

* **konstanty jsou operandy skutečných instrukcí.** U každé se ověřuje, že na té
  adrese ta instrukce opravdu stojí; když ne, nástroj skončí chybou.
* **seznamy rámců a skripty jsou bajty originálu**, ne přepsané tabulky.
* co se **nedá reprodukovat** (`LD A,R`), se sem nedostane vůbec – zůstane jako
  vstup remaku a `report()` to hlásí.

Dvě věci se v M5 čtou jinak, než čekala M0:

* ★★ Tabulka od `$AAED` má **94 záznamů po 8 bajtech** (`$AAED–$ADDC`), ne 80.
  M0 viděla `BIT 7,(IY+$07)` a vzala adresu **pole**, ne záznamu – proto jí
  vyšlo `$AAF4` a o sedm bajtů posunutá mřížka. Tohle jsou **poletující objekty**
  (whirlwindy a spol.), každý s vlastním bajtkódem a vlastní místností.
* ★★ **Rozmístění nepřátel po světě žádná tabulka není.** Nepřátelé se
  v podzemních místnostech **losují za běhu** (`$A5E0`, šance 1/64 na průchod)
  a pamatují se jen pro **posledních pět** navštívených místností (`$5B34`,
  5 × 10 B, LRU). Nadzemní místnosti (`< $10`) nepřátele nemají.

Rozbor je v `sources/docs/disasm_notes.md` §12.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

IMAGE = os.path.join(HERE, '..', 'build', 'nodesofyesod-48k.bin')
OUT   = os.path.join(HERE, '..', 'data', 'monsters.json')

# ---------------------------------------------------------------- konstanty
# (jméno, adresa, bajty instrukce s '..' místo operandu, k čemu je)
CONSTANTS = [
    # --- naplnění místnosti nepřáteli ($A360) a jejich uložení při odchodu ($A2F4)
    ('monsterSlotFirst',  0xA360, 'DD 21 .. ..', 'prvni zaznam nepritele (LD IX,nn)'),
    ('monstersPerRoom',   0xA376, '06 ..',       'kolik nepratel ma mistnost (LD B,n)'),
    ('entityStride',      0xA39D, '01 .. ..',    'krok tabulky entit (LD BC,nn)'),
    ('roomCacheTable',    0xA367, '21 .. ..',    'pamet poslednich mistnosti (LD HL,nn)'),
    ('roomCacheStride',   0xA364, '11 .. ..',    'delka zaznamu pameti (LD DE,nn)'),
    ('roomCacheCount',    0xA36A, '06 ..',       'kolik mistnosti si hra pamatuje (LD B,n)'),
    ('roomCacheShift',    0xA310, '0E ..',       'kolik bajtu se pri vytesneni posune (LD C,n)'),
    ('muggedFlag',        0xA3A8, '32 .. ..',    'v teto navsteve uz mugger kradl (LD (nn),A)'),
    ('liveCountVar',      0xA3AB, '21 .. ..',    'kolik nepratel v mistnosti zbyva (LD HL,nn)'),
    ('liveCountInit',     0xA3AE, '36 ..',       'na kolik se to nastavi (LD (HL),n)'),
    ('spawnCounter',      0xA395, 'DD 36 0B ..', 'pocitadlo skriptu pri naplneni mistnosti'),
    ('spawnScriptSkip',   0xA392, '01 .. ..',    'o kolik se preskoci uvodni animace (LD BC,nn)'),
    ('respawnScriptSkip', 0xA475, '01 .. ..',    'totez pri losovani za behu: nepreskoci se nic'),
    # --- dispečer typů ($A3B1): každý typ ma ctyrbajtovy popis
    ('typeDescriptor1',   0xA3B8, '21 .. ..',    'popis typu 1 (LD HL,nn)'),
    ('typeDescriptor2',   0xA3D1, '21 .. ..',    'popis typu 2'),
    ('typeDescriptor3',   0xA3DA, '21 .. ..',    'popis typu 3'),
    ('typeDescriptor4',   0xA3E3, '21 .. ..',    'popis typu 4'),
    ('typeDescriptor5',   0xA3EC, '21 .. ..',    'popis typu 5'),
    ('typeDescriptor6',   0xA414, '21 .. ..',    'popis typu 6 (mugger); skript se domodifikuje'),
    ('muggerScriptSlot',  0xA40E, '22 .. ..',    'kam se skript muggera zapise (LD (nn),HL)'),
    ('muggerSpawnRight',  0xA402, '21 .. ..',    'mugger se objevi vpravo od Charlieho'),
    ('muggerSpawnLeft',   0xA409, '21 .. ..',    'totez vlevo'),
    ('type1ForceY',       0xA3C6, 'DD 36 02 ..', 'typ 1 ma y vzdy tuhle hodnotu'),
    ('entityFlagsInit',   0xA431, 'DD 36 00 ..', 'priznaky ziveho nepritele: vidno + kolize'),
    # --- losování nepřítele za běhu ($A436)
    ('randomYMask',       0xA43D, 'E6 ..',       'y = (R AND n) + zaklad'),
    ('randomYBase',       0xA43F, 'C6 ..',       'zaklad y (ADD A,n)'),
    ('randomXBase',       0xA446, 'C6 ..',       'x = R + n (ADD A,n)'),
    ('teleportRoomTable', 0xA44B, '21 .. ..',    'mistnosti, kde je vzdy typ 5 (LD HL,nn)'),
    ('teleportRoomCount', 0xA44E, '06 ..',       'kolik jich je (LD B,n)'),
    ('teleportType',      0xA455, '3E ..',       'typ, ktery se v nich losuje (LD A,n)'),
    ('spawnChanceMask',   0xA5E6, 'E6 ..',       'sance na objeveni: (R XOR seed) AND n == 0'),
    # --- hlavní smyčka nepřátel ($A5B2)
    ('surfaceMaxRoom',    0xA5B9, 'FE ..',       'mistnosti pod timhle cislem = povrch, bez nepratel'),
    ('monolithRoomVar',   0xA5BF, '3A .. ..',    'mistnost monolitu; ani v ni nepratele nejsou'),
    ('appearFrameLo',     0xA620, 'FE ..',       'ramce uvodni/zaverecne animace: od (CP n)'),
    ('appearFrameHi',     0xA624, 'FE ..',       'po (CP n) - v nich nepritel nezabiji'),
    ('hitEnergyVar',      0xA64D, '21 .. ..',    'energie; dotek nepritele ji snizi o 1'),
    ('specialVar',        0xA64A, '32 .. ..',    'typ, ktery ma zvlastni ucinek (LD (nn),A)'),
    ('specialTypeA',      0xA646, 'FE ..',       'prvni takovy typ'),
    ('specialTypeB',      0xA642, 'FE ..',       'druhy takovy typ'),
    ('deathSound',        0xA657, '3E ..',       'zvuk zabiti (LD A,n)'),
    ('deathScriptLo',     0xA661, 'DD 36 09 ..', 'seznam ramcu mizeni (dolni bajt)'),
    ('deathScriptHi',     0xA665, 'DD 36 0A ..', 'totez horni bajt'),
    ('boundsMaxY',        0xA813, 'FE ..',       'y >= n: posun se zahodi (CP n)'),
    # --- gravity stick z pohledu nepřátel ($A628)
    ('stickVar',          0xA628, '2A .. ..',    'dokud je nenulove, gravity stick pusobi'),
    ('stickPullOffset',   0xA632, 'C6 ..',       'y + n se porovna s mezi (ADD A,n)'),
    ('stickPullY',        0xA634, 'FE ..',       'pod touhle mezi stick nepritele zabije (CP n)'),
    ('stickFallMask',     0xA6BE, '16 ..',       'smer, kterym stick nepratele tahne (LD D,n)'),
    # --- chování jednotlivých typů
    ('type1BorderMask',   0xA6FD, 'E6 ..',       'typ 1 blika okrajem: OUT ($FE), R AND n'),
    ('type1TurnMask',     0xA703, 'E6 ..',       'typ 1 meni smer, kdyz (R AND n) == 0'),
    ('type2TurnMask',     0xA71E, 'E6 ..',       'typ 2 se otoci za Charliem, kdyz (R AND n) == 0'),
    ('type3SoundVar',     0xA731, '21 .. ..',    'typ 3 pise svoje y do vysky tonu (LD HL,nn)'),
    ('type3SoundSeen',    0xA734, '3A .. ..',    'a jen prvni takovy v mistnosti (LD A,(nn))'),
    ('type3MaxY',         0xA741, 'FE ..',       'typ 3 se drzi nad touhle mezi (CP n)'),
    ('type3ClampY',       0xA745, 'DD 36 02 ..', 'a kdyz ji prekroci, vrati se sem'),
    ('muggerWalkRight',   0xA7E6, '21 .. ..',    'skript chuze muggera vpravo (LD HL,nn)'),
    ('muggerWalkLeft',    0xA7EB, '21 .. ..',    'totez vlevo'),
    # --- mugger krade alchiem ($A771)
    ('alchiemMaskVar',    0xA77E, '3A .. ..',    'bitova maska osmi drzenych alchiemu'),
    ('alchiemListVar',    0xA786, '2A .. ..',    'jejich dvoubitova cisla (8 x 2 bity)'),
    ('roomStateBase',     0xA7A0, '21 .. ..',    'perzistentni stav mistnosti (M2)'),
    ('hideMask',          0xA7AC, 'E6 ..',       'kam ukradeny alchiem smi: (stav AND n)'),
    ('hideValue',         0xA7AE, 'FE ..',       '... se musi rovnat n (CP n)'),
    ('hideClearMask',     0xA7B6, 'E6 ..',       'co se ve stavu mistnosti smaze (AND n)'),
    ('hideSetBit',        0xA7B8, 'F6 ..',       'a co nastavi: "je tu alchiem" (OR n)'),
    ('stealSound',        0xA7C3, '3E ..',       'zvuk kradeze (LD A,n)'),
    # --- kam se alchiem nebo mugger v místnosti položí ($88B5, kreslení místnosti)
    ('itemMuggerFrame',   0x88BA, '3E ..',       'ramec muggera v mistnosti (LD A,n)'),
    ('itemAlchiemFrame',  0x88CA, 'C6 ..',       'ramec alchiemu = n + jeho cislo'),
    ('itemPosTable',      0x88D7, '11 .. ..',    'tabulka poloh, bajt na "zvlastni" mistnost'),
    ('itemStateBase',     0x88DB, '21 .. ..',    'podle ceho se v ni indexuje (LD HL,nn)'),
    ('itemCounterInit',   0x88F4, '21 .. ..',    'pocitadlo a perioda polozene veci (LD HL,nn)'),
    # --- sebrání alchiemu / dopadení muggera ($82D0)
    ('pickupSlot',        0x82F1, 'DD 21 .. ..', 'zaznam entity, ve kterem lezi alchiem/mugger'),
    ('pickupMask',        0x82DE, 'E6 ..',       'je v mistnosti co brat? (stav AND n)'),
    ('pickupBox',         0x83CD, '11 .. ..',    'obalka doteku: D = dx, E = dy (LD DE,nn)'),
    ('debounceVar',       0x82FB, '21 .. ..',    'bit 4: alchiem uz se v tomhle doteku sebral'),
    ('alchiemSound',      0x830E, '3E ..',       'zvuk sebrani (LD A,n)'),
    ('alchiemFrameBase',  0x8351, 'C6 ..',       'ramec alchiemu = n + jeho dvoubitove cislo'),
    ('alchiemSlots',      0x8362, '06 ..',       'kolik alchiemu se najednou unese (LD B,n)'),
    ('panelAlchiemCell',  0x835B, '11 .. ..',    'prvni bunka radky alchiemu v panelu'),
    # --- dopadení muggera ($8381): zivot, plna energie, gravity sticky
    ('livesVar',          0x8386, '3A .. ..',    'pocet zivotu'),
    ('maxLives',          0x8389, 'FE ..',       'vic jich uz nepribude (CP n)'),
    ('energyFull',        0x8391, '3E ..',       'plna energie (LD A,n)'),
    ('stickCountVar',     0x839D, '3A .. ..',    'bity 0-2 = kolik gravity sticku hrac ma'),
    ('stickCountMask',    0x83A0, 'E6 ..',       'zbytek bajtu zustane (AND n)'),
    ('stickCountGiven',   0x83A2, 'F6 ..',       'kolik jich dopadeni muggera da (OR n)'),
    ('muggerMoveMask',    0x83B0, 'E6 ..',       'kam mugger utece: (stav AND n)'),
    ('muggerMoveValue',   0x83B2, 'EE ..',       '... musi byt n (XOR n; nula = shoda)'),
    # --- gravity stick ($7DF1)
    ('stickSlot',         0x81FB, 'DD 21 .. ..', 'zaznam entity gravity sticku'),
    ('stickInput',        0x7E00, 'FE ..',       'vstupni bajt, kterym se stick poklada (CP n)'),
    ('stickHaveMask',     0x7E0C, 'E6 ..',       'kolik jich zbyva (AND n)'),
    ('stickLife',         0x7E11, '21 .. ..',    'jak dlouho stick pusobi, v pruchodech'),
    ('stickFlags',        0x7E17, 'DD 36 00 ..', 'priznaky polozeneho sticku'),
    ('stickFrame',        0x7E1B, '3E ..',       'jeho ramec (LD A,n)'),
    ('stickDy',           0x7E23, 'C6 ..',       'lezi o n px pod Charliem (ADD A,n)'),
    ('stickDx',           0x7E2B, 'C6 ..',       'a o n px vpravo (ADD A,n)'),
    # --- poletující objekty ($AAED) a jejich dotek s Charliem
    ('objectTable',       0xA491, 'FD 21 .. ..', 'tabulka objektu (LD IY,nn)'),
    ('objectCount',       0xA495, '06 ..',       'kolik jich je (LD B,n)'),
    ('objectStride',      0xA4D2, '11 .. ..',    'delka zaznamu (LD DE,nn)'),
    ('objectFlagBuffer',  0xA497, '21 .. ..',    'bajt na objekt: bit 7 = ma se hybat'),
    ('objectIndexVar',    0xA4D7, '32 .. ..',    'index prave kresleneho objektu'),
    ('objectSlotFirst',   0xA4BD, 'DD 21 .. ..', 'prvni zaznam entity pro objekty'),
    ('objectSlots',       0xA4BB, '06 ..',       'kolik jich muze byt videt najednou (LD B,n)'),
    ('objectNeighbours',  0xAA2A, '21 .. ..',    'mistnost a jejich ctyri sousedky (LD HL,nn)'),
    ('safeFrameLo',       0xA56C, 'FE ..',       'ramce, ktere nezabiji (alchiem): od (CP n)'),
    ('safeFrameHi',       0xA568, 'FE ..',       'po (CP n)'),
    ('objectHurtVar',     0xA584, '21 .. ..',    'dotek objektu snizi energii o dve (LD HL,nn)'),
    ('objectHitFlag',     0xA570, '21 .. ..',    'a nastavi Charliemu bit 3 (LD HL,nn)'),
    ('throwDirFlag',      0xA575, '21 .. ..',    'kterym smerem ho to odhodi (LD HL,nn)'),
    # --- whirlwind: co ten bit nastavi ($7FE8)
    ('whirlFlagVar',      0x7FF0, '21 .. ..',    'globalni priznak whirlwindu (LD HL,nn)'),
    ('whirlClearSpecial', 0x8000, '32 .. ..',    'whirlwind zrusi zvlastni ucinek (LD (nn),A)'),
    # --- energie a odhození ($7F90, $80A1)
    ('energyVar',         0x7F98, '32 .. ..',    'energie (LD (nn),A)'),
    ('energyRespawn',     0x7F96, '3E ..',       'na kolik se po smrti vrati (LD A,n)'),
    ('fallCounterVar',    0x80BC, '32 .. ..',    'pocitadlo padu; odhozeni ho vynuluje = smrt'),
    ('throwStep',         0x80BF, '21 .. ..',    'krok padu pri odhozeni (LD HL,nn)'),
    # --- zvláštní účinky typů 4 a 5
    ('effectStunEntry',   0x7FDD, 'CC .. ..',    'typ 4: Charlie se zamota (CALL nn)'),
    ('effectTeleEntry',   0x7FE5, 'CA .. ..',    'typ 5: teleport (JP Z,nn)'),
    ('stunFlagVar',       0x847C, '21 .. ..',    'priznak zamotani (LD HL,nn)'),
    ('stunWalkFrames',    0x849C, 'FE ..',       'zamotat jde jen pri chuzi: ramec < n'),
    ('stunFallFrame',     0x84B1, 'C6 ..',       'ramec kotoulu (ADD A,n)'),
    ('stunSideStep',      0x84B6, '11 .. ..',    'zkouska bocnich sten (LD DE,nn)'),
    ('stunDownStep',      0x84BC, '11 .. ..',    'a posun dolu'),
    ('stunTicks',         0x84C5, '3E ..',       'jak dlouho zamotani trva (LD A,n)'),
    ('stunUpStep',        0x8516, '11 .. ..',    'na konci se Charlie vrati nahoru (LD DE,nn)'),
    ('teleportX',         0x8439, 'DD 36 01 ..', 'kam teleport Charlieho polozi: x'),
    ('teleportY',         0x843D, 'DD 36 02 ..', 'a y'),
    ('teleportStep',      0x8448, '11 .. ..',    'a kterym smerem pak prejde (LD DE,nn)'),
    # --- rozehrání nové hry ($8553): co se losuje
    ('roomStateKeep',     0x855D, 'E6 ..',       'ze stavu mistnosti prezije jen (AND n)'),
    ('alchiemsPlaced',    0x8563, '06 ..',       'kolik alchiemu se rozmisti (LD B,n)'),
    ('muggersPlaced',     0x8572, '06 ..',       'kolik muggeru (LD B,n)'),
    ('wantedVar',         0x8588, '32 .. ..',    'bity 0-1 mistnost monolitu, 2-3 hledany alchiem'),
    ('monolithRoomTable', 0x8590, '21 .. ..',    'ctyri mistnosti, ze kterych se vybira'),
    ('monolithRoomOffset', 0x8598, 'C6 ..',      'monolit je o n mistnosti dal (ADD A,n)'),
    ('wantedFrameBase',   0x85A4, 'C6 ..',       'ramec ukazatele hledaneho alchiemu (ADD A,n)'),
    ('wantedObjectFrame', 0x85A6, '32 .. ..',    'kam se zapise (LD (nn),A)'),
    ('monolithFrame',     0x85A9, '3E ..',       'prvni ramec monolitu (LD A,n)'),
    ('monolithFrameVar',  0x85AB, '32 .. ..',    'kam se zapise'),
    ('monolithStart',     0x85AE, '21 .. ..',    'jeho x a y na zacatku (LD HL,nn)'),
    ('monolithPosVar',    0x85B1, '22 .. ..',    'kam se zapisou (LD (nn),HL)'),
    ('wantedRoomVar',     0x8595, '32 .. ..',    'mistnost s ukazatelem hledaneho alchiemu'),
    ('randomRoomState',   0x86EA, '26 ..',       'losovani mistnosti: horni bajt (LD H,n)'),
    ('randomRoomStep',    0x86F8, '2C',          'a krok pri hledani volne (INC L)'),
    # --- konec hry ($A838) a bodování ($9938, $99A5)
    ('wantedCountVar',    0xA838, '3A .. ..',    'kolik hledanych alchiemu hrac ma'),
    ('endSound',          0xA840, '3E ..',       'zvuk odletu monolitu (LD A,n)'),
    ('monolithMoveVar',   0xA84A, '21 .. ..',    'x monolitu; odlet ho zvysuje o dve'),
    ('monolithMinY',      0xA852, 'FE ..',       'a snizuje y, dokud neni pod n (CP n)'),
    ('monolithLastFrame', 0xA86A, 'FE ..',       'posledni ramec odletu (CP n)'),
    ('endDelay',          0xA86E, '06 ..',       'kolik snimku se pak ceka (LD B,n)'),
    ('endScreenCode',     0xA873, '3E ..',       'ktera zaverecna obrazovka (LD A,n)'),
    ('endScreen',         0xA875, 'C3 .. ..',    'skok na ni (JP nn)'),
    ('matchWantedShift',  0x8962, '3A .. ..',    'hledany alchiem: bity 2-3 tehoz bajtu'),
    ('scoreRoomsBitmap',  0x9938, '21 .. ..',    'bitmapa navstivenych mistnosti (LD HL,nn)'),
    ('scoreRoomsPerUnit', 0x993C, '16 ..',       'kolik mistnosti je jedno procento (LD D,n)'),
    ('scorePerAlchiem',   0x99B4, '27',          'kazdy hledany alchiem se pricte dvakrat (DAA)'),
    ('scoreComplete',     0x99BA, 'C6 ..',       'dohrana hra misto toho pricte n (ADD A,n)'),
]

# bity stavu místnosti ($B600 + číslo místnosti), které patří M5
ROOM_STATE_BITS = {
    '0': 'stena prokousana krtkem (M4)',
    '1': 'kulisa: viz M2',
    '2': 'kulisa: viz M2',
    '3': 'je tu MUGGER ($8580 SET pri rozehrani, $83B8 pri uteku, $8384 RES)',
    '4': 'cislo alchiemu, spodni bit',
    '5': 'cislo alchiemu, horni bit',
    '6': 'je tu ALCHIEM ($8568 SET pri rozehrani, $830C RES pri sebrani)',
    '7': 'do teto mistnosti se smi neco polozit (nastaveno uz v M2)',
}

# bity $7EE0, které patří M5 (bity 3 a 4 jsou whirlwind z M4)
E0_BITS = {
    '0-2': 'kolik gravity sticku hrac ma ($83A2 nastavi 4, $7E10 ubira)',
    '3': 'whirlwind: druhe kolo cyklu ramcu (M4)',
    '4': 'whirlwind: unaseni do strany je vypnute (M4)',
    '7': 'Charlie neni na zemi, stick se polozit neda ($7E07)',
}

# bity příznaků nepřítele, které dispečer používá
MONSTER_FLAG_BITS = {
    '0': 'vidno; nula znamena "volny slot, muze se losovat"',
    '1': 'prekreslit (spolecne s M3)',
    '2': 'nakresleno (spolecne s M3)',
    '3': 'mizi - bezi seznam ramcu $AAC4 ($A669 SET, $A68C RES)',
    '4': 'koliduje s kulisou (spolecne s M3)',
}

OPCODES = {0: 'none', 1: 'move', 2: 'move2', 3: 'distLo', 4: 'distHi',
           5: 'call', 6: 'return'}


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
    """Seznam rámců nepřítele (`$A66D`): bajty rámců, `$00` = skok, `$01` = konec."""
    addr, frames = start, []
    while True:
        visited.add(addr)
        frame = image[addr - 0x4000]
        addr += 1
        visited.add(addr)
        command = image[addr - 0x4000]
        if command == 1:                       # konec: nepřítel zmizí
            addr += 1
            return {'entry': start, 'frames': frames, 'end': 'vanish',
                    'last': addr - 1}
        if command == 0:                       # skok: dva bajty za ním
            visited.add(addr + 1)
            visited.add(addr + 2)
            target = image[addr - 0x4000 + 1] | image[addr - 0x4000 + 2] << 8
            frames.append(frame)
            return {'entry': start, 'frames': frames, 'end': 'goto',
                    'target': target, 'last': addr + 2}
        frames.append(frame)                   # jinak je to rovnou další rámec


def walk_object_script(image, start, visited, targets, limit=4096):
    """Bajtkód poletujícího objektu (`$A8AC`) – vlastní interpret, vlastní opkódy.

    Krok = **bajt s číslem rámce** a za ním příkazy; příkaz s bitem 7 je poslední.
    Opkódy jsou v bitech 6–4, argument v bitech 3–0. `call` a `return` mění
    ukazatel **uprostřed kroku** (`$A918`, `$A946`), takže se tady nečte lineárně,
    ale jde se za ukazatelem přesně jako v originále – jinak by se za `call`
    četly bajty, které interpret nikdy nepotká.

    `return` se vrací **za volání** (`+$06`/`+$07`), takže se pokračuje tam, kde
    by pokračoval interpret. Cíle `call` se navíc vrací v `targets` jako další
    vstupní body, aby se pokryl **celý** blok a šlo říct, kolik bajtů zůstalo
    mimo – táž kontrola úplnosti jako v `dumpphysics.py` a `dumpmole.py`.
    """
    def fetch(addr):
        visited.add(addr)
        return image[addr - 0x4000], addr + 1

    addr, ret, steps, seen = start, None, [], set()
    while len(steps) < limit:
        # Stav interpretu je **dvojice** (ukazatel, návratový ukazatel) – tentýž
        # bajt se prochází víckrát s jiným návratem, a to není smyčka.
        if (addr, ret) in seen:
            steps.append({'at': addr, 'goto': addr})
            break
        seen.add((addr, ret))
        frame, addr = fetch(addr)
        step = {'at': addr - 1, 'frame': frame, 'commands': []}
        done = False
        while True:
            command, addr = fetch(addr)
            op = (command >> 4) & 7
            item = {'op': OPCODES.get(op, 'op%d' % op), 'arg': command & 0x0F}
            if op == 2:                        # za příkazem je bajt vzdáleností
                item['distances'], addr = fetch(addr)
            elif op == 5:                      # call: dva bajty jsou nový ukazatel
                lo, addr = fetch(addr)
                hi, addr = fetch(addr)
                item['target'] = lo | (hi & 0x7F) << 8 | 0x8000
                targets.add(item['target'])
                ret, addr = addr, item['target']
            elif op == 6:                       # return: zpátky za `call`
                if ret is None:
                    item['returns'] = True
                    done = True
                else:
                    item['target'] = ret
                    addr, ret = ret, None
            step['commands'].append(item)
            if command & 0x80:
                break
        steps.append(step)
        if done:
            break
    return {'entry': start, 'steps': steps}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--show', action='store_true', help='vypsat tabulky podrobne')
    args = ap.parse_args()

    image = read_image()
    constants, meta = {}, {}
    for name, addr, pattern, what in CONSTANTS:
        value, width = operand(image, addr, pattern, name)
        constants[name] = value
        meta[name] = {'address': addr, 'width': width, 'what': what}

    # --- šest typů: čtyřbajtový popis (krok, ukazatel na seznam rámců, perioda)
    types, frame_lists, visited = [], {}, set()
    for index in range(1, 7):
        base = constants['typeDescriptor%d' % index]
        step, script, period = (image[base - 0x4000],
                                image[base - 0x4000 + 1] | image[base - 0x4000 + 2] << 8,
                                image[base - 0x4000 + 3])
        types.append({'type': index, 'descriptor': base, 'step': step,
                      'script': script, 'period': period})
    # mugger (typ 6) si ukazatel domodifikuje podle toho, na které straně vznikl
    types[5]['script'] = None
    types[5]['scriptRight'] = constants['muggerSpawnRight']
    types[5]['scriptLeft'] = constants['muggerSpawnLeft']

    entries = {'death': constants['deathScriptLo'] | constants['deathScriptHi'] << 8,
               'walkRight': constants['muggerWalkRight'],
               'walkLeft': constants['muggerWalkLeft'],
               'muggerRight': constants['muggerSpawnRight'],
               'muggerLeft': constants['muggerSpawnLeft']}
    for t in types:
        if t['script'] is not None:
            entries['type%d' % t['type']] = t['script']
    pending = list(entries.values())
    while pending:
        entry = pending.pop()
        if entry in frame_lists:
            continue
        frame_lists[entry] = walk_frames(image, entry, visited)
        if frame_lists[entry]['end'] == 'goto':
            pending.append(frame_lists[entry]['target'])

    lo = min(frame_lists)
    hi = max(v['last'] for v in frame_lists.values())
    unreachable = [a for a in range(lo, hi + 1) if a not in visited]

    # --- 94 poletujících objektů
    table, count, stride = (constants['objectTable'], constants['objectCount'],
                            constants['objectStride'])
    objects, object_scripts, seen, targets = [], {}, set(), set()
    for i in range(count):
        base = table + i * stride
        rec = list(image[base - 0x4000:base - 0x4000 + stride])
        script = rec[0] | (rec[1] | 0x80) << 8
        objects.append({'index': i, 'address': base, 'script': script,
                        'room': rec[2], 'distances': rec[3],
                        'x': rec[4], 'y': rec[5], 'record': rec})
        targets.add(script)
    # cíle `call` jsou další vstupní body; jede se, dokud nějaký nový přibývá
    pending = set(targets)
    while pending:
        entry = pending.pop()
        if entry in object_scripts:
            continue
        found = set()
        object_scripts[entry] = walk_object_script(image, entry, seen, found)
        pending |= found - set(object_scripts)

    # --- bajty skriptů tak, jak leží v paměti; remake je čte týmž interpretem.
    # Blok objektů sahá od konce tabulky až po **nejvyšší dosažený bajt**, ne po
    # odhad – co v něm dosažitelné není, se vypíše (jako v dumpmole.py).
    object_lo = constants['objectTable'] + count * stride
    object_hi = max(seen)
    object_gaps = [a for a in range(object_lo, object_hi + 1) if a not in seen]
    blocks = []
    for base, end in ((min(frame_lists), max(v['last'] for v in frame_lists.values())),
                      (object_lo, object_hi)):
        blocks.append({'base': base,
                       'bytes': list(image[base - 0x4000:end + 1 - 0x4000])})

    # --- tabulka poloh alchiemu a muggeru: bajt na každou místnost s bitem 7
    # (`$88D3`–`$88E4` v ní indexuje **počtem takových místností po tuhle**),
    # `x = bajt AND $F0`, `y = (bajt AND $0F) * 8`
    item_base = constants['itemPosTable']
    specials = sum(1 for r in range(256)
                   if image[constants['roomStateBase'] - 0x4000 + r] & 0x80)
    item_positions = list(image[item_base - 0x4000:
                                item_base - 0x4000 + specials + 1])

    teleport_rooms = list(image[constants['teleportRoomTable'] - 0x4000:
                                constants['teleportRoomTable'] - 0x4000
                                + constants['teleportRoomCount']])
    monolith_rooms = list(image[constants['monolithRoomTable'] - 0x4000:
                                constants['monolithRoomTable'] - 0x4000 + 4])

    data = {
        'source': 'tools/dumpmonsters.py',
        'image': os.path.basename(IMAGE),
        'constants': constants,

        'types': types,
        'frameLists': {'$%04X' % k: v for k, v in sorted(frame_lists.items())},
        'frameListUnreachable': unreachable,
        'objects': objects,
        'blocks': blocks,
        'objectScriptUnreachable': object_gaps,
        # Rozebrané kroky bajtkódu do `data/monsters.json` **nepatří**: remake
        # čte bajty (`blocks`) týmž interpretem jako originál, takže rozbor je
        # dokumentace, ne data. Vypisuje ho `--show`.
        'itemPositions': item_positions,
        'specialRooms': specials,
        'teleportRooms': teleport_rooms,
        'monolithRooms': monolith_rooms,
        'roomStateBits': ROOM_STATE_BITS,
        'stickFlagBits': E0_BITS,
        'monsterFlagBits': MONSTER_FLAG_BITS,
    }
    with open(args.out, 'w') as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write('\n')

    print('konstant overeno jako operandy instrukci: %d' % len(constants))
    print('typu nepratel: %d (krok/perioda %s)'
          % (len(types), ' '.join('%d:%d/%d' % (t['type'], t['step'], t['period'])
                                  for t in types)))
    print('seznamu ramcu: %d, blok $%04X-$%04X, nedosazitelnych bajtu: %d'
          % (len(frame_lists), lo, hi, len(unreachable)))
    print('poletujicich objektu: %d po %d B ($%04X-$%04X), ruznych skriptu: %d'
          % (count, stride, table, table + count * stride - 1, len(object_scripts)))
    rooms = sorted(set(o['room'] for o in objects))
    print('  v %d mistnostech; ramce %s'
          % (len(rooms),
             ' '.join('$%02X' % f for f in sorted(set(
                 image[o['script'] - 0x4000] for o in objects)))))
    print('  skripty objektu $%04X-$%04X, nedosazitelnych bajtu: %d'
          % (object_lo, object_hi, len(object_gaps)))
    print('bajtu skriptu z originalu: %s'
          % ' '.join('$%04X-$%04X (%d B)'
                     % (b['base'], b['base'] + len(b['bytes']) - 1, len(b['bytes']))
                     for b in blocks))
    print('poloh alchiemu/muggeru: %d bajtu od $%04X pro %d mistnosti s bitem 7'
          % (len(item_positions), item_base, specials))
    print('mistnosti s typem 5 (teleport): %s'
          % ' '.join('$%02X' % r for r in teleport_rooms))
    print('mistnosti monolitu na vyber: %s (monolit je o $%02X dal)'
          % (' '.join('$%02X' % r for r in monolith_rooms),
             constants['monolithRoomOffset']))
    print('rozehrani: %d alchiemu, %d muggeru; hrac unese %d alchiemu; plna energie $%02X'
          % (constants['alchiemsPlaced'], constants['muggersPlaced'],
             constants['alchiemSlots'], constants['energyFull']))
    print('ulozeno %s (%d kB)' % (args.out, (os.path.getsize(args.out) + 512) // 1024))

    if args.show:
        print('\ntypy nepratel:')
        for t in types:
            script = ('$%04X' % t['script'] if t['script']
                      else '$%04X/$%04X (podle strany)'
                           % (t['scriptRight'], t['scriptLeft']))
            print('  typ %d  popis $%04X  krok %d px  perioda %d  ramce %s'
                  % (t['type'], t['descriptor'], t['step'], t['period'], script))
        print('\nseznamy ramcu:')
        for addr in sorted(frame_lists):
            fl = frame_lists[addr]
            tail = ('-> $%04X' % fl['target'] if fl['end'] == 'goto' else 'zmizi')
            print('  $%04X  %s  %s'
                  % (addr, ' '.join('%02X' % f for f in fl['frames']), tail))
        print('\npoletujici objekty po mistnostech:')
        by_room = {}
        for o in objects:
            by_room.setdefault(o['room'], []).append(o)
        for room in sorted(by_room):
            print('  mistnost $%02X: %s'
                  % (room, ' '.join('#%d $%04X (x=$%02X y=$%02X)'
                                    % (o['index'], o['script'], o['x'], o['y'])
                                    for o in by_room[room])))
        print('\nskripty objektu:')
        for addr in sorted(object_scripts):
            sc = object_scripts[addr]
            for step in sc['steps']:
                if 'goto' in step:
                    print('  $%04X  -> smycka' % step['at'])
                    continue
                parts = []
                for c in step['commands']:
                    if c['op'] == 'call':
                        parts.append('call $%04X' % c['target'])
                    elif c['op'] == 'move2':
                        parts.append('move2 %X dist %02X' % (c['arg'], c['distances']))
                    else:
                        parts.append('%s %X' % (c['op'], c['arg']))
                print('  $%04X  ramec %02X  %s'
                      % (step['at'], step['frame'], ', '.join(parts)))
        print('\npolohy alchiemu a muggeru (index = kolikata "zvlastni" mistnost):')
        for i, byte in enumerate(item_positions):
            if i:
                print('  %2d  $%02X -> x=$%02X y=$%02X'
                      % (i, byte, byte & 0xF0, (byte & 0x0F) * 8))
        print('\nbity stavu mistnosti ($B600 + cislo mistnosti):')
        for bit, what in sorted(ROOM_STATE_BITS.items()):
            print('  bit %s  %s' % (bit, what))
        print('\nbity $7EE0:')
        for bit, what in sorted(E0_BITS.items()):
            print('  %s  %s' % (bit, what))
        print('\nbity priznaku nepritele:')
        for bit, what in sorted(MONSTER_FLAG_BITS.items()):
            print('  bit %s  %s' % (bit, what))


if __name__ == '__main__':
    main()
