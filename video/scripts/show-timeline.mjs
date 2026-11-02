// Prints how every beat's length was arrived at, and whether it is set by the
// line or by its minHold floor. Use it when tuning SPEED, LEAD, TAIL or a
// floor: a beat marked FLOOR is holding longer than its line needs, which is
// correct for act3-split and usually dead air anywhere else.
//
//   npm run timeline
import {rmSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const tmp = join(root, 'node_modules', '.cache-timeline.mjs');
mkdirSync(dirname(tmp), {recursive: true});
await build({
  entryPoints: [join(root, 'src', 'script.ts')],
  outfile: tmp,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
});
const {timeline, speech, floors, SPEED, LEAD, TAIL, FPS} = await import(
  `file://${tmp}?t=${Date.now()}`
);
rmSync(tmp, {force: true});

console.log(`SPEED ${SPEED}   LEAD ${LEAD}s   TAIL ${TAIL}s\n`);
console.log('beat              spoken   needed   floor     used   set by');

let total = 0;
let dead = 0;
for (const beat of timeline) {
  const spoken = (speech[beat.id] ?? 0) / SPEED;
  const needed = spoken > 0 ? LEAD + spoken + TAIL : 0;
  const floor = floors[beat.id];
  const used = beat.frames / FPS;
  total += used;
  const byFloor = floor > needed;
  if (byFloor && spoken > 0) dead += floor - needed;
  console.log(
    `${beat.id.padEnd(16)} ${spoken.toFixed(2).padStart(6)}s ${needed
      .toFixed(2)
      .padStart(7)}s ${String(floor).padStart(6)}s ${used.toFixed(2).padStart(7)}s   ${
      byFloor ? `FLOOR  +${(floor - needed).toFixed(1)}s` : 'speech'
    }`,
  );
}
console.log(`\ntotal ${total.toFixed(1)}s   (${dead.toFixed(1)}s of it held by floors)`);
