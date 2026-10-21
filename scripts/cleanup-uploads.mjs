import {readdirSync, unlinkSync, statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const dataDir=process.env.DATA_DIR||'./data';
const uploadDir=path.join(dataDir,'uploads');
const apply=process.argv.includes('--apply');

let files=[];
try{
  files=readdirSync(uploadDir).filter(name=>{
    try{return statSync(path.join(uploadDir,name)).isFile();}
    catch{return false;}
  });
}catch(error){
  if(error.code!=='ENOENT')throw error;
}

const references=new Set();
const dbPath=path.join(dataDir,'rafa.sqlite');
try{
  const db=new DatabaseSync(dbPath,{readOnly:true});
  for(const row of db.prepare('SELECT data FROM entries').all()){
    for(const match of row.data.matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g))references.add(match[1]);
  }
  db.close();
}catch(error){
  console.error(`无法读取 ${dbPath}：${error.message}`);
  process.exit(1);
}

const orphaned=files.filter(file=>!references.has(file)).sort();
console.log(`目录：${uploadDir}`);
console.log(`模式：${apply?'apply（删除孤立文件）':'dry-run（使用 --apply 删除）'}`);
console.log(`文件：${files.length}，引用：${references.size}，孤立：${orphaned.length}`);
for(const file of orphaned){
  console.log(`${apply?'删除':'孤立'} ${path.join(uploadDir,file)}`);
  if(apply){
    try{unlinkSync(path.join(uploadDir,file));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
    }
  }
}
if(apply&&orphaned.length)console.log(`已删除 ${orphaned.length} 个孤立文件。`);
