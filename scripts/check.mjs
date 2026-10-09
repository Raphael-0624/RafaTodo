import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(path.join(tmpdir(),'rafa-check-'));
let server;
const start=()=>new Promise((resolve,reject)=>{server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:'3099'},stdio:['ignore','pipe','pipe']});server.stdout.once('data',resolve);server.once('error',reject);});
const stop=()=>new Promise(resolve=>{server.once('exit',resolve);server.kill();});
const request=async(method,route,body)=>{const r=await fetch('http://127.0.0.1:3099'+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
try{await start();let {data:item}=await request('POST','/api/entries',{domain:'Work',type:'todo',title:'Persistence check',content:'',dependencies:[]});assert.ok(item.createdAt);assert.equal(item.completedAt,null);const id=item.id;({data:item}=await request('PUT','/api/entries/'+id,{...item,status:'done'}));assert.ok(item.completedAt);assert.equal(item.createdAt,(await request('GET','/api/entries')).data[0].createdAt);({data:item}=await request('PUT','/api/entries/'+id,{...item,status:'removed'}));assert.ok(item.removedAt);assert.ok(item.completedAt);assert.equal((await request('PUT','/api/entries/'+id,{...item,parentId:id})).status,400);await stop();const db=new DatabaseSync(path.join(dir,'rafa.sqlite'));db.prepare('INSERT INTO entries VALUES (?,?)').run('old-idea',JSON.stringify({...item,id:'old-idea',domain:'Idea'}));db.close();await start();const entries=(await request('GET','/api/entries')).data;assert.equal(entries.find(entry=>entry.id==='old-idea').domain,'Glean & Idea');assert.equal(entries.find(entry=>entry.id===id).id,id);assert.equal((await request('POST','/api/entries',{domain:'Life',type:'link',title:'bad',content:'',url:'javascript:alert(1)'})).status,400);console.log('PASS: persistence, metadata, migration, relationships and URL validation');}finally{if(server?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
