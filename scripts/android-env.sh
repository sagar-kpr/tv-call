#!/usr/bin/env bash
# Source this file from a build script or a Bash terminal.
HOMEPING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${JAVA_HOME:-}" && -x "$HOME/.jdks/zulu-17/bin/java" ]]; then export JAVA_HOME="$HOME/.jdks/zulu-17"; fi
if [[ -z "${JAVA_HOME:-}" && -x "$HOMEPING_ROOT/.tools/java/bin/java" ]]; then export JAVA_HOME="$HOMEPING_ROOT/.tools/java"; fi
if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Android/Sdk/platform-tools" ]]; then export ANDROID_HOME="$HOME/Android/Sdk"; fi
if [[ -z "${ANDROID_HOME:-}" && -d "$HOMEPING_ROOT/.tools/android/platform-tools" ]]; then export ANDROID_HOME="$HOMEPING_ROOT/.tools/android"; fi
if [[ -n "${JAVA_HOME:-}" ]]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
if [[ -n "${ANDROID_HOME:-}" ]]; then export PATH="$ANDROID_HOME/platform-tools:$PATH"; fi
