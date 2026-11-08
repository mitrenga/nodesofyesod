#!/usr/bin/env node
/**
 * Prověří **dotykové ovládání (M6)** bez prohlížeče a bez telefonu.
 *
 *   ./tools/runtouch.js [--verbose]
 *
 * M6 nemá co porovnávat s originálem – ovládání na dotykové obrazovce originál
 * neměl. Přejímací kritérium je proto telefon (`MILNIKY.md`). Tenhle nástroj
 * dělá to, co se ověřit dá i bez něj: bere **rozvržení z `app/gameApp.js`**
 * a **kód z `app/roomModel.js`**, tedy oboje to, co jde do prohlížeče, a trvá
 * na tom, že z posloupnosti doteků vyjde ta posloupnost zpráv `controls`,
 * kterou od nich čeká worker (`app/WORKER-PROTOCOL.md`).
 *
 * Zkouší se: obě poloviny naráz (multi-touch), páčka s mrtvou zónou, krtkovo
 * kopání do dvou směrů zároveň, **přepnutí rozvržení spolu s režimem**, krátký
 * stisk držený dost dlouho na to, aby ho worker uviděl, a puštění všech doteků
 * naráz (odchod z obrazovky).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

/** Vytáhne z `app/gameApp.js` literál `touchscreen: {...}` – rozvržení, které jde do prohlížeče. */
function loadTouchscreenOptions() {
  const source = fs.readFileSync(path.join(ROOT, 'app/gameApp.js'), 'utf8');
  const start = source.indexOf('      touchscreen: {');
  if (start < 0) { throw new Error('v gameApp.js není controlsOptions.touchscreen'); }
  let depth = 0, end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; }
    if (source[i] === '}') { depth--; if (depth === 0) { end = i+1; break; } }
  }
  const literal = source.slice(source.indexOf('{', start), end);
  return vm.runInNewContext('('+literal+')');
}

/**
 * Nahraje `RoomModel` do atrapy prostředí. Je to tentýž soubor, který jde do
 * prohlížeče, jen dodaný jinak: hlavička s importy se odřízne (stejně jako to
 * dělá `runworker.js` s workerem) a třídy, na kterých model stojí, se vloží
 * jako atrapy – z modelu se tady zkouší jen dotyková vrstva.
 */
function loadRoomModel() {
  class AbstractModel {
    constructor(app) {
      this.app = app;
      this.events = [];
      this.borderEntity = null;
      this.desktopEntity = null;
    }
    sendEvent(timing, event) {
      if (timing === 0) { this.handleEvent(event); }
      else { this.events.push({timing: this.app.now+timing, event: event}); }
    }
    /** posune čas a doručí, co mezitím dozrálo */
    runUntil(now) {
      this.app.now = now;
      for (let i = 0; i < this.events.length; i++) {
        if (this.events[i].timing <= now) {
          const event = this.events[i].event;
          this.events.splice(i--, 1);
          this.handleEvent(event);
        }
      }
    }
    handleEvent() { return false; }
  }
  const stub = class { constructor() {} };
  const sandbox = {console, Math, Array, Object, JSON, Error, AbstractModel,
                   BorderEntity: stub, TextEntity: stub, PauseGameEntity: stub,
                   ZXColor: new Proxy({}, {get: (t, k) => String(k)}),
                   ScreenLayout: {}, ScreenComposer: stub,
                   GameAreaEntity: stub, GameInfoEntity: stub};
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'app/roomModel.js'), 'utf8');
  const body = source.slice(source.indexOf('// begin code'))
                     .replace(/^export default .*$/m, '')
                     .replace(/^export class/m, 'class');
  vm.runInContext(body+'\n;this.RoomModel = RoomModel;', context, {filename: 'roomModel.js'});
  return sandbox.RoomModel;
}

/** Polovina obrazovky, jak ji staví `borderEntity`: půl plátna na celou výšku. */
function half(x, width, height) {
  return {parentX: 0, parentY: 0, x: x, y: 0, width: width, height: height};
}

let failures = 0;
function check(condition, message) {
  console.log('%s  %s', condition ? ' ok ' : 'FAIL', message);
  if (!condition) { failures++; }
}

function main() {
  const RoomModel = loadRoomModel();
  const touchscreen = loadTouchscreenOptions();

  const WIDTH = 320, HEIGHT = 240;                 // plátno i s okrajem
  const sent = [];
  const app = {
    now: 0,
    controlsOptions: {touchscreen: touchscreen},
    controls: {touchscreen: {supported: true, type: 'rightAction'}},
    inputEventsManager: {touchesMap: {}, touchesGameControls: {}}
  };
  const model = new RoomModel(app);
  model.worker = {postMessage: (message) => sent.push(message)};
  model.borderEntity = {
    leftControlEntity: half(0, WIDTH/2, HEIGHT),
    rightControlEntity: half(WIDTH/2, WIDTH/2, HEIGHT),
    setGameControlIcons: () => {}
  };

  /** stav ovládání, jak ho vidí worker */
  const state = () => sent.length ? sent[sent.length-1] : null;
  const held = () => {
    const last = state();
    if (!last) { return []; }
    return ['left', 'right', 'up', 'down', 'mode'].filter((action) => last[action]);
  };
  const same = (a, b) => a.length === b.length && a.every((item) => b.indexOf(item) !== -1);
  const at = (side, rx, ry) => ({x: (side === 'left' ? 0 : WIDTH/2)+rx*WIDTH/2, y: ry*HEIGHT});
  const down = (id, side, rx, ry) => {
    const entity = side === 'left' ? model.borderEntity.leftControlEntity
                                   : model.borderEntity.rightControlEntity;
    model.touchStart(Object.assign({identifier: id}, at(side, rx, ry)), side, entity);
  };
  const move = (id, side, rx, ry) => model.touchMove(Object.assign({identifier: id}, at(side, rx, ry)));
  const up = (id) => model.touchEnd({identifier: id});
  const say = (what) => { if (VERBOSE) { console.log('     %s -> %s', what, JSON.stringify(held())); } };

  // --- astronaut: chůze páčkou -------------------------------------------
  down(1, 'left', 0.5, 0.5);
  check(held().length === 0, 'ťuknutí do páčky nic nepošle (je tam mrtvá zóna)');
  move(1, 'left', 0.5, 0.5);
  check(held().length === 0, 'posun uvnitř mrtvé zóny taky ne');
  move(1, 'left', 0.9, 0.5);
  say('prst doprava');
  check(same(held(), ['right']), 'prst doprava = chůze doprava');
  move(1, 'left', 0.1, 0.5);
  check(same(held(), ['left']), 'prst doleva = chůze doleva');
  move(1, 'left', 0.5, 0.5);
  check(held().length === 0, 'prst zpátky do středu chůzi pustí');
  move(1, 'left', 0.1, 0.5);

  // --- multi-touch: chůze a skok zároveň ---------------------------------
  down(2, 'right', 0.5, 0.8);
  say('a k tomu skok');
  check(same(held(), ['left', 'up']), 'multi-touch: chodí a skáče zároveň');
  up(2);
  check(same(held(), ['left']), 'puštěný skok nepustí chůzi');

  // --- dva prsty na téže akci --------------------------------------------
  down(3, 'right', 0.5, 0.8);
  down(4, 'right', 0.2, 0.9);
  up(3);
  check(same(held(), ['left', 'up']), 'akci drženou dvěma prsty nepustí zvednutí jednoho');
  up(4);
  check(same(held(), ['left']), 'až druhý ji pustí');
  up(1);
  check(held().length === 0, 'zvednutá páčka pustí chůzi');

  // --- krátký stisk: přepínač režimu --------------------------------------
  const before = sent.length;
  model.app.now = 1000;
  down(5, 'right', 0.8, 0.1);
  check(same(held(), ['mode']), 'ťuknutí na přepínač režimu ho stiskne');
  model.app.now = 1010;
  up(5);
  check(same(held(), ['mode']), 'a hned puštěné ťuknutí ho drží dál – worker ho musí uvidět');
  model.runUntil(1010+touchscreen.tapHoldTime);
  check(held().length === 0, 'po tapHoldTime se přepínač pustí');
  check(sent.length === before+2, 'a poslaly se právě dvě zprávy: stisk a puštění');

  // --- přepnutí režimu mění rozvržení pod prsty ---------------------------
  down(6, 'left', 0.5, 0.5);
  move(6, 'left', 0.5, 0.1);
  check(held().length === 0, 'astronaut páčkou nahoru nedělá nic (chodí jen do stran)');
  model.moleMode = 'mole';
  model.retouchControls();
  say('krtek toutéž páčkou');
  check(same(held(), ['up']), 'krtek toutéž páčkou kope nahoru – prst nikam přetahovat nemusí');
  move(6, 'left', 0.9, 0.1);
  check(same(held(), ['up', 'right']), 'a do dvou směrů naráz – kope i šikmo');
  move(6, 'left', 0.9, 0.5);
  check(same(held(), ['right']), 'jeden směr jde pustit a druhý držet dál');

  // --- krtkova polovina s akcemi má jen přepínač, a na témž místě ---------
  down(7, 'right', 0.5, 0.8);
  check(same(held(), ['right']), 'kde měl astronaut skok, krtek nemá nic');
  up(7);
  down(8, 'right', 0.8, 0.1);
  check(same(held(), ['right', 'mode']), 'přepínač je i u krtka v témž rohu');

  // --- přepnutí režimu prstem, který na přepínači leží --------------------
  model.moleMode = 'man';
  model.retouchControls();
  check(same(held(), ['right']), 'po přepnutí se přepínač sám znovu nezmáčkne');
  check(held().indexOf('right') !== -1, 'a páčka pod druhým prstem drží dál');

  // --- odchod z obrazovky pustí všechno ----------------------------------
  // tohle dělá svision: pošle keyRelease/'RetryTouch' za každý dotek a mapu vyhodí
  const controls = app.inputEventsManager.touchesGameControls;
  Object.keys(controls).forEach((identifier) => {
    model.handleEvent({id: 'keyRelease', key: 'RetryTouch', action: controls[identifier].action});
  });
  app.inputEventsManager.touchesGameControls = {};
  check(held().length === 0, 'hromadné puštění doteků (odchod z obrazovky) nic nenechá držet');

  // --- varianta pro leváky je zrcadlo té pro praváky ----------------------
  app.controls.touchscreen.type = 'leftAction';
  model.moleMode = 'man';
  down(9, 'right', 0.5, 0.5);
  move(9, 'right', 0.9, 0.5);
  check(same(held(), ['right']), 'leváci: páčka je na pravé polovině');
  down(10, 'left', 0.5, 0.8);
  check(same(held(), ['right', 'up']), 'a skok na levé');
  up(9); up(10);
  check(held().length === 0, 'a nic po nich nezůstane viset');

  // --- rozvržení musí existovat pro každou variantu i každý režim ---------
  touchscreen.types.keys.forEach((type) => {
    ['left', 'right'].forEach((side) => {
      const half = touchscreen.types[type][side];
      check(half.half in touchscreen.halves && half.sprite in touchscreen.icons,
            type+'/'+side+': polovina i ikona do SETTINGS existují');
      ['man', 'mole'].forEach((mode) => {
        const layout = touchscreen.halves[half.half][mode];
        check(!!layout && Array.isArray(layout.zones) && layout.icon in touchscreen.icons,
              type+'/'+side+'/'+mode+': rozvržení i jeho ikona existují');
      });
    });
  });

  console.log(failures ? '\nCHYB: '+failures : '\nvšechno sedí');
  process.exit(failures ? 1 : 0);
}

main();
