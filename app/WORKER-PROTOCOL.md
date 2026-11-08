# Protokol mezi `roomModel.js` a `gameWorker.js`

Worker drží herní stav a tiká na **50,08 Hz** – snímkové frekvenci originálu
(3,5 MHz / 69 888 T-stavů na snímek; hlavní smyčka hry byla změřena tak, že
běží **jednou za snímek**, viz `sources/docs/disasm_notes.md` a `ZADANI.md` §1).
Model do něj jen posílá vstupy a kreslí to, co dostane zpátky.

## Stav M5: worker je **celý svět i jeho pravidla**

Fyzika Charlieho je `app/charliePhysics.js` a krtek `app/molePhysics.js` –
**přepisy rutin originálu**, ne modely. Konstanty i skripty jsou
v `data/physics.json` a `data/mole.json` vytažené `tools/dumpphysics.py`
a `tools/dumpmole.py` (konstanty jako operandy skutečných instrukcí, skripty
a seznamy rámců jako bajty originálu). Matchery pustí tentýž kód na nahraných
bězích originálu a porovnají záznamy bajt po bajtu: **4100 průchodů, 0 rozdílů**
(`tools/matchphysics.js`) a **1782 průchodů, 0 rozdílů** v záznamu krtka, stavu
světa, kolizní mapě i bitmapě žraného průchodu (`tools/matchentities.js`).
Od M5 k tomu přibyl `app/monsterLogic.js` – **přepis dispečeru typů `$A5B2`,
smyčky poletujících objektů `$A479` a pravidel** (alchiemy, muggeři, gravity
sticky, energie, monolit). Konstanty a bajty skriptů jsou v `data/monsters.json`
z `tools/dumpmonsters.py`, a `tools/matchmonsters.js` pustí tentýž kód na
nahraných bězích: **6557 průchodů, 0 rozdílů** v záznamech nepřátel, v tabulce
94 objektů, v globálech, ve stavu světa a v paměti pěti místností.
Rozbor je v `../sources/docs/disasm_notes.md` §10, §11 a §12.

★ **Pořadí uvnitř průchodu je pořadí hlavní smyčky originálu** (`$7DC3`):
`$8F44` okraje a přechod → `$7EE1` alchiem/mugger → `$7DF1` gravity stick →
`$A479` poletující objekty a **pak** nepřátelé. `gameWorker.js` to volá takhle
a je to tam napsané, protože na tom pořadí záleží: objekt, který se v tomhle
průchodu nehýbal, Charlieho nebolí, a mugger krade až v tom průchodu, ve kterém
mu dotek nastavil bit 1.

★ **Od M4 drží worker celý svět, ne jednu místnost.** Má v sobě

* `app/worldState.js` – **perzistentní stav** (bajt na místnost, jako `$B600`),
* `app/roomScenery.js` – **skládání místností** z kulisových bloků originálu,
* `app/molePhysics.js` – **krtka**, který ten stav mění.

Musí to tak být: originál mění místnost **uprostřed průchodu** (`$8FE2 CALL
$882B`) a Charlie se posune až v nové kulise, takže se výměna nedá udělat
zprávou tam a zpátky. Model proto o čísle místnosti nerozhoduje – dostane
hotovou hrací plochu ve zprávě `room`.

Zástupné už není nic – pole `placeholder` ze snímku **zmizelo**. Co worker
nedělá, je vyjmenované na konci tohohle souboru; nic z toho není nahrazené
odhadem.

**Souřadnice jsou souřadnice stroje**, konkrétně bajty `+$01` a `+$02` záznamu
entity: `x` je levý okraj spritu a `y` je jeho **horní** pixelová řádka
(M1 tady tvrdila „spodní" – **je to horní**, `$9397` z `y` počítá znakový řádek
jako `y>>3` a spodní hranu obálky jako `y + výška`). Nic se nezaokrouhluje
a stav se dá porovnávat se záznamem entity v originálu bajt po bajtu.

### Tikot

Worker tiká na 50,08 Hz a **každý tik je jeden snímek**, protože v originálu
snižuje počítadlo skriptu Charlieho (`+$0B`) obsluha přerušení. Krok animace
z toho vychází **jednou za dva snímky** – rychlost chůze je 3 px za dva snímky.
Hlavní smyčka originálu má délku průchodu proměnnou (81 % jeden snímek, 12 %
dva – `tools/tracephysics.py`), ale na rychlosti hráče to nestojí, takže remake
tiká po snímcích a je to věrné.

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, lives, room, edition, physics, mole, spriteframes, scenery, rooms, world, scene}` | start nové hry. `headless: true` tiká jen na vyžádání zprávou `tick` (pro testy). |
| `controls` | `left`, `right`, `up`, `down`, `mode` (boolean) | úplný stav ovládání; posílá se při každé změně. |
| `pause` | – | zastaví tikání. |
| `continue` | – | pokračuje. |
| `tick` | – | jeden krok v režimu `headless`. |
| `reset` | – | zahodí stav (volá se při opuštění herní obrazovky). |

### Akce a proč jsou zrovna tyhle

Originál se ovládá **půlřádky kláves** a jejich význam se mění s režimem
(`ZADANI.md` §1, `sources/docs/instructions_transcript.md`):

| akce | astronaut | krtek | klávesy originálu |
|---|---|---|---|
| `left` / `right` | chůze | kopání do stran | dvě poloviny spodní řady (`CAPS Z X C V` / `SPACE SYM M N B`) |
| `up` | **skok** | kopání nahoru | `Q W E R` |
| `down` | **položit gravity stick** | kopání dolů | `A S D F` |
| `mode` | přepnout astronaut ↔ krtek | totéž | `1 2 3 4` |

Proto jsou akce čtyři plus přepínač, a ne šest: „skok" a „položit gravity
stick" **nejsou** v originálu samostatné klávesy, jsou to `up` a `down`
v režimu astronauta. Remake to nechává tak, jak to má originál.

★ **`mode` se posílá jako držení, ne jako nový stisk** – a je to tak správně.
M1 si ho latchovala, protože nebylo změřené, jak to dělá originál; **M4 to
změřila**: originál čte řadu kláves každý průchod a proti dvojímu spuštění se
brání sám. Po vypuštění krtka je v `$5B69` hodnota `$10` („hráč ještě nic
nestiskl") a dokud tam je, **přepínač se ignoruje** (`$A165`); zmizí, až hráč
klávesu pustí. Remake proto posílá surový stav řady a `molePhysics.js` má tentýž
sentinel.

A druhá věc, kterou M4 dotáhla: role řad kláves si **prohodí význam**, když je
pod povrchem v akci krtek (`$9A20`), takže `1 2 3 4` přepíná v obou směrech.
`CharliePhysics.readInput()` na to má parametr `moleActive`.

### `initData`

| klíč | obsah |
|---|---|
| `lives` | zásoba životů (`data/global.json`, změřené 3). |
| `room` | číslo místnosti v mřížce 16 × 16. |
| `edition` | ★ **48 nebo 128** – kterou edicí hra běží. Vybírá se dvěma položkami základního menu (`START GAME (ZX 48K)` / `START GAME (ZX 128K)`, `ZADANI.md` §0). **Herně z toho neplyne nic** a plynout nesmí: edice se liší **jen zvukem**, takže si to worker jen nese a hlásí zpátky, a **který zvukový subsystém z toho vyplyne, je M7**. `tools/runworker.js` ověřuje, že hra začíná v obou edicích na témže místě. |
| `physics` | `data/physics.json` – konstanty a skripty originálu. |
| `mole` | `data/mole.json` – konstanty, seznamy rámců a skripty krtka, tabulka děr a proud kousků stěny (M4). |
| `monsters` | `data/monsters.json` – konstanty, popisy šesti typů, seznamy rámců, tabulka 94 poletujících objektů a bajty jejich bajtkódu (M5). |
| `spriteframes` | `data/spriteframes.json` – hlavičky rámců, aby záznam entity seděl bajt po bajtu. |
| `scenery`, `rooms`, `world` | kulisa, obsah 256 místností a popis světa – worker si z nich **skládá místnosti sám**. Kolizní mapa je **bit 7 atributů**, které při skládání vzniknou (`sources/docs/disasm_notes.md` §8.1 a §10.5), takže se neposílá zvlášť. |
| `scene` | kde hra začíná: `{x, y}` v souřadnicích stroje; bez nich se vezme výchozí záznam Charlieho z originálu. |

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `frame`, `time`, `lives`, `alchiems`, `room`, `edition`, `charlie`, `mole`, `monsters`, `dig`, `transition`, `sounds`, `buzz`, `state` | jeden odtikaný krok. |
| `room` | `room`, `bitmap` (5376 B), `attributes` (672 B), `dugWalls` (256 B) | **hotová hrací plocha**: nová místnost, nebo tatáž s vyřezaným průchodem. Posílá se jen při změně. |
| `gameOver` | `time` | došly životy; model přepne na `GameOverModel`. |
| `error` | `message` | chybí data. |

Pole `placeholder` už neexistuje – fyzika je skutečná.

### `charlie`

`{x, y, sprite, visible, wrapped, bank, state}`:

* `x`, `y` – bajty `+$01` a `+$02` záznamu entity (`y` je **horní** řádka),
* `sprite` – číslo rámce (`+$1E`) **včetně bitu 7**. Bit 7 není druhá bitmapa
  (rámec `$80` míří na tutéž bitmapu jako `$00`), ale **je to zrcadlení**: říká,
  že se entita dívá doleva, a renderer kreslí tutéž bitmapu vodorovně
  převrácenou (`disasm_notes.md` §10.3). Zrcadlený rámec je hotový v datech
  (`data/spriteframes.json`, pole `mirror`),
* `visible` – bit 0 příznaků entity,
* `wrapped` – bit 7 příznaků: `x` přeteklo doleva, tj. je záporné,
* `bank` – která ze dvou tabulek rámců (`$B700`/`$C700`) se má číst; rozhoduje
  o tom **bit 6 příznaků entity** (`$8E87`). Charlie má bank 0, krtek bank 1,
* `state` – `walk`, `jump`, `fall`, a od M4 i `rise` (výstup šachtou) a `whirl`
  (whirlwind), podle `$5B0A` a `$A2B7`.

### `mole`

`{x, y, sprite, visible, wrapped, bank, mode, caught, digging, digRoom, digLeft}`
– záznam krtka (`$FDC0`) v témže tvaru, protože je to **tatáž entita**:

* `visible` – bit 0 příznaků; krtek je vidět jen když je v akci,
* `mode` – `man` nebo `mole`: **ikona v panelu**, kterou hra přepisuje
  (`$8273` / `$A0DD`),
* `caught` – `$A2B7` bit 0: Charlie krtka **má v zásobě** (uloveného),
* `digging` – `left`, `right` nebo `false`: která stěna se právě žere,
* `digRoom`, `digLeft` – která místnost a kolik kousků stěny zbývá (`$5B11`).

### `monsters`

`{monsters, objects, pickup, stick, energy, lives, sticks, alchiems, alchiemList,
wanted, wantedCount}` – všechno v bajtech záznamů, nic dopočítaného:

* `monsters` – tři sloty (`$FD00`, `$FD20`, `$FD40`); každý je `{x, y, frame, type}`,
  nebo `false`, když je slot prázdný. `type` je 1–6 (**6 je mugger**),
* `objects` – osm slotů (`$FC00`+) pro **poletující objekty** té které místnosti
  a jejích sousedek; týž tvar,
* `pickup` – co v místnosti leží (`$FD80`): alchiem, nebo mugger,
* `stick` – položený gravity stick (`$FDA0`), nebo `false`,
* `energy` – `$AAE3`; plná je **63**, a když klesne **pod nulu**, worker rovnou
  Charlieho odhodí (`$80A1`) a nejbližší dopad je smrtelný,
* `sticks` – kolik gravity sticků hráč má (`$7EE0` bity 0–2, nejvýš 4),
* `alchiems` / `alchiemList` – maska osmi slotů (`$5B01`) a jejich čísla po dvou
  bitech (`$5B02`); `alchiems` v `frame` je jen **kolik jich je**, pro panel,
* `wanted` / `wantedCount` – **který ze čtyř alchiemů se hledá** a kolik jich
  hráč má; na tom stojí konec hry i procento na závěrečné obrazovce.

★ Rozmístění nepřátel worker **nedostává** – žádné neexistuje. Losuje si je jako
originál a `MonsterLogic.report()` říká, kolikrát na to sáhl.

### `sounds` a `buzz` ★ M7

Zvuk originálu jde dvěma cestami a worker je drží obě, protože **oba zvukové
sloty přerušení jsou stav světa**, ne efekt modelu
(`sources/docs/disasm_notes.md` §13.3):

* **`sounds`** je seznam toho, co hra tenhle průchod **spustila**:
  `{sound, value}`. Zvuky slotu 1 (`alchiemTaken`, `monsterDeath`,
  `alchiemStolen`, `monolith`) nesou **bajt, který originál zapsal** do `$9C82`
  a `$9C87` – z něj plyne celý rozjezd i to, jak dlouho bude hrát, takže model
  zahraje celou vlnu rovnou. `modeChange` je pípnutí `$A2E5`.
* **`buzz`** je pole **hodnot slotu 2 za každý odtikaný snímek** od minulé
  zprávy (jeden snímek jsou čtyři pulzy, takže se posílají v hrsti). Worker do
  něj dává to, co do `$9CA5` píše herní kód: počítadlo položeného gravity
  sticku (`$7F3C`), `y` prvního nepřítele typu 3 v místnosti (`$A73D`) a při
  žraní stěny **náhodný bajt** (`$9BFD LD A,R`, který se reprodukovat nedá).
  Poslední zápis vyhrává, jako v hlavní smyčce originálu.

★ **Slot 1 umlčí slot 2.** Dokud rozjezdový zvuk dohrává, přerušení se ke
slotu 2 vůbec nedostane (`$9C84`), a worker proto do `buzz` posílá nulu –
rozhoduje o tom hra, ne model.

Model to přehrává `app/beeper.js` na dvou sběrnicích (`sounds` a `extra`,
`app/audioManager.js`), a `tools/matchsound.js` porovnává vlnu proti originálu
pulz po pulzu: **243 běhů, 191 073 pulzů, 0 rozdílů**.

### `dig`

`{side, bytes}`, a jen v těch průchodech, kdy krtek stěnu žere. `bytes` je
**96 bajtů bitmapy toho průchodu** (2 buňky × 6 řádků) – tolik a nic víc se
mění, takže se neposílá celá hrací plocha. Model je vloží
`ScreenComposer.setGapPixels()`.

`transition` je `{direction, x, y, dirs, dist}`, když Charlie vyšel z místnosti.
★ **Od M4 výměnu opravdu dělá worker** – zpráva je jen pro výpis stavu.

### `time` a `lives` jdou do panelu

Hodiny `TIME` a číslice `LIFE` jsou skutečná pole panelu originálu
(`data/panel.json` → `fields`), a `tools/matchpanel.py` ověřuje, že je remake
kreslí bajt po bajtu stejně jako originál – na třech zachycených snímcích
**nula rozdílů**.

★ **M4 přidala třetí skutečné pole panelu**: **ikonu člověk / krtek** vlevo dole.
M1 v display listu našla dva bloky 3 × 3 na tomtéž místě a druhý neumístila –
je to krtek (`$8273` kreslí blok 0, `$A0DD` blok 1). Nezávislé potvrzení:
tabulka atributů panelu z `$5D99` má na těch třech buňkách přesně hodnoty, které
tam píše `$8273`, tedy stav „člověk". `tools/matchpanel.py` zůstává na nule.

`alchiems` (osm políček) a **oscilograf energie** (dvě buňky) worker sice hlásí,
ale renderer je zatím kreslí tak, jak je má display list originálu: co do nich
hra po sebrání alchiemu a při ztrátě energie zapisuje, je otevřená otázka
(`ZADANI.md` §8). `tools/matchpanel.py` ty dvě buňky **vypíše**, neschovává.

## Co ve workeru po M5 chybí

- **Zamotání a teleport** (`$8466`, `$83ED`) – účinky doteku typů 4 a 5. Worker
  je pozná (`$AAE5`) a hlásí, ale samotné rutiny jsou v **Charlieho** větvi
  (`$7EE1`), tedy tam, kam sahá M3/M7, ne dispečer typů. Napsané je to
  i ve výpisu `matchmonsters.js`.
- ~~**Zvuk**~~ **Doplněno v M7** – viz „Zvuk" níž. Co ve workeru **pořád není**:
  128K zvukový subsystém (AY, hudba Freda Graye, hlášky), takže se obě edice
  chovají zvukově stejně a `tools/runworker.js` na tom trvá.
- **Kreslení spritů do stínového bufferu** (M7): remake kreslí až v rendereru,
  takže bajty `+$0E`–`+$1D` a bity 1–2 příznaků si záznam entity nevede
  a matchery je **vypisují, neschovávají**.
