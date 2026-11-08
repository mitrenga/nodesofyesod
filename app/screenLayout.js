// begin code

/**
 * Geometry of the Nodes of Yesod screen, measured on the running original —
 * sources/docs/screen_layout.md (read out of the video RAM of captured frames,
 * not off a photograph).
 *
 * The screen is the plain ZX Spectrum one: 256x192 pixels, attributes in 8x8
 * cells. Unlike Underwurlde the panel is at the **bottom**: the top 21
 * character rows (256x168) are the room, the last three rows are the panel.
 * The period screenshot map confirms it independently — its cells are 168
 * pixels tall, so whoever made it cut off exactly three rows.
 */
export const ScreenLayout = {

  WIDTH: 256,
  HEIGHT: 192,

  CELL: 8,
  COLS: 32,
  ROWS: 24,

  // room: character rows 0-20, pixels y = 0..167
  PLAY_Y: 0,
  PLAY_ROWS: 21,
  PLAY_WIDTH: 256,
  PLAY_HEIGHT: 168,

  // panel: character rows 21-23, pixels y = 168..191
  PANEL_Y: 168,
  PANEL_ROW: 21,
  PANEL_ROWS: 3,
  PANEL_HEIGHT: 24,

  // The world grid measured on the period screenshot map (cells of 256 x 168
  // pixels, 1 pixel separators): 16 x 16 = 256 screens, which is also what the
  // inlay and Crash 19 say. The authority is still the room table of the
  // program itself — that is M2.
  WORLD_COLS: 16,
  WORLD_ROWS: 16,

  // 50.08 Hz — 69888 T states per frame on a 3.5 MHz Z80 (hw_notes.md).
  // The main loop was measured to run once per frame (disasm_notes.md).
  FRAME_RATE: 3500000/69888

}; // ScreenLayout
