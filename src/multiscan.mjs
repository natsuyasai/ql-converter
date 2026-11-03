// Decode every QR code in one image. jsQR returns at most one code per call and
// gives up when several finder-pattern sets compete, so the image is scanned
// whole, then each separate dark blob (a QR plus its quiet zone keeps it apart
// from its neighbours) is cropped and scanned alone. Found codes are painted
// white so they are not found twice.
const PAD = 0.08; // grow the masked box so the finder patterns / quiet zone go too
const MAX_CODES = 64;
const TIME_LIMIT_MS = 8000; // give up on hopeless photos instead of freezing the page
const BLOCK = 8; // px per coarse cell when looking for blobs
const MIN_SIDE = 6; // coarse cells; smaller blobs are noise or text specks
const MAX_ASPECT = 2.5; // text lines are long and thin, QR codes are not
const SCALES = [1, 2, 3]; // retry large photos shrunk by these factors

function maskCode(data, width, height, loc) {
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = PAD * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const x1 = Math.min(width, Math.ceil(Math.max(...xs) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const y1 = Math.min(height, Math.ceil(Math.max(...ys) + pad));
  for (let y = y0; y < y1; y++) data.fill(255, (y * width + x0) * 4, (y * width + x1) * 4);
}

function crop(data, width, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * width + x0) * 4;
    out.set(data.subarray(from, from + w * 4), y * w * 4);
  }
  return out;
}

// Box-average the region down by an integer factor.
function shrink(data, width, x0, y0, w, h, f) {
  if (f === 1) return { buf: crop(data, width, x0, y0, w, h), w, h };
  const nw = Math.floor(w / f), nh = Math.floor(h / f);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y0 + y * f + dy) * width + x0 + x * f + dx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
      }
      const o = (y * nw + x) * 4, k = f * f;
      out[o] = r / k; out[o + 1] = g / k; out[o + 2] = b / k; out[o + 3] = 255;
    }
  }
  return { buf: out, w: nw, h: nh };
}

// Bounding boxes {x0,y0,w,h} (px, padded) of connected dark regions.
function findBlobs(data, width, height) {
  const gw = Math.ceil(width / BLOCK);
  const gh = Math.ceil(height / BLOCK);
  // per-cell darkest and mean luminance (every 2nd pixel is plenty)
  const lo = new Float32Array(gw * gh).fill(255);
  const sum = new Float32Array(gw * gh);
  const cnt = new Float32Array(gw * gh);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const c = Math.floor(y / BLOCK) * gw + Math.floor(x / BLOCK);
      if (l < lo[c]) lo[c] = l;
      sum[c] += l;
      cnt[c]++;
    }
  }
  // a cell is dark when its darkest pixel is well below the surrounding average,
  // so uneven lighting and dim photos do not need a fixed threshold
  const R = 6;
  const dark = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s2 = 0, n = 0;
      for (let ny = Math.max(0, y - R); ny <= Math.min(gh - 1, y + R); ny++) {
        for (let nx = Math.max(0, x - R); nx <= Math.min(gw - 1, x + R); nx++) {
          s2 += sum[ny * gw + nx];
          n += cnt[ny * gw + nx];
        }
      }
      if (n && lo[y * gw + x] < (s2 / n) * 0.5) dark[y * gw + x] = 1;
    }
  }
  // one cell of dilation closes the white gaps inside a code
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!dark[y * gw + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) grown[ny * gw + nx] = 1;
        }
      }
    }
  }
  const blobs = [];
  const seen = new Uint8Array(gw * gh);
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = gw, minY = gh, maxX = 0, maxY = 0;
    while (stack.length) {
      const cur = stack.pop();
      const x = cur % gw, y = (cur - x) / gw;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (grown[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < MIN_SIDE || bh < MIN_SIDE || Math.max(bw / bh, bh / bw) > MAX_ASPECT) continue;
    const x0 = Math.max(0, (minX - 1) * BLOCK);
    const y0 = Math.max(0, (minY - 1) * BLOCK);
    blobs.push({ x0, y0, w: Math.min(width, (maxX + 2) * BLOCK) - x0, h: Math.min(height, (maxY + 2) * BLOCK) - y0 });
  }
  return blobs;
}

export function scanAll(decode, imageData, width, height, opts = {}) {
  const data = new Uint8ClampedArray(imageData); // masked in place, keep caller's copy intact
  const texts = [];
  let budget = MAX_CODES;
  const deadline = Date.now() + TIME_LIMIT_MS;

  // Decode inside a region of `data` (trying shrunk copies too), masking each hit in the full image.
  const sweep = (x0, y0, w, h, scales = SCALES) => {
    scales = [...scales];
    let scale = 0;
    while (budget > 0 && scale < scales.length && Date.now() < deadline) {
      const f = scales[scale];
      const sub = shrink(data, width, x0, y0, w, h, f);
      if (sub.w < 21 || sub.h < 21) return;
      const code = decode(sub.buf, sub.w, sub.h, opts);
      if (!code) { scale++; continue; }
      budget--;
      if (!texts.includes(code.data)) texts.push(code.data);
      const map = (p) => ({ x: p.x * f + x0, y: p.y * f + y0 });
      const l = code.location;
      maskCode(data, width, height, {
        topLeftCorner: map(l.topLeftCorner), topRightCorner: map(l.topRightCorner),
        bottomRightCorner: map(l.bottomRightCorner), bottomLeftCorner: map(l.bottomLeftCorner),
      });
      scales = [f]; // a blob holds one code; only look for leftovers at the scale that worked
      scale = 0;
    }
  };

  sweep(0, 0, width, height, [1]); // cheap try; shrinking a whole page rarely helps
  for (const b of findBlobs(data, width, height)) sweep(b.x0, b.y0, b.w, b.h);
  return texts;
}
