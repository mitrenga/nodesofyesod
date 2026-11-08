# Nodes of Yesod – remake pro prohlížeč

Věrný remake hry **Nodes of Yesod** (Odin Computer Graphics, 1985, ZX Spectrum 48K)
v JavaScriptu nad vlastní knihovnou **svision**, `ZXPlatform` 256 × 192 + border.
Stejná struktura a stejná disciplína jako **jetsetwilly**, **manicminer** a
**underwurlde**.

**Pravidlo projektu: nic se nedokresluje a nic se nevymýšlí.** Co nejde vytáhnout
z originálu, je otevřená otázka (`ZADANI.md` §8), ne odhad.

★ **Jedna hra, dva zvukové režimy.** Edice 48K a 128K se liší **jen ve zvuku** (herní
mapa, grafika i gameplay jsou stejné), takže se nedělají dvě větve projektu: herní kód je
jeden a 128K je jiný zvukový subsystém – tři kanály AY, hudba Freda Graye, digitalizovaná
řeč a hlášky. Volí se to dvěma položkami základního menu — **`START GAME (ZX 48K)`** a
**`START GAME (ZX 128K)`** — a volba jde do hry jako parametr. **Zvuk 48K edice
dodala M7** a sedí na T-stav proti originálu; **128K subsystém (AY, hudba Freda
Graye, hlášky) zbývá**, takže se zatím obě edice liší jen titulní obrazovkou
(`ZADANI.md` §0).

- Zadání: [`ZADANI.md`](ZADANI.md)
- Milníky a stav: [`MILNIKY.md`](MILNIKY.md)
- Podklady z originálu: [`sources/README.md`](sources/README.md)
- Nástroje: [`tools/README.md`](tools/README.md)
- Data remaku: [`data/README.md`](data/README.md)
- Protokol workeru: [`app/WORKER-PROTOCOL.md`](app/WORKER-PROTOCOL.md)

## Stav: **M6 hotový, M7 rozdělaný** – hra je dohratelná, ovladatelná dotykem a **zní**

(Z M6 zbývá vyzkoušet dotyk na skutečném telefonu. Z **M7 je hotový celý zvuk
48K edice** – odměřený proti originálu na 0 rozdílů, včetně **digitalizované
řeči, která se našla v paměti**; zbývají grafické položky a 128K zvukový
subsystém, `MILNIKY.md`.)

Co běží:

- kostra aplikace svision: nabídka (**dvě položky `START GAME`, 48k a 128k**), jméno
  hráče, hall of fame, hlasitost, nastavení a remap kláves, mapa světa, ukázka nahrávání
  z kazety, about, pauza, konec hry;
- **titulní obrazovka** = nabídka ovládání originálu, **v obou edicích** (48K a 128K se
  liší copyrightem), a **loading screen** originálu, obojí bajt po bajtu z videopaměti
  běžící hry;
- **herní obrazovka**: hrací plocha 256 × 168 nahoře, složená z **kulisových bloků
  originálu** (`app/roomScenery.js`), a **panel dole** z dlaždicové tabulky a display
  listu samotné hry;
- **worker** tiká na 50,08 Hz a drží protokol; hodiny `TIME`, číslice životů `LIFE`
  a **ikona člověk/krtek** v panelu jdou z něj, a od M4 je to on, kdo drží celý svět
  (perzistentní stav i skládání místností);
- **mapa světa** v menu kreslí skutečných 256 místností obarvených podle sady kulisy;
- **Charlie chodí, skáče a padá** – `app/charliePhysics.js` je přepis rutin originálu
  a kreslí se skutečnými rámci z tabulky spritů. V menu je **`PHYSICS SANDBOX`**:
  jedna místnost originálu, ve které si to jde vyzkoušet;
- od M5 **hra má pravidla**: v jeskyních se losují nepřátelé šesti typů, po světě
  poletují objekty, které Charlieho roztočí a berou energii, alchiemy se sbírají do
  osmi slotů, muggeři je kradou a po dopadení dávají život, plnou energii a gravity
  sticky – a dotek monolitu s hledanými alchiemy hru **dohraje**;
- ★ od M7 **hra zní**: titulní obrazovka pronese **digitalizované uvítání**
  originálu (4246 bajtů jednobitového vzorku z `$E23E`, 11 111 Hz — **z týchž
  bajtů, ne z nahrávky**) a pak hraje dokola **titulní hudbu** ze sedmi dílů,
  a ve hře je slyšet sebraný alchiem, zabitý nepřítel, krádež muggera,
  dopadení muggera, přepnutí člověk/krtek a **bzučení krtka, který žere stěnu**
  — všechno syntetizované jako **jeden bit portu `$FE`**, tak jak to dělá stroj
  (`app/beeper.js`, `data/sound.json`);
- od M6 se **hra dá hrát na dotykové obrazovce**: obrazovka je na dvě poloviny (páčka
  a akce, ve variantě **pro praváky i pro leváky**) a **rozvržení se přepíná s režimem** –
  astronaut chodí do dvou směrů a skáče, krtek kope do čtyř. Doteků může být víc naráz,
  páčka je absolutní s mrtvou zónou, a ťukací akce (přepnutí režimu, gravity stick) se
  drží tak dlouho, aby je worker na 50,08 Hz stihl uvidět (`app/roomModel.js`).

Co M2 vytáhla z originálu:

| co | kde v originálu | výsledek |
|---|---|---|
| kulisa | `$62AC` tabulka sad, dlaždice po **9 bajtech** (8 bitmapy + atribut), display listy | `data/scenery.json` – 493 dlaždic, 60 bloků |
| svět | `$B500` sada + tvar místnosti, `$882B` přechody (**torus 16 × 16**) | `data/world.json` |
| místnosti | kreslicí rutina `$8857` spuštěná v simulátoru pro všech 256 místností | `data/rooms.json` |
| **perzistentní stav** | `$B600` – **bit 0 = prokousaná pravá stěna**, bit 1 = prokousatelná | v datovém modelu remaku od začátku |
| sprity | `$B700`/`$C700` tabulky rámců, hlavička `(šířka, výška, atribut)` + bitmapa | `data/spriteframes.json` – **136 rámců** (5 z nich doplnila až M5, viz níž) |

**Přejímací kritérium splněno:** místnost složená z bloků a pravidel dá **tytéž bajty**
jako kreslicí rutina originálu – na všech 256 místnostech 0 rozdílů v bitmapě, 0
v atributech, 0 nevysvětlených buněk. Ověřené dvakrát nezávisle: `tools/matchscreen.py`
(Python) a `tools/matchrooms.js` (**kód, který jde do prohlížeče**). Mřížka 16 × 16
navíc sedí i proti dobové screenshotové mapě (`tools/mapworld.py --check`).

### Co M3 vytáhla z originálu

**Charlie nemá „fyziku" v obvyklém smyslu** – nemá zrychlení ani setrvačnost. Je to
entita řízená **bajtkódovým skriptem animace**, a kolize se řeší tak, že se posun zkusí
a pak vytlačí zpátky.

| co | kde v originálu | výsledek |
|---|---|---|
| záznam Charlieho | `$FDE0`, poslední z 16 entit po `$20` B od `$FC00` | pole `+$01` x, `+$02` y, `+$06` krok 3 px, `+$0B/$0C` počítadlo |
| skripty animace | `$5BAF–$5D08`, interpret `$8EB2` | `data/physics.json` – **celý blok, 0 nedosažitelných bajtů** |
| kolizní mapa | **bit 7 stínového atributu** `$F900` (blit ho maskuje `AND $7F`) | dostala se „zadarmo" už z M2 |
| pohyb a kolize | `$9143`, `$9072`/`$9023`/`$90EA`/`$90C0`, obálka `$9397` | `app/charliePhysics.js` |
| pád a smrt pádem | `$810A`, počítadlo `$8180` = `$20` kroků, `$81CE` | **rozhoduje počet kroků pádu, ne rychlost dopadu** |
| ovládání | `$9A1B` (celé řady kláves), `$9F37` | vstupní bajt `$5B0B` |
| herní tik | histogram `tools/tracephysics.py` | průchod smyčkou **není** konstantní, ale krok Charlieho je **2 snímky** |

**Přejímací kritérium splněno:** `tools/matchphysics.js` pustí `app/charliePhysics.js` na
devíti nahraných bězích originálu průchod po průchodu a porovná 32bajtový záznam Charlieho
bajt po bajtu – **4100 průchodů, 0 rozdílů**. Neporovnává se počítadlo `+$0B` (vede ho
přerušení) a bajty kreslení `+$0E`–`+$1D` (M7); nástroj to **vypíše**.

### Co M4 vytáhla z originálu

★★ **Na krtkovi se nejezdí.** Charlie ho na povrchu **uloví** (musí na něj skočit –
krtek vylézá z díry *nad* úroveň, na které Charlie stojí), pod povrchem ho
**vypustí** a od té chvíle ovládá jeho; Charlie zůstane stát tam, kde byl. Krtek
není doprava, ale **nástroj na prokousání stěny**, kterou pak Charlie projde – což
je doslova to, co říká briefing.

| co | kde v originálu | výsledek |
|---|---|---|
| záznam krtka | `$FDC0`, **tatáž entita s týmiž rutinami** jako Charlie | `app/molePhysics.js` – žádný vlastní pohyb, jen jiné `IX` |
| ulovení / vypuštění / sesednutí | `$9DD6`, `$A098`, `$A14F` → `$A2DF` | `$A2B7` bit 0; ikona **člověk/krtek** v panelu |
| jízda | `$A124`: **4 px za průchod**, rámce ze seznamu `$A2B8` | krtek je rychlejší než Charlie a stěnou neprolítne |
| prokousání stěny | `$A1B3`/`$A1DD` → `$B600` bit 0, žraní `$9B9D` 192 průchodů | `app/worldState.js`; proud kousků `$7666` je **permutace bez zbytku** |
| krtek na povrchu | `$A21A`, tabulka děr `$A299` (6 děr) | vylezení losuje `LD A,R` – **vypíše se, neschová** |
| krtek žere nepřátele | `$9FED` | zkouška hotová, význam zásahu je M5 |
| přechody | `$8FC1` → `$882B`, torus 16 × 16 | worker si místnost skládá **uprostřed průchodu** |
| šachta a whirlwind | `$9FC2`/`$9E33` (místnost `$66`), `$8019` | `$A2B7` bity 7 a 4 |
| ikona v panelu | `$8273` / `$A0DD`, bloky 0 a 1 display listu | ★ **odpověď na otevřenou otázku M1** |

**Přejímací kritérium splněno:** `tools/matchentities.js` pustí `app/molePhysics.js`
na šesti nahraných bězích originálu průchod po průchodu a porovná záznam krtka,
**stav světa `$B600`**, kolizní mapu i bitmapu žraného průchodu – **1782 průchodů,
0 rozdílů**. K tomu `tools/checkworld.py`: **1024 přechodů (256 × 4 směry) + 256
stavů místností + 39 průchodů, 0 rozdílů**. A `tools/matchphysics.js` je po opravě
dvou obrácených větví pohybu **pořád na nule** (4100 průchodů).

### Co M5 vytáhla z originálu

★★ **Rozmístění nepřátel po světě žádná tabulka není.** V podzemních místnostech se
nepřátelé **losují za běhu** (šance 1/64 na volný slot a průchod) a hra si je pamatuje
jen pro **posledních pět** navštívených místností. Nadzemní místnosti a místnost
monolitu nepřátele nemají vůbec. Tabulku má **typ**, ne umístění.

★★ **A oprava M0:** tabulka od `$AAED` má **94 záznamů po 8 bajtech**, ne 80 od
`$AAF4` – M0 četla adresu **pole**, ne záznamu. A nejsou to typy entit, ale
**poletující objekty**, každý s vlastním bajtkódem (jiný interpret než M3) a se
schopností přejít do sousední místnosti sám. To ony Charlieho roztočí.

| co | kde v originálu | výsledek |
|---|---|---|
| šest typů nepřátel | popisy `$AACA–$AAE1`, seznamy rámců `$AA70–$AAC9` | `data/monsters.json` – **0 nedosažitelných bajtů** |
| losování a paměť | `$A5E0` (1/64), `$A2F4`/`$A360`, paměť `$5B34` (5 × 10 B, LRU) | rozmístění v datech není a být nemůže |
| „zabitá entita" | bit 1 → bit 3, seznam rámců `$AAC4` | krtek (M4), dotek Charlieho i gravity stick |
| poletující objekty | `$AAED–$ADDC` (94 × 8 B), bajtkód `$A8AC`, počítadlo `$E180` | pohybují se **po celém světě**, torus 16 × 16 |
| **whirlwind** | `$A560` – dotek objektu | ★ **odpověď na otevřenou otázku M4**; stojí 2 jednotky energie |
| **gravity stick** | vstupní bajt `$04` (řada `A S D F …`), `$7DDE` = 512 průchodů | ★ **odpověď na otevřenou otázku M3**; nepřátele stáhne k zemi a zabije |
| alchiemy | `$B600` bit 6 + čísla v bitech 4–5, osm slotů `$5B01`/`$5B02` | ★ **devátý se nedá vzít, jen vyměnit** |
| muggeři | krádež `$A771`, dopadení `$8381` | **život navíc, plná energie a čtyři sticky** naráz |
| energie | `$AAE3`, plná `$3F` = 63 | ★ klesá **pod nulu** → odhození a **smrtelný** nejbližší dopad |
| monolit a konec | `$8584` losuje místnost i hledaný alchiem, `$A838` odlet | závěrečná obrazovka s kódem 2 |
| **bodování** | `$9938`, `$99A5` | ★ **žádná průběžná rutina neexistuje** – je to procento na konci |
| ★ **oprava M2** | `$C7C4`–`$C7CD` je po nahrání nulové, hra to vyplní až při rozehrání | **pět chybějících rámců** (čtyři alchiemy a mugger) v oblasti `$5FF9–$60A7` |

**Přejímací kritérium splněno:** `tools/matchmonsters.js` pustí `app/monsterLogic.js`
na šesti nahraných bězích originálu průchod po průchodu a porovná záznamy tří nepřátel,
tabulku 94 objektů, globály `$AAE2`–`$AAE5`, stav světa `$B600` v bitech 3–6 a paměť
pěti místností – **6557 průchodů, 0 rozdílů**. Co originál bere z registru `R` (dvanáct
míst), se **nahrává a podává ve stejném pořadí**, takže se rozejití pozná; M3 i M4
zůstávají na nule.

Co v M5 **záměrně** není: zvuk a kreslení spritů (M7); dotykové ovládání dodala M6.
A co těch šest běhů **nepotkalo**, matcher říká nahlas: alchiem ani mugger v místnosti,
gravity stick a monolit – losování při rozehrání je v tomhle snapshotu nedalo do
místnosti, kam se bez delší cesty s krtkem dojde. Kód pro ně hotový je a
`tools/runworker.js` ho zkouší zvlášť, ale proti originálu odměřený není.

### Co M7 vytáhla z originálu

★★ **Zvuk téhle hry nejsou data, ale rutiny** – je to jeden bit portu `$FE`.
M7 přečetla celý zvukový blok a přepsala ho do prohlížeče tak, že sedí
**na T-stav**.

| co | kde v originálu | výsledek |
|---|---|---|
| tón | `$873C` → `$876E`, tabulka 48 period `$614C` | ★★ **dva čítače** o periodách `n` a `n−1` přepínají týž bit, takže se tón sám do sebe rozeznívá |
| melodie | `$8726`, seznamy `$613C` (7 dílů) a `$614A` | ★ **ve hře žádná hudba nehraje** – melodie jsou jen dvě, titulní a závěrečná |
| fanfára / pípnutí | `$83BA` (dopadený mugger), `$A2E5` (člověk/krtek) | pevné smyčky, půlvlna `16·dělitel + 33` T |
| **slot 1 přerušení** | `$9C82`/`$9C87` | rozjezd, který si přerušení **dohraje samo** a **umlčí přitom slot 2** |
| **slot 2 přerušení** | `$9CA5` | jeden snímek: gravity stick, nepřítel typu 3, animace smrti a **žraní stěny** (`$9BFD LD A,R`) |
| ★★ **digitalizovaná řeč** | `$E200` → `$E23E`, 4246 B | **je v paměti**: 1 bit na vzorek, **11 111 Hz, 3,12 s** – kazeta na ni potřeba nebyla |
| časy smyček | změřené v simulátoru | průchod tónovou smyčkou **77 T**, přetočení čítače **+9 T**, režie přehrávače **123 T** na notu |

**Přejímací kritérium splněno:** `tools/matchsound.js` pustí `app/beeper.js`
a `data/sound.json` – **kód a data, která jdou do prohlížeče** – na nahraném
zvuku originálu a porovná **délku každého pulzu v T-stavech**: **243 běhů,
191 073 pulzů, 0 rozdílů**. V tom je 192 tónů, **všech šest melodií celých**,
oba sloty přerušení a **celá řeč**. Kontrola úplnosti dat vyšla taky na nulu:
tabulka period a melodie **beze zbytku vyplní blok `$614C`–`$62AB`**.

Co se reprodukovat **nedá** a neschovává se: výšku tónu **žraní stěny**
a **závěrečného odletu** bere originál z registru `R`. Remake za ně losuje
a matcher to říká na konci každého běhu.

Co v M7 **zbývá**: kreslení spritů do stínového bufferu, border jako efekt,
**128K zvukový subsystém** (přehrávač AY je v bance 6 snapshotu, `$C10F`–`$C2AF`)
a závěrečná obrazovka s animací smrti a teleportem.

Podrobně `sources/docs/disasm_notes.md` §8 až §13, data `data/README.md`.

## Spuštění

```sh
cp config/config.php.sample config/config.php   # a doplnit přístup k databázi
mysql < config/createDB.sql
php ../svision/tools/svtool build bundle        # js/bundle.<verze>.min.js
php ../svision/tools/svtool build debug-bundle  # nezminifikovaná varianta do js/
php ../svision/tools/svtool verify              # bundle, standalone, graf importů, ES2018
```

**Na vývoji se buildovat nemusí.** Dokud v `js/` není `bundle.<verze>.min.js`,
`importPath()` servíruje aplikaci **přímo z `app/`**, takže změna ve zdrojích je
vidět hned. Celé `js/` je jen build artefakt (je v `.gitignore`) – **starý bundle
v něm ale přebije zdroje**, takže se maže.

Soubory, které si načítá **worker vlastní URL** (`charliePhysics.js`,
`molePhysics.js`, `worldState.js`, `roomScenery.js`, `monsterLogic.js`), jsou
v `config/compile.json` v seznamu `standalone`. Do bundlu se nedostanou a ani
by nemohly: **worker je klasický, ne modulový**, a bere si je přes
`importScripts()`. Proto v nich není `export` ani `import` – končí dvojicí

```js
if (typeof self !== 'undefined') { self.CharliePhysics = CharliePhysics; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CharliePhysics; }
```

kde v prohlížeči platí první řádek a v Node druhý. Modulový worker
(`{type:'module'}`) by byl hezčí, ale umí ho až Chrome 80 / Safari 15 – starší
televize tu volbu ignorují a worker by jim spadl. Nástroje v `tools/` si ty
soubory načítají přes `app/svision/tools/classicScript.cjs`.

Vývojový server (nginx, `config/nginx.conf` je produkční vzor) servíruje adresář
projektu; `index.php` je jediný vstupní bod (`appData.db`, `hallOfFame.db`,
`saveGame.db`, `stats.db`, `version.db`, `manifest.webmanifest`, `serviceWorker`,
`/about`). **Všechna data hry jdou v `appData.db` při startu aplikace** a klient si je
uloží do `localStorage`; modely pak čtou jen odtud, viz `data/README.md`.

## Testy

```sh
./tools/matchpanel.py                                   # panel vs. originál, 0 rozdílů
./tools/matchpanel.py sources/media/screens/gameplay_cave.scr --time 34
./tools/matchscreen.py                                  # 256 místností vs. originál, 0 rozdílů
./tools/matchrooms.js                                   # totéž kódem remaku
./tools/mapworld.py --check                             # mřížka 16 × 16 vs. dobová mapa
node tools/runworker.js --verbose                       # celá smyčka workeru bez prohlížeče
node tools/renderframe.js --room 23                     # herní obrazovka do build/gfx/*.png
./tools/dumpphysics.py --show                           # fyzika z originálu -> data/physics.json
./tools/physlog.py --suite                               # nahrát devět běhů originálu
./tools/matchphysics.js                                 # fyzika remaku vs. originál, 0 rozdílů
./tools/tracephysics.py                                 # kadence hlavní smyčky jako histogram
./tools/dumpmole.py --show                              # krtek z originálu -> data/mole.json
./tools/molelog.py --suite                              # nahrát šest běhů s krtkem
./tools/matchentities.js                                # krtek a stav světa vs. originál, 0 rozdílů
./tools/checkworld.py                                   # přechody, stav místností a průchody
node tools/renderframe.js --mole                        # krtek a prokousaná stěna do PNG
./tools/runtouch.js                                     # dotykové ovládání obou režimů
./tools/dumpsound.py --show                             # zvuk 48K z originálu -> data/sound.json
./tools/soundlog.py                                     # nahrát zvuk originálu (mimo git)
./tools/matchsound.js                                   # zvuk remaku vs. originál, 0 rozdílů
```

## Licence

Kód remaku CC BY-NC-SA (viz `LICENSE`). Originální hra a její grafika patří jejím
autorům (Odin Computer Graphics); obraz hry **do gitu nepatří**, jen hashe a návod
(`sources/tape/README.md`).
