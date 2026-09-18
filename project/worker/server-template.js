const HTML = __HTML_JSON__;

const responseHeaders = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:responseHeaders});
const text = (value, status=200) => new Response(value, {status, headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
const now = () => new Date().toISOString();

function identity(request){
  const userId=request.headers.get('oai-authenticated-user-id');
  const email=(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
  let name=email||'Signed-in staff member';
  const encoded=request.headers.get('oai-authenticated-user-full-name');
  if(encoded&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
    try{name=decodeURIComponent(encoded)}catch{}
  }
  if(!userId||!email)return null;
  return{userId,email,name};
}

// Supabase (Postgres via PostgREST) data access. The Worker holds the only credential that
// can reach these tables at all -- see supabase/schema.sql, which enables RLS with no
// policies so the anon key gets zero access. Emails are always lower-cased before use (see
// identity() and the /api/users handler), so a plain `text` primary key is sufficient.
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
async function listUsers(env){
  const response=await supabaseRequest(env,'/users?select=email,name,role,active,created_at,updated_at&order=active.desc,name.asc');
  return response.json();
}
async function upsertUser(env,{email,name,role,active,stamp}){
  await supabaseRequest(env,'/rpc/upsert_user',{method:'POST',body:JSON.stringify({p_email:email,p_name:name,p_role:role,p_active:active,p_stamp:stamp})});
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
async function ensureUser(env, person){
  const existing=await getUserByEmail(env,person.email);
  if(!existing)return null;
  await touchUser(env,person.email,person.userId,person.name||existing.name,now());
  return{email:existing.email,name:person.name||existing.name,role:existing.role,active:Boolean(existing.active)};
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
    const beforeQ=previousMap.has(item.id)?Number(previousMap.get(item.id).q)||0:0,afterQ=Number(item.q)||0;
    if(Math.abs(afterQ-beforeQ)>1e-6)changes.push({id:item.id,name:item.n,area:item.a,before:beforeQ,after:afterQ,delta:afterQ-beforeQ});
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
      const secured={...old,q:Number.isFinite(Number(candidate.q))?Number(candidate.q):old.q};
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

async function handleApi(request,env,url){
  const person=identity(request);
  if(!person)return json({error:'Sign-in required'},401);
  const user=await ensureUser(env,person);
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
    if(state.data.some(item=>!Number.isFinite(item.q)||item.q<0||!Number.isFinite(item.t)||item.t<0||['tDay','tEvening','tEvent'].some(key=>item[key]!=null&&(!Number.isFinite(Number(item[key]))||Number(item[key])<0))))return json({error:'Stock and PAR quantities must be valid non-negative numbers.'},400);
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
  if(url.pathname==='/api/users'&&request.method==='GET'){
    if(user.role!=='manager')return json({error:'Manager access required'},403);
    return json(await listUsers(env));
  }
  if(url.pathname==='/api/users'&&request.method==='POST'){
    if(user.role!=='manager')return json({error:'Manager access required'},403);
    let body;try{body=await request.json()}catch{return text('Invalid account details',400)}
    const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),role=String(body.role||'staff'),active=body.active!==false;
    if(!email.includes('@')||!name||!['manager','supervisor','staff'].includes(role))return text('Enter a valid name, email address and access level.',400);
    if(email===user.email&&(!active||role!=='manager'))return text('You cannot disable or remove your own manager access.',400);
    await upsertUser(env,{email,name,role,active,stamp:now()});
    await audit(env,user,'user_updated',{email,role,active});
    return json({ok:true});
  }
  return json({error:'Not found'},404);
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    try{
      if(url.pathname.startsWith('/api/'))return await handleApi(request,env,url);
      if(url.pathname==='/'||url.pathname==='/index.html')return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
      if(url.pathname==='/manifest.webmanifest')return json({name:'Bay Bellerive Stock',short_name:'Bay Stock',start_url:'/',display:'standalone',background_color:'#f5f2e9',theme_color:'#132b28'});
      return text('Not found',404);
    }catch(error){console.error(error);return json({error:'The shared stock service is temporarily unavailable.'},500)}
  }
};
