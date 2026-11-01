#!/usr/bin/env bash
set -euo pipefail

# Run after npm ci and the Web build. No Apple certificate is required: the
# device IPA is intentionally unsigned; the simulator app uses ad-hoc signing.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS builds require macOS with Xcode 26 or newer." >&2
  exit 1
fi
if [[ ! -f dist/index.html ]]; then
  echo "Missing dist/index.html. Run npm ci and npm run build first." >&2
  exit 1
fi

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
VERSION="${VERSION#v}"
if [[ ! "$VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "VERSION must be a semantic version, for example 0.1.0 or 0.1.0-preview.1." >&2
  exit 1
fi
APP_VERSION="${BASH_REMATCH[1]}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
if [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo "BUILD_NUMBER must be a positive integer." >&2
  exit 1
fi

# macos-15 currently defaults to Xcode 16.4 even though Xcode 26 is installed.
# Prefer a stable Xcode 26 installation; do not silently select a beta image.
if [[ -z "${XCODE_APP:-}" ]]; then
  XCODE_APP="$(python3 - <<'PY'
from glob import glob
from pathlib import Path
import re
choices = []
for path in glob('/Applications/Xcode_26*.app'):
    match = re.fullmatch(r'Xcode_(26(?:\.\d+)*)\.app', Path(path).name)
    if match:
        choices.append((tuple(map(int, match[1].split('.'))), path))
if not choices:
    raise SystemExit('No stable Xcode 26 installation found; set XCODE_APP explicitly.')
print(max(choices)[1])
PY
)"
fi
export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
XCODE_MAJOR="$(xcodebuild -version | awk '/^Xcode / { split($2, version, "."); print version[1] }')"
if [[ ! "$XCODE_MAJOR" =~ ^[0-9]+$ ]] || (( XCODE_MAJOR < 26 )); then
  echo "Capacitor 8 requires Xcode 26 or newer." >&2
  exit 1
fi
xcodebuild -version

OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/release}"
if [[ "$OUTPUT_DIR" != /* ]]; then OUTPUT_DIR="$PROJECT_ROOT/$OUTPUT_DIR"; fi
mkdir -p "$OUTPUT_DIR" "${RUNNER_TEMP:-$PROJECT_ROOT/artifacts}"
BUILD_ROOT="$(mktemp -d "${RUNNER_TEMP:-$PROJECT_ROOT/artifacts}/hongguo-ios.XXXXXX")"

if [[ ! -d ios/App/App.xcodeproj ]]; then
  npx cap add ios --packagemanager SPM
fi
if [[ ! -f ios/App/CapApp-SPM/Package.swift ]]; then
  echo "Expected the Capacitor Swift Package Manager template at ios/App/CapApp-SPM." >&2
  exit 1
fi
npx cap sync ios

# The native runtime must match package-lock.json rather than resolving an
# arbitrary newer Capacitor Swift package during a later repeat of this build.
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('node_modules/@capacitor/ios/package.json', 'utf8')).version;
const path = 'ios/App/CapApp-SPM/Package.swift';
const before = readFileSync(path, 'utf8');
const pattern = /\.package\(url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git",\s*(?:from|exact):\s*"[^"]+"\)/;
if (!pattern.test(before)) throw new Error('Capacitor Swift package reference not found');
writeFileSync(path, before.replace(pattern, `.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${version}")`));
JS

PROJECT="$PROJECT_ROOT/ios/App/App.xcodeproj"
COMMON=(
  -project "$PROJECT" -scheme App -configuration Release
  -clonedSourcePackagesDirPath "$BUILD_ROOT/SourcePackages"
  "MARKETING_VERSION=$APP_VERSION" "CURRENT_PROJECT_VERSION=$BUILD_NUMBER"
  'DEVELOPMENT_TEAM=' 'ONLY_ACTIVE_ARCH=NO'
)

echo "Building unsigned device app (not installable on an iPhone without signing)..."
xcodebuild -quiet "${COMMON[@]}" \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_ROOT/device" \
  'ARCHS=arm64' 'CODE_SIGNING_ALLOWED=NO' 'CODE_SIGNING_REQUIRED=NO' 'CODE_SIGN_IDENTITY=' \
  build 2>&1 | tee "$BUILD_ROOT/device-build.log"

DEVICE_APP="$BUILD_ROOT/device/Build/Products/Release-iphoneos/App.app"
test -f "$DEVICE_APP/App"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEVICE_APP/Info.plist")" = "$APP_VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DEVICE_APP/Info.plist")" = "$BUILD_NUMBER"
mkdir -p "$BUILD_ROOT/ipa/Payload"
ditto "$DEVICE_APP" "$BUILD_ROOT/ipa/Payload/App.app"
IPA="$OUTPUT_DIR/hongguo-web-v$VERSION-ios-unsigned.ipa"
ditto -c -k --sequesterRsrc --keepParent "$BUILD_ROOT/ipa/Payload" "$IPA"

echo "Building simulator app (arm64 and x86_64; not an iPhone IPA)..."
xcodebuild -quiet "${COMMON[@]}" \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BUILD_ROOT/simulator" \
  'ARCHS=arm64 x86_64' 'CODE_SIGNING_ALLOWED=YES' 'CODE_SIGN_IDENTITY=-' \
  build 2>&1 | tee "$BUILD_ROOT/simulator-build.log"

SIMULATOR_APP="$BUILD_ROOT/simulator/Build/Products/Release-iphonesimulator/App.app"
test -f "$SIMULATOR_APP/App"
codesign --verify --deep --strict "$SIMULATOR_APP"
lipo -archs "$SIMULATOR_APP/App"
ditto -c -k --sequesterRsrc --keepParent "$SIMULATOR_APP" \
  "$OUTPUT_DIR/hongguo-web-v$VERSION-ios-simulator.app.zip"

cat > "$OUTPUT_DIR/hongguo-web-v$VERSION-ios-README.txt" <<EOF
Hongguo Web $VERSION (build $BUILD_NUMBER)

ios-unsigned.ipa: unsigned arm64 iOS device build for inspection or later signing.
It cannot be installed directly on an iPhone and is not an App Store/TestFlight upload.

ios-simulator.app.zip: ad-hoc signed simulator App.app for arm64 or x86_64 Macs.
Unzip, boot an iOS 15+ simulator, then install with:
  xcrun simctl install booted /path/to/App.app

The native app bundles only the frontend. Configure a reachable backend in the app
or through the build's API URL configuration; it does not include the Node server.
EOF

echo "iOS packages written to $OUTPUT_DIR"
ls -lh "$IPA" "$OUTPUT_DIR/hongguo-web-v$VERSION-ios-simulator.app.zip"
