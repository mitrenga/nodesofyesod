#!/usr/bin/env node
/**
 * Porovná **zvuk remaku se zvukem originálu** pulz po pulzu (M7).
 *
 *   ./tools/matchsound.js [--verbose] [--group jmeno]
 *
 * Vstup: `build/soundruns/*.json` – co originál v simulátoru opravdu vyklepal
 * na reproduktor (`tools/soundlog.py`). Proti každému běhu se pustí
 * `app/beeper.js` a `data/sound.json`, tedy **kód a data, která jdou do
 * prohlížeče**, a porovná se **délka každého pulzu v T-stavech**.
 *
 * Cíl je nula rozdílů – obdoba `matchphysics.js`, `matchentities.js`
 * a `matchmonsters.js` pro zvuk.
 *
 * Co se porovnává:
 *
 *   tones   192 tónů (48 period × 4 délky) rutiny `$873C`
 *   tunes   všech šest melodií originálu celých, přehrávačem `$8726`
 *   slots   jeden snímek obou přerušovacích slotů pro škálu hodnot
 *   raw     surová tónová smyčka `$8747` – z ní je složený zvuk teleportu
 *   speech  celá digitalizovaná řeč (33 968 bitů)
 *
 * Co se porovnat **nedá** a nástroj to říká nahlas: výšku tónu žraní stěny
 * a závěrečného odletu bere originál z registru `R`, který se v prohlížeči
 * nereprodukuje (`ZADANI.md` §8). Remake za něj losuje – to je táž věc jako
 * dvanáct míst, která hlásí `matchmonsters.js`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'build/soundruns');
const SOUND = path.join(ROOT, 'data/sound.json');

function parseArgs(argv) {
  const args = {verbose: false, groups: null};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--verbose') { args.verbose = true; }
    else if (argv[i] === '--group') { (args.groups = args.groups || []).push(argv[++i]); }
    else { throw new Error('neznamy prepinac '+argv[i]); }
  }
  return args;
}

/** Co má remake zahrát na běh, který originál nahrál pod tímhle jménem. */
function expected(beeper, run) {
  const parts = run.name.split(' ');
  const value = parts.length > 1 ? parseInt(parts[1].replace('$', ''), 16) : 0;
  switch (parts[0]) {
    case 'tone':   return beeper.toneTrain(value).pulses;
    case 'tune':   return beeper.tunePartTrain(value).pulses;
    case 'slot1':  return beeper.slot1Pass(value, 0).pulses;
    case 'slot2':  return beeper.slot2Train([value]).pulses;
    case 'raw':    return beeper.rawToneLoop(run.period, run.unit).toggles
                                .map((t, i, all) => i ? t-all[i-1] : null)
                                .filter((t) => t !== null);
    case 'speech': return beeper.speechTrain().pulses;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const sound = JSON.parse(fs.readFileSync(SOUND, 'utf8'));

  // app/beeper.js je ES modul a importuje se **přímo ze zdroje** – kořenový
  // package.json má "type": "module", takže ho Node přečte tak, jak je (R-001).
  const { Beeper } = await import(url.pathToFileURL(path.join(ROOT, 'app/beeper.js')).href);
  const beeper = new Beeper(sound);
  if (!beeper.ready) { throw new Error('data/sound.json nema tabulku period'); }

  const files = fs.readdirSync(RUNS).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) {
    throw new Error('v '+path.relpath+RUNS+' nic není – spust tools/soundlog.py');
  }

  let runs = 0, pulses = 0, diffs = 0, skipped = 0;
  for (const file of files) {
    const group = file.replace(/\.json$/, '');
    if (args.groups && !args.groups.includes(group)) { continue; }
    const data = JSON.parse(fs.readFileSync(path.join(RUNS, file), 'utf8'));
    let groupDiffs = 0;
    for (const run of data.runs) {
      const mine = expected(beeper, run);
      if (mine === null) { skipped++; continue; }
      runs++;
      if (mine.length !== run.pulses.length) {
        groupDiffs++;
        console.log('%s: %d pulzu, original %d', run.name, mine.length, run.pulses.length);
      }
      const count = Math.min(mine.length, run.pulses.length);
      for (let i = 0; i < count; i++) {
        pulses++;
        if (mine[i] !== run.pulses[i]) {
          groupDiffs++;
          if (groupDiffs < 8) {
            console.log('%s pulz %d: remake %d T, original %d T',
                        run.name, i, mine[i], run.pulses[i]);
          }
        }
      }
      if (args.verbose) {
        console.log(run.name.padEnd(12)+' '+String(mine.length).padStart(5)+' pulzu, '
                    + Beeper.duration({pulses: mine}).toFixed(1)+' ms');
      }
    }
    diffs += groupDiffs;
    console.log(group.padEnd(7)+' '+String(data.runs.length).padStart(3)+' behu, '
                + String(data.runs.reduce((a, r) => a+r.pulses.length, 0)).padStart(6)
                + ' pulzu, '+groupDiffs+' rozdilu');
  }

  console.log('celkem %d behu, %d pulzu, %d rozdilu%s',
              runs, pulses, diffs, skipped ? ' ('+skipped+' behu bez protejsku)' : '');
  console.log('co se porovnat neda: vysku tonu zrani steny a zaverecneho odletu '
              + 'bere original z registru R – remake za nej losuje (ZADANI.md §8)');
  process.exit(diffs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(2); });
