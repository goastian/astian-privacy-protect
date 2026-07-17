#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** midori-protection.firefox: Creating web store package"

BLDIR=dist/build
DES="$BLDIR"/midori-protection.firefox
mkdir -p $DES
rm -rf $DES/*

echo "*** midori-protection.firefox: Copying common files"
bash ./tools/copy-common-files.sh $DES

# Firefox-specific
echo "*** midori-protection.firefox: Copying firefox-specific files"
cp platform/firefox/*.json $DES/
cp platform/firefox/*.js   $DES/js/

# Firefox store-specific
cp -R $DES/_locales/nb     $DES/_locales/no

# Firefox/webext-specific
rm $DES/img/icon_128.png

echo "*** midori-protection.firefox: Generating meta..."
python3 tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** midori-protection.firefox: Creating package..."
    rm -f "$BLDIR"/midori-protection.firefox.xpi
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** midori-protection.firefox: Creating versioned package..."
    rm -f "$BLDIR"/midori-protection.firefox.xpi
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/midori-protection.firefox.xpi "$BLDIR"/midori-protection_"$1".firefox.xpi
fi

echo "*** midori-protection.firefox: Package done."
