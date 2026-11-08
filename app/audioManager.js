const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioWorkletHandler } = await import('./svision/js/audio/audioWorkletHandler.js?ver='+window.srcVersion);
const { AudioScriptProcessorHandler } = await import('./svision/js/audio/audioScriptProcessorHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { Beeper } = await import('./beeper.js?ver='+window.srcVersion);
const { ZXMachineSounds } = await import('./svision/js/platform/canvas2D/zx/zxMachineSounds.js?ver='+window.srcVersion);
// begin code

/**
 * Audio manager. The 48K original has a one-bit beeper on bit 4 of port $FE and
 * no sound chip, so every sound is a stream of pulse lengths played by the
 * svision pulse handlers — the same way the machine makes sound, not sampled.
 *
 * ★ M7 filled it: the pulse lengths come out of the sound routines of the
 * original (`app/beeper.js` + `data/sound.json`, `tools/dumpsound.py`), and
 * `tools/matchsound.js` compares them against recordings of the original
 * T state by T state — 243 runs, 191 073 pulses, zero differences.
 *
 * Two buses, because the original has two things going at once:
 *
 *   `sounds`  what the game plays whole — the sweeps interrupt slot 1 runs by
 *             itself (an alchiem taken, a monster killed, a mugger stealing,
 *             the monolith), the fanfare of a mugger caught, the man/mole beep,
 *             the title and end tunes and the digitised speech;
 *   `extra`   the buzz of interrupt slot 2, which is a few pulses **per frame**
 *             (the mole chewing a wall, a laid gravity stick, a monster of type
 *             three). Those are collected over a handful of frames and played
 *             as one wave, which is what the speaker does with them anyway.
 *
 * There is deliberately no MUSIC bus: the 48K edition has no music while the
 * game runs (M7 read the whole sound block of the original; the only tunes are
 * the title screen and the last screen), and an empty slider would be a lie.
 * The AY score of Fred Gray belongs to the 128K edition (ZADANI chap. 0).
 */
export class AudioManager extends AbstractAudioManager {

  /** How many worker frames of the buzz are collected before it is played. */
  static get BUZZ_FRAMES() { return 6; }

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 5)))));
    this.beeper = null;
    this.soundData = false;
    this.buzz = [];
    this.trains = {};
  } // constructor

  /**
   * The beeper, made on first use out of the data appData put in localStorage.
   * @returns {Object|boolean} The Beeper, or false when the data is not there.
   */
  loadBeeper() {
    if (this.beeper !== null) {
      return this.beeper;
    }
    this.beeper = false;
    try {
      // through the model: a file its loadDataFiles() had to get from the
      // server is there, not in localStorage (R-062)
      var model = this.app.model;
      var data = model && model.loadDataFile ? model.loadDataFile('sound') : JSON.parse(localStorage.getItem(window.appPrefix+'.sound'));
      if (data) {
        this.soundData = data;
        var beeper = new Beeper(this.soundData);
        if (beeper.ready) { this.beeper = beeper; }
      }
    } catch (error) {
      console.error(error.message);
    }
    return this.beeper;
  } // loadBeeper

  createAudioHandler(bus, options) {
    var audioHandler = false;

    var volume = 0.0;
    switch (bus) {
      case 'sounds':
      case 'extra':
        volume = this.volumeLevel(this.volume.sounds);
        break;
    }

    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }

    if (this.unsupportedAudioBus == false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }

    switch (this.unsupportedAudioBus) {
      case false:
        audioHandler = new AudioWorkletHandler(this.app);
        break;
      case 'AudioWorkletHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioWorkletHandler');
        audioHandler = new AudioScriptProcessorHandler(this.app);
        break;
      case 'AudioScriptProcessorHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioScriptProcessorHandler');
        audioHandler = new AudioSilentHandler(this.app);
        break;
    }

    if (bus in this.restartSounds) {
      this.app.model.sendEvent(1, {id: 'playSound', bus: bus, sound: this.restartSounds[bus].sound, options: this.restartSounds[bus].options});
    }

    return audioHandler;
  } // createAudioHandler

  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }

    var sampleRate = this.getSampleRate();
    var sounds = this.volumeLevel(this.volume.sounds);
    switch (sound) {
      case 'tapePilotToneSound': return ZXMachineSounds.tapePilotTone(sampleRate, sounds);
      case 'tapeRndDataSound': return ZXMachineSounds.tapeRndData(sampleRate, sounds);
      case 'basicBeepsSound': return ZXMachineSounds.basicBeeps(sampleRate, sounds);
      case 'keyboardSound': return ZXMachineSounds.keyClick(sampleRate, sounds);
      // the SOUNDS dialog sets the level by the game's own man/mole beep
      // ($A2E5) — a sound of Nodes of Yesod, not of the machine
      case 'chirpSound': return this.namedTrain('modeChange', sampleRate, sounds);
      case 'titleTuneSound': return this.tuneData('title', sampleRate, sounds);
      case 'endTuneSound': return this.tuneData('end', sampleRate, sounds);
      case 'speechSound': return this.speechData(sampleRate, sounds);
      case 'gameSound': return this.trainData(options, sampleRate, sounds);
      case 'buzzSound': return this.trainData(options, sampleRate, sounds);
    }
    return false;
  } // audioData

  /** One of the game's own effects, by the name the worker uses. */
  namedTrain(name, sampleRate, volume) {
    var beeper = this.loadBeeper();
    if (!beeper) { return ZXMachineSounds.keyClick(sampleRate, volume); }
    return Beeper.toPulses(beeper.train({sound: name}), sampleRate, volume) || false;
  } // namedTrain

  /** A tune of the original, made once and kept — it is a long train. */
  tuneData(name, sampleRate, volume) {
    var beeper = this.loadBeeper();
    if (!beeper) { return false; }
    var key = 'tune:'+name;
    if (!(key in this.trains)) { this.trains[key] = beeper.tuneTrain(name); }
    return Beeper.toPulses(this.trains[key], sampleRate, volume);
  } // tuneData

  /** ★ The digitised speech of the intro, out of the original's own bytes. */
  speechData(sampleRate, volume) {
    var beeper = this.loadBeeper();
    if (!beeper) { return false; }
    if (!('speech' in this.trains)) { this.trains.speech = beeper.speechTrain(); }
    return Beeper.toPulses(this.trains.speech, sampleRate, volume);
  } // speechData

  /** A train prepared by playFrame(), handed over through the play options. */
  trainData(options, sampleRate, volume) {
    if (!options || !options.train) { return false; }
    return Beeper.toPulses(options.train, sampleRate, volume);
  } // trainData

  /**
   * How long one of the named sounds lasts, in milliseconds — the title screen
   * needs it to know when the "welcome" has finished and the tune starts.
   * @param {string} name - 'speech', 'title' or 'end'.
   * @returns {number} Milliseconds, 0 when the sound is not available.
   */
  soundDuration(name) {
    var beeper = this.loadBeeper();
    if (!beeper) { return 0; }
    var key = (name === 'speech') ? 'speech' : 'tune:'+name;
    if (!(key in this.trains)) {
      this.trains[key] = (name === 'speech') ? beeper.speechTrain()
                                             : beeper.tuneTrain(name);
    }
    return Beeper.duration(this.trains[key]);
  } // soundDuration

  /** Whether the game can be heard at all — the menu asks before it offers. */
  get hasGameSounds() {
    return this.loadBeeper() !== false;
  } // hasGameSounds

  /**
   * One worker frame: what the game did in it, as sound.
   *
   * The one-shot sounds are played whole, right away — the sweep of slot 1 is
   * decided the moment the game writes the byte, so there is nothing to wait
   * for. The buzz of slot 2 is a few pulses per frame, so it is collected and
   * played in handfuls; the worker sends it already silenced for the frames in
   * which slot 1 has the speaker (`$9C84`), so nothing is decided here that
   * the game does not decide there.
   * @param {Object} frame - The 'frame' message from the worker.
   */
  playFrame(frame) {
    var beeper = this.loadBeeper();
    if (!beeper) { return; }
    if (frame.sounds && frame.sounds.length) {
      for (var i = 0; i < frame.sounds.length; i++) {
        var train = beeper.train(frame.sounds[i]);
        if (train) {
          this.playSound('sounds', 'gameSound', {train: train});
          break;                    // one speaker, one sound at a time
        }
      }
    }
    if (frame.buzz && frame.buzz.length) {
      this.buzz = this.buzz.concat(frame.buzz);
    }
    if (this.buzz.length >= AudioManager.BUZZ_FRAMES) {
      var values = this.buzz;
      this.buzz = [];
      var buzz = beeper.slot2Train(values);
      if (buzz && buzz.pulses.length) {
        this.playSound('extra', 'buzzSound', {train: buzz});
      }
    }
  } // playFrame

  /** A new game starts with nothing left over in the buzz. */
  resetBeeper() {
    this.buzz = [];
  } // resetBeeper

  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

} // AudioManager
