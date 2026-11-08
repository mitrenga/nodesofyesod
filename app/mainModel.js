const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ScreenEntity } = await import('./screenEntity.js?ver='+window.srcVersion);
const { SlidingTextEntity } = await import('./svision/js/platform/canvas2D/slidingTextEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Title screen. The picture is the one the original puts up when the tape has
 * finished — the control selection screen with the big astronaut drawing
 * (data/title.json, copied out of the video memory of the running original).
 * ★ The 128K edition shows the very same picture, byte for byte, apart from the
 * copyright line (screen_layout.md chap. 6) — measured: 231 bytes of bitmap and
 * one attribute. Both are extracted (data/title.json, data/title128.json), so
 * the edition the player picked in the menu is visible right here.
 *
 * Whether the original has an attract mode at all is an open question
 * (ZADANI chap. 8); until it is answered this screen only waits for the player.
 */
export class MainModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'MainModel';

    this.slidingText =
      '+++++ PRESS ENTER TO START +++++' +
      '  ' +
      'NODES OF YESOD by Odin Computer Graphics, 1985' +
      ' . . . . . . ' +
      'Charlie Fotheringham-Grunes lands on the Moon to find the black monolith - ' +
      'eight alchiems are hidden in the caves, and only the moon mole can dig the way through' +
      ' . . . . . . ';
    this.screenEntity = null;
    this.slidingTextEntity = null;
    this.speechMs = 0;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles([this.app.titleDataFile(), 'title', 'sound'].filter((key, i, keys) => keys.indexOf(key) == i), (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files (the title screen and the
   * speech of the audio manager). Runs inside init() when they are in
   * localStorage, later when they had to come from the server.
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
    var title = this.loadDataFile(this.app.titleDataFile())
                || this.loadDataFile('title');
    if (title) {
      this.screenEntity = new ScreenEntity(this.desktopEntity, 0, 0, title);
      this.desktopEntity.addEntity(this.screenEntity);
    } else {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'NODES OF YESOD', ZXColor.brightWhite, false, {align: 'center'}));
    }

    var bar = new AbstractEntity(this.desktopEntity, 0, 23*8, 32*8, 8, false, ZXColor.black);
    this.desktopEntity.addEntity(bar);
    this.slidingTextEntity = new SlidingTextEntity(bar, this.app.fonts.zxFonts8x8Mono, 0, 0, 32*8, 8, this.slidingText, ZXColor.brightYellow, ZXColor.black, {animation: 'loopLeft', speed: 20, leftMargin: 256, rightMargin: 256});
    bar.addEntity(this.slidingTextEntity);

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {muted: this.app.muted.sounds}});
    // ★ M7: co dělá originál, když dojede kazeta. Nejdřív pronese
    // digitalizované uvítání (`$E200`, 4246 bajtů jednobitového vzorku
    // z `$E23E` – **je v paměti**, kazeta k tomu potřeba nebyla), a pak na
    // téhle obrazovce dokola hraje titulní hudbu ze sedmi dílů (`$861E` volá
    // `$8704`), dokud hráč nezvolí ovládání. Přehrává se to z týchž bajtů,
    // ne z nahrávky (`ZADANI.md` §6).
    this.speechMs = this.app.audioManager ? this.app.audioManager.soundDuration('speech') : 0;
    if (this.speechMs > 0) {
      this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'speechSound', options: {}});
      this.sendEvent(Math.round(this.speechMs)+500, {id: 'playTitleTune'});
    } else {
      this.sendEvent(500, {id: 'playTitleTune'});
    }

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown


  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'playTitleTune':
        // dokola, jako `$861E`: melodie dohraje a začíná znovu
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'titleTuneSound',
                           options: {repeat: true}});
        return true;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'startRoom':
        this.app.startRoom();
        return true;

      case 'keyPress':
        if (this.desktopEntity.modalEntity != null) {
          break;
        }
        switch (event.key) {
          case 'Enter':
          case ' ':
          case 'GamepadOK':
            this.app.startRoom();
            return true;
          case 'Escape':
          case 'GamepadExit':
            this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, 40, 153, 85, 'OPTIONS', 'MenuModel'));
            return true;
          case 'Mouse1':
            this.app.inputEventsManager.keysMap.Mouse1 = this.borderEntity;
            return true;
          case 'Touch':
            this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity;
            return true;
        }
        break;

      case 'keyRelease':
        switch (event.key) {
          case 'Mouse1':
            if (this.app.inputEventsManager.keysMap.Mouse1 === this.borderEntity) {
              this.app.startRoom();
              return true;
            }
            break;
          case 'Touch':
            if (this.app.inputEventsManager.touchesMap[event.identifier] === this.borderEntity) {
              this.app.startRoom();
              return true;
            }
            break;
        }
        break;

      case 'continueGame':
        return true;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.slidingTextEntity.loopEntity(timestamp);

    this.drawModel();
  } // loopModel

} // MainModel
