import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const DIST = resolve(ROOT, 'dist');

const target = process.argv[2] || 'chromium';
const watch = process.argv.includes('--watch');

console.log(`Building for ${target}...`);

// Clean dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

// Read and write manifest
const manifest = JSON.parse(readFileSync(resolve(SRC, `manifest.${target}.json`), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(resolve(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Copy static assets
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

copyDir(resolve(SRC, '_locales'), resolve(DIST, '_locales'));
copyDir(resolve(SRC, 'icons'), resolve(DIST, 'icons'));

// Copy HTML and CSS files
const htmlFiles = [
  'popup/popup.html',
  'popup/popup.css',
  'options/options.html',
  'options/options.css',
  'setup/setup.html',
  'setup/setup.css',
  'shared/styles.css',
];

for (const file of htmlFiles) {
  const src = resolve(SRC, file);
  const dest = resolve(DIST, file);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    if (target === 'firefox' && file.endsWith('.html')) {
      // Firefox MV2: remove type="module" from script tags (IIFE format)
      let html = readFileSync(src, 'utf8');
      html = html.replace(/ type="module"/g, '');
      writeFileSync(dest, html);
    } else {
      cpSync(src, dest);
    }
  }
}

// Copy DNR rules for Chromium
if (target === 'chromium') {
  copyDir(resolve(SRC, 'rules'), resolve(DIST, 'rules'));
}

// Copy AutoConsent CMP rules as runtime-loaded assets (kept out of the JS bundle
// so the service-worker cold-start doesn't pay the ~628 KB parse cost on every wake).
const autoconsentDest = resolve(DIST, 'autoconsent');
mkdirSync(autoconsentDest, { recursive: true });
for (const file of ['rules.json', 'consentomatic.json']) {
  const src = resolve(ROOT, 'node_modules/@duckduckgo/autoconsent/rules', file);
  if (existsSync(src)) cpSync(src, resolve(autoconsentDest, file));
}

// Build JS entry points
const entryPoints = [
  resolve(SRC, 'background/index.js'),
  resolve(SRC, 'popup/popup.js'),
  resolve(SRC, 'options/options.js'),
  resolve(SRC, 'content/cosmetic.js'),
];

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir: DIST,
  outbase: SRC,
  format: 'esm',
  target: 'esnext',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: {
    '__PLATFORM__': JSON.stringify(target),
  },
  logLevel: 'info',
};

// Content scripts need IIFE format
const contentBuildOptions = {
  entryPoints: [resolve(SRC, 'content/cosmetic.js'), resolve(SRC, 'content/scriptlets.js')],
  bundle: true,
  outdir: resolve(DIST, 'content'),
  format: 'iife',
  target: 'esnext',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: {
    '__PLATFORM__': JSON.stringify(target),
  },
  logLevel: 'info',
};

// Firefox MV2 background scripts don't support ES modules,
// so we must use IIFE format for the background entry point.
const bgFormat = target === 'firefox' ? 'iife' : 'esm';

// Background build (separate because Firefox needs IIFE)
const bgBuildOptions = {
  entryPoints: [resolve(SRC, 'background/index.js')],
  bundle: true,
  outdir: resolve(DIST, 'background'),
  format: bgFormat,
  target: 'esnext',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: {
    '__PLATFORM__': JSON.stringify(target),
  },
  logLevel: 'info',
};

// Popup, Options & Setup build
const pagesBuildOptions = {
  entryPoints: [
    resolve(SRC, 'popup/popup.js'),
    resolve(SRC, 'options/options.js'),
    resolve(SRC, 'setup/setup.js'),
  ],
  bundle: true,
  outdir: DIST,
  outbase: SRC,
  format: bgFormat,  // IIFE for Firefox, ESM for Chromium
  target: 'esnext',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: {
    '__PLATFORM__': JSON.stringify(target),
  },
  logLevel: 'info',
};

if (watch) {
  const ctx1 = await context(bgBuildOptions);
  const ctx2 = await context(pagesBuildOptions);
  const ctx3 = await context(contentBuildOptions);
  await ctx1.watch();
  await ctx2.watch();
  await ctx3.watch();
  console.log('Watching for changes...');
} else {
  await build(bgBuildOptions);
  await build(pagesBuildOptions);
  await build(contentBuildOptions);
  console.log('Build complete!');
}
