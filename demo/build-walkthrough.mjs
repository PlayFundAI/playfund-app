#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   The whole demo as one HTML file you can double-click.

     node demo/build-walkthrough.mjs
     node demo/build-walkthrough.mjs --club "Northside Select" \
          --city "Charlotte, NC" --dues 1200 --athletes 64

   Output: out/playfund-walkthrough.html

   No server, no install, no terminal. It opens from the filesystem, it can be
   emailed, and it can be carried on a USB stick into a club's office.

   How: the app has no images, no local stylesheets and no local scripts of its
   own, so the only thing standing between index.html and a standalone file was
   demo.js, which the page fetches by relative path. This inlines it, and bakes
   the club settings in so they apply on a double-click, where there is no
   query string to read them from. Appending ?something=... in the address bar
   still overrides them.

   What stays online: the webfonts and Stripe's two SDKs, which are the same
   <script> tags the real app carries. With no network the type falls back and
   demo mode's stand-ins take over, which is exactly what happens in the served
   version. Nothing else leaves the page in either case.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(here, 'out');

const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
}

// Baked-in defaults. Only the ones actually passed are written, so an unedited
// build carries `demo=1&guide=1` and nothing else, and the fixture's own
// defaults (Riverside, $1,000, 58 athletes) still come from demo.js.
const defaults = new URLSearchParams({ demo: '1', guide: '1' });
for (const name of ['club', 'city', 'sport', 'clubcode', 'dues', 'fee', 'athletes', 'admin', 'email', 'auto', 'hold', 'pending']) {
  const v = arg(name, null);
  if (v != null) defaults.set(name, v);
}

const outFile = path.join(outDir, arg('out', 'playfund-walkthrough.html'));

const html = await readFile(path.join(root, 'public/app/index.html'), 'utf8');
const demo = await readFile(path.join(root, 'public/app/demo.js'), 'utf8');

// ── 1. make the baked-in settings readable without a query string ───────────
const QS_ANCHOR = "  var qs = new URLSearchParams(window.location.search);";
if (!demo.includes(QS_ANCHOR)) {
  console.error('demo.js no longer defines qs the way this script expects. Fix the anchor in demo/build-walkthrough.mjs.');
  process.exit(1);
}
const patchedDemo = demo.replace(
  QS_ANCHOR,
  () =>
  "  var qs = (function () {\n" +
  "    // Built as a standalone file, so the settings are baked in rather than\n" +
  "    // read from a query string there is no way to supply on a double-click.\n" +
  "    // Anything typed into the address bar still wins over them.\n" +
  "    var q = new URLSearchParams(window.location.search);\n" +
  "    new URLSearchParams(" + JSON.stringify(defaults.toString()) + ")\n" +
  "      .forEach(function (v, k) { if (!q.has(k)) q.set(k, v); });\n" +
  "    return q;\n" +
  "  })();"
);

// ── 2. swap the loader for the script itself ────────────────────────────────
const LOADER = /<script>\s*\/\/ Demo mode\.[\s\S]*?<\/script>/;
if (!LOADER.test(html)) {
  console.error('The demo-mode loader is not where this script expects it in public/app/index.html.');
  process.exit(1);
}

// </script> inside the file would close this tag early. Only one sequence can
// do that and it is cheaper to neutralise it than to reason about where it
// might appear.
const inlined = '<script>\n' + patchedDemo.replace(/<\/script>/gi, '<\\/script>') + '\n</script>';

// The replacement goes in through a function, not as a string. demo.js writes
// money as '$' + n, and a string replacement reads the `$'` in that literal as
// "everything after the match", which splices the remaining 300KB of the page
// into the middle of the script. It fails as a syntax error rather than as
// anything legible.
let out = html.replace(LOADER, () => inlined);

// ── 3. the two footer links have nothing to point at from a local file ──────
out = out
  .replace(/href="\.\.\/privacy-policy\.html"/g, 'href="https://www.playfundai.com/privacy-policy.html" target="_blank" rel="noopener"')
  .replace(/href="\.\.\/terms-of-service\.html"/g, 'href="https://www.playfundai.com/terms-of-service.html" target="_blank" rel="noopener"');

await mkdir(outDir, { recursive: true });
await writeFile(outFile, out, 'utf8');

const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`${outFile}  ${kb}KB  (${defaults.toString()})`);
