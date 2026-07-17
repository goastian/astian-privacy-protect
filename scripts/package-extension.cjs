const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];

if ( target !== 'firefox' ) {
    console.error('Usage: node scripts/package-extension.cjs firefox');
    process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(
    rootDir,
    'dist',
    'build',
    'midori-protection.firefox'
);
const manifestPath = path.join(buildDir, 'manifest.json');
const sourceArchive = path.join(
    rootDir,
    'dist',
    'build',
    'midori-protection.firefox.xpi'
);

if ( fs.existsSync(manifestPath) === false ||
     fs.existsSync(sourceArchive) === false ) {
    console.error('Firefox build is missing. Run npm run build:firefox first.');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageName = `${manifest.name || 'midori-privacy'}-${
    manifest.version || '0.0.0'
}-firefox`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
const packagesDir = path.join(rootDir, 'packages');
const outputPath = path.join(packagesDir, `${packageName}.zip`);

fs.mkdirSync(packagesDir, { recursive: true });
fs.copyFileSync(sourceArchive, outputPath);

const sourceSize = fs.statSync(sourceArchive).size;
const outputSize = fs.statSync(outputPath).size;

if ( sourceSize !== outputSize ) {
    fs.rmSync(outputPath, { force: true });
    console.error('Packaged ZIP size does not match the Firefox XPI.');
    process.exit(1);
}

const relativeOutput = path.relative(rootDir, outputPath);
const sizeKiB = Math.round(outputSize / 1024);
console.log(`Packaged ${relativeOutput} (${sizeKiB} KiB)`);
