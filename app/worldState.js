// begin code

/**
 * Perzistentní stav světa – **256 bajtů `$B600`**, jeden na místnost.
 *
 * Tohle je hlavní nález M2 (`sources/docs/disasm_notes.md` §8.5) a M4 ho
 * konečně **mění**: krtek prokousává stěny a ta změna je jediná věc, kterou si
 * tenhle svět o sobě pamatuje. Proto to není součást dat místnosti, ale stav –
 * `data/world.json` říká jen, která stěna se prokousat **dá**.
 *
 * | bit | co znamená |
 * |---|---|
 * | 0 | **pravá stěna je prokousaná** – `$879C` vyřeže průchod 2 × 6 buněk |
 * | 1 | pravá stěna je **prokousatelná** |
 * | 2 | díra v podlaze |
 * | 3 | místnost je označená (mugger, M5) |
 * | 6 | leží tu alchiem (M5, losuje se z registru `R`) |
 * | 7 | zvláštní místnost (má záznam v tabulce `$5D68`) |
 *
 * Průchod mezi dvěma místnostmi je uložený **jednou**: bit 0 místnosti otevře
 * její pravou stěnu a **týž bit** otevře levou stěnu její pravé sousedce. Proto
 * `roomState()` vrací dvojici (`dugRight`, `dugLeft`) a `dugLeft` bere z bajtu
 * **sousedky vlevo** – přesně jak to dělá `$5B05`, ukazatel, který si hra na
 * sousedku vlevo drží.
 *
 * Svět je **torus 16 × 16** (`$882B`): sloupec i řádek se počítají mod 16, takže
 * z levého okraje se vyjde na pravý. `neighbour()` je přepis té rutiny.
 */
class WorldState {

  /** Bity bajtu `$B600 + místnost`. */
  static get DUG() { return 0x01; }
  static get DIGGABLE() { return 0x02; }
  static get FLOOR_GAP() { return 0x04; }
  static get MARKED() { return 0x08; }
  static get ALCHIEM() { return 0x40; }
  static get SPECIAL() { return 0x80; }

  /** Bity směru, tytéž jako v masce pohybu (`$9143`) a v přechodu (`$882B`). */
  static get RIGHT() { return 1; }
  static get LEFT() { return 2; }
  static get DOWN() { return 4; }
  static get UP() { return 8; }

  /**
   * @param {Object} world - Parsed data/world.json (tools/dumprooms.py).
   */
  constructor(world) {
    if (!world || !world.rooms || !world.grid) {
      throw new Error('data/world.json missing');
    }
    this.grid = world.grid;
    this.gap = world.wallGap;
    this.state = new Uint8Array(256);
    this.reset(world);
  } // constructor

  /**
   * Nová hra: stav, ve kterém svět je **na začátku hry**. `flagsAtLoad` je
   * bajt z obrazu po nahrání a hra při startu shodí bit 0 u všech
   * prokousatelných stěn (`$8559`), takže dumprooms.py ho shazuje taky
   * a tady se jen bere, co v datech je.
   *
   * Bity 4–7 (alchiemy) hra **losuje** z registru `R` (`$86EA`) – to je M5
   * a tady se schválně nedoplňuje.
   * @param {Object} world - Parsed data/world.json.
   */
  reset(world) {
    var rooms = world.rooms;
    for (var room = 0; room < 256; room++) {
      var description = rooms[room] || rooms[String(room)];
      var byte = 0;
      if (description) {
        if (description.diggableRight) { byte |= WorldState.DIGGABLE; }
        if (description.floorGap) { byte |= WorldState.FLOOR_GAP; }
        if (description.special) { byte |= WorldState.SPECIAL; }
      }
      this.state[room] = byte;
    }
  } // reset

  /**
   * @param {number} room - Číslo místnosti.
   * @return {number} Bajt `$B600 + místnost`.
   */
  get(room) {
    return this.state[room & 0xFF];
  } // get

  /**
   * @param {number} room - Číslo místnosti.
   * @param {number} byte - Nová hodnota.
   */
  set(room, byte) {
    this.state[room & 0xFF] = byte & 0xFF;
  } // set

  /**
   * `$882B`: číslo místnosti po přechodu. Svět je torus – sloupec se zacyklí
   * ve svém řádku a řádek ve svém sloupci.
   * @param {number} room - Odkud.
   * @param {number} direction - Maska směru (1 vpravo, 2 vlevo, 4 dolů, 8 nahoru).
   * @return {number} Kam.
   */
  neighbour(room, direction) {
    var columns = this.grid.columns, rows = this.grid.rows;
    var column = room & (columns-1);
    var row = (room >> 4) & (rows-1);
    if (direction & WorldState.RIGHT) { column++; }
    if (direction & WorldState.LEFT) { column--; }
    if (direction & WorldState.DOWN) { row++; }
    if (direction & WorldState.UP) { row--; }
    return (((row & (rows-1)) << 4) | (column & (columns-1))) & 0xFF;
  } // neighbour

  /**
   * Sousedka vlevo – to, na co v originálu ukazuje `$5B05` (`$87BE`).
   * @param {number} room - Číslo místnosti.
   * @return {number} Číslo místnosti vlevo.
   */
  leftOf(room) {
    return this.neighbour(room, WorldState.LEFT);
  } // leftOf

  /**
   * Co ze stavu potřebuje skládání místnosti (`roomScenery.composeRoom`).
   * @param {number} room - Číslo místnosti.
   * @return {Object} {dugRight, dugLeft}.
   */
  roomState(room) {
    return {dugRight: !!(this.get(room) & WorldState.DUG),
            dugLeft: !!(this.get(this.leftOf(room)) & WorldState.DUG)};
  } // roomState

  /**
   * Dá se ta stěna prokousat? `$A1DD AND $03 / CP $02` – **prokousatelná
   * a ještě neprokousaná**, obojí naráz.
   * @param {number} room - Místnost, jejíž pravá stěna se zkouší.
   * @return {boolean} Dá.
   */
  canDig(room) {
    return (this.get(room) & 0x03) === WorldState.DIGGABLE;
  } // canDig

  /**
   * Prokousáno: `$A1E2 SET 0,(HL)`.
   * @param {number} room - Místnost, jejíž pravá stěna se prokousala.
   */
  dig(room) {
    this.set(room, this.get(room) | WorldState.DUG);
  } // dig

  /**
   * Kolik stěn je prokousaných a kolik jich ještě zbývá – pro `checkworld.py`
   * a pro výpis stavu.
   * @return {Object} {dug, diggable}.
   */
  count() {
    var dug = 0, diggable = 0;
    for (var room = 0; room < 256; room++) {
      if (this.state[room] & WorldState.DIGGABLE) { diggable++; }
      if (this.state[room] & WorldState.DUG) { dug++; }
    }
    return {dug: dug, diggable: diggable};
  } // count

  /**
   * Stav světa jako bajty, aby se dal porovnat s `$B600` originálu bajt po
   * bajtu (`tools/matchentities.js`).
   * @return {Uint8Array} 256 bajtů.
   */
  bytes() {
    return this.state;
  } // bytes

} // class WorldState

if (typeof self !== 'undefined') { self.WorldState = WorldState; }
if (typeof module !== 'undefined' && module.exports) { module.exports = WorldState; }
