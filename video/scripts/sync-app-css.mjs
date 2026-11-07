// Pulls the app's stylesheet straight out of public/app/index.html so the video
// cannot drift from how the product actually looks. Run on every dev/render.
//
// Nothing here is hand-maintained: change a variable in the app and the video
// follows on the next render. The only thing this script decides is that the
// app's html/body rules do not belong in a 1920x1080 frame; Video.tsx
// re-declares those afterwards, so its rules win on order.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..', '..', 'public', 'app', 'index.html');
const OUT = join(here, '..', 'src', 'app-css.ts');

const html = readFileSync(APP, 'utf8');
const match = html.match(/<style>([\s\S]*?)<\/style>/);
if (!match) {
  throw new Error(`No <style> block found in ${APP}`);
}

const css = match[1];

// Escape for a TS template literal.
const escaped = css
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const banner = `// GENERATED FILE - do not edit.
// Source: public/app/index.html  |  Regenerate: npm run sync-css
// ${css.split('\n').length} lines of the app's own stylesheet.
`;

writeFileSync(OUT, `${banner}export const appCss = \`${escaped}\`;\n`, 'utf8');
console.log(`sync-css: ${css.split('\n').length} lines -> src/app-css.ts`);
