<?php

class DataCommand {

  // Vsechna data hry jdou v jedne zadosti pri startu aplikace a klient si je
  // ulozi do localStorage pod svymi klici - tak to dela MM i JSW. Modely pak
  // ctou jen z localStorage a offline se nic neprepisuje (data/README.md).
  //
  // M7: zvuk 48K edice (sound) - konstanty zvukovych rutin, tabulka period,
  //     sest melodii a digitalizovana rec (4246 B vzorku z $E23E)
  // M5: nepratele, alchiemy a muggeri (monsters) - konstanty, popisy sesti
  //     typu, tabulka 94 poletujicich objektu a bajty jejich skriptu
  // M4: krtek a stav sveta (mole) a titulni obrazovka 128K edice (title128) -
  //     lisi se od 48K jen copyrightem, ale volba edice v menu ji ma cim
  //     ukazat (ZADANI par. 0)
  // M3: fyzika Charlieho (physics) - skripty a konstanty
  // M2: mrizka sveta (world), sady dlazdic (scenery), mistnosti (rooms)
  //     a tabulka spritu (spriteframes)
  var $files = ['global', 'font', 'panel', 'loading', 'title', 'title128', 'world', 'scenery', 'rooms', 'spriteframes', 'physics', 'mole', 'monsters', 'sound'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        // optional data files (those a later milestone adds) arrive as null
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $data = $mysqli->query('SELECT `score` FROM `rg_noy_hallOfFame` ORDER BY `score` DESC LIMIT 1');
    $mysqli->close();
    $result['hiScore'] = 0;
    if ($row = $data->fetch_object()) {
      $result['hiScore'] = $row->score;
    }

    return $result;
  } // execute

} // class DataCommand
