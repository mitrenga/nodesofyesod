// begin code

/**
 * The beeper of the original — M7, the 48K edition.
 *
 * The machine has one bit of sound (bit 4 of port $FE) and nothing else
 * (ZADANI chap. 1), so a sound *is* a list of pulse lengths. Nothing here is
 * modelled by ear or tuned by hand: `data/sound.json` holds the constants of
 * the original as **operands of verified instructions**, the note table and the
 * six tunes as **bytes of the original**, and the cost of every sound loop as
 * **T states measured in the simulator** (`tools/dumpsound.py`). This class is
 * the same loops written out in JavaScript, and `tools/matchsound.js` runs it
 * against fresh recordings of the original and insists on zero differences.
 *
 * What the original has (`sources/docs/disasm_notes.md` §13):
 *
 *   tone     $873C  two counters of nearly equal period beating against each
 *                   other — the note table is 48 periods at $614C
 *   tune     $8726  a list of notes; seven parts on the title screen, one on
 *                   the last screen. There is **no in-game music** in 48K
 *   slot 1   $9C81  a sweep the ULA interrupt plays on its own: a divider that
 *                   grows by a step every frame until it wraps to zero
 *   slot 2   $9C9B  one frame of six pulses, pitch straight from the game
 *   fanfare  $83BA  192 half-waves, the divider counting down — mugger caught
 *   mode     $A2E5  100 half-waves of one pitch — man/mole switch
 *   speech   $E200  ★ 4246 bytes of a one-bit sample, one bit per sample at
 *                   11 111 Hz: the "welcome" of the intro. It **is** in memory
 *
 * Two pitches of the original cannot be reproduced and are not hidden: the mole
 * chewing a wall and the flight at the end take their pitch from the Z80
 * refresh register (`LD A,R`), which no browser has. The worker draws a random
 * byte for them and says so, exactly as it does for the other twelve places
 * where the original reads `R` (M4, M5).
 *
 * Deliberately free of DOM and Node dependencies, so `tools/matchsound.js`
 * can check the shipped code against the original.
 */
export class Beeper {

  /** T states of a ZX Spectrum second — the clock the pulse lengths are in */
  static get CLOCK() { return 3500000; }

  /**
   * @param {Object} sound - The parsed data/sound.json.
   */
  constructor(sound) {
    this.data = sound || null;
    this.k = (sound && sound.constants) || {};
    this.t = (sound && sound.timing) || {};
    this.periods = (sound && sound.periods && sound.periods.values) || [];
  } // constructor

  /** Whether the data needed to make a sound is there at all. */
  get ready() {
    return this.periods.length > 0;
  } // ready

  // ------------------------------------------------------------------ tone

  /**
   * One note of the tone routine `$873C`, pass by pass of its loop `$876E`.
   *
   * The loop turns the speaker over whenever one of its two counters wraps —
   * B every `period` passes, C every `period-1` — so the note is not one
   * frequency but two beating against each other. When both wrap in the same
   * pass they cancel and nothing is heard, which is why this is counted out
   * rather than computed.
   * @param {number} note - The note byte: bits 0-5 pitch, bits 6-7 length.
   * @param {number} [unit] - The length unit ($8767); the teleport changes it.
   * @returns {Object} {toggles, time} in T states from the entry of the loop.
   */
  toneLoop(note, unit) {
    var tone = this.t.tone;
    var step = (unit === undefined) ? this.k.durationUnit : unit;
    var period = this.periods[note & this.k.noteMask];
    var count = ((note & this.k.durationMask) >> 6)+1;
    var passes = (((step*count) & 0xFF)*256)+this.k.durationLow;
    return Beeper.countLoop(tone, period, passes);
  } // toneLoop

  /**
   * The loop of `$876E` counted out pass by pass.
   *
   * ★ The first write to the port of every note is a **zero** (`$876E XOR A`),
   * so when the note before left the speaker up, the note starts by pulling it
   * down — a turn that belongs to the sound and would be missing if notes were
   * simply strung together. That is what `firstOut` is for.
   * @param {Object} tone - The measured costs of one pass.
   * @param {number} period - The counter period (0 = a rest).
   * @param {number} passes - How many passes the length counter allows.
   * @returns {Object} {toggles, time, firstOut}.
   */
  static countLoop(tone, period, passes) {
    var b = period;
    var c = (period-1) & 0xFF;
    var time = 0;
    var first = 0;
    var toggles = [];
    for (var i = 0; i < passes; i++) {
      var cost = tone.base;
      var flip = 0;
      b = (b-1) & 0xFF;
      if (b === 0) { cost += tone.reloadB; b = period; flip ^= 1; }
      c = (c-1) & 0xFF;
      if (c === 0) { cost += tone.reloadC; c = (period-1) & 0xFF; flip ^= 1; }
      time += cost;
      if (i === 0) { first = time; }
      if (flip && period) { toggles.push(time); }
    }
    return {toggles: toggles, time: time, firstOut: first};
  } // countLoop

  /**
   * How long the whole tone routine takes, loop and all — the tune player
   * needs it to know where the next note starts.
   * @param {number} note - The note byte.
   * @param {number} [unit] - The length unit.
   * @returns {number} T states.
   */
  toneTime(note, unit) {
    var over = this.t.toneOverhead;
    var count = ((note & this.k.durationMask) >> 6)+1;
    var silent = !this.periods[note & this.k.noteMask];
    return this.toneLoop(note, unit).time
         + (silent ? over.overheadRest : over.overheadNote)
         + over.prologueUnit*(count-1);
  } // toneTime

  /**
   * A single note as a pulse train.
   * @param {number} note - The note byte.
   * @param {number} [unit] - The length unit.
   * @returns {Object} {pulses, startLevel}.
   */
  toneTrain(note, unit) {
    return Beeper.togglesToTrain(this.toneLoop(note, unit).toggles);
  } // toneTrain

  // ------------------------------------------------------------------ tunes

  /**
   * A whole tune of the original, the parts one after another.
   *
   * The gap between two notes is the real one: the tone routine's own run-up
   * and run-down plus what the player `$8726` spends reading the keyboard
   * between notes — all of it measured, so the tune does not drift.
   * @param {string} name - 'title' or 'end'.
   * @returns {Object|boolean} {pulses, startLevel} or false.
   */
  tuneTrain(name) {
    if (!this.data || !this.data.tuneLists || !(name in this.data.tuneLists)) {
      return false;
    }
    var over = this.t.tuneOverhead;
    var unit = this.k.durationUnit;
    var at = over.entry;
    var toggles = [];
    var parts = this.data.tuneLists[name].parts;
    var level = 0;
    for (var p = 0; p < parts.length; p++) {
      var end = this.tunePart(parts[p], at, toggles, level);
      at = end.at;
      level = end.level;
    }
    return Beeper.togglesToTrain(toggles);
  } // tuneTrain

  /**
   * One part of a tune, the notes appended to `toggles` from time `at`.
   * @param {number} address - Address of the part in the original.
   * @param {number} at - Where the part starts, in T states.
   * @param {Array} toggles - Toggle times to append to.
   * @returns {number} Where the part ends, in T states.
   */
  tunePart(address, at, toggles, level) {
    var tune = this.data.tunes['$'+Beeper.hex(address)];
    if (!tune) { return {at: at, level: level}; }
    var over = this.t.tuneOverhead;
    var lead = this.t.toneOverhead;
    var unit = this.k.durationUnit;
    var up = level ? 1 : 0;
    for (var n = 0; n < tune.notes.length; n++) {
      var note = tune.notes[n];
      var loop = this.toneLoop(note, unit);
      var start = at+this.tonePrologue(note)
                + lead.prologueUnit*((note & this.k.durationMask) >> 6);
      // první zápis noty je nula: když předchozí nota nechala reproduktor
      // nahoře, stáhne ho, a to je přepnutí, které do vlny patří
      if (up) { toggles.push(start+loop.firstOut); }
      for (var i = 0; i < loop.toggles.length; i++) {
        toggles.push(start+loop.toggles[i]);
      }
      up = loop.toggles.length & 1;
      at += this.toneTime(note, unit)+over.perNote;
    }
    return {at: at, level: up};
  } // tunePart

  /**
   * The run-up of the tone routine to the first write to the port.
   *
   * A rest is one T state quicker than a note: the branch at `$874B` that
   * decides whether the speaker is to move at all is taken for a note and
   * falls through for a rest. It is the same one T state by which the whole
   * routine is quicker (`overheadRest`), which is why it is taken from there
   * and not guessed.
   * @param {number} note - The note byte.
   * @returns {number} T states.
   */
  tonePrologue(note) {
    var over = this.t.toneOverhead;
    var silent = !this.periods[note & this.k.noteMask];
    return over.prologue-(silent ? over.overheadNote-over.overheadRest : 0);
  } // tonePrologue

  /**
   * One part of a tune on its own — that is the unit `tools/matchsound.js`
   * compares against the original, because `$8726` plays one part per call.
   * @param {number} address - Address of the part.
   * @returns {Object} {pulses, startLevel}.
   */
  tunePartTrain(address) {
    var toggles = [];
    this.tunePart(address, this.t.tuneOverhead.entry, toggles, 0);
    return Beeper.togglesToTrain(toggles);
  } // tunePartTrain

  // ----------------------------------------------------------- fixed loops

  /**
   * The loop of `$A2E5` and `$83BA`: half-waves of `divider*slope + offset`.
   * @param {number} divider - The delay counter (0 means 256).
   * @param {number} count - How many half-waves.
   * @returns {Array} Pulse lengths in T states.
   */
  fixedPulses(divider, count) {
    var fixed = this.t.fixed;
    var length = fixed.slope*(divider || 256)+fixed.offset;
    var pulses = [];
    for (var i = 1; i < count; i++) { pulses.push(length); }
    return pulses;
  } // fixedPulses

  /** The man/mole switch: 100 half-waves of one pitch (`$A2E5`). */
  modeTrain() {
    return {pulses: this.fixedPulses(this.k.modeDelay, this.k.modeCount),
            startLevel: 1};
  } // modeTrain

  /**
   * The mugger caught (`$83BA`): the divider counts down from $C0 to 1, so the
   * pitch runs up. The game plays it inside the step, so it takes the game
   * with it — 86 ms of standing still.
   * @returns {Object} {pulses, startLevel}.
   */
  fanfareTrain() {
    var fixed = this.t.fixed;
    var pulses = [];
    for (var b = this.k.fanfareStart-1; b > 0; b--) {
      pulses.push(fixed.slope*b+fixed.offset);
    }
    return {pulses: pulses, startLevel: 1};
  } // fanfareTrain

  /**
   * The teleport (`$841E`): 255 tones played with the short length unit, the
   * period counting down from $FF, so the pitch climbs the whole way.
   * @returns {Object} {pulses, startLevel}.
   */
  teleportTrain() {
    var over = this.t.toneOverhead;
    var unit = this.k.teleportUnit;
    var at = 0;
    var up = 0;
    var toggles = [];
    for (var period = 0xFF; period > 0; period--) {
      var loop = this.rawToneLoop(period, unit);
      if (up) { toggles.push(at+over.prologue+loop.firstOut); }
      for (var i = 0; i < loop.toggles.length; i++) {
        toggles.push(at+over.prologue+loop.toggles[i]);
      }
      up = loop.toggles.length & 1;
      at += loop.time+over.overheadNote;
    }
    return Beeper.togglesToTrain(toggles);
  } // teleportTrain

  /**
   * The tone loop entered at `$8747`, where A is already the period — that is
   * how the teleport plays pitches the note table does not have.
   * @param {number} period - The counter period.
   * @param {number} unit - The length unit.
   * @returns {Object} {toggles, time}.
   */
  rawToneLoop(period, unit) {
    return Beeper.countLoop(this.t.tone, period,
                            (((unit*1) & 0xFF)*256)+this.k.durationLow);
  } // rawToneLoop

  // -------------------------------------------------- the interrupt slots

  /**
   * Slot 1 (`$9C81`): the sweep the ULA interrupt plays by itself.
   *
   * Starting it means writing one byte into both the value and the step, so
   * the divider goes value, 2*value, 3*value … and the sound stops by itself
   * when it wraps to zero. Ten half-waves per frame and silence for the rest
   * of it, which is why this is a train with long pulses in it, not a tone.
   * @param {number} value - The byte the game wrote ($8 alchiem, $10 kill, …).
   * @param {number} [step] - The step, which the game always sets to the same.
   * @returns {Object} {pulses, startLevel}.
   */
  slot1Train(value, step) {
    var frame = this.t.frame;
    var increment = (step === undefined) ? value : step;
    var divider = value & 0xFF;
    var pulses = [];
    var guard = 0;
    while (divider !== 0 && guard++ < 512) {
      divider = (divider+increment) & 0xFF;
      var one = this.slot1Frame(divider);
      for (var i = 0; i < one.length; i++) { pulses.push(one[i]); }
      var gap = frame-this.slot1Span(divider);
      if (divider !== 0 && gap > 0) { pulses.push(gap); }
    }
    return {pulses: pulses, startLevel: 1};
  } // slot1Train

  /**
   * One pass of slot 1 through the interrupt, the zero check and all.
   * @param {number} value - The stored value at the start of the frame.
   * @param {number} [step] - The step the game wrote next to it.
   * @returns {Object} {pulses, value} — the pulses and the new stored value.
   */
  slot1Pass(value, step) {
    // $9C81: nulova hodnota znamena, ze zvuk skoncil – tenhle snimek uz mlci
    if (!(value & 0xFF)) { return {pulses: [], value: 0}; }
    var divider = (value+((step === undefined) ? value : step)) & 0xFF;
    return {pulses: this.slot1Frame(divider), value: divider};
  } // slot1Pass

  /**
   * One frame of slot 1: ten half-waves of one pitch (`$9C8F`).
   * @param {number} divider - The delay counter (0 means 256).
   * @returns {Array} Pulse lengths in T states.
   */
  slot1Frame(divider) {
    var slot = this.t.slot1;
    var length = slot.slope*((divider & 0xFF) || 256)+slot.offset;
    var pulses = [];
    for (var i = 1; i < this.k.slot1Cycles; i++) { pulses.push(length); }
    return pulses;
  } // slot1Frame

  /** How much of a frame the ten half-waves of slot 1 take up. */
  slot1Span(divider) {
    var slot = this.t.slot1;
    return (this.k.slot1Cycles-1)*(slot.slope*((divider & 0xFF) || 256)+slot.offset);
  } // slot1Span

  /**
   * Slot 2 (`$9C9B`): one frame of six writes to the port, the pitch coming
   * straight out of the game (the gravity stick's counter, the death count,
   * a monster's y — or the refresh register, which is a noise).
   *
   * The first write is a zero, so on the first frame nothing is heard from it;
   * over several frames it is the turn that makes the buzz. `level` says what
   * the speaker was doing when the frame started, so a run of frames joins up
   * the way it does in the machine.
   * @param {number} value - The pitch byte the game wrote (0 means 256).
   * @param {number} [level] - Speaker level at the start of the frame.
   * @returns {Object} {pulses, startLevel, level}.
   */
  slot2Frame(value, level) {
    var slot = this.t.slot2;
    // $9C9B: nula znamena, ze slot nic nehraje – ne delitel 256
    if (!(value & 0xFF)) { return {toggles: [], time: 0, level: level ? 1 : 0}; }
    var length = slot.slope*(value & 0xFF)+slot.offset;
    var at = level ? 1 : 0;
    var out = 0;
    var toggles = [];
    var time = 0;
    for (var i = 0; i < this.k.slot2Cycles; i++) {
      time += length;
      if (out !== at) { at = out; toggles.push(time); }
      out ^= 1;
    }
    return {toggles: toggles, time: time, level: at};
  } // slot2Frame

  /**
   * A run of frames of slot 2 as one train — that is what the mole chewing a
   * wall or a laid gravity stick sounds like.
   * @param {Array} values - The pitch byte of each frame, in order.
   * @returns {Object} {pulses, startLevel}.
   */
  slot2Train(values) {
    var frame = this.t.frame;
    var level = 0;
    var at = 0;
    var toggles = [];
    for (var f = 0; f < values.length; f++) {
      var one = this.slot2Frame(values[f], level);
      for (var i = 0; i < one.toggles.length; i++) {
        toggles.push(at+one.toggles[i]);
      }
      level = one.level;
      at += frame;
    }
    return Beeper.togglesToTrain(toggles);
  } // slot2Train

  // ----------------------------------------------------------------- speech

  /**
   * ★ The digitised speech of the intro (`$E200`).
   *
   * One bit per sample at 11 111 Hz, 4246 bytes, 3.1 seconds — played back out
   * of **the same bytes** as the original, not re-recorded (ZADANI chap. 6).
   * Runs of equal bits become one long pulse, which is the same thing the
   * speaker does.
   * @returns {Object|boolean} {pulses, startLevel} or false when the sample is
   *          not in the data.
   */
  speechTrain() {
    var speech = this.data && this.data.speech;
    if (!speech || !speech.bytes || !speech.bytes.length) { return false; }
    var period = speech.bitPeriod;
    var extra = speech.byteExtra;
    var bits = this.k.speechBits;
    var level = 0;
    var time = 0;
    var toggles = [];
    for (var i = 0; i < speech.bytes.length; i++) {
      var byte = speech.bytes[i];
      for (var bit = 0; bit < bits; bit++) {
        time += period;
        var value = (byte >> (bits-1-bit)) & 1;
        if (value !== level) { level = value; toggles.push(time); }
        // co stojí přechod na další bajt vzorku, se platí až za posledním bitem
        if (bit === bits-1) { time += extra; }
      }
    }
    return Beeper.togglesToTrain(toggles);
  } // speechTrain

  // ------------------------------------------------------------- dispatch

  /**
   * The train of one thing the worker reported.
   *
   * The worker sends the name and, where the original takes the pitch out of
   * the game, the byte it took (`app/WORKER-PROTOCOL.md`) — nothing is decided
   * here that the game decides there.
   * @param {Object} item - {sound, value, values} from the worker.
   * @returns {Object|boolean} {name, pulses, startLevel} or false for silence.
   */
  train(item) {
    if (!this.ready || !item) { return false; }
    var name = item.sound || item;
    var train = false;
    switch (name) {
      case 'alchiemTaken':
      case 'monsterDeath':
      case 'alchiemStolen':
      case 'monolith':
        train = this.slot1Train(item.value);
        break;
      case 'muggerCaught':
        train = this.fanfareTrain();
        break;
      case 'modeChange':
        train = this.modeTrain();
        break;
      case 'teleport':
        train = this.teleportTrain();
        break;
      case 'buzz':
        train = this.slot2Train(item.values || []);
        break;
      case 'speech':
        train = this.speechTrain();
        break;
    }
    if (!train || !train.pulses.length) { return false; }
    train.name = name;
    return train;
  } // train

  // ------------------------------------------------------------ conversion

  /**
   * Turns absolute toggle times into the pulse lengths between them.
   * @param {Array} toggles - Toggle times in T states.
   * @returns {Object} {pulses, startLevel}.
   */
  static togglesToTrain(toggles) {
    var pulses = [];
    for (var i = 1; i < toggles.length; i++) {
      pulses.push(toggles[i]-toggles[i-1]);
    }
    return {pulses: pulses, startLevel: 1};
  } // togglesToTrain

  /**
   * A train as the svision pulse handlers want it.
   *
   * The lengths are rounded on a running sum rather than one by one, so a
   * sound is never longer or shorter than the original by the accumulated
   * rounding of a thousand pulses. Equal lengths share a fragment, which for
   * a tune or the speech is the difference between a few hundred numbers and
   * tens of thousands.
   * @param {Object} train - What train() returned.
   * @param {number} sampleRate - The audio context sample rate.
   * @param {number} volume - Bus volume level.
   * @returns {Object|boolean} {fragments, pulses, volume} or false.
   */
  static toPulses(train, sampleRate, volume) {
    if (!train || !train.pulses || !train.pulses.length) { return false; }
    var fragments = [];
    var index = {};
    var pulses = [];
    var elapsed = 0;
    var written = 0;
    for (var i = 0; i < train.pulses.length; i++) {
      elapsed += train.pulses[i];
      var target = Math.round(elapsed*sampleRate/Beeper.CLOCK);
      var length = target-written;
      if (length < 1) { length = 1; }
      written += length;
      if (!(length in index)) {
        index[length] = fragments.length;
        fragments.push(length);
      }
      pulses.push(index[length]);
    }
    return {fragments: fragments, pulses: pulses, volume: volume};
  } // toPulses

  /**
   * How long a train lasts, in milliseconds.
   * @param {Object} train - What train() returned.
   * @returns {number} Milliseconds.
   */
  static duration(train) {
    if (!train || !train.pulses) { return 0; }
    var total = 0;
    for (var i = 0; i < train.pulses.length; i++) { total += train.pulses[i]; }
    return 1000*total/Beeper.CLOCK;
  } // duration

  /** Four hex digits of an address, the way data/sound.json keys the tunes. */
  static hex(value) {
    var text = value.toString(16).toUpperCase();
    while (text.length < 4) { text = '0'+text; }
    return text;
  } // hex

} // Beeper
