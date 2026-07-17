#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** midori-protection.thunderbird: Creating web store package"

BLDIR=dist/build
DES="$BLDIR"/midori-protection.thunderbird
rm -rf $DES
mkdir -p $DES

echo "*** midori-protection.thunderbird: copying common files"
bash ./tools/copy-common-files.sh $DES

echo "*** midori-protection.thunderbird: Copying firefox-specific files"
cp platform/firefox/*.js $DES/js/

echo "*** midori-protection.thunderbird: Copying thunderbird-specific files"
cp platform/thunderbird/manifest.json $DES/

# Firefox store-specific
cp -R $DES/_locales/nb             $DES/_locales/no

# Firefox/webext-specific
rm $DES/img/icon_128.png

echo "*** midori-protection.thunderbird: Generating meta..."
python3 tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** midori-protection.thunderbird: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** midori-protection.thunderbird: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/midori-protection.thunderbird.xpi "$BLDIR"/midori-protection_"$1".thunderbird.xpi
fi

echo "*** midori-protection.thunderbird: Package done."
