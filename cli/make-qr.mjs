// Usage: node cli/make-qr.mjs <file> [-o out.png] [--ec M] [--chunk 600] [--per-page 12]
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { encodeTransfer } from '../src/protocol.mjs';
import { buildMatrices } from '../src/qr.mjs';
import { A4, planLayout, drawPage } from '../src/layout.mjs';

export async function makeQrImages(inputPath, opts = {}) {
  const bytes = new Uint8Array(await readFile(inputPath));
  const name = basename(inputPath);
  const { payloads, total, warnings } = await encodeTransfer(bytes, name, { chunkChars: opts.chunkChars });
  const { moduleCount, matrices } = buildMatrices(payloads, opts.ec ?? 'M');
  const plan = planLayout(moduleCount, total, { maxPerPage: opts.maxPerPage });

  const out = opts.out ?? join(dirname(inputPath), `${name}.qr.png`);
  const ext = extname(out) || '.png';
  const stem = out.slice(0, out.length - extname(out).length);

  const files = [];
  for (let page = 0; page < plan.pageCount; page++) {
    const canvas = createCanvas(A4.width, A4.height);
    drawPage(canvas.getContext('2d'), plan, page, matrices, { name, total });
    const file = plan.pageCount === 1 ? out : `${stem}-${page + 1}${ext}`;
    await writeFile(file, canvas.toBuffer('image/png'));
    files.push(file);
  }
  return { files, total, warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      ec: { type: 'string' },
      chunk: { type: 'string' },
      'per-page': { type: 'string' },
    },
  });
  if (positionals.length !== 1) {
    console.error('usage: node cli/make-qr.mjs <file> [-o out.png] [--ec L|M|Q|H] [--chunk 600] [--per-page 12]');
    process.exit(2);
  }
  try {
    const r = await makeQrImages(positionals[0], {
      out: values.out,
      ec: values.ec,
      chunkChars: values.chunk ? Number(values.chunk) : undefined,
      maxPerPage: values['per-page'] ? Number(values['per-page']) : undefined,
    });
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    console.log(`QR ${r.total} 枚 → ${r.files.length} ページ`);
    for (const f of r.files) console.log(f);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
