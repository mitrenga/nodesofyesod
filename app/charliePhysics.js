// begin code

/**
 * Charlie: fyzika a ovládání – **přepis rutin originálu**, ne vlastní model.
 *
 * Rozbor je v `sources/docs/disasm_notes.md` §10. Ve zkratce, protože na tom
 * stojí celý tenhle soubor:
 *
 * * Charlie **je záznam entity** – 32 bajtů na `$FDE0` (poslední z šestnácti
 *   záznamů po `$20` od `$FC00`). Pole jsou pojmenovaná v `data/physics.json`.
 * * Nehýbe se podle vzorce, ale podle **bajtkódového skriptu** animace, který
 *   interpretuje rutina `$8EB2`. Krok skriptu = dvojice (číslo rámce, příkazy);
 *   příkaz `move` říká **směr a vzdálenost**, takže profil skoku je v datech
 *   originálu, ne v konstantě remaku.
 * * Skript tiká **jednou za `(+$0C)+1` snímků** – u Charlieho jednou za dva.
 *   Počítadlo `(+$0B)` snižuje přerušení každý snímek (`$9CC7`) a krok se udělá,
 *   až má nastavený bit 7.
 * * Kolizní mapa je **bit 7 stínového atributu** hrací plochy (`$F900`). Blit ho
 *   maskuje `AND $7F`, takže se na obrazovku nedostane – je to příznak „pevná
 *   buňka". Skládání místnosti ho už umí (`roomScenery.js`, ověřeno M2).
 * * Pohyb je vždycky **zkusit a vytlačit**: `$9143` posune souřadnici a pak
 *   rutiny `$9072`/`$9023`/`$90EA`/`$90C0` posunují po pixelu zpátky, dokud se
 *   obálka spritu dotýká pevné buňky.
 *
 * Chyby originálu se **reprodukují, neopravují** – proto je tady bajtová
 * aritmetika (`& 0xFF`) a proto se pohyb „doprava o E a zároveň doleva o E"
 * (`dir = 3`) dělá tak, jak ho dělá originál: jako zkouška obou stěn.
 *
 * ★ **M4** k tomu přidala tři věci, které v originálu leží v témže průchodu
 * a bez kterých by pořadí operací nebylo pořadí originálu (`$80C8`):
 *
 * * celý **strom krtka** (`$9DD6`) běží uprostřed průchodu, a teprve za ním
 *   ovládání a krok skriptu. Vlastní krtek je `molePhysics.js`; tady je jen
 *   místo, kam se zavěsí (`this.mole`), protože v originálu je to jedna
 *   a tatáž rutina s jiným `IX`.
 * * **výstup šachtou** (`$A2B7` bit 7, `$9E33`) – „gusty up draught" z briefingu:
 *   v místnosti `$66` znamená skok stoupání, ne skok.
 * * **whirlwind** (`$A2B7` bit 4, `$8019`) – Charlie se roztočí a je odnesen
 *   vzhůru. Co ten bit **nastaví**, je entita (M5); tady je jízda.
 *
 * Co tenhle soubor **nedělá** a dělat nemá: nepřátelé, alchiemy, energie
 * a omráčení (M5), kreslení (M7). Kde na ně originál sahá, je tady příznak
 * a `report()` to **vypíše**, neschová.
 */
class CharliePhysics {

  /** Bity `$5B0A` – příznaky hry, jak je čtou rutiny fyziky. */
  static get FLAG_ACTION() { return 0x01; }   // běží řízená akce (skok, dopad)
  static get FLAG_FALLING() { return 0x02; }  // padá
  // ★ **Oprava M3**: M3 tyhle dva bity pojmenovala „chystá se přechod doleva /
  // doprava". **Nejsou to přechody.** Nastavuje je jedině prokousávání stěny
  // ($A1E7 pravá, $A203 levá) a shazuje je jedině jeho konec ($9C4D/$9C4F).
  // Pro pohyb znamenají „posun tím směrem se přijme bez vytlačení ze zdi",
  // protože krtek do té zdi právě leze (M4, §11).
  static get FLAG_DIG_RIGHT() { return 0x08; }
  static get FLAG_DIG_LEFT() { return 0x10; }
  static get FLAG_DIG() { return 0x18; }

  /** Bity příznaků entity `(+$00)`. */
  static get E_VISIBLE() { return 0x01; }
  static get E_DIRTY() { return 0x02; }
  static get E_COLLIDES() { return 0x10; }
  static get E_BANK0() { return 0x40; }
  static get E_XWRAP() { return 0x80; }

  static get COLS() { return 32; }
  static get ROWS() { return 21; }
  static get ATTRS() { return 0xF900; }       // stínové atributy = kolizní mapa
  static get SCREEN() { return 0x5800; }      // co vrací $9397

  /**
   * @param {Object} physics - Parsed data/physics.json (tools/dumpphysics.py).
   * @param {Object} sprites - Parsed data/spriteframes.json; z něj se berou
   *        hlavičky rámců, aby záznam seděl bajt po bajtu jako v originálu.
   * @param {Object} [mole] - Parsed data/mole.json (M4). Bez něj se chová jako
   *        v M3: krtek, šachta ani whirlwind nejsou.
   */
  constructor(physics, sprites, mole) {
    if (!physics || !physics.constants || !physics.scriptBlock) {
      throw new Error('data/physics.json missing');
    }
    if (!sprites || !sprites.banks || !sprites.frames) {
      throw new Error('data/spriteframes.json missing');
    }
    this.pendingBlocks = [];
    this.k = {};
    Object.keys(physics.constants).forEach((key) => { this.k[key] = physics.constants[key]; });
    if (mole && mole.constants) {
      // Konstanty krtka jsou tytéž operandy skutečných instrukcí, jen z jiných
      // rutin (tools/dumpmole.py); jmenné množiny se neprotínají.
      Object.keys(mole.constants).forEach((key) => {
        if (this.k[key] !== undefined) { throw new Error('constant clash: '+key); }
        this.k[key] = mole.constants[key];
      });
      // Bloky skriptů krtka se přidají, až bude pole scriptBlocks.
      Object.keys(mole.blocks || {}).forEach((key) => {
        this.pendingBlocks.push(mole.blocks[key]);
      });
    }
    this.fields = physics.charlie.fields;
    this.startRecord = physics.charlie.record;
    // Bloky skriptů se adresují **adresou originálu**, protože skripty na sebe
    // ukazují absolutně (opkód „call"). M4 přidává bloky krtka ($A2B8 a $5B6A),
    // které leží jinde než blok Charlieho ($5BAF).
    this.scriptBlocks = [{base: physics.scriptBlock.base,
                          bytes: Uint8Array.from(physics.scriptBlock.bytes)}];
    this.scriptBase = physics.scriptBlock.base;
    this.script = this.scriptBlocks[0].bytes;
    this.pendingBlocks.forEach((block) => this.addScriptBlock(block.base, block.bytes));
    this.pendingBlocks.length = 0;
    this.banks = sprites.banks.map((bank) => bank.frames);
    this.sprites = sprites.frames;

    this.e = new Uint8Array(32);              // záznam Charlieho ($FDE0)
    this.attributes = new Uint8Array(CharliePhysics.ROWS*CharliePhysics.COLS);
    this.vars = {room: 0, flags: 0, input: 0, lastDir: 0, a2b7: 0, f7ed9: 0, f7ee0: 0};
    this.fall = {active: false, step: 0, counter: 0, savedFrame: 0};
    this.pending = null;                      // přechod do jiné místnosti
    this.outside = 0;                         // čtení kolizní mapy mimo hrací plochu
    this.mole = null;                         // MolePhysics ($FDC0), M4
    this.reset();
  } // constructor

  /**
   * Nová hra: záznam Charlieho z originálu, žádné příznaky.
   * @param {Object} [start] - {record, room, x, y} – co se má přepsat.
   */
  reset(start) {
    start = start || {};
    var record = start.record || this.startRecord;
    for (var i = 0; i < 32; i++) { this.e[i] = record[i]; }
    if (start.x !== undefined) { this.e[1] = start.x & 0xFF; }
    if (start.y !== undefined) { this.e[2] = start.y & 0xFF; }
    this.vars = {room: start.room === undefined ? 0 : start.room,
                 flags: 0, input: 0, lastDir: 0, a2b7: 0, f7ed9: 0, f7ee0: 0};
    this.fall = {active: false, step: 0, counter: 0, savedFrame: 0};
    this.pending = null;
    this.outside = 0;
    this.died = false;
  } // reset

  /**
   * Kolizní mapa místnosti: **bit 7 atributů**, tak jak je složí roomScenery.
   * @param {number} room - Číslo místnosti (0-255).
   * @param {Uint8Array} attributes - 672 B atributů hrací plochy.
   */
  setRoom(room, attributes) {
    this.vars.room = room & 0xFF;
    this.attributes.set(attributes.subarray(0, this.attributes.length));
  } // setRoom

  // ------------------------------------------------------------- $9A1B vstup

  /**
   * Vstupní bajt `$5B0B` z kláves – přepis rutiny `$9A1B`.
   *
   * Originál nečte klávesy, ale **celé řady**, a role dvou z nich si podle
   * situace prohazuje: bit 4 (skok) bere z písmenné řady, dokud není v akci
   * krtek, jinak z číselné, a bit 3 (přepnutí) naopak (`$9A20`-`$9A33`).
   * Spodní řada je rozdělená **obtýkaně**: `CAPS X V SYM N` je vlevo,
   * `Z C SPACE M B` vpravo (`AND $AA` / `AND $55` na `$9A68`).
   *
   * @param {Object} rows - Stisknuté řady: {bottomLeft, bottomRight, letters,
   *        middle, numbers} – boolean.
   * @param {boolean} moleActive - Je krtek v akci (`$FDC0` bit 0) a jsme pod povrchem.
   * @return {number} Bajt `$5B0B`.
   */
  static readInput(rows, moleActive) {
    var byte = 0;
    if (rows.bottomRight) { byte |= 0x01; }         // Z C SPACE M B
    if (rows.bottomLeft) { byte |= 0x02; }          // CAPS X V SYM N
    if (rows.middle) { byte |= 0x04; }              // A S D F G H J K L ENTER
    if (moleActive ? rows.numbers : rows.letters) { byte |= 0x10; }
    if (moleActive ? rows.letters : rows.numbers) { byte |= 0x08; }
    return byte;
  } // readInput

  // ------------------------------------------------------- $9397 buňky spritu

  /**
   * `$9397`: obálka spritu v znakových buňkách. Vrací adresu levé horní buňky
   * v atributech obrazovky (`$5800`), počet řádků a sloupců – oříznuté tak, jak
   * je ořezává originál, včetně toho, že `y >= 168` znamená „nad hrací plochou".
   * @return {Object} {addr, rows, cols}
   */
  cells() {
    var e = this.e;
    var y = e[2], x = e[1];
    var rows = (((y & 7) + 7 + e[4]) >> 3) & 0x1F;
    var cols = (((x & 7) + 7 + e[3]) >> 3) & 0x1F;
    var row = y >> 3, col = x >> 3;
    var a;
    if (y < this.k.playHeight) {                     // CP $A8 -> carry
      a = y + this.k.playBottom + e[4];
      if (a > 0xFF) {                                // sprite přetéká dolů
        a &= 0xFF;
        do { rows = (rows - 1) & 0xFF; var borrow = a < 8; a = (a - 8) & 0xFF; }
        while (!borrow);
      }
    } else {                                         // y je „záporné" – nad plochou
      row = 0;
      a = y;
      do { rows = (rows - 1) & 0xFF; var carry = a + 8 > 0xFF; a = (a + 8) & 0xFF; }
      while (!carry);
    }
    if (e[0] & CharliePhysics.E_XWRAP) {             // x přeteklo doleva
      col = 0;
      a = x;
      do { cols = (cols - 1) & 0xFF; var c2 = a + 8 > 0xFF; a = (a + 8) & 0xFF; }
      while (!c2);
    } else {
      a = x + ((e[3] - 1) & 0xFF);
      if (a > 0xFF) {                                // sprite přetéká doprava
        a &= 0xFF;
        do { cols = (cols - 1) & 0xFF; var b2 = a < 8; a = (a - 8) & 0xFF; }
        while (!b2);
      }
    }
    return {addr: (CharliePhysics.SCREEN + row*32 + col) & 0xFFFF, rows: rows, cols: cols};
  } // cells

  /**
   * Kolizní mapa na adrese, jak ji adresují rutiny originálu (`$F900` + offset).
   * Čtení mimo hrací plochu se **počítá a hlásí**, nezakrývá.
   * @param {number} addr - 16bitová adresa.
   * @return {number} Bajt atributu.
   */
  attribute(addr) {
    var index = (addr & 0xFFFF) - CharliePhysics.ATTRS;
    if (index < 0 || index >= this.attributes.length) { this.outside++; return 0; }
    return this.attributes[index];
  } // attribute

  // -------------------------------------------------------- $8E64/$8E80 skript

  /**
   * Přidá další blok skriptů (M4: bloky krtka `$A2B8` a `$5B6A`).
   * @param {number} base - Adresa v originálu, na které blok začíná.
   * @param {Array|Uint8Array} bytes - Bajty bloku tak, jak leží v paměti.
   */
  addScriptBlock(base, bytes) {
    this.scriptBlocks.push({base: base, bytes: Uint8Array.from(bytes)});
  } // addScriptBlock

  /**
   * Bajt na adrese originálu, ať leží v kterémkoli bloku skriptů.
   * @param {number} addr - Adresa.
   * @return {number} Bajt, nebo 0 mimo bloky.
   */
  byteAt(addr) {
    for (var i = 0; i < this.scriptBlocks.length; i++) {
      var block = this.scriptBlocks[i];
      var index = addr - block.base;
      if (index >= 0 && index < block.bytes.length) { return block.bytes[index]; }
    }
    return 0;
  } // byteAt

  /**
   * `LD IX,nn`: na kterém záznamu entity rutiny pracují. Krtek je v originálu
   * doslova tytéž rutiny s jiným `IX` (`$FDC0` místo `$FDE0`), takže si ho
   * `molePhysics.js` na dobu svých kroků přepne sem.
   * @param {Uint8Array} record - 32bajtový záznam.
   * @return {Uint8Array} Ten předchozí, ať se dá vrátit.
   */
  useEntity(record) {
    var previous = this.e;
    this.e = record;
    return previous;
  } // useEntity

  /** `$8E64`: přečte bajt skriptu a posune ukazatel. */
  fetch() {
    var e = this.e;
    var pointer = e[9] + 256*e[0x0A];
    var byte = this.byteAt(pointer);
    if (!(e[0] & 0x20)) {
      pointer = (pointer + 1) & 0xFFFF;
      e[9] = pointer & 0xFF;
      e[0x0A] = pointer >> 8;
    }
    return byte;
  } // fetch

  /** `$8E80`: nastaví rámec spritu – hlavičku i ukazatel na bitmapu. */
  setFrame(number) {
    var e = this.e;
    e[0x1E] = number & 0xFF;
    var bank = (e[0] & CharliePhysics.E_BANK0) ? 0 : 1;
    var slot = number & 0x7F;
    var index = this.banks[bank][slot];
    if (index === undefined || index < 0) { return; }  // slot, kam se nemíří
    var frame = this.sprites[index];
    e[3] = frame.width;
    e[4] = frame.height;
    e[5] = frame.attribute;
    var bitmap = (frame.address + 3) & 0xFFFF;
    e[7] = bitmap & 0xFF;
    e[8] = bitmap >> 8;
    e[0] |= CharliePhysics.E_DIRTY | CharliePhysics.E_VISIBLE;
  } // setFrame

  /**
   * `$8EB2`: jeden krok skriptu, když je na něj řada.
   * @return {boolean} Udělal se krok?
   */
  scriptStep() {
    var e = this.e;
    if (!(e[0x0B] & 0x80)) { return false; }
    e[0x0B] = e[0x0C];
    this.setFrame(this.fetch());
    var last = false;
    while (!last) {
      var command = this.fetch();
      var op = (command >> 4) & 7;
      last = (command & 0x80) !== 0;
      if (op === 1) {
        this.move(command & 0x0F, e[6]);
      } else if (op === 2) {
        var distances = this.fetch();
        this.move(command & 0x0C, distances & 0x0F);
        this.move(command & 0x03, distances >> 4);
      } else if (op === 5) {
        var lo = this.fetch(), hi = this.fetch();
        e[0x0D] = e[9];
        e[0x1F] = e[0x0A];
        e[9] = lo;
        e[0x0A] = hi;
        if (e[0] & CharliePhysics.E_COLLIDES) {
          this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
        }
      } else if (op === 6) {
        e[9] = e[0x0D];
        e[0x0A] = e[0x1F];
      }
    }
    if (e[0] & CharliePhysics.E_XWRAP) {
      if (((e[1] + e[3]) & 0x100) === 0) { e[0] &= ~CharliePhysics.E_VISIBLE; }
    }
    return true;
  } // scriptStep

  // ------------------------------------------------------------ $9143 pohyb

  /**
   * `$9143`: posune Charlieho o `dist` ve všech směrech masky `dirs`
   * (bit 0 vpravo, 1 vlevo, 2 dolů, 3 nahoru) a nechá kolize vytlačit zpátky.
   * Maska 3 (vpravo i vlevo naráz) je idiom originálu pro **zkoušku obou stěn**.
   * @param {number} dirs - Maska směrů.
   * @param {number} dist - Vzdálenost v pixelech.
   */
  move(dirs, dist) {
    var e = this.e;
    if (!dirs) { return; }
    e[0] |= CharliePhysics.E_DIRTY;
    var a = e[1], carry;
    if (dirs & 1) {
      a += dist;
      carry = a > 0xFF;
      a &= 0xFF;
      if (carry) {
        if (!(e[0] & CharliePhysics.E_XWRAP)) { e[0] &= ~CharliePhysics.E_VISIBLE; return; }
        e[0] &= ~CharliePhysics.E_XWRAP;
      }
      a = this.moveRight(a, dist);
    }
    if (dirs & 2) {
      var borrow = a < dist;
      a = (a - dist) & 0xFF;
      if (borrow) { e[0] |= CharliePhysics.E_XWRAP; }
      a = this.moveLeft(a, dist);
    }
    e[1] = a;
    if (e[0] & CharliePhysics.E_XWRAP) {
      if (((a - 1 + e[3]) & 0x100) === 0) { e[0] &= ~CharliePhysics.E_VISIBLE; return; }
    }
    a = e[2];
    if (dirs & 4) {
      a = this.moveDown((a + dist) & 0xFF, dist);
    }
    if (dirs & 8) {
      a = this.moveUp((a - dist) & 0xFF, dist);
    }
    e[2] = a;
    var check = a - 1 + 0x10;
    if (check > 0xFF) { return; }
    if ((check & 0xFF) < this.k.yRangeMax) { return; }
    e[0] &= ~CharliePhysics.E_VISIBLE;
  } // move

  /** `$9072`: dokončí pohyb doprava – buď se zahodí, nebo vytlačí ze stěny. */
  moveRight(a, dist) {
    var e = this.e;
    e[1] = a;
    if (!(e[0] & CharliePhysics.E_COLLIDES)) {
      var old = (a - dist) & 0xFF;
      if (old >= this.k.moveRejectX) { e[1] = old; return old; }
      // $9087: při žraní PRAVÉ stěny se posun přijme bez vytlačení
      if (this.vars.flags & CharliePhysics.FLAG_DIG_RIGHT) { return e[1]; }
    } else {
      this.unstickDown();
      this.unstickUp();
    }
    return this.pushLeft();
  } // moveRight

  /** `$9023`: dokončí pohyb doleva. */
  moveLeft(a, dist) {
    var e = this.e;
    e[1] = a;
    if (!(e[0] & CharliePhysics.E_COLLIDES)) {
      // $902F ADD A,E: **carry** znamená, že x přeteklo dolů (posun by šel do
      // záporných), a takový posun se zahodí. Jinak se buď přijme (žere se levá
      // stěna), nebo se nechá vytlačit.
      var back = a + dist;
      if (back > 0xFF) { e[1] = back & 0xFF; e[0] &= ~CharliePhysics.E_XWRAP; return e[1]; }
      if (this.vars.flags & CharliePhysics.FLAG_DIG_LEFT) {
        e[0] &= ~CharliePhysics.E_XWRAP;
        return e[1];
      }
    } else {
      this.unstickDown();
      this.unstickUp();
    }
    return this.pushRight();
  } // moveLeft

  /** `$90EA`: dokončí pohyb dolů (a vytlačí z podlahy). */
  moveDown(a, dist) {
    var e = this.e;
    if (e[0] & CharliePhysics.E_COLLIDES) {
      if (!(this.vars.flags & 0x81)) {
        if (e[1] < this.k.splitHalf) { this.pushRight(); } else { this.pushLeft(); }
      }
    }
    e[2] = a;
    if (!(e[0] & CharliePhysics.E_COLLIDES)) {
      var old = (a - dist) & 0xFF;
      if (old >= this.k.moveRejectY) { e[2] = old; return old; }
    }
    return this.resolveDown();
  } // moveDown

  /** `$90C0`: dokončí pohyb nahoru (a vytlačí ze stropu). */
  moveUp(a, dist) {
    var e = this.e;
    e[2] = a;
    if (!(e[0] & CharliePhysics.E_COLLIDES)) {
      // $90C9 ADD A,E: **carry** = y přeteklo dolů, posun se zahodí; jinak se
      // nechá vytlačit ze stropu.
      var back = a + dist;
      if (back > 0xFF) { e[2] = back & 0xFF; return e[2]; }
    }
    return this.resolveUp();
  } // moveUp

  /** `$9097`: posunuj doleva, dokud pravý sloupec obálky stojí v pevné buňce. */
  pushLeft() {
    var e = this.e;
    for (var guard = 0; guard < 512; guard++) {
      var box = this.cells();
      var addr = (box.addr + 0xA0FF + box.cols) & 0xFFFF;
      var hit = false;
      for (var i = 0; i < box.rows; i++) {
        if (this.attribute(addr) & 0x80) { hit = true; break; }
        addr = (addr + 0x20) & 0xFFFF;
      }
      if (!hit) { return e[1]; }
      e[1] = (e[1] - 1) & 0xFF;
      if (e[1] === 0xFF) { e[0] |= CharliePhysics.E_XWRAP; }
    }
    return e[1];
  } // pushLeft

  /** `$904B`: posunuj doprava, dokud levý sloupec obálky stojí v pevné buňce. */
  pushRight() {
    var e = this.e;
    for (var guard = 0; guard < 512; guard++) {
      var box = this.cells();
      var addr = (box.addr + 0xA100) & 0xFFFF;
      var hit = false;
      for (var i = 0; i < box.rows; i++) {
        if (this.attribute(addr) & 0x80) { hit = true; break; }
        addr = (addr + 0x20) & 0xFFFF;
      }
      if (!hit) { return e[1]; }
      e[1] = (e[1] + 1) & 0xFF;
      if (e[1] === 0) { e[0] &= ~CharliePhysics.E_XWRAP; }
    }
    return e[1];
  } // pushRight

  /** `$911E`: posunuj nahoru, dokud spodní řada obálky stojí v pevné buňce. */
  resolveDown() {
    var e = this.e;
    for (var guard = 0; guard < 512; guard++) {
      var box = this.cells();
      var addr = (box.addr + 0xA0E0 + 0x20*box.rows) & 0xFFFF;
      var hit = false;
      for (var i = 0; i < box.cols; i++) {
        if (this.attribute(addr) & 0x80) { hit = true; break; }
        addr = (addr + 1) & 0xFFFF;
      }
      if (!hit) { return e[2]; }
      e[2] = (e[2] - 1) & 0xFF;
    }
    return e[2];
  } // resolveDown

  /** `$90D0`: posunuj dolů, dokud horní řada obálky stojí v pevné buňce. */
  resolveUp() {
    var e = this.e;
    for (var guard = 0; guard < 512; guard++) {
      var box = this.cells();
      var addr = (box.addr + 0xA100) & 0xFFFF;
      var hit = false;
      for (var i = 0; i < box.cols; i++) {
        if (this.attribute(addr) & 0x80) { hit = true; break; }
        addr = (addr + 1) & 0xFFFF;
      }
      if (!hit) { return e[2]; }
      e[2] = (e[2] + 1) & 0xFF;
    }
    return e[2];
  } // resolveUp

  /** `$8FEC`: je-li celý znakový řádek pod hlavou pevný, posuň se dolů. */
  unstickDown() {
    var e = this.e;
    for (var guard = 0; guard < 64; guard++) {
      var box = this.cells();
      // $8FF3 LD A,L / AND $E0 – zpátky na začátek toho znakového řádku
      var base = (box.addr + 0xA100) & 0xFFFF;
      var addr = (base & 0xFF00) | (base & 0xE0);
      var free = false;
      for (var i = 0; i < 0x20; i++) {
        if (!(this.attribute(addr) & 0x80)) { free = true; break; }
        addr = (addr + 1) & 0xFFFF;
      }
      if (free) { return; }
      e[2] = (e[2] + 1) & 0xFF;
    }
  } // unstickDown

  /** `$9004`: je-li celý znakový řádek pod nohama pevný, posuň se nahoru. */
  unstickUp() {
    var e = this.e;
    for (var guard = 0; guard < 64; guard++) {
      var box = this.cells();
      // $9012 LD A,L / AND $E0 – tentýž trik, ale od spodní řady obálky
      var base = (box.addr + 0xA0E0 + 0x20*box.rows) & 0xFFFF;
      var addr = (base & 0xFF00) | (base & 0xE0);
      var free = false;
      for (var i = 0; i < 0x20; i++) {
        if (!(this.attribute(addr) & 0x80)) { free = true; break; }
        addr = (addr + 1) & 0xFFFF;
      }
      if (free) { return; }
      e[2] = (e[2] - 1) & 0xFF;
    }
  } // unstickUp

  // -------------------------------------------------------------- $810A pád

  /**
   * `$810A`: je pod Charliem zem? Zkouší se **zúženým spritem** (x+6, šířka-$0C)
   * o pixel níž; když se nic nezmění, stojí. Když ne, začíná pád.
   * @return {boolean} Padá?
   */
  groundCheck() {
    var e = this.e;
    if (this.vars.a2b7 & 0x80) { return false; }
    var x = e[1], width = e[3], flags = e[0];
    var a = x + 6;
    if (a > 0xFF) {
      a &= 0xFF;
      e[0] &= ~CharliePhysics.E_XWRAP;
      if (!(flags & CharliePhysics.E_XWRAP)) { a = 0; }
    }
    e[1] = a;
    e[3] = (width - 0x0C) & 0xFF;
    var y = e[2];
    var probed = this.moveDown((y + 1) & 0xFF, y);
    e[1] = x;
    e[3] = width;
    e[0] = flags;
    if (probed === y) { e[2] = y; return false; }   // $8144: stojí, y se vrátí
    // $8148: y **zůstává tam, kam ho zkouška posunula** – tak to dělá originál
    this.move(this.k.fallProbe >> 8, this.k.fallProbe & 0xFF);
    if (e[2] === y) { return false; }
    return this.startFall();
  } // groundCheck

  /** `$8153`: začátek pádu – krok podle místnosti a počítadlo smrtelné výšky. */
  startFall() {
    var e = this.e;
    this.vars.flags |= CharliePhysics.FLAG_FALLING;
    var step = this.k.fallStepFast;
    if (!(this.vars.a2b7 & 0x40)
        && (this.vars.room === this.k.slowRoomA || this.vars.room === this.k.slowRoomB)) {
      step = this.k.fallStepSlow;
    }
    this.fall = {active: true, step: step, counter: this.k.fallCounter,
                 savedFrame: e[0x1E]};
    return this.fallStep();
  } // startFall

  /**
   * `$817F`: jeden krok pádu. Počítadlo se snižuje, dokud nedojde na nulu –
   * **dokud je nenulové, je pád přežitelný**; nula znamená smrt (`$81CE`).
   * @return {boolean} Padá se dál?
   */
  fallStep() {
    var e = this.e;
    if (this.fall.counter) { this.fall.counter--; }
    e[0x0B] = e[0x0C];
    var frame = e[0x1E];
    var facing = frame & 0x80;
    this.setFrame((((frame - this.k.rollBase) & 7) + this.k.rollFirstFrame + facing) & 0xFF);
    var y = e[2];
    this.move(this.fall.step >> 8, this.fall.step & 0xFF);
    if (e[2] !== y) { return true; }             // pořád padá
    // $81AF: dopad. Když **není** řízený sestup ($A2B7 bit 6) a jsme v šachtě
    // updraftu (místnost $66), počítadlo se vrátí na plnou hodnotu – pád v ní
    // tedy nikdy nezabije. Teprve pak se bit 6 shodí.
    if (!(this.vars.a2b7 & 0x40) && this.vars.room === this.k.updraftRoom) {
      this.fall.counter = this.k.fallCounter;
    }
    this.vars.a2b7 &= ~0x40;
    this.vars.flags &= ~CharliePhysics.FLAG_FALLING;
    this.vars.f7ee0 &= ~0x80;
    this.fall.active = false;
    if (this.fall.counter) {                      // dopad, který se přežije
      this.setFrame(this.fall.savedFrame);
      return false;
    }
    this.died = true;                             // pád, který zabíjí
    return false;
  } // fallStep

  // --------------------------------------------------- $9F22/$9F37 ovládání

  /** `$9F37`: co si astronaut vybere podle vstupního bajtu. */
  control() {
    var e = this.e;
    var input = this.vars.input;
    // $9F40: přepnutí astronaut -> krtek. Vypustit krtka umí jen `this.mole`
    // (M4); bez něj zůstane jen počítadlo, jak to dělá $A098 na svém začátku.
    if (input === 0x08) {
      e[0x0B] = 0x80;
      if (this.mole) { this.mole.spawn(); }
      return;
    }
    var c = input;
    if ((input & 0x1F) === 0) { return this.stand(); }
    if (input === 0x10) { return this.jump(); }
    if (input & 0x04) { return this.stand(); }    // „dolů" astronaut nedělá
    var delay = e[0x0B];
    if ((delay & 0x3F) !== delay) { e[0x0B] = 0x80; }
    if (c === 0x11) { return this.startScript(this.k.jumpRightWalk, c); }
    if (c === 0x12) { return this.startScript(this.k.jumpLeftWalk, c); }
    if ((this.vars.lastDir & 0x03) === c) { return; }
    if (c === 0x01) { return this.startScript(this.k.walkRight, c); }
    if (c === 0x02) { return this.startScript(this.k.walkLeft, c); }
    this.vars.input = 0;
    this.vars.lastDir = 0;
    return this.stand();
  } // control

  /** `$9F93`: nasadí skript a poznamená si směr. */
  startScript(entry, direction) {
    var e = this.e;
    this.vars.flags |= CharliePhysics.FLAG_ACTION;
    e[9] = entry & 0xFF;
    e[0x0A] = entry >> 8;
    this.vars.lastDir = direction;
  } // startScript

  /** `$9FE4`: stání – skript se zastaví (počítadlo nikdy nedojde na bit 7). */
  stand() {
    this.e[0x0B] = 0x7F;
  } // stand

  /** `$9FA2`: skok na místě; který skript, rozhoduje směr pohledu. */
  jump() {
    var e = this.e;
    e[0x0B] = 0x80;
    var entry = (e[0x1E] & 0x80) ? this.k.jumpLeft : this.k.jumpRight;
    e[9] = entry & 0xFF;
    e[0x0A] = entry >> 8;
    this.vars.f7ee0 |= 0x80;
    this.vars.flags |= CharliePhysics.FLAG_ACTION;
    // $9FC2: v jedné jediné místnosti ($66) skok neznamená skok, ale **výstup
    // šachtou** – „a gusty up draught which will take you to the surface"
    // z briefingu. Stoupání pak vede $A2B7 bit 7 a rutina rise().
    if (this.vars.room !== this.k.updraftRoom) { return; }
    this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
    this.vars.a2b7 |= 0x80;
    e[0x0C] = this.k.risePeriod;
    this.setFrame(((e[0x1E] & 0x80) + this.k.riseFrameFirst) & 0xFF);
    e[0] |= CharliePhysics.E_DIRTY;
  } // jump

  /** `$9EBD`: běžící akce (skok) – u stropu se přepne na dopad. */
  action() {
    var e = this.e;
    if ((e[0x1E] & 0x7F) === 0) {
      var y = e[2];
      this.moveUp((y - 1) & 0xFF, 1);
      var probed = e[2];
      e[2] = y;
      if (probed !== y) { return; }               // ještě je kam stoupat
      this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
      this.vars.lastDir = 1;
      var entry = this.k.landRight;
      if (e[0x1E] & 0x80) { entry = this.k.landLeft; this.vars.lastDir = 2; }
      e[9] = entry & 0xFF;
      e[0x0A] = entry >> 8;
      e[0x0B] = 0x80;
      return;
    }
    var frame = e[0x1E];
    if (frame === 0x08 && this.vars.lastDir === 1) { this.endAction(); return; }
    if (frame === 0x88 && this.vars.lastDir === 2) { this.endAction(); return; }
  } // action

  /** `$9EE8`: konec akce – skript se zase rozeběhne. */
  endAction() {
    this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
    this.e[0x0B] = 0x80;
  } // endAction

  // ------------------------------------------------------------ $8F44 okraje

  /**
   * `$8F44`: co se stane, když Charlie vyjde z hrací plochy. Samotný přechod
   * mezi místnostmi je M4 – tady se jen **pozná a ohlásí**, souřadnice se
   * přepočítá tak, jak ji přepočítá originál.
   * @return {Object|null} {direction, x, y} nebo null.
   */
  edge() {
    var e = this.e;
    var x = e[1];
    if (e[0] & CharliePhysics.E_XWRAP) {
      if (x < this.k.edgeRight) {                    // vyšel doleva
        e[1] = this.k.edgeWrapLeft;
        e[0] &= ~CharliePhysics.E_XWRAP;
        return this.transition(2, 0x0100);
      }
    } else if (x >= this.k.edgeRight) {              // vyšel doprava
      e[1] = this.k.edgeWrapRight;
      e[0] |= CharliePhysics.E_XWRAP;
      return this.transition(1, 0x0200);
    }
    var floor = this.vars.room < 0x10 ? this.k.floorSurface : this.k.floorCave;
    var y = e[2];
    if (y < floor || y >= 0xF6) { return null; }
    if (y < 0xC3) {                                  // propadl se dolů
      e[2] = 0xF6;
      return this.transition(4, 0x0800);
    }
    if (!(this.vars.room & 0xE0) && (this.vars.f7ee0 & 0x80)) {
      e[2] = 0x6F;                                   // $8F97
    } else if (!(this.vars.room & 0xE0) && (this.vars.a2b7 & 0x10)) {
      e[2] = (e[2] + 3) & 0xFF;                      // $8FA4 – updraft, ne přechod
      return null;
    } else {
      e[2] = 0x80;                                   // $8FAD
    }
    return this.transition(8, 0x0C00);
  } // edge

  /**
   * `$8FC1`: přechod je nachystaný. Kromě čísla místnosti se přitom uklidí
   * i to, co k místnosti patřilo:
   *
   * * `$A2B7` bit 1 – krtek, který na povrchu vylézal z díry, mizí;
   * * `$5B0A` bit 2 – rozjeté sesedání se ruší;
   * * `$8FD3 CALL $9C3D` – **rozžraná stěna se nedožere**. Bit 0 stavu
   *   místnosti už zapsaný je (zapisuje se hned na začátku), takže průchod
   *   vznikne, ale animace se přeruší;
   * * `$8FD6 CALL $8273` – v panelu je zas **člověk**. Krtek s Charliem
   *   nikam necestuje.
   */
  transition(direction, move) {
    this.vars.a2b7 &= ~0x02;
    this.vars.flags &= ~0x04;
    if (this.mole) {
      this.mole.finishDig();
      this.mole.showMan();
    }
    this.e[0] &= ~0x04;
    this.pending = {direction: direction, x: this.e[1], y: this.e[2],
                    dirs: move >> 8, dist: move & 0xFF};
    return this.pending;
  } // transition

  // ------------------------------------------------ $9DD6 strom krtka a šachta

  /**
   * Kde v hrací ploše začínají jeskyně (`$9EAD`, `$A21D`, `$80F9`, `$9F2F`);
   * bez `data/mole.json` je to `$10` jako v originálu.
   * @return {number} Číslo první jeskynní místnosti.
   */
  get caveRoom() {
    return this.k.surfaceMaxRoom === undefined ? 0x10 : this.k.surfaceMaxRoom;
  } // caveRoom

  /**
   * `$9DD6`: **celý strom krtka**, a za ním ovládání. V originálu to je jedna
   * rutina, kterou hlavní smyčka volá uprostřed průchodu Charlieho (`$80D1`),
   * a je důležité, že se ovládání dělá **až tady** – kdyby se dělalo dřív,
   * nebylo by to pořadí originálu.
   */
  moleTree() {
    if (this.mole) { this.mole.mountCheck(); }     // $9DE6: Charlie chytá krtka
    // $9E28
    if (this.vars.a2b7 & 0x40) { return; }         // bit 6: řízený sestup
    if (this.vars.a2b7 & 0x80) { return this.rise(); }   // bit 7: výstup šachtou
    // $9EAA
    if (this.mole) { this.mole.surfaceStep(); }    // $A21A: krtek na povrchu
    if (this.vars.room >= this.caveRoom && this.mole) {
      this.mole.digWall();                        // $A1B3: prokousávání stěny
      this.mole.dismountStep();                   // $A04D: animace sesedání
      this.mole.eatMonsters();                    // $9FED: krtek žere nepřátele
    }
    // $9EBD
    if (this.vars.flags & CharliePhysics.FLAG_ACTION) { return this.action(); }
    return this.controlDispatch();
  } // moleTree

  /**
   * `$9F22`: dispečer ovládání. Když je krtek vypuštěný a jsme pod povrchem,
   * ovládá se **krtek** a astronaut se nehýbe. Během pádu se vstup ignoruje
   * (`$9F34`) – to je věta, která v M3 byla v `pass()`, a tady je na svém místě.
   */
  controlDispatch() {
    if (this.mole && this.mole.visible() && this.vars.room >= this.caveRoom) {
      return this.mole.pass();                    // $9F31 JP $A124
    }
    if (this.vars.flags & CharliePhysics.FLAG_FALLING) { return; }
    return this.control();                        // $9F37
  } // controlDispatch

  /**
   * `$9E33`: **výstup šachtou** – „a gusty up draught which will take you to
   * the surface". Není to skript: Charlie stoupá **o pixel za průchod**, rámec
   * jde o jeden nahoru a na `$23` se vrací na `$1B` (tedy tytéž rámce kotoulu,
   * jaké má pád), a každý druhý čtyřpixelový pás se uhne o pixel do strany,
   * kterou se dívá. V místnosti `$66` se neuhýbá (`$9E4F`).
   *
   * Když už není kam stoupat, výstup končí: `$A2B7` bit 7 dolů, bit 6 nahoru
   * (aby dopad neresetoval počítadlo pádu), nasadí se skript chůze a hned se
   * zkusí zem pod nohama (`$9EA7 JP $810A`).
   */
  rise() {
    var e = this.e;
    this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
    var next = (e[0x1E] + 1) & 0xFF;
    if ((next & 0x7F) === this.k.riseFrameWrap) {
      next = ((next & 0x80) + this.k.riseFrameBase) & 0xFF;
    }
    this.setFrame(next);
    if (this.vars.room !== this.k.riseNoDriftRoom && (e[2] & 0x04)) {
      var x = e[1];
      if (e[0x1E] & 0x80) { this.moveLeft((x - 1) & 0xFF, 1); }
      else { this.moveRight((x + 1) & 0xFF, 1); }
    }
    var y = e[2];
    var probed = this.moveUp((y - 1) & 0xFF, 1);
    if (probed === ((y - 1) & 0xFF)) { return; }       // ještě je kam stoupat
    this.vars.a2b7 &= ~0x80;
    this.vars.a2b7 |= 0x40;
    var facing = e[0x1E] & 0x80;
    e[0x1E] = facing;                                 // $9E88 – bez setFrame
    var direction = facing ? 2 : 1;
    var entry = facing ? this.k.riseWalkLeft : this.k.riseWalkRight;
    this.vars.lastDir = direction;
    this.vars.input = direction;
    e[0x0C] = 1;
    e[9] = entry & 0xFF;
    e[0x0A] = entry >> 8;
    this.groundCheck();                               // $9EA7 JP $810A
  } // rise

  /**
   * `$8019`: **whirlwind** – Charlie se roztočí a je odnesen vzhůru. Rámec jde
   * o jeden **dolů**, k tomu unos o 3 px vzhůru a o 3 px do strany; když do
   * strany nejde (stěna), unášení do strany se vypne (`$7EE0` bit 4). Cyklus
   * rámců se projde dvakrát (`$7EE0` bit 3) a pak Charlie zase chodí.
   *
   * Co `$A2B7` bit 4 **nastaví**, je dotek entity (`$7FE8`, entita s bitem 3
   * příznaků) – to je M5. Tady je jízda, ne její příčina.
   */
  whirlwind() {
    var e = this.e;
    if ((e[0x1E] & 0x7F) === this.k.whirlFrameLow) {
      if (!(this.vars.f7ee0 & 0x08)) {                // $8068: ještě druhé kolo
        this.vars.f7ee0 |= 0x08;
        e[0x1E] = (e[0x1E] + this.k.whirlFrameAdd) & 0xFF;
        return this.whirlwind();                      // $8079 JP $8019
      }
      var facing = e[0x1E] & 0x80;                    // $807C: konec točení
      e[0x1E] = facing;
      var entry = facing ? this.k.whirlWalkLeft : this.k.whirlWalkRight;
      this.vars.lastDir = facing ? 2 : 1;
      this.vars.input = facing ? 2 : 1;
      e[9] = entry & 0xFF;
      e[0x0A] = entry >> 8;
      e[0] &= ~0x08;
      this.vars.a2b7 &= ~0x10;
      this.vars.flags &= ~CharliePhysics.FLAG_ACTION;
      this.vars.f7ed9 = 0;
      return;
    }
    this.setFrame((e[0x1E] - 1) & 0xFF);
    if (!(this.vars.f7ee0 & 0x10)) {
      var drift = (e[0x1E] & 0x80) ? this.k.whirlDriftLeft : this.k.whirlDriftRight;
      var wanted = (e[0x1E] & 0x80) ? (e[1] - 3) & 0xFF : (e[1] + 3) & 0xFF;
      this.move(drift >> 8, drift & 0xFF);
      if (e[1] !== wanted) { this.vars.f7ee0 |= 0x10; }   // $8057: narazil
    }
    this.move(this.k.whirlLift >> 8, this.k.whirlLift & 0xFF);
  } // whirlwind

  // ------------------------------------------------------------ jeden průchod

  /**
   * Jeden průchod hlavní smyčkou pro Charlieho – **v pořadí, ve kterém ho dělá
   * originál**. To pořadí je `$7DCF` a `$80C8`:
   *
   * 1. `$8F44` okraje hrací plochy (a tím přechod do sousední místnosti);
   * 2. `$7EE1` → `$7FA7`: **whirlwind**, pokud Charlieho unáší – ten si vezme
   *    celý průchod a na `$80C8` se vůbec nedostane;
   * 3. `$810A` zem pod nohama (jen když neběží akce ani pád);
   * 4. `$9DD6` **strom krtka**, a v něm až na konci akce a ovládání;
   * 5. `$80D4` výstup šachtou zbytek průchodu spolkne;
   * 6. `$817F` krok pádu, nebo `$8EB2` krok skriptu – a ten se **nedělá**,
   *    když je pod povrchem vypuštěný krtek (`$80F3`), protože astronaut na
   *    krtka čeká.
   *
   * Počítadlo `(+$0B)` snižuje **přerušení**, tj. jednou za snímek; proto se
   * `tickCounter()` volá každý snímek a `pass()` z něj.
   *
   * @param {number} input - Bajt `$5B0B` (CharliePhysics.readInput).
   * @param {Function} [nextRoom] - Zavolá se, když Charlie vyjde z místnosti;
   *        má vrátit {room, attributes} té sousední.
   * @return {Object} {x, y, frame, falling, died, transition}
   */
  pass(input, nextRoom) {
    var e = this.e;
    this.vars.input = input & 0xFF;
    this.pending = null;
    var moved = this.edge();
    if (moved) {
      // $8FE2: místnost se vymění **uprostřed průchodu** a teprve pak se
      // Charlie posune ($8FE6) – v už nové kulise, takže ho z ní kolize
      // vytlačí. Zbytek průchodu běží dál ($91AE se vrátí volajícímu $8F44).
      if (nextRoom) {
        var next = nextRoom(moved);
        if (next) {
          this.setRoom(next.room, next.attributes);
          // $A34B: s novou místností se vynuluje celá tabulka entit, a krtek
          // je jedna z nich. Charlieho záznam ($FDE0) zůstane.
          if (this.mole) { this.mole.clearRecord(); }
        }
      }
      this.move(moved.dirs, moved.dist);
      this.e[0] |= 0x04;          // $8FE9 JP $91AE – překreslí, ale bit 1 nechá
      this.pending = moved;
    }
    // $7FA7: whirlwind. $8019 končí JP $A124, tedy krtkem, a na $80C8 se
    // nedostane – ani na zem pod nohama, ani na krok skriptu.
    if (this.vars.a2b7 & 0x10) {
      this.whirlwind();
      this.drawn();                             // $8062 CALL $91A5
      if (this.mole) { this.mole.pass(); }      // $8065 JP $A124
      return this.state();
    }
    if (!(this.vars.flags & 0x03) && this.groundCheck()) {
      // $817E POP HL: začátek pádu spolkne návratovou adresu, takže zbytek
      // průchodu se **neudělá** – jen se překreslí ($81A9 JP $91A5).
      this.drawn();
      return this.state();
    }
    this.moleTree();                            // $80D1 CALL $9DD6
    if (this.vars.a2b7 & 0x80) { return this.state(); }   // $80D7 bit 7 -> RET NZ
    if (this.vars.flags & CharliePhysics.FLAG_FALLING) {
      // $80E5: dokud není na počítadle řada, průchod končí bez překreslení
      if (!(e[0x0B] & 0x80)) { return this.state(); }
      this.fallStep();
    } else if (this.vars.f7ed9 & 0x02) {
      return this.state();                      // $80ED BIT 1,($7ED9) -> RET NZ
    } else if (this.mole && this.mole.visible() && this.vars.room >= this.caveRoom) {
      // $80F3/$80F9: pod povrchem jezdí krtek a Charlieho skript stojí
    } else {
      this.scriptStep();                        // $8100 CALL $8EB2
    }
    this.drawn();                               // $8103 SET 1 + $91A5
    return this.state();
  } // pass

  /**
   * Co si z průchodu odnese worker. Souřadnice jsou bajty záznamu, nic se
   * nezaokrouhluje (`app/WORKER-PROTOCOL.md`).
   * @return {Object} {x, y, frame, falling, died, transition, mole}
   */
  state() {
    var e = this.e;
    return {x: e[1], y: e[2], frame: e[0x1E],
            falling: !!(this.vars.flags & CharliePhysics.FLAG_FALLING),
            died: this.died, transition: this.pending,
            mole: this.mole ? this.mole.state() : false};
  } // state

  /**
   * Konec průchodu: `$8103 SET 1,(IX+$00)` a hned `$91A5`, který příznak zase
   * shodí a sprite překreslí (`$91E9`/`$91F3` přitom přehodí bit 2). Kreslení
   * samo je M7 – fyzice z něj zbývají jen tyhle dva bity.
   */
  drawn() {
    this.e[0] &= ~CharliePhysics.E_DIRTY;
    this.e[0] |= 0x04;
  } // drawn

  /** Snížení počítadla skriptu, které v originálu dělá přerušení (`$9CC7`). */
  tickCounter() {
    var e = this.e;
    if (!(e[0x0B] & 0x80)) { e[0x0B] = (e[0x0B] - 1) & 0xFF; }
  } // tickCounter

  /** Co remake neumí reprodukovat a nezakrývá. */
  report() {
    return {outsideReads: this.outside};
  } // report

} // CharliePhysics

if (typeof self !== 'undefined') { self.CharliePhysics = CharliePhysics; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CharliePhysics; }
