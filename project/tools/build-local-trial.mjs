import fs from 'node:fs';
import vm from 'node:vm';
import {kitchenStock,kitchenCategories,kitchenSubgroups} from './kitchen-stock.mjs';
let html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const seedMatch=html.match(/const seed=(\[[^\n]+\]);/);
if(!seedMatch)throw Error('Seed list missing');
const seed=vm.runInNewContext(seedMatch[1]).filter(x=>x.a!=='Kitchen');
html=html.replace(seedMatch[0],'const seed='+JSON.stringify([...seed,...kitchenStock])+';');
html=html.replace("Kitchen:['Produce & perishables','Meat & seafood','Dry store','Dairy & refrigerated','Equipment']",'Kitchen:'+JSON.stringify(kitchenCategories));
function span(start,end,replacement){const a=html.indexOf(start),b=html.indexOf(end,a);if(a<0||b<0)throw Error('Missing source boundary: '+start);html=html.slice(0,a)+replacement+'\n'+html.slice(b)}
span('let bootstrap;try{','const categories=',`const storageKey='bay-bellerive-local-trial-v1';
let saved=null,storageWarning='';
try{saved=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{storageWarning='Browser storage is unavailable. Download a backup before closing.'}
const bootstrap={user:{name:'Linh — local trial',email:'local-trial',role:'manager'},hasState:Boolean(saved),state:saved};`);
html=html.replace(/localJson\('bb-stock',seed\)/g,'seed').replace(/localJson\('bb-stock-history',\[\]\)/g,'[]').replace(/localJson\('bb-stocktakes',\[\]\)/g,'[]');
span("const draftKey=",'function weekStart(',`function syncStatus(message){$('#sync-status').textContent=message}
let localSaveFailed=false;
function scheduleSync(){try{localStorage.setItem(storageKey,JSON.stringify({data,history,stocktakes}));localSaveFailed=false;syncStatus('Saved in this browser only · Download a backup after each session.')}catch{localSaveFailed=true;syncStatus('NOT SAVED: browser storage is unavailable or full. Download a backup now.')}}
$('#retry-sync').textContent='Save locally';$('#retry-sync').onclick=scheduleSync;
$('#export-draft').textContent='Download backup';$('#export-draft').onclick=()=>$('#download-backup').click();
addEventListener('beforeunload',e=>{if(localSaveFailed){e.preventDefault();e.returnValue=''}});
syncStatus(storageWarning||'Local trial · Sample products · No connection to live stock.');
`);
span('async function loadUsers(){','function reorderItems()',`$('#users-button').hidden=true;$('#users-dialog').remove();`);
html=html.replace('Counts remain blank so the physical stock is counted independently.','Counts remain blank so the physical stock is counted independently.');
html=html.replace('Download a backup from the original app, then import it into the private website. Importing merges the lists, so products already entered in either version are retained.','Download a backup after each session. Browser data can be lost if browsing data is cleared or this file is moved. Import a backup to continue on another computer. This local trial has no login or access restrictions; use test data.');
html=html.replace('<main class="shell">','<main class="shell"><section style="padding:14px;border:2px solid #9e6b16;border-radius:12px;margin-bottom:18px;background:#fff6dd;color:#382704"><b>LOCAL TRIAL — sample stock, no sign-in</b><p style="margin:6px 0">Changes stay in this browser and do not update the live app. Everyone who opens this file has manager tools. Download a backup after each session. Best opened in Chrome, Edge or Safari on a computer.</p></section>');
html=html.replace('<title>Bay Bellerive Stock</title>','<title>Bay Bellerive Stock — Local Trial</title>');
html=html.replace("target={...x,a:destination,q:0,photo:x.photo||''}","target={...x,id:crypto.randomUUID(),a:destination,q:0,photo:x.photo||''}");
html=html.replace("else after=Math.max(0,before-qty);", "else {if(qty>before){alert('This quantity exceeds stock on hand. Check the count first.');return}after=before-qty;}");
html=html.replaceAll('x.q<x.t','readyForReorder(x)&&x.q<x.t');
html=html.replaceAll('${h.before}',"${h.before??'Not counted'}").replaceAll('${h.after}',"${h.after??'Not counted'}").replaceAll('${h.delta}',"${h.delta??'—'}");
html=html.replace('let before=x.q,after=before,','let before=x.q,after=before,');
html=html.replace('delta:after-before,unitCost:', 'delta:before===null?null:after-before,unitCost:');
html=html.replace('variance:c.after-c.before,','variance:c.before===null?null:c.after-c.before,');
const extension=fs.readFileSync(new URL('./local-details.js',import.meta.url),'utf8');
html=html.replace('group.map(itemRow).join(\'\')',"stockGroupRows(group,c)");
html=html.replace("$('#today').textContent=",'const suppliedKitchen='+JSON.stringify(kitchenStock)+';\nconst kitchenSubgroups='+JSON.stringify(kitchenSubgroups)+';\n'+extension+'\n'+fs.readFileSync(new URL('./local-kitchen-groups.js',import.meta.url),'utf8')+"\n$('#today').textContent=");
html=html.replace('LOCAL TRIAL — sample stock, no sign-in','LOCAL TRIAL — supplied kitchen list, no sign-in').replace('Local trial · Sample products','Local trial · Supplied kitchen list');
if(/fetch\(/.test(html))throw Error('Local version still contains a network request');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
const destination=new URL('../../Bay-Bellerive-Local-Trial.html',import.meta.url);
fs.writeFileSync(destination,html);
console.log(destination.pathname+' — built; script syntax valid; no fetch calls.');
