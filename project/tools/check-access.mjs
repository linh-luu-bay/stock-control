import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../worker/server-template.js',import.meta.url),'utf8').replace('__HTML_JSON__','""').replace('export default{','globalThis.worker={');
const ctx=vm.createContext({Response,Request,URL,Headers,crypto:webcrypto,console,fetch:undefined});
vm.runInContext(source,ctx);
const run=expression=>vm.runInContext(expression,ctx);
run(`globalThis.sample={data:[{id:'a',q:3,lastCost:12}],history:[{unitCost:12,item:'Wine'}],stocktakes:[{counts:[{cost:9}]}]}`);
assert.equal(run(`JSON.stringify(visibleState(sample,{role:'staff'}))`).includes('Cost'),false);
assert.equal(run(`JSON.stringify(visibleState(sample,{role:'supervisor'}))`).includes('cost'),false);
assert.equal(run(`visibleState(sample,{role:'manager'}).data[0].lastCost`),12);
assert.equal(run(`eventKey({at:'server',clientAt:'client',type:'delivery'})===eventKey({at:'client',type:'delivery'})`),true);

// ensureUser() now reaches Supabase over fetch() instead of a D1 binding. Stub fetch inside
// the vm context to answer like PostgREST would, without any network access, and check the
// "account not registered" rejection this stub is exercising.
ctx.fetch=async(url)=>{
  if(String(url).includes('/users?email=eq.unlisted%40example.com'))return new Response('[]',{status:200});
  throw new Error('Unexpected fetch in check-access unit test: '+url);
};
ctx.env={SUPABASE_URL:'https://fake.test',SUPABASE_SERVICE_ROLE_KEY:'fake-service-key'};
assert.equal(await run(`ensureUser(env,{email:'unlisted@example.com',userId:'x'})`),null);

const denied=await ctx.worker.fetch(new Request('https://stock.example/api/users'),{});
assert.equal(denied.status,401);

const script=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
console.log('PASS: cost redaction, retained manager costs, stable event deduplication, unlisted-account rejection (via stubbed Supabase fetch), anonymous API rejection, client syntax.');
console.log('NOTE: the full role/atomicity/conflict integration coverage this file used to run against an in-memory D1-shaped SQLite database no longer applies now that storage is Supabase/Postgres over HTTP (see worker/server-template.js and supabase/schema.sql). That coverage needs either a fake-PostgREST mock or an opt-in run against a real Supabase project -- neither is implemented yet, so treat handleApi()\'s Supabase-backed paths as manually verified only (see tools/dev-server.mjs) until that is added.');
