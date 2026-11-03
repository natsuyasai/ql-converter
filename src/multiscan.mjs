// Decode every QR code in one image. jsQR returns at most one code per call and
// gives up when several finder-pattern sets compete, so the image is scanned
// whole, then each separate dark blob (a QR plus its quiet zone keeps it apart
// from its neighbours) is cropped and scanned alone. Found codes are painted
// white so they are not found twice.
const PAD = 0.08; // grow the masked box so the finder patterns / quiet zone go too
const MAX_CODES = 64;
const BLOCK = 8; // px per coarse cell when looking for blobs
const MIN_BLOB = 3; // coarse cells; smaller blobs are noise or text specks

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

// Bounding boxes {x0,y0,w,h} (px, padded) of connected dark regions.
function findBlobs(data, width, height) {
  const gw = Math.ceil(width / BLOCK);
  const gh = Math.ceil(height / BLOCK);
  const dark = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 384) dark[Math.floor(y / BLOCK) * gw + Math.floor(x / BLOCK)] = 1;
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
    let minX = gw, minY = gh, maxX = 0, maxY = 0, n = 0;
    while (stack.length) {
      const cur = stack.pop();
      const x = cur % gw, y = (cur - x) / gw;
      n++;
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
    if (n < MIN_BLOB) continue;
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

  // Decode inside a region of `data`, masking each hit in the full image.
  const sweep = (x0, y0, w, h) => {
    while (budget > 0) {
      const sub = x0 === 0 && y0 === 0 && w === width && h === height ? data : crop(data, width, x0, y0, w, h);
      const code = decode(sub, w, h, opts);
      if (!code) return;
      budget--;
      if (!texts.includes(code.data)) texts.push(code.data);
      const shift = (p) => ({ x: p.x + x0, y: p.y + y0 });
      const l = code.location;
      maskCode(data, width, height, {
        topLeftCorner: shift(l.topLeftCorner), topRightCorner: shift(l.topRightCorner),
        bottomRightCorner: shift(l.bottomRightCorner), bottomLeftCorner: shift(l.bottomLeftCorner),
      });
    }
  };

  sweep(0, 0, width, height);
  for (const b of findBlobs(data, width, height)) sweep(b.x0, b.y0, b.w, b.h);
  return texts;
}
