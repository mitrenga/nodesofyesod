const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * The room: 256x168 pixels above the panel, character rows 0-20
 * (sources/docs/screen_layout.md). ScreenComposer composes the frame into the
 * entity's video memory — the same DOM-free module an offline tool uses — and
 * the library turns the bytes into pixels once per game frame (R-003).
 *
 * Bit 7 of the play area's attributes is the original's collision map, not
 * FLASH; it is masked off here, where the original masks it (`AND $7F` at
 * $8891), so the composed room keeps it for the physics.
 *
 * Feed it with setFrame() from the worker 'frame' message (WORKER-PROTOCOL.md).
 */
export class GameAreaEntity extends ZXVideoRAMEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent entity.
   * @param {number} x - X position relative to the parent.
   * @param {number} y - Y position relative to the parent.
   * @param {ScreenComposer} render - The shared renderer.
   */
  constructor(parentEntity, x, y, render) {
    super(parentEntity, x, y, {row: 0, rows: ScreenLayout.PLAY_ROWS});
    this.id = 'GameAreaEntity';

    this.render = render;
    this.frameState = {};
    this.setAttrMask(ScreenComposer.ATTR_MASK);
  } // constructor

  /**
   * Stores the state of the newest frame and invalidates the cache.
   * @param {Object} state - {charlie, mole, monsters} as sent by the worker.
   */
  setFrame(state) {
    this.frameState = state;
    this.invalidate();
  } // setFrame

  /**
   * Composes the room with the frame's entities into the video memory;
   * ZXVideoRAMEntity calls it only when the cache is dirty.
   */
  compose() {
    this.render.composeInto(this.videoRAM, this.frameState);
  } // compose

} // GameAreaEntity
