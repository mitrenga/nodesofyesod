// begin code

/**
 * Krtek – **přepis rutin originálu**, ne vlastní model.
 *
 * Rozbor je v `sources/docs/disasm_notes.md` §11. Nejdůležitější věta na
 * začátek, protože se proti očekávání dost čte jinak:
 *
 * ★★ **Na krtkovi se nejezdí.** Charlie ho na povrchu **uloví** (`$9DD6`) a pak
 * ho pod povrchem **vypustí** (`$A098`). Krtek je od té chvíle druhá řízená
 * entita: hráč ovládá jeho, **Charlie zůstane stát tam, kde byl**, a když krtek
 * zmizí, Charlie se nikam nepřenese. Změřeno na originálu (`tools/molelog.py`):
 * záznam Charlieho se během jízdy krtka nezmění ani o bajt. Krtek tedy neslouží
 * k cestování, ale k tomu, aby **prokousal stěnu**, kterou pak Charlie projde –
 * a to je přesně to, co říká briefing („mole type creatures … eat the walls of
 * the sublunar caverns your best bet is to capture one of those to facilitate
 * travel through the caves").
 *
 * Zbytek plyne z toho, že krtek je **týž záznam entity** jako Charlie, jen na
 * `$FDC0` místo `$FDE0` – v originálu je to doslova jiné `IX` v týchž rutinách.
 * Proto tady nejsou žádné vlastní kolize ani vlastní pohyb: všechno jde přes
 * `charliePhysics.js` a jeho `useEntity()`.
 *
 * * **Nemá bit 4 příznaků** (`$A0FC` = `$03`), takže na rozdíl od Charlieho
 *   nevytlačuje sám sebe z podlahy ani ze stropu – ale ze **stěn** ho vytlačí
 *   `$9072`/`$9023` jako každou entitu, takže kulisou neprolítne. Změřeno.
 * * **Perioda `(+$0C)` je `$80`**, tj. počítadlo nikdy nedojde k odpočítání
 *   a krok se dělá **každý průchod** – krtek je proti Charlieho „3 px za dva
 *   snímky" rychlý: **4 px za průchod** (`$A1AB LD E,$04`).
 * * Když se na něm jezdí, **nemá bajtkódový skript, ale seznam rámců**
 *   (`$A2B8`, jeden bajt na průchod, nula je návrat na začátek). Bajtkódový
 *   skript téhož interpretu `$8EB2` má jen tehdy, když **vylézá z díry na
 *   povrchu** (`$A2BD`) a když **žere stěnu** (`$5B6A`/`$5B7C`).
 *
 * Co tenhle soubor **nedělá**: co znamená zabitá entita (tabulka typů je M5),
 * kdo Charliemu nastaví whirlwind (M5), zvuk žraní (M7). Kde na to originál
 * sahá, je tady příznak a `report()` to **vypíše**, neschová.
 */
class MolePhysics {

  /** Bity příznaků entity, které krtek používá (týž záznam jako Charlie). */
  static get E_VISIBLE() { return 0x01; }
  static get E_DIRTY() { return 0x02; }

  /** Bity `$5B0A`, které patří krtkovi a světu. */
  static get FLAG_DISMOUNT() { return 0x04; }   // běží seznam rámců sesedání
  static get FLAG_DIG_RIGHT() { return 0x08; }  // žere se pravá stěna
  static get FLAG_DIG_LEFT() { return 0x10; }   // žere se levá stěna
  static get FLAG_DIG() { return 0x18; }

  /**
   * Stínový buffer hrací plochy (`$E400`, §8.1). Adresy, které si kreslení
   * žrané stěny počítá (`$9C29`), jsou absolutní, takže se od téhle odečítají.
   */
  static get BUFFER() { return 0xE400; }

  /** Stínové atributy hrací plochy (`$F900`) – kolizní mapa. */
  static get ATTRS() { return 0xF900; }

  /** Bity `$A2B7`. */
  static get HAS_MOLE() { return 0x01; }        // krtek je uloven
  static get SURFACING() { return 0x02; }       // na povrchu vylézá z díry

  /**
   * @param {Object} physics - CharliePhysics; krtek jede na jeho rutinách.
   * @param {Object} mole - Parsed data/mole.json (tools/dumpmole.py).
   * @param {Object} world - WorldState; sem se zapisuje prokousaná stěna.
   * @param {Function} [random] - Co v originálu dělá `LD A,R` (`$A235`):
   *        vrací bajt 0-255. Nereprodukovatelné, proto je to vstup a `report()`
   *        to hlásí.
   */
  constructor(physics, mole, world, random) {
    if (!mole || !mole.constants || !mole.eatStream) {
      throw new Error('data/mole.json missing');
    }
    this.p = physics;
    this.k = physics.k;                       // konstanty už jsou slité (M4)
    this.world = world;
    this.random = random || (() => 0);
    this.eatStream = Uint8Array.from(mole.eatStream.bytes);
    this.eatRows = mole.eatStream.rows;
    this.holes = mole.surfaceHoles;
    this.startRecord = mole.mole.record;

    this.m = new Uint8Array(32);               // záznam krtka ($FDC0)
    // Hrací plocha, do které se žraní stěny zapisuje: bitmapa i atributy tak,
    // jak je složil roomScenery.js. Rozvržení bitmapy je **totéž**, jaké má
    // stínový buffer originálu, takže adresní aritmetika $9C29 platí i tady.
    this.surface = {bitmap: null, attributes: null};
    this.reset();
  } // constructor

  /** Nová hra: krtek nikde, nic uloveno, nic prokousaného. */
  reset() {
    for (var i = 0; i < 32; i++) { this.m[i] = 0; }
    this.direction = 0;              // $5B69 – poslední směr krtka
    this.mode = 'man';               // co ukazuje ikona v panelu ($8273/$A098)
    this.clock = 0;                  // $5B0E – jednotky hodin, viz surfaceStep()
    this.eating = false;             // který vektor je na $9CE6
    this.eatIndex = 0;
    this.digCounter = 0;             // $5B11
    this.digRoom = -1;               // kterou místnost to zrovna žere
    this.energySpent = 0;            // kolikrát se snížil $AAE3 (M5)
    this.kills = 0;
    this.sounds = [];
    this.unreproducible = 0;         // kolikrát se sáhlo na registr R
  } // reset

  /**
   * Hrací plocha, do které krtek zapisuje. Volá se po každém složení místnosti.
   * @param {Uint8Array} bitmap - Bitmapa hrací plochy (5376 B).
   * @param {Uint8Array} attributes - Atributy hrací plochy (672 B).
   */
  setSurface(bitmap, attributes) {
    this.surface.bitmap = bitmap || null;
    this.surface.attributes = attributes || null;
  } // setSurface

  /** `$FDC0` bit 0: je krtek vidět (a tedy v akci)? */
  visible() {
    return !!(this.m[0] & MolePhysics.E_VISIBLE);
  } // visible

  /** Má Charlie krtka? (`$A2B7` bit 0) */
  caught() {
    return !!(this.p.vars.a2b7 & MolePhysics.HAS_MOLE);
  } // caught

  /**
   * Co si z krtka odnese worker.
   * @return {Object|false} {x, y, sprite, visible, bank, mode} nebo false.
   */
  state() {
    var m = this.m;
    return {x: m[1], y: m[2], sprite: m[0x1E], visible: this.visible(),
            wrapped: !!(m[0] & 0x80), bank: (m[0] & 0x40) ? 0 : 1,
            mode: this.mode, caught: this.caught(),
            digging: this.eating || false,
            digRoom: this.digRoom, digLeft: this.digCounter};
  } // state

  /**
   * `$A34B`: výměna místnosti **vynuluje celou tabulku entit** `$FC00-$FDDF`
   * (`LD (HL),$00 / LDIR`, 480 B = 15 záznamů), a záznam krtka je jeden z nich;
   * Charlieho záznam na `$FDE0` zůstane. Krtek tedy s Charliem **nikam
   * necestuje** – a to je druhá polovina věty, kterou začíná tenhle soubor.
   *
   * Čím se tabulka hned nato **naplní** (nepřátelé té které místnosti,
   * `$A360`), je M5.
   */
  clearRecord() {
    for (var i = 0; i < 32; i++) { this.m[i] = 0; }
    this.direction = 0;
    this.eatIndex = 0;
  } // clearRecord

  /**
   * Krok, který v originálu dělá kterákoli rutina s `IX` na záznamu krtka.
   * @param {Function} body - Co se má udělat.
   * @return {*} Co vrátí `body`.
   */
  withMole(body) {
    var previous = this.p.useEntity(this.m);
    try { return body(); } finally { this.p.useEntity(previous); }
  } // withMole

  // ------------------------------------------------------ $9DD6 ulovení krtka

  /**
   * `$9DE6`: Charlie **uloví** krtka. Stačí, aby stál dost blízko: pod povrchem
   * musí být krtek o 8 až 19 px **níž** (na povrchu se dolní mez nekontroluje,
   * protože tam krtek vylézá z díry) a vodorovně do 16 px vpravo nebo 22 px
   * vlevo. Krtek zmizí, `$A2B7` bit 0 se nastaví a hra pípne (`$A2E5`).
   *
   * Nesahá se na to během přechodu mezi místnostmi (`$9DE2 AND $18`) – což je
   * tentýž pár bitů, který znamená „zrovna se žere stěna".
   */
  mountCheck() {
    var p = this.p, m = this.m, ch = p.e, k = this.k;
    if (p.vars.flags & MolePhysics.FLAG_DIG) { return; }
    if (!this.visible()) { return; }
    var dy = (m[2] - ch[2]) & 0xFF;
    if (p.vars.room >= p.caveRoom && dy < k.mountDyMin) { return; }
    if (dy >= k.mountDyMax) { return; }
    var dx = (ch[1] - m[1]) & 0xFF;
    var limit = k.mountDxRight;
    if (ch[1] < m[1]) {                        // $9E0B: přeteklo -> NEG
      dx = (-dx) & 0xFF;
      limit = k.mountDxLeft;
    }
    if (dx >= limit) { return; }
    m[0] &= ~MolePhysics.E_VISIBLE;            // $9E14
    p.vars.a2b7 &= ~MolePhysics.SURFACING;     // $9E1E
    p.vars.a2b7 |= MolePhysics.HAS_MOLE;       // $9E20
    this.showMan();                            // $9E22 CALL $8270
  } // mountCheck

  // -------------------------------------------------- $A098 vypuštění krtka

  /**
   * `$A098`: přepnutí astronaut → krtek. Podmínek je řada a všechny jsou
   * v originálu: pod povrchem, krtek uloven, Charlie není u pravého okraje ani
   * moc nízko ani se záporným `x`.
   *
   * ★ Jedna z nich je **chyba originálu a reprodukuje se**: `$A0A2` udělá
   * `LD HL,($7DDE) / LD A,H / OR L / JP C,$9FE4` – `OR` carry vždycky shodí,
   * takže ten skok se **nikdy neudělá**. Remake ho proto taky nedělá.
   *
   * Když podmínky nesedí, Charlie jen stojí (`$9FE4`).
   */
  spawn() {
    var p = this.p, m = this.m, ch = p.e, k = this.k;
    if (p.vars.f7ed9 & 0x02) { return; }                    // $A09F
    if (p.vars.room < p.caveRoom) { return p.stand(); }     // $A0AD
    if (!this.caught()) { return p.stand(); }               // $A0B5
    if (ch[1] + k.spawnMaxX > 0xFF) { return p.stand(); }   // $A0BD
    if (ch[2] === 0) { return p.stand(); }                  // $A0C6
    if (ch[2] >= k.spawnMaxY) { return p.stand(); }         // $A0CB
    if (ch[0] & 0x80) { return p.stand(); }                 // $A0D2 – x je záporné
    this.direction = k.dirInit;                             // $5B69 = $10
    p.vars.input = k.dirInit;                               // $5B0B = $10
    this.showMole();                                        // $A0DD-$A0F5
    m[0] = k.moleFlags;                                     // $A0FC
    m[1] = ch[1];                                           // $A100 – tam, kde stojí
    m[2] = ch[2];                                           // $A106
    m[9] = k.riddenScript & 0xFF;
    m[0x0A] = k.riddenScript >> 8;
    m[0x1E] = k.moleFrame;
    m[0x0B] = k.moleDelay;
    m[0x0C] = k.molePeriod;
    m[6] = k.moleStep;
    return this.pass();                                     // propadne do $A124
  } // spawn

  // ------------------------------------------------------- $A124 jeden průchod

  /**
   * `$A124`: co hra dělá s krtkem v jednom průchodu.
   *
   * Není to krok skriptu s počítadlem – krtek se hýbe **každý průchod**. Rámec
   * bere ze seznamu (`$A2B8`, jeden bajt na průchod) a posune se o **4 px** ve
   * všech směrech, které hráč drží (maska `$5B0B & $0F`, tytéž bity jako všude
   * jinde: 0 vpravo, 1 vlevo, 2 dolů, 3 nahoru). Kolize řeší `$9143` jako
   * u každé entity, takže krtka kulisa zastaví.
   */
  pass() {
    var p = this.p, m = this.m, k = this.k;
    if (p.vars.flags & MolePhysics.FLAG_DISMOUNT) { return; }   // $A12B
    if (!this.visible()) { return; }                            // $A12E
    if (p.vars.flags & MolePhysics.FLAG_DIG) {
      // $A137: dokud se žere stěna, běží skript kousání a nic víc
      this.withMole(() => p.scriptStep());
      m[0] |= MolePhysics.E_DIRTY;
      return;
    }
    // $A141: přepnutí zpátky na astronauta. Řady kláves jsou v tuhle chvíli
    // prohozené ($9A20), takže bit 4 je zas ta číselná řada – „1 2 3 4"
    // přepíná v obou směrech, jak to říká inlay.
    if (this.direction !== k.dirInit && (p.vars.input & 0x10)) {
      m[0] &= ~MolePhysics.E_VISIBLE;                           // $A14F
      this.showMan();                                           // $A156
      m[0] = k.moleFlags;                                       // $A159
      p.vars.flags |= MolePhysics.FLAG_DISMOUNT;                // $A160
      return this.startDismount();                              // $A162
    }
    // $A165: sentinel „krtek právě vylezl" zmizí, až hráč pustí přepínač
    if (p.vars.input !== 0x10 && this.direction === k.dirInit) { this.direction = 0; }
    // $A177: další bajt seznamu rámců; nula je návrat na jeho začátek
    var pointer = (m[9] + 256*m[0x0A] + 1) & 0xFFFF;
    if (p.byteAt(pointer) === 0) { pointer = k.riddenScript; }
    var horizontal = p.vars.input & 0x03;
    if (horizontal) { this.direction = horizontal; }             // $A187-$A191
    var facing = (this.direction & 0x02) ? 0x80 : 0x00;          // $A194
    var frame = p.byteAt(pointer);
    m[9] = pointer & 0xFF;
    m[0x0A] = pointer >> 8;
    this.withMole(() => {
      p.setFrame((frame + facing) & 0xFF);                       // $A1A2
      p.move(p.vars.input & 0x0F, k.moleMove);                   // $A1AD
    });
  } // pass

  // ------------------------------------------------- $A05A/$A04D sesedání

  /**
   * `$A05A`: nasadí seznam rámců sesedání a hned z něj vezme první rámec –
   * **bez** posunu ukazatele, ten se posouvá až v `dismountStep()`.
   */
  startDismount() {
    var p = this.p, m = this.m, k = this.k;
    var pointer = k.dismountScript;
    m[9] = pointer & 0xFF;
    m[0x0A] = pointer >> 8;
    var frame = p.byteAt(pointer);
    if (!frame) { return this.endDismount(); }
    this.withMole(() => p.setFrame(frame));
  } // startDismount

  /**
   * `$A04D`: jeden krok animace sesedání. Když seznam skončí (nula), krtek
   * zmizí – a hra sníží `$AAE3`. Ten globál je M5 (jeho bit 7 spouští
   * `$80A1`, tedy odhození), ale **kolik ho krtek spotřebuje, je vidět už
   * tady: jedno sesednutí = jedna jednotka**, a `report()` to hlásí.
   */
  dismountStep() {
    var p = this.p, m = this.m;
    if (!(p.vars.flags & MolePhysics.FLAG_DISMOUNT)) { return; }
    if (!this.visible()) { return; }
    var pointer = (m[9] + 256*m[0x0A] + 1) & 0xFFFF;
    var frame = p.byteAt(pointer);
    if (!frame) { return this.endDismount(); }                   // $A06F
    m[9] = pointer & 0xFF;                                       // $A08B
    m[0x0A] = pointer >> 8;
    this.withMole(() => p.setFrame(frame));                      // $A091
  } // dismountStep

  /** `$A071`: konec sesedání – krtek zmizí a `$AAE3` jde o jednu dolů. */
  endDismount() {
    var p = this.p, m = this.m;
    this.withMole(() => p.setFrame(m[0x1E]));                    // $A071
    m[0] &= ~MolePhysics.E_VISIBLE;                              // $A077
    p.vars.flags &= ~MolePhysics.FLAG_DISMOUNT;                  // $A07E
    this.energySpent++;                                          // $A083
    this.sounds.push('moleGone');
  } // endDismount

  // -------------------------------------------- $A1B3 prokousávání stěny

  /**
   * `$A1B3`: prokousávání stěny. Krtek musí být **na správné výšce**
   * (`y` mezi `$80` a `$85`, tj. uprostřed toho, kde bude průchod) a u té které
   * stěny, a stěna musí být **prokousatelná a ještě neprokousaná**
   * (`$A1DD AND $03 / CP $02`). Pak se do stavu místnosti zapíše bit 0
   * a začne se žrát: krtek se přenese k okraji, nasadí se skript kousání
   * a `$5B0A` dostane bit 3 (pravá stěna) nebo bit 4 (levá).
   *
   * ★ Levá stěna se zapisuje **sousedce vlevo**, protože průchod mezi dvěma
   * místnostmi je uložený jednou (`$A1F5` čte ukazatel `$5B05`).
   */
  digWall() {
    var p = this.p, m = this.m, k = this.k, world = this.world;
    if (!this.visible()) { return; }
    if (p.vars.flags & MolePhysics.FLAG_DISMOUNT) { return; }
    if (p.vars.flags & MolePhysics.FLAG_DIG) { return; }
    if (m[2] < k.digYMin || m[2] >= k.digYMax) { return; }
    var room = p.vars.room, script, target;
    if (m[1] < k.digXLeftMax) {                       // $A1F5 – levá stěna
      room = world.leftOf(p.vars.room);
      if (!world.canDig(room)) { return; }
      world.dig(room);
      p.vars.flags |= MolePhysics.FLAG_DIG_LEFT;
      target = k.digXLeft;
      script = k.digScriptLeft;
    } else {                                          // $A1D1 – pravá stěna
      if (((m[1] + m[3]) & 0xFF) < k.digXRightMin) { return; }
      if (!world.canDig(room)) { return; }
      world.dig(room);
      p.vars.flags |= MolePhysics.FLAG_DIG_RIGHT;
      target = k.digXRight;
      script = k.digScriptRight;
    }
    this.digRoom = room;
    m[1] = target;
    m[2] = k.digY;                                    // $A20F
    m[9] = script & 0xFF;
    m[0x0A] = script >> 8;
    this.sounds.push('moleDig');
  } // digWall

  /**
   * Co v originálu dělá **vektor na `$9CE6`**, který hlavní smyčka volá jednou
   * za průchod (`$9CE5`) – a je to jediná věc M4, která leží *před* průchodem
   * Charlieho, takže ji worker volá první.
   *
   * * Dokud se nic nežere, je tam `$9B76`: ten drží počítadlo `$5B11` na `$C0`
   *   a jak se objeví bit 3 nebo 4, přepne vektor na žraní.
   * * Při žraní je tam `$9B9D` (pravá stěna) nebo `$9BE1` (levá): každý průchod
   *   sní **jeden kousek 2 × 2 px** a sníží počítadlo. Na nule je hotovo
   *   (`$9C3D`).
   *
   * @return {boolean} Změnila se bitmapa?
   */
  digProgress() {
    var p = this.p, k = this.k;
    if (!this.eating) {                                   // $9B76
      this.digCounter = k.digCounter;
      if (p.vars.flags & MolePhysics.FLAG_DIG_LEFT) { this.eating = 'left'; this.eatIndex = 0; }
      else if (p.vars.flags & MolePhysics.FLAG_DIG_RIGHT) { this.eating = 'right'; this.eatIndex = 0; }
      return false;
    }
    var byte = this.eatStream[this.eatIndex];
    this.eatIndex = (this.eatIndex + 1) % this.eatStream.length;
    this.digCounter = (this.digCounter - 1) & 0xFF;        // $9BB2 DEC (HL)
    var done = this.digCounter === 0xFF;                   // $9BB5 INC A -> Z
    var side = this.eating;
    if (done) { this.finishDig(); }                        // $9BB6 CALL Z,$9C3D
    return this.eatChunk(side, byte);                      // $9C1F – a teprve pak kousek
  } // digProgress

  /**
   * Jeden kousek stěny. Bajt proudu (`$7666`) je dvojice
   * **(index dvojice pixelových řádků, který z osmi kousků řádku)**: dolních
   * pět bitů je řádek, horní tři kousek. Kousek je **dva pixely** – maska
   * `$3F` rotovaná vlevo (pravá stěna) nebo `$FC` rotovaná vpravo (levá) – a je
   * v jednom ze dvou sloupců průchodu podle bitu 2.
   *
   * Že to na sebe navazuje, ověřuje `tools/dumpmole.py`: prvních `$C0` bajtů
   * proudu je **permutace všech 24 × 8 kousků, každý právě jednou**, tedy
   * přesně obsah díry 2 × 6 buněk.
   * @param {string} side - 'left' nebo 'right'.
   * @param {number} byte - Bajt proudu.
   * @return {boolean} Změnila se bitmapa?
   */
  eatChunk(side, byte) {
    var bitmap = this.surface.bitmap;
    if (!bitmap) { return false; }
    var k = this.k;
    var row = byte & ((k.eatRowMask >> 1) & 0xFF);
    var chunk = byte >> 5;
    var far = (chunk >> 2) & 1;
    var column = (side === 'left') ? far : (k.eatColumnRight + (1 - far));
    var seed = (side === 'left') ? k.eatMaskSeedLeft : k.eatMaskSeedRight;
    var turns = 2*((chunk & 3) + 1);
    var mask = seed;
    for (var i = 0; i < turns; i++) {
      mask = (side === 'left') ? (((mask >> 1) | (mask << 7)) & 0xFF)
                               : (((mask << 1) | (mask >> 7)) & 0xFF);
    }
    // $9C29: adresa je $F100 + sloupec + řádek*64, tj. znakový řádek 13 stínového
    // bufferu – a rozvržení bufferu je totéž, jaké skládá roomScenery.js.
    var base = (k.eatBufferRow*256 - MolePhysics.BUFFER) + column + row*64;
    if (base < 0 || base + k.eatBufferStride >= bitmap.length) { return false; }
    bitmap[base] &= mask;
    bitmap[base + k.eatBufferStride] &= mask;
    return true;
  } // eatChunk

  /**
   * `$9C3D`: stěna je sežraná. Příznaky se shodí, vektor se vrátí na `$9B76`,
   * krtek se vrátí k seznamu rámců jízdy a **do stínových atributů se vyřeže
   * díra 2 × 6 buněk** – atribut nula, tedy i **bez bitu 7**, takže tou dírou
   * se od téhle chvíle dá projít. Bitmapu už nikdo nemaže; ta je snědená.
   * @return {boolean} Vyřezalo se to hned?
   */
  finishDig(attributes) {
    var p = this.p, m = this.m, k = this.k;
    if (!(p.vars.flags & MolePhysics.FLAG_DIG)) { return false; }
    var left = !!(p.vars.flags & MolePhysics.FLAG_DIG_LEFT);
    p.vars.flags &= ~MolePhysics.FLAG_DIG;                // $9C4D/$9C4F
    m[9] = k.riddenScript & 0xFF;                         // $9C55
    m[0x0A] = k.riddenScript >> 8;
    this.eating = false;
    this.digCounter = k.digCounter;
    this.digRoom = -1;
    this.sounds.push('moleThrough');
    var address = left ? k.gapAttrLeft : k.gapAttrRight;  // $9C5D/$9C64
    // Díru dostane **kolizní mapa fyziky** (to je ten $F900) i atributy plochy,
    // ze kterých se kreslí; jsou to v originálu tytéž bajty.
    var targets = [p.attributes, this.surface.attributes];
    var cut = false;
    for (var t = 0; t < targets.length; t++) {
      if (!targets[t]) { continue; }
      var index = address - MolePhysics.ATTRS;
      for (var row = 0; row < k.gapRows; row++) {
        targets[t][index] = 0;
        targets[t][index + 1] = 0;
        index += k.gapStride + 1;
      }
      cut = true;
    }
    return cut;
  } // finishDig

  // ------------------------------------------------- $A21A krtek na povrchu

  /**
   * `$A21A`: **krtek vylézá z díry na povrchu**. Nechodí kolem – vystrčí se
   * z jedné ze **šesti** děr (tabulka `$A299`, místnosti `$02 $06 $08 $09 $0C
   * $0F`), pohoupe se a zaleze zpátky. Když ho Charlie za tu dobu stihne
   * ulovit (`mountCheck()`), má krtka; když ne, musí čekat na dalšího.
   *
   * Kdy vyleze, řídí **jednotky hodin `TIME`** (`$5B0E`, `$9A7F` je zvyšuje
   * jednou za 50 snímků): musí mít **bit 1** (tj. sekundy končící 2, 3, 6, 7)
   * a k tomu se musí `LD A,R` shodnout s číslem místnosti. **Bit 0 týchž
   * jednotek** vybere jednu ze dvou děr té místnosti.
   *
   * ★ `LD A,R` je obnovovací registr Z80 a **reprodukovat se nedá**. Remake
   * proto losuje sám, `report()` to hlásí a `tools/matchentities.js` bere
   * vylezení z nahrávky, aby se za tím nic neschovalo.
   */
  surfaceStep() {
    var p = this.p, m = this.m, k = this.k;
    if (p.vars.room >= p.caveRoom) { return; }             // $A21F
    if (this.caught()) { return; }                         // $A223
    if (!(p.vars.a2b7 & MolePhysics.SURFACING)) {
      if (!(this.clock & 0x02)) { return; }                // $A22E
      this.unreproducible++;
      if ((this.random() & 0xFF) !== p.vars.room) { return; }   // $A235 LD A,R
      var hole = this.holeFor(p.vars.room);
      if (!hole) { return; }                               // $A248
      var place = (this.clock & 0x01) ? hole.odd : hole.even;
      this.emerge(place[0], place[1]);
    }
    // $A27D
    if (m[0x1E] === k.surfaceEndFrame) {                   // $A28F
      p.vars.a2b7 &= ~MolePhysics.SURFACING;
      m[0] &= ~MolePhysics.E_VISIBLE;
      return;
    }
    this.withMole(() => p.scriptStep());                   // $A284
    m[0] |= MolePhysics.E_DIRTY;
  } // surfaceStep

  /**
   * Díra té které místnosti.
   * @param {number} room - Číslo místnosti.
   * @return {Object|null} Záznam tabulky, nebo null.
   */
  holeFor(room) {
    for (var i = 0; i < this.holes.length; i++) {
      if (this.holes[i].room === room) { return this.holes[i]; }
    }
    return null;
  } // holeFor

  /**
   * `$A252`: krtek se postaví do díry a nasadí si skript vylézání.
   * @param {number} x - Sloupec v pixelech.
   * @param {number} y - Pixelová řádka.
   */
  emerge(x, y) {
    var p = this.p, m = this.m, k = this.k;
    m[1] = x;
    m[2] = y;
    m[0] = k.surfaceFlags;
    m[9] = k.surfaceScript & 0xFF;
    m[0x0A] = k.surfaceScript >> 8;
    m[0x1E] = k.surfaceFrame;
    m[0x0B] = k.surfaceDelay;
    m[0x0C] = k.surfacePeriod;
    m[6] = k.surfaceStep;
    p.vars.a2b7 |= MolePhysics.SURFACING;                  // $A27B
    this.sounds.push('moleSurface');
  } // emerge

  // ------------------------------------------- $9FED krtek žere nepřátele

  /**
   * `$9FED`: „Moon munching moles / Who'll eat up your foes". Obálka krtka se
   * porovná s obálkami entit od `$FD00` (kolik jich je, říká `$A5CB`) a která
   * se překrývá, dostane bit 1 příznaků a sníží `$AAE4`. Přeskočí se entity
   * s bitem 3 příznaků a s rámcem `$49`/`$4A`.
   *
   * **Tabulka typů entit je M5**, takže tady je jen ta zkouška, a co znamená
   * „zabitá entita", rozhodne dispečer typů. Dokud entity nejsou, `report()`
   * říká, že se nic neporovnávalo.
   * @param {Array} [entities] - Záznamy entit (Uint8Array po 32 B).
   * @return {number} Kolik jich krtek trefil v tomhle průchodu.
   */
  eatMonsters(entities) {
    var m = this.m, k = this.k;
    if (!this.visible()) { return 0; }
    if (!entities || !entities.length) { return 0; }
    var x0 = m[1], y0 = m[2];
    var x1 = (x0 + m[3]) & 0xFF, y1 = (y0 + m[4]) & 0xFF;
    var hits = 0;
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!(e[0] & 0x01)) { continue; }                    // $A007
      if (e[0] & 0x08) { continue; }                       // $A00D
      var frame = e[0x1E] & 0x7F;
      if (frame === k.monsterSkipA || frame === k.monsterSkipB) { continue; }
      if (e[1] >= x1) { continue; }                        // $A030
      if (((e[1] + e[3]) & 0xFF) < x0) { continue; }       // $A035
      if (e[2] >= y1) { continue; }                        // $A03A
      if (((e[2] + e[4]) & 0xFF) < y0) { continue; }       // $A03F
      e[0] |= 0x02;                                        // $A048
      hits++;
    }
    this.kills += hits;
    return hits;
  } // eatMonsters

  // ------------------------------------------------------------ panel a hodiny

  /** `$8273`: v panelu je vidět **člověk** (ikona je blok 0 display listu). */
  showMan() {
    this.mode = 'man';
    this.sounds.push('modeChange');
  } // showMan

  /** `$A0DD`: v panelu je vidět **krtek** (blok 1 téhož display listu). */
  showMole() {
    this.mode = 'mole';
    this.sounds.push('modeChange');
  } // showMole

  /**
   * Jednotky hodin `TIME` (`$5B0E`) – na nich stojí, kdy krtek na povrchu
   * vyleze a ze které díry.
   * @param {number} seconds - Celé sekundy od začátku hry.
   */
  setClock(seconds) {
    this.clock = seconds % 10;
  } // setClock

  /** Co remake neumí reprodukovat a nezakrývá. */
  report() {
    return {randomReads: this.unreproducible, kills: this.kills,
            energySpent: this.energySpent,
            note: 'vylezeni krtka na povrchu losuje original z registru R ($A235)'};
  } // report

} // class MolePhysics

if (typeof self !== 'undefined') { self.MolePhysics = MolePhysics; }
if (typeof module !== 'undefined' && module.exports) { module.exports = MolePhysics; }
