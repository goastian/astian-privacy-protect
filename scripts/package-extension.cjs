const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const VALID_TARGETS = new Set(['chromium', 'firefox'])
const target = process.argv[2]

if (!VALID_TARGETS.has(target)) {
  console.error('Usage: node scripts/package-extension.cjs <chromium|firefox>')
  process.exit(1)
}

const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist', target)
const manifestPath = path.join(distDir, 'manifest.json')

if (!fs.existsSync(manifestPath)) {
  console.error(
    `Missing ${path.relative(rootDir, manifestPath)}. Run npm run build:${target} first.`
  )
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const packageName = `${manifest.name || 'extension'}-${manifest.version || '0.0.0'}-${target}`
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
const packagesDir = path.join(rootDir, 'packages')
const outputPath = path.join(packagesDir, `${packageName}.zip`)

fs.mkdirSync(packagesDir, { recursive: true })
fs.rmSync(outputPath, { force: true })

const result = spawnSync('zip', ['-qr', outputPath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status || 1)
}

const sizeKiB = Math.round(fs.statSync(outputPath).size / 1024)
console.log(`Packaged ${path.relative(rootDir, outputPath)} (${sizeKiB} KiB)`)
