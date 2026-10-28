#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/android-env.sh"
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 17 installation}"
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK installation}"
cd "$HOMEPING_ROOT"
mkdir -p artifacts
(cd apps/tv && ./gradlew --no-daemon :app:assembleDebug --max-workers=2)
cp apps/tv/app/build/outputs/apk/debug/app-debug.apk artifacts/homeping-tv-debug.apk
(cd apps/mobile && npx expo prebuild --platform android --no-install)
node -e 'const fs=require("fs");const p="apps/mobile/android/gradle/wrapper/gradle-wrapper.properties";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("networkTimeout=10000","networkTimeout=60000"));'
(cd apps/mobile/android && NODE_ENV=production ./gradlew --no-daemon :app:assembleRelease :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --max-workers=2)
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk artifacts/homeping-caller-standalone.apk
cp apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk artifacts/homeping-caller-debug.apk
(cd artifacts && sha256sum *.apk > SHA256SUMS)
