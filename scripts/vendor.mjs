// Bundles browser-facing dependencies from node_modules into vendor/*.mjs
// (committed) so the GitHub Pages site needs no build step or CDN.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = {
  fflate: 'fflate',
  'qrcode-generator': 'qrcode-generator',
  jsqr: 'jsqr',
};

for (const [name, mod] of Object.entries(entries)) {
  await build({
    stdin: {
      contents: name === 'fflate'
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
