// Tiny build script for the Pages frontend.
//
// One JS bundle (esbuild, ESM, target ES2022) + one concatenated CSS file.
// Sourcemaps in dev (NODE_ENV != 'production'), minified in production.
//
//   node pages/build.mjs            # one-shot build
//   node pages/build.mjs --watch    # esbuild watch + fs.watch on styles/

import { build, context } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(__dirname, 'src', 'styles');
const publicDir = path.join(__dirname, 'public');

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

const buildOptions = {
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  outfile: path.join(publicDir, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: isProd,
  sourcemap: !isProd,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
  },
};

async function bundleCss() {
  const files = (await readdir(stylesDir)).filter((f) => f.endsWith('.css')).sort();
  const parts = await Promise.all(
    files.map((f) => readFile(path.join(stylesDir, f), 'utf8')),
  );
  const banner = `/* generated ${new Date().toISOString()} from pages/src/styles/${files.join(', ')} */\n\n`;
  await writeFile(path.join(publicDir, 'app.css'), banner + parts.join('\n\n'));
  // eslint-disable-next-line no-console -- build script
  console.log(`[css] wrote ${files.length} files -> public/app.css`);
}

await mkdir(publicDir, { recursive: true });

if (isWatch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  await bundleCss();
  fsWatch(stylesDir, { recursive: false }, () => {
    bundleCss().catch((err) => {
      // eslint-disable-next-line no-console -- build script
      console.error('[css] rebuild failed', err);
    });
  });
  // eslint-disable-next-line no-console -- build script
  console.log('[watch] esbuild + css watching; ctrl-c to stop');
} else {
  await build(buildOptions);
  await bundleCss();
  // eslint-disable-next-line no-console -- build script
  console.log('[build] done');
}
