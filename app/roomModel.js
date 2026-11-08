const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { GameInfoEntity } = await import('./gameInfoEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen: one room on character rows 0-20 and the panel on rows
 * 21-23 — the flick-screen layout of the original with the panel at the
 * bottom (sources/docs/screen_layout.md).
 *
 * M2 puts a real room up: RoomScenery assembles it out of the original's own
 * scenery blocks (data/scenery.json, data/rooms.json), and the panel out of
 * the game's own tile table and display list (data/panel.json).
 *
 * ★ **From M4 the world belongs to the worker.** The model no longer knows
 * which room the game is in: the worker composes each room itself (it has to —
 * the original swaps the room in the middle of a pass) and sends the play area
 * over in a `room` message. While the mole eats a wall it sends only the 96
 * bytes of that gap. This model routes the controls in, draws what comes back
 * — Charlie, the mole, the panel with its man/mole icon — and keeps nothing of
 * its own (app/WORKER-PROTOCOL.md).
 */
export class RoomModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'RoomModel';

    this.gameOver = false;
    this.controlsState = {left: false, right: false, up: false, down: false,
                          mode: false};
    this.moleMode = 'man';
    // M6: akce, které drží doťukaný krátký stisk, dokud ho worker neuvidí
    this.heldTaps = {};
    this.worker = null;
    this.render = null;
    this.roomData = null;
    this.gameAreaEntity = null;
    this.gameInfoEntity = null;
    this.stateEntity = null;
    this.fpsEntity = null;
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();

    // The snapshot has the border black; whether the game moves it during play
    // is an open question (ZADANI chap. 8), so black it is until it is measured.
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['scenery', 'rooms', 'world', 'physics', 'mole', 'monsters', 'spriteframes', 'font', 'panel', 'sound'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files: the screen and the start
   * of the worker. Runs inside init() when they are in localStorage, later
   * when they had to come from the server.
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
    if (!this.initScreen()) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'NODES OF YESOD', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 96,
        'GAME DATA MISSING: '+(this.missingData && this.missingData.length ? this.missingData.join(', ').toUpperCase() : '?')
        +'. THE DATA COMES WITH APPDATA (DB/APPDATA.PHP) AND IS KEPT IN LOCALSTORAGE - SEE THE BROWSER CONSOLE.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
      // Ask for appData again: whatever went wrong with the request at startup
      // (a timeout, a hiccup), by the next start the data is in storage.
      this.app.loadAppData();
      return;
    }

    // Milestone read-out: which room, what the physics says Charlie is doing.
    // It is not part of the game and goes away when the panel says everything
    // the original's panel says (M5).
    this.stateEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 4, 4, 248, 6, '', ZXColor.brightGreen, false, {});
    this.desktopEntity.addEntity(this.stateEntity);

    if (this.app.devModeName !== false) {
      this.fpsEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 16*8, 12, 10*8, 4, '', ZXColor.brightGreen, false, {align: 'right'});
      this.desktopEntity.addEntity(this.fpsEntity);
    }

    // The menu keeps the audio closed; the game opens its buses here. There
    // are two, because the original has two things going at once: what it
    // plays whole (`sounds`) and the per-frame buzz of interrupt slot 2
    // (`extra`) — see app/audioManager.js. No music bus: the 48K edition has
    // no music while the game runs (ZADANI chap. 0).
    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {muted: this.app.muted.sounds}});
    this.sendEvent(0, {id: 'openAudioBus', bus: 'extra', options: {muted: this.app.muted.sounds}});
    if (this.app.audioManager) { this.app.audioManager.resetBeeper(); }

    this.worker = this.app.worker;
    this.showTouchIcons();
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    // M4/M5: worker dostane celý svět. Kromě fyziky Charlieho a krtka
    // (data/physics.json, data/mole.json) a nepřátel s objekty
    // (data/monsters.json) i **kulisu, místnosti a popis světa**,
    // protože si místnost při přechodu skládá sám – originál ji mění uprostřed
    // průchodu a Charlie se pak posune už v nové kulise ($8FE2).
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        lives: this.app.lives,
        room: this.app.roomNumber,
        edition: this.app.edition,
        physics: this.physicsData,
        mole: this.moleData,
        monsters: this.monsterData,
        spriteframes: this.spriteData,
        scenery: this.sceneryData,
        rooms: this.roomsData,
        world: this.worldData,
        scene: {}
      }
    });

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown


  /**
   * Builds the renderer and adds the room and the panel.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    this.missingData = [];
    try {
      this.sceneryData = this.loadDataFile('scenery');
      this.roomsData = this.loadDataFile('rooms');
      this.worldData = this.loadDataFile('world');
      this.physicsData = this.loadDataFile('physics');
      this.moleData = this.loadDataFile('mole');
      this.monsterData = this.loadDataFile('monsters');
      this.spriteData = this.loadDataFile('spriteframes');
      // Which one is missing matters: the files are on the disk all along, so
      // naming them points at the appData request (db/appData.php) or at
      // localStorage, not at the dumping tools.
      this.missingData = [
        ['scenery', this.sceneryData], ['world', this.worldData],
        ['physics', this.physicsData], ['mole', this.moleData],
        ['monsters', this.monsterData], ['rooms', this.roomsData],
        ['spriteframes', this.spriteData]
      ].filter((entry) => !entry[1]).map((entry) => entry[0]);
      if (this.missingData.length) {
        throw new Error('game data missing: '+this.missingData.join(', '));
      }
      // Hrací plochu **skládá worker** (musí – originál mění místnost uprostřed
      // průchodu). Renderer proto vznikne nad prázdnou plochou a hned první
      // zpráva `room` ji přepíše; skládat ji tady podruhé by znamenalo mít
      // roomScenery.js na dvou místech.
      this.roomData = {width: 256, height: 168,
                       bitmap: new Uint8Array(21*256),
                       attributes: new Uint8Array(21*32)};
      this.render = new ScreenComposer(this.roomData, this.loadDataFile('font'),
                                     this.loadDataFile('panel'));
      this.render.setSprites(this.spriteData);
      this.render.setPanelIcon(this.moleData && this.moleData.panelIcon);
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.gameAreaEntity = new GameAreaEntity(this.desktopEntity, 0, ScreenLayout.PLAY_Y, this.render);
    this.desktopEntity.addEntity(this.gameAreaEntity);
    this.gameInfoEntity = new GameInfoEntity(this.desktopEntity, 0, ScreenLayout.PANEL_Y, this.render);
    this.desktopEntity.addEntity(this.gameInfoEntity);
    this.gameInfoEntity.setPanel({lives: this.app.lives, time: this.app.time,
                                  alchiems: this.app.alchiems, mode: 'man'});
    return true;
  } // initScreen

  /**
   * Milníkový výpis nahoře na obrazovce. Není to součást hry a zmizí, až bude
   * panel říkat všechno, co říká panel originálu (M5).
   * @param {Object} data - Zpráva `frame` z workeru.
   * @returns {string} Řádek textu.
   */
  readOut(data) {
    var mole = data.mole || {};
    var text = (this.app.sandbox ? 'PHYSICS SANDBOX - ' : '')
      +'V.'+data.edition+'K - ROOM '+data.room+' - '+data.charlie.state.toUpperCase()
      +' X'+data.charlie.x+' Y'+data.charlie.y;
    if (mole.digging) {
      text += ' - MOLE EATS '+String(mole.digging).toUpperCase()+' WALL '+mole.digLeft;
    } else if (mole.visible) {
      text += ' - MOLE X'+mole.x+' Y'+mole.y;
    } else if (mole.caught) {
      text += ' - MOLE READY';
    }
    return text;
  } // readOut

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state to the worker when it changed.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'room':
        // Hrací ploška, jak ji složil worker: nová místnost, nebo tatáž
        // s vyřezaným průchodem po prokousané stěně.
        this.app.roomNumber = data.room;
        this.app.setWorldState(data.dugWalls);
        if (this.render) {
          this.render.setRoom({width: 256, height: 168, number: data.room,
                               bitmap: Uint8Array.from(data.bitmap),
                               attributes: Uint8Array.from(data.attributes)});
        }
        break;
      case 'frame':
        this.fps.workerFrames++;
        // ★ R-045: a tiky světa zvlášť, odečtené z čítače ve zprávě
        if (this.fps.lastFrame !== false) { this.fps.ticks += data.frame-this.fps.lastFrame; }
        this.fps.lastFrame = data.frame;
        this.app.time = data.time;
        this.app.lives = data.lives;
        this.app.alchiems = data.alchiems;
        this.app.roomNumber = data.room;
        if (data.mole && data.mole.mode !== this.moleMode) {
          // ★ M6: s režimem se mění celé dotykové rozvržení
          this.moleMode = data.mole.mode;
          this.retouchControls();
          this.showTouchIcons();
        }
        // Žraní stěny mění jen ten průchod – 2 buňky široko, 6 vysoko.
        if (data.dig && this.render) {
          this.render.setGapPixels(data.dig.side, data.dig.bytes);
        }
        if (this.gameAreaEntity) {
          this.gameAreaEntity.setFrame({charlie: data.charlie, mole: data.mole,
                                        monsters: data.monsters});
        }
        if (this.gameInfoEntity) {
          this.gameInfoEntity.setPanel({lives: data.lives, time: data.time,
                                        alchiems: data.alchiems,
                                        mode: this.moleMode});
        }
        if (this.stateEntity) {
          this.stateEntity.setText(this.readOut(data));
        }
        if (this.app.audioManager
            && ((data.sounds && data.sounds.length) || (data.buzz && data.buzz.length))) {
          this.app.audioManager.playFrame(data);
        }
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.time = data.time;
          this.app.setModel('GameOverModel');
        }
        break;
    }
  } // handleWorkerMessage

  /**
   * Maps a key, gamepad or mouse event onto a control action.
   *
   * The original is played on half rows of keys whose meaning depends on the
   * mode (ZADANI chap. 1): the bottom row halves walk or dig sideways,
   * Q W E R is up (jump / dig up), A S D F is down (gravity stick / dig down)
   * and 1 2 3 4 switches astronaut and mole. The defaults are one key out of
   * each half row; the arrow keys are always accepted as well, and everything
   * can be remapped from SETTINGS.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard, mouse = this.app.controls.mouse;
    var mouseOk = (k) => mouse.enable && this.app.inputEventsManager.keysMap[k] === false;
    switch (key) {
      case kb.left: case 'ArrowLeft': case 'GamepadLeft': return 'left';
      case kb.right: case 'ArrowRight': case 'GamepadRight': return 'right';
      case kb.up: case 'ArrowUp': case 'GamepadJump': return 'up';
      case kb.down: case 'ArrowDown': case 'GamepadDown': return 'down';
      case kb.mode: case 'GamepadFire': return 'mode';
      case mouse.left: return mouseOk(mouse.left) ? 'left' : false;
      case mouse.right: return mouseOk(mouse.right) ? 'right' : false;
      case mouse.up: return mouseOk(mouse.up) ? 'up' : false;
    }
    return false;
  } // controlAction

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'exitGame':
        this.app.setModel('MenuModel');
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          // The game pauses on Escape. The original pauses on ENTER (ZADANI
          // chap. 1), but ENTER is a key the game itself can be played with,
          // so the remake leaves the pause to Escape alone.
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            // obnovení doteků po návratu do okna; obousměrná páčka jich drží víc
            [].concat(event.action).forEach((action) => {
              if (action !== false) { this.setControl(action, true); }
            });
            return true;
          case this.app.controls.keyboard.sounds:
            this.app.muted.sounds = !this.app.muted.sounds;
            this.sendEvent(0, {id: 'muteAudioBus', bus: 'sounds', muted: this.app.muted.sounds});
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        // svision pouští všechny dotyky naráz (sendEventsActiveKeys('Release'),
        // třeba při odchodu z obrazovky) – bez tohohle by ovládání zůstalo držet
        if (releasedKey == 'RetryTouch') {
          [].concat(event.action).forEach((action) => {
            if (action !== false) { this.setControl(action, false); }
          });
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, 40, 153, 85, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  // ---------------------------------------------------------------- M6 dotyk

  /**
   * Co dělá tahle polovina obrazovky **v tomhle režimu**
   * (`controlsOptions.touchscreen.halves`). Astronaut a krtek mají každý svoje
   * rozvržení a přepíná se spolu s režimem, protože krtek kope do čtyř směrů,
   * kdežto astronaut chodí do dvou a skáče.
   * @param {string} side - 'left' nebo 'right'.
   * @returns {Object} {icon, zones}
   */
  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    var half = ts.types[this.app.controls.touchscreen.type][side].half;
    return ts.halves[half][this.moleMode] || ts.halves[half].man;
  } // touchHalf

  /**
   * Ikony do okraje: co která polovina obrazovky v tomhle režimu dělá. Border
   * je nakreslí jen tam, kde je na ně místo mimo hrací plochu.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  /**
   * Zóna rozvržení pod prstem. `rect` je zlomek poloviny, takže se počítá
   * z toho, kde prst na té polovině je, ne z pixelů.
   * @param {Object} event - Událost doteku (x, y).
   * @param {string} side - 'left' nebo 'right'.
   * @param {Object} entity - Polovina obrazovky (borderEntity).
   * @returns {Object|false} Zóna, nebo false, když prst nesedí na žádné.
   */
  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  /**
   * Nový dotek na polovině obrazovky. Doteků může být víc naráz: každý si drží
   * svůj záznam v `touchesGameControls` a stav ovládání je jejich součet, takže
   * jde chodit a skákat zároveň (a krtkovi kopat do rohu).
   * @param {Object} event - Událost doteku.
   * @param {string} side - 'left' nebo 'right'.
   * @param {Object} entity - Polovina obrazovky.
   * @param {boolean} [resume] - Prst na obrazovce už ležel a jen se pod ním
   *        vyměnilo rozvržení; tlačítko se pak nezmáčkne samo.
   */
  touchStart(event, side, entity, resume) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    // Tlačítko drží akci od chvíle, kdy na něj prst dosedne; páčka nedělá nic,
    // dokud se prst nepohne – ťuknutí do ní tedy nikam nepošle.
    if (zone !== false && zone.type == 'button' && !resume) {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  /**
   * Prst se zvedl. ★ **Krátký stisk se musí podržet**: worker čte ovládání
   * jednou za průchod hlavní smyčkou (50,08 Hz), takže ťuknutí kratší než jeden
   * průchod by hru vůbec nedošlo – a zrovna přepnutí režimu a položení
   * gravity sticku se ťukají. Akce se proto pustí až po `tapHoldTime`.
   * @param {Object} event - Událost doteku.
   */
  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  /**
   * Pustí akci, ale jen když ji nedrží ještě nějaký jiný prst – dva prsty na
   * téže akci se nesmí přebít.
   * @param {string} action - Akce ovládání.
   */
  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * Prst se posunul. Páčka je **absolutní**: směr je dán tím, kam se prst
   * posunul od místa, kde dosedl, a s mrtvou zónou `joystickStep` uprostřed.
   * Krtek kope do čtyř směrů a musí jít **jeden z nich pustit** a druhý držet
   * dál – to přírůstková páčka (ta z M1, u které směr platil, dokud prst
   * nešel na druhou stranu) neumí, a mít v každém režimu jinou by pod týmž
   * palcem bylo horší než změnit obě.
   * @param {Object} event - Událost doteku.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (control.control == 'horizontal' || control.control == 'both') {
      if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
      if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    }
    if (control.control == 'vertical' || control.control == 'both') {
      if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
      if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    }
    // Obousměrná páčka drží dvě akce naráz – krtek se posune o 4 px v každém
    // drženém směru (`$A124`, maska `$5B0B & $0F`), takže i šikmo.
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  /**
   * ★ Přepnutí režimu **mění rozvržení pod prsty, které na obrazovce zrovna
   * leží**. Držené akce se proto pustí a každý dotek se znovu přiřadí – už
   * podle rozvržení toho druhého režimu. Tlačítka se přitom nezmáčknou sama:
   * prst, kterým hráč zrovna přepnul režim, leží na přepínači i po přepnutí
   * a nesmí přepnout hned zpátky.
   */
  retouchControls() {
    var controls = this.app.inputEventsManager.touchesGameControls;
    Object.keys(controls).forEach((identifier) => {
      var control = controls[identifier];
      var at = control.at, origin = control.origin;
      delete controls[identifier];
      if (control.action !== false) {
        [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
      }
      if (!control.entity) {
        return;
      }
      var event = {identifier: identifier, x: at.x, y: at.y};
      this.touchStart(event, control.side, control.entity, true);
      if (controls[identifier].type == 'joystick') {
        // Páčka si nechá střed z doteku, který na obrazovce leží dál: kam prst
        // ukazuje, platí i po přepnutí režimu – kdo šel s astronautem doprava,
        // kope s krtkem doprava a nemusí prst nikam přetahovat.
        controls[identifier].origin = origin;
        this.touchMove(event);
      }
    });
  } // retouchControls

  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.fpsEntity.setText(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.updateFps(timestamp);
    this.drawModel();
  } // loopModel

} // RoomModel
