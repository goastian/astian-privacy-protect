import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'src/rules/ublock-filters.json';
const id = parseInt(process.argv[3] || '97');

const rules = JSON.parse(readFileSync(file, 'utf8'));

// Show the target rule and a few around it
for (let i = id - 3; i <= id + 3; i++) {
  const r = rules.find(x => x.id === i);
  if (r) {
    console.log(`Rule ${r.id}:`, JSON.stringify(r.condition));
  }
}

// Also find all rules with potentially invalid urlFilter
console.log('\n--- Rules with suspicious urlFilter ---');
let count = 0;
for (const r of rules) {
  const f = r.condition?.urlFilter;
  if (!f) continue;
  // Chrome rejects: empty, only whitespace, contains spaces, invalid chars
  if (!f || f.includes(' ') || f.includes('\t') || f.length === 0 || /[{}()\[\]\\]/.test(f)) {
    console.log(`  Rule ${r.id}: "${f}"`);
    count++;
    if (count > 20) { console.log('  ... (truncated)'); break; }
  }
}
