// Find every QR code in an RGBA image. ZXing does the heavy lifting: it reads
// several codes per call and copes with dense codes photographed off a screen,
// where jsQR fails. No single setting wins on every photo, so the image is read
// at a few sizes and binarizers and the results are merged. jsQR (scanAll) is
// the last resort. `readBarcodes` comes from zxing-wasm; it is injected so this
// file runs in both the browser and Node.
import { scanAll } from './multiscan.mjs';

const SCALES = [1, 1.5, 2, 3]; // divide the image size by these
const BINARIZERS = ['LocalAverage', 'GlobalHistogram', 'FixedThreshold'];
const JSQR_MAX_SIDE = 2000; // jsQR is slow on full-size photos

// Box-average downscale by a (possibly fractional) factor >= 1.
export function resize(data, width, height, factor) {
  if (factor === 1) return { data, width, height };
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * factor);
    const sy1 = Math.min(height, Math.max(sy0 + 1, Math.ceil((y + 1) * factor)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * factor);
      const sx1 = Math.min(width, Math.max(sx0 + 1, Math.ceil((x + 1) * factor)));
      let r = 0, g = 0, b = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0);
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// Returns the decoded texts (unique, in discovery order).
export async function decodeAll({ readBarcodes, jsQR }, data, width, height, opts = {}) {
  const scales = opts.scales ?? SCALES;
  const texts = [];
  const add = (s) => { if (!texts.includes(s)) texts.push(s); };

  for (const factor of scales) {
    const img = resize(data, width, height, factor);
    for (const binarizer of BINARIZERS) {
      const found = await readBarcodes(
        { data: img.data, width: img.width, height: img.height, colorSpace: 'srgb' },
        { formats: ['QRCode'], maxNumberOfSymbols: 32, tryHarder: true, binarizer },
      );
      for (const r of found) if (r.isValid && r.text) add(r.text);
    }
  }
  if (texts.length || !jsQR) return texts;

  const img = resize(data, width, height, Math.max(1, Math.max(width, height) / JSQR_MAX_SIDE));
  scanAll(jsQR, img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }).forEach(add);
  return texts;
}
