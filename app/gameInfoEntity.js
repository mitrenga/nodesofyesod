const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * The panel: character rows 21-23 at the **bottom** of the screen — the
 * astronaut figure, the eight ALCHIEMS slots, LIFE with the oscilloscope and
 * the number of lives, and the TIME clock (screen_layout.md chap. 3).
 *
 * ★ **M4**: that figure on the left is not decoration — it is the **man/mole
 * indicator**, and the display list has a second 3 x 3 block for it that M1
 * found but could not place ($8273 draws the man, $A0DD the mole).
 *
 * It is not drawn character by character: the original keeps the panel as a
 * tile table at $73E6 and a display list at $7387 that says which tile goes
 * where, and this is that list replayed (data/panel.json, tools/mkpanel.py).
 * tools/matchpanel.py checks the result against captured frames of the running
 * game byte for byte — zero differences on all three.
 *
 * The cache is rebuilt only when a value changes.
 */
export class GameInfoEntity extends ZXVideoRAMEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent entity.
   * @param {number} x - X position relative to the parent.
   * @param {number} y - Y position relative to the parent.
   * @param {ScreenComposer} render - The shared renderer.
   */
  constructor(parentEntity, x, y, render) {
    super(parentEntity, x, y, {row: ScreenLayout.PLAY_ROWS, rows: ScreenLayout.PANEL_ROWS});
    this.id = 'GameInfoEntity';

    this.render = render;
    // `mode` je ikona **člověk / krtek** v levém dolním rohu panelu, kterou
    // hra přepisuje při přepnutí ($8273 / $A0DD, M4).
    this.panel = {lives: 0, time: 0, alchiems: 0, mode: 'man'};
  } // constructor

  /**
   * Updates the panel values, repainting only when something changed.
   * @param {Object} panel - {lives, time, alchiems, mode}.
   */
  setPanel(panel) {
    var changed = false;
    Object.keys(this.panel).forEach((key) => {
      if (key in panel && panel[key] !== this.panel[key]) {
        this.panel[key] = panel[key];
        changed = true;
      }
    });
    if (changed) {
      this.invalidate();
    }
  } // setPanel

  /**
   * Composes the panel into the video memory; ZXVideoRAMEntity calls it only
   * when the cache is dirty.
   */
  compose() {
    this.render.composePanelInto(this.videoRAM, this.panel);
  } // compose

} // GameInfoEntity
