# https://stackoverflow.com/a/6273809
run_options := $(filter-out $@,$(MAKECMDGOALS))

.PHONY: all clean cleanassets test lint chromium opera firefox thunderbird npm dig \
	mv3-chromium mv3-firefox mv3-edge mv3-safari ubol-codemirror \
	compare maxcost medcost mincost modifiers record wasm \
	publish-chromium publish-edge publish-firefox \
	publish-dev-chromium publish-dev-firefox \
	upload-firefox upload-dev-firefox

sources := ./dist/version $(shell find ./assets -type f) $(shell find ./src -type f)
platform := $(wildcard platform/*/*)
assets := dist/build/uAssets
mv3-sources := \
	$(shell find ./src -type f) \
	$(wildcard platform/mv3/*) \
	$(shell find ./platform/mv3/extension -name codemirror-ubol -prune -o -type f) \
	platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.min.js
mv3-data := $(shell find ./dist/build/mv3-data -type f)

mv3-edge-deps := $(wildcard platform/mv3/edge/*)
mv3-safari-deps := $(wildcard platform/mv3/safari/*)

all: chromium firefox npm

dist/build/midori-protection.chromium: tools/make-chromium.sh $(sources) $(platform) $(assets)
	tools/make-chromium.sh

# Build the extension for Chromium.
chromium: dist/build/midori-protection.chromium

dist/build/midori-protection.opera: tools/make-opera.sh $(sources) $(platform) $(assets)
	tools/make-opera.sh

# Build the extension for Opera.
opera: dist/build/midori-protection.opera

dist/build/midori-protection.firefox: tools/make-firefox.sh $(sources) $(platform) $(assets)
	tools/make-firefox.sh all

# Build the extension for Firefox.
firefox: dist/build/midori-protection.firefox

dist/build/midori-protection.thunderbird: tools/make-thunderbird.sh $(sources) $(platform) $(assets)
	tools/make-thunderbird.sh

# Build the extension for Thunderbird feeds.
thunderbird: dist/build/midori-protection.thunderbird

dist/build/uBlock0.npm: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-npm.sh

npm: dist/build/uBlock0.npm

# Dev tools
node_modules:
	npm install

init: node_modules

lint: init
	npm run lint

dist/build/uBlock0.dig: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-dig.sh

dig: dist/build/uBlock0.dig
	cd dist/build/uBlock0.dig && npm install

dig-snfe: dig
	cd dist/build/uBlock0.dig && npm run snfe $(run_options)

dist/build/mv3-data:
	mkdir -p dist/build/mv3-data

ubol-codemirror:
	$(MAKE) -sC platform/mv3/extension/lib/codemirror/codemirror-ubol/ ubol.bundle

dist/build/midori-protection.mv3.chromium: tools/make-mv3.sh $(mv3-sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh chromium

mv3-chromium: ubol-codemirror dist/build/midori-protection.mv3.chromium

dist/build/midori-protection.mv3.firefox: tools/make-mv3.sh $(mv3-sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh firefox

mv3-firefox: ubol-codemirror dist/build/midori-protection.mv3.firefox

dist/build/midori-protection.mv3.edge: tools/make-mv3.sh $(mv3-sources) $(mv3-edge-deps) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh edge

mv3-edge: ubol-codemirror dist/build/midori-protection.mv3.edge

dist/build/midori-protection.mv3.safari: tools/make-mv3.sh $(mv3-sources) $(mv3-safari-deps) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh safari

mv3-safari: ubol-codemirror dist/build/midori-protection.mv3.safari

dist/build/uAssets:
	tools/pull-assets.sh

clean:
	rm -rf dist/build tmp/node_modules node_modules

cleanassets:
	rm -rf dist/build/mv3-data dist/build/uAssets

# Publishing requires the Midori store identifiers; upstream uBlock store IDs
# are intentionally never used by this fork.
MIDORI_CHROMIUM_STORE_ID ?=
MIDORI_CHROMIUM_DEV_STORE_ID ?=
MIDORI_EDGE_STORE_ID ?=
MIDORI_EDGE_PRODUCT_ID ?=

# Usage: make publish-chromium version=? MIDORI_CHROMIUM_STORE_ID=?
publish-chromium:
	@test -n "$(MIDORI_CHROMIUM_STORE_ID)" || (echo "MIDORI_CHROMIUM_STORE_ID is required"; exit 1)
	node publish-extension/publish-chromium.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=chromium \
		storeid=$(MIDORI_CHROMIUM_STORE_ID)

# Usage: make publish-edge version=?
publish-edge:
	@test -n "$(MIDORI_EDGE_STORE_ID)" || (echo "MIDORI_EDGE_STORE_ID is required"; exit 1)
	@test -n "$(MIDORI_EDGE_PRODUCT_ID)" || (echo "MIDORI_EDGE_PRODUCT_ID is required"; exit 1)
	node publish-extension/publish-edge.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=chromium \
		datebasedmajor=1 \
		storeid=$(MIDORI_EDGE_STORE_ID) \
		productid=$(MIDORI_EDGE_PRODUCT_ID) \
		notes="See release notes at https://github.com/goastian/midori-privacy/releases"

# Usage: make publish-firefox version=?
publish-firefox:
	node publish-extension/publish-firefox.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=midori-protection@astian.org \
		channel=listed

# Usage: make publish-dev-chromium version=?
publish-dev-chromium:
	@test -n "$(MIDORI_CHROMIUM_DEV_STORE_ID)" || (echo "MIDORI_CHROMIUM_DEV_STORE_ID is required"; exit 1)
	node publish-extension/publish-chromium.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=chromium \
		storeid=$(MIDORI_CHROMIUM_DEV_STORE_ID)

# Usage: make publish-dev-firefox version=?
publish-dev-firefox:
	node publish-extension/publish-firefox.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=midori-protection@astian.org \
		channel=unlisted

# Usage: make upload-firefox version=?
upload-firefox:
	node publish-extension/upload-firefox.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=midori-protection@astian.org \
		channel=listed

# Usage: make upload-dev-firefox version=?
upload-dev-firefox:
	node publish-extension/upload-firefox.js \
		ghowner=goastian \
		ghrepo=midori-privacy \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=midori-protection@astian.org \
		channel=unlisted \
		updatepath=./dist/firefox/updates.json

# Not real targets, just convenient for auto-completion at shell prompt
compare:
	@echo
maxcost:
	@echo
medcost:
	@echo
mincost:
	@echo
modifiers:
	@echo
record:
	@echo
wasm:
	@echo
