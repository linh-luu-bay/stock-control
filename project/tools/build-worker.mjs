import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'dist','index.html'),'utf8');
const template=fs.readFileSync(path.join(root,'worker','server-template.js'),'utf8');
if(!template.includes('__HTML_JSON__'))throw new Error('Worker HTML placeholder is missing');
const worker=template.replace('__HTML_JSON__',JSON.stringify(html));
fs.mkdirSync(path.join(root,'worker'),{recursive:true});
fs.writeFileSync(path.join(root,'worker','index.js'),worker);
fs.mkdirSync(path.join(root,'dist','server'),{recursive:true});
fs.mkdirSync(path.join(root,'dist','.openai'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','server','index.js'),worker);
fs.copyFileSync(path.join(root,'.openai','hosting.json'),path.join(root,'dist','.openai','hosting.json'));
