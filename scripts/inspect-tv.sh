#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/android-env.sh"
adb devices -l
for property in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.build.display.id ro.build.fingerprint; do
  printf '%s: ' "$property"
  adb shell getprop "$property"
done
adb shell pm path com.google.android.gms
adb shell dumpsys package dev.tvcall.caller
adb shell appops get dev.tvcall.caller SYSTEM_ALERT_WINDOW
