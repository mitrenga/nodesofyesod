<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Nodes of Yesod and of this
 * remake. M2 text; the final content comes with M8.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1985)',
          'html' =>
            '<p>Nodes of Yesod was released by Odin Computer Graphics in 1985 for the ZX Spectrum. '.
            'Charlemagne &quot;Charlie&quot; Fotheringham-Grunes, apprentice saviour of the universe, '.
            'lands on the Moon to trace mysterious signals to their source: a black monolith. Eight '.
            'alchiems are hidden in the caves below the surface — the box, Crash and the authors all '.
            'say 256 screens of them.</p>'.
            '<p>Its defining idea is that Charlie cannot dig. A moon mole comes up out of a hole on the '.
            'surface, he rides it down into the caves, and from then on a key switches control between '.
            'the two: the mole eats through walls and opens new parts of the maze, while Charlie stands '.
            'where he was left, unable to move and still able to be hurt. Muggers steal alchiems back '.
            'off him, whirlwinds throw him somewhere else, and gravity sticks knock the monsters down. '.
            'Crash 19 gave it 91% and singled out the graphics at 96%.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated. The '.
            'graphics and the world are taken out of the original program, not redrawn, and the rules '.
            'come from the original instructions and from the disassembly of the game — where a rule '.
            'cannot be shown, it is left as an open question rather than guessed. Even the frame rate '.
            'is the Spectrum\'s own 50.08 Hz, and the attribute clash of the hardware is reproduced '.
            'instead of cleaned up.</p>'.
            '<p>It is being built in milestones and this is an early one: the screen, the panel and the '.
            'shell of the application are here, and the panel is already assembled from the game\'s own '.
            'tile table, byte for byte identical to captured frames of the running original. Charlie\'s '.
            'physics, the mole and the world itself are still to come.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard, '.
            'touch controls and gamepads are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Nodes of Yesod at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/entry/3447/ZX-Spectrum/Nodes_of_Yesod'],
        ['label' => 'Nodes of Yesod at World of Spectrum', 'url' => 'https://worldofspectrum.org/archive/software/games/nodes-of-yesod-odin-computer-graphics-ltd'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Odin Computer Graphics). '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
