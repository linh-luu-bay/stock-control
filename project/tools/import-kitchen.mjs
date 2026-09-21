// One-time data migration: imports Bay-Bellerive-Kitchen-Stocktake.json into the live
// Supabase app_state, remapping its 10 fine-grained categories onto the 8 the app's Kitchen
// tab actually renders, and preserving null quantities/targets as "not counted" / "not set"
// (requires the null-handling added to worker/server-template.js and dist/index.html --
// deploy that first, or these items will render wrong on a still-old live site).
//
// Usage: node tools/import-kitchen.mjs            (writes to Supabase)
//        node tools/import-kitchen.mjs --dry-run   (prints what would be written, no write)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

function loadEnvLocal() {
  const envPath = path.join(root, 'worker', '.env.local');
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}
const env = loadEnvLocal();
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in worker/.env.local.');
  process.exit(1);
}

async function supabase(pathAndQuery, init = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1' + pathAndQuery, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${await response.text().catch(() => '')}`);
  return response;
}

// Maps the stocktake file's 10 categories onto the 8 the app's Kitchen tab renders
// (dist/index.html categories.Kitchen). Fruit/Vegetables merge into the app's existing
// "Produce & perishables"; Meat/Seafood merge into "Meat & seafood"; Bread/Frozen/Consumables
// keep their own category (added to the app for this import); Dry store is unchanged.
const CATEGORY_MAP = {
  Consumables: 'Consumables',
  'Dry store': 'Dry store',
  Fruit: 'Produce & perishables',
  Vegetables: 'Produce & perishables',
  Dairy: 'Dairy & refrigerated',
  Refrigerated: 'Dairy & refrigerated',
  Meat: 'Meat & seafood',
  Seafood: 'Meat & seafood',
  Bread: 'Bread',
  Frozen: 'Frozen',
};

function mapItem(raw) {
  const category = CATEGORY_MAP[raw.c];
  if (!category) throw new Error(`Unmapped category "${raw.c}" on item "${raw.n}" -- add it to CATEGORY_MAP.`);
  return {
    id: raw.id,
    a: 'Kitchen',
    c: category,
    n: raw.n,
    q: raw.q === null || raw.q === undefined ? null : Number(raw.q),
    t: raw.t === null || raw.t === undefined ? null : Number(raw.t),
    u: raw.u,
    m: raw.m || 'Whole count',
    s: raw.s || 'Unassigned supplier',
    location: raw.location || 'Not set',
    active: raw.active !== false,
    p: Number(raw.p) || 1,
    pl: raw.pl || 'unit',
    photo: '',
  };
}

const stocktake = JSON.parse(fs.readFileSync(path.join(root, '..', 'Bay-Bellerive-Kitchen-Stocktake.json'), 'utf8'));
const imported = stocktake.data.map(mapItem);
console.log(`Mapped ${imported.length} kitchen items.`);
console.log(`  ${imported.filter(x => x.q === null).length} with unknown quantity ("Not counted").`);
console.log(`  ${imported.filter(x => x.t === null).length} with no PAR target set ("Not set").`);

if (dryRun) {
  console.log('\n--dry-run: not writing anything. Sample mapped item:');
  console.log(JSON.stringify(imported[0], null, 2));
  process.exit(0);
}

const stateResponse = await supabase('/app_state?id=eq.1&select=value,revision');
const rows = await stateResponse.json();
const row = rows[0];
if (!row) {
  console.error('No app_state row exists yet -- open the app once as a manager first so the initial state is created, then re-run this import.');
  process.exit(1);
}
const current = row.value;
const revision = Number(row.revision);
const existingIds = new Set((current.data || []).map(item => item.id));
const alreadyImported = imported.filter(item => existingIds.has(item.id));
if (alreadyImported.length) {
  console.error(`${alreadyImported.length} of these item ids already exist in the live state (already imported?). Aborting to avoid duplicates/overwrites -- review manually if this is unexpected.`);
  process.exit(1);
}
const mergedData = [...(current.data || []), ...imported];
const stamp = new Date().toISOString();
const snapshot = { format: 'bay-bellerive-stock-backup', version: 1, exportedAt: stamp, revision, ...current };

const rpcResponse = await supabase('/rpc/save_app_state', {
  method: 'POST',
  body: JSON.stringify({
    p_expected_revision: revision,
    p_value: { ...current, data: mergedData },
    p_stamp: stamp,
    p_actor_email: 'import-script@bay-bellerive.local',
    p_actor_name: 'Kitchen stocktake import',
    p_actor_role: 'manager',
    p_snapshot: snapshot,
  }),
});
const newRevision = await rpcResponse.json();
if (newRevision == null) {
  console.error('Save conflict -- someone else saved in between reading and writing. Re-run the import.');
  process.exit(1);
}
console.log(`\nImported ${imported.length} Kitchen items. Live state is now revision ${newRevision}.`);
console.log('A recovery snapshot of the pre-import state was created automatically -- see the app\'s Data backup dialog.');
