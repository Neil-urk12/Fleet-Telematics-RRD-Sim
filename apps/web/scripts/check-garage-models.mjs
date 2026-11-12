// Offline check: every catalog EV in src/evModels.ts has its own body in the garage's MODELS table
// (src/components/garage/scene.js), and no model profile trips the nose → tail assert at load.
// Usage: node apps/web/scripts/check-garage-models.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let tripped = 0;
const consoleAssert = console.assert;
console.assert = (ok, ...rest) => { if (!ok) tripped++; consoleAssert(ok, ...rest); };

const { bodyFor, BODY_LABEL } = await import('../src/components/garage/scene.js');
// names are read as text so this runs on any Node, without TypeScript support
const names = [...(await readFile(new URL('../src/evModels.ts', import.meta.url), 'utf8')).matchAll(/model: '([^']+)'/g)].map(m => m[1]);

assert.ok(names.length > 0, 'no models found in evModels.ts');
assert.equal(tripped, 0, 'a model profile is out of order');
const generic = ['lumen', 'basalt'];
for (const name of names) assert.ok(!generic.includes(bodyFor(name)) && BODY_LABEL[bodyFor(name)], `${name} has no body in MODELS`);
assert.ok(generic.includes(bodyFor('Some unknown hatch')), 'unknown models must fall back to a generic body');
console.log(`ok: ${names.length} catalog models each have their own garage body`);
