import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');

const result = await build({
  entryPoints: [resolve(SRC, 'content/cosmetic.js'), resolve(SRC, 'content/scriptlets.js')],
  bundle: true,
  target: 'esnext',
  minify: true,
  treeShaking: true,
  drop: ['console', 'debugger'],
  legalComments: 'none',
  sourcemap: false,
  metafile: true,
  write: false,
  format: 'iife',
  splitting: false,
  outdir: 'dist/content-tree-shaking-check',
  define: {
    '__PLATFORM__': JSON.stringify('chromium'),
  },
  logLevel: 'silent',
});

const forbiddenInputs = Object.keys(result.metafile.inputs)
  .filter(input => /(?:^|\/)node_modules\/(?:tldts|tldts-core|tldts-experimental)(?:\/|$)/.test(input));

if (forbiddenInputs.length > 0) {
  console.error('[tree-shaking] tldts leaked into content scripts:');
  for (const input of forbiddenInputs) console.error(` - ${input}`);
  process.exit(1);
}

const outputBytes = Object.values(result.metafile.outputs)
  .reduce((sum, output) => sum + (output.bytes || 0), 0);

console.log(`[tree-shaking] OK: content scripts exclude tldts (${(outputBytes / 1024).toFixed(1)} KB checked)`);