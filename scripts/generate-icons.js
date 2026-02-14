/**
 * Generate PNG icons from SVG for the extension
 * Since we can't use canvas in Node without dependencies,
 * we'll create simple 1-color PNG icons programmatically.
 * 
 * This creates minimal valid PNG files.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const ICONS_DIR = resolve(ROOT, 'src', 'icons');

if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true });

function createPNG(width, height, drawFn) {
  // Create RGBA pixel buffer
  const pixels = new Uint8Array(width * height * 4);
  
  // Fill with transparent
  pixels.fill(0);
  
  // Call draw function
  drawFn(pixels, width, height);
  
  // Create PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  // IDAT chunk - raw pixel data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];     // R
      rawData[dstIdx + 1] = pixels[srcIdx + 1]; // G
      rawData[dstIdx + 2] = pixels[srcIdx + 2]; // B
      rawData[dstIdx + 3] = pixels[srcIdx + 3]; // A
    }
  }
  
  const compressed = deflateSync(rawData);
  
  function makeChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([typeBuffer, data]);
    const crc = crc32(combined);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([length, combined, crcBuffer]);
  }
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ~crc;
}

function setPixel(pixels, width, x, y, r, g, b, a) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= width || y < 0 || y >= width) return;
  const idx = (y * width + x) * 4;
  // Alpha blending
  const srcA = a / 255;
  const dstA = pixels[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA > 0) {
    pixels[idx] = Math.round((r * srcA + pixels[idx] * dstA * (1 - srcA)) / outA);
    pixels[idx + 1] = Math.round((g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA);
    pixels[idx + 2] = Math.round((b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA);
    pixels[idx + 3] = Math.round(outA * 255);
  }
}

function fillCircle(pixels, width, cx, cy, radius, r, g, b, a) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        const edgeAlpha = Math.min(1, Math.max(0, radius - dist + 0.5));
        setPixel(pixels, width, x, y, r, g, b, Math.round(a * edgeAlpha));
      }
    }
  }
}

function drawLine(pixels, width, x1, y1, x2, y2, thickness, r, g, b, a) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 2);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    fillCircle(pixels, width, cx, cy, thickness / 2, r, g, b, a);
  }
}

function drawIcon(pixels, width, height) {
  const s = width / 128; // scale factor
  
  // Green circle background
  fillCircle(pixels, width, 64 * s, 64 * s, 58 * s, 26, 158, 111, 255);
  
  // Shield outline (simplified as a V shape + top)
  const shieldColor = [255, 255, 255, 255];
  const lw = 4 * s;
  
  // Shield top-left to top
  drawLine(pixels, width, 38*s, 42*s, 64*s, 28*s, lw, ...shieldColor);
  // Shield top to top-right
  drawLine(pixels, width, 64*s, 28*s, 90*s, 42*s, lw, ...shieldColor);
  // Shield top-right to bottom-right
  drawLine(pixels, width, 90*s, 42*s, 90*s, 62*s, lw, ...shieldColor);
  // Shield bottom-right to bottom
  drawLine(pixels, width, 90*s, 62*s, 64*s, 92*s, lw, ...shieldColor);
  // Shield bottom to bottom-left
  drawLine(pixels, width, 64*s, 92*s, 38*s, 62*s, lw, ...shieldColor);
  // Shield bottom-left to top-left
  drawLine(pixels, width, 38*s, 62*s, 38*s, 42*s, lw, ...shieldColor);
  
  // Checkmark
  const checkLw = 5 * s;
  drawLine(pixels, width, 48*s, 60*s, 58*s, 72*s, checkLw, ...shieldColor);
  drawLine(pixels, width, 58*s, 72*s, 80*s, 48*s, checkLw, ...shieldColor);
}

// Generate icons at different sizes
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const png = createPNG(size, size, (pixels, w, h) => drawIcon(pixels, w, h));
  const path = resolve(ICONS_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated icon-${size}.png (${png.length} bytes)`);
}

console.log('Icons generated!');
