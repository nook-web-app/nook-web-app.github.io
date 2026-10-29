// Compares the native GIF encoder with the web app's: runs gifEncode() of app.js on the frames GifTest.kt uses and checks
// the bytes against app/build/gif-out.bin.   usage: node tools/gifcheck.js   (after the unit tests ran)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");
const pick = name => { const i = src.indexOf(name); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
const code = "const LZT = new Int32Array(1048576);\n" + ["function lzw", "function medianCut", "async function gifEncode"].map(pick).join("\n") + "\nmodule.exports = gifEncode;";
const m = { exports: {} };
new Function("module", "Blob", "setTimeout", code)(m, class { constructor(p) { this.p = p; } }, f => f());
(async () => {
  const fr = [0, 1, 2].map(f => { const a = new Uint8ClampedArray(40 * 30 * 4); for (let p = 0; p < 1200; p++) { const x = p % 40, y = (p / 40) | 0; a[p * 4] = (x * 6 + f * 40) & 255; a[p * 4 + 1] = (y * 8) & 255; a[p * 4 + 2] = (x * y + f * 17) & 255; a[p * 4 + 3] = 255; } return a; });
  const blob = await m.exports(fr, 40, 30, 12);
  const web = Buffer.concat(blob.p.map(u => Buffer.from(u)));
  const nat = fs.readFileSync(path.join(__dirname, "..", "app", "build", "gif-out.bin"));
  if (Buffer.compare(web, nat) !== 0) { console.log("DIFFERENT", web.length, nat.length); process.exit(1); }
  console.log("same bytes", web.length);
  // and a browser opens it
  const { chromium } = require("playwright");
  const b = await chromium.launch(), pg = await b.newPage();
  const wh = await pg.evaluate(async u => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, "data:image/gif;base64," + nat.toString("base64"));
  await b.close();
  console.log("decodes", wh.join("x"));
  if (wh[0] !== 40 || wh[1] !== 30) process.exit(1);
})();
