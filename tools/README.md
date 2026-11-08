# Nástroje

Nic z toho se neinstaluje do systému – všechno běží z tohoto adresáře.
SkoolKit 10.1 je **vendorovaný** v `vendor/` (bez pipu a venv), spouští se přes
`PYTHONPATH=tools/vendor`. Python 3, žádné další závislosti (PNG se skládá zlibem).

Metodika i většina kódu je **převzatá z `underwurlde/tools/`** – u ZX hry s rozlehlým
světem se ta pipeline osvědčila a nemá cenu ji psát znovu. Pravidlo zůstává:
**trasovat originál na jeho vlastní rutině, replayovat na tom kódu, který jde do
prohlížeče, a trvat na nule rozdílů.**

## M0 – co je hotové a funguje

| skript | co dělá |
|---|---|
| `mksnapshot.sh` | ze snapshotu v `sources/tape/` udělá `build/nodesofyesod-48k.z80`, surový obraz RAM `build/nodesofyesod-48k.bin` (`$4000–$FFFF`, 49152 B) a obrazovku `build/loading_screen.scr`/`.png`; ověří, že souhlasí s `sources/media/screens/loading_screen.scr`, a vypíše rozsah nenulové RAM. `./tools/mksnapshot.sh 128k` udělá totéž pro 128K edici, cesta z kazety (`*.tzx`/`*.tap`) je připravená pro případ, že se kazeta objeví |
| `scr2png.py` | ZX `.scr` (6912 B) → PNG; implementuje nelineární adresování obrazovky |
| `noydis.py` | disassembluje rozsah obrazu RAM (`./tools/noydis.py E200 E280`), `--words N` vypíše tabulku dvoubajtových slov (tabulky skoků a ukazatelů) |
| `playtrace.py` | spustí hru v simulátoru, odsimuluje stisky kláves (po půlřádcích jako na skutečném Spectru) a uloží snímky (PNG + `.scr`) a mapu pokrytí kódu. Klávesy a snímky jdou zadat z příkazové řádky: `--keys 1250:1270:1 --shots 1400,1600 --map build/coverage.txt` |
| `memtrace.py` | trasuje hru **s pořadím instrukcí a s přístupy do paměti**: volací strom, které instrukce kam zapisují, ze kterých spojitých úseků se čtou data, registry na sledovaných adresách. Tímhle se u Underwurlde našel formát dat místností – nejdřív se hra nechá běžet a zapíše se, co dělá, a teprve podle toho se disassembluje. Simulátor je tady čistě pythonový (paměť je obalená logováním), takže okno má být krátké – jednotky snímků |
| `mapcut.py` | vyřízne místnost `(sloupec 0–15, řádek 0–15)` ze screenshotové mapy světa; mřížka je **změřená z obrázku** (buňky 256 × 168 px, oddělovače 1 px), `--grid` ji vypíše |
| `dumpfont.py` | vytáhne z obrazu RAM znakovou sadu do `sources/media/font_charset.png`. Adresa se našla v M1 (`--base=7536 --index=order --chars=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ`), zadrátovaná ale není – bez `--base` nástroj odmítne pracovat |

Typický běh M0:

```sh
./tools/mksnapshot.sh
PYTHONPATH=tools/vendor ./tools/playtrace.py --frames 6000 --out build/walk \
    --keys 1250:1270:1 --keys 1400:1700:B --map build/coverage.txt
PYTHONPATH=tools/vendor ./tools/memtrace.py --from-frame 1500 --to-frame 1505 \
    --writes 4000:5B00 --reads 5B00:FFFF > build/memtrace-1500.txt
PYTHONPATH=tools/vendor ./tools/noydis.py 9B40 9B70
```

Nálezy patří do `sources/docs/disasm_notes.md`, symboly do `sources/asm/hints.txt`.

## M1 – kostra aplikace a panel

| skript | co dělá |
|---|---|
| `mkpanel.py` | vytáhne **celý panel** do `data/panel.json`: dlaždicovou tabulku z `$73E6` (8 B na buňku), display list z `$7387–$73E5` (řídicí bajt = `šířka<<4 \| výška`, pak indexy dlaždic) a 96 B atributů z `$5D99`. Polohy bloků v display listu nejsou – nástroj je **změří** tak, že každý blok najde ve videopaměti zachyceného snímku, a rovnou tím ověří, že sedí |
| `mkfont.py` | znaková sada hry z téže tabulky do `data/font.json` (mezera, `:`, `0`–`9`, `A`–`Z`, `©`); `--show` ji vypíše jako ASCII |
| `mkscreen.py` | ZX `.scr` → celá obrazovka 256 × 192 do `data/*.json` (loading screen, nabídka ovládání) |
| `mkroom.py` | ZX `.scr` → hrací plocha 256 × 168 (znakové řádky 0–20) do `data/roomNNN.json` |
| `mkimages.py` | z loading screenu udělá `images/cover.png`, `poster.png`, ikony aplikace a `favicon.ico` – čtvercový výřez je astronaut z originálu, nic dokresleného |
| `matchpanel.py` | **přejímací kritérium M1**: složí panel přesně tak, jak ho staví `app/screenComposer.js`, a porovná se snímkem běžící hry. Na třech snímcích **0 rozdílů**; dvě buňky oscilografu energie remake nekreslí a nástroj je **vypíše** |
| `runworker.js` | projde celou smyčku `app/gameWorker.js` bez prohlížeče (node): chůze, skok, přepnutí na krtka, smrtelný pád, dožití životů a `gameOver`, a ověří, že hodiny a životy dorazí až do panelu |
| `renderframe.js` | složí herní obrazovku (hrací plocha + panel) do PNG – kontrola očima bez prohlížeče. `--walk left\|right` drží klávesu, takže je vidět chůze a na ní **zrcadlené rámce** |

## M2 – extrakce dat z originálu

| skript | co dělá |
|---|---|
| `roomlib.py` | společný základ: rozehraje originál v simulátoru a umí spustit jeho **vlastní** rutinu kreslení místnosti (`$8857`) pro libovolné číslo místnosti; adresy stínových bufferů a tabulek světa jsou tady na jednom místě |
| `dumpgfx.py` | **kulisové bloky a pravidla skládání** → `data/scenery.json` a náhledy `sources/media/scenery/tiles*.png`. Kontrola úplnosti: každá tabulka dlaždic musí beze zbytku vyplnit svůj rozsah (délka dělitelná devíti) a display list musí končit přesně na ní |
| `dumprooms.py` | **všech 256 místností** – nekreslí je nástroj, ale **rutina originálu v simulátoru**. Krokuje se po instrukcích a zapisuje se, které bloky a dlaždice kam položila (`$8A87`, `$8A3B`), čím se vyplnil buffer a kde se shodil bit 7 atributů. Výstup: `data/world.json` (popis světa) a `data/rooms.json` (co kam originál položil) + referenční buffery do `build/rooms/` |
| `dumpsprites.py` | **tabulka spritů** → `data/spriteframes.json` a náhledový list `sources/media/sprites/spriteframes.png`. Rámce se čtou řetězem a ukazatele z obou tabulek slouží jako kontrola; co nenavazuje, se vypíše. Ke každému rámci ukládá i **`mirror`**, tutéž bitmapu vodorovně zrcadlenou (rámec s bitem 7 = pohled doleva, `disasm_notes.md` §10.3) |
| `matchscreen.py` | **přejímací kritérium M2**: složí každou místnost z bloků a pravidel a porovná ji se stínovým bufferem originálu. Hlásí rozdíly **a nevysvětlené buňky** – obojí musí být nula |
| `matchrooms.js` | totéž, ale **kódem, který jde do prohlížeče** (`app/roomScenery.js`) – aby remake nedělal něco jiného než ověřovací skript |
| `mapworld.py` | mapa světa z dat remaku (`build/mapworld.png`); `--check` ji porovná s dobovou screenshotovou mapou a tím ověří mřížku 16 × 16 i číslování `řádek*16 + sloupec` |

Typický běh M2:

```sh
./tools/dumpgfx.py --show                   # data/scenery.json + kontrola úplnosti
./tools/dumprooms.py --rooms 0-255          # data/world.json, data/rooms.json, build/rooms/
./tools/dumpsprites.py                      # data/spriteframes.json
./tools/matchscreen.py                      # 0 rozdílů, 0 nevysvětlených buněk
./tools/matchrooms.js                       # totéž v JS remaku
./tools/mapworld.py --scale 8 --check       # mapa světa + kontrola proti dobové mapě
./tools/renderframe.js --room 23            # jak to vypadá v remaku
```

## M3 – fyzika a ovládání Charlieho

| skript | co dělá |
|---|---|
| `physlib.py` | společný základ M3: rozehraný originál (rychle `CSimulator`, pro instrumentaci předá stav čistě pythonovému simulátoru), adresa a rozklad **záznamu Charlieho** `$FDE0` a kolizní mapa (**bit 7 stínového atributu**) na jednom místě |
| `dumpphysics.py` | **fyzika z originálu** → `data/physics.json`. Konstanty jsou **operandy skutečných instrukcí** a u každé se kontroluje, že na té adrese ta instrukce opravdu stojí – jinak nástroj skončí chybou místo aby vydal číslo. Skripty animace se ukládají jako **bajty originálu** a projdou se od všech vstupních bodů; kontrola úplnosti je **0 nedosažitelných bajtů** v bloku `$5BAF–$5D08` |
| `physlog.py` | nahraje **běh originálu** krok po kroku: vzorkuje na `$8F44` (začátek průchodu, který smyčka dělá s Charliem) a zapíše celý 32bajtový záznam, proměnné fyziky a kolizní mapu → `build/physruns/*.json` |
| `tracephysics.py` | **kadence hlavní smyčky jako histogram**, ne průměr (poučení z underwurlde M8), ve čtyřech scénách; a k tomu odstup kroků skriptu Charlieho ve snímcích |
| `matchphysics.js` | **přejímací kritérium M3**: pustí `app/charliePhysics.js` – **kód, který jde do prohlížeče** – na nahraných bězích průchod po průchodu a porovná záznam Charlieho **bajt po bajtu**. Stav se před každým průchodem nastaví z nahrávky, aby se chyba neschovala za driftem. **4100 průchodů, 0 rozdílů** |
| `runworker.js` | (z M1, přepsaný) celá smyčka workeru bez prohlížeče – od M3 už se skutečnou fyzikou |
| `renderframe.js` | (z M1, doplněný) herní obrazovka i s nakresleným Charliem do PNG |

Typický běh M3:

```sh
./tools/dumpphysics.py --show                  # data/physics.json + rozpis skriptů
./tools/physlog.py --suite                     # nahrát devět běhů originálu
                                               # (do build/, tedy mimo git)
./tools/matchphysics.js                        # 0 rozdílů
./tools/tracephysics.py --frames 400           # histogram kadence
node tools/runworker.js --verbose              # celá smyčka workeru
```

## M4 – krtek, stav světa a přechody

| skript | co dělá |
|---|---|
| `dumpmole.py` | **krtek a stav světa z originálu** → `data/mole.json`. Tatáž disciplína jako `dumpphysics.py`: 88 konstant jako **operandy ověřených instrukcí**, seznamy rámců a skripty jako **bajty originálu**, tabulka šesti děr na povrchu (`$A299`) a **proud kousků stěny** (`$7666`). Kontroly úplnosti: bloky `$A2B8–$A2E4` a `$5B6A–$5B8D` projít od všech vstupních bodů (**2 nedosažitelné bajty a je vysvětleno, proč**), a proud kousků musí být **permutace všech 24 × 8 kousků průchodu, každý právě jednou** |
| `molelog.py` | nahraje **šest běhů originálu s krtkem** (ulovení na povrchu, vypuštění, jízda, prokousání pravé i levé stěny včetně celého žraní, sesednutí, průchod Charlieho novou dírou). Vzorkuje se na `$8F44` jako v M3 a k záznamům obou entit se zapisuje **stav světa `$B600`**, kolizní mapa a **bitmapa obou průchodů** – pokaždé, když se změní. Cesta k tomu všemu jde **bez jediného sáhnutí do paměti hry**: krtka na povrchu se dá opravdu ulovit, když se u díry drží skok |
| `matchentities.js` | **přejímací kritérium M4**: pustí `app/molePhysics.js`, `app/charliePhysics.js` a `app/worldState.js` – **kód, který jde do prohlížeče** – na nahraných bězích průchod po průchodu a porovná **záznam krtka bajt po bajtu, stav světa, kolizní mapu a bitmapu žraného průchodu**. Stav se před každým průchodem nastaví z nahrávky. **1782 průchodů, 0 rozdílů** |
| `checkworld.py` | **model světa proti originálu**: aritmetika `$882B` pro **všech 256 místností × 4 směry** (torus), bajt `$B600` z rozehrané hry proti `data/world.json`, a u **všech 39 prokousatelných stěn** se nechá originál nakreslit průchod a zkontroluje se, že v obdélníku 2 × 6 buněk opravdu zmizel bit 7 atributu. **1024 + 256 + 39 kontrol, 0 rozdílů** |
| `runworker.js` | (z M1, doplněný) navíc: worker posílá hotovou hrací plochu, **přechod do sousední místnosti** opravdu vymění kulisu, a každá ohlášená místnost je sousedka té předchozí |
| `renderframe.js` | (z M1, doplněný) `--mole` je **kontrola očima pro M4**: krtek se vypustí, dojede do stěny, sní ji a je vidět hotový průchod i ikona v panelu |

Typický běh M4:

```sh
./tools/dumpmole.py --show                     # data/mole.json + rozpis skriptů a děr
./tools/molelog.py --suite                     # nahrát šest běhů s krtkem
                                               # (do build/, tedy mimo git)
./tools/matchentities.js                       # 0 rozdílů
./tools/checkworld.py                          # přechody, stav místností, průchody
node tools/runworker.js --verbose              # celá smyčka workeru včetně přechodů
node tools/renderframe.js --mole               # krtek a prokousaná stěna do PNG
```

## M5 – nepřátelé, alchiemy, muggeři a pravidla

| skript | co dělá |
|---|---|
| `dumpmonsters.py` | **nepřátelé a pravidla z originálu** → `data/monsters.json`. Táž disciplína: **147 konstant jako operandy ověřených instrukcí**, popisy šesti typů, seznamy rámců a bajtkód poletujících objektů jako **bajty originálu**. Kontroly úplnosti: blok seznamů rámců `$AA70–$AAC9` projít od všech vstupních bodů (**0 nedosažitelných bajtů**) a bajtkód objektů projít **jako interpret** – za `call` se skáče na cíl a `return` se vrací, a stav loopu je **dvojice (ukazatel, návrat)**, jinak by procházení skončilo po prvním návratu. `--show` vypíše typy, seznamy rámců, objekty po místnostech a rozebraný bajtkód |
| `monsterlog.py` | nahraje **šest běhů originálu** (dvě jeskyně s nepřáteli, chození po nich, dlouhé stání, dva běhy po povrchu kvůli poletujícím objektům). ★ Vzorkuje se na **`$A48F`**, tedy na začátku celé rutiny `$A479` – ne na dispečeru typů `$A5C6`, protože **na povrchu se do něj vůbec nevstoupí** (`$A5B6 CP $10`) a žádný nadzemní průchod by se nenahrál. K tabulce entit se zapisuje tabulka 94 objektů, jejich počítadla `$E180`, globály M5, paměť pěti místností, kolizní mapa a stav světa. ★ A **hodnoty, které originálu vyšly z registru `R`** – na dvanácti místech, spolu s počítadly `(+$0B)` a `$E180` z okamžiku, kdy je originál sám testuje |
| `matchmonsters.js` | **přejímací kritérium M5**: pustí `app/monsterLogic.js` nad `app/charliePhysics.js` a `app/worldState.js` – **kód, který jde do prohlížeče** – na nahraných bězích průchod po průchodu a porovná **záznamy tří nepřátel bajt po bajtu, tabulku 94 objektů, globály `$AAE2`–`$AAE5`, stav světa `$B600` v bitech 3–6 a paměť pěti místností**. Stav se před každým průchodem nastaví z nahrávky a hodnoty z `R` se podávají ve stejném pořadí; když se pořadí nebo počet rozejde, fronta dojde nebo zůstane nedočerpaná a nástroj to **vypíše**. **6557 průchodů, 0 rozdílů**. Na konci navíc říká, **co ty běhy nepotkaly** – alchiem, muggera, gravity stick ani monolit |
| `dumpsprites.py` | (z M2, opravený v M5) čte **tabulky rámců z rozehrané hry**, ne ze statického obrazu: deset bajtů `$C7C4–$C7CD` je po nahrání nulových a hra je vyplní až při rozehrání. Oblast bitmap, kam ty sloty míří (`$5FF9–$60A7`), si **dopočítá z jejich ukazatelů**, nezadává se ručně. Přibylo tím **pět rámců** – čtyři alchiemy a mugger, tedy zrovna ty, bez kterých se alchiem nedá sebrat |
| `runworker.js` | (z M1, doplněný) navíc M5: rozehrání rozmístí **32 alchiemů a 6 muggerů**, monolit je o `$10` místnosti dál než ukazatel hledaného alchiemu, na povrchu se žádný nepřítel nelosuje a v jeskyni ano, **alchiem jde sebrat a mugger dopadnout** (obojí ve všech 256 místnostech), **dotek monolitu hru dohraje**, a energie ubývá a pod nulou odhazuje. Tohle jsou přesně ty cesty, které nahrané běhy nepotkaly – proti originálu odměřené nejsou, ale že drží pohromadě, se hlídá |

Typický běh M5:

```sh
./tools/dumpmonsters.py --show                 # data/monsters.json + rozpis typů a objektů
./tools/monsterlog.py --suite                  # nahrát šest běhů (do build/, mimo git)
./tools/matchmonsters.js                       # 0 rozdílů
node tools/runworker.js --verbose              # celá smyčka workeru včetně nepřátel
```

## M6 – ovládání na dotykové obrazovce

| skript | co dělá |
|---|---|
| `runtouch.js` | prověří **dotykové ovládání** bez prohlížeče a bez telefonu. M6 nemá co porovnávat s originálem – dotykovou obrazovku originál neměl, a přejímací kritérium je proto skutečný telefon. Tohle dělá to, co ověřit jde: bere **rozvržení z `app/gameApp.js`** a **kód z `app/roomModel.js`** (obojí to, co jde do prohlížeče – model se nahraje do atrapy prostředí stejně, jako `runworker.js` nahrává worker) a trvá na tom, že z posloupnosti doteků vyjde ta posloupnost zpráv `controls`, kterou od nich čeká worker. Zkouší obě poloviny naráz, mrtvou zónu páčky, krtkovo kopání do dvou směrů zároveň, **přepnutí rozvržení spolu s režimem** (včetně toho, že se přepínač sám znovu nezmáčkne a páčka si nechá směr), krátký stisk držený dost dlouho, aby ho worker uviděl, variantu pro leváky, hromadné puštění doteků při odchodu z obrazovky – a že rozvržení i ikony existují pro každou variantu a každý režim |
| `dumpsprites.py` | (z M2, doplněný v M6) navíc **pravidlo zápisu atributu spritu** (`$940E`–`$9445` a `$8871`–`$8887`) do `data/spriteframes.json` → `attributes`, jako operandy ověřených instrukcí: z rámce jen inkoust, papír z pozadí, a jen do buněk pozadí |
| `runworker.js` | (z M1, doplněný) navíc M6: **atribut spritu nechává papír pozadí a nepřebarvuje kulisu** – kontrola toho, co remake dělal špatně (černé obdélníky kolem Charlieho na povrchu) |

Typický běh M6:

```sh
./tools/runtouch.js --verbose                  # 30 kontrol dotykového ovládání
./tools/dumpsprites.py                         # data/spriteframes.json vč. pravidla atributu
node tools/runworker.js --verbose              # mj. atribut spritu
```

## M7 – zvuk 48K edice

| skript | co dělá |
|---|---|
| `soundlib.py` | společný základ M7: **jak se z originálu měří zvuk**. Zvuková rutina se pustí v simulátoru a zapíše se, po kolika T-stavech přepnula bit 4 portu `$FE` – k tomu se používá `Tracer.audio_log` SkoolKitu, tedy **odtikaný čas, ne dopočítaný z tabulky časů instrukcí**. Rutiny se volají napřímo: na zásobník se dá návratová adresa-sentinel a běží se, dokud se na ni nedojde |
| `dumpsound.py` | **zvuk 48K edice z originálu** → `data/sound.json`. Táž disciplína jako `dumpphysics.py`: 36 konstant jako **operandy ověřených instrukcí**, tabulka 48 period a šest melodií jako **bajty originálu**. Navíc **měří časy smyček**: na naměřené délky pulzů se proloží lineární model a nástroj **trvá na přesné shodě** (jinak skončí chybou), a tónová smyčka se ověří na **48 tónech × 4 délkách**. Kontrola úplnosti: tabulka period a melodie musí **beze zbytku vyplnit blok `$614C`–`$62AB`** (mezi ukazatelem na tabulku period a tabulkou kulisových sad `$62AC` z M2) – **0 nedosažitelných bajtů**. ★ A vytáhne **digitalizovanou řeč**: 4246 bajtů jednobitového vzorku z `$E23E` |
| `soundlog.py` | nahraje **zvuk originálu** do `build/soundruns/*.json`: 192 tónů (48 period × 4 délky), **všech šest melodií celých**, oba přerušovací sloty pro sedmnáct hodnot, surovou tónovou smyčku pro deset period (z ní je složený teleport) a **celou řeč**. Obdoba `physlog.py`/`molelog.py`, jen se místo záznamů entit nahrávají pulzy |
| `matchsound.js` | **přejímací kritérium M7 pro zvuk**: pustí `app/beeper.js` a `data/sound.json` – **kód a data, která jdou do prohlížeče** – na nahraných bězích a porovná **délku každého pulzu v T-stavech**. **243 běhů, 191 073 pulzů, 0 rozdílů.** Na konci říká, co se porovnat nedá: výšku tónu žraní stěny a závěrečného odletu bere originál z registru `R` |
| `runworker.js` | (z M1, doplněný) navíc M7: worker drží **oba zvukové sloty přerušení jako stav světa** a hlásí bzukot slotu 2 v každém snímku (`buzz`); kontroluje se i délka rozjezdového zvuku, řeči a titulní hudby |

Typický běh M7:

```sh
./tools/dumpsound.py --show                    # data/sound.json + rozpis melodií
./tools/soundlog.py                            # nahrát zvuk originálu (do build/)
./tools/matchsound.js                          # 0 rozdílů
node tools/runworker.js --verbose              # celá smyčka workeru včetně zvuku
```

## Co se doplní v dalších milnících

| milník | skripty |
|---|---|
| M7 (zbytek) | `dumpay.py` (zvukový subsystém 128K: přehrávač AY je v bance 6 snapshotu, `$C10F`–`$C2AF`), kreslení spritů do stínového bufferu a border jako efekt |

## Poznámky, které stojí za připomenutí

- **Ne všechno je v obrazu po nahrání.** Tabulku obrácených bajtů na `$FE00` si hra
  dopočítá při startu a stav místností na `$B600` si při startu upraví (shodí prokousané
  stěny, rozmístí alchiemy losem z registru `R`). Dumpery M2 proto berou paměť
  **z rozehrané hry**, ne ze statického obrazu, a co se losuje, **vypisují**.
- **Obraz RAM je rovnou runtime podoba**, protože pochází ze snapshotu po nahrání –
  posun bloku o bajt, který u Underwurlde rozsypal disassembly, se tady neřeší
  (ale že si hra bloky nepřesouvá sama, ověřené není).
- **Zarovnání instrukcí** se ověřuje mapou pokrytí (`--map`), ne odhadem. Adresa, která
  v pokrytí není, může být uprostřed instrukce – proto značky `[LEAD]` v `hints.txt`.
- Co se reprodukovat nedá (losování z registru `R` a podobně), se **vypíše, ne schová**.
  V M4 jsou to dvě věci: rozmístění alchiemů (`$86EA`) a **kdy krtek vyleze z díry na
  povrchu** (`$A235`). `matchentities.js` proto vylezení bere z nahrávky a napíše to.
  V M5 je takových míst **dvanáct** (typ i pozice nového nepřítele, `$A436` a `$A5E0`,
  a chování typů 1 a 2). `monsterlog.py` nahrává **hodnoty, které z nich vyšly**,
  a `matchmonsters.js` je podává ve stejném pořadí – takže se rozejití pořadí nebo počtu
  **pozná**, místo aby se schovalo za jiným losem.
- **`exec_map` v SkoolKitu se volá *po* provedení instrukce.** Kdo nahrává hodnotu
  registru, musí probovat adresu **toho** `LD A,R`, ne tu za ním – jinak dostane
  hodnotu už upravenou tím, co následuje (`$A444 LD A,R / ADD A,$40`).
- **Instrumentované trasování je pomalé, tak se nejdřív rozehraje.** `physlib.Session`
  rozehraje hru rychlým céčkovým simulátorem a teprve pak předá stav (paměť i registry,
  včetně času v T-stavech, aby sedělo číslování snímků) pythonovému simulátoru
  s obalenou pamětí. Rozehrání do hry stojí desetinu sekundy místo minut.
- **Průchod hlavní smyčkou se nekryje se snímkem.** Kdo porovnává stav po průchodech,
  musí počítat s tím, že přerušení může padnout doprostřed – proto `physlog.py` nahrává
  počítadlo `+$0B` i v okamžiku, kdy ho originál sám testuje. Od M5 platí totéž
  i pro **počítadla poletujících objektů** (`$E180`, `$A4A2`) – snižuje je totéž
  přerušení `$9CC7`.
