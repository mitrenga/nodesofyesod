const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Game over: shows how far the clock got, stores it in the server hall of fame
 * (the same saveGame.db API as the other remakes) and returns to the menu
 * after a countdown.
 *
 * It shows **TIME, not SCORE**, and that is deliberate. The panel of the
 * original has no score in it and no scoring routine has been found (ZADANI
 * chap. 4), so there is nothing to show; the clock, on the other hand, is a
 * real field of the original's own panel. Ranking players by it is the
 * remake's own convention — the same kind of addition as the hall of fame
 * itself, which the original does not have either (ZADANI chap. 6). When
 * chap. 4 is answered, this is the screen that changes.
 */
export class GameOverModel extends AbstractModel {

  constructor(app, nextModel) {
    super(app);
    this.id = 'GameOverModel';

    this.nextModel = nextModel;
    this.countdownLength = 8;
    this.buttonEntity = null;
    this.timerEntity = null;
  } // constructor

  /**
   * Seconds as the H:MM:SS clock of the original's panel.
   * @param {number} seconds - Elapsed seconds.
   * @returns {string} The clock text.
   */
  clock(seconds) {
    var total = Math.max(0, Math.floor(seconds || 0));
    return Math.min(9, Math.floor(total/3600))
           +':'+String(Math.floor(total/60)%60).padStart(2, '0')
           +':'+String(total%60).padStart(2, '0');
  } // clock

  init() {
    super.init();

    this.desktopEntity.bkColor = ZXColor.black;
    this.borderEntity.bkColor = ZXColor.black;

    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 10*8, this.desktopWidth, 8, 'GAME OVER', ZXColor.brightRed, false, {align: 'center'}));
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 13*8, this.desktopWidth, 8, 'TIME '+this.clock(this.app.time), ZXColor.brightWhite, false, {align: 'center'}));
    var best = Math.max(this.app.hiScore || 0, this.app.time || 0);
    var bestText = (this.app.time > 0 && this.app.time >= (this.app.hiScore || 0))
      ? 'NEW BEST TIME !' : 'BEST TIME '+this.clock(best);
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 15*8, this.desktopWidth, 8, bestText, ZXColor.brightGreen, false, {align: 'center'}));
    this.buttonEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, this.desktopWidth/2-35, 22*8-4, 70, 12, 'MENU', {id: this.nextModel}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.green, {topMargin: 2, align: 'center'});
    this.desktopEntity.addEntity(this.buttonEntity);
    this.timerEntity = new TextEntity(this.buttonEntity, this.app.fonts.fonts5x5, 8, 4, 10, 5, String(this.countdownLength), ZXColor.white, false, {align: 'center'});
    this.buttonEntity.addEntity(this.timerEntity);

    if (this.app.time) {
      this.fetchData('saveGame.db', false, {name: this.app.playerName, score: this.app.time});
    }
  } // init

  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  setData(data) {
    this.app.hiScore = data.data.hiScore;
  } // setData

  errorData(data) {
  } // errorData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'MenuModel':
        this.app.setModel('MenuModel');
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.timer === false) {
      this.timer = timestamp;
    }
    var countdown = this.countdownLength-Math.floor((timestamp-this.timer)/1000);
    if (countdown < 0) {
      this.sendEvent(1, {id: this.nextModel});
    } else {
      this.timerEntity.setText(countdown.toString());
    }

    this.drawModel();
  } // loopModel

} // GameOverModel
