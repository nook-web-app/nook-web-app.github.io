#!/bin/bash
# Builds the signed release apk and puts it on the Nook site (apk/nook.apk with apk/version.json), where the app's
# updater looks for it. Needs ANDROID_HOME, NOOK_KS and NOOK_KS_PASS like g.sh.
set -e
cd "$(dirname "$0")"
./g.sh :app:assembleRelease
code=$(grep -o "versionCode [0-9]*" app/build.gradle | grep -o "[0-9]*")
name=$(grep -o "versionName '[^']*'" app/build.gradle | sed "s/versionName '//; s/'//")
mkdir -p ../apk
cp app/build/outputs/apk/release/app-release.apk ../apk/nook.apk
printf '{"code":%s,"name":"%s"}\n' "$code" "$name" > ../apk/version.json
cat ../apk/version.json
