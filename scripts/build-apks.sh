#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/android-env.sh"
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 17 installation}"
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK installation}"
cd "$HOMEPING_ROOT"
node -e 'const c=require("./apps/mobile/app.config.js")({config:{}});if(!c.extra.homepingBackendUrl)throw new Error("Set HOMEPING_BACKEND_URL in .env to the deployed HTTPS server before building. Users do not enter a URL.");'
mkdir -p artifacts
(cd apps/mobile && npx expo prebuild --platform android --no-install)
node -e 'const fs=require("fs");const p="apps/mobile/android/gradle/wrapper/gradle-wrapper.properties";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("networkTimeout=10000","networkTimeout=60000"));'
(cd apps/mobile/android && NODE_ENV=production ./gradlew --no-daemon :app:assembleRelease :app:testReleaseUnitTest -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --max-workers=2)
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk artifacts/homeping.apk
(cd artifacts && sha256sum homeping.apk > SHA256SUMS)
echo "Install artifacts/homeping.apk on both the phone and TV."
