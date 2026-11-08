#!/bin/sh
# Ze snapshotu (nebo z kazety, kdyby se objevila) udělá obrazy RAM, se kterými pracuje
# celý projekt. Potřebuje sources/tape/*.z80 – binárky do gitu nepatří, viz
# sources/tape/README.md – a vendorovaný SkoolKit v tools/vendor.
#
#   ./tools/mksnapshot.sh              # 48K (primární edice)
#   ./tools/mksnapshot.sh 128k         # 128K edice (jen doklad rozdílů, ZADANI.md §0)
#   ./tools/mksnapshot.sh "sources/tape/nodes.tzx"   # z kazety, až kdyby byla
#
# Výstup:
#   build/nodesofyesod-48k.z80   snapshot, se kterým se trasuje (playtrace/memtrace)
#   build/nodesofyesod-48k.bin   surová RAM $4000-$FFFF (49152 B) pro noydis.py a dumpery
#   build/loading_screen.scr     obrazovka ze snapshotu + kontrola proti sources/media
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SK="$ROOT/tools/vendor"

case "${1:-48k}" in
    48k)  EDITION=48k;  SRC="$ROOT/sources/tape/Nodes_of_Yesod_48K.z80" ;;
    128k) EDITION=128k; SRC="$ROOT/sources/tape/Nodes_of_Yesod_128K.z80" ;;
    *)    EDITION=48k;  SRC="$1" ;;
esac
mkdir -p "$ROOT/build"

case "$SRC" in
    *.tzx|*.tap)
        # Cesta z kazety. Odinův loader není prozkoumaný (kazetu se sehnat nepodařilo),
        # takže akcelerátor se nechává na automatice a když to nepůjde, je to první práce M0.
        [ -f "$SRC" ] || { echo "chybi $SRC – viz sources/tape/README.md"; exit 1; }
        echo "kazeta $SRC -> snapshot (tap2sna.py, simulovana nahravka)"
        PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
            "$SRC" "$ROOT/build/nodesofyesod-$EDITION.z80"
        ;;
    *)
        [ -f "$SRC" ] || { echo "chybi $SRC – viz sources/tape/README.md"; exit 1; }
        cp "$SRC" "$ROOT/build/nodesofyesod-$EDITION.z80"
        ;;
esac

PYTHONPATH="$SK:$ROOT/tools" python3 - "$ROOT" "$EDITION" <<'PY'
import sys, hashlib, os
from skoolkit.snapshot import Snapshot
from scr2png import scr_to_rgb, write_png

root, edition = sys.argv[1], sys.argv[2]
snap = Snapshot.get('%s/build/nodesofyesod-%s.z80' % (root, edition))
print('snapshot: %s, PC=$%04X, border=%s' % (snap.machine, snap.pc, snap.border))

scr = bytes(bytearray(snap.memory[0x4000:0x5B00]))
open('%s/build/loading_screen.scr' % root, 'wb').write(scr)
write_png('%s/build/loading_screen.png' % root, scr_to_rgb(scr), 256)

ref = '%s/sources/media/screens/loading_screen.scr' % root
if os.path.exists(ref):
    same = open(ref, 'rb').read() == scr
    print('obrazovka v snapshotu souhlasi s sources/media/screens/loading_screen.scr: %s' % same)

if snap.machine == '48K':
    ram = bytes(bytearray(snap.memory[0x4000:0x10000]))
    out = '%s/build/nodesofyesod-%s.bin' % (root, edition)
    open(out, 'wb').write(ram)
    nz = [i for i in range(0x1B00, len(ram)) if ram[i]]
    print('%s: %d B, sha1 %s' % (out, len(ram), hashlib.sha1(ram).hexdigest()))
    print('nenulova RAM nad obrazovkou: $%04X-$%04X' % (min(nz) + 0x4000, max(nz) + 0x4000))
else:
    print('128K: stránkovaná paměť, surový obraz $4000-$FFFF se nedělá')
PY
