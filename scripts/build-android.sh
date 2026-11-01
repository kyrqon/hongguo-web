#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
test -f dist/index.html || { echo 'Run the Web build first.' >&2; exit 1; }
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
VERSION="${VERSION#v}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
export VERSION BUILD_NUMBER
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Invalid version or build number.' >&2; exit 1
fi
if [[ ! -f android/app/build.gradle ]]; then npx cap add android; fi
npx cap sync android
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'android/app/build.gradle';
const original = readFileSync(path, 'utf8');
if (!/versionCode\s+\d+/.test(original) || !/versionName\s+"[^"]+"/.test(original)) throw new Error('Android version fields not found');
writeFileSync(path, original.replace(/versionCode\s+\d+/, `versionCode ${process.env.BUILD_NUMBER}`).replace(/versionName\s+"[^"]+"/, `versionName "${process.env.VERSION}"`));
JS
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_HOME" ]]; then echo 'Android SDK not found.' >&2; exit 1; fi
export ANDROID_HOME
if [[ ! -d "$ANDROID_HOME/platforms/android-36" || ! -d "$ANDROID_HOME/build-tools/36.0.0" ]]; then
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platforms;android-36' 'build-tools;36.0.0'
fi
chmod +x android/gradlew
(cd android && ./gradlew --no-daemon --console=plain assembleDebug)
mkdir -p release
cp android/app/build/outputs/apk/debug/app-debug.apk "release/hongguo-web-v${VERSION}-android-debug.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose "release/hongguo-web-v${VERSION}-android-debug.apk"
cat > "release/hongguo-web-v${VERSION}-android-README.txt" <<EOF
Hongguo Web $VERSION (build $BUILD_NUMBER)

android-debug.apk is an installable development preview signed with the runner's
Android debug key. It is not a Play Store production build. A later preview may
use a different key and require uninstalling an earlier preview before installing.

First launch asks for your own reachable HTTPS Node API address. The APK contains
only the frontend and does not include the backend, accounts or real drama files.
EOF
