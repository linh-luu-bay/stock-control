// Local development server: runs the real worker/server-template.js (built fresh on every
// start) against your REAL Supabase project, so dist/index.html can be exercised end-to-end
// without any Cloudflare account or deployment. Storage is Supabase/Postgres over its REST
// API, not a local emulated database -- every save here reaches the actual project named in
// worker/.env.local. Run supabase/schema.sql in that project's SQL Editor once before first use.
//
// DEV-ONLY: the Sites gateway normally supplies oai-authenticated-user-* headers after a real
// sign-in. There is no such gateway here, so this script stamps those headers itself from a
// fixed set of dev accounts, chosen with ?as=manager|supervisor|staff (persisted per browser via
// a cookie). Never reuse this identity shortcut outside local development.
//
// Usage: node tools/dev-server.mjs
//   PORT=8787 node tools/dev-server.mjs   (override the default port)
//
// Then open:
//   http://localhost:8787/?as=manager     (default if no ?as= or cookie is present)
//   http://localhost:8787/?as=supervisor
//   http://localhost:8787/?as=staff
// Use separate browsers or private windows to hold two roles signed in at once, since the
// role choice is stored in a same-origin cookie shared by every tab in one browser profile.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=Number(process.env.PORT)||8787;

function loadEnvLocal(){
  const envPath=path.join(root,'worker','.env.local');
  if(!fs.existsSync(envPath))return null;
  const values={};
  for(const line of fs.readFileSync(envPath,'utf8').split('\n')){
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith('#'))continue;
    const eq=trimmed.indexOf('=');
    if(eq<0)continue;
    values[trimmed.slice(0,eq).trim()]=trimmed.slice(eq+1).trim();
  }
  return values;
}

async function supabaseAdmin(env,pathAndQuery,init={}){
  return fetch(env.SUPABASE_URL+'/rest/v1'+pathAndQuery,{
    ...init,
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',...(init.headers||{})},
  });
}

const DEV_USERS=[
  {email:'dev-manager@bay-bellerive.local',name:'Dev Manager',role:'manager'},
  {email:'dev-supervisor@bay-bellerive.local',name:'Dev Supervisor',role:'supervisor'},
  {email:'dev-staff@bay-bellerive.local',name:'Dev Staff',role:'staff'},
];

function devUserFor(req){
  const url=new URL(req.url,'http://localhost');
  const cookieMatch=(req.headers.cookie||'').match(/bb_dev_role=([^;]+)/);
  const requested=url.searchParams.get('as')||(cookieMatch&&decodeURIComponent(cookieMatch[1]));
  return DEV_USERS.find(user=>user.role===requested)||DEV_USERS[0];
}

const STATIC_FILES={'/app-icon.svg':{file:'app-icon.svg',type:'image/svg+xml'}};

async function main(){
  const dotenv=loadEnvLocal()||{};
  const SUPABASE_URL=process.env.SUPABASE_URL||dotenv.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||dotenv.SUPABASE_SERVICE_ROLE_KEY;
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in worker/.env.local.');
    process.exitCode=1;return;
  }
  const env={SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY};

  console.log('Building worker bundle from worker/server-template.js…');
  execFileSync(process.execPath,[path.join(root,'tools','build-worker.mjs')],{stdio:'inherit',cwd:root});
  const builtPath=path.join(root,'dist','server','index.js');
  const worker=(await import(pathToFileURL(builtPath).href+'?bust='+Date.now())).default;

  console.log(`Checking Supabase project ${SUPABASE_URL} for the app's tables…`);
  const probe=await supabaseAdmin(env,'/app_state?limit=0');
  if(!probe.ok){
    const body=await probe.text().catch(()=>'');
    if(probe.status===404||/app_state/.test(body)){
      console.error('\nThe "app_state" table was not found in this Supabase project.');
      console.error('Open the Supabase Dashboard -> SQL Editor, paste the contents of supabase/schema.sql, and run it once. Then start this dev server again.\n');
    }else{
      console.error('Could not reach Supabase:',probe.status,body);
    }
    process.exitCode=1;return;
  }

  const nowIso=()=>new Date().toISOString();
  console.log('Seeding dev accounts into Supabase (only if missing)…');
  for(const person of DEV_USERS){
    const existing=await supabaseAdmin(env,`/users?email=eq.${encodeURIComponent(person.email)}&select=email`);
    const rows=existing.ok?await existing.json():[];
    if(rows.length)continue;
    const inserted=await supabaseAdmin(env,'/users',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({email:person.email,user_id:person.email,name:person.name,role:person.role,active:true,created_at:nowIso(),updated_at:nowIso()})});
    if(!inserted.ok)console.error(`Could not seed ${person.email}:`,inserted.status,await inserted.text().catch(()=>''));
  }
  console.log('Dev accounts ready in Supabase:',DEV_USERS.map(u=>`${u.role} <${u.email}>`).join(', '));
  console.log('These are real rows in your Supabase project (clearly marked dev-*@bay-bellerive.local) -- delete them from the users table whenever you like.');

  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const staticFile=STATIC_FILES[url.pathname];
    if(staticFile){
      res.writeHead(200,{'content-type':staticFile.type,'cache-control':'no-store'});
      res.end(fs.readFileSync(path.join(root,'dist',staticFile.file)));
      return;
    }
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const devUser=devUserFor(req);
    const headers=new Headers();
    headers.set('oai-authenticated-user-id',devUser.email);
    headers.set('oai-authenticated-user-email',devUser.email);
    headers.set('oai-authenticated-user-full-name',encodeURIComponent(devUser.name));
    headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
    if(req.headers['content-type'])headers.set('content-type',req.headers['content-type']);
    const fetchRequest=new Request('http://localhost:'+PORT+req.url,{method:req.method,headers,body:body.length?body:undefined});
    let response;
    try{
      response=await worker.fetch(fetchRequest,env);
    }catch(error){
      console.error(error);
      res.writeHead(500,{'content-type':'text/plain'});res.end('Dev server error: '+error.message);
      return;
    }
    const requestedRole=url.searchParams.get('as');
    const outHeaders=Object.fromEntries(response.headers.entries());
    if(requestedRole&&DEV_USERS.some(user=>user.role===requestedRole))outHeaders['set-cookie']=`bb_dev_role=${requestedRole}; Path=/`;
    res.writeHead(response.status,outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise(resolve=>server.listen(PORT,resolve));
  console.log(`\nBay Bellerive dev server running at http://localhost:${PORT}`);
  console.log('Switch role with ?as=manager | ?as=supervisor | ?as=staff (sticky per browser via cookie).\n');
}

await main();
