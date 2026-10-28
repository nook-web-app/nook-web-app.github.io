#!/bin/bash
# Runs gradle for the native app. ANDROID_HOME must point at an Android SDK with platforms;android-34 and build-tools;34.0.0.
# Set NOOK_KS (path to the release key) and NOOK_KS_PASS to sign a release build with the real key.
#   ./g.sh :app:assembleRelease          build the apk (app/build/outputs/apk/release)
#   ./g.sh :app:recordPaparazziDebug     render every screen to app/src/test/snapshots/images
cd "$(dirname "$0")"
[ -n "$ANDROID_HOME" ] || { echo "set ANDROID_HOME to the Android SDK"; exit 1; }
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle --no-daemon -q "$@" 2>&1 | grep -v "Picked up"
