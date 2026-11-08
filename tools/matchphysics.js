#!/usr/bin/env node
/**
 * Přejímací kritérium M3: pustí **kód, který jde do prohlížeče**
 * (`app/charliePhysics.js`) na nahraných bězích originálu (`tools/physlog.py`)
 * a porovná záznam Charlieho **bajt po bajtu**.
 *
 *   ./tools/matchphysics.js [build/physruns/*.json]
 *
 * Každý průchod se počítá **samostatně**: stav se nastaví z nahrávky, pustí se
 * jeden `pass()` a výsledek se porovná s dalším vzorkem. Tím se chyba neschová
 * za driftem – hlásí se u toho průchodu, kde vznikla.
 *
 * Bajt `+$0B` (počítadlo skriptu) se porovnává zvlášť: v originálu ho snižuje
 * přerušení, ne fyzika, a průchod se snímkem nekryje jedna ku jedné.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));

const ROOT = path.join(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
const DELAY = 0x0B;
// Bajty +$0E..+$1D si vede **kreslení spritu** ($91AE-$9313): kam se kreslilo
// naposled, aby se to dalo vygumovat XORem. To je M7, ne fyzika – porovnávají
// se proto zvlášť a jejich rozdíly se vypisují, ne schovávají.
const DRAWING = (b) => b >= 0x0E && b <= 0x1D;

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(path.join(ROOT, 'build/physruns'))
        .filter((n) => n.endsWith('.json'))
        .map((n) => path.join(ROOT, 'build/physruns', n));
  if (!files.length) {
    console.error('zadny nahrany beh - pust nejdriv tools/physlog.py');
    process.exit(1);
  }

  const CharliePhysics = loadClassicScript(path.join(ROOT, 'app/charliePhysics.js'));
  const physics = new CharliePhysics(load('physics'), load('spriteframes'));

  let passes = 0, bad = 0, badBytes = 0, badDelay = 0, badDrawing = 0, outside = 0;
  const byByte = new Map();
  for (const file of files) {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maps = run.maps.map((m) => Uint8Array.from(Buffer.from(m, 'base64')));
    let fileBad = 0;
    for (let i = 0; i + 1 < run.passes.length; i++) {
      const from = run.passes[i], to = run.passes[i+1];
      restore(physics, from, maps[from.map]);
      // Výměna místnosti je M4 – bere se z nahrávky. Co v nové kulise udělá
      // fyzika (vytlačení z pevných buněk, krok skriptu), musí spočítat sama.
      physics.pass(from.input, () => ({room: to.room, attributes: maps[to.map]}));
      passes++;
      let diffs = [];
      for (let b = 0; b < 32; b++) {
        if (b === DELAY) {
          if (physics.e[b] !== to.record[b]) { badDelay++; }
          continue;
        }
        if (DRAWING(b)) {
          if (physics.e[b] !== to.record[b]) { badDrawing++; }
          continue;
        }
        if (physics.e[b] !== to.record[b]) {
          diffs.push([b, physics.e[b], to.record[b]]);
          byByte.set(b, (byByte.get(b) || 0) + 1);
        }
      }
      if (diffs.length) {
        bad++;
        badBytes += diffs.length;
        fileBad++;
        if (fileBad <= 5) {
          console.log('%s pruchod %d (snimek %d, vstup %s): %s',
            path.basename(file), i, from.frame, hex(from.input),
            diffs.map(([b, got, want]) => '+$'+hex(b)+' '+hex(got)+'!='+hex(want)).join(' '));
        }
      }
    }
    outside += physics.report().outsideReads;
    console.log('%s: %d pruchodu, %d se neshoduje', path.basename(file),
                run.passes.length - 1, fileBad);
  }

  console.log('\nporovnano %d pruchodu, %d se neshoduje (%d bajtu)', passes, bad, badBytes);
  if (byByte.size) {
    console.log('nejcasteji se lisi: %s',
      [...byByte.entries()].sort((a, b) => b[1]-a[1])
        .map(([b, n]) => '+$'+hex(b)+' ('+n+'x)').join(', '));
  }
  console.log('pocitadlo +$0B se neporovnava (snizuje ho preruseni, ne fyzika): %d ruznych hodnot', badDelay);
  console.log('bajty kresleni +$0E-+$1D (M7, fyzika je nevede): %d rozdilu', badDrawing);
  console.log('cteni kolizni mapy mimo hraci plochu: %d', outside);
  console.log('\napp/charliePhysics.js proti rutinam originalu: %s',
              bad ? 'NESOUHLASI' : 'NULA ROZDILU');
  process.exit(bad ? 1 : 0);
}

function restore(physics, sample, map) {
  for (let b = 0; b < 32; b++) { physics.e[b] = sample.record[b]; }
  // Počítadlo snižuje přerušení, a to padne i doprostřed průchodu. Bere se
  // proto hodnota z okamžiku, kdy ji originál sám testuje (tools/physlog.py).
  if (sample.delayAtStep !== null && sample.delayAtStep !== undefined) {
    physics.e[DELAY] = sample.delayAtStep;
  }
  physics.attributes.set(map);
  physics.vars = {room: sample.room, flags: sample.flags, input: sample.input,
                  lastDir: sample.lastDir, a2b7: sample.a2b7,
                  f7ed9: sample.f7ed9, f7ee0: sample.f7ee0};
  physics.fall = {active: (sample.flags & 2) !== 0,
                  step: sample.fallStepHi*256 + sample.fallStepLo,
                  counter: sample.fallCounter, savedFrame: sample.fallFrame};
  physics.died = false;
  physics.pending = null;
}

const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

main().catch((error) => { console.error(error); process.exit(1); });
