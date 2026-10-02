# offsets.py <ours.png> <ref.png> name:x0,y0,x1,y1 ... (boxes in pt): the best (dx, dy) shifting ours onto ref,
# searched at ±4 pt. How the mockups were calibrated against simulator shots: README.md.
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('L'), dtype=float)
b = np.asarray(Image.open(sys.argv[2]).convert('L'), dtype=float)
for spec in sys.argv[3:]:
    name, box = spec.split(':')
    x0, y0, x1, y1 = [int(float(v) * 3) for v in box.split(',')]
    ref = b[y0:y1, x0:x1]
    best = None
    for dy in range(-12, 13):
        for dx in range(-12, 13):
            win = a[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
            if win.shape != ref.shape: continue
            e = np.mean(np.abs(win - ref))
            if best is None or e < best[0]: best = (e, dx, dy)
    print(f'{name:14s} dx={best[1]/3:+.2f}pt dy={best[2]/3:+.2f}pt  err={best[0]:.1f}')
