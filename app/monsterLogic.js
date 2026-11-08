// begin code

/**
 * Nepřátelé, alchiemy, muggeři a pravidla – **přepis rutin originálu**,
 * ne vlastní model. Rozbor je v `sources/docs/disasm_notes.md` §12.
 *
 * Tři věty, ze kterých plyne zbytek, protože se čtou jinak, než by člověk
 * z rozlehlé mapy čekal:
 *
 * ★★ **Rozmístění nepřátel po světě žádná tabulka není.** V každé podzemní
 * místnosti se nepřátelé **losují za běhu** (`$A5E0`, šance 1/64 na volný slot
 * a průchod) a hra si je pamatuje jen pro **posledních pět** navštívených
 * místností (`$5B34`, 5 × 10 B, LRU). Nadzemní místnosti (`< $10`) a místnost
 * monolitu nepřátele nemají vůbec. Hledat „tabulku příšer" tedy nemá smysl –
 * žádná neexistuje.
 *
 * ★★ **Tabulka od `$AAED` má 94 záznamů po 8 bajtech, ne 80.** M0 viděla
 * `BIT 7,(IY+$07)` a vzala adresu **pole**, ne záznamu, a vyšlo jí `$AAF4`.
 * Jsou to **poletující objekty**: každý má vlastní bajtkód (jiný interpret než
 * M3!), vlastní místnost a přes hranice místností se **pohybuje sám**. To ony
 * roztočí Charlieho – whirlwind z M4 není samostatná entita, je to **dotek
 * jednoho z těchhle objektů**.
 *
 * ★★ **Mugger krade tím, že se Charlieho dotkne, a hned mizí.** Tentýž bit 1
 * příznaků, který mu nastaví krtek (M4, `$9FED`), si nastaví i sám při doteku
 * (`$A651`) – dispečer z něj v obou případech udělá bit 3 („mizím") a seznam
 * rámců `$AAC4`. Rozdíl je jen v tom, že při doteku stihne ukrást alchiem
 * (`$A771`) a schovat ho do jiné místnosti.
 *
 * Co tenhle soubor **nedělá**: nekreslí (M7) a nepouští zvuk (M7) – jen říká,
 * co se má ozvat. A **nelosuje sám**: co v originálu dělá `LD A,R`, je vstup
 * `random()`, a `report()` říká, kolikrát se na něj sáhlo.
 */
class MonsterLogic {

  /** Bity příznaků entity, se kterými dispečer pracuje (týž záznam jako M3). */
  static get E_VISIBLE() { return 0x01; }
  static get E_DIRTY() { return 0x02; }
  static get E_DRAWN() { return 0x04; }
  static get E_KILLED() { return 0x02; }   // bit 1 v C, než z něj vznikne bit 3
  static get E_VANISHING() { return 0x08; }
  static get E_COLLIDES() { return 0x10; }
  static get E_XWRAP() { return 0x80; }

  /** Kolik záznamů má tabulka entit a kdo v ní kde bydlí (`$FC00` po `$20`). */
  static get SLOT_OBJECTS() { return 0; }   // $FC00–$FCE0, osm slotů pro objekty
  static get SLOT_MONSTERS() { return 8; }  // $FD00, $FD20, $FD40
  static get SLOT_PICKUP() { return 12; }   // $FD80 – alchiem nebo mugger
  static get SLOT_STICK() { return 13; }    // $FDA0 – položený gravity stick
  static get SLOT_MOLE() { return 14; }     // $FDC0 – M4
  static get SLOT_CHARLIE() { return 15; }  // $FDE0 – M3

  /**
   * @param {Object} physics - CharliePhysics; dispečer jede na jeho rutinách
   *        (`$9140`, `$8E80`, kolize) přesně jako originál na týchž adresách.
   * @param {Object} monsters - Parsed data/monsters.json (tools/dumpmonsters.py).
   * @param {Object} world - WorldState (M2); sem patří alchiemy a muggeři.
   * @param {Function} [random] - Co v originálu dělá `LD A,R`: vrací bajt 0–255.
   *        Nereprodukovatelné, proto je to vstup a `report()` to hlásí.
   */
  constructor(physics, monsters, world, random) {
    if (!monsters || !monsters.constants || !monsters.objects) {
      throw new Error('data/monsters.json missing');
    }
    this.p = physics;
    this.k = monsters.constants;
    this.types = monsters.types;
    this.frameLists = monsters.frameLists;
    this.teleportRooms = monsters.teleportRooms;
    this.itemPositions = monsters.itemPositions;
    this.monolithRooms = monsters.monolithRooms;
    this.world = world;
    this.random = random || (() => 0);
    this.randomCalls = 0;

    // Bajty skriptů objektů i seznamů rámců nepřátel jsou bajty originálu;
    // čtou se přes physics.byteAt(), takže se do jeho bloků přidají.
    this.addBlocks(monsters);

    this.entities = [];
    for (var i = 0; i < 16; i++) { this.entities.push(new Uint8Array(32)); }
    this.entities[MonsterLogic.SLOT_CHARLIE] = physics.e;

    this.objects = monsters.objects.map((o) => ({
      index: o.index, script: o.script, record: Uint8Array.from(o.record),
    }));
    this.objectTicks = new Uint8Array(128);   // $E180: počítadlo skriptu objektu

    this.reset();
  } // constructor

  /** Skripty objektů a seznamy rámců nepřátel jako **bajty originálu**. */
  addBlocks(monsters) {
    var blocks = monsters.blocks || [];
    this.blocks = [];
    for (var i = 0; i < blocks.length; i++) {
      this.p.addScriptBlock(blocks[i].base, blocks[i].bytes);
      this.blocks.push(this.p.scriptBlocks[this.p.scriptBlocks.length - 1]);
    }
  } // addBlocks

  /**
   * `$85A6`/`$85AB`: rozehrání hry **přepisuje bajty skriptu** – rámec
   * ukazatele hledaného alchiemu a rámec monolitu. Je to sebemodifikace
   * originálu, ne parametr, takže se tady dělá doslova.
   */
  setScriptByte(addr, value) {
    for (var i = 0; i < this.blocks.length; i++) {
      var block = this.blocks[i], index = addr - block.base;
      if (index >= 0 && index < block.bytes.length) { block.bytes[index] = value & 0xFF; }
    }
  } // setScriptByte

  /** Nová hra: to, co dělá `$8630`–`$8553`, ale bez losování za hráče. */
  reset() {
    this.vars = {
      energy: this.k.energyFull,      // $AAE3, bit 7 = odhození ($80A1)
      live: 0,                        // $AAE4, kolik nepřátel v místnosti zbývá
      special: 0,                     // $AAE5, typ se zvláštním účinkem
      mugged: 0,                      // $AAE2, v této návštěvě už mugger kradl
      type3Seen: 0,                   // $AAE6, jen první typ 3 hraje tón
      stickLife: 0,                   // $7DDE, kolik průchodů stick ještě působí
      sticks: 0,                      // $7EE0 bity 0-2, kolik jich hráč má
      alchiemMask: 0,                 // $5B01, které z osmi slotů jsou plné
      alchiemList: 0,                 // $5B02, jejich dvoubitová čísla
      wanted: 0,                      // $5B00, bity 0-1 monolit, 2-3 hledaný
      wantedCount: 0,                 // $5B33, kolik hledaných hráč má
      lives: 3,                       // $5B09
      objectIndex: 0,                 // $5B12
      room: 0,
    };
    this.roomCache = new Uint8Array(this.k.roomCacheCount * this.k.roomCacheStride);
    this.neighbours = [0, 0, 0, 0, 0];   // $AA20–$AA24
    this.monolithRoom = 0;               // $ADD7
    this.wantedRoom = 0;                 // $ADCF
    this.ending = false;
    this.sounds = [];
    // $9CA5: výška tónu, kterou tenhle průchod zapsal nepřítel typu 3 ($A73D)
    // nebo závěrečný odlet ($A860) – slot 2 přerušení, tedy M7
    this.tone = 0;
    this.kills = 0;
    this.steals = 0;
    this.randomCalls = 0;
    for (var i = 0; i < this.entities.length; i++) {
      if (i !== MonsterLogic.SLOT_CHARLIE) { this.entities[i].fill(0); }
    }
    this.objectTicks.fill(0x80);
  } // reset

  /** `LD A,R` – jediné místo, kde se sahá na to, co reprodukovat nejde. */
  r() {
    this.randomCalls++;
    return this.random() & 0xFF;
  } // r

  // ------------------------------------------------------ rozehrání nové hry

  /**
   * `$8553`: rozehrání. Alchiemy, muggeři, místnost monolitu a hledaný alchiem
   * se **losují při startu hry**, ne v datech – proto to musí umět i remake.
   * Odpověď na otevřenou otázku M1/M5 „pevné pozice, nebo losované?": **losované**.
   */
  newGame() {
    var k = this.k, state = this.world;
    // $855C: ze stavu místnosti přežije jen kulisa; prokousané stěny se zavřou
    for (var room = 0; room < 256; room++) {
      state.set(room, state.get(room) & k.roomStateKeep);
    }
    // $8563: 32 alchiemů do 32 různých místností, čísla cyklují po čtyřech
    for (var b = k.alchiemsPlaced; b >= 1; b--) {
      var at = this.randomFreeRoom();
      state.set(at, (state.get(at) | k.hideSetBit
                              | ((b << 1) & 0x30)) & 0xFF);
    }
    // $8572: 6 muggerů, každý do místnosti, kde ještě žádný není
    for (var m = 0; m < k.muggersPlaced; m++) {
      var mugRoom = this.randomFreeRoom();
      while (state.get(mugRoom) & 0x08) { mugRoom = this.nextFreeRoom(mugRoom); }
      state.set(mugRoom, state.get(mugRoom) | 0x08);
    }
    // $8584: jedno losování rozhodne obojí – kterým monolitem a který alchiem
    this.vars.wanted = this.r() & 0x0F;
    this.wantedRoom = this.monolithRooms[this.vars.wanted & 3];
    this.monolithRoom = (this.wantedRoom + k.monolithRoomOffset) & 0xFF;
    var wantedFrame = k.wantedFrameBase + ((this.vars.wanted >> 2) & 3);
    // $85A6/$85AB: ukazatel hledaného alchiemu a monolit jsou objekty 92 a 93
    this.objects[92].record[2] = this.wantedRoom;
    this.objects[93].record[2] = this.monolithRoom;
    this.wantedFrame = wantedFrame;
    this.monolithFrame = k.monolithFrame;
    this.setScriptByte(k.wantedObjectFrame, wantedFrame);
    this.setScriptByte(k.monolithFrameVar, k.monolithFrame);
    this.objects[93].record[4] = k.monolithStart & 0xFF;
    this.objects[93].record[5] = k.monolithStart >> 8;
    this.matchWanted();
  } // newGame

  /** `$86EA`: losuje místnost, do které se něco smí položit. */
  randomFreeRoom() {
    return this.nextFreeRoom(this.r());
  } // randomFreeRoom

  /** `$86F8`: od dané místnosti hledá dál tu, která smí a je volná. */
  nextFreeRoom(from) {
    var state = this.world, at = from & 0xFF;
    for (var tries = 0; tries < 256; tries++) {
      at = (at + 1) & 0xFF;
      var value = state.get(at);
      if ((value & 0x80) && !(value & this.k.hideSetBit)) { return at; }
    }
    return at;
  } // nextFreeRoom

  /** `$895B`: kolik z osmi držených alchiemů je ten hledaný (`$5B33`). */
  matchWanted() {
    var wanted = (this.vars.wanted >> 2) & 3, list = this.vars.alchiemList;
    var mask = this.vars.alchiemMask, count = 0;
    for (var i = 0; i < this.k.alchiemSlots; i++) {
      var id = (list >> (14 - 2 * i)) & 3;
      if ((mask & (0x80 >> i)) && id === wanted) { count++; }
    }
    this.vars.wantedCount = (this.vars.wantedCount & 0xF0) | count;
    return count;
  } // matchWanted

  // -------------------------------------------------- výměna místnosti a slotů

  /**
   * `$A2F4`: odchod z místnosti. Tři nepřátelé se **uloží do paměti posledních
   * pěti místností** (`$5B34`), tabulka entit se vynuluje (`$A34B`, M4) a nová
   * místnost se z paměti zas naplní (`$A360`).
   */
  changeRoom(room) {
    var k = this.k, stride = k.roomCacheStride, old = this.vars.room;
    var slot = -1;
    for (var i = 0; i < k.roomCacheCount; i++) {
      if (this.roomCache[i * stride] === old) { slot = i; break; }
    }
    if (slot < 0) {                                     // $A30A: vytěsní se nejstarší
      this.roomCache.copyWithin(stride, 0, k.roomCacheShift);
      this.roomCache[0] = old;
      slot = 0;
    }
    var at = slot * stride + 1;
    for (var n = 0; n < k.monstersPerRoom; n++) {
      var e = this.entities[MonsterLogic.SLOT_MONSTERS + n];
      var present = e[0] & 1;
      // $A32B: kdo je zrovna uprostřed uvodní nebo zavěrečné animace, se
      // neukládá jako živý – po návratu by se objevil v půlce mizení
      var frame = this.p.byteAt(e[9] + 256 * e[0x0A]);
      if (frame >= k.appearFrameLo && frame < k.appearFrameHi) { present = 0; }
      this.roomCache[at] = (present << 7) | (e[2] >> 1);   // $A335 RR C / RR (HL)
      this.roomCache[at + 1] = e[1];
      this.roomCache[at + 2] = e[0x0D];
      at += 3;
    }
    for (var c = 0; c < this.entities.length - 1; c++) {  // $A34B, Charlie zůstane
      if (c !== MonsterLogic.SLOT_CHARLIE) { this.entities[c].fill(0); }
    }
    this.vars.room = room & 0xFF;
    this.fillRoom();
    this.markObjects();
    this.placeRoomItem();
  } // changeRoom

  /**
   * `$88B5`: co v místnosti leží. V originálu je to součást **kreslení
   * místnosti** (`$8857`, M2), ne dispečeru – ale rozhoduje o tom stav
   * místnosti, který patří sem, tak to bydlí tady.
   *
   * Rámec je `$66` pro **muggera** (bit 3) a `$62 + číslo` pro **alchiem**
   * (bit 6); když tam není ani jedno, slot zůstane prázdný. Polohu dá tabulka
   * `$5D68`, indexovaná **počtem místností s bitem 7 po tuhle včetně**
   * (`$88D3`–`$88E4`): `x = bajt AND $F0`, `y = (bajt AND $0F) * 8`.
   */
  placeRoomItem() {
    var k = this.k, e = this.entities[MonsterLogic.SLOT_PICKUP];
    var value = this.world.get(this.vars.room);
    var frame;
    if (value & 0x08) { frame = k.itemMuggerFrame; }
    else if (value & k.hideSetBit) { frame = k.itemAlchiemFrame + ((value >> 4) & 3); }
    else { return; }
    var previous = this.p.useEntity(e);
    this.p.setFrame(frame);
    this.p.useEntity(previous);
    var index = 0;
    for (var room = 0; room <= this.vars.room; room++) {
      if (this.world.get(room) & 0x80) { index++; }
    }
    var byte = this.itemPositions[index] || 0;
    e[1] = byte & 0xF0;
    e[2] = (byte & 0x0F) << 3;
    e[0x0B] = k.itemCounterInit & 0xFF;
    e[0x0C] = k.itemCounterInit >> 8;
  } // placeRoomItem

  /** `$A360`: naplní tři sloty z paměti; místnost, kterou nezná, nechá prázdnou. */
  fillRoom() {
    var k = this.k, stride = k.roomCacheStride, room = this.vars.room;
    this.vars.mugged = 0;
    this.vars.live = k.liveCountInit;
    if (room < k.surfaceMaxRoom) { return; }
    var slot = -1;
    for (var i = 0; i < k.roomCacheCount; i++) {
      if (this.roomCache[i * stride] === room) { slot = i; break; }
    }
    if (slot < 0) { return; }
    var at = slot * stride + 1;
    for (var n = 0; n < k.monstersPerRoom; n++) {
      var y = this.roomCache[at], x = this.roomCache[at + 1];
      var type = this.roomCache[at + 2];
      at += 3;
      if (!(y & 0x80)) { continue; }                    // $A37F SLA A: nebyl tam
      var e = this.entities[MonsterLogic.SLOT_MONSTERS + n];
      e[2] = (y << 1) & 0xFF;
      e[1] = x;
      e[0x0B] = k.spawnCounter;
      this.setupType(MonsterLogic.SLOT_MONSTERS + n, type, k.spawnScriptSkip);
    }
  } // fillRoom

  /**
   * `$A3B1`: dispečer typů. Každý typ má čtyřbajtový popis (krok, seznam rámců,
   * perioda); typ 6 (mugger) si seznam vybírá podle toho, na které straně
   * Charlieho vznikl, a **v originálu si ho domodifikuje do vlastního popisu**.
   * @param {number} slot - Index záznamu entity.
   * @param {number} type - Číslo typu 1–6.
   * @param {number} skip - O kolik bajtů se přeskočí úvodní animace (`$A392`).
   */
  setupType(slot, type, skip) {
    var e = this.entities[slot], k = this.k;
    e[0x0D] = type & 0xFF;
    var descriptor = this.types[Math.min(Math.max(type, 1), 6) - 1];
    var script = descriptor.script;
    if (type === 1) {
      // $A3BB: typ 1 se rodí buď doprava, nebo doleva, a vždycky na téže výšce
      e[0x1F] = (this.r() & 1) ? 1 : 2;
      e[2] = k.type1ForceY;
    } else if (type >= 6) {
      // $A3F1: mugger přichází z té strany, na které Charlie zrovna není
      var charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
      var chx = (charlie[0] & MonsterLogic.E_XWRAP) ? charlie[1] - 256 : charlie[1];
      var mine = (e[1] >> 1) | 0x80;
      if (mine < ((chx >> 1) & 0xFF)) { script = k.muggerSpawnRight; e[0x1F] = 1; }
      else { script = k.muggerSpawnLeft; e[0x1F] = 2; }
    }
    e[6] = descriptor.step;
    var pointer = (script + skip) & 0xFFFF;
    e[9] = pointer & 0xFF;
    e[0x0A] = pointer >> 8;
    e[0x0C] = descriptor.period;
    var previous = this.p.useEntity(e);
    this.p.setFrame(this.p.byteAt(pointer));
    this.p.useEntity(previous);
    e[0] = k.entityFlagsInit;
  } // setupType

  /**
   * `$A436`: losování nepřítele za běhu – pozice i typ. Šest místností
   * (`$AAE7`) má vždycky typ 5, jinde se typ vybírá z **bajtu paměti, na který
   * ukazuje `LD A,R`** (`$A45C LD L,A / LD H,A`). To reprodukovat nejde ani
   * teoreticky, takže si remake losuje typ přímo a `report()` to říká.
   * @return {number} Zvolený typ.
   */
  randomType() {
    var k = this.k;
    for (var i = 0; i < this.teleportRooms.length; i++) {
      if (this.teleportRooms[i] === this.vars.room) { return k.teleportType; }
    }
    // $A45C: `LD A,R / LD L,A / LD H,A / LD A,(HL)` – typ se bere z **bajtu
    // paměti, na který ukazuje registr R**. Reprodukovat to nejde ani teoreticky.
    var a = this.r() & 0x0F;
    if (a === 4) { return a; }                        // $A463 CP $04 -> typ 4
    if (a === 6) {
      // $A46B: druhé losování. `RRA` s nulovým carry, a když vypadne carry
      // (tj. R bylo liché), je typ **R >> 1** – tedy zpravidla ≥ 6, což je
      // mugger. Tudy se mugger do místnosti dostane.
      var v = this.r();
      a = v >> 1;
      if (v & 1) { return a; }
    }
    a &= 3;                                           // $A470
    return a || 1;                                    // $A474 INC A
  } // randomType

  // ------------------------------------------------------------ hlavní průchod

  /**
   * `$A5B2`: co hlavní smyčka udělá s nepřáteli. Volá se jednou za průchod,
   * po objektech (`$A479`) a před krokem Charlieho.
   * @param {Object} charlie - Záznam Charlieho a jeho stav (kvůli doteku).
   */
  pass() {
    var k = this.k;
    this.vars.type3Seen = 0;
    if (this.vars.room < k.surfaceMaxRoom) { return; }   // $A5B6: povrch je bez nich
    if (this.vars.room === this.monolithRoom) { return; }
    for (var n = 0; n < k.monstersPerRoom; n++) {
      this.monsterPass(MonsterLogic.SLOT_MONSTERS + n);
    }
  } // pass

  /** Jeden nepřítel: `$A5CC`–`$A82E`. */
  monsterPass(slot) {
    var e = this.entities[slot], k = this.k;
    var flags = e[0];
    if (!(flags & MonsterLogic.E_VISIBLE)) { return this.trySpawn(slot); }

    var killed = false;
    if (!(flags & MonsterLogic.E_VANISHING)) {
      var frame = e[0x1E];
      var inAnimation = frame >= k.appearFrameLo && frame < k.appearFrameHi;
      if (!inAnimation) {
        // $A628: dokud gravity stick působí, stahuje nepřátele k zemi a pod
        // mezí je zabije – doslova to, co slibuje jméno
        if (this.vars.stickLife
            && ((e[2] + k.stickPullOffset) & 0xFF) >= k.stickPullY) { killed = true; }
        if (this.touchesCharlie(e)) {
          // $A63F: typy 4 a 5 mají navíc zvláštní účinek (zamotání, teleport)
          if (e[0x0D] === k.specialTypeA || e[0x0D] === k.specialTypeB) {
            this.vars.special = e[0x0D];
          }
          this.hurt(1);                                   // $A650 DEC (HL)
          killed = true;
        }
        if (killed) { this.kill(slot); }
      }
    }
    if (!(e[0x0B] & 0x80)) { return; }                    // $A66D: ještě není řada
    e[0x0B] = e[0x0C];
    this.frameStep(slot);
    this.direction(slot);
    this.moveMonster(slot);
  } // monsterPass

  /** `$A5DD`: volný slot se s malou šancí naplní losovaným nepřítelem. */
  trySpawn(slot) {
    var k = this.k, e = this.entities[slot];
    if (this.vars.live & 0x80) { return; }                // $A5D8: už je po všech
    if ((this.r() & k.spawnChanceMask) !== 0) { return; }
    e[0x0B] = this.r();
    e[2] = ((this.r() & k.randomYMask) + k.randomYBase) & 0xFF;
    e[1] = (this.r() + k.randomXBase) & 0xFF;
    this.setupType(slot, this.randomType(), k.respawnScriptSkip);
    // $A5F2: kdyby se objevil v kulise, neobjeví se vůbec
    if (this.inScenery(e)) { e[0] &= ~MonsterLogic.E_VISIBLE; }
  } // trySpawn

  /** `$A5F2`: leží obálka spritu na některé pevné buňce kolizní mapy? */
  inScenery(e) {
    var previous = this.p.useEntity(e);
    var cells = this.p.cells();
    this.p.useEntity(previous);
    if (!cells) { return false; }
    var base = (cells.addr + 0xA100) & 0xFFFF;      // $A5F5 LD BC,$A100 / ADD HL,BC
    for (var row = 0; row < cells.rows; row++) {
      for (var col = 0; col < cells.cols; col++) {
        if (this.p.attribute(base + row * 32 + col) & 0x80) { return true; }
      }
    }
    return false;
  } // inScenery

  /**
   * `$A87F` + `$828C`: dotkl se nepřítel Charlieho? Charlieho obálka je posunutá
   * o `$10` dolů – v originálu doslova `ADD A,$10`, ne odhad.
   */
  touchesCharlie(e) {
    var charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
    // $828C: obě `x` jsou devítibitová, protože bit 7 příznaků je znaménko.
    var cx = charlie[1] + ((charlie[0] & MonsterLogic.E_XWRAP) ? 0 : 0x100);
    var ex = e[1] + ((e[0] & MonsterLogic.E_XWRAP) ? 0 : 0x100);
    // $82AF: šířka se bere podle toho, kdo je vlevo – Charlieho, když je
    // entita vpravo od něj, a entity, když je vlevo. Ne obě naráz.
    var dx = ex - cx;
    if (dx >= 0) { if (dx >= charlie[3]) { return false; } }
    else if (-dx >= e[3]) { return false; }
    // $A87F: Charlieho obálka je posunutá o $10 dolů, doslova `ADD A,$10`.
    var e0 = (charlie[2] + 0x10) & 0xFF;                  // $A883 -> E
    var d0 = (e0 + charlie[4]) & 0xFF;                    // $A889 -> D
    var a = (e[2] + 0x10) & 0xFF;
    if (a >= d0) { return false; }                        // $82C6 CP D / RET NC
    a = (a + e[4]) & 0xFF;
    return a >= e0;                                       // $82CB CP E / CCF / RET NC
  } // touchesCharlie

  /** `$A653`: zabitý nepřítel dostane bit 3 a seznam rámců mizení `$AAC4`. */
  kill(slot) {
    var e = this.entities[slot], k = this.k;
    if (e[0] & MonsterLogic.E_VANISHING) { return; }
    this.sounds.push({sound: 'monsterDeath', value: k.deathSound});
    var pointer = k.deathScriptLo | k.deathScriptHi << 8;
    e[9] = pointer & 0xFF;
    e[0x0A] = pointer >> 8;
    e[0] |= MonsterLogic.E_VANISHING;
    this.kills++;
  } // kill

  /**
   * `$A67A`: krok **seznamu rámců** (ne bajtkódu M3). Proud je rámec za rámcem;
   * `$00` je skok na dvoubajtový ukazatel, `$01` konec – entita zmizí.
   * @return {boolean} Existuje ještě?
   */
  frameStep(slot) {
    var e = this.entities[slot];
    var pointer = e[9] + 256 * e[0x0A];
    var frame = this.p.byteAt(pointer);
    pointer = (pointer + 1) & 0xFFFF;
    var command = this.p.byteAt(pointer);
    if (command === 1) {
      // $A688: konec seznamu shodí bity 0 a 3 – ale **průchod pokračuje**,
      // rámec i ukazatel se ještě uloží. `$AAE4` snižuje jen krtek (M4, $9FED).
      e[0] &= ~(MonsterLogic.E_VISIBLE | MonsterLogic.E_VANISHING);
    } else if (command === 0) {
      pointer = this.p.byteAt((pointer + 1) & 0xFFFF)
                | this.p.byteAt((pointer + 2) & 0xFFFF) << 8;
    }
    e[0x1E] = frame;
    e[9] = pointer & 0xFF;
    e[0x0A] = pointer >> 8;
    // $A6A2: $8E80 by shodilo bity příznaků, které dispečer právě drží
    var keep = e[0], previous = this.p.useEntity(e);
    this.p.setFrame(frame);
    this.p.useEntity(previous);
    e[0] = keep;
    return true;
  } // frameStep

  /**
   * `$A6AB`: kterým směrem se nepřítel pohne. Bez gravity sticku **jde po
   * Charliem** (maska směrů se skládá z porovnání `x` a `y`); s položeným
   * stickem jdou všichni **dolů**, k němu.
   */
  direction(slot) {
    var e = this.entities[slot], k = this.k, dirs = 0;
    if (this.vars.stickLife) {
      dirs = (e[0] & MonsterLogic.E_VANISHING) ? 0 : k.stickFallMask;
      return this.typeBehaviour(slot, dirs);
    }
    var charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
    var cx = (charlie[0] & MonsterLogic.E_XWRAP) ? charlie[1] - 256 : charlie[1];
    var ex = (e[0] & MonsterLogic.E_XWRAP) ? e[1] - 256 : e[1];
    if (ex > cx) { dirs = 2; } else if (ex < cx) { dirs = 1; }
    if (charlie[2] !== e[2]) { dirs |= (charlie[2] < e[2]) ? 8 : 4; }
    return this.typeBehaviour(slot, dirs);
  } // direction

  /** `$A6F5`: čím se jednotlivé typy liší. */
  typeBehaviour(slot, dirs) {
    var e = this.entities[slot], k = this.k, type = e[0x0D];
    if (type === 1) {
      // $A6FB: bliká okrajem obrazovky a jednou za šestnáct kroků se otočí
      this.border = this.r() & k.type1BorderMask;
      if ((this.r() & k.type1TurnMask) === 0) { e[0x1F] = (this.r() & 0x10) ? 2 : 1; }
      dirs = e[0x1F];
    } else if (type === 2) {
      // $A71C: drží starý směr a jen občas se za Charliem otočí
      if ((this.r() & k.type2TurnMask) === 0) { e[0x1F] = dirs; } else { dirs = e[0x1F]; }
    } else if (type === 3) {
      // $A731: poletuje podle vlastního počítadla a první takový v místnosti
      // určuje výšku tónu – proto se jeho y pamatuje
      if (!this.vars.type3Seen) { this.vars.type3Seen = e[2]; this.tone = e[2]; }
      if (e[2] >= k.type3MaxY) { e[2] = k.type3ClampY; }
      e[0x1F] = (e[0x1F] - 1) & 0xFF;
      dirs = (e[0x1F] & 0x40) ? 4 : 8;
      dirs |= (e[0x1F] & 0x80) ? 1 : 2;
    } else if (type >= 6) {
      // ★ Jen mugger se dostane přes $A771 do $A7CD. Typy 1–5 skáčou rovnou
      // na $A7F4, takže si `+$1F` **nepřepisují** – u typu 3 je to počítadlo
      // a u typů 1 a 2 zapamatovaný směr, ne kopie masky.
      this.mugger(slot);
      if (!(e[0] & MonsterLogic.E_VANISHING)) {
        var was = e[0x1F];
        e[0x1F] = dirs;
        if ((dirs & 3) && ((was ^ dirs) & 3)) {   // $A7DE: změnil se bok?
          var script = (dirs & 2) ? k.muggerWalkLeft : k.muggerWalkRight;
          e[9] = script & 0xFF;
          e[0x0A] = script >> 8;
        }
      }
    }
    this.dirs = dirs;
    return dirs;
  } // typeBehaviour

  /**
   * `$A771`: **mugger krade**. Podmínka je, že v téhle návštěvě ještě nekradl,
   * že právě mizí (tj. že se před chvílí Charlieho dotkl, `$A651`) a že Charlie
   * vůbec nějaký alchiem má.
   */
  mugger(slot) {
    var e = this.entities[slot], k = this.k, state = this.world;
    if (this.vars.mugged & 1) { return; }
    if (!(e[0] & MonsterLogic.E_VANISHING)) { return; }
    if (!this.vars.alchiemMask) { return; }
    this.vars.mugged |= 1;
    // $A786: z osmi držených se sebere ten nejstarší (dvoubitové číslo)
    var id = (this.vars.alchiemList >> 14) & 3;
    this.vars.alchiemList = (this.vars.alchiemList << 2) & 0xFFFF;
    this.vars.alchiemMask = (this.vars.alchiemMask >> 1) & 0xFF;
    // $A7A0: a schová se do první místnosti, do které se smí něco položit
    var at = this.vars.room;
    for (var i = 0; i < 256; i++) {
      at = (at + 1) & 0xFF;
      if ((state.get(at) & k.hideMask) === k.hideValue) { break; }
    }
    var value = (state.get(at) & k.hideClearMask) | k.hideSetBit;
    state.set(at, (value | (id << 4)) & 0xFF);
    this.matchWanted();
    this.sounds.push({sound: 'alchiemStolen', value: k.stealSound});
    this.steals++;
  } // mugger

  /** `$A7F4`: posun a meze hrací plochy; co z nich vyjede, se vrátí zpátky. */
  moveMonster(slot) {
    var e = this.entities[slot], k = this.k;
    var x = e[1], y = e[2], flags = e[0];
    if (!(flags & MonsterLogic.E_VANISHING)) {
      var previous = this.p.useEntity(e);
      this.p.move(this.dirs, e[6]);
      this.p.useEntity(previous);
    }
    var out = ((e[3] - 1 + e[1]) > 0xFF) || (e[2] >= k.boundsMaxY)
              || !(e[0] & MonsterLogic.E_VISIBLE);
    if (out) { e[1] = x; e[2] = y; e[0] = flags; }
    e[0] |= MonsterLogic.E_DIRTY;
  } // moveMonster

  // ------------------------------------------------ poletující objekty ($AAED)

  /**
   * `$AA27`: `$AA20`–`$AA24` je **tahle místnost a její čtyři sousedky**.
   * Objekt v sousedce může přečnívat přes hranici, proto se počítají všechny.
   */
  computeNeighbours(room) {
    this.neighbours = [room, room, room, room, room];
    var world = this.world;
    if (world && world.neighbour) {
      // v pořadí, ve kterém je počítá $AA33: nahoru, dolů, vlevo, vpravo
      this.neighbours[1] = world.neighbour(room, 8);
      this.neighbours[2] = world.neighbour(room, 4);
      this.neighbours[3] = world.neighbour(room, 2);
      this.neighbours[4] = world.neighbour(room, 1);
    }
  } // computeNeighbours

  /** Sousedky bez sahání na příznaky objektů – pro matcher, který je má z nahrávky. */
  markObjectsFrom(room) {
    this.vars.room = room & 0xFF;
    this.computeNeighbours(this.vars.room);
  } // markObjectsFrom

  /** `$AA25`: po výměně místnosti se vybere, které objekty jsou vidět. */
  markObjects() {
    this.computeNeighbours(this.vars.room);
    for (var i = 0; i < this.objects.length; i++) {
      var record = this.objects[i].record;
      var here = this.neighbours.indexOf(record[2]) >= 0;
      if (here) { record[7] |= 0x80; } else { record[7] &= 0x7F; }
    }
    this.objectTicks.fill(0x80);
  } // markObjects

  /**
   * `$A479`: objekty. Dvě smyčky přes všech 94 záznamů – první je posune podle
   * jejich vlastního bajtkódu, druhá je vykreslí do osmi volných slotů tabulky
   * entit a **zjistí, jestli se Charlieho nedotkly**.
   */
  objectsPass() {
    var k = this.k;
    for (var i = 0; i < this.objects.length; i++) {
      var record = this.objects[i].record;
      if (!(record[7] & 0x80)) { continue; }
      record[1] &= 0x7F;
      if (!(this.objectTicks[i] & 0x80)) { continue; }
      record[1] |= 0x80;                      // $A4AA: v tomhle průchodu se hýbe
      this.objectScriptStep(i);
    }
    for (var s = 0; s < k.objectSlots; s++) {
      this.entities[MonsterLogic.SLOT_OBJECTS + s][0] &= ~MonsterLogic.E_VISIBLE;
    }
    for (var j = this.objects.length - 1; j >= 0; j--) {
      this.vars.objectIndex = j + 1;
      this.showObject(j);
    }
  } // objectsPass

  /**
   * `$A8AC`: krok bajtkódu objektu. Je to **jiný interpret než v M3**: opkódy
   * mají jiný význam, vzdálenosti si objekt drží v nibblech `+$03` a `call`
   * s `return` mění ukazatel **uprostřed kroku**, takže se nečte lineárně.
   */
  objectScriptStep(index) {
    var object = this.objects[index], record = object.record;
    this.objectTicks[index] = record[3] & 0x0F;      // $A8AF: perioda je nibble
    var pointer = record[0] | (record[1] | 0x80) << 8;
    pointer = (pointer + 1) & 0xFFFF;                // $A8B2: rámec už je znám
    var guard = 0;
    while (guard++ < 64) {
      var command = this.p.byteAt(pointer);
      pointer = (pointer + 1) & 0xFFFF;
      var op = (command >> 4) & 7, arg = command & 0x0F;
      if (op === 1) {                                // posun o uloženou vzdálenost
        this.moveObject(index, arg, (record[3] >> 4) & 0x0F);
      } else if (op === 2) {                         // vzdálenosti jsou za příkazem
        var distances = this.p.byteAt(pointer);
        pointer = (pointer + 1) & 0xFFFF;
        this.moveObject(index, arg & 0x0C, distances & 0x0F);
        this.moveObject(index, arg & 0x03, (distances >> 4) & 0x0F);
      } else if (op === 3) {                         // dolní nibble +$03 = perioda
        record[3] = (record[3] & 0xF0) | arg;
      } else if (op === 4) {                         // horní nibble = vzdálenost
        record[3] = (record[3] & 0x0F) | (arg << 4);
      } else if (op === 5) {                         // call
        var target = this.p.byteAt(pointer)
                     | (this.p.byteAt((pointer + 1) & 0xFFFF) & 0x7F) << 8 | 0x8000;
        pointer = (pointer + 2) & 0xFFFF;
        record[6] = pointer & 0xFF;
        record[7] = (record[7] & 0x80) | ((pointer >> 8) & 0x7F);
        pointer = target;
      } else if (op === 6) {                         // return
        pointer = record[6] | (record[7] & 0x7F) << 8 | 0x8000;
      }
      if (command & 0x80) { break; }
    }
    record[0] = pointer & 0xFF;
    record[1] = (record[1] & 0x80) | ((pointer >> 8) & 0x7F);
  } // objectScriptStep

  /**
   * `$A970`: posun objektu. Na rozdíl od entit se objekt nezastaví na okraji –
   * **přeteče do sousední místnosti** a jeho `+$02` se přepočítá po toru
   * 16 × 16 (`$A9BA`–`$A9D5`), stejně jako přechody Charlieho z M2 §8.4.
   */
  moveObject(index, dirs, dist) {
    var record = this.objects[index].record;
    if (!dirs || !dist) { return; }
    var x = record[4];
    if (dirs & 1) { x += dist; if (x > 0xFF) { this.objectRoom(index, 1); x &= 0xFF; } }
    if (dirs & 2) { x -= dist; if (x < 0) { this.objectRoom(index, 2); x &= 0xFF; } }
    record[4] = x & 0xFF;
    var y = record[5];
    if (dirs & 4) { y += dist; if (y >= 0xA8) { this.objectRoom(index, 4); y -= 0xA8; } }
    if (dirs & 8) { y -= dist; if (y < 0) { this.objectRoom(index, 8); y += 0xA8; } }
    record[5] = y & 0xFF;
  } // moveObject

  /** `$A9DB`: číslo místnosti je `sloupec | řádek << 4`, oboje po toru 16 × 16. */
  objectRoom(index, dir) {
    var record = this.objects[index].record;
    var col = record[2] & 0x0F, row = (record[2] >> 4) & 0x0F;
    if (dir & 1) { col++; } else if (dir & 2) { col--; }
    if (dir & 4) { row++; } else if (dir & 8) { row--; }
    record[2] = ((col & 0x0F) | ((row & 0x0F) << 4)) & 0xFF;
  } // objectRoom

  /**
   * `$A4DC`: objekt v téhle místnosti (nebo přečnívající ze sousedky) se položí
   * do volného slotu tabulky entit. Když se přitom kryje s Charliem, **ubere
   * dvě jednotky energie a nastaví mu bit 3** – a to je ten bit, ze kterého
   * `$7FE8` udělá whirlwind.
   */
  showObject(index) {
    var record = this.objects[index].record, k = this.k;
    if (!(record[7] & 0x80)) { return; }
    var y = record[5], negative = false;
    if (record[2] !== this.vars.room) {
      if (record[2] === this.neighbours[2]) {          // sousedka dolů: přečnívá zdola
        negative = true;
        if (((record[4] + this.spriteWidth(index) - 1) & 0x100) === 0) { return; }
      } else if (record[2] === this.neighbours[1]) {   // sousedka nahoru
        y = (record[5] - 0xA8) & 0xFF;
        if (((y + 0x0F) & 0x100) === 0) { return; }
      } else { return; }
    }
    var slot = -1;
    for (var s = 0; s < k.objectSlots; s++) {
      var candidate = this.entities[MonsterLogic.SLOT_OBJECTS + s];
      if (!candidate[0x1F]) { candidate[0x1F] = this.vars.objectIndex; slot = s; break; }
      if (candidate[0x1F] === this.vars.objectIndex) { slot = s; break; }
    }
    if (slot < 0) { return; }
    var e = this.entities[MonsterLogic.SLOT_OBJECTS + slot];
    if (negative) { e[0] |= MonsterLogic.E_XWRAP; } else { e[0] &= ~MonsterLogic.E_XWRAP; }
    var frame = this.objectFrame(index);
    var previous = this.p.useEntity(e);
    this.p.setFrame(frame);
    this.p.useEntity(previous);
    e[1] = record[4];
    e[2] = y;
    if (!(record[1] & 0x80)) { return; }               // $A55A: nehýbal se, nebolí
    if (!this.touchesCharlie(e)) { return; }
    // $A565: rámce $62–$65 jsou alchiemy, ty nebolí
    if (frame >= k.safeFrameLo && frame < k.safeFrameHi) { return; }
    var charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
    charlie[0] |= 0x08;                                // $A573 SET 3 – whirlwind
    this.throwLeft = charlie[1] >= e[1];               // $A57A: kterým směrem
    this.hurt(2);                                      // $A587: dvakrát DEC (HL)
  } // showObject

  /** Rámec objektu je **první bajt jeho skriptu** (`$A54D`). */
  objectFrame(index) {
    var record = this.objects[index].record;
    return this.p.byteAt(record[0] | (record[1] | 0x80) << 8);
  } // objectFrame

  /** `$A9FB`: šířka spritu, kterou si `$A4FF` bere na ořez u hranice místnosti. */
  spriteWidth(index) {
    var e = this.entities[MonsterLogic.SLOT_OBJECTS];
    var previous = this.p.useEntity(e);
    this.p.setFrame(this.objectFrame(index));
    var width = e[3];
    this.p.useEntity(previous);
    return width;
  } // spriteWidth

  // -------------------------------------------- alchiemy, muggeři, energie

  /**
   * `$82D0`: co leží v místnosti. Bit 6 stavu je **alchiem**, bit 3 **mugger**;
   * obojí sedí v témž záznamu entity (`$FD80`) a rozhoduje se až při doteku.
   */
  pickup() {
    var k = this.k, state = this.world, charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
    if (charlie[0] & MonsterLogic.E_XWRAP) { return; }
    var value = state.get(this.vars.room);
    if (!(value & 0x80) || !(value & k.pickupMask)) { return; }
    var e = this.entities[MonsterLogic.SLOT_PICKUP];
    if (!(e[0] & MonsterLogic.E_VISIBLE)) { return; }
    if (!this.touchesPickup(e)) { this.vars.debounce = 0; return; }
    if (!(value & k.hideSetBit)) { return this.catchMugger(); }
    if (this.vars.debounce) { return; }                 // $82FE: jeden dotek, jeden alchiem
    this.vars.debounce = 1;
    // $8307 SCF / RL (HL): do osmi slotů se přidá jeden a nejstarší vypadne
    var carry = (this.vars.alchiemMask & 0x80) !== 0;
    this.vars.alchiemMask = ((this.vars.alchiemMask << 1) | 1) & 0xFF;
    if (!carry) { value &= ~k.hideSetBit; }             // $830C: místnost je prázdná
    this.sounds.push({sound: 'alchiemTaken', value: k.alchiemSound});
    var id = (value >> 4) & 3;
    var dropped = (this.vars.alchiemList >> 14) & 3;
    this.vars.alchiemList = ((this.vars.alchiemList << 2) | id) & 0xFFFF;
    value = (value & ~0x30) | (dropped << 4);           // $8336: vypadlý zůstane tady
    state.set(this.vars.room, value & 0xFF);
    this.matchWanted();
    // $8343: devátý alchiem místnost neopustí – zůstane v ní ten vypadlý
    if (value & k.hideSetBit) {
      var previous = this.p.useEntity(e);
      this.p.setFrame(k.alchiemFrameBase + dropped);
      this.p.useEntity(previous);
    } else {
      e[0] &= ~MonsterLogic.E_VISIBLE;
    }
  } // pickup

  /** `$83C9`: dotek s tím, co v místnosti leží – pevná obálka `$10 × $10`. */
  touchesPickup(e) {
    var charlie = this.entities[MonsterLogic.SLOT_CHARLIE], k = this.k;
    var dx = Math.abs(charlie[1] - e[1]), dy = Math.abs(charlie[2] - e[2]);
    return dx < (k.pickupBox >> 8) && dy < (k.pickupBox & 0xFF);
  } // touchesPickup

  /**
   * `$8381`: dopadení muggera. Tohle je odpověď na „kolik je gravity sticků
   * a jak se získávají" – **spolu se životem navíc**, přesně jak říká inlay:
   * život, **plná energie** a **čtyři** sticky naráz. Mugger se přitom
   * přestěhuje do jiné místnosti, takže ho jde chytit znovu.
   */
  catchMugger() {
    var k = this.k, state = this.world;
    var value = state.get(this.vars.room);
    if (!(value & 0x08)) { return; }
    state.set(this.vars.room, value & ~0x08);
    if (this.vars.lives < k.maxLives) { this.vars.lives++; }
    this.vars.energy = k.energyFull;
    this.entities[MonsterLogic.SLOT_PICKUP][0] &= ~MonsterLogic.E_VISIBLE;
    this.vars.sticks = k.stickCountGiven;
    var at = this.vars.room;
    for (var i = 0; i < 256; i++) {
      at = (at + 1) & 0xFF;
      if (((state.get(at) & k.muggerMoveMask) ^ k.muggerMoveValue) === 0) { break; }
    }
    state.set(at, state.get(at) | 0x08);
    this.sounds.push({sound: 'muggerCaught'});
  } // catchMugger

  /**
   * `$7DF1`: **gravity stick**. Poklada se vstupním bajtem `$04`, tedy celou
   * řadou `A S D F G H J K L ENTER` – to je ten „down", u kterého M3 napsala,
   * že „astronaut nedělá nic". Dělá: položí stick.
   */
  placeStick(input) {
    var k = this.k, charlie = this.entities[MonsterLogic.SLOT_CHARLIE];
    if (this.vars.stickLife) { return this.stickTick(); }
    if (input !== k.stickInput) { return; }
    if (!(this.vars.sticks & k.stickHaveMask)) { return; }
    this.vars.sticks--;
    this.vars.stickLife = k.stickLife;
    var e = this.entities[MonsterLogic.SLOT_STICK];
    e[0] = k.stickFlags;
    var previous = this.p.useEntity(e);
    this.p.setFrame(k.stickFrame);
    this.p.useEntity(previous);
    e[2] = (charlie[2] + k.stickDy) & 0xFF;
    e[1] = (charlie[1] + k.stickDx) & 0xFF;
  } // placeStick

  /** `$7E30`: stick dotiká a zmizí. */
  stickTick() {
    this.vars.stickLife = (this.vars.stickLife - 1) & 0xFFFF;
    if (!this.vars.stickLife) {
      this.entities[MonsterLogic.SLOT_STICK][0] &= ~MonsterLogic.E_VISIBLE;
    }
  } // stickTick

  /**
   * Energie (`$AAE3`). Nekleslá na nulu, ale **pod nulu**: bit 7 spouští `$80A1`,
   * tedy odhození s **vynulovaným počítadlem pádu** – nejbližší dopad je
   * smrtelný. Dotek nepřítele stojí 1, dotek objektu 2, jedno použití krtka 1
   * (M4). Plná je `$3F`, tedy 63.
   */
  hurt(amount) {
    this.vars.energy = (this.vars.energy - amount) & 0xFF;
  } // hurt

  /** `$7FAE`: je energie pod nulou? Pak je Charlie odhozený a padá k smrti. */
  thrown() {
    return (this.vars.energy & 0x80) !== 0;
  } // thrown

  /** `$7F96`: po ztrátě života se energie vrátí na plnou. */
  respawn() {
    this.vars.lives--;
    this.vars.energy = this.k.energyRespawn;
    this.vars.stickLife = 0;
  } // respawn

  // ------------------------------------------------------- monolit a konec hry

  /**
   * `$7FB5`: v místnosti monolitu se dotek nepočítá jako whirlwind, ale jako
   * **konec hry** – ale jen když hráč má, co má mít. Co přesně, rozhoduje
   * `$5B33`: kolik z osmi držených alchiemů je ten hledaný (`$895B`).
   * @return {boolean} Začal konec hry?
   */
  monolithTouch() {
    if (this.vars.room !== this.monolithRoom) { return false; }
    if (this.vars.wantedCount & 0x40) { return false; }
    if (!(this.entities[MonsterLogic.SLOT_CHARLIE][0] & 0x08)) { return false; }
    this.vars.wantedCount |= 0x80;
    this.ending = true;
    return true;
  } // monolithTouch

  /** `$A838`: monolit odlétá – x o dvě doprava, y o jednu nahoru, rámec dál. */
  endStep() {
    var k = this.k, record = this.objects[93].record;
    if (!(this.vars.wantedCount & 0x80)) {
      if (!(this.vars.wantedCount & 0x40)) { return false; }
      this.monolithFrame = (this.monolithFrame + 1) & 0xFF;
      this.setScriptByte(k.monolithFrameVar, this.monolithFrame);
      this.tone = this.r();
      return this.monolithFrame === k.monolithLastFrame ? 'done' : true;
    }
    this.sounds.push({sound: 'monolith', value: k.endSound});
    record[4] = (record[4] + 2) & 0xFF;
    record[5] = (record[5] - 1) & 0xFF;
    if (record[5] < k.monolithMinY) {
      this.vars.wantedCount = (this.vars.wantedCount | 0x40) & ~0x80;
    }
    return true;
  } // endStep

  /**
   * `$9938` + `$99A5`: **jediné bodování, které hra má**. Není to skóre v
   * obvyklém smyslu – je to **procento**, které se ukáže na konci: navštívené
   * místnosti děleno čtyřmi, plus dvakrát každý hledaný alchiem (dohraná hra
   * místo toho `$26`), plus životy. Sčítá se **v BCD**.
   */
  score(visitedRooms) {
    var k = this.k;
    var percent = Math.floor(visitedRooms / k.scoreRoomsPerUnit);
    if (this.vars.wantedCount & 0x40) { percent += 0x26 - 0x26 + 38; }
    else { percent += 2 * (this.vars.wantedCount & 0x0F); }
    return percent + this.vars.lives;
  } // score

  /**
   * `$7F3C`: položený gravity stick zní svým počítadlem – hra bere bajt
   * `+$0B` záznamu `$FDA0` a píše ho do slotu 2 přerušení.
   * @returns {number} Výška tónu, nebo 0, když žádný stick neleží.
   */
  stickState() {
    if (!this.vars.stickLife) { return 0; }
    return this.entities[MonsterLogic.SLOT_STICK][0x0B];
  } // stickState

  /**
   * Výška tónu, kterou do slotu 2 zapsal tenhle průchod: nepřítel typu 3
   * svým `y` (`$A73D`, a jen ten první v místnosti podle `$AAE6`), nebo
   * závěrečný odlet šumem z registru `R` (`$A860`).
   * @returns {number} Výška tónu, nebo 0. Čtení ji spotřebuje, jako to dělá
   *          přerušení (`$9CB0`).
   */
  toneState() {
    var value = this.tone || 0;
    this.tone = 0;
    return value;
  } // toneState

  /** Stav pro workera – bajty záznamů, nic dopočítaného. */
  state() {
    var out = {monsters: [], objects: [], energy: this.vars.energy,
               lives: this.vars.lives, sticks: this.vars.sticks & 0x07,
               alchiems: this.vars.alchiemMask, alchiemList: this.vars.alchiemList,
               wanted: (this.vars.wanted >> 2) & 3,
               wantedCount: this.vars.wantedCount & 0x0F,
               stick: this.vars.stickLife ? this.entityState(MonsterLogic.SLOT_STICK) : false,
               pickup: this.entityState(MonsterLogic.SLOT_PICKUP)};
    for (var n = 0; n < this.k.monstersPerRoom; n++) {
      out.monsters.push(this.entityState(MonsterLogic.SLOT_MONSTERS + n));
    }
    for (var s = 0; s < this.k.objectSlots; s++) {
      out.objects.push(this.entityState(MonsterLogic.SLOT_OBJECTS + s));
    }
    return out;
  } // state

  /**
   * Jeden záznam v tomtéž tvaru, v jakém worker posílá Charlieho a krtka
   * (`app/WORKER-PROTOCOL.md`) – jsou to tytéž 32bajtové záznamy, takže je
   * `screenComposer.drawSprite()` kreslí týmž blitem.
   */
  entityState(slot) {
    var e = this.entities[slot];
    if (!(e[0] & MonsterLogic.E_VISIBLE)) { return false; }
    return {x: e[1], y: e[2], sprite: e[0x1E], visible: true,
            wrapped: !!(e[0] & MonsterLogic.E_XWRAP),
            bank: (e[0] & 0x40) ? 0 : 1, type: e[0x0D]};
  } // entityState

  /**
   * Snížení počítadel, které v originálu dělá **přerušení** (`$9CC7`): nejdřív
   * 128 bajtů `$E180` (poletující objekty), pak `(+$0B)` všech šestnácti
   * záznamů entit. Obojí jde dolů, jen dokud nemá bit 7.
   *
   * ★ Charlieho záznam se tady **vynechává**: jeho počítadlo snižuje
   * `charliePhysics.tickCounter()` (M3), a kdyby ho snížily obě, chodil by
   * dvakrát rychleji.
   */
  tickCounters() {
    for (var i = 0; i < this.objectTicks.length; i++) {
      if (!(this.objectTicks[i] & 0x80)) { this.objectTicks[i]--; }
    }
    for (var s = 0; s < this.entities.length; s++) {
      if (s === MonsterLogic.SLOT_CHARLIE) { continue; }
      var e = this.entities[s];
      if (!(e[0x0B] & 0x80)) { e[0x0B] = (e[0x0B] - 1) & 0xFF; }
    }
  } // tickCounters

  /** Co remake neumí reprodukovat a nezakrývá. */
  report() {
    return {randomCalls: this.randomCalls, kills: this.kills, steals: this.steals,
            note: 'losovani typu a pozice nepratel je $LD A,R ($A436, $A5E0) '
                  + 'a rozmisteni alchiemu a muggeru pri rozehrani ($86EA) – '
                  + 'reprodukovat to nejde, remake losuje a matcher bere z nahravky'};
  } // report

} // MonsterLogic

if (typeof self !== 'undefined') { self.MonsterLogic = MonsterLogic; }
if (typeof module !== 'undefined' && module.exports) { module.exports = MonsterLogic; }
