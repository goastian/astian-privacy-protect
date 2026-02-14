/**
 * Midori Privacy Blocker — Extension Packager
 * Creates distributable .zip files for Chrome Web Store and Mozilla Add-ons.
 *
 * Usage:
 *   node scripts/package.js              — Package both platforms
 *   node scripts/package.js chromium     — Package only Chromium
 *   node scripts/package.js firefox      — Package only Firefox
 *
 * Output:
 *   releases/midori-privacy-{version}-chromium.zip   (Chrome Web Store)
 *   releases/midori-privacy-{version}-firefox.zip    (Mozilla Add-ons / AMO)
 *
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { execSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
  readdirSync, statSync, createWriteStream, createReadStream,
} from 'node:fs';
import { resolve, dirname, relative, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeflateRaw } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const RELEASES = resolve(ROOT, 'releases');

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const target = process.argv[2] || 'all';

// ── ZIP Implementation (no external dependencies) ────────────────────────────

/**
 * Minimal ZIP file creator using Node.js built-in zlib.
 * Supports Deflate compression for text files and Store for small files.
 */
class ZipCreator {
  constructor() {
    this.files = [];
  }

  async addFile(archivePath, content) {
    const isBuffer = Buffer.isBuffer(content);
    const buf = isBuffer ? content : Buffer.from(content, 'utf8');

    // Compress with deflate
    const compressed = await new Promise((resolve, reject) => {
      const chunks = [];
      const deflater = createDeflateRaw({ level: 9 });
      deflater.on('data', (chunk) => chunks.push(chunk));
      deflater.on('end', () => resolve(Buffer.concat(chunks)));
      deflater.on('error', reject);
      deflater.end(buf);
    });

    // Use compressed if smaller, otherwise store
    const useDeflate = compressed.length < buf.length;

    this.files.push({
      path: archivePath.replace(/\\/g, '/'),
      uncompressedSize: buf.length,
      compressedSize: useDeflate ? compressed.length : buf.length,
      data: useDeflate ? compressed : buf,
      method: useDeflate ? 8 : 0, // 8 = Deflate, 0 = Store
      crc32: crc32(buf),
    });
  }

  toBuffer() {
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of this.files) {
      const pathBuf = Buffer.from(file.path, 'utf8');

      // Local file header
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);   // Signature
      local.writeUInt16LE(20, 4);            // Version needed
      local.writeUInt16LE(0, 6);             // Flags
      local.writeUInt16LE(file.method, 8);   // Compression method
      local.writeUInt16LE(0, 10);            // Mod time
      local.writeUInt16LE(0, 12);            // Mod date
      local.writeUInt32LE(file.crc32, 14);   // CRC-32
      local.writeUInt32LE(file.compressedSize, 18);   // Compressed size
      local.writeUInt32LE(file.uncompressedSize, 22); // Uncompressed size
      local.writeUInt16LE(pathBuf.length, 26);        // Filename length
      local.writeUInt16LE(0, 28);            // Extra field length

      const localOffset = offset;
      parts.push(local, pathBuf, file.data);
      offset += local.length + pathBuf.length + file.data.length;

      // Central directory entry
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);  // Signature
      central.writeUInt16LE(20, 4);           // Version made by
      central.writeUInt16LE(20, 6);           // Version needed
      central.writeUInt16LE(0, 8);            // Flags
      central.writeUInt16LE(file.method, 10); // Compression method
      central.writeUInt16LE(0, 12);           // Mod time
      central.writeUInt16LE(0, 14);           // Mod date
      central.writeUInt32LE(file.crc32, 16);  // CRC-32
      central.writeUInt32LE(file.compressedSize, 20);   // Compressed size
      central.writeUInt32LE(file.uncompressedSize, 24); // Uncompressed size
      central.writeUInt16LE(pathBuf.length, 28);        // Filename length
      central.writeUInt16LE(0, 30);           // Extra field length
      central.writeUInt16LE(0, 32);           // Comment length
      central.writeUInt16LE(0, 34);           // Disk number start
      central.writeUInt16LE(0, 36);           // Internal attributes
      central.writeUInt32LE(0, 38);           // External attributes
      central.writeUInt32LE(localOffset, 42); // Relative offset of local header
      centralDir.push(central, pathBuf);
    }

    const centralDirOffset = offset;
    const centralDirSize = centralDir.reduce((s, b) => s + b.length, 0);

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);  // Signature
    eocd.writeUInt16LE(0, 4);            // Disk number
    eocd.writeUInt16LE(0, 6);            // Disk with central dir
    eocd.writeUInt16LE(this.files.length, 8);  // Entries on this disk
    eocd.writeUInt16LE(this.files.length, 10); // Total entries
    eocd.writeUInt32LE(centralDirSize, 12);    // Central dir size
    eocd.writeUInt32LE(centralDirOffset, 16);  // Central dir offset
    eocd.writeUInt16LE(0, 20);           // Comment length

    return Buffer.concat([...parts, ...centralDir, eocd]);
  }
}

// CRC-32 implementation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAllFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function formatSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// ── Build & Package ──────────────────────────────────────────────────────────

async function buildTarget(platform) {
  console.log(`\n🔨 Building ${platform}...`);
  execSync(`node scripts/build.js ${platform}`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

async function packageTarget(platform) {
  console.log(`\n📦 Packaging ${platform}...`);

  // Verify dist exists and has content
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'manifest.json'))) {
    throw new Error(`dist/ directory is empty or missing manifest.json. Run build first.`);
  }

  const zip = new ZipCreator();
  const files = getAllFiles(DIST);

  if (files.length === 0) {
    throw new Error('No files found in dist/');
  }

  let totalUncompressed = 0;

  for (const filePath of files) {
    const archivePath = relative(DIST, filePath);
    const content = readFileSync(filePath);
    await zip.addFile(archivePath, content);
    totalUncompressed += content.length;
  }

  // Create releases directory
  mkdirSync(RELEASES, { recursive: true });

  const zipName = `midori-privacy-${VERSION}-${platform}.zip`;
  const zipPath = resolve(RELEASES, zipName);
  const zipBuffer = zip.toBuffer();
  writeFileSync(zipPath, zipBuffer);

  const fileCount = files.length;
  const compressedSize = zipBuffer.length;

  console.log(`   ✅ ${zipName}`);
  console.log(`      Files: ${fileCount}`);
  console.log(`      Uncompressed: ${formatSize(totalUncompressed)}`);
  console.log(`      Compressed:   ${formatSize(compressedSize)}`);
  console.log(`      Ratio:        ${((1 - compressedSize / totalUncompressed) * 100).toFixed(1)}%`);
  console.log(`      Path: releases/${zipName}`);

  return { zipName, zipPath, fileCount, compressedSize, totalUncompressed };
}

// ── Validation ───────────────────────────────────────────────────────────────

function validatePackage(platform) {
  console.log(`\n🔍 Validating ${platform} package...`);

  const manifest = JSON.parse(readFileSync(resolve(DIST, 'manifest.json'), 'utf8'));
  const errors = [];
  const warnings = [];

  // Check manifest version
  if (platform === 'chromium' && manifest.manifest_version !== 3) {
    errors.push('Chromium package must use Manifest V3');
  }
  if (platform === 'firefox' && manifest.manifest_version !== 2) {
    errors.push('Firefox package must use Manifest V2');
  }

  // Check version matches package.json
  if (manifest.version !== VERSION) {
    errors.push(`Manifest version (${manifest.version}) doesn't match package.json (${VERSION})`);
  }

  // Check required files exist
  const requiredFiles = [
    'manifest.json',
    'background/index.js',
    'content/cosmetic.js',
    'content/scriptlets.js',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css',
    'options/options.html',
    'options/options.js',
    'options/options.css',
    'shared/styles.css',
  ];

  for (const file of requiredFiles) {
    if (!existsSync(resolve(DIST, file))) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  // Check icons
  const requiredIcons = ['icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'];
  for (const icon of requiredIcons) {
    if (!existsSync(resolve(DIST, icon))) {
      errors.push(`Missing icon: ${icon}`);
    }
  }

  // Check locales
  if (!existsSync(resolve(DIST, '_locales/en/messages.json'))) {
    errors.push('Missing default locale: _locales/en/messages.json');
  }

  // Chromium-specific checks
  if (platform === 'chromium') {
    if (!existsSync(resolve(DIST, 'rules'))) {
      warnings.push('No DNR rules directory found (rules/)');
    }
    if (!manifest.declarative_net_request) {
      warnings.push('No declarative_net_request in manifest');
    }
  }

  // Firefox-specific checks
  if (platform === 'firefox') {
    if (!manifest.browser_specific_settings?.gecko?.id) {
      warnings.push('No gecko ID in manifest — required for AMO submission');
    }
  }

  // Check for oversized files (Chrome Web Store limit: 500MB, individual files shouldn't be huge)
  const files = getAllFiles(DIST);
  for (const file of files) {
    const size = statSync(file).size;
    if (size > 10 * 1024 * 1024) { // 10MB per file
      warnings.push(`Large file: ${relative(DIST, file)} (${formatSize(size)})`);
    }
  }

  // Report
  if (errors.length > 0) {
    console.log('   ❌ Errors:');
    for (const e of errors) console.log(`      - ${e}`);
  }
  if (warnings.length > 0) {
    console.log('   ⚠️  Warnings:');
    for (const w of warnings) console.log(`      - ${w}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log('   ✅ All checks passed');
  }

  return { errors, warnings };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Midori Privacy Blocker — Extension Packager       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Version: ${VERSION}`);

  const platforms = target === 'all' ? ['chromium', 'firefox'] : [target];
  const results = [];

  for (const platform of platforms) {
    if (!['chromium', 'firefox'].includes(platform)) {
      console.error(`❌ Unknown platform: ${platform}`);
      process.exit(1);
    }

    // Build
    await buildTarget(platform);

    // Validate
    const { errors } = validatePackage(platform);
    if (errors.length > 0) {
      console.error(`\n❌ ${platform} build has errors. Fix them before packaging.`);
      process.exit(1);
    }

    // Package
    const result = await packageTarget(platform);
    results.push({ platform, ...result });
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  📋 Package Summary');
  console.log('──────────────────────────────────────────────────────────');
  for (const r of results) {
    console.log(`  ${r.platform.padEnd(10)} → ${r.zipName} (${formatSize(r.compressedSize)}, ${r.fileCount} files)`);
  }
  console.log('──────────────────────────────────────────────────────────');
  console.log('  📂 Output: releases/');
  console.log('');
  console.log('  🌐 Chrome Web Store:  https://chrome.google.com/webstore/devconsole');
  console.log('  🦊 Mozilla Add-ons:   https://addons.mozilla.org/developers/');
  console.log('══════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error('\n❌ Packaging failed:', e.message);
  process.exit(1);
});
