#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** midori-protection.opera: Creating web store package"

DES=dist/build/midori-protection.opera
rm -rf $DES
mkdir -p $DES

echo "*** midori-protection.opera: Copying common files"
bash ./tools/copy-common-files.sh $DES

# Chromium-specific
echo "*** midori-protection.opera: Copying chromium-specific files"
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.html $DES/

# Opera-specific
echo "*** midori-protection.opera: Copying opera-specific files"
cp platform/opera/manifest.json $DES/

rm -rf $DES/_locales/az
rm -rf $DES/_locales/be
rm -rf $DES/_locales/cv
rm -rf $DES/_locales/gu
rm -rf $DES/_locales/hi
rm -rf $DES/_locales/hy
rm -rf $DES/_locales/ka
rm -rf $DES/_locales/kk
rm -rf $DES/_locales/ku
rm -rf $DES/_locales/mr
rm -rf $DES/_locales/si
rm -rf $DES/_locales/so
rm -rf $DES/_locales/th

# Removing WASM modules until I receive an answer from Opera people: Opera's
# uploader issue an error for hntrie.wasm and this prevents me from
# updating uBO in the Opera store. The modules are unused anyway for
# Chromium- based browsers.
rm $DES/js/wasm/*.wasm
rm $DES/js/wasm/*.wat
rm $DES/lib/lz4/*.wasm
rm $DES/lib/lz4/*.wat
rm $DES/lib/publicsuffixlist/wasm/*.wasm
rm $DES/lib/publicsuffixlist/wasm/*.wat

echo "*** midori-protection.opera: Generating meta..."
python3 tools/make-opera-meta.py $DES/

echo "*** midori-protection.opera: Package done."
