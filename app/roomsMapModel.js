const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The map of the world: 16 x 16 cells, and since M2 every one of them holds a
 * real room out of the game's own tables (data/world.json, tools/dumprooms.py).
 * The grid was measured on the period screenshot map first; M2 confirmed it
 * from the program — the room number is row*16+column and the world wraps in
 * both directions ($882B).
 *
 * A cell is coloured by its **scenery set**, which is the one thing about a
 * room the world table says outright ($B500 bits 7-6), and from M4 a room whose
 * right wall the mole has **eaten through** is drawn bright — that is the one
 * thing about this world that changes while the game runs ($B600 bit 0), so the
 * map has it too.
 *
 * Nothing else is filled in: where the alchiems are is drawn at the start of
 * every game by the original itself ($86EA reads the R register), so a map that
 * showed them would be inventing them. M5 adds what the game knows about a room
 * once it has been visited — the original keeps that bitmap too, on $5B13.
 */
export class RoomsMapModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'RoomsMapModel';

    this.cell = 8;
    this.gridEntity = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8, this.desktopWidth, 8, 'MAP OF THE WORLD', ZXColor.brightYellow, false, {align: 'center'}));

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['global', 'world'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files: the map. Runs inside
   * init() when they are in localStorage, later when they had to come from
   * the server.
   * @param {Object|null} files - The data files, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    var global = this.loadDataFile('global');
    var world = this.loadDataFile('world');
    var cols = (world && world.grid && world.grid.columns)
               || (global && global.world && global.world.columns) || ScreenLayout.WORLD_COLS;
    var rows = (world && world.grid && world.grid.rows)
               || (global && global.world && global.world.rows) || ScreenLayout.WORLD_ROWS;
    var width = cols*this.cell;
    var height = rows*this.cell;
    var x = Math.floor((this.desktopWidth-width)/2);
    var y = 28;

    this.gridEntity = new AbstractEntity(this.desktopEntity, x-1, y-1, width+2, height+2, false, ZXColor.blue);
    this.desktopEntity.addEntity(this.gridEntity);
    // one cell per room, coloured by the scenery set the world table gives it
    var themeColor = [ZXColor.blue, ZXColor.green, ZXColor.red, ZXColor.magenta];
    var brightColor = [ZXColor.brightBlue, ZXColor.brightGreen, ZXColor.brightRed,
                       ZXColor.brightMagenta];
    for (var row = 0; row < rows; row++) {
      for (var column = 0; column < cols; column++) {
        var number = row*cols+column;
        var entry = world && world.rooms && world.rooms[String(number)];
        var color = ZXColor.black;
        if (entry) {
          color = themeColor[entry.theme] || ZXColor.black;
          // prokousaná stěna: bit 0 stavu místnosti, který vede worker
          if (this.app.roomState(number).dugRight) {
            color = brightColor[entry.theme] || color;
          }
          if (number === this.app.roomNumber) {
            color = ZXColor.brightWhite;
          }
        }
        this.gridEntity.addEntity(new AbstractEntity(this.gridEntity, 1+column*this.cell, 1+row*this.cell, this.cell-1, this.cell-1, false, color));
      }
    }

    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, y+height+6, this.desktopWidth-16, 24,
      world && world.rooms
        ? cols+' X '+rows+' ROOMS FROM THE GAME ITSELF. COLOUR IS THE SCENERY SET, BRIGHT IS A WALL THE MOLE HAS EATEN THROUGH; THE WORLD WRAPS BOTH WAYS.'
        : cols+' X '+rows+' CELLS. ROOM DATA MISSING - RUN tools/dumprooms.py.',
      ZXColor.white, false, {align: 'center', textWrap: true}));

    this.desktopEntity.addEntity(new ButtonEntity(this.desktopEntity, this.app.fonts.fonts5x5, this.desktopWidth/2-20, this.desktopHeight-20, 40, 13, 'BACK', {id: 'closeMap'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4}));
  } // initData


  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'closeMap':
        this.app.setModel('MenuModel');
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();
  } // loopModel

} // RoomsMapModel
