// begin code

var query = (typeof self !== 'undefined' && self.location) ? self.location.search : '';
importScripts('charliePhysics.js'+query);
importScripts('molePhysics.js'+query);
importScripts('worldState.js'+query);
importScripts('roomScenery.js'+query);
importScripts('monsterLogic.js'+query);

/**
 * Nodes of Yesod game worker.
 *
 * Tik je snímková frekvence originálu, 3,5 MHz / 69 888 T-stavů = **50,08 Hz**,
 * a je to ta správná jednotka: přerušení ULA v originálu snižuje počítadlo
 * `(+$0B)` záznamu Charlieho, a na tom stojí celá jeho rychlost. Krok skriptu
 * pak vychází **jednou za dva snímky** – změřeno `tools/tracephysics.py`.
 *
 * Fyzika **není atrapa**: `charliePhysics.js` a `molePhysics.js` jsou přepisy
 * rutin originálu a matchery na nahraných bězích trvají na nule rozdílů
 * (M3 §10, M4 §11 v `sources/docs/disasm_notes.md`).
 *
 * ★ **Od M4 je worker celý svět, ne jedna místnost.** Drží si
 *
 * * **perzistentní stav světa** (`worldState.js`, bajt na místnost jako `$B600`),
 * * **skládání místností** (`roomScenery.js`), takže si při přechodu novou
 *   místnost složí sám – přesně tak, jak to originál dělá **uprostřed
 *   průchodu** (`$8FE2 CALL $882B`), a Charlie se pak posune už v nové kulise,
 * * **krtka** (`molePhysics.js`), který ten stav mění.
 *
 * Model dostane hotovou hrací plochu ve zprávě `room`, a při žraní stěny jen
 * těch 96 bajtů průchodu, které se změnily (`app/WORKER-PROTOCOL.md`).
 *
 * Co worker pořád **nedělá**, protože to není M4: **nepřátelé, alchiemy,
 * muggeři, energie a omráčení** (M5) a **zvuk** (M7) – `sounds` je pořád jen
 * seznam jmen událostí.
 *
 * ★ **Edice (48 / 128) je parametr, ne druhá hra.** Obě edice originálu se liší
 * **jen zvukem** (`ZADANI.md` §0), takže se tady nese jen jako `edition`
 * a hlásí zpátky v každém snímku; **který zvukový subsystém z ní vyplyne, je
 * M7**. Kdyby se od ní odvíjelo cokoli herního, byl by to vymyšlený rozdíl.
 */

var TICK_MS = 1000*69888/3500000;     // 50.08 Hz, the ULA interrupt rate
var FRAME_RATE = 3500000/69888;

var state = null;
var timer = 0;
var lastTime = false;
var accumulator = 0;

function reset() {
  clearTimeout(timer);
  timer = 0;
  lastTime = false;
  accumulator = 0;
  state = {
    running: false, paused: false, headless: false,
    frame: 0, seconds: 0, world: null, gameOverPosted: false
  };
} // reset

/**
 * Co v originálu dělá `LD A,R` (`$A235`), tedy obnovovací registr Z80: rozhoduje,
 * kdy krtek vyleze z díry na povrchu. **Reprodukovat se to nedá**, takže se to
 * losuje – a `molePhysics.report()` to hlásí, neschovává.
 * @returns {number} Bajt 0-255.
 */
function randomByte() {
  return Math.floor(Math.random()*256) & 0xFF;
} // randomByte

function newWorld(initData) {
  var scene = initData.scene || {};
  var world = {
    physics: null, mole: null, monsters: null, scenery: null, state: null,
    surface: null,
    room: initData.room === undefined ? 0 : initData.room,
    // Kterou edicí hra běží (48 / 128). Herně to **nic nemění** – edice se liší
    // jen zvukem (`ZADANI.md` §0) – takže si to worker nese, hlásí to modelu
    // a **rozhodne se z toho až v M7**, který zvukový subsystém hraje.
    edition: initData.edition === 128 ? 128 : 48,
    input: {left: false, right: false, up: false, down: false, mode: false},
    lives: initData.lives === undefined ? 3 : initData.lives,
    alchiems: 0,
    sounds: [],
    // ★ M7: oba zvukové sloty přerušení jsou **stav světa**, ne efekt modelu.
    // `$9C82`/`$9C87` je rozjezdový zvuk, který si přerušení dohraje samo,
    // `$9CA5` je jeden snímek, do kterého píše herní kód (žraní stěny,
    // gravity stick, nepřítel typu 3, animace smrti). Když hraje slot 1,
    // slot 2 se ten snímek vůbec nepřehraje (`$9C84`) – a tohle to drží.
    sound: {slot1: 0, slot1Step: 0, slot2: 0},
    buzz: [],
    transition: null,
    roomChanged: false,
    dig: null,
    over: false,
    error: null
  };
  try {
    world.scenery = new RoomScenery(initData.scenery, initData.rooms, initData.world);
    world.state = new WorldState(initData.world);
    world.physics = new CharliePhysics(initData.physics, initData.spriteframes,
                                       initData.mole);
    world.mole = new MolePhysics(world.physics, initData.mole, world.state,
                                 randomByte);
    world.physics.mole = world.mole;
    world.monsters = new MonsterLogic(world.physics, initData.monsters,
                                      world.state, randomByte);
  } catch (error) {
    world.error = error.message;
    return world;
  }
  world.physics.reset({room: world.room, x: scene.x, y: scene.y});
  // $7DBF CALL $8553: alchiemy, muggeři, místnost monolitu i hledaný alchiem
  // si originál **losuje při rozehrání**, ne v datech (ZADANI.md §8).
  world.monsters.newGame();
  world.monsters.changeRoom(world.room);
  world.lives = world.monsters.vars.lives;
  compose(world, world.room);
  return world;
} // newWorld

/**
 * Složí místnost tak, jak ji skládá originál, a dá ji fyzice i krtkovi.
 *
 * Kolizní mapa je **bit 7 atributů** (§8.1), takže fyzika a kreslení sdílejí
 * tytéž bajty – a když krtek dožere stěnu, vyřeže se díra do obojího naráz,
 * jak to dělá `$9C5D`.
 * @param {Object} world - Stav světa.
 * @param {number} room - Číslo místnosti.
 */
function compose(world, room) {
  world.room = room & 0xFF;
  world.surface = world.scenery.composeRoom(world.room,
                                            world.state.roomState(world.room));
  world.physics.setRoom(world.room, world.surface.attributes);
  world.mole.setSurface(world.surface.bitmap, world.surface.attributes);
  world.roomChanged = true;
} // compose

/**
 * Vstupní bajt `$5B0B` z ovládání remaku. Akce remaku jsou **řady kláves
 * originálu** (WORKER-PROTOCOL.md), takže se mapují na tytéž bity – a role dvou
 * z nich se prohodí, když je v akci krtek (`$9A20`).
 * @param {Object} world - Stav světa.
 * @returns {number} Bajt $5B0B.
 */
function inputByte(world) {
  var input = world.input;
  var moleActive = world.mole.visible()
                   && world.room >= world.physics.caveRoom;
  return CharliePhysics.readInput({
    bottomRight: input.right, bottomLeft: input.left,
    middle: input.down, letters: input.up, numbers: input.mode
  }, moleActive);
} // inputByte

/** ztráta života; když dojdou, je konec hry */
/** Kolik z osmi slotů alchiemů je plných – to, co panel ukazuje ($835A). */
function countBits(mask) {
  var count = 0;
  for (var bit = 0; bit < 8; bit++) { if (mask & (1 << bit)) { count++; } }
  return count;
} // countBits

function loseLife(world) {
  world.sounds.push('death');
  // $7F92: se ztrátou života se energie vrátí na plnou ($3F)
  world.monsters.respawn();
  world.lives--;
  if (world.lives <= 0) {
    world.lives = 0;
    world.over = true;
  }
  world.physics.died = false;
  world.physics.vars.flags = 0;
  world.physics.fall.active = false;
} // loseLife

/**
 * Výměna místnosti. Originál ji dělá **uprostřed průchodu** (`$8FE2`) a teprve
 * pak Charlieho posune, takže ho z nové kulise vytlačí kolize – proto to není
 * zpráva pro model, ale funkce, kterou si fyzika zavolá sama.
 * @param {Object} world - Stav světa.
 * @param {Object} moved - Co vrátil `edge()`.
 * @returns {Object} {room, attributes} nové místnosti.
 */
function nextRoom(world, moved) {
  var room = world.state.neighbour(world.room, moved.direction);
  compose(world, room);
  // $8854 CALL $A2F4: nepřátelé této místnosti se uloží do paměti posledních
  // pěti a tabulka entit se naplní nepřáteli té nové (nebo zůstane prázdná)
  world.monsters.changeRoom(room);
  world.sounds.push('roomChange');
  return {room: world.room, attributes: world.surface.attributes};
} // nextRoom

function tick() {
  var s = state;
  var world = s.world;
  s.frame++;
  s.seconds = Math.floor(s.frame/FRAME_RATE);
  world.sounds.length = 0;
  world.roomChanged = false;
  world.dig = null;
  if (!world.physics) { return; }
  world.mole.sounds.length = 0;
  world.monsters.sounds.length = 0;
  // jednotky hodin ($5B0E) rozhodují, kdy krtek vyleze z díry na povrchu
  world.mole.setClock(s.seconds);
  // co v originálu dělá přerušení ($9CC7): počítadlo skriptu jde dolů o jedna
  world.physics.tickCounter();
  world.monsters.tickCounters();
  // Pořadí je pořadí hlavní smyčky originálu ($7DC3):
  //   $8F44  okraje a přechod, $7EE1  alchiem/mugger, $7DF1  gravity stick,
  //   $A479  poletující objekty a pak nepřátelé.
  var input = inputByte(world);
  var step = world.physics.pass(input, (moved) => nextRoom(world, moved));
  world.monsters.pickup();
  world.monsters.placeStick(input);
  world.monsters.objectsPass();
  world.monsters.pass();
  world.alchiems = countBits(world.monsters.vars.alchiemMask);
  // $7FAE: energie pod nulou znamená odhození a smrtelný pád ($80A1)
  if (world.monsters.thrown()) {
    world.physics.died = true;
  }
  // vektor na $9CE6, který hlavní smyčka volá **za** průchodem Charlieho:
  // žraní stěny po dvoupixelových kouscích
  var side = world.mole.eating;
  if (world.mole.digProgress() && side) {
    world.dig = {side: side, bytes: gapBytes(world.surface.bitmap, side)};
  }
  world.transition = step.transition;
  world.sounds = world.sounds.concat(world.mole.sounds, world.monsters.sounds);
  soundPass(world);
  if (step.died || world.physics.died) {
    loseLife(world);
  }
  if (world.over && !s.gameOverPosted) {
    s.gameOverPosted = true;
  }
} // tick

// Zvuky, které hra pouští **slotem 1** – zapíše bajt a přerušení ho dohraje
// (`data/sound.json` → constants.trigger_*).
var SLOT1_SOUNDS = ['alchiemTaken', 'monsterDeath', 'alchiemStolen', 'monolith'];

/**
 * Jeden průchod zvukem – to, co v originálu udělá přerušení `$9C7E`.
 *
 * Do slotu 2 (`$9CA5`) píše herní kód **během průchodu** a poslední zápis
 * vyhrává; pořadí hlavní smyčky je Charlie (gravity stick, `$7F3C`),
 * nepřátelé (typ 3, `$A73D`) a nakonec vektor žraní stěny (`$9BFD`), takže
 * kdo žere stěnu, ten je slyšet. Slot 1 (`$9C82`) má přednost před vším:
 * dokud dohrává, přerušení se ke slotu 2 vůbec nedostane.
 *
 * ★ Výšku tónu žraní bere originál z registru `R` (`$9BFD LD A,R`), a ten se
 * v prohlížeči nereprodukuje. Losuje se – a `report()` to říká nahlas, stejně
 * jako u dvanácti míst M5 (`ZADANI.md` §8).
 * @param {Object} world - Svět workeru.
 */
function soundPass(world) {
  var sound = world.sound;
  var monsters = world.monsters;
  var value = 0;
  // co hra zapsala do slotu 1 ($830E, $A657, $A7C3, $A840): rozjezd, který si
  // přerušení dohraje samo a **umlčí přitom slot 2**
  for (var i = 0; i < world.sounds.length; i++) {
    var item = world.sounds[i];
    if (item && item.value !== undefined && SLOT1_SOUNDS.indexOf(item.sound) >= 0) {
      startSlot1(world, item.value);
    }
  }
  // $7F3C: položený gravity stick zní svým počítadlem
  var stick = monsters.stickState && monsters.stickState();
  if (stick !== false && stick !== undefined && stick !== null) { value = stick; }
  // $A73D: nepřítel typu 3 zní svým y, a jen ten první v místnosti ($AAE6)
  var monster = monsters.toneState && monsters.toneState();
  if (monster !== false && monster !== undefined && monster !== null) { value = monster; }
  // $9BFD: krtek žere stěnu – šum z registru R
  if (world.mole.eating && world.mole.digCounter > 0) { value = randomByte(); }
  sound.slot2 = value & 0xFF;
  // přerušení: slot 1 má přednost a sám se rozjede dál, jinak zazní slot 2
  if (sound.slot1) {
    sound.slot1 = (sound.slot1+sound.slot1Step) & 0xFF;
    world.buzz.push(0);
    return;
  }
  world.buzz.push(sound.slot2);
  sound.slot2 = 0;                                        // $9CB0
} // soundPass

/**
 * Rozjezdový zvuk slotu 1 – to, co dělá `LD ($9C82),A` / `LD ($9C87),A`.
 * @param {Object} world - Svět workeru.
 * @param {number} value - Bajt, který hra do slotu zapsala.
 */
function startSlot1(world, value) {
  world.sound.slot1 = value & 0xFF;
  world.sound.slot1Step = value & 0xFF;
} // startSlot1

/**
 * Bajty jednoho průchodu z bitmapy hrací plochy – 2 buňky široko, 6 vysoko,
 * tedy 96 bajtů. Tolik se při žraní stěny mění a tolik se posílá modelu.
 * @param {Uint8Array} bitmap - Bitmapa hrací plochy.
 * @param {string} side - 'left' nebo 'right'.
 * @returns {Array} 96 bajtů.
 */
function gapBytes(bitmap, side) {
  var column = side === 'left' ? 0 : 30;
  var bytes = [];
  for (var row = 13; row < 19; row++) {
    for (var line = 0; line < 8; line++) {
      bytes.push(bitmap[row*256 + line*32 + column]);
      bytes.push(bitmap[row*256 + line*32 + column + 1]);
    }
  }
  return bytes;
} // gapBytes

function postRoom() {
  var world = state.world;
  postMessage({
    id: 'room',
    room: world.room,
    bitmap: Array.from(world.surface.bitmap),
    attributes: Array.from(world.surface.attributes),
    dugWalls: Array.from(world.state.bytes())
  });
} // postRoom

function postFrame() {
  var s = state;
  var world = s.world;
  if (world.error) {
    postMessage({id: 'error', message: world.error});
    return;
  }
  if (world.roomChanged) {
    postRoom();
  }
  var e = world.physics.e;
  postMessage({
    id: 'frame',
    frame: s.frame,
    time: s.seconds,
    lives: world.lives,
    alchiems: world.alchiems,
    room: world.room,
    edition: world.edition,
    charlie: {
      x: e[1], y: e[2], sprite: e[0x1E], visible: !!(e[0] & 0x01),
      wrapped: !!(e[0] & 0x80), bank: (e[0] & 0x40) ? 0 : 1,
      state: world.physics.vars.a2b7 & 0x10 ? 'whirl'
             : (world.physics.vars.a2b7 & 0x80 ? 'rise'
             : (world.physics.vars.flags & 0x02 ? 'fall'
             : (world.physics.vars.flags & 0x01 ? 'jump' : 'walk')))
    },
    mole: world.mole.state(),
    monsters: world.monsters.state(),
    dig: world.dig,
    transition: world.transition,
    sounds: world.sounds.slice(),
    // ★ M7: co slot 2 vyklepal v každém odtikaném snímku od minulé zprávy.
    // Jeden snímek je pár pulzů, takže se posílají v hrsti – model je slepí
    // do jedné vlny (`app/beeper.js`), jak to dělá reproduktor.
    buzz: world.buzz.slice(),
    state: s.gameOverPosted ? 'gameOver' : 'game'
  });
  world.buzz.length = 0;
  if (s.gameOverPosted && s.running) {
    postMessage({id: 'gameOver', time: s.seconds});
    s.running = false;
    clearTimeout(timer);
  }
} // postFrame

function loop() {
  var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (lastTime === false) {
    lastTime = now;
  }
  accumulator = Math.min(250, accumulator+now-lastTime);
  lastTime = now;
  var ticked = false;
  while (accumulator >= TICK_MS) {
    tick();
    accumulator -= TICK_MS;
    ticked = true;
  }
  if (ticked) {
    postFrame();
  }
  if (state.running && !state.paused) {
    timer = setTimeout(loop, Math.max(1, TICK_MS-accumulator));
  }
} // loop

reset();

onmessage = function (event) {
  var msg = event.data;
  switch (msg.id) {
    case 'init':
      var initData = msg.initData || {};
      reset();
      state.headless = !!initData.headless;
      state.world = newWorld(initData);
      state.running = true;
      if (!state.headless) {
        loop();
      }
      postFrame();
      break;
    case 'controls':
      var input = state.world ? state.world.input : null;
      if (input) {
        input.left = !!msg.left;
        input.right = !!msg.right;
        input.up = !!msg.up;
        input.down = !!msg.down;
        input.mode = !!msg.mode;
      }
      break;
    case 'pause':
      state.paused = true;
      clearTimeout(timer);
      break;
    case 'continue':
      if (state.running) {
        state.paused = false;
        lastTime = false;
        clearTimeout(timer);
        if (!state.headless) {
          loop();
        }
      }
      break;
    case 'tick':
      if (state.running) {
        tick();
        postFrame();
      }
      break;
    case 'reset':
      reset();
      break;
  }
};
