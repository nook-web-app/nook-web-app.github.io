# Compares the web screenshot with the native render of the same page.
# Writes web | native | overlay (web in red, native in cyan: where they line up the overlay is gray, where they do not
# the edges show red or cyan fringes) and prints how much of the screen differs.
# usage: python3 pixdiff.py <web dir> <native dir> <out dir> [names...]
import sys, os
from PIL import Image, ImageChops
web, nat, out = sys.argv[1:4]
names = sys.argv[4:] or sorted(n[:-4] for n in os.listdir(web) if n.endswith('.png') and n[0].isdigit())
os.makedirs(out, exist_ok=True)
pre = 'io.github.nookwebapp.native_ui_Shots_pages_'
for n in names:
    wp, np_ = os.path.join(web, n + '.png'), os.path.join(nat, pre + n + '.png')
    if not (os.path.exists(wp) and os.path.exists(np_)): print(f'{n:22} missing'); continue
    a = Image.open(wp).convert('L'); b = Image.open(np_).convert('L')
    if b.size != a.size: b = b.resize(a.size)
    d = ImageChops.difference(a, b).point(lambda v: 255 if v > 48 else 0)
    share = sum(d.histogram()[255:]) / (a.size[0] * a.size[1]) * 100
    ov = Image.merge('RGB', (a, b, b))
    W = 393; H = int(a.size[1] * W / a.size[0])
    sheet = Image.new('RGB', (W * 3 + 16, H), (255, 0, 255))
    for i, im in enumerate([Image.open(wp).convert('RGB'), Image.open(np_).convert('RGB'), ov]):
        sheet.paste(im.resize((W, H)), (i * (W + 8), 0))
    sheet.save(os.path.join(out, n + '.png'))
    print(f'{n:22} {share:5.2f}% of pixels differ')
