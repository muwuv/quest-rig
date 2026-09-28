// builds a multi-size icon.ico from a source PNG (any 8-bit non-interlaced
// RGB/RGBA/gray/palette PNG). applies a rounded-squircle mask so it reads as
// an app tile, then assembles BMP entries for 16/24/32/48 + PNG for 256.
//   node scripts/png-to-ico.mjs [input] [output-ico]
import { inflateSync, deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const input = process.argv[2] ?? join(root, "src", "icon.png");
const output = process.argv[3] ?? join(root, "src-tauri", "icons", "icon.ico");

// ── minimal PNG decoder ──────────────────────────────────────────────────────
function readU32(b, o) {
  return b.readUInt32BE(o);
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePNG(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let plte = null;
  while (pos < buf.length) {
    const len = readU32(buf, pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      plte = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  if (colorType === 3 && !plte) throw new Error("palette PNG without PLTE");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const recon = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= channels ? recon[y * stride + x - channels] : 0;
      const b = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? recon[(y - 1) * stride + x - channels] : 0;
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = (v + a) & 0xff;
      else if (filter === 2) r = (v + b) & 0xff;
      else if (filter === 3) r = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) r = (v + paeth(a, b, c)) & 0xff;
      else throw new Error(`bad filter ${filter}`);
      recon[y * stride + x] = r;
    }
  }
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * channels;
      const d = (y * width + x) * 4;
      if (colorType === 6) {
        recon.copy(px, d, s, s + 4);
      } else if (colorType === 2) {
        px[d] = recon[s];
        px[d + 1] = recon[s + 1];
        px[d + 2] = recon[s + 2];
        px[d + 3] = 255;
      } else if (colorType === 0) {
        px[d] = px[d + 1] = px[d + 2] = recon[s];
        px[d + 3] = 255;
      } else if (colorType === 4) {
        px[d] = px[d + 1] = px[d + 2] = recon[s];
        px[d + 3] = recon[s + 1];
      } else if (colorType === 3) {
        const idx = recon[s] * 3;
        px[d] = plte[idx];
        px[d + 1] = plte[idx + 1];
        px[d + 2] = plte[idx + 2];
        px[d + 3] = 255;
      }
    }
  }
  return { width, height, rgba: px };
}

// ── area-average resample + squircle mask ────────────────────────────────────
function inRounded(px, py, s, r) {
  if (px < 0 || py < 0 || px >= s || py >= s) return false;
  const cx = Math.min(Math.max(px, r), s - r);
  const cy = Math.min(Math.max(py, r), s - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}
function resample(src, sw, sh, size) {
  const out = Buffer.alloc(size * size * 4);
  const r = size * 0.225;
  const ss = 3;
  // assume square-ish source; letterbox-crop center square
  const side = Math.min(sw, sh);
  const ox = (sw - side) / 2;
  const oy = (sh - side) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      let n = 0;
      let mask = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = x + (sx + 0.5) / ss;
          const dy = y + (sy + 0.5) / ss;
          if (!inRounded(dx, dy, size, r)) continue;
          mask++;
          const fx = Math.min(sw - 1, Math.max(0, ox + (dx / size) * side));
          const fy = Math.min(sh - 1, Math.max(0, oy + (dy / size) * side));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(sw - 1, x0 + 1);
          const y1 = Math.min(sh - 1, y0 + 1);
          const tx = fx - x0;
          const ty = fy - y0;
          for (const [xx, yy, w] of [
            [x0, y0, (1 - tx) * (1 - ty)],
            [x1, y0, tx * (1 - ty)],
            [x0, y1, (1 - tx) * ty],
            [x1, y1, tx * ty],
          ]) {
            const i = (yy * sw + xx) * 4;
            R += src[i] * w;
            G += src[i + 1] * w;
            B += src[i + 2] * w;
            A += src[i + 3] * w;
            n += w;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (mask === 0 || n === 0) {
        out[i + 3] = 0;
      } else {
        out[i] = Math.round(R / n);
        out[i + 1] = Math.round(G / n);
        out[i + 2] = Math.round(B / n);
        out[i + 3] = Math.round((A / n) * (mask / (ss * ss)));
      }
    }
  }
  return out;
}

// ── PNG encoder + ICO assembly (same as generate-icon.mjs) ───────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function dibFromRGBA(size, rgba) {
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0);
  hdr.writeInt32LE(size, 4);
  hdr.writeInt32LE(size * 2, 8);
  hdr.writeUInt16LE(1, 12);
  hdr.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
    }
  }
  const andRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(andRow * size);
  return Buffer.concat([hdr, xor, and]);
}

const { width, height, rgba } = decodePNG(readFileSync(input));
console.log(`source ${width}x${height}`);
const SIZES = [16, 24, 32, 48, 256];
const images = SIZES.map((s) => ({ size: s, rgba: resample(rgba, width, height, s) }));
const entries = images.map(({ size, rgba: r }) => ({
  size,
  data: size <= 48 ? dibFromRGBA(size, r) : encodePNG(size, r),
}));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
const dir = Buffer.alloc(16 * entries.length);
let offset = 6 + 16 * entries.length;
entries.forEach((e, i) => {
  const b = i * 16;
  dir[b] = e.size === 256 ? 0 : e.size;
  dir[b + 1] = e.size === 256 ? 0 : e.size;
  dir.writeUInt16LE(1, b + 4);
  dir.writeUInt16LE(32, b + 6);
  dir.writeUInt32LE(e.data.length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += e.data.length;
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
const previewPath = join(tmpdir(), "dq-icon-preview.png");
writeFileSync(previewPath, encodePNG(256, images[images.length - 1].rgba));
console.log("wrote", output, "and preview", previewPath);
