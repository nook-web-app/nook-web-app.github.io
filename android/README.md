# Nook for Android (native, work in progress)

A native Kotlin and Jetpack Compose copy of Nook. For now it works offline: everything is kept on the phone, in the
same shape as the web app's state (`Store.kt`: posts, chats, lists, profile and settings in one JSON file, photos as
files next to it). Posting (with up to four photos), replies, edits, deleting with Undo, likes, reposts, saves, pins,
lists, notes chats, the profile editor with the cropper, themes, backups and sharing work; what needs the server
(other people, messages, notifications, sign in) says so until the app goes online.

The version follows the web app (`APP_VERSION` in `Theme.kt`, `versionName` in `app/build.gradle`), and a newer apk
signed with the same key installs over the old one and keeps the data.

- `Theme.kt` holds the same color, size and radius tokens as `style.css`, and the Inter font.
- `IconData.kt` is generated from the icon set in `app.js` (`tools/genicons.py`), `Icons.kt` draws it.
- `UiKit.kt` has one building block per CSS class (`.bar`, `.tabs`, `.pri`, `.ghost`, `.seg`, `.group`, `.srow`, `.lrow`, `.empty`...).
- `Posts.kt`, `Screens.kt`, `Conv.kt` are the post card and the pages; `Overlays.kt` and `Panels.kt` the sheets, menu,
  photo viewer, toast and the full screen panels (compose, edit profile, cropper, list form).
- `AppState.kt` is the page stack (`go`, `root`, `back`) like the web app's `stack`, and the post actions.
- `Photos.kt`, `PhotoPick.kt`, `PostPic.kt`: photos are shrunk like the web app does (1280px, JPEG 80), picked from the
  gallery or camera, and a post can be turned into a picture to share.
- `Legal.kt` (terms, privacy, the composer prompts) is made from app.js by `tools/genlegal.js`.

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
