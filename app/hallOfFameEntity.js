const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The hall of fame. What it ranks is **time**, not score: the original has no
 * score in its panel and no scoring routine has been found (ZADANI chap. 4),
 * while the clock is a real field of its panel — see gameOverModel.js. The
 * server keeps the value in the `score` column all the sibling remakes use.
 */
export class HallOfFameEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height, bkColor) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'HallOfFameEntity';

    this.panelBkColor = bkColor;
} // constructor

  init() {
    super.init();
    
    this.addEntity(new AbstractEntity(this, 0, 0, this.width, this.height, false, ZXColor.black));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 0, this.width, 9, 'HALL OF FAME - LONGEST TIMES', ZXColor.brightWhite, false, {align: 'center', topMargin: 2}));
    this.addEntity(new AbstractEntity(this, 1, 9, this.width-2, this.height-10, false, this.panelBkColor));

    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, this.width-39, this.height-16, 36, 13, 'CLOSE', {id: 'closeHallOfFame'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.brightBlue, {align: 'center', margin: 4}));

    if (navigator.onLine) {
      this.fetchData('hallOfFame.db', false, {});
    } else {
      this.showOfflineNotice();
    }
  } // init

  /**
   * Seconds as the H:MM:SS clock of the original's panel.
   * @param {number} seconds - The stored value.
   * @returns {string} The clock text.
   */
  static clock(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.min(9, Math.floor(total/3600))
           +':'+String(Math.floor(total/60)%60).padStart(2, '0')
           +':'+String(total%60).padStart(2, '0');
  } // clock

  setData(data) {
    for (var i = 0; i < Object.keys(data.data).length; i++) {
      var y = 12+i*10;
      this.addEntity(new TextEntity(this, this.app.fonts.zxFonts8x8, 2, y, 18, 8, (i+1)+'.', ZXColor.black, false, {align: 'right'}));
      this.addEntity(new TextEntity(this, this.app.fonts.zxFonts8x8, 24, y, 120, 8, data.data[i].name, ZXColor.black, false, {}));
      this.addEntity(new TextEntity(this, this.app.fonts.zxFonts8x8Mono, this.width-108, y, 102, 8, HallOfFameEntity.clock(data.data[i].score), ZXColor.black, false, {align: 'right'}));
      if (i == 0) {
        this.app.hiScore = data.data[0].score;
      }
    }
  } // setData

  errorData(error) {
    this.showOfflineNotice();
  } // errorData

  showOfflineNotice() {
    this.addEntity(new TextEntity(this, this.app.fonts.zxFonts8x8, 0, this.height/2-20, this.width, 32, 'SYSTEM OFFLINE', ZXColor.brightRed, false, {align: 'center', textWrap: true}));
  } // showOfflineNotice

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'closeHallOfFame':
        this.destroy();
        return true;
    }

    return false;
  } // handleEvent

} // HallOfFameEntity
