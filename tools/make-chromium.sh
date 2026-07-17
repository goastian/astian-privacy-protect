#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** midori-protection.chromium: Creating web store package"

DES=dist/build/midori-protection.chromium
rm -rf $DES
mkdir -p $DES

echo "*** midori-protection.chromium: Copying common files"
bash ./tools/copy-common-files.sh $DES

# Chromium-specific
echo "*** midori-protection.chromium: Copying chromium-specific files"
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.json $DES/

# Chrome store-specific
cp -R $DES/_locales/nb $DES/_locales/no

echo "*** midori-protection.chromium: Generating meta..."
python3 tools/make-chromium-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** midori-protection.chromium: Creating plain package..."
    pushd $(dirname $DES/) > /dev/null
    zip midori-protection.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** midori-protection.chromium: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip midori-protection_"$1".chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** midori-protection.chromium: Package done."
