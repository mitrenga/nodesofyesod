<?php
  $appName = 'NODES OF YESOD';
  $appDescription = 'Play NODES OF YESOD online for free in your browser. Faithful remake of the 1985 Odin Computer Graphics ZX Spectrum classic, no download required.';
  $appPrefix = 'noy';
  $appNoscript =
    '<h1>NODES OF YESOD</h1>'.
    '<p>Nodes of Yesod is the 1985 ZX Spectrum game by Odin Computer Graphics. Charlemagne '.
    '&quot;Charlie&quot; Fotheringham-Grunes lands on the Moon to trace mysterious signals to a black '.
    'monolith. Eight alchiems are hidden in 256 screens of caves below the surface, and the way '.
    'through them is dug by the moon mole: switch to it and it eats through the walls, while '.
    'Charlie stands still and defenceless.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Nodes of Yesod and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Action-adventure game',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Nodes of Yesod',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Odin Computer Graphics'],
      ],
      'datePublished' => '1985',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
