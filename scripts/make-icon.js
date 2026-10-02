// Renders images/icon.png (128x128) with no dependencies: two chain links on a gradient tile.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SAMPLES = 4;

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const VIOLET = [124, 58, 237];
const CYAN = [6, 182, 212];

function roundedSquare(x, y, inset, radius) {
  const qx = Math.abs(x - SIZE / 2) - (SIZE / 2 - inset - radius);
  const qy = Math.abs(y - SIZE / 2) - (SIZE / 2 - inset - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function segment(px, py, ax, ay, bx, by) {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Two capsule outlines along the up-right diagonal, overlapping like chain links.
const D = [Math.SQRT1_2, -Math.SQRT1_2];
const HALF = 11;
const RADIUS = 15;
const STROKE = 9;
function link(px, py, offset) {
  const cx = 64 + D[0] * offset;
  const cy = 64 + D[1] * offset;
  const d = segment(px, py, cx - D[0] * HALF, cy - D[1] * HALF, cx + D[0] * HALF, cy + D[1] * HALF);
  return Math.abs(d - RADIUS) - STROKE / 2;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let [r, g, b, a] = [0, 0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        if (roundedSquare(px, py, 4, 26) > 0) {
          continue;
        }
        let color = mix(VIOLET, CYAN, (px + py) / (2 * SIZE));
        // The back link is dimmed slightly so the front one reads as passing over it.
        if (link(px, py, 13) <= 0) {
          color = [255, 255, 255];
        } else if (link(px, py, -13) <= 0) {
          color = mix(color, [255, 255, 255], 0.82);
        }
        r += color[0];
        g += color[1];
        b += color[2];
        a += 255;
      }
    }
    const n = SAMPLES * SAMPLES;
    const coverage = a / n;
    const i = (y * SIZE + x) * 4;
    pixels[i] = coverage ? Math.round((r / a) * 255) : 0;
    pixels[i + 1] = coverage ? Math.round((g / a) * 255) : 0;
    pixels[i + 2] = coverage ? Math.round((b / a) * 255) : 0;
    pixels[i + 3] = Math.round(coverage);
  }
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'images', 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out}`);
