const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { ZXFonts8x8 } = await import('./svision/js/platform/canvas2D/zx/zxFonts8x8.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { ZXResetModel } = await import('./svision/js/platform/canvas2D/zx/zxResetModel.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { MainModel } = await import('./mainModel.js?ver='+window.srcVersion);
const { RoomModel } = await import('./roomModel.js?ver='+window.srcVersion);
const { RoomsMapModel } = await import('./roomsMapModel.js?ver='+window.srcVersion);
const { GameOverModel } = await import('./gameOverModel.js?ver='+window.srcVersion);
const { TapeLoadingModel } = await import('./tapeLoadingModel.js?ver='+window.srcVersion);
const { ZXErrorEntity } = await import('./svision/js/platform/canvas2D/zx/zxErrorEntity.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Nodes of Yesod application shell (M1 skeleton, built on the Underwurlde and
 * Jet Set Willy ones — the closest siblings: ZX games with rooms on
 * ZXPlatform).
 * LoadingModel -> MenuModel -> MainModel (title) -> RoomModel (the game) ->
 * GameOverModel, plus TapeLoadingModel and RoomsMapModel off the menu.
 *
 * The game state kept here is only what is measured: **three lives**, read off
 * the running original ($5B09, the default being the operand at $86CC), and
 * the clock the original's own panel keeps. There is deliberately **no score**:
 * the panel of the original has none and no scoring routine has been found yet
 * (ZADANI chap. 4), so the remake does not invent one.
 */
export class GameApp extends AbstractApp {

  /**
   * The two editions of the original. They differ **only in sound** — same map,
   * same graphics, same gameplay (ZADANI chap. 0) — so this is not a second
   * branch of the remake but a parameter: 48 is the beeper, 128 is the three
   * channels of the AY with the score of Fred Gray, the digitised speech and
   * the spoken warnings. **The sound itself is M7.**
   */
  static get EDITIONS() { return [48, 128]; }

  constructor(platform, importPath, wsURL, devModeName, appIconSprite) {
    super(platform, 'bodyApp', importPath, wsURL);

    // klasický worker: fyzika Charlieho je vlastní soubor (charliePhysics.js),
    // který si worker natáhne přes importScripts – tentýž kód ověřuje
    // tools/matchphysics.js. Klasický, ne modulový: {type:'module'} umí až
    // Chrome 80 / Safari 15, a starší televize (cílová Samsungka, Chromium ~47)
    // tu volbu ignorují a worker by jim spadl na top-level await v hlavičce.
    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model) {
        this.model.handleWorkerMessage(event);
      }
    };

    this.version = Version;
    this.copyright = '©␣2026␣Libor␣Mitrenga, CC␣BY⋅NC⋅SA';
    this.devModeName = devModeName;
    this.appIconSprite = appIconSprite;

    this.audioManager = new AudioManager(this);
    this.muted = {sounds: false};

    this.fonts = {
      zxFonts8x8Mono: new ZXFonts8x8(this, false),
      zxFonts8x8: new ZXFonts8x8(this, true),
      zxFonts8x8Keys: new ZXFonts8x8(this, false),
      fonts5x5: new Fonts5x5(this),
      fonts3x3: new Fonts3x3(this)
    };
    // ZX key-cap glyphs for the key-remap screen (ZXRemapKeysEntity)
    this.fonts.zxFonts8x8Keys.setFontsData('00000000000000000010101010001000002424000000000014147E28FC505000107C507C14547C1042A44810244A8400001028102A443A00000810000000000000182020202018000030080808083000000014083E081400000008083E0808000000000000080810000000003E00000000000000001818000204081020408000007C4C5454647C000018280808083E00007C440438407C00007C441804447C00001828487E081C00007C407C04447C00007C407C44447C00007C440810101000007C443844447C00007C44447C047C000000001000001000000010000010102000000408100804000000003E003E00000000100804081000007C441C100010003C42BD85BDA5BE78003C42427E42E70000FC427C4242FC00007E424040427E0000FE42424242FE0000FE42784042FE0000FE42784040E000007E42404E427E0000E7427E4242E700007C101010107C00007E08080848780000E648705844E60000E040404242FE0000C3665A4242E70000C762524A46E700007E424242427E0000FE42427E40E000007E424242527E0800FE42427E44E700007E407E02427E0000FE92101010380000CE444444447E0000E742424224180000D7929292926C0000EE44382844EE0000EE442810103800007E440810227E001C10101010101C0000004020100804003808080808083800001038541010100000000000000000FF003C247020207C0000007C047C447E00C0407C4444447C0000007C4440407C000C047C4444447E0000007C447C407C003C2470202020700000007C44447C047CC0407C444444E6001000701010107C000800380808084878C0404C506058CC007010101010107C000000FC545454D6000000FC444444E60000007C4444447C0000007E22223E207000007C44447C040600007C242020700000007C407C04FC0000207820202038000000CC4444447E000000CE44442838000000D65454547E000000C6281028C6000000CC44447C047C00007E4418227E00000E083008080E0000080808080808000070100C1010700000142800000000003C4299A1A199423C');
    // Extra glyphs + hard/short spaces live in the game (svision core fonts are ASCII + normal space).
    this.fonts.fonts5x5.addSpace('␣', {width: 2, breaking: false, stretch: true});

    this.fonts.zxFonts8x8.addGlyphs('⋅', '0000000030000000');
    this.fonts.zxFonts8x8.addSpace('␣', {width: 3, breaking: false, stretch: false});

    // The original is played on **half rows of keys**, and what they mean
    // depends on the mode (ZADANI chap. 1, instructions_transcript.md):
    // left/right are the two halves of the bottom row, Q W E R is up (a jump
    // as the astronaut, digging up as the mole), A S D F is down (dropping a
    // gravity stick as the astronaut, digging down as the mole), and the top
    // row 1 2 3 4 switches between astronaut and mole. So the remake has four
    // directions and a mode key, not six actions — see WORKER-PROTOCOL.md.
    // Those letters are the defaults; the arrow keys always work as well and
    // everything can be remapped.
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'JUMP / MOLE UP'},
          {action: 'down', label: 'STICK / MOLE DOWN'},
          {action: 'mode', label: 'ASTRONAUT / MOLE'},
          {action: 'sounds', label: 'MUTE SOUNDS'}
        ]
      },
      mouse: {
        device: 'mouse',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'JUMP / MOLE UP'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'RIGHT', eventKey: 'GamepadRight'},
          {action: 'up', label: 'JUMP / MOLE UP', eventKey: 'GamepadJump'},
          {action: 'down', label: 'STICK / MOLE DOWN', eventKey: 'GamepadDown'},
          {action: 'mode', label: 'ASTRONAUT / MOLE', eventKey: 'GamepadFire'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      // ★ M6: **dvě sady ovládání, ne jedna.** Astronaut i krtek se v originálu
      // ovládají týmiž půlřádkami kláves, ale znamenají jimi něco jiného
      // (WORKER-PROTOCOL.md) – a na dotykové obrazovce to zamlčet nejde: krtek
      // kope do **čtyř** směrů, kdežto astronaut chodí do dvou a skáče. Proto
      // se rozvržení **přepíná spolu s režimem**: co která polovina obrazovky
      // dělá, říká `halves`, a v jakém režimu hra je, hlásí worker v každém
      // snímku (`mole.mode`, tatáž hodnota, ze které je ikona člověk/krtek
      // v panelu – `$8273`/`$A0DD`).
      //
      // `types` říká jen to, na které polovině je páčka a na které tlačítka,
      // tedy variantu **pro praváky a pro leváky**. Ikona u strany je ta, kterou
      // ukazuje SETTINGS (svision `zxSettingsEntity` kreslí jednu na stranu);
      // ikony obou režimů jsou u `halves` a kreslí je border.
      touchscreen: {
        device: 'touchscreen',
        types: {
          keys: [
            'rightAction',
            'leftAction'
          ],
          rightAction: {
            left: {half: 'stick', sprite: 'left-right'},
            right: {half: 'action', sprite: 'jump'}
          },
          leftAction: {
            left: {half: 'action', sprite: 'jump'},
            right: {half: 'stick', sprite: 'left-right'}
          }
        },
        // Co dělá která polovina v kterém režimu. `rect` je zlomek té poloviny
        // ([x, y, šířka, výška]), takže rozvržení nezávisí na tom, jak je zrovna
        // velká – a telefon na výšku i na šířku dostane totéž.
        //
        // ★ Přepínač režimu je v **obou** rozvrženích na témž místě (horní
        // vnitřní roh poloviny s tlačítky). Krtek se tak nedá shodit omylem:
        // kdyby jeho polovina byla přepínač celá, sesedl by po každém doteku.
        halves: {
          stick: {
            man: {
              icon: 'left-right',
              zones: [
                {rect: [0, 0, 1, 1], type: 'joystick', control: 'horizontal',
                 actions: {left: 'left', right: 'right'}}
              ]
            },
            mole: {
              icon: 'dig',
              zones: [
                // krtek se posouvá o 4 px ve **všech** směrech, které hráč drží
                // ($A124, maska $5B0B & $0F) – páčka je proto obousměrná
                {rect: [0, 0, 1, 1], type: 'joystick', control: 'both',
                 actions: {left: 'left', right: 'right', up: 'up', down: 'down'}}
              ]
            }
          },
          action: {
            man: {
              icon: 'jump',
              zones: [
                // skok se **drží** (je to `up`, celá řada Q W E R)
                {rect: [0, 0.4, 1, 0.6], type: 'button', action: 'up'},
                // ★ gravity stick je **krátký stisk**, a navíc jediný, který
                // musí přijít sám: `$7DF1` ho položí jen při vstupním bajtu
                // rovném $04, takže se stick nedá položit za chůze. To je
                // originál, ne omezení dotykového ovládání.
                {rect: [0, 0, 0.5, 0.4], type: 'button', action: 'down', tap: true},
                {rect: [0.5, 0, 0.5, 0.4], type: 'button', action: 'mode', tap: true}
              ]
            },
            mole: {
              icon: 'astronaut',
              zones: [
                // krtek kope páčkou, takže tady zbývá jediné: sesednout ($A141)
                {rect: [0.5, 0, 0.5, 0.4], type: 'button', action: 'mode', tap: true}
              ]
            }
          }
        },
        // Krátký stisk musí worker stihnout uvidět: ovládání čte jednou za
        // průchod hlavní smyčkou (50,08 Hz), takže sebekratší ťuknutí se drží
        // aspoň takhle dlouho.
        tapHoldTime: 120,
        // o kolik se musí prst posunout, než páčka změní směr
        joystickStep: 10,
        icons: {
          jump: {
            compressedSpriteData: 'lP101300N0A970111030Z0510122382012345617171859'
          },
          'left-right': {
            compressedSpriteData: 'lP101300N08B701050P020N06910121213421245641465421243121217'
          },
          // čtyři směry kopání
          dig: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          // ★ ikona astronauta je **z panelu originálu** (blok `$7387`
          // display listu, data/panel.json) – nic se nedokresluje
          astronaut: {
            compressedSpriteData: 'lP100K00G090301060409080702050123413561001710217311188174013115771131100113710110111110010110011811701213771012107111111711111781111370107171131813011012103110166'
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      mouse: this.getControls('mouse'),
      touchscreen: this.getControls('touchscreen'),
      gamepads: this.getControls('gamepads')
    };

    // Which edition the player picked in the menu (GameApp.EDITIONS). It is a
    // parameter of the game, not a setting: it is chosen when the game starts
    // and does not change while it runs.
    this.edition = GameApp.EDITIONS[0];
    // measured on the running original ($5B09, screen_layout.md chap. 3)
    this.lives = 3;
    this.time = 0;
    this.alchiems = 0;
    this.hiScore = false;
    // Which room the game is in, and the world state that changes while it
    // runs. The dug through walls live in a byte per room ($B600 bit 0 in the
    // original, sources/docs/disasm_notes.md chap. 8); they are state, not
    // room data, so the app carries them and RoomScenery is told about them.
    this.roomNumber = 0;
    this.dugWalls = null;
    // PHYSICS SANDBOX (M3): jedna místnost originálu, ve které jde vyzkoušet
    // chůzi, skok a pád. Od M4 už z ní jde i vyjít – přechody mezi místnostmi
    // fungují, takže sandbox je „hra od téhle místnosti", ne klec.
    this.sandbox = false;
    this.playerName = Tool.readCookie('playerName', '');
    this.globalData = false;
    this.id = 'GameApp';
    this.fetchDataId = '';
    this.setModel('LoadingModel');
    this.loadAppData();
  } // constructor

  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        // one representative key out of each half row the original reads:
        // Z of CAPS/Z/X/C/V, M of SPACE/SYMBOL SHIFT/M/N/B, Q of Q/W/E/R,
        // A of A/S/D/F and 1 of 1/2/3/4. Mute is O, a key the game does not use.
        result = {left: 'Z', right: 'M', up: 'Q', down: 'A', mode: '1',
                  sounds: 'O'};
        break;
      case 'mouse':
        result = {enable: false, left: 'Mouse1', right: 'Mouse2', up: 'Mouse4'};
        break;
      case 'touchscreen':
        // praváci drží telefon tak, že akce jsou pod pravým palcem
        result = {supported: false, type: 'rightAction'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'mouse':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  setModel(model) {
    if (model == 'MenuModel' && this.globalData === false) {
      // the fetch may still be pending or has failed: as a last resort try the
      // data cached in localStorage before bothering the user
      if (!this.loadGlobalDataFromStorage()) {
        this.showErrorMessage('Game data could not be loaded.', 'retry');
        return;
      }
    }
    var needResizeApp = false;
    var selectionItem = 0;
    if (this.model) {
      // Pořadí položek nabídky (app/menuModel.js): 0/1 START GAME 48K/128K,
      // 2 PLAYER NAME, 3 HALL OF FAME, 4 SOUNDS, 5 SETTINGS, 6 MAP,
      // 7 SANDBOX, 8 TAPE, 9 ABOUT. Vrací se na tu položku, ze které se šlo.
      if (this.model.id == 'TapeLoadingModel') {
        selectionItem = 8;
      }
      if (this.model.id == 'RoomsMapModel') {
        selectionItem = 6;
      }
      if (this.model.id == 'RoomModel' && this.sandbox) {
        selectionItem = 7;
      }
      // z hry (i přes konec hry) zpátky na tu edici, kterou hrál
      if ((this.model.id == 'RoomModel' && !this.sandbox)
          || this.model.id == 'GameOverModel' || this.model.id == 'MainModel') {
        selectionItem = GameApp.EDITIONS.indexOf(this.edition);
      }
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'LoadingModel':
        this.model = new ZXResetModel(this);
        break;
      case 'MenuModel':
        this.model = new MenuModel(this, selectionItem);
        break;
      case 'MainModel':
        this.model = new MainModel(this);
        break;
      case 'RoomModel':
        this.model = new RoomModel(this);
        break;
      case 'RoomsMapModel':
        this.model = new RoomsMapModel(this);
        break;
      case 'GameOverModel':
        this.model = new GameOverModel(this, 'MenuModel');
        break;
      case 'TapeLoadingModel':
        this.model = new TapeLoadingModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

  /**
   * Which edition the game runs as. Anything that is not one of
   * `GameApp.EDITIONS` is ignored, so a missing parameter keeps the current
   * choice (the path from the menu to the game goes through modal dialogs).
   * @param {number} [edition] - 48 or 128.
   * @returns {number} The edition in force.
   */
  setEdition(edition) {
    if (GameApp.EDITIONS.indexOf(edition) >= 0) {
      this.edition = edition;
    }
    return this.edition;
  } // setEdition

  /**
   * Which title screen the edition shows. The two are the same picture byte for
   * byte apart from the copyright line (1985 vs. 1986) — 231 bytes of bitmap
   * and one attribute, measured — so this is the one visible difference the
   * remake can already draw; the sound is M7.
   * @returns {string} The data file name without its extension.
   */
  titleDataFile() {
    return this.edition === 128 ? 'title128' : 'title';
  } // titleDataFile

  /**
   * Starts a new game in the initial room.
   * @param {number} [roomNumber] - Where to start, 0 to 255 (row*16+column).
   * @param {boolean} [sandbox] - PHYSICS SANDBOX (M3): one room, no game.
   * @param {number} [edition] - 48 or 128 (GameApp.EDITIONS); without it the
   *        edition picked in the menu stays.
   */
  startRoom(roomNumber, sandbox, edition) {
    this.setEdition(edition);
    this.sandbox = !!sandbox;
    this.time = 0;
    this.alchiems = 0;
    this.lives = (this.globalData && this.globalData.lives) || 3;
    this.roomNumber = (roomNumber === undefined || roomNumber === null)
                      ? ((this.globalData && this.globalData.initRoom) || 0)
                      : roomNumber;
    this.dugWalls = new Uint8Array(256);
    this.setModel('RoomModel');
  } // startRoom

  /**
   * Místnost pro PHYSICS SANDBOX: jeskyně, do které se v originálu propadne
   * hráč, který na povrchu půjde od začátku doprava (změřeno
   * `tools/physlog.py`, `sources/docs/disasm_notes.md` chap. 10). Není to
   * volba vzhledu – je to místnost, ve které se fyzika porovnávala.
   * @returns {number} The room number.
   */
  sandboxRoom() {
    return (this.globalData && this.globalData.sandboxRoom) || 23;
  } // sandboxRoom

  /**
   * The part of the world state a room needs to be drawn: whether its own
   * right wall and the right wall of its left hand neighbour have been dug
   * through. From M4 the bytes come from the worker (`setWorldState`), which is
   * where the mole writes them; the data model has had them since M2, which is
   * the whole point (MILNIKY.md, risk 4).
   * @param {number} [room] - The room number; the current one by default.
   * @returns {Object} {dugRight, dugLeft}.
   */
  /**
   * Perzistentní stav světa, jak ho hlásí worker (bajt na místnost, `$B600`).
   * Od M4 ho **vede worker** – tady se drží jen proto, aby ho měla mapa světa
   * a aby přežil odchod z herní obrazovky.
   * @param {Array|Uint8Array} bytes - 256 bajtů stavu.
   */
  setWorldState(bytes) {
    if (!bytes || bytes.length !== 256) {
      return;
    }
    if (!this.dugWalls || this.dugWalls.length !== 256) {
      this.dugWalls = new Uint8Array(256);
    }
    this.dugWalls.set(bytes);
  } // setWorldState

  roomState(room) {
    var number = (room === undefined) ? this.roomNumber : room;
    var columns = (this.globalData && this.globalData.world
                   && this.globalData.world.columns) || 16;
    var left = (number & ~(columns-1)) | ((number-1) & (columns-1));
    var dug = this.dugWalls || new Uint8Array(256);
    return {dugRight: !!(dug[number] & 1), dugLeft: !!(dug[left] & 1)};
  } // roomState

  applyGlobalData(global) {
    this.globalData = global;
    this.lives = global.lives || this.lives;
    if (typeof global.initRoom === 'number') {
      this.roomNumber = global.initRoom;
    }
  } // applyGlobalData

  setGlobalData(data) {
    this.applyGlobalData(data.data.global);

    var files = {};
    Object.keys(data.data).forEach((key) => {
      if (key == 'hiScore') {
        this.hiScore = data.data[key];
      } else if (key != 'global') {
        files[key] = data.data[key];
      }
    });
    // global goes last; a full localStorage is cleared and tried once more
    // (R-062)
    this.saveAppDataToStorage(files, data.data.global);
  } // setGlobalData

  // Load the application data: from the server when online (which also refreshes
  // localStorage), or rehydrate the global data from localStorage when offline.
  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 2000);
    } else {
      this.loadGlobalDataFromStorage();
    }
  } // loadAppData

  loadGlobalDataFromStorage() {
    var stored = localStorage.getItem(window.appPrefix+'.global');
    if (stored !== null) {
      try {
        this.applyGlobalData(JSON.parse(stored));
        return true;
      } catch (error) {
        console.error(error.message);
      }
    }
    return false;
  } // loadGlobalDataFromStorage

  setData(data) {
    this.setGlobalData(data);
  } // setData

  errorData(error) {
    // The network request failed (offline, unreachable server, or the fetch
    // timeout). Fall back to the data cached in localStorage; if none exists,
    // log it and let the MenuModel guard surface the error to the user.
    if (!this.loadGlobalDataFromStorage()) {
      console.error(error.message ? error.message : error);
      return;
    }
    if (this.model && this.model.id == 'ZXResetModel'
        && !this.model.events.some((queued) => queued.id == 'setMenuModel')
        && !this.model.desktopEntity.modalEntity) {
      this.setModel('MenuModel');
    }
  } // errorData

  showErrorMessage(message, action) {
    var topModalEntity = this.model.desktopEntity.topModalEntity();
    topModalEntity.addModalEntity(
      new ZXErrorEntity(
        topModalEntity,
        -topModalEntity.absoluteX(),
        -topModalEntity.absoluteY(),
        this.fonts.zxFonts8x8,
        message,
        action,
        ZXColor.white,
        ZXColor.red
      )
    );
  } // showErrorMessage

} // GameApp
