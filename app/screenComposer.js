const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
// begin code

/**
 * Composes the Nodes of Yesod screen in the video memory of the machine.
 *
 * Everything it draws comes out of the original: the room is assembled by
 * RoomScenery from the game's own scenery blocks (data/scenery.json and
 * data/rooms.json, tools/dumpgfx.py and tools/dumprooms.py) and the panel is
 * assembled from the game's own tile table and its own display list
 * (data/panel.json, tools/mkpanel.py) in the game's own character set
 * (data/font.json, tools/mkfont.py). Nothing here is drawn by hand.
 *
 * The room arrives the way the original holds it in its **shadow buffer**
 * ($F900: a linear play area whose attribute bit 7 is the collision map, not
 * FLASH), and that copy is kept here as it is, because the attribute rule of
 * the sprites reads it. What the entities show is a {@link ZXVideoRAM} — the
 * 6912 bytes in the ULA's own interleaved order — into which the room is put
 * once per room and the sprites are XOR-ed once per frame, the way the
 * original's blit copies the buffer out and masks bit 7 off on the way
 * (R-003). The attribute clash is reproduced rather than removed (ZADANI
 * chap. 1).
 *
 * GameAreaEntity calls {@link ScreenComposer#composeInto} and GameInfoEntity
 * {@link ScreenComposer#composePanelInto}, each into its own memory. What is
 * here is only what the original does and this remake measured: the order of
 * drawing, the colour rule of the sprites, the display list of the panel. The
 * byte work — shifted XOR blit, cells, clearing — is the library's
 * ({@link ZXVideoRAM}).
 *
 * Free of DOM dependencies, so an offline tool loads it under Node behind the
 * `nodeEnv.mjs` shim (R-001) and composes into a memory of its own
 * (tools/renderframe.js, tools/runworker.js).
 */
export class ScreenComposer {

  static get WIDTH() { return 256; }
  static get COLS() { return 32; }
  static get CELL() { return 8; }
  /** the room is the top 21 character rows, the panel the last three */
  static get PLAY_ROWS() { return 21; }
  static get PANEL_ROWS() { return 3; }
  /** the play area in character cells: rows 0-20 of the screen */
  static get PLAY_AREA() { return {col: 0, row: 0, cols: 32, rows: 21}; }
  /** the panel in character cells: rows 21-23 of the screen */
  static get PANEL_AREA() { return {col: 0, row: 21, cols: 32, rows: 3}; }
  /**
   * ★ **Bit 7 atributu hrací plochy není blikání – je to kolizní mapa.**
   * Ve stínovém bufferu originálu (`$F900`) drží „tady se koliduje" a blit
   * atributů ho maskuje `AND $7F`, takže se na obrazovku nikdy nedostane
   * (`$8891`, disasm_notes.md §8.1 a §10.5). Skládání místnosti ho
   * reprodukuje, a je nasazený na 24 % buněk – bez masky bliká skoro celá
   * scéna. Maskuje se **až při kreslení**, přesně jako v originálu: fyzika
   * ten bit potřebuje mít v atributech dál. GameAreaEntity si ho nasadí přes
   * `setAttrMask`.
   */
  static get ATTR_MASK() { return 0x7F; }

  /**
   * @param {Object} room - The play area: {width, height, bitmap, attributes},
   *        either from RoomScenery or from a data file (base64).
   * @param {Object} [font] - The parsed data/font.json; without it the panel
   *        keeps the values the display list starts with.
   * @param {Object} [panel] - The parsed data/panel.json: the tile table, the
   *        display list and the attributes of the original's panel.
   */
  constructor(room, font, panel) {
    if (!room || !room.bitmap || !room.attributes) {
      throw new Error('room data missing or incomplete');
    }
    this.room = null;
    this.setRoom(room);
    this.font = {};
    if (font && font.glyphs) {
      Object.keys(font.glyphs).forEach((char) => {
        this.font[char] = ZXVideoRAM.hexToBytes(font.glyphs[char]);
      });
    }
    this.sprites = null;
    this.panel = null;
    // Ikona **člověk / krtek** v levém dolním rohu panelu. M1 v display listu
    // našla dva bloky 3 × 3 na tomtéž místě a druhý neumístila; M4 odpověděla,
    // že je to krtek (data/mole.json -> panelIcon, tools/dumpmole.py).
    this.panelIcon = null;
    if (panel && panel.tiles && panel.blocks) {
      this.panel = {
        tiles: panel.tiles.map(ZXVideoRAM.hexToBytes),
        blocks: panel.blocks.filter((block) => block.drawn),
        allBlocks: panel.blocks,
        attributes: ZXVideoRAM.decode(panel.attributes),
        fields: panel.fields || {}
      };
    }
  } // constructor

  /**
   * Puts another room up — in M2 that is what RoomScenery composed out of the
   * original's scenery blocks — and from M4 that is what the worker sends over
   * on every flick-screen transition. The shadow copy is kept as it comes and
   * the room is put into the play area of a memory of its own, which every
   * frame starts from.
   * @param {Object} room - {width, height, bitmap, attributes}; the bytes may
   *        be base64 (a data file) or a Uint8Array (RoomScenery).
   */
  setRoom(room) {
    this.room = {
      width: room.width || 256,
      height: room.height || 168,
      // ★ Číslo místnosti není jen popisek: barva pozadí, kterou sprite smí
      // přebarvit, je na povrchu jiná než v jeskyních ($8871 čte $5B04).
      number: room.number === undefined ? this.roomNumber() : room.number,
      bitmap: ZXVideoRAM.decode(room.bitmap),
      attributes: ZXVideoRAM.decode(room.attributes)
    };
    this.playArea = {col: 0, row: 0, cols: ScreenComposer.COLS, rows: this.room.height/8};
    this.roomMemory = new ZXVideoRAM()
      .setLinear(this.playArea, this.room.bitmap, this.room.attributes);
  } // setRoom

  /** Číslo místnosti, kterou renderer drží teď (než ji vystřídá další). */
  roomNumber() {
    return this.room ? this.room.number : 0;
  } // roomNumber

  /**
   * Patches the 96 bytes of one wall gap into the play area — that is all that
   * changes while the mole eats a wall, so that is all the worker sends
   * ($9B9D eats one two pixel chunk per pass; app/WORKER-PROTOCOL.md).
   *
   * The gap is 2 cells wide and 6 tall at character row 13, and the bytes come
   * in the layout of the original's own play area buffer. They go into the
   * shadow copy and into the room's memory alike.
   * @param {string} side - 'left' or 'right'.
   * @param {Array|Uint8Array} bytes - The 96 bytes.
   */
  setGapPixels(side, bytes) {
    if (!bytes || !this.room || !this.room.bitmap) {
      return;
    }
    var column = side === 'left' ? 0 : 30;
    var n = 0;
    for (var row = 13; row < 19; row++) {
      for (var line = 0; line < 8; line++) {
        var at = ZXVideoRAM.lineOffset(row*8+line)+column;
        this.room.bitmap[row*256+line*32+column] = bytes[n];
        this.roomMemory.pokeOffset(at, bytes[n++]);
        this.room.bitmap[row*256+line*32+column+1] = bytes[n];
        this.roomMemory.pokeOffset(at+1, bytes[n++]);
      }
    }
  } // setGapPixels

  // ------------------------------------------------------------ the room

  /**
   * Composes the play area into a video memory: the room with everyone in it
   * drawn, the way the original's blit puts its shadow buffer on the screen.
   * The whole memory is replaced by the room, so the panel rows come out
   * empty — the panel is another entity with a memory of its own.
   *
   * Bit 7 of the attributes is left in: it is masked off when the memory is
   * painted ({@link ScreenComposer.ATTR_MASK}), exactly where the original
   * masks it.
   * @param {ZXVideoRAM} videoRAM - The memory to write.
   * @param {Object} [state] - The frame state from the worker.
   */
  composeInto(videoRAM, state) {
    videoRAM.restore(this.roomMemory);
    // Kdo se kreslí: Charlie, **krtek** a od M5 i **nepřátelé, poletující
    // objekty, alchiem nebo mugger v místnosti a položený gravity stick**.
    // Všechno jsou to tytéž 32bajtové záznamy entit a kreslí se týmž blitem
    // (sources/docs/disasm_notes.md §11 a §12), takže tady žádná zvláštní
    // větev pro ně není – jen se přidají do seznamu.
    var drawn = [];
    if (state && state.charlie && state.charlie.visible) { drawn.push(state.charlie); }
    if (state && state.mole && state.mole.visible) { drawn.push(state.mole); }
    var monsters = state && state.monsters;
    if (monsters) {
      // Pořadí je pořadí originálu: nejdřív poletující objekty ($A4DC), pak
      // nepřátelé ($A5B2) – kdo se kreslí později, leží navrchu.
      (monsters.objects || []).forEach((o) => { if (o) { drawn.push(o); } });
      if (monsters.pickup) { drawn.push(monsters.pickup); }
      if (monsters.stick) { drawn.push(monsters.stick); }
      (monsters.monsters || []).forEach((m) => { if (m) { drawn.push(m); } });
    }
    if (drawn.length && this.sprites) {
      drawn.forEach((entity) => this.drawSprite(videoRAM, entity));
    }
  } // composeInto

  /**
   * Puts the man/mole icon of the panel up.
   * @param {Object} icon - data/mole.json -> panelIcon.
   */
  setPanelIcon(icon) {
    this.panelIcon = (icon && icon.attrCells) ? icon : null;
  } // setPanelIcon

  /**
   * Puts the sprite table up (data/spriteframes.json, tools/dumpsprites.py).
   * @param {Object} sprites - The parsed sprite frames.
   */
  setSprites(sprites) {
    this.sprites = null;
    if (!sprites || !sprites.banks || !sprites.frames) { return; }
    this.sprites = {
      banks: sprites.banks.map((bank) => bank.frames),
      // pravidlo zápisu atributu ($940E-$9445, tools/dumpsprites.py)
      attributes: sprites.attributes || null,
      frames: sprites.frames.map((frame) => ({
        width: frame.width, height: frame.height, attribute: frame.attribute,
        bytesPerLine: frame.bytesPerLine, data: ZXVideoRAM.decode(frame.data),
        // the same bitmap mirrored, for the frames that look left; the dumper
        // puts it into the data (tools/dumpsprites.py, mirror_rows())
        mirror: frame.mirror ? ZXVideoRAM.decode(frame.mirror) : null
      }))
    };
  } // setSprites

  /**
   * Draws one entity the way the original draws it: **XOR** into the play
   * area, pre-shifted by 0 to 7 pixels ($9508 — {@link ZXVideoRAM#blitShifted}).
   * The attribute goes in separately and by the original's own rule —
   * drawSpriteAttributes().
   *
   * Bit 7 of the frame number is **not** a second bitmap: the table entry is
   * the same one ($8E80 takes the frame number times two, so $80 and $00 land
   * on the same pointer, measured in tools/physlog.py). It says which way
   * Charlie faces — and **that bitmap is drawn mirrored**, the way the game
   * mirrors a scenery tile with bit 7 in its index ($8A70, through the table
   * of reversed bytes at $FE00). Walking left runs frames $80-$87 ($5BC8), so
   * without it Charlie walks left facing right. The mirrored bitmap comes
   * ready in the data (tools/dumpsprites.py).
   *
   * Which of the two pointer tables the frame comes from is **bit 6 of the
   * entity flags** ($8E87): Charlie has it set and reads bank 0, the mole has
   * it clear and reads bank 1. That is why the worker sends `bank`.
   * @param {ZXVideoRAM} videoRAM - Target memory.
   * @param {Object} charlie - {x, y, sprite, wrapped, bank} from the worker.
   */
  drawSprite(videoRAM, charlie) {
    var bank = this.sprites.banks[charlie.bank || 0] || this.sprites.banks[0];
    var index = bank[charlie.sprite & 0x7F];
    if (index === undefined || index < 0) { return; }
    var frame = this.sprites.frames[index];
    var data = (charlie.sprite & 0x80) && frame.mirror ? frame.mirror : frame.data;
    var x = charlie.wrapped ? charlie.x-256 : charlie.x;
    videoRAM.blitShifted(data, frame.bytesPerLine, frame.height, x, charlie.y, this.playArea, 'xor');
    this.drawSpriteAttributes(videoRAM, charlie, frame);
  } // drawSprite

  /**
   * ★ **Atribut rámce se nezapisuje celý** (`$940E`–`$9445`) – a než se to
   * změřilo, maloval remake kolem Charlieho na povrchu **černé obdélníky**,
   * protože rámce mají papír 0. Originál dělá tohle:
   *
   * - z atributu rámce vezme jen `AND $C7` (`$9419`) – flash, bright a **ink**;
   * - **papír nechá z pozadí** (`AND $38` na tom atributu, který se právě
   *   překlopil na obrazovku, `$9421`);
   * - a zapíše jen do buňky, která **je pozadí**: atribut místnosti ve stínovém
   *   bufferu je po `AND $3F` (`$942E`) buď nula, nebo se rovná barvě pozadí té
   *   části světa – `$09` na povrchu, `$07` v jeskyních (`$8871`–`$8887`, podle
   *   `$5B04`). Kulisu tím sprite nepřebarví.
   *
   * Bere se **obálka v buňkách** (`$9397`), ne jen buňky, do kterých padl
   * pixel – proto je kolem spritu vidět celý obdélník. Jak si originál vede
   * **předchozí** polohu (bajty `+$0E`–`+$1D`, `$91AE`), zůstává M7.
   *
   * Konstanty jsou operandy ověřených instrukcí (`data/spriteframes.json`
   * → `attributes`, `tools/dumpsprites.py`).
   *
   * @param {ZXVideoRAM} videoRAM - Target memory.
   * @param {Object} entity - {x, y, wrapped} from the worker.
   * @param {Object} frame - The sprite frame (width, height, attribute).
   */
  drawSpriteAttributes(videoRAM, entity, frame) {
    var rule = this.sprites && this.sprites.attributes;
    if (!rule) { return; }
    var cols = ScreenComposer.COLS, rows = this.playArea.rows;
    var x = entity.wrapped ? entity.x-256 : entity.x;
    var y = entity.y;
    var ink = frame.attribute & rule.frameMask;
    var guard = this.room.number < rule.surfaceMaxRoom ? rule.guardSurface
                                                       : rule.guardCave;
    var cellRows = (((y & 7)+7+frame.height) >> 3) & 0x1F;
    var cellCols = (((x & 7)+7+frame.width) >> 3) & 0x1F;
    var row0 = y >> 3, col0 = x >> 3;
    for (var r = 0; r < cellRows; r++) {
      var row = row0+r;
      if (row < 0 || row >= rows) { continue; }
      for (var c = 0; c < cellCols; c++) {
        var col = col0+c;
        if (col < 0 || col >= cols) { continue; }
        // the shadow buffer of the original says what is background
        var background = this.room.attributes[row*cols+col] & rule.shadowMask;
        if (background !== 0 && background !== guard) { continue; }
        videoRAM.pokeAttribute(row, col,
          (videoRAM.peekAttribute(row, col) & rule.paperMask) | ink);
      }
    }
  } // drawSpriteAttributes

  // ----------------------------------------------------------- the panel

  /**
   * Composes the panel (character rows 21-23) into a video memory: the blocks
   * of the original's display list laid out where they were measured, with the
   * fields the game writes into at run time filled in. Only the three rows are
   * written; the rest of the memory is left alone.
   *
   * What the game itself writes there is exactly three things, found by
   * comparing the display list with captured frames (tools/mkpanel.py): the
   * number of lives, the clock, and the two cells of the oscilloscope. The
   * eight ALCHIEMS slots and the oscilloscope are **left as the display list
   * has them** — what the original draws into them is an open question
   * (ZADANI chap. 8), and inventing a picture for them would be worse than
   * showing nothing.
   * @param {ZXVideoRAM} videoRAM - The memory to write.
   * @param {Object} [state] - {lives, time, mode} from the worker.
   */
  composePanelInto(videoRAM, state) {
    var area = ScreenComposer.PANEL_AREA;
    videoRAM.clearArea(area, 0);
    if (!this.panel) {
      return;
    }
    for (var row = 0; row < area.rows; row++) {
      for (var col = 0; col < area.cols; col++) {
        videoRAM.pokeAttribute(area.row+row, col, this.panel.attributes[row*area.cols+col]);
      }
    }
    this.panel.blocks.forEach((block) => {
      for (var y = 0; y < block.height; y++) {
        for (var x = 0; x < block.width; x++) {
          this.writeCell(videoRAM, block.row+y, block.column+x,
                         this.panel.tiles[block.tiles[y*block.width+x]]);
        }
      }
    });
    var fields = this.panel.fields;
    var values = state || {};
    if (fields.lives) {
      this.writeText(videoRAM, fields.lives.row, fields.lives.column,
                     String(Math.max(0, Math.min(9, values.lives === undefined ? 0 : values.lives))));
    }
    if (fields.time) {
      this.writeText(videoRAM, fields.time.row, fields.time.column,
                     ScreenComposer.clock(values.time || 0));
    }
    this.drawPanelIcon(videoRAM, values.mode);
  } // composePanelInto

  /**
   * The man/mole icon: the same 3 x 3 block position with either block of the
   * display list in it, and three attribute cells the game overwrites with it
   * ($8273 for the man, $A0DD for the mole).
   * @param {ZXVideoRAM} videoRAM - Target memory.
   * @param {string} [mode] - 'man' or 'mole'.
   */
  drawPanelIcon(videoRAM, mode) {
    var icon = this.panelIcon;
    if (!icon || !this.panel || !this.panel.allBlocks) {
      return;
    }
    var mole = mode === 'mole';
    var block = this.panel.allBlocks[mole ? icon.blockMole : icon.blockMan];
    if (!block) {
      return;
    }
    for (var y = 0; y < block.height; y++) {
      for (var x = 0; x < block.width; x++) {
        this.writeCell(videoRAM, icon.row+y, icon.column+x,
                       this.panel.tiles[block.tiles[y*block.width+x]]);
      }
    }
    var area = ScreenComposer.PANEL_AREA;
    var values = mole ? icon.attrMole : icon.attrMan;
    icon.attrCells.forEach((cell, i) => {
      if (cell[1] >= 0 && cell[1] < area.rows) {
        videoRAM.pokeAttribute(area.row+cell[1], cell[0], values[i]);
      }
    });
  } // drawPanelIcon

  /**
   * Seconds as the clock of the panel, H:MM:SS — the format measured on the
   * running original ('0:00:07' seven seconds into a game).
   * @param {number} seconds - Elapsed seconds.
   * @returns {string} Seven characters.
   */
  static clock(seconds) {
    var total = Math.max(0, Math.floor(seconds));
    var hours = Math.min(9, Math.floor(total/3600));
    var minutes = Math.floor(total/60)%60;
    return hours+':'+String(minutes).padStart(2, '0')+':'
           +String(total%60).padStart(2, '0');
  } // clock

  /**
   * Puts one 8 byte cell into the panel. The row is counted **within the
   * panel**, as the display list counts it.
   * @param {ZXVideoRAM} videoRAM - Target memory.
   * @param {number} row - Character row within the panel.
   * @param {number} col - Character column.
   * @param {Uint8Array} cell - The eight bytes of the cell.
   */
  writeCell(videoRAM, row, col, cell) {
    if (cell) {
      videoRAM.pokeCell(ScreenComposer.PANEL_AREA.row+row, col, cell);
    }
  } // writeCell

  /**
   * Writes a string in the game's own character set into the panel.
   * @param {ZXVideoRAM} videoRAM - Target memory.
   * @param {number} row - Character row within the panel.
   * @param {number} col - First character column.
   * @param {string} text - The text; the set has digits, capitals and a colon.
   */
  writeText(videoRAM, row, col, text) {
    for (var i = 0; i < text.length; i++) {
      this.writeCell(videoRAM, row, col+i, this.font[text.charAt(i)]);
    }
  } // writeText

} // ScreenComposer
