import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseLine,toLine,loopPeriodKey} from '../src/lib/entries.js';

const parsed=parseLine('%习惯 不刷短视频 !resist');
assert.equal(parsed.resist,true);assert.equal(parsed.title,'不刷短视频');assert.equal(parsed.prefixLabel,'习惯');
assert.equal(parseLine(toLine(parsed)).resist,true);
assert.equal(parseLine('!resist %习惯 不刷短视频').prefixLabel,'习惯');
assert.equal(parseLine('---',parsed).resist,false);
assert.equal(parseLine('保留 `!resist` 原文').resist,false);
assert.equal(parseLine('> 文本 !resist').resist,false);
assert.equal(parseLine('不刷 !resist ~doing').status,'open');
assert.throws(()=>parseLine('不刷 !resist !loop-day'));
assert.equal(loopPeriodKey('day',new Date('2026-11-09T15:59:59Z'),'Asia/Shanghai'),'2026-11-09');
assert.equal(loopPeriodKey('day',new Date('2026-11-09T16:00:00Z'),'Asia/Shanghai'),'2026-11-10');
const dir=mkdtempSync(path.join(tmpdir(),'rafa-resist-'));
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,session='';
const stop=async()=>{if(server?.exitCode===null){const exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await exit;}};
async function start(){
  server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:'ignore'});
  for(let i=0;i<100;i++){
    try{if((await fetch('http://127.0.0.1:'+port+'/api/auth/status')).ok)return;}catch{}
    if(server.exitCode!==null)throw Error('Resist test server failed');
    await pause(50);
  }
  throw Error('Resist test server timed out');
}
async function request(method,route,body){
  const response=await fetch('http://127.0.0.1:'+port+route,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});
  const cookie=response.headers.get('set-cookie');if(cookie)session=cookie.split(';')[0];
  return {status:response.status,data:await response.json()};
}
const act=(id,recordId)=>request('POST','/api/entries/'+id+'/resist-records',{recordId});
const undo=(id,recordId)=>request('DELETE','/api/entries/'+id+'/resist-records/'+recordId);
const state=async()=>(await request('GET','/api/focus')).data;
const entries=async()=>(await request('GET','/api/entries')).data;
async function create(title,extra={}){const result=await request('POST','/api/entries',{domain:'Work',workPane:'left',type:'todo',status:'open',title,content:'',...extra});assert.equal(result.status,200);return result.data;}
try{
  assert.equal(spawnSync(process.execPath,['scripts/set-password.mjs'],{env:{...process.env,DATA_DIR:dir,INITIAL_PASSWORD:'resist-test'}}).status,0);
  await start();
  assert.equal((await act('missing','record-0001')).status,401);
  assert.equal((await request('GET','/api/entries/missing/resist-records')).status,401);
  assert.equal((await undo('missing','record-0001')).status,401);
  await request('POST','/api/auth/login',{password:'resist-test'});
  const parent=await create('Completed parent',{status:'done'});
  const a=await create('Do not scroll',{resist:true,parentId:parent.id});
  const b=await create('Another habit',{resist:true});
  assert.equal(a.resistTotal,0);assert.equal(a.resistToday,0);
  assert.equal((await act(a.id,'bad')).status,400);
  const duplicates=await Promise.all(Array.from({length:5},()=>act(a.id,'record-0001')));
  assert.ok(duplicates.every(result=>result.status===200&&result.data.item.resistTotal===1));
  assert.equal(duplicates[0].data.item.resistToday,1);
  assert.equal((await act(b.id,'record-0001')).status,400,'Record IDs belong to one task');
  assert.equal((await undo(b.id,'record-0001')).status,400);
  assert.equal((await undo(a.id,'record-0001')).data.item.resistTotal,0);
  assert.equal((await undo(a.id,'record-0001')).status,200,'Undo is idempotent');
  assert.equal((await act(a.id,'record-0001')).data.item.resistTotal,0,'Retry after undo cannot restore the record');
  for(const id of ['record-0002','record-0003','record-0004'])assert.equal((await act(a.id,id)).status,200);
  let db=new DatabaseSync(path.join(dir,'rafa.sqlite'));
  db.prepare('UPDATE resist_records SET date=?,recorded_at=? WHERE id=?').run('2000-01-01','2000-01-01T01:00:00Z','record-0002');db.close();
  let current=(await entries()).find(item=>item.id===a.id);
  assert.equal(current.resistToday,2);assert.equal(current.resistTotal,3);
  const history=(await request('GET','/api/entries/'+a.id+'/resist-records')).data;
  assert.equal(history.timeZone,'Asia/Shanghai');assert.equal(history.records.length,3);assert.equal(history.records.at(-1).date,'2000-01-01');
  await request('PUT','/api/entries/'+a.id,{title:'Renamed habit',resistToday:900,resistTotal:900});
  assert.equal((await entries()).find(item=>item.id===a.id).resistTotal,3,'Counts never trust client values');
  assert.equal((await request('POST','/api/entries/move',{id:a.id,domain:'Life',placement:'end'})).status,200);
  assert.equal((await entries()).find(item=>item.id===a.id).resistTotal,3);
  assert.equal((await request('POST','/api/focus',{action:'start',id:a.id})).status,400);
  for(const status of ['done','doing','waiting'])assert.equal((await request('PUT','/api/entries/'+a.id,{status})).status,400);
  assert.equal((await request('POST','/api/entries/batch',{ids:[a.id],action:'done'})).status,400);
  assert.equal((await request('PUT','/api/entries/'+a.id,{loop:'day'})).status,400);
  await request('PUT','/api/entries/'+a.id,{status:'removed'});
  assert.equal((await act(a.id,'removed-record')).status,400);
  await request('POST','/api/archive',{domain:'Life'});
  assert.ok((await entries()).some(item=>item.id===a.id),'Removed habits are protected from archive');
  await request('PUT','/api/entries/'+a.id,{status:'open'});
  await request('POST','/api/entries/move',{id:a.id,targetId:parent.id,domain:'Work',placement:'inside'});
  await request('POST','/api/archive',{domain:'Work'});
  assert.ok((await entries()).some(item=>item.id===parent.id),'Habits protect ancestors from archive');
  const focusParent=await create('Focus parent');
  await request('POST','/api/entries/move',{id:b.id,targetId:focusParent.id,domain:'Work',placement:'inside'});
  await request('POST','/api/focus',{action:'start',id:focusParent.id});
  assert.equal((await request('POST','/api/focus',{action:'complete',id:focusParent.id})).status,200);
  assert.equal((await entries()).find(item=>item.id===b.id).status,'open','Parent ZEN completion skips habits');
  const imported=await request('POST','/api/entries/import',{domain:'Daily',text:'不刷视频 !resist\n不熬夜 !resist'});
  assert.equal(imported.status,200);assert.ok(imported.data.ids.every(id=>imported.data.items.find(item=>item.id===id).resist));
  await stop();await start();
  current=(await entries()).find(item=>item.id===a.id);assert.equal(current.resistTotal,3);assert.equal(current.resistToday,2);
  for(let i=0;i<51;i++)await act(b.id,'pagination-'+String(i).padStart(4,'0'));
  const page1=(await request('GET','/api/entries/'+b.id+'/resist-records')).data;
  const page2=(await request('GET','/api/entries/'+b.id+'/resist-records?offset='+page1.nextOffset)).data;
  assert.equal(page1.records.length,50);assert.equal(page2.records.length,1);assert.equal(page2.nextOffset,null);
  assert.equal(new Set([...page1.records,...page2.records].map(record=>record.id)).size,51);
  await request('PUT','/api/entries/'+a.id,{resist:false});
  assert.equal((await act(a.id,'disabled-record')).status,400);
  await request('PUT','/api/entries/'+a.id,{resist:true});
  assert.equal((await entries()).find(item=>item.id===a.id).resistTotal,3,'Toggling the rule retains history');
  await request('DELETE','/api/entries/'+a.id);
  db=new DatabaseSync(path.join(dir,'rafa.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resist_records WHERE entry_id=?').get(a.id).n,0);db.close();
  console.log('PASS: resist syntax, Shanghai dates, authentication, repeatable counts, idempotent retry/undo, history, restart, archive/focus protection and pagination');
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
