// Runs inside the local app closure; no network or live-record writes.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function detailsNeeded(x){
 const missing=[];
 if(x.group==='Needs category review')missing.push('Category / product group');
 if(x.q===null||x.q===undefined)missing.push('Physical count');
 if(x.unitConfirmed===false)missing.push('Stock unit');
 if(x.capacityNeeded&&!x.capacity)missing.push('Weight / volume per pack or tray');
 if(x.t===null||x.t===undefined)missing.push('PAR level');
 if(!x.s||x.s==='Unassigned supplier')missing.push('Supplier');
 if(x.purchasePackConfirmed===false)missing.push('Purchase pack size');
 return missing;
}
function readyForReorder(x){return Number.isFinite(x.q)&&Number.isFinite(x.t)&&x.purchasePackConfirmed!==false&&Number.isFinite(x.p)&&x.p>0}
measuredQuantity=x=>x.allowFraction!==undefined?x.allowFraction:(x.m==='Weight'||x.m==='Visual'||/^(g|kg|litres?|ml|millilitres?)$/i.test(x.u));
displayQuantity=x=>x.q===null||x.q===undefined?'':measuredQuantity(x)?x.q:Math.round(x.q);
packsNeeded=x=>readyForReorder(x)?Math.ceil(Math.max(0,x.t-x.q)/x.p):0;
itemRow=x=>{
 const i=data.indexOf(x),missing=detailsNeeded(x),low=readyForReorder(x)&&x.q<x.t;
 const marker=currentUser.role==='manager'&&missing.length?`<button class="edit-item needs-details" data-i="${i}" title="${esc(missing.join('; '))}" aria-label="Details needed for ${esc(x.n)}: ${esc(missing.join(', '))}">★ Details needed (${missing.length})</button>`:'';
 const status=x.active===false?'Discontinued':!readyForReorder(x)?'Reorder setup incomplete':low?'Reorder '+packLabel(x,packsNeeded(x)):'On target';
 return `<tr><td><div class="product-line"><button class="photo-button" data-i="${i}" aria-label="Add photo for ${esc(x.n)}">${x.photo&&/^data:image\/(png|jpeg|webp);base64,/.test(x.photo)?`<img src="${esc(x.photo)}" alt="${esc(x.n)}">`:'📷'}</button><div><b>${esc(x.n)}</b><br>${marker}<small>${esc(x.u)}${x.capacity?' · '+esc(x.capacity)+' per '+esc(x.u):''}</small><br><small>${esc(x.s)} · ${esc(x.location)}</small><br><button class="edit-item" data-i="${i}">Edit item</button></div></div></td><td><input class="qty" data-i="${i}" type="number" min="0" step="${measuredQuantity(x)?'any':'1'}" value="${displayQuantity(x)}" placeholder="Not counted" aria-label="${esc(x.n)} quantity" ${x.active===false?'disabled':''}></td><td>${x.t==null?'Not set':esc(x.t)+' '+esc(x.u)}</td><td>${esc(x.m)}</td><td>${esc(status)}</td></tr>`;
};
const originalRender=render;
render=()=>{originalRender();document.querySelectorAll('.qty').forEach(el=>{el.onchange=e=>{e.stopPropagation();const x=data[el.dataset.i],before=x.q,q=el.value===''?null:Number(el.value);if(q!==null&&(!Number.isFinite(q)||q<0||(!measuredQuantity(x)&&!Number.isInteger(q)))){alert('Enter a valid count. Enable fractional quantities in Edit item if needed.');render();return}x.q=q;history.unshift({at:new Date().toISOString(),type:'count_adjustment',area:x.a,item:x.n,unit:x.u,before,after:q,delta:before===null||q===null?null:q-before,reason:before===null?'First recorded count':'Local count updated',recordedBy:currentUser.name});save();render()};});};
const extra=document.createElement('div');extra.className='field full';extra.innerHTML=`<fieldset><legend>Stock details</legend><label>Stock unit <input id="detail-unit" required placeholder="packs, trays, kg, each"></label><label><input id="detail-unit-confirmed" type="checkbox"> Unit confirmed</label><label>On-hand count (blank = not counted) <input id="detail-quantity" type="number" min="0" step="any"></label><label><input id="detail-fraction" type="checkbox"> Allow fractional quantities for this product</label><label>Weight / volume per pack or tray <input id="detail-capacity" placeholder="e.g. 250 g or 2 kg"></label><label><input id="detail-capacity-needed" type="checkbox"> This product needs a pack / tray weight or volume</label><label><input id="detail-purchase" type="checkbox"> Purchase pack size above is confirmed</label><label>Management notes <textarea id="detail-note"></textarea></label><p id="detail-source"></p><p id="detail-missing" role="status"></p></fieldset>`;
$('#edit-form .form-grid').append(extra);
$('#edit-par').required=false;$('#edit-par').placeholder='Not set';$('#edit-par').step='any';
const originalOpenEditor=openItemEditor;
openItemEditor=i=>{originalOpenEditor(i);const x=data[i];$('#edit-par').value=x.t??'';$('#edit-par').step='any';$('#detail-unit').value=x.u;$('#detail-unit-confirmed').checked=x.unitConfirmed!==false;$('#detail-quantity').value=x.q??'';$('#detail-fraction').checked=measuredQuantity(x);$('#detail-capacity').value=x.capacity||'';$('#detail-capacity-needed').checked=!!x.capacityNeeded;$('#detail-purchase').checked=x.purchasePackConfirmed!==false;$('#detail-note').value=x.reviewNote||'';$('#detail-source').textContent='Original list: '+(x.sourceNote||'No source note');$('#detail-missing').textContent='Still needed: '+(detailsNeeded(x).join(', ')||'None');};
$('#detail-unit').onchange=()=>{$('#detail-quantity').value='';$('#detail-unit-confirmed').checked=false;$('#detail-missing').textContent='Unit changed. Enter the count in the new unit; no automatic conversion is applied.'};
$('#edit-form').onsubmit=e=>{
 e.preventDefault();if(editTarget===null||currentUser.role!=='manager')return;
 const x=data[editTarget],before=structuredClone(x),q=$('#detail-quantity').value===''?null:Number($('#detail-quantity').value),t=$('#edit-par').value===''?null:Number($('#edit-par').value),p=Number($('#edit-pack-size').value),fraction=$('#detail-fraction').checked;
 if((q!==null&&(!Number.isFinite(q)||q<0||(!fraction&&!Number.isInteger(q))))||(t!==null&&(!Number.isFinite(t)||t<0))||!Number.isFinite(p)||p<1){alert('Check count, PAR level and purchase pack size. Fractional counts must be enabled for this product.');return}
 Object.assign(x,{n:$('#edit-name').value.trim(),c:$('#edit-category').value,u:$('#detail-unit').value.trim(),q,t,p,pl:$('#edit-pack-name').value.trim(),s:$('#edit-supplier').value.trim()||'Unassigned supplier',location:$('#edit-location').value.trim()||'Not set',active:$('#edit-active').value==='active',m:$('#edit-method').value,allowFraction:fraction,unitConfirmed:$('#detail-unit-confirmed').checked,capacity:$('#detail-capacity').value.trim(),capacityNeeded:$('#detail-capacity-needed').checked,purchasePackConfirmed:$('#detail-purchase').checked,reviewNote:$('#detail-note').value.trim()});
 history.unshift({at:new Date().toISOString(),type:'item_update',area:x.a,item:x.n,unit:x.u,before:before.q,after:x.q,delta:before.u===x.u&&before.q!==null&&x.q!==null?x.q-before.q:null,reason:'Management details updated',recordedBy:currentUser.name,previousDetails:before});
 save();render();editTarget=null;$('#edit-dialog').close();
};
const originalMovement=$('#movement-form').onsubmit;
$('#movement-form').onsubmit=e=>{const x=data[Number($('#movement-product').value)];if(x?.q==null&&$('#movement-type').value!=='correction'){e.preventDefault();alert('Record a physical count correction first. An unknown count cannot be treated as zero.');return}originalMovement(e)};
const originalSignificantVariance=significantVariance;significantVariance=(x,count)=>x.q===null?false:originalSignificantVariance(x,count);
const originalStocktakeRows=stocktakeRows;
stocktakeRows=()=>{originalStocktakeRows();if(currentUser.role!=='manager')return;document.querySelectorAll('#stocktake-rows tr[data-stocktake-index]').forEach(row=>{const x=data[Number(row.dataset.stocktakeIndex)],missing=detailsNeeded(x),input=row.querySelector('.stocktake-count');input.step=measuredQuantity(x)?'any':'1';if(missing.length){const marker=document.createElement('span');marker.className='needs-details';marker.textContent='★ Details needed';marker.title=missing.join('; ');row.querySelector('td').append(marker)}})};
$('#stocktake-area').onchange=stocktakeRows;
const style=document.createElement('style');style.textContent='.needs-details{color:#ad1824;background:#fff0f1;border:1px solid #ad1824;border-radius:6px;padding:5px 8px;margin:5px 0;display:block;font-weight:700}#edit-form fieldset label{display:block;margin:10px 0}#edit-form input[type=checkbox]{width:auto}';document.head.append(style);
const loadKitchen=document.createElement('button');loadKitchen.className='btn';loadKitchen.textContent='Load supplied kitchen list';document.querySelector('.tools').append(loadKitchen);
loadKitchen.onclick=()=>{let added=0,skipped=0;for(const item of suppliedKitchen){const name=item.n.toLowerCase();if(data.some(x=>x.a==='Kitchen'&&(x.n.toLowerCase()===name||(name==='eggs'&&x.n.toLowerCase()==='free-range eggs')))){skipped++;continue}data.push(structuredClone(item));added++}save();render();alert(`${added} kitchen products added. ${skipped} existing matches kept unchanged. Review existing items manually before using the source counts.`)};
