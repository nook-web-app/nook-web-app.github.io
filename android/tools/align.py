# For each named box (css px on a 393 wide screen), finds how far the native render is shifted against the web one
# (in css px, device px / 2.75), by trying every shift up to 6 css px and keeping the one with the smallest difference.
# usage: python3 align.py web.png native.png "name:x0,y0,x1,y1" ...
import sys
from PIL import Image, ImageChops, ImageStat
b = Image.open(sys.argv[2]).convert('L'); a = Image.open(sys.argv[1]).convert('L').resize(b.size, Image.LANCZOS)
k = a.size[0] / 393
R = int(4 * k)
for spec in sys.argv[3:]:
    name, box = spec.split(':'); x0, y0, x1, y1 = [int(float(v) * k) for v in box.split(',')]
    ref = a.crop((x0, y0, x1, y1))
    best = None
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1, 1 if abs(dy) < 3 else 1):
            c = b.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy))
            s = ImageStat.Stat(ImageChops.difference(ref, c)).mean[0]
            if best is None or s < best[0]: best = (s, dx, dy)
    s, dx, dy = best
    base = ImageStat.Stat(ImageChops.difference(ref, b.crop((x0, y0, x1, y1)))).mean[0]
    print(f'{name:14} native is off by dx={dx / k:+5.1f} dy={dy / k:+5.1f} css px  (diff {base:4.1f} -> {s:4.1f})')
