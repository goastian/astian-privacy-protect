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
  'options/options-loader.js',
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

const isChromium = target === 'chromium';
const commonBuildOptions = {
  bundle: true,
  target: 'esnext',
  minify: !watch,
  treeShaking: true,
  drop: watch ? [] : ['console', 'debugger'],
  legalComments: watch ? 'inline' : 'none',
  sourcemap: watch ? 'inline' : false,
  metafile: !watch,
  define: {
    '__PLATFORM__': JSON.stringify(target),
  },
  logLevel: 'info',
};

// Content scripts need IIFE format
const contentBuildOptions = {
  entryPoints: [resolve(SRC, 'content/cosmetic.js'), resolve(SRC, 'content/scriptlets.js')],
  ...commonBuildOptions,
  outdir: resolve(DIST, 'content'),
  format: 'iife',
  splitting: false,
};

// Firefox MV2 background scripts don't support ES modules,
// so we must use IIFE format for the background entry point.
const bgFormat = target === 'firefox' ? 'iife' : 'esm';

// Background build (separate because Firefox needs IIFE)
const bgBuildOptions = {
  entryPoints: [resolve(SRC, 'background/index.js')],
  ...commonBuildOptions,
  outdir: resolve(DIST, 'background'),
  format: bgFormat,
  splitting: false,
};

// Popup, Options & Setup build
const pagesBuildOptions = {
  entryPoints: [
    resolve(SRC, 'popup/popup.js'),
    resolve(SRC, 'options/options.js'),
    resolve(SRC, 'setup/setup.js'),
  ],
  ...commonBuildOptions,
  outdir: DIST,
  outbase: SRC,
  format: bgFormat,  // IIFE for Firefox, ESM for Chromium
  splitting: isChromium,
  chunkNames: isChromium ? 'chunks/[name]-[hash]' : undefined,
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
