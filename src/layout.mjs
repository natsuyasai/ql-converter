// A4 page layout and drawing for QR grids. drawPage only needs a Canvas 2D
// context, so the browser (<canvas>) and Node (@napi-rs/canvas) share it.
export const A4 = { width: 2480, height: 3508 }; // 300dpi
const MARGIN = 120;
const TITLE_H = 200;
const LABEL_H = 70;
const QUIET = 4; // quiet-zone modules around each QR
const MAX_COLS = 4;
const MAX_ROWS = 6;

function cellSize(cols, rows) {
  return {
    w: (A4.width - 2 * MARGIN) / cols,
    h: (A4.height - 2 * MARGIN - TITLE_H) / rows,
  };
}

export function planLayout(moduleCount, qrCount, opts = {}) {
  const minModulePx = opts.minModulePx ?? 6;
  const maxPerPage = opts.maxPerPage ?? 12;
  const span = moduleCount + 2 * QUIET;
  let best = null;
  for (let cols = 1; cols <= MAX_COLS; cols++) {
    for (let rows = 1; rows <= MAX_ROWS; rows++) {
      const perPage = cols * rows;
      if (perPage > maxPerPage) continue;
      const { w, h } = cellSize(cols, rows);
      const modulePx = Math.floor(Math.min(w / span, (h - LABEL_H) / span));
      if (modulePx < minModulePx) continue;
      const pageCount = Math.ceil(qrCount / perPage);
      if (!best || pageCount < best.pageCount ||
          (pageCount === best.pageCount && modulePx > best.modulePx)) {
        best = { cols, rows, perPage, pageCount, modulePx };
      }
    }
  }
  if (best) return best;
  const { w, h } = cellSize(1, 1);
  const modulePx = Math.max(1, Math.floor(Math.min(w / span, (h - LABEL_H) / span)));
  return { cols: 1, rows: 1, perPage: 1, pageCount: qrCount, modulePx };
}

export function drawPage(ctx, plan, pageIndex, matrices, meta) {
  const { cols, rows, perPage, pageCount, modulePx } = plan;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, A4.width, A4.height);

  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(`${meta.name}  (${pageIndex + 1}/${pageCount} ページ)`, MARGIN, MARGIN + TITLE_H / 2);

  const { w, h } = cellSize(cols, rows);
  const first = pageIndex * perPage;
  const last = Math.min(first + perPage, matrices.length);
  ctx.textAlign = 'center';
  ctx.font = 'bold 48px sans-serif';
  for (let i = first; i < last; i++) {
    const k = i - first;
    const col = k % cols;
    const row = Math.floor(k / cols);
    const matrix = matrices[i];
    const size = matrix.length * modulePx;
    const x0 = MARGIN + col * w + (w - size) / 2;
    const y0 = MARGIN + TITLE_H + row * h + (h - LABEL_H - size) / 2;
    ctx.fillStyle = '#000';
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix.length; c++) {
        if (matrix[r][c]) ctx.fillRect(Math.round(x0 + c * modulePx), Math.round(y0 + r * modulePx), modulePx, modulePx);
      }
    }
    ctx.fillText(`${i + 1}/${meta.total}`, MARGIN + col * w + w / 2, y0 + size + LABEL_H / 2 + QUIET * modulePx / 2);
  }
}
