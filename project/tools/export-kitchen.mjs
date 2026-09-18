import fs from 'node:fs';
import {kitchenStock} from './kitchen-stock.mjs';
const backup={format:'bay-bellerive-stock-backup',version:1,exportedAt:new Date().toISOString(),description:'Supplied kitchen stocktake. Requires the updated local trial with unknown-count and missing-details support. Stocktake date not supplied.',data:kitchenStock,history:[],stocktakes:[]};
const file=new URL('../../Bay-Bellerive-Kitchen-Stocktake.json',import.meta.url);
fs.writeFileSync(file,JSON.stringify(backup,null,2));
const read=JSON.parse(fs.readFileSync(file,'utf8'));
if(read.data.length!==82||read.data.find(x=>x.n==='Plain flour').q!==null||read.data.filter(x=>x.n==='Gluten-free Turkish bread').length!==1)throw Error('Export validation failed');
console.log('Validated 82 kitchen items; unknown counts preserved; GF bread counted once.');
