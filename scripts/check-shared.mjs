// Checks that src/shared/* are the same as the pos-backend files they copy (apart from the header note).
// Usage: npm run check:shared [path to pos-backend]   (default ../pos-backend)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const backend = resolve(process.argv[2] ?? '../pos-backend');
if (!existsSync(backend + '/src')) {
  console.error(`pos-backend not found at ${backend}. Clone it next to this folder or pass its path.`);
  process.exit(2);
}
const files = { 'promotions.ts': 'src/promotions/engine.ts', 'coupons.ts': 'src/coupons/calc.ts', 'cash.ts': 'src/sales/cash.ts' };
// Both copies start with a /* SHARED WITH ... */ note; compare what follows it.
const body = (path) => readFileSync(path, 'utf8').replace(/^\/\*\s*\n \* SHARED WITH THE (FRONTEND|BACKEND)[\s\S]*?\*\/\n/, '');
let bad = 0;
for (const [mine, theirs] of Object.entries(files)) {
  const same = body(`src/shared/${mine}`) === body(`${backend}/${theirs}`);
  console.log(`${same ? 'same     ' : 'DIFFERENT'}  src/shared/${mine}  ↔  pos-backend/${theirs}`);
  if (!same) bad++;
}
if (bad) {
  console.error(`\n${bad} file(s) differ: copy the change to both projects.`);
  process.exit(1);
}
