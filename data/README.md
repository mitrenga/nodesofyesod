# Data remaku

Stav **M7 (zvuk 48K edice)**. Všechno tady je **vytažené z originálu** – nic dokresleného.

| soubor | co je uvnitř | čím vzniklo |
|---|---|---|
| `global.json` | konstanty změřené na běhu originálu: 50,08 Hz, 3 životy, rozdělení obrazovky, mřížka světa, počáteční místnost | ručně ze `sources/docs/` |
| `panel.json` | **celý panel**: dlaždicová tabulka hry z `$73E6`, display list z `$7387–$73E5`, atributy z `$5D99` a změřené polohy bloků i políček, do kterých hra zapisuje za běhu | `tools/mkpanel.py` |
| `font.json` | znaková sada hry (mezera, `:`, `0`–`9`, `A`–`Z`, `©`) – dlaždice téže tabulky | `tools/mkfont.py` |
| `loading.json` | loading screen originálu, celá obrazovka 256 × 192 | `tools/mkscreen.py` |
| `title.json` | **nabídka ovládání**, kterou hra ukáže po nahrání (`1 KEYBOARD…` a kresba astronauta) – **48K edice** | `tools/mkscreen.py` |
| `title128.json` | tatáž obrazovka z **128K edice**; liší se **231 bajty bitmapy a jedním atributem** (copyright 1985 vs. 1986), a je to jediný vizuální rozdíl mezi edicemi. Ukazuje ji volba `START GAME v. 128k` (`../ZADANI.md` §0) | `tools/mkscreen.py` |
| `scenery.json` | **kulisové bloky**: čtyři sady dlaždic (9 B na dlaždici: 8 bitmapy + atribut) a jejich display listy, plus panel jako pátá sada | `tools/dumpgfx.py` |
| `world.json` | **popis světa 16 × 16**: sada a tvar každé místnosti, perzistentní stav (prokousatelné stěny, díry v podlaze, zvláštní místnosti), sousedé | `tools/dumprooms.py` |
| `rooms.json` | **co kam kreslicí rutina originálu položila** ve všech 256 místnostech: bloky, volné dlaždice, výplň, hvězdy | `tools/dumprooms.py` |
| `spriteframes.json` | **tabulka spritů**: 136 rámců v ZX bajtech + atribut, a obě tabulky ukazatelů. Ke každému rámci je i **`mirror`**, tatáž bitmapa vodorovně zrcadlená – rámec s bitem 7 (pohled doleva) míří na tutéž bitmapu a kreslí se převrácený (★ **oprava M3**, `disasm_notes.md` §10.3). ★ **Opraveno v M5**: pět rámců (čtyři alchiemy a mugger) je v obrazu po nahrání neviditelných – deset bajtů tabulky `$C7C4–$C7CD` vyplní až rozehraná hra a bitmapy leží mimo obě hlavní oblasti. ★ **Doplněno v M6**: `attributes` je **pravidlo, jak se atribut rámce zapisuje do buňky** (`$940E`–`$9445`, `disasm_notes.md` §9.1) – z rámce jen inkoust (`$C7`), **papír zůstává z pozadí** (`$38`), a zapisuje se jen do buněk pozadí (`$3F` proti `$09` na povrchu / `$07` v jeskyních). Bez něj remake maloval kolem spritů černé obdélníky. Konstanty jsou operandy ověřených instrukcí | `tools/dumpsprites.py` |
| `physics.json` | **fyzika Charlieho**: 34 konstant jako **operandy skutečných instrukcí**, celý blok **skriptů animace** `$5BAF–$5D08` v bajtech originálu, a výchozí 32bajtový záznam Charlieho z rozehrané hry | `tools/dumpphysics.py` |
| `mole.json` | **krtek a stav světa**: 88 konstant jako operandy skutečných instrukcí, **seznamy rámců** (`$A2B8`, `$A2DF`) a **bajtkódové skripty** (`$A2BD` vylézání, `$5B6A`/`$5B7C` kousání) v bajtech originálu, **tabulka šesti děr** na povrchu (`$A299`), **proud kousků stěny** (`$7666`, 192 B), ikona člověk/krtek v panelu a záznam krtka z rozehrané hry | `tools/dumpmole.py` |
| `monsters.json` | **nepřátelé, alchiemy, muggeři a pravidla**: 147 konstant jako operandy skutečných instrukcí, **popisy šesti typů** (`$AACA–$AAE1`) a jejich **seznamy rámců** (`$AA70–$AAC9`) v bajtech originálu, **tabulka 94 poletujících objektů** (`$AAED–$ADDC`) a **bajty jejich bajtkódu** (`$ADDD–$B4FD`), šest místností s pevným typem 5 a čtyři místnosti, ze kterých se losuje monolit | `tools/dumpmonsters.py` |
| `sound.json` | ★ **zvuk 48K edice**: 36 konstant zvukových rutin jako **operandy skutečných instrukcí**, **tabulka 48 period** (`$614C`) a **všech šest melodií** (`$617C`–`$62AB`) v bajtech originálu, **časy smyček změřené v simulátoru** (průchod tónovou smyčkou 77 T, přetočení čítače +9 T, režie přehrávače 123 T na notu…) a ★ **digitalizovaná řeč**: 4246 bajtů jednobitového vzorku z `$E23E`, 11 111 Hz, 3,12 s. Kontrola úplnosti: tabulka period a melodie **beze zbytku vyplní blok `$614C`–`$62AB`**, 0 nedosažitelných bajtů | `tools/dumpsound.py` |
| `room000.json` | hrací plocha 256 × 168 ze snímku běžící hry (povrch Měsíce) – **pozůstatek M1**, remake ji už nepoužívá, zůstává jako doklad, proti čemu se v M1 měřilo | `tools/mkroom.py` |

Bitmapy i atributy jsou base64 skutečných bajtů videopaměti; bitmapa je uložená
**lineárně po pixelových řádcích** (nelineární adresování Spectra se rozplete už
v nástroji, ne v prohlížeči).

## Jak se místnost skládá

Místnost **není obrázek**. Skládá se z bloků originálu, přesně tak, jak to dělá
originál (`../sources/docs/disasm_notes.md` §8) – v remaku je to
`../app/roomScenery.js`:

1. hrací plocha 32 × 21 buněk se vyplní atributem pozadí (`fillAttr`, u povrchu
   navíc `skyAttr` na horních `skyRows` řádcích),
2. položí se **bloky** display listu té které sady (`blocks`: index bloku, sloupec, řádek),
3. položí se **volné dlaždice** (`looseTiles`) – to, co rutina pokládá mimo bloky,
4. dokreslí se **hvězdy** (`pixelSet`: offset v bitmapě a maska),
5. shodí se **bit 7 atributů** v obdélnících `attrClear`.

Sloupec i řádek se počítají **v bajtu** (mod 256) a co vypadne z 32 × 21, se zahodí –
tak vzniká levá stěna z bloku položeného na sloupec `$FE`. Bit 7 indexu dlaždice
znamená vodorovné zrcadlení. Bit 7 atributu **není blikání**: originál ho při překlopení
na obrazovku maskuje `AND $7F`, je to příznak hry.

Ověřeno na **všech 256 místnostech proti kreslicí rutině originálu**, dvakrát nezávisle:
`tools/matchscreen.py` (Python) a `tools/matchrooms.js` (kód, který jde do prohlížeče).
**0 rozdílů v bitmapě, 0 v atributech, 0 nevysvětlených buněk.**

## Jak se Charlie hýbe

Ani tohle **není vzorec**. Charlie je entita řízená **bajtkódovým skriptem animace**
(`../sources/docs/disasm_notes.md` §10) a `physics.json` proto nese **bajty skriptů tak,
jak leží v paměti originálu**; `../app/charliePhysics.js` je interpretuje toutéž rutinou
jako originál (`$8EB2`).

- `constants` – každá je operand skutečné instrukce a `constantNotes` u ní říká **adresu,
  instrukci a k čemu je**. Nástroj u každé kontroluje, že na té adrese ta instrukce
  opravdu stojí; když ne, **skončí chybou místo aby vydal číslo**.
- `scriptBlock` – `$5BAF–$5D08`, 346 B. Nástroj ho projde od všech vstupních bodů:
  **0 nedosažitelných bajtů**.
- `scripts` – rozebrané kroky pro čtení (rámec + příkazy), aby se dalo zkontrolovat okem.
- `charlie.record` – výchozí záznam z **rozehrané hry**, ne ze statického obrazu; odtud
  je i délka kroku (3 px) a perioda skriptu (krok jednou za dva snímky).

**Kolizní mapa v datech není a být nemusí**: je to **bit 7 atributů**, které skládá
`roomScenery.js` – originál je při překlopení na obrazovku maskuje `AND $7F`, takže je
to příznak hry, ne barva. M2 ho reprodukuje bajt po bajtu, takže M3 ho jen čte.

Ověřeno na devíti nahraných bězích originálu: `tools/matchphysics.js` porovná 32bajtový
záznam Charlieho průchod po průchodu – **4100 průchodů, 0 rozdílů**.

## Jak se hýbe krtek

Krtek **nemá vlastní fyziku**: je to **tatáž entita s týmiž rutinami** jako Charlie, jen
na `$FDC0` místo `$FDE0` – v originálu doslova jiné `IX`. `mole.json` proto nenese žádný
model pohybu, ale jen to, co si `$A098` a `$A21A` do záznamu zapíšou, a **bajty** jeho
seznamů rámců a skriptů.

- `constants` – každá je operand skutečné instrukce a `constantNotes` u ní říká **adresu,
  instrukci a k čemu je**; kontrola je stejná jako u `physics.json` (když na té adrese ta
  instrukce nestojí, nástroj **skončí chybou**).
- `frameLists` – při jízdě a při sesedání krtek **není řízený bajtkódem**, ale seznamem
  rámců, jeden bajt na průchod (`$A2B8`: `32 33 34 35`, nula je návrat na začátek).
- `scripts` + `blocks` – bajtkód téhož interpretu `$8EB2` má krtek jen při **vylézání
  z díry** (`$A2BD`) a při **kousání stěny** (`$5B6A`/`$5B7C`). Nástroj bloky projde od
  všech vstupních bodů: **2 nedosažitelné bajty**, a je vysvětleno proč (`$A27D` testuje
  rámec ještě před krokem, takže poslední krok skriptu vylézání se nikdy neudělá).
- `surfaceHoles` – šest děr na povrchu (místnosti `$02 $06 $08 $09 $0C $0F`), dvě polohy
  na místnost; kterou vzít, říká **bit 0 jednotek hodin `TIME`**.
- `eatStream` – 192 bajtů, po kterých se stěna žere. Každý bajt je jeden **dvoupixelový
  kousek** průchodu a celý proud je **permutace všech 24 × 8 kousků, každý právě
  jednou** – nástroj to kontroluje a jinak to napíše.
- `panelIcon` – ikona **člověk / krtek** v panelu: bloky 0 a 1 display listu na tomtéž
  místě a tři buňky atributů. ★ Tím je zodpovězená otevřená otázka M1 o druhém bloku.

Ověřeno na šesti nahraných bězích originálu: `tools/matchentities.js` porovná 32bajtový
záznam krtka, stav světa, kolizní mapu i bitmapu žraného průchodu – **1782 průchodů,
0 rozdílů**.

## Perzistentní stav světa

Prokousané stěny **nejsou v datech místnosti** – jsou to stav. Originál si drží bajt na
`$B600 + číslo místnosti` a jeho bit 0 znamená „pravá stěna je prokousaná"; sousedovi
vlevo se týmž bitem otevře stěna levá. `world.json` proto říká jen `diggableRight`
(která stěna se prokousat **dá**).

Tohle je hlavní nález M2 a datový model ho měl od začátku – přesně proto, aby se v M4
nepřepisoval (`../MILNIKY.md`, riziko 4). **Vyšlo to**: M4 do něj jen **zapisuje**.
Od M4 ten stav vede **worker** (`app/worldState.js`, 256 bajtů se stejným významem bitů
jako `$B600`); aplikace si jeho kopii drží jen pro mapu světa (`gameApp.setWorldState()`).
`tools/checkworld.py` ověřuje bity 0, 1, 2 a 7 proti rozehranému originálu na všech 256
místnostech a u všech 39 prokousatelných stěn i to, že se průchod opravdu otevře.
Bity 3 až 6 patří M5 (značka muggera a alchiemy, které si hra **losuje z registru `R`**).

**Rozmístění alchiemů v datech není a být nemůže**: originál si ho losuje při každém
startu z registru `R` (`$86EA`). V remaku se losuje taky (`app/monsterLogic.js`,
`newGame()`), a je to napsané tady i v `world.json`.

★ **Doplněno v M5**: bity 3 až 6 jsou **mugger** (bit 3), **číslo alchiemu** (bity 4–5)
a **je tu alchiem** (bit 6). Rozehrání hry (`$8553`) ze všech místností smaže bity 0
a 3–6 – tedy i **prokousané stěny** – a rozmístí **32 alchiemů** a **6 muggerů**.
Podrobně `../sources/docs/disasm_notes.md` §12.7.

## Jak se hýbou nepřátelé a poletující objekty

Dvě věci, které se čtou jinak, než by rozlehlá mapa napovídala
(`../sources/docs/disasm_notes.md` §12), a proto stojí za to je mít i tady:

* **Rozmístění nepřátel po světě žádná tabulka není.** V podzemních místnostech se
  losují za běhu (šance 1/64 na volný slot a průchod) a hra si je pamatuje jen pro
  **posledních pět** navštívených místností. `monsters.json` proto nese **typy**, ne
  místa. Nadzemní místnosti a místnost monolitu nepřátele nemají.
* **Poletující objekty místa mají** – 94 záznamů po 8 bajtech, každý s číslem místnosti,
  souřadnicemi a ukazatelem do vlastního bajtkódu. Ten bajtkód **není interpret M3**:
  má jiné opkódy, vzdálenost a periodu si drží v nibblech jednoho bajtu a `call`
  s `return` mění ukazatel uprostřed kroku. Objekt se navíc po světě **pohybuje sám**,
  po témž toru 16 × 16 jako Charlie.

## Co tu schválně **není**

- **Profil skoku jako konstanta.** Skok je v datech originálu jako **posloupnost posunů**
  (nahoru 12, 10, 10, 8, 7, 6, 5, 2 a dolů zpátky), ne jako gravitační zrychlení –
  a tak je i tady.
- **Průběžné skóre.** Panel originálu žádné nemá a **žádná rutina, která by přičítala,
  v obrazu hry není** – ověřeno v M5. Jediné bodování je **procento na závěrečné
  obrazovce** (`../ZADANI.md` §4). Hall of fame remaku proto řadí podle hodin `TIME`,
  což je skutečné pole panelu originálu – a je to napsané i v `app/gameOverModel.js`.
- **Rozmístění nepřátel.** Není kam ho dát: hra si ho losuje (viz výš).
- **Rozebraný bajtkód poletujících objektů.** V `monsters.json` jsou jen **bajty**;
  remake je čte týmž interpretem jako originál, takže rozbor je dokumentace, ne data.
  Vypíše ho `tools/dumpmonsters.py --show`.
- **Nahraný zvuk.** V `sound.json` nejsou vlny, ale **rutiny a jejich konstanty**:
  zvuk je jeden bit portu `$FE`, takže se skládá průchod po průchodu
  (`app/beeper.js`). Jediná výjimka je **vzorek řeči**, a ten je v datech
  proto, že vzorek opravdu je – 4246 bajtů originálu, ne nahrávka.
- **Hudba během hry.** Žádná není: M7 přečetla celý zvukový blok a melodie jsou
  jen dvě, obě mimo hru (`disasm_notes.md` §13.2). AY hudba Freda Graye patří
  ke **128K edici**, a její subsystém je pořád otevřený (`../MILNIKY.md`).

## Jak se data dostanou do aplikace

**Všechno jde v jedné žádosti při startu aplikace** – `appData` (`db/appData.php`):

| soubory | velikost |
|---|---|
| `global`, `font`, `panel`, `loading`, `title`, `title128`, **`world`**, **`scenery`**, **`rooms`**, **`spriteframes`**, `physics`, **`mole`**, **`monsters`**, **`sound`** | ~300 kB |

Je to týž postup jako v `manicminer/` a `jetsetwilly/` (JSW takhle posílá 60 místností,
~285 kB): klient si každý soubor uloží do `localStorage` pod svým klíčem
(`noy.<jméno>`) a modely už čtou **jen z `localStorage`**, ne ze sítě
(`app/gameApp.js`, `setGlobalData()`; čtení `loadDataFile()` v modelech). Online se
uložené vždy přepíše, **offline se nepřepisuje** a hraje se z toho, co je uložené.

Rozdělovat data na druhou žádost na vyžádání se neukázalo jako dobrá cesta: nic na ni
nečekalo, takže na čerstvém profilu prohlížeče se dala hra spustit dřív, než dorazila,
a `RoomModel` skončil na hlášce o chybějících datech.

## Jak se to vyrobí znovu

```sh
./tools/mksnapshot.sh                       # build/nodesofyesod-48k.bin
./tools/mkpanel.py                          # data/panel.json  (+ vypíše polohy bloků)
./tools/mkfont.py                           # data/font.json
./tools/mkscreen.py sources/media/screens/loading_screen.scr data/loading.json --name "LOADING SCREEN"
./tools/mkscreen.py sources/media/screens/menu_controls.scr  data/title.json   --name "CONTROL SELECTION"
./tools/mkscreen.py sources/media/screens/menu_controls_128k.scr data/title128.json --name "CONTROL SELECTION (128K)"
./tools/dumpgfx.py                          # data/scenery.json
./tools/dumprooms.py --rooms 0-255          # data/world.json, data/rooms.json, build/rooms/
./tools/dumpsprites.py                      # data/spriteframes.json
./tools/dumpphysics.py                      # data/physics.json
./tools/dumpmole.py                         # data/mole.json
./tools/dumpmonsters.py                     # data/monsters.json
./tools/matchpanel.py                       # 0 rozdílů proti originálu (panel)
./tools/matchscreen.py                      # 0 rozdílů na 256 místnostech
./tools/matchrooms.js                       # totéž kódem remaku
./tools/mapworld.py --check                 # mřížka 16 × 16 proti dobové mapě
./tools/matchphysics.js                     # fyzika Charlieho, 0 rozdílů
./tools/matchentities.js                    # krtek a stav světa, 0 rozdílů
./tools/monsterlog.py --suite               # nahrát šest běhů s nepřáteli (mimo git)
./tools/matchmonsters.js                    # nepřátelé a objekty, 0 rozdílů
./tools/checkworld.py                       # přechody, stav místností, průchody
./tools/dumpsound.py --show                 # data/sound.json (zvuk 48K edice)
./tools/soundlog.py                         # nahrát zvuk originálu (mimo git)
./tools/matchsound.js                       # zvuk remaku vs. originál, 0 rozdílů
```
