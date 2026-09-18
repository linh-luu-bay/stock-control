// Local development server: runs the real worker/server-template.js (built fresh on every
// start) against your REAL Supabase project, so dist/index.html can be exercised end-to-end
// without any Cloudflare account or deployment. Storage is Supabase/Postgres over its REST
// API, not a local emulated database -- every save here reaches the actual project named in
// worker/.env.local. Run supabase/schema.sql in that project's SQL Editor once before first use.
//
// Authentication is the real thing: dist/index.html's magic-link sign-in talks straight to
// Supabase Auth, so this script does no identity stamping of its own -- it is a plain proxy
// from http://localhost:PORT to worker.fetch(request, env). Whoever signs in must already be
// an active row in the users table (see the bootstrap check below for the very first one).
//
// Usage: node tools/dev-server.mjs
//   PORT=8787 node tools/dev-server.mjs   (override the default port; keep it matching
//   whatever Site URL / Redirect URL you registered in Supabase's Auth settings)

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

  const usersProbe=await supabaseAdmin(env,'/users?select=email&limit=1');
  const anyUsers=usersProbe.ok?await usersProbe.json():[];
  if(!anyUsers.length){
    console.log('\nNo staff accounts exist yet, so nobody can sign in -- the Accounts screen itself');
    console.log('requires being signed in as a manager already. Run this once in the Supabase SQL');
    console.log("Editor, using YOUR OWN real email (it needs to receive the magic-link email):\n");
    console.log("  insert into users(email, user_id, name, role, active, created_at, updated_at)");
    console.log("  values ('your-real-email@example.com', null, 'Your Name', 'manager', true, now(), now());\n");
  }

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
    const headers=new Headers();
    if(req.headers['content-type'])headers.set('content-type',req.headers['content-type']);
    if(req.headers['authorization'])headers.set('authorization',req.headers['authorization']);
    const fetchRequest=new Request('http://localhost:'+PORT+req.url,{method:req.method,headers,body:body.length?body:undefined});
    let response;
    try{
      response=await worker.fetch(fetchRequest,env);
    }catch(error){
      console.error(error);
      res.writeHead(500,{'content-type':'text/plain'});res.end('Dev server error: '+error.message);
      return;
    }
    res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise(resolve=>server.listen(PORT,resolve));
  console.log(`\nBay Bellerive dev server running at http://localhost:${PORT}`);
  console.log('This must match the Site URL / Redirect URL registered in Supabase Auth settings.\n');
}

await main();
