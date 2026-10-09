import {readFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {parseLine,domains} from '../src/lib/entries.js';

const files=[
  ['/Users/edy/Nutstore Files/Obsidian_src/20_日志/个人记录/2026-09.md','2026-09'],
  ['/Users/edy/Nutstore Files/Obsidian_src/20_日志/个人记录/2026-10.md','2026-10']
];
const entries=[],stack=[];let date='2026-09-01',domain='Work',position=0,contentStarted=false;
const personal=/中秋|机票|酒店|打车|飞机|旅行|生活|健康|生日|家里|购物/;
const idea=/灵感|想法|研究jev|Pi\+Agent|方法论|痛点|研究/;
for(const [file,month] of files){
  for(const raw of readFileSync(file,'utf8').split(/\r?\n/)){
    if(/^# \d{4}-\d{2}/.test(raw))contentStarted=true;
    if(!contentStarted)continue;
    const heading=raw.match(/^### \[\[(\d{4}-\d{2}-\d{2})\]\]/);if(heading){date=heading[1];continue;}
    if(/^## 灵感|^## 月回顾/.test(raw)){domain='Glean & Idea';continue;}
    if(/^## /.test(raw)){domain='Work';continue;}
    const bullet=raw.match(/^(\s*)-\s+(.+)/);if(!bullet)continue;
    const source=bullet[2].trim();if(source==='---'||source.startsWith('![[img')||source.startsWith('![[Pasted'))continue;
    const text=source.replace(/\s+✅\s*\d{4}-\d{2}-\d{2}/g,'');
    let value;try{value=parseLine(text,{domain},entries);}catch{continue;}
    if(!value.title&&!value.content&&!value.url&&!value.image)continue;
    const hint=value.title+value.content;
    const actualDomain=domain==='Glean & Idea'||idea.test(hint)?'Glean & Idea':personal.test(hint)?'Life':'Work';
    const indent=bullet[1].replace(/\t/g,'    ').length;
    while(stack.length&&stack.at(-1).indent>=indent)stack.pop();
    const parentId=stack.at(-1)?.id||'';
    const createdAt=new Date(`${date}T09:00:00+08:00`).toISOString();
    const item={...value,id:randomUUID(),domain:actualDomain,parentId,position:position++,createdAt,updatedAt:createdAt,completedAt:value.status==='done'?createdAt:null,removedAt:value.status==='removed'?createdAt:null};
    entries.push(item);stack.push({indent,id:item.id});
  }
}
// A small set of intentionally varied examples makes the first run show the notation affordances.
if(entries[0])Object.assign(entries[0],{tags:'focus, monthly',priority:'urgent',dueDate:'2026-10-12',stage:'本周'});
if(entries[1])Object.assign(entries[1],{tags:'产品, skill',priority:'high',custom:{notice:'需要评审'}});
if(entries[2])entries[2].related=[entries[1]?.id].filter(Boolean);
if(entries[3])entries[3].dependencies=[entries[1]?.id].filter(Boolean);
try{
  mkdirSync('./data/uploads',{recursive:true});
  copyFileSync('/Users/edy/Nutstore Files/Obsidian_src/60-Archives/Attachments/Pasted image 20260910145721.png','./data/uploads/seed-review.png');
  entries.push({domain:'Glean & Idea',type:'image',title:'订单流转截图',content:'从记录里保留的一张参考图 #截图',url:'',image:'/uploads/seed-review.png',status:'open',priority:'normal',owner:'',people:'',tags:'截图',dueDate:'',planDate:'',followupDate:'',stage:'',parentId:'',dependencies:[],related:[],custom:{source:'2026-09'},id:randomUUID(),position:entries.length,createdAt:'2026-10-08T09:00:00.000Z',updatedAt:'2026-10-08T09:00:00.000Z',completedAt:null,removedAt:null});
}catch{}
const db=new DatabaseSync('./data/rafa.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
const insert=db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?)');
db.exec('BEGIN');for(const item of entries)insert.run(item.id,JSON.stringify(item));db.exec('COMMIT');
console.log(`Seeded ${entries.length} entries from September and October.`);
