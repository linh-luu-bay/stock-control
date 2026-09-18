// Quantities transcribed from the supplied list, not a new physical count.
const groups={
'Kitchen supplies':`Cling wrap|1|units
Baking paper|2|units
Paper towel|0|units`,
'Dry store':`Oats|2|packs||large packs
Self-raising flour|3|kg
Plain flour
Gluten-free flour|750|g
Baking powder
Icing sugar
Caster sugar
Raw sugar
Almond meal
Sumac
Dukkah
Cayenne pepper
Cumin
Nutmeg
Pink salt
Rock salt
Ground coriander
Black pepper|330|g
Fried shallots
Vegemite
Peanut butter`,
'Produce & perishables':`Avocado|0.5|trays
Bananas|4|each
Chilli|6|each
Tomatoes|1|kg
Cherry tomatoes|1|boxes|250 g
Lemons|4|each
Cos lettuce|1|each
Pears|6|each
Spring onions|2|bunches
Rhubarb|2|packs
Mesclun|2|packs
Rocket|2|packs
Spinach|2|packs
Mushrooms|1|trays
Oranges|9|each
Mint|1|bunches
Onions|3|each
Shallots|5|each
Purple carrots|500|g
Coriander
Parsley
Dill
Garlic
Thyme`,
'Dairy & refrigerated':`Shredded cheese|2|packs|700 g
Betta cream|3|units
Feta|4|packs|200 g
Tasty cheese slices|1|packs|750 g
Aioli|4|containers|295 ml
Unsalted butter|1|packs|500 g
Salted butter|1|packs|500 g
Bacon|3|packs
Halloumi|0|units
Yoghurt|0|units
Eggs|108|each||9 dozen`,
'Bread':`Turkish bread|6|units
Sourdough bread|2|units`,
'Frozen goods':`Frozen raspberries|2|packs|500 g
Frozen strawberries|1|packs|1 kg
Gluten-free Turkish bread|4|packs|200 g|Bread entry is the same four frozen packs; counted once.
Fries|2.5|packs|2 kg
Crisp onion|1|packs|750 g
Ice cream|1|units
Corn|2|bags`,
'Oils, sauces & preserves':`Kalamata olives|2|containers|345 g
Vinegar|2|units
Rice oil|0|units
Maple syrup|1.5|litres
Soy sauce|4|litres
Balsamic vinegar|2.5|litres
White wine|250|ml
Extra-virgin olive oil|750|ml
Worcestershire sauce|4|litres
Tomato sauce|3|litres
Tomato relish|400|g
Passionfruit pulp|2|containers|400 g
Tomato polpa|2|containers|790 g
Sardines|16|units`
};
export const kitchenCategories=['Fruit','Vegetables','Meat','Seafood','Dairy','Refrigerated','Frozen','Bread','Dry store','Consumables','Equipment'];
const layout={
 'Fruit':{'Citrus':['Lemons','Oranges'],'Other fruit':['Avocado','Bananas','Pears']},
 'Vegetables':{'Herbs':['Mint','Coriander','Parsley','Dill','Thyme'],'Root vegetables':['Purple carrots'],'Onions & garlic':['Spring onions','Onions','Shallots','Garlic'],'Leafy greens':['Cos lettuce','Mesclun','Rocket','Spinach'],'Other vegetables':['Chilli','Tomatoes','Cherry tomatoes','Rhubarb','Mushrooms']},
 'Meat':{'Bacon & cured meats':['Bacon']},
 'Seafood':{'Fish':['Sardines']},
 'Dairy':{'Cheese':['Shredded cheese','Feta','Tasty cheese slices','Halloumi'],'Butter':['Unsalted butter','Salted butter'],'Cream & yoghurt':['Betta cream','Yoghurt'],'Eggs':['Eggs']},
 'Refrigerated':{'Chilled sauces':['Aioli']},
 'Frozen':{'Fruit':['Frozen raspberries','Frozen strawberries'],'Vegetables & fries':['Fries','Corn'],'Bread':['Gluten-free Turkish bread'],'Desserts':['Ice cream'],'Other frozen goods':['Crisp onion']},
 'Bread':{'Bread':['Turkish bread','Sourdough bread']},
 'Dry store':{'Oils':['Rice oil','Extra-virgin olive oil'],'Flours & sugars':['Self-raising flour','Plain flour','Gluten-free flour','Icing sugar','Caster sugar','Raw sugar'],'Other baking & grains':['Oats','Baking powder','Almond meal'],'Spices & seasonings':['Sumac','Dukkah','Cayenne pepper','Cumin','Nutmeg','Ground coriander','Black pepper'],'Salts':['Pink salt','Rock salt'],'Spreads':['Vegemite','Peanut butter'],'Vinegars':['Vinegar','Balsamic vinegar'],'Sauces & syrups':['Maple syrup','Soy sauce','Worcestershire sauce','Tomato sauce','Tomato relish'],'Preserves & toppings':['Kalamata olives','Passionfruit pulp','Tomato polpa','Fried shallots'],'Cooking wine':['White wine']},
 'Consumables':{'Wraps & baking paper':['Cling wrap','Baking paper'],'Paper products':['Paper towel']}
};
export function kitchenClassification(name){for(const [category,subgroups] of Object.entries(layout))for(const [group,names] of Object.entries(subgroups))if(names.some(n=>n.toLowerCase()===name.toLowerCase()))return {c:category,group};return null}
export const kitchenSubgroups={...Object.fromEntries(Object.entries(layout).map(([c,g])=>[c,Object.keys(g)])),Fruit:['Citrus','Stone fruit','Other fruit']};
export const kitchenStock=Object.entries(groups).flatMap(([c,lines])=>lines.split('\n').map((line,index)=>{
 const [n,count,unit,capacity='',note='']=line.split('|'),u=unit||'units',q=count===undefined?null:Number(count);
 const measured=['g','kg','ml','litres'].includes(u);
 return {id:'kitchen-list-'+c.toLowerCase().replace(/[^a-z]+/g,'-')+'-'+index,a:'Kitchen',c,n,q,u,t:null,m:measured?'Weight':'Whole count',p:1,pl:'pack',s:'Unassigned supplier',location:'Not set',active:true,allowFraction:measured||(q!==null&&!Number.isInteger(q)),unitConfirmed:!!unit&&unit!=='units',capacity,capacityNeeded:!measured&&u!=='each',purchasePackConfirmed:false,reviewNote:note,sourceNote:count===undefined?'Quantity not recorded':`${count} ${u}${capacity?' × '+capacity:''}${note?' — '+note:''}`,stocktakeDate:null};
})).map(item=>({...item,...kitchenClassification(item.n)}));
