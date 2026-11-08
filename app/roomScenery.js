// begin code

/**
 * Builds a room out of the original's own scenery blocks.
 *
 * Nothing here is a picture of a room. The room is put together the way the
 * original puts it together (sources/docs/disasm_notes.md chap. 8): the play
 * area buffer is filled with the background attribute, then blocks of the
 * display list are stamped into it, then loose tiles, then the stars, and
 * finally the attribute bit 7 is cleared where the game clears it.
 *
 * A tile is one 8x8 character cell: eight bitmap bytes and an attribute byte.
 * Bit 7 of a tile index means **mirror horizontally** — the original has a
 * byte reverse table for that, built at start up, and so has this class.
 *
 * Clipping is the original's: the column and the row are byte counters, so
 * they wrap at 256, and whatever falls outside 32 x 21 is dropped. That is how
 * a block placed at column $FE draws only its right hand part — the left wall.
 *
 * The dug through walls are **not** in the data. They are state: `$B600` bit 0
 * of a room says its right wall has been dug open, and the game cuts a hole of
 * 2 x 6 cells into the scenery for it (and into the left wall of the room to
 * the right of it). That is the one thing about this world that changes while
 * the game runs, so composeRoom() takes it as an argument rather than baking
 * it into the room.
 */
class RoomScenery {

  static get COLS() { return 32; }
  static get ROWS() { return 21; }

  /**
   * @param {Object} scenery - The parsed data/scenery.json: the tile tables
   *        and the display lists of the four scenery sets.
   * @param {Object} rooms - The parsed data/rooms.json: what the original's
   *        own routine put where, room by room.
   * @param {Object} [world] - The parsed data/world.json; needed only for the
   *        wall gap geometry and the grid.
   */
  constructor(scenery, rooms, world) {
    if (!scenery || !scenery.themes || !rooms || !rooms.rooms) {
      throw new Error('scenery or room data missing');
    }
    this.themes = scenery.themes.map((theme) => {
      var stride = theme.tiles.bytesPerTile;
      var raw = RoomScenery.decode(theme.tiles.data);
      var tiles = [];
      for (var n = 0; n < theme.tiles.count; n++) {
        tiles.push(raw.subarray(n*stride, (n+1)*stride));
      }
      return {tiles: tiles, stride: stride, blocks: theme.displayList.blocks};
    });
    this.rooms = rooms.rooms;
    this.world = world || null;
    this.gap = (world && world.wallGap)
               || {tile: 0, width: 2, height: 6, y: 13, xRight: 30, xLeft: 0};
    this.grid = (world && world.grid) || {columns: 16, rows: 16};
    this.mirror = new Uint8Array(256);
    for (var value = 0; value < 256; value++) {
      var reversed = 0;
      for (var bit = 0; bit < 8; bit++) {
        reversed |= ((value >> bit) & 1) << (7-bit);
      }
      this.mirror[value] = reversed;
    }
  } // constructor

  /**
   * Decodes a base64 block into bytes.
   * @param {string} base64 - The encoded block.
   * @returns {Uint8Array} The decoded bytes.
   */
  static decode(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } // decode

  /**
   * The room to the left of a room; the world is a torus, so the column wraps
   * inside its row (the original computes it that way in $882B).
   * @param {number} room - The room number.
   * @returns {number} The room number of its left hand neighbour.
   */
  leftOf(room) {
    var columns = this.grid.columns;
    return (room & ~(columns-1)) | ((room-1) & (columns-1));
  } // leftOf

  /**
   * Composes one room.
   * @param {number} number - The room number, 0 to 255.
   * @param {Object} [state] - {dugRight, dugLeft}: whether the right wall of
   *        this room and the right wall of its left hand neighbour have been
   *        dug through.
   * @returns {Object} {width, height, bitmap, attributes} — the bytes the
   *        original leaves in its own play area buffer.
   */
  composeRoom(number, state) {
    var room = this.rooms[String(number)];
    if (!room) {
      throw new Error('no data for room '+number);
    }
    var cols = RoomScenery.COLS;
    var rows = RoomScenery.ROWS;
    var theme = this.themes[room.theme];
    var bitmap = new Uint8Array(cols*8*rows);
    var attributes = new Uint8Array(cols*rows);
    attributes.fill(room.fillAttr);
    if (room.skyAttr !== null && room.skyAttr !== undefined) {
      attributes.fill(room.skyAttr, 0, room.skyRows*cols);
    }

    var putTile = (index, x, y) => {
      if (x >= cols || y >= rows) {
        return;                       // the original drops it, so do we
      }
      var tile = theme.tiles[index & 0x7F];
      var mirrored = index & 0x80;
      var base = y*256+x;
      for (var line = 0; line < 8; line++) {
        var byte = tile[line];
        bitmap[base+line*32] = mirrored ? this.mirror[byte] : byte;
      }
      attributes[y*cols+x] = tile[8];
    };

    var putBlock = (index, x0, y0) => {
      var block = theme.blocks[index];
      for (var row = 0; row < block.height; row++) {
        var y = (y0+row) & 0xFF;
        for (var col = 0; col < block.width; col++) {
          putTile(block.tiles[row*block.width+col], (x0+col) & 0xFF, y);
        }
      }
    };

    room.blocks.forEach((placement) => putBlock(placement[0], placement[1], placement[2]));
    room.looseTiles.forEach((placement) => putTile(placement[0], placement[1], placement[2]));

    if (state && state.dugRight) {
      this.cutGap(putTile, this.gap.xRight);
    }
    if (state && state.dugLeft) {
      this.cutGap(putTile, this.gap.xLeft);
    }

    room.attrClear.forEach((rect) => {
      for (var row = 0; row < rect[3]; row++) {
        for (var col = 0; col < rect[2]; col++) {
          attributes[(rect[1]+row)*cols+rect[0]+col] &= 0x7F;
        }
      }
    });
    room.pixelSet.forEach((pixel) => { bitmap[pixel[0]] |= pixel[1]; });

    // `number` jde s plochou dál: barva pozadí, kterou sprite smí přebarvit,
    // je na povrchu jiná než v jeskyních ($8871 čte $5B04, screenComposer.js).
    return {width: cols*8, height: rows*8, number: number,
            bitmap: bitmap, attributes: attributes};
  } // composeRoom

  /**
   * Cuts the hole a dug through wall leaves in the scenery.
   * @param {Function} putTile - The tile placer of composeRoom().
   * @param {number} x - The left column of the hole.
   */
  cutGap(putTile, x) {
    for (var row = 0; row < this.gap.height; row++) {
      for (var col = 0; col < this.gap.width; col++) {
        putTile(this.gap.tile, x+col, this.gap.y+row);
      }
    }
  } // cutGap

} // class RoomScenery

if (typeof self !== 'undefined') { self.RoomScenery = RoomScenery; }
if (typeof module !== 'undefined' && module.exports) { module.exports = RoomScenery; }
