#!/bin/bash
# One command for a release of the native app (and the web app, which shares the version):
#   bumps the version everywhere, builds and signs the apk, checks it, copies it to apk/nook.apk, commits and pushes.
#
#   NOOK_KS=/path/to/release.jks NOOK_KS_PASS=... ./android/release.sh [patch|minor|major] [-m "what changed"] [options]
#
#   patch (default) 3.37.6 -> 3.37.7      minor 3.37.6 -> 3.38.0      major 3.37.6 -> 4.0.0
#   -m "text"    the title of the commit ("Native app 3.37.7: text")
#   --new        the notes say "Added new features" (a patch says "Fixed some bugs" by itself)
#   --forced     the update is required: "## 3.37.7 !" installs at once and cannot be skipped
#   --test       run the quick unit tests first (crypto, media, gif); a failure stops the release
#   --shots      also compare the screens with the saved pictures (they are only reported, never stop the release)
#   --no-push    commit but do not push
#   --dry-run    only say what would change
#   NOOK_TRAILER (environment) lines added at the end of the commit message, like the Co-Authored-By lines
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD

kind=patch; msg=""; isnew=0; forced=0; dotest=0; shots=0; push=1; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    patch|minor|major) kind=$1 ;;
    -m) shift; msg=${1:-} ;;
    --new) isnew=1 ;; --forced) forced=1 ;; --test) dotest=1 ;; --shots) shots=1 ;; --no-push) push=0 ;; --dry-run) dry=1 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done

GRADLE=android/app/build.gradle
THEME=android/app/src/main/java/io/github/nookwebapp/native_ui/Theme.kt
cur=$(sed -n "s/.*versionName '\([0-9.]*\)'.*/\1/p" $GRADLE)
[ -n "$cur" ] || { echo "cannot read the version from $GRADLE"; exit 1; }
IFS=. read -r MA MI PA <<< "$cur"
case $kind in
  patch) PA=$((PA + 1)) ;;
  minor) MI=$((MI + 1)); PA=0 ;;
  major) MA=$((MA + 1)); MI=0; PA=0 ;;
esac
new="$MA.$MI.$PA"; code=$((MA * 10000 + MI * 100 + PA))
echo "version $cur -> $new (code $code)"
[ -n "$msg" ] || msg="update"
[ $dry = 1 ] && { echo "dry run: nothing changed"; exit 0; }

[ -n "${NOOK_KS:-}" ] && [ -n "${NOOK_KS_PASS:-}" ] || { echo "set NOOK_KS (the release key) and NOOK_KS_PASS first"; exit 1; }
[ -z "$(git diff --cached --name-only)" ] || { echo "something is staged already: commit or unstage it first"; exit 1; }

# the files the version is written into are copied first, so a failed build puts them back exactly as they were
FILES="$GRADLE $THEME app.js apk/version.json CLAUDE_READ_THIS.txt"
SAVE=$(mktemp -d)
for f in $FILES; do mkdir -p "$SAVE/$(dirname $f)"; cp "$f" "$SAVE/$f"; done
undo() { for f in $FILES; do cp "$SAVE/$f" "$f"; done; echo "the version files are back as they were"; }

NEW="$new" CODE="$code" ISNEW=$isnew FORCED=$forced python3 - <<'PY' || { undo; exit 1; }
import os, re
new, code = os.environ["NEW"], os.environ["CODE"]
def sub(path, pat, rep):
    s = open(path).read(); n, c = re.subn(pat, rep, s, count=1)
    if c != 1: raise SystemExit("could not update " + path)
    open(path, "w").write(n)
sub("android/app/build.gradle", r"versionCode \d+; versionName '[\d.]+'", f"versionCode {code}; versionName '{new}'")
sub("android/app/src/main/java/io/github/nookwebapp/native_ui/Theme.kt", r'APP_VERSION = "[\d.]+"', f'APP_VERSION = "{new}"')
sub("app.js", r'const APP_VERSION = "[\d.]+";', f'const APP_VERSION = "{new}";')
open("apk/version.json", "w").write('{"code":%s,"name":"%s"}\n' % (code, new))
minor_or_major = new.split(".")[2] == "0"
lines = ["new: Added new features"] if (os.environ["ISNEW"] == "1" or minor_or_major) else []
if not minor_or_major: lines.append("fixed: Fixed some bugs")
head = "## " + new + (" !" if os.environ["FORCED"] == "1" else "") + "\n" + "\n".join(lines) + "\n\n"
s = open("CLAUDE_READ_THIS.txt").read()
i = s.index("## ")
open("CLAUDE_READ_THIS.txt", "w").write(s[:i] + head + s[i:])
PY

LOG=$(mktemp)
run() { (cd android && ./g.sh "$@") > "$LOG" 2>&1; if grep -q "FAILURE\|^e: \|tests completed.*failed" "$LOG"; then echo "FAILED: $*"; grep "^e: \|FAILURE\|What went wrong" -A3 "$LOG" | head -20; return 1; fi; }
t0=$(date +%s)
if [ $dotest = 1 ]; then
  echo "tests..."; run :app:testDebugUnitTest --tests '*CryptoTest*' --tests '*MediaGrabTest*' --tests '*GifTest*' || { undo; exit 1; }
fi
if [ $shots = 1 ]; then
  echo "screens..."; (cd android && ./g.sh :app:verifyPaparazziDebug) > "$LOG" 2>&1; grep -q "FAILURE" "$LOG" && echo "(the screen pictures differ from the saved ones, see android/app/build/paparazzi/failures)" || echo "screens match"
fi
echo "building..."
APK=android/app/build/outputs/apk/release/app-release.apk
rm -f $APK
run :app:assembleRelease || { undo; exit 1; }
[ -f $APK ] || { echo "no apk came out"; undo; exit 1; }

# the apk must be this version and signed with the same key as the one people have
SDK=$(sed -n 's/^sdk.dir=//p' android/local.properties)
AS=$(ls "$SDK"/build-tools/*/apksigner | tail -1); AAPT=$(ls "$SDK"/build-tools/*/aapt2 | tail -1)
got=$("$AAPT" dump badging $APK | sed -n "s/.*versionName='\([0-9.]*\)'.*/\1/p" | head -1)
[ "$got" = "$new" ] || { echo "the apk says version $got, not $new"; undo; exit 1; }
sig() { "$AS" verify --print-certs "$1" 2>&1 | sed -n 's/.*certificate SHA-256 digest: //p' | head -1; }
[ "$(sig $APK)" = "$(sig apk/nook.apk)" ] && [ -n "$(sig $APK)" ] || { echo "the apk is not signed with the same key as apk/nook.apk"; undo; exit 1; }
cp $APK apk/nook.apk
echo "apk ready: version $new, $(( $(date +%s) - t0 )) s, $(du -h apk/nook.apk | cut -f1)"

git add -A
git status --short | head -30
if [ -n "${NOOK_TRAILER:-}" ]; then git commit -q -m "Native app $new: $msg" -m "$NOOK_TRAILER" || { echo "nothing to commit"; exit 1; }
else git commit -q -m "Native app $new: $msg" || { echo "nothing to commit"; exit 1; }; fi
if [ $push = 1 ]; then
  for wait in 0 2 4 8 16; do
    sleep $wait
    git push origin "$(git rev-parse --abbrev-ref HEAD)" > "$LOG" 2>&1 && { tail -1 "$LOG"; break; }
  done
fi
rm -rf "$SAVE" "$LOG"
echo "done: $new"
