#!/usr/bin/env node
/**
 * Pustí **kód, který jde do prohlížeče** (`app/roomScenery.js`) na datech
 * remaku a porovná ho s tím, co ve stínovém bufferu nechala kreslicí rutina
 * originálu (`build/rooms/*.bin`, `tools/dumprooms.py`).
 *
 *   ./tools/matchrooms.js [--rooms 0-255]
 *
 * `tools/matchscreen.py` ověřuje totéž v Pythonu; tenhle skript ověřuje, že
 * i JavaScript remaku dá **tytéž bajty**. Přejímací kritérium je nula rozdílů.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const loadClassicScript = require(path.join(__dirname, '../app/svision/tools/classicScript.cjs'));

const ROOT = path.join(__dirname, '..');
const ROWS = 21, COLS = 32, BITMAP = ROWS*8*COLS, ATTRS = ROWS*COLS;
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));

async function main() {
  const args = process.argv.slice(2);
  const roomsArg = args.indexOf('--rooms');
  const range = (roomsArg >= 0 ? args[roomsArg+1] : '0-255').split('-').map(Number);
  const lo = range[0], hi = range.length > 1 ? range[1] : range[0];

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  const RoomScenery = loadClassicScript(path.join(ROOT, 'app/roomScenery.js'));

  const scenery = new RoomScenery(load('scenery'), load('rooms'), load('world'));
  let bits = 0, cells = 0, checked = 0, missing = 0;
  for (let number = lo; number <= hi; number++) {
    const file = path.join(ROOT, 'build/rooms', 'room'+String(number).padStart(3, '0')+'.bin');
    if (!fs.existsSync(file)) { missing++; continue; }
    const reference = fs.readFileSync(file);
    const room = scenery.composeRoom(number, null);
    let roomBits = 0, roomCells = 0;
    for (let i = 0; i < BITMAP; i++) { if (room.bitmap[i] !== reference[i]) { roomBits++; } }
    for (let i = 0; i < ATTRS; i++) { if (room.attributes[i] !== reference[BITMAP+i]) { roomCells++; } }
    checked++;
    bits += roomBits;
    cells += roomCells;
    if (roomBits || roomCells) {
      console.log('mistnost %d: %d rozdilu v bitmape, %d v atributech',
                  number, roomBits, roomCells);
    }
  }
  console.log('\nporovnano %d mistnosti%s', checked,
              missing ? ' (chybi referencni buffer pro '+missing+')' : '');
  console.log('rozdilu v bitmape:    %d z %d B', bits, checked*BITMAP);
  console.log('rozdilu v atributech: %d z %d B', cells, checked*ATTRS);
  const ok = !missing && !bits && !cells;
  console.log('\napp/roomScenery.js proti rutine originalu: %s',
              ok ? 'NULA ROZDILU' : 'NESOUHLASI');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
