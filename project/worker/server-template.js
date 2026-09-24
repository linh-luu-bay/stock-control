const HTML = __HTML_JSON__;

const responseHeaders = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:responseHeaders});
const text = (value, status=200) => new Response(value, {status, headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
const now = () => new Date().toISOString();

// Independent authentication: verifies a Supabase Auth access token the browser sends as
// "Authorization: Bearer <token>" (see dist/index.html's magic-link sign-in flow). This
// replaces the old model of trusting oai-authenticated-user-* headers supplied by the Sites
// gateway. The apikey header below only satisfies Supabase's own API gateway routing -- the
// real identity comes from GoTrue validating the caller's own token, so this cannot be used
// to impersonate another account.
async function identity(request,env){
  const header=request.headers.get('authorization')||'';
  const match=header.match(/^Bearer\s+(.+)$/i);
  if(!match)return null;
  const token=match[1].trim();
  if(!token)return null;
  const response=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+token}});
  if(!response.ok)return null;
  const authUser=await response.json();
  const email=String(authUser?.email||'').trim().toLowerCase();
  if(!email)return null;
  return{userId:authUser.id,email,name:authUser.user_metadata?.full_name||email,token};
}

// Supabase (Postgres via PostgREST) data access with the service role key, used for stock
// state, sign-in checks and recovery points. The admin area deliberately does NOT use this --
// see asUser() below. Emails are always lower-cased before use (see identity() and the
// /api/users handler), so a plain `text` primary key is sufficient.
function supabaseHeaders(env,extra){
  return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',...extra};
}
async function supabaseRequest(env,path,init={}){
  const response=await fetch(env.SUPABASE_URL+'/rest/v1'+path,{...init,headers:{...supabaseHeaders(env),...(init.headers||{})}});
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error(`Shared database request failed (${response.status}). ${body}`.trim());
  }
  return response;
}

// Admin area data access: runs with the signed-in manager's OWN token plus the public anon
// key, never the service role key, so Supabase's row-level security decides what they may
// read or change (supabase/migrations/*_admin_access.sql) and the change log triggers can
// record who made each change. Errors come back as plain-English messages for the screen.
class AdminError extends Error{constructor(message,status=400){super(message);this.status=status}}
const CONSTRAINT_MESSAGES={
  suppliers_name_unique:'A supplier with that name already exists.',
  suppliers_name_required:'Enter the supplier name.',
  suppliers_order_email_format:'Enter a valid ordering email address.',
  suppliers_min_order_not_negative:'The minimum order can’t be negative.',
  suppliers_order_days_valid:'Choose order days from Monday to Sunday.',
  suppliers_delivery_days_valid:'Choose delivery days from Monday to Sunday.',
  users_pkey:'An account with that email address already exists.'
};
async function asUser(env,token,path,init={}){
  if(!env.SUPABASE_ANON_KEY)throw new AdminError('The admin area isn’t set up on this server yet (SUPABASE_ANON_KEY is missing).',503);
  const response=await fetch(env.SUPABASE_URL+'/rest/v1'+path,{...init,headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'content-type':'application/json',...(init.headers||{})}});
  if(response.ok)return response;
  let detail={};try{detail=await response.json()}catch{}
  const message=String(detail.message||'');
  if(detail.code==='23505'||detail.code==='23514'){
    const known=Object.keys(CONSTRAINT_MESSAGES).find(name=>message.includes(name));
    throw new AdminError(known?CONSTRAINT_MESSAGES[known]:'Some details aren’t valid. Check the form and try again.');
  }
  if(detail.code==='P0001')throw new AdminError(message); // raised by our own triggers, already plain English
  if(detail.code==='42501'||response.status===401||response.status===403)throw new AdminError('Only managers can do this.',403);
  if(['PGRST202','PGRST205','42P01','42883'].includes(detail.code))throw new AdminError('The admin area’s database changes haven’t been applied yet. Run the admin migrations (see README) and try again.',503);
  console.error('Admin request failed',response.status,detail);
  throw new AdminError('Something went wrong talking to the database. Please try again.',502);
}

const WEEK_DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function cleanText(value,max){const text=String(value??'').trim();return text?text.slice(0,max):null}
// partial=true validates only the fields sent (edits, archive/restore); false requires a full supplier.
function supplierFromBody(body,partial){
  const out={},has=key=>!partial||Object.prototype.hasOwnProperty.call(body,key);
  if(has('name')){const name=cleanText(body.name,120);if(!name)throw new AdminError('Enter the supplier name.');out.name=name}
  for(const key of ['rep_name','phone','account_number'])if(has(key))out[key]=cleanText(body[key],120);
  if(has('notes'))out.notes=cleanText(body.notes,2000);
  if(has('order_email')){
    const email=cleanText(body.order_email,200);
    if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new AdminError('Enter a valid ordering email address.');
    out.order_email=email;
  }
  for(const key of ['order_days','delivery_days'])if(has(key)){
    const days=Array.isArray(body[key])?body[key]:[];
    if(days.some(day=>!WEEK_DAYS.includes(day)))throw new AdminError('Choose days from Monday to Sunday.');
    out[key]=WEEK_DAYS.filter(day=>days.includes(day));
  }
  if(has('order_cutoff')){
    const time=cleanText(body.order_cutoff,8);
    if(time&&!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time))throw new AdminError('Enter the order cut-off as a time, for example 2:00 pm.');
    out.order_cutoff=time;
  }
  if(has('min_order_aud')){
    const raw=body.min_order_aud;
    if(raw===null||raw===undefined||raw==='')out.min_order_aud=null;
    else{
      const amount=Number(raw);
      if(!Number.isFinite(amount))throw new AdminError('Enter the minimum order as a dollar amount.');
      if(amount<0)throw new AdminError('The minimum order can’t be negative.');
      out.min_order_aud=Math.round(amount*100)/100;
    }
  }
  if(has('archived'))out.archived=body.archived===true;
  return out;
}
async function getUserByEmail(env,email){
  const response=await supabaseRequest(env,`/users?email=eq.${encodeURIComponent(email)}&select=email,user_id,name,role,active`);
  const rows=await response.json();
  return rows[0]||null;
}
async function touchUser(env,email,userId,name,stamp){
  await supabaseRequest(env,`/users?email=eq.${encodeURIComponent(email)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:userId,name,updated_at:stamp})});
}
async function getAppState(env){
  const response=await supabaseRequest(env,'/app_state?id=eq.1&select=value,revision');
  const rows=await response.json();
  return rows[0]||null;
}
async function insertInitialAppState(env,value,actorEmail,stamp){
  const response=await fetch(env.SUPABASE_URL+'/rest/v1/app_state',{method:'POST',headers:supabaseHeaders(env,{Prefer:'return=minimal'}),body:JSON.stringify({id:1,value,revision:1,updated_at:stamp,updated_by:actorEmail})});
  if(response.status===409)return false; // someone else's first save landed first
  if(!response.ok)throw new Error(`Shared database request failed (${response.status}). ${await response.text().catch(()=>'')}`.trim());
  return true;
}
// Calls the save_app_state() Postgres function (supabase/schema.sql), which performs the
// optimistic-lock update and the recovery-snapshot insert atomically in one transaction --
// the Postgres equivalent of the D1 version's env.DB.batch([...]). Returns the new revision,
// or null if expectedRevision no longer matches (someone else saved first).
async function saveAppStateAtomic(env,{expectedRevision,value,stamp,actorEmail,actorName,actorRole,snapshot}){
  const response=await supabaseRequest(env,'/rpc/save_app_state',{method:'POST',body:JSON.stringify({p_expected_revision:expectedRevision,p_value:value,p_stamp:stamp,p_actor_email:actorEmail,p_actor_name:actorName,p_actor_role:actorRole,p_snapshot:snapshot})});
  return response.json();
}
async function listRecoveryPoints(env){
  const response=await supabaseRequest(env,'/audit_events?action=eq.recovery_snapshot&select=id,occurred_at,actor_name&order=id.desc&limit=30');
  return response.json();
}
async function getRecoveryPoint(env,id){
  const response=await supabaseRequest(env,`/audit_events?id=eq.${encodeURIComponent(id)}&action=eq.recovery_snapshot&select=details`);
  const rows=await response.json();
  return rows[0]?rows[0].details:null;
}
async function ensureUser(env, person, ctx){
  const existing=await getUserByEmail(env,person.email);
  if(!existing)return null;
  // The users table is authoritative for name and role -- the identity provider's own
  // profile name is only used to prove the email, never to override what a manager set here.
  // Only bookkeeping, so let it finish after the response instead of delaying every request.
  const touch=touchUser(env,person.email,person.userId,existing.name,now()).catch(error=>console.error(error));
  if(ctx?.waitUntil)ctx.waitUntil(touch);else await touch;
  return{email:existing.email,name:existing.name,role:existing.role,active:Boolean(existing.active)};
}

function eventKey(event){return event.id||`${event.movementId||''}|${event.clientAt||event.at||''}|${event.type||''}|${event.area||''}|${event.item||''}`}
function itemKey(item){return item.id||`${item.a||''}|${String(item.n||'').trim().toLowerCase()}`}
function normaliseItem(item){return{...item,id:item.id||crypto.randomUUID(),location:item.location||'Not set',active:item.active!==false}}

// Apply this to every response containing records, including nested stocktakes.
function visibleState(value,user){
  if(user.role==='manager')return value;
  if(Array.isArray(value))return value.map(entry=>visibleState(entry,user));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/cost|price|margin|valuation/i.test(key)).map(([key,entry])=>[key,visibleState(entry,user)]));
  return value;
}

// Roles allowed to submit each stock-quantity movement type. Enforced server-side because
// the client-side UI restrictions (disabled inputs, hidden buttons) are only a convenience.
const QUANTITY_EVENT_ROLES={delivery:['manager','supervisor','staff'],wastage:['manager','supervisor','staff'],staff_meal:['manager','supervisor','staff'],correction:['manager','supervisor','staff'],transfer:['manager','supervisor','staff'],transfer_in:['manager','supervisor','staff'],stocktake:['manager','supervisor','staff'],count_adjustment:['manager','supervisor']};
// These types describe non-quantity edits (par level, item details) and never touch q.
const NON_QUANTITY_EVENT_ROLES={par_change:['manager'],item_update:['manager']};
const DIRECTION_RULES={delivery:'increase',wastage:'decrease',staff_meal:'decrease',transfer:'decrease',transfer_in:'increase'};

function itemsById(list){return new Map((list||[]).map(item=>[item.id,item]))}

// Recomputes each item's real quantity delta from previous->final data and cross-checks it
// against what the submitted history events claim, so a client can no longer attach an
// arbitrary, fabricated history entry to a write, or move stock with no matching record at all.
function validateEvents(newEvents, previousData, finalData, user){
  const previousMap=itemsById(previousData),finalMap=itemsById(finalData),byItem=new Map();
  for(const event of newEvents){
    const type=event.type;
    if(NON_QUANTITY_EVENT_ROLES[type]){
      if(!NON_QUANTITY_EVENT_ROLES[type].includes(user.role))return`This account is not allowed to record a ${type} entry.`;
      continue;
    }
    const allowedRoles=QUANTITY_EVENT_ROLES[type];
    if(!allowedRoles)return'Unrecognised stock movement type.';
    if(!allowedRoles.includes(user.role))return`This account is not allowed to record a ${type} entry.`;
    const itemId=event.itemId;
    if(!itemId||!finalMap.has(itemId))return'A stock movement referred to a product that no longer exists.';
    const before=Number(event.before),after=Number(event.after);
    if(!Number.isFinite(before)||!Number.isFinite(after))return'A stock movement is missing valid quantities.';
    const direction=DIRECTION_RULES[type];
    if(direction==='increase'&&after<before)return`A ${type} entry cannot reduce stock.`;
    if(direction==='decrease'&&after>before)return`A ${type} entry cannot increase stock.`;
    if(!byItem.has(itemId))byItem.set(itemId,[]);
    byItem.get(itemId).push({before,after});
  }
  for(const[itemId,events] of byItem){
    const beforeQ=previousMap.has(itemId)?Number(previousMap.get(itemId).q)||0:0;
    const afterQ=Number(finalMap.get(itemId).q)||0;
    const claimedDelta=events.reduce((sum,e)=>sum+(e.after-e.before),0);
    if(Math.abs((afterQ-beforeQ)-claimedDelta)>1e-6)return'A stock movement does not match the recorded quantity change.';
  }
  // Managers keep their existing full-trust model for direct data edits/recovery restores
  // (still fully audited server-side via the state_saved change summary); non-managers can
  // only move stock through the movement/stocktake/count-adjustment flows, which always
  // produce a matching event, so a change with no covering event means the UI was bypassed.
  if(user.role!=='manager'){
    for(const item of finalData){
      const beforeQ=previousMap.has(item.id)?Number(previousMap.get(item.id).q)||0:0;
      if(Math.abs((Number(item.q)||0)-beforeQ)>1e-6&&!byItem.has(item.id))return'A stock quantity changed without a matching history entry.';
    }
  }
  return null;
}

function summarizeQuantityChanges(previousData, finalData){
  const previousMap=itemsById(previousData),changes=[];
  for(const item of finalData){
    const beforeQ=previousMap.has(item.id)?previousMap.get(item.id).q:null,afterQ=item.q;
    // Either side being "not counted" (null) means there is no real quantity to diff --
    // treating it as 0 would log a fictitious full-quantity change (e.g. 20 -> null logged
    // as "-20", as if 20 units vanished, when really the count was just marked unknown).
    if(beforeQ===null||afterQ===null){
      if(beforeQ!==afterQ)changes.push({id:item.id,name:item.n,area:item.a,before:beforeQ,after:afterQ,delta:null});
      continue;
    }
    const before=Number(beforeQ)||0,after=Number(afterQ)||0;
    if(Math.abs(after-before)>1e-6)changes.push({id:item.id,name:item.n,area:item.a,before,after,delta:after-before});
  }
  return changes;
}

function secureState(incoming, previous, user){
  const suppliedData=Array.isArray(incoming.data)?incoming.data.map(normaliseItem):[];
  let data;
  if(user.role==='manager')data=suppliedData;
  else{
    const byId=new Map(suppliedData.map(item=>[itemKey(item),item]));
    data=(previous.data||[]).map(old=>{
      const candidate=byId.get(itemKey(old));
      if(!candidate)return old;
      // candidate.q===null means "marked not counted" and must survive as null, not be
      // coerced to 0 -- Number(null) is 0 and Number.isFinite(0) is true, so this needs an
      // explicit null check rather than relying on Number.isFinite alone.
      const secured={...old,q:candidate.q===null?null:(Number.isFinite(Number(candidate.q))?Number(candidate.q):old.q)};
      if(user.role!=='manager')secured.lastCost=old.lastCost;
      return secured;
    });
    for(const candidate of suppliedData){
      if(data.some(old=>itemKey(old)===itemKey(candidate)))continue;
      const source=data.find(old=>String(old.n||'').trim().toLowerCase()===String(candidate.n||'').trim().toLowerCase());
      if(source&&['Bar','Kitchen','Barista'].includes(candidate.a))data.push({...source,id:candidate.id||crypto.randomUUID(),a:candidate.a,q:Number(candidate.q)||0});
    }
  }
  const oldHistory=Array.isArray(previous.history)?previous.history:[];
  const knownEvents=new Set(oldHistory.map(eventKey));
  const newEvents=(Array.isArray(incoming.history)?incoming.history:[]).filter(event=>!knownEvents.has(eventKey(event))).map(event=>({...event,clientAt:event.clientAt||event.at,at:now(),recordedBy:user.name,recordedByEmail:user.email,unitCost:user.role==='manager'?event.unitCost:null}));
  const validationError=validateEvents(newEvents,previous.data||[],data,user);
  if(validationError)return{ok:false,error:validationError};
  const history=[...newEvents,...oldHistory];
  const oldStocktakes=Array.isArray(previous.stocktakes)?previous.stocktakes:[];
  const knownStocktakes=new Set(oldStocktakes.map(s=>s.id));
  const newStocktakes=(Array.isArray(incoming.stocktakes)?incoming.stocktakes:[]).filter(s=>s?.id&&!knownStocktakes.has(s.id)).map(s=>({...s,at:now(),recordedBy:user.name,recordedByEmail:user.email,status:'submitted'}));
  return{ok:true,state:{data,history,stocktakes:[...newStocktakes,...oldStocktakes]}};
}

async function audit(env,user,action,details){
  await supabaseRequest(env,'/audit_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({occurred_at:now(),actor_email:user.email,actor_name:user.name,actor_role:user.role,action,details:details??null})});
}

async function handleApi(request,env,url,ctx){
  const person=await identity(request,env);
  if(!person)return json({error:'Sign-in required'},401);
  const user=await ensureUser(env,person,ctx);
  if(!user)return json({error:'Ask a manager to add your staff account.'},403);
  if(!user.active)return json({error:'This account has been disabled'},403);
  if(url.pathname==='/api/recovery'&&request.method==='GET'){
    if(user.role!=='manager')return json({error:'Manager access required'},403);
    const id=url.searchParams.get('id');
    if(id){
      const point=await getRecoveryPoint(env,id);
      return point?json(point):json({error:'Recovery point not found'},404);
    }
    return json(await listRecoveryPoints(env));
  }
  if(url.pathname==='/api/bootstrap'&&request.method==='GET'){
    const row=await getAppState(env);
    return json({user,hasState:Boolean(row),state:row?visibleState(row.value,user):null,revision:Number(row?.revision||0)});
  }
  if(url.pathname==='/api/state'&&request.method==='PUT'){
    const raw=await request.text();
    if(raw.length>8000000)return json({error:'The stock record is too large'},413);
    let incoming;try{incoming=JSON.parse(raw)}catch{return json({error:'Invalid stock record'},400)}
    const row=await getAppState(env);
    const revision=Number(row?.revision||0);
    const stored=row?row.value:null;
    if(incoming.requestId&&stored?._lastRequest?.id===incoming.requestId&&stored._lastRequest.actor===user.email)return json({ok:true,revision});
    if(Number(incoming.revision)!==revision)return json({error:'revision_conflict',revision},409);
    const previous=stored||{data:[],history:[],stocktakes:[]};
    const result=secureState(incoming,previous,user);
    if(!result.ok)return json({error:result.error},400);
    const state=result.state;
    // null means "not yet counted" (q) or "no target set yet" (t) -- distinct from 0, and
    // deliberately allowed through. Anything else must be a valid non-negative number.
    const validCount=v=>v===null||(Number.isFinite(v)&&v>=0);
    if(state.data.some(item=>!validCount(item.q)||!validCount(item.t)||['tDay','tEvening','tEvent'].some(key=>item[key]!=null&&(!Number.isFinite(Number(item[key]))||Number(item[key])<0))))return json({error:'Stock and PAR quantities must be valid non-negative numbers, or left unset.'},400);
    state._lastRequest={id:incoming.requestId||null,actor:user.email};
    const stamp=now();
    if(row){
      const snapshot={format:'bay-bellerive-stock-backup',version:1,exportedAt:stamp,revision,...previous};
      const newRevision=await saveAppStateAtomic(env,{expectedRevision:revision,value:state,stamp,actorEmail:user.email,actorName:user.name,actorRole:user.role,snapshot});
      if(newRevision==null)return json({error:'revision_conflict'},409);
      await audit(env,user,'state_saved',{items:state.data.length,history:state.history.length,stocktakes:state.stocktakes.length,changes:summarizeQuantityChanges(previous.data||[],state.data)});
      return json({ok:true,revision:newRevision});
    }else{
      const inserted=await insertInitialAppState(env,state,user.email,stamp);
      if(!inserted)return json({error:'revision_conflict'},409);
      await audit(env,user,'state_saved',{items:state.data.length,history:state.history.length,stocktakes:state.stocktakes.length,changes:summarizeQuantityChanges([],state.data)});
      return json({ok:true,revision:1});
    }
  }
  if(url.pathname.startsWith('/api/admin/')||url.pathname==='/api/users'){
    // Checked here for a clear message; Supabase row-level security enforces it regardless.
    if(user.role!=='manager')return json({error:'Only managers can use the admin area.'},403);
    try{return await handleAdmin(request,env,url,user,person.token)}
    catch(error){if(error instanceof AdminError)return json({error:error.message},error.status);throw error}
  }
  return json({error:'Not found'},404);
}

async function handleAdmin(request,env,url,user,token){
  const path=url.pathname,method=request.method;
  const readBody=async()=>{try{return await request.json()}catch{throw new AdminError('The details sent couldn’t be read. Please try again.')}};
  if(path==='/api/admin/suppliers'&&method==='GET'){
    return json(await (await asUser(env,token,'/suppliers?select=*&order=name.asc')).json());
  }
  if(path==='/api/admin/suppliers'&&method==='POST'){
    const supplier=supplierFromBody(await readBody(),false);
    const rows=await (await asUser(env,token,'/suppliers',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(supplier)})).json();
    return json(rows[0],201);
  }
  if(path==='/api/admin/suppliers'&&method==='PATCH'){
    const id=url.searchParams.get('id')||'';
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new AdminError('That supplier couldn’t be found.',404);
    const changes=supplierFromBody(await readBody(),true);
    if(!Object.keys(changes).length)throw new AdminError('There was nothing to save.');
    const rows=await (await asUser(env,token,`/suppliers?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(changes)})).json();
    if(!rows.length)throw new AdminError('That supplier couldn’t be found.',404);
    return json(rows[0]);
  }
  if(path==='/api/admin/change-log'&&method==='GET'){
    const params=url.searchParams,day=key=>/^\d{4}-\d{2}-\d{2}$/.test(params.get(key)||'')?params.get(key):null,value=key=>(params.get(key)||'').trim()||null,before=Number(params.get('before'));
    const filters={p_from:day('from'),p_to:day('to'),p_user:value('user'),p_section:value('section'),p_action:value('action'),p_before:Number.isInteger(before)&&before>0?before:null,p_limit:100};
    return json(await (await asUser(env,token,'/rpc/admin_change_log',{method:'POST',body:JSON.stringify(filters)})).json());
  }
  if(path==='/api/admin/change-log/people'&&method==='GET'){
    const rows=await (await asUser(env,token,'/rpc/admin_change_log_people',{method:'POST',body:'{}'})).json();
    return json(rows.map(row=>row.user_name));
  }
  if(path==='/api/users'&&method==='GET'){
    return json(await (await asUser(env,token,'/users?select=email,name,role,active,created_at,updated_at&order=active.desc,name.asc')).json());
  }
  if(path==='/api/users'&&method==='POST'){
    const body=await readBody();
    const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),role=String(body.role||'staff'),active=body.active!==false;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!name||!['manager','supervisor','staff'].includes(role))throw new AdminError('Enter a name, a valid email address and an access level.');
    if(email===user.email&&(!active||role!=='manager'))throw new AdminError('You cannot disable or remove your own manager access.');
    const match=`/users?email=eq.${encodeURIComponent(email)}`;
    const existing=await (await asUser(env,token,match+'&select=email')).json();
    if(existing.length)await asUser(env,token,match,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({name,role,active,updated_at:now()})});
    else await asUser(env,token,'/users',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({email,name,role,active})});
    await audit(env,user,'user_updated',{email,role,active});
    return json({ok:true,created:!existing.length});
  }
  return json({error:'Not found'},404);
}

// Hands the page the Supabase project it should sign in against, so a preview deployment
// pointed at staging signs in to staging rather than production.
function pageHtml(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return HTML;
  const config=JSON.stringify({supabaseUrl:env.SUPABASE_URL,supabaseAnonKey:env.SUPABASE_ANON_KEY}).replace(/</g,'\\u003c');
  return HTML.replace('<script>',()=>`<script>window.BB_CONFIG=${config};</script><script>`);
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname.startsWith('/api/'))return await handleApi(request,env,url,ctx);
      if(url.pathname==='/'||url.pathname==='/index.html')return new Response(pageHtml(env),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
      if(url.pathname==='/manifest.webmanifest')return json({name:'Bay Bellerive Stock',short_name:'Bay Stock',start_url:'/',display:'standalone',background_color:'#f5f2e9',theme_color:'#132b28'});
      return text('Not found',404);
    }catch(error){console.error(error);return json({error:'The shared stock service is temporarily unavailable.'},500)}
  }
};
