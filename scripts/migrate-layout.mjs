import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {normalizeEntryLayout} from '../src/lib/entries.js';

const dataDir=process.env.DATA_DIR||'./data';
const apply=process.argv.includes('--apply');
const dbPath=path.join(dataDir,'rafa.sqlite');
const db=new DatabaseSync(dbPath);

let rows;
try{
  rows=db.prepare('SELECT id,data FROM entries ORDER BY rowid').all();
}catch(error){
  if(/no such table/i.test(error.message))rows=[];
  else{
    console.error(`无法读取 ${dbPath}：${error.message}`);
    process.exit(1);
  }
}

const entries=rows.map(row=>{
  try{return JSON.parse(row.data);}
  catch(error){
    console.error(`条目 ${row.id} 的数据不是有效 JSON：${error.message}`);
    process.exit(1);
  }
});
const normalized=normalizeEntryLayout(entries);
const beforeById=new Map(entries.map(item=>[item.id,item]));
const changed=normalized.filter(item=>JSON.stringify(item)!==JSON.stringify(beforeById.get(item.id)));

console.log(`数据库：${dbPath}`);
console.log(`模式：${apply?'应用':'dry-run（使用 --apply 写回）'}`);
console.log(`条目：${entries.length}，将改动：${changed.length}`);
for(const item of changed.slice(0,10)){
  const before=beforeById.get(item.id);
  console.log(JSON.stringify({
    id:item.id,
    title:item.title||'',
    before:{workPane:before.workPane??null,position:before.position??null},
    after:{workPane:item.workPane??null,position:item.position??null}
  }));
}
if(changed.length>10)console.log(`……另有 ${changed.length-10} 条未显示`);

if(apply&&changed.length){
  const update=db.prepare('UPDATE entries SET data=? WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const item of changed)update.run(JSON.stringify(item),item.id);
    db.exec('COMMIT');
  }catch(error){
    db.exec('ROLLBACK');
    throw error;
  }
}

db.close();
