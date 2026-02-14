import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const files = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
const ytPatterns = ['youtube.com', 'googlevideo.com', 'ytimg.com'];

for (const file of files) {
  const path = resolve(ROOT, 'src', 'rules', `${file}.json`);
  try {
    const rules = JSON.parse(readFileSync(path, 'utf8'));
    const ytRules = rules.filter(r => {
      const f = (r.condition?.urlFilter || '').toLowerCase();
      return ytPatterns.some(d => f.includes(d));
    });
    if (ytRules.length > 0) {
      console.log(`\n=== ${file} ===`);
      for (const r of ytRules) {
        const dt = r.condition.domainType || 'ANY';
        const id = r.condition.initiatorDomains ? `initiator:${r.condition.initiatorDomains.join(',')}` : '';
        const eid = r.condition.excludedInitiatorDomains ? `excluded:${r.condition.excludedInitiatorDomains.join(',')}` : '';
        console.log(`  [${r.action.type}] ${r.condition.urlFilter}  domainType=${dt} ${id} ${eid}`.trim());
      }
    }
  } catch (e) {}
}
