#!/usr/bin/env node
/**
 * Vykreslí herní obrazovku remaku do PNG – kontrola očima bez prohlížeče.
 *
 *   ./tools/renderframe.js [--out build/gfx] [--frames 1,300,900]
 *
 *   ./tools/renderframe.js [--out build/gfx] [--frames 1,300,900] [--room 6]
 *   ./tools/renderframe.js --walk left        # Charlie v chůzi (zrcadlené rámce)
 *   ./tools/renderframe.js --mole
 *
 * Běží celý řetěz remaku: `app/gameWorker.js` (od M4 celý svět – fyzika
 * Charlieho, krtek, stav světa a skládání místností), `app/roomScenery.js`
 * (místnost složená z kulisových bloků originálu) a `app/screenComposer.js`
 * (panel z `data/panel.json` a `data/font.json`, včetně ikony člověk/krtek).
 * Výstup je celá obrazovka 256 × 192, tedy přesně to, co uvidí hráč – hrací
 * plocha nahoře, panel dole.
 *
 * `--frames` říká, po kolika odtikaných snímcích se má snímat; hodiny v panelu
 * se tím posunou (50,08 snímku na sekundu), takže je vidět, že panel opravdu
 * žije z workeru.
 *
 * `--mole` je **kontrola očima pro M4**: postaví Charlieho do místnosti
 * s prokousatelnou stěnou, dá mu už uloveného krtka, vypustí ho a pošle ho
 * do stěny. Není to test věrnosti (od toho je `tools/matchentities.js`) – je to
 * obrázek, na kterém je vidět krtek, ikona v panelu, žraná stěna a hotový
 * průchod. Proto tenhle režim nejede přes workera, ale rovnou přes
 * `charliePhysics.js`, `molePhysics.js` a `worldState.js`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));

function writePNG(file, rgba, width, height) {
  const raw = Buffer.alloc((width*3+1)*height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < width; x++) {
      const source = (y*width+x)*4;
      raw[pos++] = rgba[source];
      raw[pos++] = rgba[source+1];
      raw[pos++] = rgba[source+2];
    }
  }
  const chunk = (tag, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(tag), payload]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

let table = null;
function crc32(buffer) {
  if (!table) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

/** worker je klasický a fyziku si bere přes importScripts – tady se shimuje */
function startWorker(onMessage, modules) {
  const sandbox = Object.assign({
    console, Uint8Array, Math, Array, Object, JSON, Error,
    performance: {now: () => Date.now()},
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: onMessage,
    importScripts(name) {
      const file = name.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8'), context,
                      {filename: file});
    },
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
  }, modules);
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('// begin code')), context,
                  {filename: 'gameWorker.js'});
  return {send: (message) => sandbox.onmessage({data: message})};
}

/**
 * `--mole`: scéna pro kontrolu očima. Prokousatelná stěna, uloveny krtek,
 * a pak se s krtkem jede doprava a dolů, dokud stěnu nezačne žrát.
 */
async function moleScene(modules, out) {
  const { ScreenComposer, ZXVideoRAM, RoomScenery, CharliePhysics, MolePhysics, WorldState } = modules;
  const moleData = load('mole');
  const world = new WorldState(load('world'));
  const scenery = new RoomScenery(load('scenery'), load('rooms'), load('world'));
  let room = 0;
  for (let n = 0x10; n < 256; n++) { if (world.canDig(n)) { room = n; break; } }
  const physics = new CharliePhysics(load('physics'), load('spriteframes'), moleData);
  const mole = new MolePhysics(physics, moleData, world, () => 0);
  physics.mole = mole;
  let surface = scenery.composeRoom(room, world.roomState(room));
  const render = new ScreenComposer(surface, load('font'), load('panel'));
  render.setSprites(load('spriteframes'));
  render.setPanelIcon(moleData.panelIcon);
  physics.reset({room: room});
  physics.setRoom(room, surface.attributes);
  mole.setSurface(surface.bitmap, surface.attributes);
  physics.vars.a2b7 |= MolePhysics.HAS_MOLE;
  // Charlie stojí v místnosti; kam přesně, nechá rozhodnout gravitaci
  physics.e[1] = 0x40;
  physics.e[2] = 0x40;

  // the room and the panel composed into one memory, the way the machine holds them
  const memory = new ZXVideoRAM();
  const screen = new Uint8ClampedArray(256*192*4);
  const shot = (name, frame) => {
    render.composeInto(memory, {charlie: physics.state(), mole: mole.state()});
    render.composePanelInto(memory, {lives: 3, time: Math.floor(frame/50.08),
                                     alchiems: 0, mode: mole.state().mode});
    memory.paint(screen, false, undefined, ScreenComposer.ATTR_MASK);
    const file = path.join(out, 'mole-'+name+'.png');
    writePNG(file, screen, 256, 192);
    console.log('%s  mistnost $%s  krtek %s  stav sveta $%s',
                path.relative(ROOT, file), room.toString(16).toUpperCase(),
                mole.visible() ? 'x'+mole.m[1]+' y'+mole.m[2] : '-',
                world.get(room).toString(16).toUpperCase());
  };
  const run = (frames, input) => {
    for (let n = 0; n < frames; n++) {
      physics.tickCounter();
      physics.pass(input);
      mole.digProgress();
    }
  };
  fs.mkdirSync(out, {recursive: true});
  run(60, 0x00);            // dopadne na podlahu
  shot('1-astronaut', 60);
  run(1, 0x08);             // přepínač: vypustí krtka
  run(80, 0x01);            // krtek jede doprava ke stěně
  shot('2-mole', 141);
  run(200, 0x05);           // doprava a dolů, tam začne žrát
  shot('3-eating', 341);
  run(400, 0x05);           // dožere
  shot('4-through', 741);
  // a nová kulise s hotovým průchodem
  surface = scenery.composeRoom(room, world.roomState(room));
  render.setRoom(surface);
  shot('5-composed', 741);
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf('--out');
  const out = outArg >= 0 ? args[outArg+1] : path.join(ROOT, 'build/gfx');
  const roomArg = args.indexOf('--room');
  const room = roomArg >= 0 ? parseInt(args[roomArg+1], 10) : null;
  const walkArg = args.indexOf('--walk');
  const walk = walkArg >= 0 ? args[walkArg+1] : null;
  const framesArg = args.indexOf('--frames');
  const wanted = (framesArg >= 0 ? args[framesArg+1] : '1,300,3600')
                 .split(',').map((value) => parseInt(value, 10));

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  const loadClassic = (name) => loadClassicScript(path.join(ROOT, 'app', name+'.js'));
  // screenComposer.js importuje ZXVideoRAM ze svision – shim s window.srcVersion
  // se musí načíst jako první (R-001)
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);
  const RoomScenery = loadClassic('roomScenery');
  const CharliePhysics = loadClassic('charliePhysics');
  const MolePhysics = loadClassic('molePhysics');
  const WorldState = loadClassic('worldState');
  const MonsterLogic = loadClassic('monsterLogic');
  if (args.indexOf('--mole') >= 0) {
    return moleScene({ScreenComposer, ZXVideoRAM, RoomScenery, CharliePhysics, MolePhysics, WorldState},
                     out);
  }
  const globalData = load('global');
  const moleData = load('mole');
  const scenery = new RoomScenery(load('scenery'), load('rooms'), load('world'));
  const number = room === null ? globalData.initRoom : room;
  const roomData = scenery.composeRoom(number, null);
  const render = new ScreenComposer(roomData, load('font'), load('panel'));
  render.setSprites(load('spriteframes'));
  render.setPanelIcon(moleData.panelIcon);

  let last = null, mode = 'man';
  const worker = startWorker((message) => {
    if (message.id === 'frame') { last = message; }
    if (message.id === 'room') {
      render.setRoom({width: 256, height: 168,
                      bitmap: Uint8Array.from(message.bitmap),
                      attributes: Uint8Array.from(message.attributes)});
    }
    if (message.id === 'error') { console.error(message.message); }
  }, {CharliePhysics, MolePhysics, WorldState, RoomScenery, MonsterLogic});
  worker.send({id: 'init', initData: {headless: true, lives: globalData.lives,
    room: number, physics: load('physics'), mole: moleData,
    monsters: load('monsters'),
    spriteframes: load('spriteframes'), scenery: load('scenery'),
    rooms: load('rooms'), world: load('world'), scene: {}}});
  // `--walk left|right` drží klávesu, takže na snímku je Charlie v chůzi – to
  // je jediný způsob, jak očima zkontrolovat **zrcadlení** rámců: chůze vlevo
  // jede rámce $80-$87, tedy tytéž bitmapy jako vpravo, jen převrácené
  // (disasm_notes.md §10.3).
  if (walk === 'left' || walk === 'right') {
    worker.send({id: 'controls', left: walk === 'left', right: walk === 'right',
                 up: false, down: false, mode: false});
  }

  fs.mkdirSync(out, {recursive: true});
  const memory = new ZXVideoRAM();
  const screen = new Uint8ClampedArray(256*192*4);
  for (let frame = 0; frame <= Math.max.apply(null, wanted); frame++) {
    worker.send({id: 'tick'});
    if (last && last.dig) { render.setGapPixels(last.dig.side, last.dig.bytes); }
    if (last && last.mole) { mode = last.mole.mode; }
    if (wanted.indexOf(frame) < 0) { continue; }
    render.composeInto(memory, {charlie: last.charlie, mole: last.mole,
                                monsters: last.monsters});
    render.composePanelInto(memory, {lives: last.lives, time: last.time,
                                     alchiems: last.alchiems, mode: mode});
    memory.paint(screen, false, undefined, ScreenComposer.ATTR_MASK);
    const file = path.join(out, 'screen'+String(frame).padStart(5, '0')+'.png');
    writePNG(file, screen, 256, 192);
    console.log('%s  mistnost %d  snimek %s  TIME %ss  LIFE %d  %s',
                path.relative(ROOT, file), last.room, String(frame).padStart(5),
                last.time, last.lives, mode.toUpperCase());
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
