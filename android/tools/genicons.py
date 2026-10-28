# turns the web app's icon set (the P object in app.js) into Kotlin data for the native app
import re, xml.etree.ElementTree as ET
src = open(__import__('os').path.join(__import__('os').path.dirname(__file__), '../../app.js')).read()
block = src[src.index('const P = {'):src.index('};', src.index('const P = {'))]
icons = re.findall(r"^\s*(\w+): '(.*)',?\s*$", block, re.M)
def num(v): return float(v)
def to_d(e):
    t = e.tag.split('}')[-1]; a = e.attrib
    if t == 'path': return a['d']
    if t == 'circle':
        cx, cy, r = num(a['cx']), num(a['cy']), num(a['r'])
        return f"M{cx-r} {cy}a{r} {r} 0 1 0 {2*r} 0a{r} {r} 0 1 0 {-2*r} 0z"
    if t == 'rect':
        x, y, w, h = num(a.get('x', 0)), num(a.get('y', 0)), num(a['width']), num(a['height']); rx = num(a.get('rx', 0))
        if not rx: return f"M{x} {y}h{w}v{h}h{-w}z"
        return (f"M{x+rx} {y}h{w-2*rx}a{rx} {rx} 0 0 1 {rx} {rx}v{h-2*rx}a{rx} {rx} 0 0 1 {-rx} {rx}"
                f"h{-(w-2*rx)}a{rx} {rx} 0 0 1 {-rx} {-rx}v{-(h-2*rx)}a{rx} {rx} 0 0 1 {rx} {-rx}z")
    raise Exception(t)
def el(e, sw):
    a = e.attrib
    w = float(a.get('stroke-width', sw))
    fill = a.get('fill') in ('currentColor', '#000')
    stroke = a.get('stroke') != 'none'
    return f'El("{to_d(e)}", {w}f, {str(fill).lower()}, {str(stroke).lower()})'
out = []
for name, frag in icons:
    root = ET.fromstring('<svg>' + frag + '</svg>')
    plain, masked, cut = [], [], None
    def walk(node, sw, into):
        for c in node:
            t = c.tag
            if t == 'defs':
                m = c.find('mask')
                shape = [x for x in m if not (x.tag == 'rect' and x.attrib.get('fill') == '#fff')][0]
                global cut
                cut = el(shape, 2)
                continue
            if t == 'g':
                w = float(c.attrib.get('stroke-width', sw))
                walk(c, w, masked if 'mask' in c.attrib else into)
                continue
            into.append(el(c, sw))
    cut = None
    walk(root, 2, plain)
    out.append(f'    "{name}" to Ic(listOf({", ".join(plain)}), listOf({", ".join(masked)}), {cut or "null"}),')
kt = '''package io.github.nookwebapp.native_ui

// generated from the icon set in the web app's app.js (24x24, stroke 2, round caps); do not edit by hand
val ICONS: Map<String, Ic> = mapOf(
''' + '\n'.join(out) + '\n)\n'
open(__import__('os').path.join(__import__('os').path.dirname(__file__), '../app/src/main/java/io/github/nookwebapp/native_ui/IconData.kt'), 'w').write(kt)
print(len(icons), 'icons')
