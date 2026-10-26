# Tests

Plain node scripts, no framework. Only the smoke test needs Playwright (1.63.0).

    tests/run.sh            # everything
    node tests/unit.js      # one at a time

- `static-check.js`: `node --check` on every .js, sw.js sanity, the three version numbers, manifest and index.html references.
- `unit.js`: cuts pure functions out of app.js text and runs them in a vm (rich, cleanUrl, zip, key backup, note and saved-login sealing).
- `smoke.js`: iPhone 13 and Pixel 7 emulation against a local static server (port 8130, `PORT=` to change). Every request to Supabase or any other outside host is mocked, so the real backend is never touched. Covers load errors, sign-in layout, forgot password modal, a fake signed-in session with tab navigation, service worker and manifest. Screenshots go to `tests/out/` (ignored by git).

Edge function .ts files are not checked (needs deno). If `unit.js` cannot find a function, app.js was renamed or reshaped: update the name in `unit.js`.
