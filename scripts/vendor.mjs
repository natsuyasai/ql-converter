// Bundles browser-facing dependencies from node_modules into vendor/*.mjs
// (committed) so the GitHub Pages site needs no build step or CDN.
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = {
  fflate: 'fflate',
  'qrcode-generator': 'qrcode-generator',
  jsqr: 'jsqr',
  'zxing-reader': 'zxing-wasm/reader',
};

for (const [name, mod] of Object.entries(entries)) {
  await build({
    stdin: {
      contents: name === 'fflate' || name === 'zxing-reader'
        ? `export * from '${mod}';`
        : `import m from '${mod}'; export default m;`,
      resolveDir: root,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: join(root, 'vendor', `${name}.mjs`),
    logLevel: 'warning',
  });
  console.log(`vendor/${name}.mjs`);
}

// zxing-wasm fetches its WebAssembly binary at runtime; ship it next to the bundle.
await copyFile(join(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'), join(root, 'vendor', 'zxing_reader.wasm'));
console.log('vendor/zxing_reader.wasm');
