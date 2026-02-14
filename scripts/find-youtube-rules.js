import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const files = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
const ytDomains = ['youtube', 'googlevideo', 'ytimg', 'ggpht', 'gstatic', 'googleapis', 'google.com', 'googleusercontent'];

for (const file of files) {
  const path = resolve(ROOT, 'src', 'rules', `${file}.json`);
  try {
    const rules = JSON.parse(readFileSync(path, 'utf8'));
    const ytRules = rules.filter(r => {
      const f = r.condition?.urlFilter || '';
      return ytDomains.some(d => f.toLowerCase().includes(d));
    });
    if (ytRules.length > 0) {
      console.log(`\n=== ${file} (${ytRules.length} YouTube-related rules) ===`);
      for (const r of ytRules.slice(0, 30)) {
        console.log(`  Rule ${r.id} [${r.action.type}]: ${r.condition.urlFilter}`);
      }
      if (ytRules.length > 30) console.log(`  ... and ${ytRules.length - 30} more`);
    }
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
  }
}
