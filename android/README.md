# Nook for Android (native, work in progress)

A native Kotlin and Jetpack Compose version of Nook. For now it is the UI only: every page, sheet,
the menu and the panels of the web app, drawn with sample data. Nothing talks to the server yet.

- `Theme.kt` holds the same color, size and radius tokens as `style.css`, and the Inter font.
- `IconData.kt` is generated from the icon set in `app.js` (`tools/genicons.py`), `Icons.kt` draws it.
- `UiKit.kt` has one building block per CSS class (`.bar`, `.tabs`, `.pri`, `.ghost`, `.seg`, `.group`, `.srow`, `.lrow`, `.empty`...).
- `Posts.kt`, `Screens.kt`, `Overlays.kt` are the post card, the pages, and the sheets, menu, panels and toast.
- `AppState.kt` is the page stack (`go`, `root`, `back`) like the web app's `stack`.

Screens are checked without a phone: `./g.sh :app:recordPaparazziDebug` renders each one to
`app/src/test/snapshots/images`, at the same size as a Pixel 5 browser window, to compare with the web app.
