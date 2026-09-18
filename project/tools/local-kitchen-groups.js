function orderedKitchenGroups(items,category){const existing=[...new Set(items.map(x=>x.group||'Other'))];return [...new Set([...(kitchenSubgroups[category]||[]),...existing])].filter(g=>existing.includes(g))}
function stockGroupRows(items,category){if(area!=='Kitchen')return items.map(itemRow).join('');return orderedKitchenGroups(items,category).map(g=>`<tr class="subgroup-row"><td colspan="5">${esc(g)}</td></tr>`+items.filter(x=>(x.group||'Other')===g).map(itemRow).join('')).join('')}
// Reclassify existing local records once; preserve counts, costs and product IDs.
const groupVersionKey='bb-kitchen-groups-v1';
let groupsMigrated=false;
try{groupsMigrated=localStorage.getItem(groupVersionKey)==='done'}catch{}
if(!groupsMigrated){
 for(const x of data.filter(x=>x.a==='Kitchen')){
  const match=suppliedKitchen.find(k=>k.n.toLowerCase()===x.n.toLowerCase());
  if(match){x.c=match.c;x.group=match.group}
  else if(!categories.Kitchen.includes(x.c)){x.c=x.c==='Kitchen supplies'?'Consumables':x.c==='Dairy & refrigerated'?'Dairy':'Dry store';x.group='Needs category review';x.reviewNote=(x.reviewNote||'')+' Please confirm category.'}
 }
 scheduleSync();try{if(!localSaveFailed)localStorage.setItem(groupVersionKey,'done')}catch{}
}
const groupField=document.createElement('div');groupField.className='field';groupField.innerHTML='<label for="edit-subgroup">Product group</label><input id="edit-subgroup" list="kitchen-group-options" placeholder="e.g. Citrus or Herbs"><datalist id="kitchen-group-options"></datalist>';
$('#edit-form .form-grid').append(groupField);
const groupedOpen=openItemEditor;
openItemEditor=i=>{groupedOpen(i);groupField.hidden=data[i].a!=='Kitchen';$('#edit-subgroup').value=data[i].group||'';$('#kitchen-group-options').innerHTML=(kitchenSubgroups[data[i].c]||[]).map(g=>`<option value="${esc(g)}"></option>`).join('')};
const groupedSave=$('#edit-form').onsubmit;
$('#edit-form').onsubmit=e=>{const x=data[editTarget],group=$('#edit-subgroup').value.trim();groupedSave(e);if(editTarget===null&&x?.a==='Kitchen'){x.group=group;save();render()}};
const groupedStocktake=stocktakeRows;
stocktakeRows=()=>{groupedStocktake();if($('#stocktake-area').value!=='Kitchen')return;const body=$('#stocktake-rows'),rows=[...body.querySelectorAll('tr[data-stocktake-index]')];body.replaceChildren();for(const c of categories.Kitchen){const selected=rows.filter(row=>data[Number(row.dataset.stocktakeIndex)].c===c);if(!selected.length)continue;const header=document.createElement('tr');header.className='category-row';header.innerHTML=`<td colspan="4">${esc(c)}</td>`;body.append(header);for(const g of orderedKitchenGroups(selected.map(row=>data[Number(row.dataset.stocktakeIndex)]),c)){const title=document.createElement('tr');title.className='subgroup-row';title.innerHTML=`<td colspan="4">${esc(g)}</td>`;body.append(title);for(const row of selected.filter(row=>(data[Number(row.dataset.stocktakeIndex)].group||'Other')===g))body.append(row)}}};
$('#stocktake-area').onchange=stocktakeRows;
const groupStyle=document.createElement('style');groupStyle.textContent='.subgroup-row td{background:#edf2ef;font-weight:600;padding:9px 14px;color:#324c43}';document.head.append(groupStyle);
// Recover headings from imports made by older versions without replacing counts.
const repairHeadings=document.createElement('button');repairHeadings.className='btn';repairHeadings.textContent='Repair kitchen headings';document.querySelector('.tools').append(repairHeadings);
repairHeadings.onclick=()=>{let changed=0;for(const item of data.filter(x=>x.a==='Kitchen')){const source=suppliedKitchen.find(x=>x.n.toLowerCase()===item.n.toLowerCase());if(source&&(item.c!==source.c||item.group!==source.group)){item.c=source.c;item.group=source.group;changed++}}save();render();alert(`${changed} kitchen headings corrected. Counts and other product details were kept.`)};
const originalImportNormalise=normaliseImportedItem;
normaliseImportedItem=item=>{if(item.a==='Kitchen'&&typeof item.c==='string'&&item.c.trim()&&!categories.Kitchen.includes(item.c)){categories.Kitchen.push(item.c)}return originalImportNormalise(item)};
