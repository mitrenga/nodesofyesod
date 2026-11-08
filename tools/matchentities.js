#!/usr/bin/env node
/**
 * Přejímací kritérium M4: pustí **kód, který jde do prohlížeče**
 * (`app/molePhysics.js`, `app/charliePhysics.js`, `app/worldState.js`) na
 * nahraných bězích originálu (`tools/molelog.py`) a porovná
 *
 * * **32bajtový záznam krtka** (`$FDC0`) bajt po bajtu,
 * * **perzistentní stav světa** (`$B600`, 256 B) – to, co krtek mění,
 * * **kolizní mapu** (stínové atributy `$F900`) – tam se po dožrání stěny
 *   vyřeže díra 2 × 6 buněk,
 * * **bitmapu obou průchodů** – to, co při žraní ubývá po dvoupixelových
 *   kouscích z proudu `$7666`.
 *
 *   ./tools/matchentities.js [build/molruns/*.json]
 *
 * Každý průchod se počítá **samostatně**, jako v M3: stav se před ním nastaví
 * z nahrávky, pustí se jeden průchod workeru a výsledek se porovná s dalším
 * vzorkem. Tím se chyba neschová za driftem.
 *
 * Co se **neporovnává** a proč, se vypisuje na konci – nic se neschovává.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));

const ROOT = path.join(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));

const DELAY = 0x0B;
// Bajty +$0E..+$1D si vede kreslení spritu ($91AE-$9313) – M7, ne fyzika.
const DRAWING = (b) => b >= 0x0E && b <= 0x1D;
// A z příznaků `+$00` si kreslení vede **bity 1 a 2** („překreslit" a
// „nakresleno"): přehazuje si je $91A5/$91AE/$91E9 podle toho, jestli sprite
// zrovna leží ve videopaměti. To je taky M7; bity 0, 4, 6 a 7 (vidět, koliduje,
// banka spritů, x je záporné) se porovnávají normálně.
const DRAW_FLAGS = 0x06;
// Bity stavu místnosti, které patří M4. Bit 3 je značka muggera a bity 4-6
// alchiemy, které si originál **losuje z registru R** ($86EA) – to je M5.
const STATE_MASK = 0x87;

async function main() {
  const dir = path.join(ROOT, 'build/molruns');
  const files = process.argv.slice(2).length ? process.argv.slice(2)
    : (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
        .map((n) => path.join(dir, n)) : []);
  if (!files.length) {
    console.error('zadny nahrany beh - pust nejdriv tools/molelog.py --suite');
    process.exit(1);
  }

  const CharliePhysics = loadClassicScript(path.join(ROOT, 'app/charliePhysics.js'));
  const MolePhysics = loadClassicScript(path.join(ROOT, 'app/molePhysics.js'));
  const WorldState = loadClassicScript(path.join(ROOT, 'app/worldState.js'));

  const worldData = load('world');
  const moleData = load('mole');
  const physics = new CharliePhysics(load('physics'), load('spriteframes'), moleData);
  const world = new WorldState(worldData);
  let randomValue = 0;
  const mole = new MolePhysics(physics, moleData, world, () => randomValue);
  physics.mole = mole;

  // Bitmapa hrací plochy, do které krtek žere stěnu. Rozvržení je totéž, jaké
  // má stínový buffer originálu (znakový řádek*256 + řádka*32 + sloupec), takže
  // se z ní dá vyříznout přesně to, co nahrává molelog.py.
  const bitmap = new Uint8Array(21*256);
  mole.setSurface(bitmap, physics.attributes);

  let passes = 0, badMole = 0, badBytes = 0, badState = 0, badMap = 0, badGap = 0;
  let comparedGaps = 0, skippedGaps = 0, injected = 0, skippedCells = 0;
  let badDelay = 0, badDrawing = 0;
  const byByte = new Map();

  for (const file of files) {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maps = run.maps.map(decode);
    const states = run.states.map(decode);
    const gaps = run.gaps.map(decode);
    let fileBad = 0, fileGap = 0, fileState = 0, fileMap = 0;
    for (let i = 0; i + 1 < run.passes.length; i++) {
      const from = run.passes[i], to = run.passes[i+1];
      const previous = i > 0 ? run.passes[i-1] : null;
      restore(physics, mole, world, bitmap, from, previous, maps[from.map],
              states[from.state], gaps[from.gap]);
      // Vylezení krtka na povrchu losuje originál z registru R ($A235) a to se
      // reprodukovat nedá – bere se proto z nahrávky, stejně jako výměna
      // místnosti v M3.
      const spawns = !(from.a2b7 & 0x02) && (to.a2b7 & 0x02);
      randomValue = spawns ? from.room : ((from.room + 1) & 0xFF);
      if (spawns) { injected++; }

      // Pořadí je pořadí originálu: vektor na $9CE6 (`digProgress`) volá hlavní
      // smyčka **za** průchodem Charlieho, takže se v tom průchodu, ve kterém
      // krtek stěnu nakousl, jen přepne a teprve v dalším začne žrát.
      physics.pass(from.input, () => ({room: to.room, attributes: maps[to.map]}));
      mole.digProgress();
      passes++;

      const diffs = [];
      for (let b = 0; b < 32; b++) {
        if (b === DELAY) { if (mole.m[b] !== to.mole[b]) { badDelay++; } continue; }
        if (DRAWING(b)) { if (mole.m[b] !== to.mole[b]) { badDrawing++; } continue; }
        if (b === 0) {
          if ((mole.m[b] ^ to.mole[b]) & DRAW_FLAGS) { badDrawing++; }
          if (((mole.m[b] ^ to.mole[b]) & ~DRAW_FLAGS & 0xFF) === 0) { continue; }
        }
        if (mole.m[b] !== to.mole[b]) {
          diffs.push([b, mole.m[b], to.mole[b]]);
          byByte.set(b, (byByte.get(b) || 0) + 1);
        }
      }
      if (diffs.length) {
        badMole++;
        badBytes += diffs.length;
        fileBad++;
        if (fileBad <= 5) {
          console.log('%s pruchod %d (snimek %d, vstup %s): %s',
            path.basename(file), i, from.frame, hex(from.input),
            diffs.map(([b, got, want]) => '+$'+hex(b)+' '+hex(got)+'!='+hex(want)).join(' '));
        }
      }

      // stav světa: co krtek zapsal
      let stateDiff = 0;
      const wanted = states[to.state];
      for (let room = 0; room < 256; room++) {
        if (((world.bytes()[room] ^ wanted[room]) & STATE_MASK) !== 0) { stateDiff++; }
      }
      if (stateDiff) {
        badState++;
        fileState++;
        if (fileState <= 3) {
          console.log('%s pruchod %d: stav sveta se lisi v %d mistnostech',
                      path.basename(file), i, stateDiff);
        }
      }

      // kolizní mapa: díra po dožrané stěně
      let mapDiff = 0;
      for (let cell = 0; cell < physics.attributes.length; cell++) {
        if (physics.attributes[cell] !== maps[to.map][cell]) { mapDiff++; }
      }
      if (mapDiff) {
        badMap++;
        fileMap++;
        if (fileMap <= 3) {
          console.log('%s pruchod %d: kolizni mapa se lisi v %d bunkach',
                      path.basename(file), i, mapDiff);
        }
      }

      // bitmapa průchodu se porovnává jen tam, kde se žere stěna: mimo žraní
      // do ní kreslí entity, které jsou M5, a remake je nekreslí.
      if ((from.flags & 0x18) || (to.flags & 0x18)) {
        comparedGaps++;
        const got = gapBytes(bitmap);
        const want = gaps[to.gap];
        // Do stínového bufferu originálu se **kreslí sprity** (XOR, $9508), a to
        // je M7 – remake do bufferu nekreslí. Buňky, které v tom průchodu leží
        // pod spritem krtka nebo Charlieho, se proto neporovnávají a počítají
        // se zvlášť.
        const covered = spriteCells([to.mole, to.charlie]);
        // Porovnává se **jen ten průchod, který se právě žere**. Do druhého
        // kreslí nepřátelé té které místnosti, a ti jsou M5.
        const half = GAP_ROWS*8*GAP_COLS;
        const digLeft = ((from.flags | to.flags) & 0x10) !== 0;
        const lo = digLeft ? 0 : half, hi = digLeft ? half : 2*half;
        let pixels = 0;
        for (let n = lo; n < hi; n++) {
          if (covered[n]) { skippedCells++; continue; }
          if (got[n] !== want[n]) { pixels++; }
        }
        if (pixels) {
          badGap++;
          fileGap++;
          if (fileGap <= 3) {
            console.log('%s pruchod %d: bitmapa prochodu se lisi v %d bajtech',
                        path.basename(file), i, pixels);
          }
        }
      } else {
        skippedGaps++;
      }
    }
    console.log('%s: %d pruchodu, krtek %d, svet %d, mapa %d, bitmapa %d',
                path.basename(file), run.passes.length - 1, fileBad, fileState,
                fileMap, fileGap);
  }

  const bad = badMole + badState + badMap + badGap;
  console.log('\nporovnano %d pruchodu', passes);
  console.log('  zaznam krtka:      %d se neshoduje (%d bajtu)', badMole, badBytes);
  console.log('  stav sveta $B600:  %d se neshoduje (bity $%s)', badState, hex(STATE_MASK));
  console.log('  kolizni mapa:      %d se neshoduje', badMap);
  console.log('  bitmapa prochodu:  %d se neshoduje (%d pruchodu porovnano, %d preskoceno,'
              + ' %d bajtu pod spritem)', badGap, comparedGaps, skippedGaps, skippedCells);
  if (byByte.size) {
    console.log('nejcasteji se lisi: %s',
      [...byByte.entries()].sort((a, b) => b[1]-a[1])
        .map(([b, n]) => '+$'+hex(b)+' ('+n+'x)').join(', '));
  }
  console.log('\nco se neporovnava a proc:');
  console.log('  +$0B krtka  – pocitadlo skriptu vede preruseni, ne fyzika: %d ruznych hodnot', badDelay);
  console.log('  +$0E-+$1D a bity 1-2 z +$00 – kresleni spritu (M7): %d rozdilu', badDrawing);
  console.log('  bity 3-6 stavu mistnosti – znacka muggera a alchiemy, ktere');
  console.log('              original LOSUJE z registru R ($86EA): M5');
  console.log('  vylezeni krtka na povrchu – tez z registru R ($A235), bere se');
  console.log('              z nahravky: %dx', injected);
  console.log('  bitmapa prochodu mimo zrani a druhy prochod tez – kresli do nich');
  console.log('              nepratele te ktere mistnosti (M5)');
  console.log('  krtek zere nepratele ($9FED) – tabulka typu entit je M5, takze');
  console.log('              v nahravkach zadna entita neni: %d zabiti', mole.report().kills);
  console.log('\napp/molePhysics.js proti rutinam originalu: %s',
              bad ? 'NESOUHLASI' : 'NULA ROZDILU');
  process.exit(bad ? 1 : 0);
}

/** Nastaví celý stav z jednoho vzorku nahrávky – jako restore() v matchphysics.js. */
function restore(physics, mole, world, bitmap, sample, previous, map, state, gap) {
  for (let b = 0; b < 32; b++) {
    physics.e[b] = sample.charlie[b];
    mole.m[b] = sample.mole[b];
  }
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
  world.bytes().set(state);
  putGapBytes(bitmap, gap);
  mole.direction = sample.moleDir;
  mole.clock = sample.clock;
  mole.digCounter = sample.digCounter;
  mole.sounds.length = 0;
  // Který vektor je na $9CE6, nahrávka nenese – ale plyne z ní: přepnul ho
  // `$9B76` na konci průchodu, ve kterém se objevil bit 3 nebo 4, takže od
  // prvního průchodu s tím bitem už žere. Kolik kousků je snědeno, říká
  // počítadlo $5B11.
  const digging = (sample.flags & 0x18) !== 0;
  mole.eating = digging ? ((sample.flags & 0x10) ? 'left' : 'right') : false;
  mole.eatIndex = digging ? ((0xC0 - sample.digCounter) & 0xFF) : 0;
}

// Bitmapa obou průchodů, v témže pořadí, jaké nahrává tools/molelog.py.
const GAP_ROW = 13, GAP_ROWS = 6, GAP_COLS = 2, GAP_X = {left: 0, right: 30};

/**
 * Které bajty výřezu leží pod spritem – tam se bitmapa neporovnává, protože
 * kreslení je M7. Obálka je o bajt širší, než je rámec: blit ho předsouvá
 * o 0-7 pixelů ($9508), takže se dotkne i následujícího sloupce.
 * @param {Array} records - Záznamy entit (x, y, šířka, výška).
 * @return {Uint8Array} 1 = nepočítat.
 */
function spriteCells(records) {
  const covered = new Uint8Array(2*GAP_ROWS*8*GAP_COLS);
  let n = 0;
  for (const name of ['left', 'right']) {
    for (let row = GAP_ROW; row < GAP_ROW+GAP_ROWS; row++) {
      for (let line = 0; line < 8; line++) {
        for (let col = 0; col < GAP_COLS; col++) {
          const column = GAP_X[name] + col;
          const pixelRow = row*8 + line;
          for (const record of records) {
            if (!(record[0] & 0x01)) { continue; }
            const x0 = (record[0] & 0x80) ? record[1] - 256 : record[1];
            const c0 = Math.floor(x0/8), c1 = Math.floor((x0 + record[3] + 7)/8);
            if (column < c0 || column > c1) { continue; }
            if (pixelRow < record[2] || pixelRow >= record[2] + record[4]) { continue; }
            covered[n] = 1;
          }
          n++;
        }
      }
    }
  }
  return covered;
}

function gapBytes(bitmap) {
  const out = new Uint8Array(2*GAP_ROWS*8*GAP_COLS);
  let n = 0;
  for (const name of ['left', 'right']) {
    for (let row = GAP_ROW; row < GAP_ROW+GAP_ROWS; row++) {
      for (let line = 0; line < 8; line++) {
        for (let col = 0; col < GAP_COLS; col++) {
          out[n++] = bitmap[row*256 + line*32 + GAP_X[name] + col];
        }
      }
    }
  }
  return out;
}

function putGapBytes(bitmap, bytes) {
  let n = 0;
  for (const name of ['left', 'right']) {
    for (let row = GAP_ROW; row < GAP_ROW+GAP_ROWS; row++) {
      for (let line = 0; line < 8; line++) {
        for (let col = 0; col < GAP_COLS; col++) {
          bitmap[row*256 + line*32 + GAP_X[name] + col] = bytes[n++];
        }
      }
    }
  }
}

const decode = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

main().catch((error) => { console.error(error); process.exit(1); });
