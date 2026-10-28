# Shows the same strip of the web screenshot and the native render one above the other, enlarged, with a grid every 10 css px.
# usage: python3 zoom.py web.png native.png out.png x0 y0 x1 y1   (css px)
import sys
from PIL import Image, ImageDraw
w, n, out = sys.argv[1:4]; x0, y0, x1, y1 = map(float, sys.argv[4:8])
Z = 4
ims = []
for p in (w, n):
    im = Image.open(p).convert('RGB'); k = im.size[0] / 393
    c = im.crop((int(x0 * k), int(y0 * k), int(x1 * k), int(y1 * k))).resize((int((x1 - x0) * Z), int((y1 - y0) * Z)), Image.NEAREST)
    d = ImageDraw.Draw(c)
    for gx in range(int(x0) // 10 * 10, int(x1) + 1, 10):
        X = (gx - x0) * Z; d.line([(X, 0), (X, c.size[1])], fill=(255, 0, 255) if gx % 50 == 0 else (90, 0, 90))
    for gy in range(int(y0) // 10 * 10, int(y1) + 1, 10):
        Y = (gy - y0) * Z; d.line([(0, Y), (c.size[0], Y)], fill=(255, 0, 255) if gy % 50 == 0 else (90, 0, 90))
    ims.append(c)
s = Image.new('RGB', (ims[0].size[0], ims[0].size[1] * 2 + 6), (255, 255, 0))
s.paste(ims[0], (0, 0)); s.paste(ims[1], (0, ims[0].size[1] + 6)); s.save(out)
