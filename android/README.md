# Nook for Android (native, work in progress)

A native Kotlin and Jetpack Compose version of Nook. For now it is the UI only: every page, sheet,
the menu and the panels of the web app, drawn with sample data. Nothing talks to the server yet.

- `Theme.kt` holds the same color, size and radius tokens as `style.css`, and the Inter font.
- `IconData.kt` is generated from the icon set in `app.js` (`tools/genicons.py`), `Icons.kt` draws it.
- `UiKit.kt` has one building block per CSS class (`.bar`, `.tabs`, `.pri`, `.ghost`, `.seg`, `.group`, `.srow`, `.lrow`, `.empty`...).
- `Posts.kt`, `Screens.kt`, `Overlays.kt` are the post card, the pages, and the sheets, menu, panels and toast.
- `AppState.kt` is the page stack (`go`, `root`, `back`) like the web app's `stack`.

## Checking the screens against the web app

Both sides draw the same sample data (`tools/fixture/fixture.json`; `tools/genfixture.py` turns it into `Fixture.kt`):

1. `node tools/refweb.js .. /tmp/web` opens the web app in a Pixel 5 sized browser with a fake server that serves the
   fixture, a frozen clock and a seeded random, and screenshots every page and sheet.
2. `./g.sh :app:recordPaparazziDebug` renders the same pages natively (`app/src/test/snapshots/images`).
3. `python3 tools/pixdiff.py /tmp/web app/src/test/snapshots/images /tmp/diff` writes web | native | overlay for each
   page (web in red, native in cyan, gray where they line up) and prints how much differs.
4. `tools/align.py` and `tools/zoom.py` measure and enlarge single spots; the `Layout` test prints the exact place of
   tagged elements (`Modifier.probe`) to compare with `node tools/refweb.js .. /tmp/web probe`.

Text and spacing follow the browser's fractional layout closely (`T` rounds text boxes instead of rounding them up,
`vpad` rounds a top and bottom padding together), so long lists do not drift by a pixel per row.
