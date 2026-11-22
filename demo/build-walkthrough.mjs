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
   demo.js, which the page fetches by path. This inlines it, and bakes the club
   settings in so they apply on a double-click, where there is no query string
   to read them from. Appending ?something=... in the address bar still
   overrides them, and those values are cleaned the same way as in the served
   demo.

   Demo mode is always on in this file, whatever the address says. The loader
   from index.html is kept, so if the inlined script ever fails to run the
   file shows "Demo mode could not start" and never the real app.

   What stays online: the webfonts, and nothing else. The file carries its
   Content-Security-Policy as a tag at the top of <head>, so the payment
   processor's two <script> tags, which are still in the markup, are refused
   before they are requested. With no network the type falls back.
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

// ── 2. keep the loader, and put the script straight after it ────────────────
// The loader is what makes demo mode fail closed: it holds the app's start
// until the demo script reports in, and blocks outside requests. The one-file
// build needs all of that too, so the loader stays, is told the demo is always
// on and that the script is already on the page, and the script follows it.
// If the script ever fails to run, the file shows the loader's "could not
// start" sentence and not the real app.
function stop(message) {
  console.error(message);
  process.exit(1);
}
const LOADER = /<script>\s*\/\/ Demo mode\.[\s\S]*?<\/script>/;
const found = html.match(LOADER);
if (!found) stop('The demo-mode loader is not where this script expects it in public/app/index.html.');

const INLINE_ANCHOR = 'var INLINE = false;';
if (found[0].split(INLINE_ANCHOR).length !== 2) {
  stop('The loader no longer has exactly one `' + INLINE_ANCHOR + '`. Fix the anchor in demo/build-walkthrough.mjs.');
}
const loader = found[0].replace(INLINE_ANCHOR, 'var INLINE = true;');

const policy = found[0].match(/var CSP = "([^"]+)";/);
if (!policy) stop('The loader no longer defines its policy as `var CSP = "...";`. Fix the anchor in demo/build-walkthrough.mjs.');

// </script> inside the file would close this tag early. Only one sequence can
// do that and it is cheaper to neutralise it than to reason about where it
// might appear.
const inlined = '<script>\n' + patchedDemo.replace(/<\/script>/gi, '<\\/script>') + '\n</script>';

// The replacement goes in through a function, not as a string. demo.js writes
// money as '$' + n, and a string replacement reads the `$'` in that literal as
// "everything after the match", which splices the remaining 300KB of the page
// into the middle of the script. It fails as a syntax error rather than as
// anything legible.
let out = html.replace(LOADER, () => loader + '\n' + inlined);

// ── 3. the same policy as a real tag, ahead of everything else ──────────────
// The served app can only write its policy from the loader, because a visit
// without the demo flag must not carry one. This file is always the demo, so
// the policy can be in the markup itself, where it applies before any script
// runs and before the browser looks ahead for things to fetch.
const HEAD_ANCHOR = '<meta charset="UTF-8">';
if (out.split(HEAD_ANCHOR).length !== 2) stop('public/app/index.html no longer starts its <head> with ' + HEAD_ANCHOR + '.');
const policyTag = '<meta http-equiv="Content-Security-Policy" content="' + policy[1] + '">';
out = out.replace(HEAD_ANCHOR, () => HEAD_ANCHOR + '\n' + policyTag);
if (out.indexOf(policyTag) > out.indexOf('<script')) stop('The policy tag did not land ahead of the first script.');

// ── 4. the two footer links have nothing to point at from a local file ──────
out = out
  .replace(/href="\.\.\/privacy-policy\.html"/g, 'href="https://www.playfundai.com/privacy-policy.html" target="_blank" rel="noopener"')
  .replace(/href="\.\.\/terms-of-service\.html"/g, 'href="https://www.playfundai.com/terms-of-service.html" target="_blank" rel="noopener"');

await mkdir(outDir, { recursive: true });
await writeFile(outFile, out, 'utf8');

const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`${outFile}  ${kb}KB  (${defaults.toString()})`);
