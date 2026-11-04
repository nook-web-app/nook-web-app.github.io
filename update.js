(function () {
  if (!("serviceWorker" in navigator) || location.protocol.indexOf("http") !== 0) return;
  const IDLE = 2 * 60 * 60 * 1000, LAST = "nook-last-used";
  let accepted = false, reg = null, asked = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (accepted) location.reload(); });
  const touch = () => { try { localStorage.setItem(LAST, String(Date.now())); } catch (e) {} };
  const notes = async () => {
    try {
      const t = await (await fetch("CLAUDE_READ_THIS.txt", { cache: "no-store", signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined })).text();
      const top = t.split(/^## /m)[1] || "";
      const ver = top.split("\n")[0].trim();
      const lines = top.split("\n").slice(1).map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
      return { ver: ver || null, lines };
    } catch (e) { return { ver: null, lines: [] }; }
  };
  // a version written like "3.0.8 !" in the notes file is required: it is applied at once and cannot be skipped
  // every update is applied quietly while the app is in the background, no question asked
  const kindOf = ver => {
    const forced = /!\s*$/.test(ver || "");
    return forced ? "required" : "patch";
  };
  const applyWhenHidden = w => {
    const go = () => { accepted = true; (reg && reg.waiting || w).postMessage("skip"); };
    if (document.visibilityState === "hidden") go();
    else document.addEventListener("visibilitychange", function f() { if (document.visibilityState === "hidden") { document.removeEventListener("visibilitychange", f); go(); } });
  };
  const ask = async (w, manual) => {
    if (asked || !w || !navigator.serviceWorker.controller) return;
    asked = true;
    const n = await notes();
    const kind = manual ? "ask" : kindOf(n.ver);
    if (kind === "patch") { asked = false; applyWhenHidden(w); return; }
    const forced = kind === "required";
    if (forced) applyWhenHidden(w);
    const close = () => { if (forced) return; asked = false; dismiss(scrim, sh); };
    const go = () => { accepted = true; (reg && reg.waiting || w).postMessage("skip"); dismiss(scrim, sh); };
    const scrim = h("div", { class: "scrim", onclick: close });
    const sh = h("div", { class: "sheet", role: "dialog" },
      h("div", { class: "grab" }, h("i")),
      h("div", { class: "st" }, forced ? "Update required" : "Update available"),
      forced ? h("p", { class: "note", style: "white-space:nowrap;font-size:clamp(10px,2.9vw,13px);text-align:center;margin:6px 0 14px" }, "This update improves your and your friend's experience") : null,
      ...(forced ? [] : ["new", "fixed"]).map(cat => {
        const items = n.lines.filter(l => new RegExp("^" + cat + ":", "i").test(l)).map(l => l.replace(/^[a-z]+:\s*/i, ""));
        return items.length ? h("div", { class: "ucat" }, h("div", { class: "uh" }, cat === "new" ? "New" : "Fixed"), h("ul", { class: "unotes" }, items.map(t => h("li", {}, t)))) : null;
      }),
      h("div", { class: "sg" }, h("button", { class: "si plain", onclick: go }, h("span", {}, "Update now"))),
      forced ? null : h("button", { class: "sx", onclick: close }, "Stay on current version"));
    // the required notice lives outside the normal layer, so going back or changing page cannot wipe it
    if (forced) { scrim.style.zIndex = "300"; sh.style.zIndex = "301"; document.body.append(scrim, sh); }
    else layer.append(scrim, sh);
  };
  const check = async manual => {
    if (!reg) { if (manual) toast("Not available right now"); return; }
    let failed = false;
    let tm;
    try { await Promise.race([fetchNew(), new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("slow")), 10000); })]); } catch (e) { failed = true; }
    clearTimeout(tm);
    for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); if (reg.waiting || !reg.installing) break; }
    if (reg.waiting) { if (manual) ask(reg.waiting, true); return; }
    if (manual && failed && !reg.installing) { toast("Could not check. Check your connection and try again"); return; }
    if (!reg.installing && manual) toast("Up to date");
  };
  navigator.serviceWorker.register("sw.js?v=" + encodeURIComponent(APP_VERSION)).then(r => {
    reg = r;
    window.nookCheckUpdate = () => check(true);
    if (r.waiting) ask(r.waiting);
    r.addEventListener("updatefound", () => {
      const w = r.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed") ask(r.waiting); });
    });
    const last = Number(localStorage.getItem(LAST) || 0);
    const idle = last > 0 && Date.now() - last > IDLE;
    touch();
    // an idle phone gets a fresh start, once per tab session, so a blocked storage can never cause a reload loop
    let once = false;
    try { once = sessionStorage.getItem("nook-idle-reload") === "1"; if (idle && !once) sessionStorage.setItem("nook-idle-reload", "1"); } catch (e) { once = true; }
    if (idle && !once) Promise.race([r.update(), new Promise(res => setTimeout(res, 4000))]).then(() => location.reload(), () => location.reload());
  }).catch(() => {});
  // an app that stays open still hears about a new version: the check runs when it comes back to the front and every ten minutes
  let lastCheck = 0;
  // the worker file is the same bytes at every release, so the browser alone never sees a new version: the notes file decides, and a new address for the worker makes it install
  const fetchNew = async () => {
    if (!reg) return;
    const n = await notes();
    const ver = String(n.ver || "").replace(/\s*!\s*$/, "");
    if (/^\d+\.\d+\.\d+$/.test(ver) && ver !== APP_VERSION && !reg.waiting && !reg.installing) navigator.serviceWorker.register("sw.js?v=" + encodeURIComponent(ver)).catch(() => {});
    else reg.update().catch(() => {});
  };
  const poll = () => { if (!reg || document.visibilityState !== "visible" || Date.now() - lastCheck < 60000) return; lastCheck = Date.now(); fetchNew(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") touch(); else poll(); });
  setTimeout(poll, 3000);
  setInterval(poll, 600000);
  window.addEventListener("pagehide", touch);
  setInterval(() => { if (document.visibilityState === "visible") touch(); }, 60000);
})();
