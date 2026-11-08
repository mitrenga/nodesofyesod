const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { SpriteTool } = await import('./svision/js/spriteTool.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The ZX Spectrum border: the optional exit (X) button, the two halves used by
 * the touch controls, the developer-mode banner — and the loading stripes.
 *
 * The stripe animation is the tape one (pilot tone, data, and the screech of
 * a broken load), driven by TapeLoadingModel. Whether Nodes of Yesod itself
 * uses the border as an effect during play is still open (ZADANI chap. 8) —
 * the captured snapshot has it black; if it turns out the game moves it, M7
 * adds it here.
 */
export class BorderEntity extends AbstractEntity {

  constructor(enableExit, enableGameControls) {
    super(null, 0, 0, 0, 0, false, false);
    this.id = 'BorderEntity';

    this.enableExit = enableExit;
    this.enableGameControls = enableGameControls;

    this.diff = 0;
    this.animation = false;
    this.stripes = [];
    this.style = {
      pilotTone: {colors: ['cyan', 'red'], stripeHeight: 10},
      dataTone: {colors: ['blue', 'yellow'], stripeHeight: 3},
      screech: {colors: ['white', 'yellow', 'cyan', 'green', 'magenta', 'red', 'blue', 'black'], stripeHeight: 1}
    };

    this.escapeEntity = null;
    this.escapeScale = 2;

    this.leftControlEntity = null;
    this.rightControlEntity = null;
    // M6: ikona toho, co která polovina obrazovky zrovna dělá. Kreslí se
    // **jen do okraje**, ne přes hrací plochu, a mění se s režimem – je to
    // to jediné, na čem je přepnutí astronaut/krtek na dotyku vidět.
    this.leftIconEntity = null;
    this.rightIconEntity = null;
    this.gameControlIcons = false;
    this.devModeNameEntity = null;
  } // constructor

  init() {
    super.init();

    if (this.enableExit) {
      if (this.app.layout.ratio > 2) {
        this.escapeScale = 1;
      }
      this.escapeEntity = new ButtonEntity(this, this.app.fonts.zxFonts8x8Mono, 0, 0, this.escapeScale*8, this.escapeScale*8, 'X', {id: 'keyPress', key: 'Escape'}, [], false, false, {scale: this.escapeScale, clickColor: '#7a7a7aff'});
      this.addEntity(this.escapeEntity);
    }

    if (this.enableGameControls) {
      this.leftControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.leftControlEntity);
      this.rightControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.rightControlEntity);

      this.leftIconEntity = new SpriteEntity(this, 0, 0, ZXColor.white, false, 0, 0);
      this.leftIconEntity.hide = true;
      this.addEntity(this.leftIconEntity);
      this.rightIconEntity = new SpriteEntity(this, 0, 0, ZXColor.white, false, 0, 0);
      this.rightIconEntity.hide = true;
      this.addEntity(this.rightIconEntity);
    }

    if (this.app.devModeName !== false) {
      this.devModeNameEntity = new TextEntity(this, this.app.fonts.fonts5x5, 0, -7, 100, 7, '', false, false, {margin: 1});
      var cfgLen = this.app.devModeName.indexOf('}');
      this.devModeNameEntity.setText(this.app.devModeName.substring(cfgLen+1));
      var cfg = null;
      try {
        cfg = JSON.parse(this.app.devModeName.substring(1, cfgLen+1));
        Object.keys(cfg).forEach((item) => {
          this.devModeNameEntity[item] = cfg[item];
        });
      } catch (error) {
        console.error(error.message);
      }
      // no width in the configuration: the banner is as wide as its text (R-025)
      if (!cfg || !('width' in cfg)) {
        this.devModeNameEntity.width = this.devModeNameEntity.lineWidth(this.devModeNameEntity.text)+2;
      }
      this.addEntity(this.devModeNameEntity);
    }
  } // init

  /**
   * M6: nastaví ikony dotykového ovládání pro obě poloviny obrazovky.
   * @param {Object|false} left - Ikona levé poloviny (`controlsOptions.touchscreen.icons`).
   * @param {Object|false} right - Ikona pravé poloviny.
   */
  setGameControlIcons(left, right) {
    if (!this.enableGameControls) {
      return;
    }
    this.gameControlIcons = !!(left && right);
    [{entity: this.leftIconEntity, icon: left},
     {entity: this.rightIconEntity, icon: right}].forEach((item) => {
      if (item.icon) {
        item.entity.setGraphicsData('compressedSpriteData' in item.icon
                                    ? SpriteTool.decode(item.icon.compressedSpriteData)
                                    : item.icon);
      }
    });
    this.layoutGameControlIcons();
  } // setGameControlIcons

  /**
   * Uloží ikony do okraje: když je okraj po stranách dost široký (telefon na
   * šířku), jde každá ke své polovině; když je dost vysoký ten dolní (telefon
   * na výšku), jdou obě pod hrací plochu. Jinak se nekreslí – přes hru ne.
   */
  layoutGameControlIcons() {
    if (!this.enableGameControls || !this.leftIconEntity || this.model == null) {
      return;
    }
    var icons = [this.leftIconEntity, this.rightIconEntity];
    if (!this.gameControlIcons || icons.some((icon) => icon.width == 0)) {
      icons.forEach((icon) => { icon.hide = true; });
      return;
    }
    var margin = 2;
    var beside = Math.max(...icons.map((icon) => icon.width))+2*margin;
    var below = Math.max(...icons.map((icon) => icon.height))+2*margin;
    if (this.model.borderWidth >= beside) {
      // telefon na šířku: ke každé polovině její ikona, do postranního okraje
      icons.forEach((icon, i) => {
        icon.x = (i == 0 ? 0 : this.width-this.model.borderWidth)
                 +Math.floor((this.model.borderWidth-icon.width)/2);
        icon.y = Math.floor((this.height-icon.height)/2);
        icon.hide = false;
      });
    } else if (this.model.borderHeight >= below) {
      // telefon na výšku: obě do dolního okraje, každá nad svou polovinu
      var top = this.height-this.model.borderHeight;
      icons.forEach((icon, i) => {
        icon.x = Math.floor(this.width*(1+2*i)/4-icon.width/2);
        icon.y = top+Math.floor((this.model.borderHeight-icon.height)/2);
        icon.hide = false;
      });
    } else {
      // na okraj se nevejdou a přes hrací plochu se nekreslí
      icons.forEach((icon) => { icon.hide = true; });
    }
  } // layoutGameControlIcons

  drawEntity() {
    super.drawEntity();

    if (this.escapeEntity) {
      var penColor = ZXColor.brightWhite;
      if (this.animation !== false) {
        penColor = ZXColor.black;
      }
      switch (this.bkColor) {
        case ZXColor.white:
        case ZXColor.yellow:
        case ZXColor.cyan:
          penColor = ZXColor.black;
          break;
      }
      if (this.escapeEntity.penColor !== penColor) {
        this.escapeEntity.setPenColor(penColor);
      }
    }

    if (this.animation === false) {
      this.drawSubEntities();
      return;
    }

    var y = 0;
    var color = 0;
    if (this.animation == 'screech') {
      color = Math.floor(Math.random()*this.style[this.animation].colors.length);
    } else {
      color = Math.floor(this.diff/10);
    }
    if (this.stripes.length == 0) {
      while (y < this.height) {
        var stripeHeight = this.style[this.animation].stripeHeight;
        if ((y == 0) && (this.animation == 'pilotTone')) {
          stripeHeight = 10-this.diff%10;
        }
        var extraStripe = 0;
        if (this.animation == 'dataTone') {
          extraStripe = Math.round(Math.random()*stripeHeight);
        }
        if (this.animation == 'screech') {
          if (this.style[this.animation].colors[color] != 'black') {
            extraStripe = Math.round(Math.random()*6);
          }
        }
        if (y+stripeHeight+extraStripe > this.height) {
          stripeHeight = this.height-y-extraStripe;
        }
        this.stripes.push({y: y, height: stripeHeight+extraStripe, color: ZXColor[this.style[this.animation].colors[color]]});
        y += stripeHeight+extraStripe;
        if (this.animation == 'screech') {
          color = Math.floor(Math.random()*this.style[this.animation].colors.length);
        } else {
          color = Tool.cycleInc(color, 0, this.style[this.animation].colors.length-1);
        }
      }
    }
    for (var s = 0; s < this.stripes.length; s++) {
      this.app.layout.paintRect(this.app.stack.ctx, 0, this.stripes[s].y, this.width, this.stripes[s].height, this.stripes[s].color);
    }
    this.drawSubEntities();
  } // drawEntity

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'setBorderAnimation':
        this.animation = event.value;
        if (this.animation === 'pilotTone' || this.animation === 'screech') {
          this.sendEvent(0, 50, {id: 'moveStripes'});
        }
        return true;
      case 'moveStripes':
        this.stripes = [];
        if (this.animation !== false) {
          if (this.animation == 'screech') {
            this.diff = Math.floor(Math.random()*this.style[this.animation].colors.length*10);
          } else {
            this.diff = Tool.cycleInc(this.diff, 0, this.style[this.animation].colors.length*10-1);
          }
          this.sendEvent(0, 50, {id: 'moveStripes'});
        }
        return true;
      case 'resizeModel':
        if (this.escapeEntity) {
          if (this.model.borderHeight < this.escapeScale*8) {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width;
            this.escapeEntity.y = this.model.borderHeight;
          } else {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width-this.escapeScale*8;
            this.escapeEntity.y = this.model.borderHeight-this.escapeScale*8;
          }
        }
        
        if (this.enableGameControls) {
          var w = Math.floor(this.width/2);

          this.leftControlEntity.x = 0;
          this.leftControlEntity.y = 0;
          this.leftControlEntity.width = w;
          this.leftControlEntity.height = this.height;

          this.rightControlEntity.x = this.width-w;
          this.rightControlEntity.y = 0;
          this.rightControlEntity.width = w;
          this.rightControlEntity.height = this.height;

          this.layoutGameControlIcons();
        }

        if (this.devModeNameEntity) {
          this.devModeNameEntity.x = Math.floor((this.width-this.devModeNameEntity.width)/2);
          this.devModeNameEntity.y = Math.max(Math.floor((this.app.model.borderHeight-this.devModeNameEntity.height)/2), 0);
        }
        break;
    }

    return false;
  } // handleEvent

} // BorderEntity
