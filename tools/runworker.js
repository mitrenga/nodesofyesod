#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.js [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru (postMessage,
 * setTimeout) v režimu `headless`, kde tiká na vyžádání.
 *
 * **Od M3 je fyzika v něm skutečná** – `app/charliePhysics.js` je přepis rutin
 * originálu a `tools/matchphysics.js` na nahraných bězích trvá na nule rozdílů;
 * od M4 totéž pro krtka a stav světa (`tools/matchentities.js`). Tenhle test
 * tedy neověřuje fyziku (od toho jsou matchery), ale to, že **worker jako celek
 * drží protokol**: tiká na 50,08 Hz, krok skriptu vychází jednou za dva snímky,
 * hodiny a životy dorazí až do panelu, **přechod mezi místnostmi opravdu vymění
 * kulisu** a `reset` opravdu zahodí stav.
 *
 * Ke každému kroku se navíc nechá `app/screenComposer.js` složit panel a ověří
 * se, že hodiny a číslice životů v něm jsou ty, které worker hlásí – tedy že
 * celá cesta worker → model → panel drží pohromadě.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
const FRAME_RATE = 3500000/69888;

function loadDataFile(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

/** naimportuje ES modul remaku přímo ze zdroje (kořenový package.json má "type": "module") */
async function loadModule(name) {
  return import(url.pathToFileURL(path.join(ROOT, 'app', name+'.js')).href);
}

/** načte klasický skript, který si worker bere přes importScripts (fyzika, svět) */
function loadClassic(name) {
  return loadClassicScript(path.join(ROOT, 'app', name+'.js'));
}

/**
 * Spustí gameWorker.js v atrapě workeru. Worker je klasický a fyziku si bere
 * přes importScripts, takže se tady hlavička odřízne a třídy se do prostředí
 * vloží rovnou – je to tentýž soubor, jen jinak dodaný.
 */
function startWorker(onMessage, modules) {
  const sandbox = Object.assign({console, Math, Array, Object, JSON, Error,
    performance: {now: () => Date.now()},
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: onMessage,
    importScripts(name) {
      const file = name.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8'), context,
                      {filename: file});
    },
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    Uint8Array}, modules);
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8');
  const body = source.slice(source.indexOf('// begin code'));
  vm.runInContext(body, context, {filename: 'gameWorker.js'});
  return {send: (message) => sandbox.onmessage({data: message})};
}

let failures = 0;
function check(condition, message) {
  console.log('%s  %s', condition ? ' ok ' : 'FAIL', message);
  if (!condition) { failures++; }
}

async function main() {
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  // screenComposer.js importuje ZXVideoRAM ze svision – shim s window.srcVersion
  // se musí načíst jako první (R-001)
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await loadModule('screenComposer');
  const { ZXVideoRAM } = await import(url.pathToFileURL(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);
  const RoomScenery = loadClassic('roomScenery');
  const CharliePhysics = loadClassic('charliePhysics');
  const MolePhysics = loadClassic('molePhysics');
  const WorldState = loadClassic('worldState');
  const MonsterLogic = loadClassic('monsterLogic');

  const global_ = loadDataFile('global');
  const scenery = new RoomScenery(loadDataFile('scenery'), loadDataFile('rooms'),
                                  loadDataFile('world'));
  const room = global_.initRoom;
  const roomData = scenery.composeRoom(room, null);
  const render = new ScreenComposer(roomData, loadDataFile('font'), loadDataFile('panel'));
  render.setSprites(loadDataFile('spriteframes'));
  const font = loadDataFile('font').glyphs;
  const panelData = loadDataFile('panel');

  let last = null, gameOver = null, rooms = [];
  const worker = startWorker((message) => {
    if (message.id === 'frame') { last = message; }
    if (message.id === 'room') { rooms.push(message); }
    if (message.id === 'gameOver') { gameOver = message; }
    if (message.id === 'error') { console.error(message.message); failures++; }
  }, {CharliePhysics, MolePhysics, WorldState, RoomScenery, MonsterLogic});
  const controls = {left: false, right: false, up: false, down: false, mode: false};
  const set = (changes) => {
    Object.assign(controls, changes);
    worker.send(Object.assign({id: 'controls'}, controls));
  };
  const tick = (count) => {
    for (let i = 0; i < count; i++) { worker.send({id: 'tick'}); }
  };

  const lives = global_.lives;
  const initData = {headless: true, lives: lives, room: room, edition: 48,
                    physics: loadDataFile('physics'),
                    mole: loadDataFile('mole'),
                    monsters: loadDataFile('monsters'),
                    spriteframes: loadDataFile('spriteframes'),
                    scenery: loadDataFile('scenery'),
                    rooms: loadDataFile('rooms'),
                    world: loadDataFile('world'), scene: {}};
  worker.send({id: 'init', initData: initData});
  check(last !== null && last.id === 'frame', 'worker odpovida na init snimkem');
  check(last.lives === lives, 'zivoty na startu: '+last.lives+' (data/global.json)');
  check(last.placeholder === undefined, 'snimek uz neni oznaceny jako atrapa fyziky');
  check(rooms.length === 1 && rooms[0].bitmap.length === 21*256,
        'worker poslal hraci plochu ('+(rooms[0] ? rooms[0].bitmap.length : 0)+' B bitmapy)');
  check(rooms[0] && rooms[0].dugWalls.length === 256,
        'a s ni stav sveta, bajt na mistnost');
  // ★ Edice je parametr, ne druhá hra: worker si ji nese a hlásí, ale herně
  // z ní nic neplyne (ZADANI.md par. 0 – edice se liší jen zvukem, a ten je M7).
  check(last.edition === 48, 'worker hlasi edici 48 podle parametru');
  worker.send({id: 'reset'});
  worker.send({id: 'init', initData: Object.assign({}, initData, {edition: 128})});
  check(last.edition === 128, 'a edici 128, kdyz se posle ta');
  const with128 = {x: last.charlie.x, y: last.charlie.y, room: last.room};
  worker.send({id: 'reset'});
  worker.send({id: 'init', initData: initData});
  check(last.charlie.x === with128.x && last.charlie.y === with128.y
        && last.room === with128.room,
        'a v obou edicich zacina hra na temtez miste (edice je jen zvuk)');
  const startX = last.charlie.x, startY = last.charlie.y;

  // chůze doprava a doleva – skript originálu, krok 3 px jednou za dva snímky
  set({right: true}); tick(20); set({right: false}); tick(1);
  check(last.charlie.x > startX, 'chuze doprava posunula Charlieho na x='+last.charlie.x);
  const walked = last.charlie.x-startX;
  check(walked % 3 === 0, 'posun je nasobek kroku 3 px originalu ('+walked+' px)');
  check(walked <= 3*Math.ceil(20/2),
        'za 20 snimku nejvys '+3*Math.ceil(20/2)+' px (krok jednou za dva snimky)');
  const right = last.charlie.x;
  set({left: true}); tick(20); set({left: false}); tick(1);
  check(last.charlie.x < right, 'chuze doleva posunula Charlieho na x='+last.charlie.x);

  // skok: musí se odlepit od podlahy a zase dopadnout
  const groundY = last.charlie.y;
  set({up: true}); tick(2); set({up: false});
  let top = groundY;
  for (let i = 0; i < 200; i++) { tick(1); top = Math.min(top, last.charlie.y); }
  check(top < groundY, 'skok Charlieho zvedl o '+(groundY-top)+' px');
  check(last.charlie.y === groundY, 'a dopadl zpatky na y='+last.charlie.y);
  check(startY === groundY, 'stoji na tomtez y jako na zacatku ('+groundY+')');

  // hodiny: panel originálu má TIME, worker ho počítá ze snímků
  const frames = last.frame;
  check(last.time === Math.floor(frames/FRAME_RATE),
        'hodiny sedi na 50,08 Hz: snimek '+frames+' -> '+last.time+' s');

  // panel: složí se rendererem a zkontroluje se, že v něm je to, co worker hlásí
  const memory0 = new ZXVideoRAM();
  render.composePanelInto(memory0, {lives: last.lives, time: last.time});
  const composed = memory0.toLinear(ScreenComposer.PANEL_AREA);
  const cellAt = (row, col) => Array.from({length: 8},
    (unused, pixel) => composed.bitmap[(row*8+pixel)*32+col]);
  const glyph = (char) => Array.from(Buffer.from(font[char], 'hex'));
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const livesField = panelData.fields.lives;
  check(same(cellAt(livesField.row, livesField.column), glyph(String(last.lives))),
        'v panelu je cislice zivotu '+last.lives);
  const timeField = panelData.fields.time;
  const clock = ScreenComposer.clock(last.time);
  check(clock.split('').every((char, i) =>
          same(cellAt(timeField.row, timeField.column+i), glyph(char))),
        'v panelu jsou hodiny '+clock);
  check(composed.attributes.length === 96, 'panel ma 96 bajtu atributu');

  // renderer musí Charlieho opravdu nakreslit – bajty hrací plochy se změní
  const plain = new Uint8Array(256*168*4);
  render.composeInto(memory0, {});
  memory0.paint(plain, false, render.playArea, ScreenComposer.ATTR_MASK);
  const withCharlie = new Uint8Array(256*168*4);
  render.composeInto(memory0, {charlie: last.charlie});
  memory0.paint(withCharlie, false, render.playArea, ScreenComposer.ATTR_MASK);
  check(!plain.every((value, i) => value === withCharlie[i]),
        'screenComposer kresli Charlieho do hraci plochy (ramec '+last.charlie.sprite+')');

  // ★ Oprava M6: **atribut spritu nepřepisuje papír pozadí** ($940E-$9445).
  // Než se to změřilo, malovala hra kolem Charlieho na povrchu černé obdélníky,
  // protože jeho rámec má papír 0. Kontroluje se to, co originál dělá: papír
  // zůstane, kulisa se nepřebarví, a inkoust rámce se zapíše.
  const rule = loadDataFile('spriteframes').attributes;
  const roomAttrs = render.room.attributes;
  // kreslí se do kopie videopaměti místnosti a čtou se atributy hrací plochy
  const memory = render.roomMemory.copy();
  render.drawSprite(memory, last.charlie);
  const drawn = memory.toLinear(render.playArea).attributes;
  const guard = render.room.number < rule.surfaceMaxRoom ? rule.guardSurface
                                                         : rule.guardCave;
  let papers = 0, repainted = 0, inked = 0;
  for (let cell = 0; cell < roomAttrs.length; cell++) {
    if ((drawn[cell] & rule.paperMask) !== (roomAttrs[cell] & rule.paperMask)) { papers++; }
    const background = roomAttrs[cell] & rule.shadowMask;
    if (background !== 0 && background !== guard && drawn[cell] !== roomAttrs[cell]) { repainted++; }
    if (drawn[cell] !== roomAttrs[cell]) { inked++; }
  }
  check(papers === 0, 'atribut spritu nechava papir pozadi ('+papers+' zmenenych bunek)');
  check(repainted === 0, 'a kulisu neprebarvuje ('+repainted+' bunek mimo pozadi $'
        +guard.toString(16)+')');
  check(inked > 0, 'inkoust ramce se ale zapise ('+inked+' bunek obalky spritu)');

  // ★ M4: přechod mezi místnostmi. Charlie jde doprava, dokud nevyjde
  // z místnosti, a worker musí vyměnit kulisu a poslat ji.
  const startRoom = last.room;
  rooms = [];
  set({right: true}); tick(1200); set({right: false}); tick(1);
  if (VERBOSE) { console.log('     po 1200 snimcich doprava: mistnost %d, x=%d, %d zprav room',
                             last.room, last.charlie.x, rooms.length); }
  check(last.charlie.x <= 255, 'Charlie z hraci plochy neuteče (x='+last.charlie.x+')');
  check(last.room !== startRoom,
        'prechod do sousedni mistnosti: '+startRoom+' -> '+last.room);
  check(rooms.length > 0 && rooms[rooms.length-1].room === last.room,
        'worker poslal novou hraci plochu ('+rooms.length+' zprav room)');
  // každá ohlášená místnost musí být sousedka té předchozí – číslo počítá
  // WorldState.neighbour(), přepis $882B (ověřený tools/checkworld.py)
  const world = new WorldState(loadDataFile('world'));
  const chain = [startRoom].concat(rooms.map((message) => message.room));
  let linked = 0;
  for (let i = 1; i < chain.length; i++) {
    const neighbours = [WorldState.RIGHT, WorldState.LEFT, WorldState.DOWN, WorldState.UP]
      .map((direction) => world.neighbour(chain[i-1], direction));
    if (neighbours.indexOf(chain[i]) >= 0) { linked++; }
  }
  check(linked === chain.length-1,
        'kazda nova mistnost je sousedka te predchozi ('+chain.join(' -> ')+')');

  // ★ M4: krtek a stav světa jako samostatné kusy. Věrnost hlídá
  // tools/matchentities.js; tady jde o to, že to drží pohromadě.
  const physics = new CharliePhysics(loadDataFile('physics'),
                                     loadDataFile('spriteframes'), loadDataFile('mole'));
  const mole = new MolePhysics(physics, loadDataFile('mole'), world, () => 0);
  physics.mole = mole;
  const diggable = [];
  for (let n = 0; n < 256; n++) { if (world.canDig(n)) { diggable.push(n); } }
  check(diggable.length === world.count().diggable,
        'prokousatelnych sten: '+diggable.length+' (data/world.json)');
  world.dig(diggable[0]);
  check(!world.canDig(diggable[0]) && world.roomState(diggable[0]).dugRight,
        'prokousana stena zustane prokousana a jde do skladani mistnosti');
  const rightOf = world.neighbour(diggable[0], WorldState.RIGHT);
  check(world.roomState(rightOf).dugLeft,
        'a sousedka vpravo ma tim samym bitem otevrenou levou stenu');
  const scenery2 = new RoomScenery(loadDataFile('scenery'), loadDataFile('rooms'),
                                   loadDataFile('world'));
  const closed = scenery2.composeRoom(diggable[0], {dugRight: false, dugLeft: false});
  const open = scenery2.composeRoom(diggable[0], world.roomState(diggable[0]));
  const gapCells = loadDataFile('world').wallGap;
  let opened = 0;
  for (let row = gapCells.y; row < gapCells.y+gapCells.height; row++) {
    for (let col = gapCells.xRight; col < gapCells.xRight+gapCells.width; col++) {
      if ((closed.attributes[row*32+col] & 0x80) && !(open.attributes[row*32+col] & 0x80)) {
        opened++;
      }
    }
  }
  check(opened === gapCells.width*gapCells.height,
        'v kolizni mape se otevrelo '+opened+' bunek z '
        +(gapCells.width*gapCells.height)+' (prochod 2 x 6)');
  physics.setRoom(diggable[0], open.attributes);
  mole.setSurface(open.bitmap, open.attributes);
  physics.vars.room = diggable[0];
  physics.vars.a2b7 |= MolePhysics.HAS_MOLE;
  physics.e[1] = 0x40;
  physics.e[2] = 0x78;
  mole.spawn();
  check(mole.visible() && mole.m[1] === 0x40 && mole.m[2] === 0x78,
        'krtek se vypusti tam, kde stoji Charlie (x='+mole.m[1]+' y='+mole.m[2]+')');
  check(mole.state().mode === 'mole', 'a v panelu se prepne ikona na krtka');
  check(mole.state().bank === 1,
        'krtek se kresli z druhe banky spritu (bit 6 priznaku entity)');

  // ★ M5: nepřátelé, alchiemy, muggeři a pravidla. Věrnost hlídá
  // tools/matchmonsters.js; tady jde o to, že to drží pohromadě a že se
  // **losování při rozehrání** opravdu děje (originál ho dělá taky, $8553).
  const monsterWorld = new WorldState(loadDataFile('world'));
  let seed = 1;
  const monsters = new MonsterLogic(physics, loadDataFile('monsters'),
                                    monsterWorld, () => {
                                      seed = (seed*1103515245 + 12345) & 0x7FFFFFFF;
                                      return (seed >> 16) & 0xFF;
                                    });
  monsters.newGame();
  let alchiemRooms = 0, muggerRooms = 0;
  for (let n = 0; n < 256; n++) {
    if (monsterWorld.get(n) & 0x40) { alchiemRooms++; }
    if (monsterWorld.get(n) & 0x08) { muggerRooms++; }
  }
  check(alchiemRooms === monsters.k.alchiemsPlaced,
        'rozehrani rozmistilo '+alchiemRooms+' alchiemu ($8563 LD B,$20)');
  check(muggerRooms === monsters.k.muggersPlaced,
        'a '+muggerRooms+' muggeru ($8572 LD B,$06)');
  check(monsters.monolithRoom
        === ((monsters.wantedRoom + monsters.k.monolithRoomOffset) & 0xFF),
        'monolit je o $'+monsters.k.monolithRoomOffset.toString(16)
        +' mistnosti dal nez ukazatel hledaneho alchiemu ($'
        +monsters.wantedRoom.toString(16)+' -> $'
        +monsters.monolithRoom.toString(16)+')');

  // nadzemní místnost nepřátele nemá ($A5B6 CP $10), podzemní ano
  monsters.changeRoom(0x06);
  for (let i = 0; i < 200; i++) { monsters.tickCounters(); monsters.pass(); }
  const onSurface = monsters.state().monsters.filter(Boolean).length;
  check(onSurface === 0, 'na povrchu se zadny nepritel nelosuje ($A5B6 CP $10)');
  monsters.changeRoom(0x14);
  for (let i = 0; i < 600; i++) { monsters.tickCounters(); monsters.pass(); }
  const inCave = monsters.state().monsters.filter(Boolean);
  check(inCave.length > 0,
        'v jeskyni se jich vylosovalo '+inCave.length+' ze tri slotu ($A5E0)');
  check(inCave.every((m) => m.type >= 1 && m.type <= 6),
        'a vsichni maji typ 1-6 (typy '+inCave.map((m) => m.type).join(' ')+')');

  // alchiem a mugger: co v místnosti leží, položí $88B5 (část kreslení místnosti)
  // a sebere $82D0. Obojí se v nahraných bězích nepotkalo, tak aspoň takhle.
  let picked = 0, caught = 0;
  for (let n = 0; n < 256; n++) {
    monsters.changeRoom(n);
    const item = monsters.entityState(MonsterLogic.SLOT_PICKUP);
    if (!item) { continue; }
    physics.e[0] = 0x11; physics.e[3] = 8; physics.e[4] = 16;
    physics.e[1] = item.x; physics.e[2] = item.y;
    const wasMask = monsters.vars.alchiemMask, wasLives = monsters.vars.lives;
    monsters.vars.debounce = 0;
    monsters.pickup();
    if (monsters.vars.alchiemMask !== wasMask) { picked++; }
    if (monsters.vars.lives !== wasLives) { caught++; }
  }
  check(picked === monsters.k.alchiemSlots,
        'alchiem se da sebrat: '+picked+' z osmi slotu se naplnilo ($82D0, poloha z $5D68)');
  check(caught > 0 && monsters.vars.sticks === monsters.k.stickCountGiven,
        'dopadeni muggera ('+caught+'x) dalo zivot a '+monsters.vars.sticks
        +' gravity sticky ($8381)');
  check(monsters.matchWanted() === (monsters.vars.wantedCount & 0x0F),
        'a hra vi, kolik z nich je ten hledany: '+(monsters.vars.wantedCount & 0x0F)
        +' ($895B)');

  // konec hry: dotek monolitu s hledanými alchiemy odnese monolit pryč
  monsters.changeRoom(monsters.monolithRoom);
  monsters.vars.wantedCount &= ~0x40;
  physics.e[0] |= 0x08;
  check(monsters.monolithTouch(), 'dotek monolitu spusti konec hry ($7FB5)');
  let endSteps = 0, result;
  while ((result = monsters.endStep()) && result !== 'done' && endSteps < 5000) { endSteps++; }
  check(result === 'done',
        'a monolit odleti za '+endSteps+' pruchodu ($A838 -> $9907)');

  // energie: dotek nepřítele je jedna jednotka, dotek objektu dvě, a pod nulou
  // se Charlie odhodí ($80A1)
  const full = monsters.vars.energy;
  monsters.hurt(1);
  check(monsters.vars.energy === full - 1 && !monsters.thrown(),
        'dotek nepritele stoji jednu jednotku energie z '+full+' ($A650)');
  monsters.vars.energy = 0;
  monsters.hurt(1);
  check(monsters.thrown(),
        'energie pod nulou znamena odhozeni a smrtelny pad ($AAE3 bit 7 -> $80A1)');
  monsters.respawn();
  check(monsters.vars.energy === monsters.k.energyRespawn,
        'a po ztrate zivota je zase plna ($'
        +monsters.k.energyRespawn.toString(16)+', $7F96)');

  // ★ M7: zvuk. Worker drží oba zvukové sloty přerušení jako stav světa
  // ($9C82 a $9CA5, disasm_notes.md §13.2), takže se dá zkontrolovat i to,
  // co je na zvuku nejsnáz k pokažení: že **slot 1 umlčí slot 2** – dokud
  // dohrává rozjezdový zvuk, přerušení se ke slotu 2 vůbec nedostane ($9C84).
  const sound = loadDataFile('sound');
  const { Beeper } = await loadModule('beeper');
  const beeper = new Beeper(sound);
  check(beeper.ready, 'data/sound.json ma tabulku period ('+sound.periods.count+' tonu)');
  check(Array.isArray(last.buzz),
        'worker hlasi bzukot slotu 2 v kazdem snimku (buzz)');
  const sweep = beeper.slot1Train(sound.constants.trigger_alchiem);
  check(sweep.pulses.length > 0,
        'zvuk sebraneho alchiemu ($830E, $'
        +sound.constants.trigger_alchiem.toString(16)+') ma '
        +sweep.pulses.length+' pulzu, '+Beeper.duration(sweep).toFixed(0)+' ms');
  const speech = beeper.speechTrain();
  check(speech && speech.pulses.length > 0,
        'digitalizovana rec je v datech: '+sound.speech.bits+' bitu, '
        +(Beeper.duration(speech)/1000).toFixed(2)+' s (★ kazeta na ni potreba nebyla)');
  const title = beeper.tuneTrain('title');
  check(title && title.pulses.length > 0,
        'titulni hudba ma '+sound.tuneLists.title.parts.length+' dilu a '
        +(Beeper.duration(title)/1000).toFixed(0)+' s');
  // obě edice hrají zatím totéž: 128K zvukový subsystém (AY, hudba Freda Graye)
  // M7 nedodala, a dokud ho nedodá, nesmí se hra chovat jinak
  check(last.edition === initData.edition,
        'worker hlasi edici, kterou dostal ('+last.edition+')');

  // reset a znovu, ať je vidět, že se stav opravdu zahodí
  worker.send({id: 'reset'});
  worker.send({id: 'init', initData: initData});
  check(last.frame === 0 && last.lives === lives && last.time === 0,
        'reset a novy init zacinaji od nuly');
  check(last.charlie.x === startX && last.charlie.y === startY,
        'a Charlie je zase tam, kde ho ma originál po startu');

  console.log(failures ? '\n%d kontrol selhalo' : '\nvsechny kontroly proslo',
              failures || '');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
