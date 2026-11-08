#!/usr/bin/env node
/**
 * Přejímací kritérium M5: pustí **kód, který jde do prohlížeče**
 * (`app/monsterLogic.js` nad `app/charliePhysics.js` a `app/worldState.js`) na
 * nahraných bězích originálu (`tools/monsterlog.py`) a porovná
 *
 * * **záznamy tří nepřátel** (`$FD00`, `$FD20`, `$FD40`) bajt po bajtu,
 * * **tabulku poletujících objektů** (`$AAED–$ADDC`, 94 × 8 B) – jejich
 *   místnost, souřadnice a ukazatel do bajtkódu,
 * * **globály M5**: energie `$AAE3`, kolik nepřátel zbývá `$AAE4`, zvláštní
 *   účinek `$AAE5`, mugger kradl `$AAE2`,
 * * **perzistentní stav světa** `$B600` v bitech 3–6, tedy alchiemy a muggery –
 *   to jsou přesně ty bity, které M4 vynechávala jako „M5",
 * * **paměť posledních pěti místností** `$5B34` (50 B), do které se nepřátelé
 *   ukládají při odchodu z místnosti.
 *
 *   ./tools/matchmonsters.js [build/monruns/*.json]
 *
 * Každý průchod se počítá **samostatně**, jako v M3 a M4: stav se před ním
 * nastaví z nahrávky, pustí se jeden průchod a výsledek se porovná s dalším
 * vzorkem. Tím se chyba neschová za driftem.
 *
 * ★ **Co se nedá reprodukovat, se podstrčí z nahrávky a vypíše.** Originál si
 * typ i pozici nového nepřítele losuje z registru `R` (`$A436`, `$A5E0`) –
 * takové průchody se počítají zvlášť a na konci je jich vidět kolik.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));

const ROOT = path.join(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
const decode = (b64) => Buffer.from(b64, 'base64');
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

const SLOTS = [0x100, 0x120, 0x140];      // $FD00, $FD20, $FD40 v tabulce entit
const DELAY = 0x0B;                        // počítadlo vede přerušení, ne dispečer
// Bajty +$0E..+$1D si vede kreslení spritu ($91AE–$9313) – M7, ne dispečer.
const DRAWING = (b) => b >= 0x0E && b <= 0x1D;
// A z příznaků `+$00` si kreslení vede bity 1 a 2 („překreslit", „nakresleno").
const DRAW_FLAGS = 0x06;
// Bity stavu místnosti, které patří M5: mugger (3) a alchiemy (4-6).
const STATE_MASK = 0x78;
// Z osmi bajtů záznamu objektu si kreslení vede +$06/+$07 jen v bitech 0-6
// (návratový ukazatel bajtkódu); bit 7 +$07 je „je v dohledu" a porovnává se.
const OBJECT_BYTES = [0, 1, 2, 3, 4, 5];

async function main() {
  const dir = path.join(ROOT, 'build/monruns');
  const files = process.argv.slice(2).length ? process.argv.slice(2)
    : (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
        .map((n) => path.join(dir, n)) : []);
  if (!files.length) {
    console.error('zadny nahrany beh - pust nejdriv tools/monsterlog.py --suite');
    process.exit(1);
  }

  const CharliePhysics = loadClassicScript(path.join(ROOT, 'app/charliePhysics.js'));
  const WorldState = loadClassicScript(path.join(ROOT, 'app/worldState.js'));
  const MonsterLogic = loadClassicScript(path.join(ROOT, 'app/monsterLogic.js'));

  const monsterData = load('monsters');
  const physics = new CharliePhysics(load('physics'), load('spriteframes'), load('mole'));
  const world = new WorldState(load('world'));
  // ★ Co originál bere z registru `R`, se **podstrkuje z nahrávky** ve stejném
  // pořadí, ve kterém to originál potřeboval. Když se pořadí nebo počet rozejde,
  // fronta dojde (nebo zůstane nedočerpaná) a matcher to spočítá a vypíše.
  let queue = [], queueAt = 0, starved = 0, leftover = 0, injectedCount = 0;
  const logic = new MonsterLogic(physics, monsterData, world, () => {
    if (queueAt >= queue.length) { starved++; return 0; }
    injectedCount++;
    return queue[queueAt++];
  });

  let passes = 0, badMonster = 0, badBytes = 0, badObject = 0, badState = 0;
  let badVars = 0, badCache = 0, spawnPasses = 0, badDelay = 0, badDrawing = 0;
  let changes = 0, skippedSpecial = 0, pickups = 0, stickPasses = 0;
  const byByte = new Map();
  const byVar = new Map();

  /** Stav před průchodem se **celý** nastaví z nahrávky, ať se nic neschová. */
  function restore(sample, objects, worldState, cache, map) {
    physics.attributes.set(map);
    for (let s = 0; s < 16; s++) {
      logic.entities[s].set(sample.entities.slice(s*32, s*32 + 32));
    }
    physics.e.set(sample.entities.slice(15*32, 16*32));
    for (let i = 0; i < logic.objects.length; i++) {
      logic.objects[i].record.set(objects.slice(i*8, i*8 + 8));
    }
    logic.objectTicks.set(objects.slice(94*8, 94*8 + 94));
    world.bytes().set(worldState);
    logic.roomCache.set(cache);
    logic.vars.room = sample.room;
    logic.vars.mugged = sample.mugged;
    logic.vars.energy = sample.energy;
    logic.vars.live = sample.live;
    logic.vars.special = sample.special;
    logic.vars.type3Seen = sample.type3Seen;
    logic.vars.lives = sample.lives;
    logic.vars.sticks = sample.sticks;
    logic.vars.stickLife = sample.stickLo | sample.stickHi << 8;
    logic.vars.wanted = sample.wanted;
    logic.vars.alchiemMask = sample.alchiemMask;
    logic.vars.alchiemList = sample.alchiemListHi | sample.alchiemListLo << 8;
    logic.vars.wantedCount = sample.wantedCount;
    logic.vars.objectIndex = sample.objectIndex;
    logic.wantedRoom = sample.wantedRoom;
    logic.monolithRoom = sample.monolithRoom;
    logic.markObjectsFrom(sample.room, objects);
  }

  for (const file of files) {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    const states = run.states.map(decode);
    const objects = run.objects.map(decode);
    const caches = run.caches.map(decode);
    const maps = run.maps.map(decode);
    let fileBad = 0, fileObject = 0, fileState = 0, fileVars = 0, fileCache = 0;
    const objectResults = [];
    for (let i = 0; i + 1 < run.passes.length; i++) {
      const from = run.passes[i], to = run.passes[i+1];
      if (from.objects == null) { continue; }
      restore(from, objects[from.objects], states[from.state], caches[from.cache],
              maps[from.map]);

      // ★ `+$0B` entity ($A66D) i počítadlo objektu ($A4A2) vede **přerušení**
      // ($9CC7), ne dispečer, a průchod se se snímkem nekryje jedna ku jedné.
      // Berou se proto z okamžiku, kdy je originál sám testuje – jako v M3 a M4.
      // Pořadí je pořadí originálu: `$A479` udělá **nejdřív objekty**
      // (`$A48F`–`$A5B1`) a **teprve pak nepřátele** (`$A5B2`).
      for (const [index, value] of (to.ticks || [])) { logic.objectTicks[index] = value; }
      for (const [offset, value] of (to.delays || [])) {
        logic.entities[offset >> 5][0x0B] = value;
      }
      queue = to.random || [];
      queueAt = 0;
      if (queue.length) { spawnPasses++; }

      logic.objectsPass();
      logic.pass();
      leftover += queue.length - queueAt;
      // $7DD3 CALL $8F44 -> $8FC1 -> $8854 CALL $A2F4: přechod do sousední
      // místnosti se dělá **na začátku dalšího průchodu**, tedy až za `$A479`.
      // Tím se rovnou ověří i uložení nepřátel do paměti pěti místností.
      if (to.room !== from.room) { changes++; logic.changeRoom(to.room); }
      // $7DD6 CALL $7EE1 -> $7F12 CALL $82D0: alchiem nebo mugger v místnosti,
      // a hned za ním $7DD9 -> $7DF1: pokládání gravity sticku. Obojí je
      // v hlavní smyčce **před** `$A479`, tedy mezi tímhle vzorkem a dalším.
      if (world.bytes()[to.room] & 0x48) { pickups++; }
      logic.pickup();
      if (to.input === monsterData.constants.stickInput) { stickPasses++; }
      logic.placeStick(to.input);
      objectResults[i] = logic.objects.map((o) => Uint8Array.from(o.record));
      passes++;

      const diffs = [];
      for (let n = 0; n < SLOTS.length; n++) {
        const got = logic.entities[MonsterLogic.SLOT_MONSTERS + n];
        const want = to.entities.slice(SLOTS[n], SLOTS[n] + 32);
        for (let b = 0; b < 32; b++) {
          if (b === DELAY) { if (got[b] !== want[b]) { badDelay++; } continue; }
          if (DRAWING(b)) { if (got[b] !== want[b]) { badDrawing++; } continue; }
          if (b === 0) {
            if ((got[b] ^ want[b]) & DRAW_FLAGS) { badDrawing++; }
            if (((got[b] ^ want[b]) & ~DRAW_FLAGS & 0xFF) === 0) { continue; }
          }
          if (got[b] !== want[b]) {
            diffs.push([n, b, got[b], want[b]]);
            byByte.set(b, (byByte.get(b) || 0) + 1);
          }
        }
      }
      if (diffs.length) {
        badMonster++; badBytes += diffs.length; fileBad++;
        if (fileBad <= 5) {
          console.log('%s pruchod %d (snimek %d, mistnost $%s): %s',
            path.basename(file), i, from.frame, hex(from.room),
            diffs.slice(0, 6).map(([n, b, g, w]) =>
              '#'+n+'+$'+hex(b)+' '+hex(g)+'!='+hex(w)).join(' '));
        }
      }

      // globály, které dispečer mění
      const vars = {energy: logic.vars.energy, live: logic.vars.live,
                    special: logic.vars.special, mugged: logic.vars.mugged};
      let varDiff = 0;
      for (const name of Object.keys(vars)) {
        // $AAE5 **nastaví** `$A479` (dotek typu 4 nebo 5) a **zhasne** ho
        // `$8466` / `$83ED` z Charlieho větve ($7EE1 -> $7FD8), která v hlavní
        // smyčce běží **před** `$A479`. Vzorek dalšího průchodu je tedy až za
        // ní, takže se `$AAE5` neporovnává, jakmile zamotání běží nebo právě
        // začalo ($7ED9 bit 0) – matcher tu větev nepouští, je to M3/M7.
        if (name === 'special' && ((from.f7ed9 | to.f7ed9) & 0x01)) {
          skippedSpecial++; continue;
        }
        if (vars[name] !== to[name]) {
          varDiff++;
          byVar.set(name, (byVar.get(name) || 0) + 1);
        }
      }
      if (varDiff) {
        badVars++; fileVars++;
        if (fileVars <= 3) {
          console.log('%s pruchod %d: globaly %s',
            path.basename(file), i,
            Object.keys(vars).filter((k) => vars[k] !== to[k])
              .map((k) => k+' '+hex(vars[k])+'!='+hex(to[k])).join(' '));
        }
      }

      // stav světa: alchiemy a muggeři
      let stateDiff = 0;
      const wanted = states[to.state];
      for (let room = 0; room < 256; room++) {
        if (((world.bytes()[room] ^ wanted[room]) & STATE_MASK) !== 0) { stateDiff++; }
      }
      if (stateDiff) {
        badState++; fileState++;
        if (fileState <= 3) {
          console.log('%s pruchod %d: alchiemy/muggeri se lisi v %d mistnostech',
                      path.basename(file), i, stateDiff);
        }
      }

      // paměť posledních pěti místností
      let cacheDiff = 0;
      const wantCache = caches[to.cache];
      for (let b = 0; b < 50; b++) {
        if (logic.roomCache[b] !== wantCache[b]) { cacheDiff++; }
      }
      if (cacheDiff) {
        badCache++; fileCache++;
        if (fileCache <= 2) {
          console.log('%s pruchod %d: pamet mistnosti se lisi v %d bajtech',
                      path.basename(file), i, cacheDiff);
        }
      }
    }

    // objekty se porovnávají po témž průchodu, ve kterém běžely
    for (let i = 0; i + 1 < run.passes.length; i++) {
      const to = run.passes[i+1];
      if (objectResults[i] === undefined) { continue; }
      const want = objects[to.objects];
      let diff = 0, first = null;
      for (let o = 0; o < objectResults[i].length; o++) {
        const got = objectResults[i][o];
        for (const b of OBJECT_BYTES) {
          if (got[b] !== want[o*8 + b]) {
            diff++;
            if (!first) { first = [o, b, got[b], want[o*8 + b]]; }
          }
        }
      }
      if (diff) {
        badObject++; fileObject++;
        if (fileObject <= 3) {
          console.log('%s pruchod %d: objekty se lisi v %d bajtech (prvni: '
                      + '#%d +$%s %s!=%s)',
                      path.basename(file), i, diff, first[0], hex(first[1]),
                      hex(first[2]), hex(first[3]));
        }
      }
    }

    console.log('%s: %d pruchodu, nepratele %d, objekty %d, globaly %d, '
                + 'svet %d, pamet %d',
                path.basename(file), run.passes.length - 1, fileBad, fileObject,
                fileVars, fileState, fileCache);
  }

  const bad = badMonster + badObject + badState + badVars + badCache;
  console.log('\nporovnano %d pruchodu', passes);
  console.log('  zaznamy nepratel:  %d se neshoduje (%d bajtu)', badMonster, badBytes);
  console.log('  tabulka objektu:   %d se neshoduje', badObject);
  console.log('  globaly M5:        %d se neshoduje', badVars);
  console.log('  stav sveta $B600:  %d se neshoduje (bity $%s)', badState, hex(STATE_MASK));
  console.log('  pamet mistnosti:   %d se neshoduje', badCache);
  if (byByte.size) {
    console.log('  rozpad po bajtech zaznamu: %s',
      [...byByte.entries()].sort((a, b) => b[1]-a[1])
        .map(([b, n]) => '+$'+hex(b)+':'+n).join(' '));
  }
  if (byVar.size) {
    console.log('  rozpad po globalech: %s',
      [...byVar.entries()].sort((a, b) => b[1]-a[1])
        .map(([k, n]) => k+':'+n).join(' '));
  }
  console.log('\nco se neporovnava a proc:');
  console.log('  +$%s          pocitadlo skriptu vede preruseni ($9CC7), ne dispecer'
              + ' (%d rozdilu)', hex(DELAY), badDelay);
  console.log('  +$0E-+$1D a bity 1-2 z +$00   kam se sprite kreslil naposled '
              + '(M7) (%d rozdilu)', badDrawing);
  console.log('  +$06/+$07 objektu            navratovy ukazatel bajtkodu');
  console.log('  $AAE5 pri bezicim zamotani   zhasina ho $8466 z Charlieho '
              + 'vetve ($7EE1), ktera bezi pred $A479 (%d pruchodu)', skippedSpecial);
  console.log('\novereno pri tom %d prechodu mezi mistnostmi ($A2F4: ulozeni '
              + 'nepratel do pameti peti mistnosti a jejich nacteni)', changes);
  console.log('\nco tyhle behy NEPOTKALY, takze to overene neni:');
  if (!pickups) {
    console.log('  * alchiem ani mugger v mistnosti ($82D0, $8381) - '
                + 'losovani pri rozehrani je zadne nedalo do mistnosti, '
                + 'kam se v techto behach dojde');
  } else {
    console.log('  (alchiem nebo mugger v mistnosti: %d pruchodu)', pickups);
  }
  if (!stickPasses) {
    console.log('  * gravity stick ($7DF1) - dostane se az za dopadenim '
                + 'muggera ($83A2), a ten se v techto behach nepotkal');
  } else {
    console.log('  (pokladani gravity sticku: %d pruchodu)', stickPasses);
  }
  console.log('  * monolit a konec hry ($A838, $9907) - mistnost monolitu se '
              + 'losuje pri rozehrani ($8594) a lezi mimo dosah techto behu');
  console.log('\nco se podstrcilo z nahravky, protoze to je LD A,R:');
  console.log('  hodnot z registru R: %d podstrceno v %d pruchodech; '
              + 'fronta dosla %dx, nedocerpano %d',
              injectedCount, spawnPasses, starved, leftover);
  console.log('  rozmisteni alchiemu a muggeru pri rozehrani ($86EA) se '
              + 'v techto behach nelosuje - bere se stav sveta z nahravky');

  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
