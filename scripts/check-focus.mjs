import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {focusElapsed,focusClock} from '../src/lib/focus.js';

assert.equal(focusClock(3661000),'01:01:01');
assert.equal(focusClock(-100),'00:00:00');
assert.equal(focusElapsed({activeId:'',elapsed:{}},'',100),0);
assert.equal(focusElapsed({activeId:'a',runningSince:1000,elapsed:{a:2000}},'a',4000),5000);
assert.equal(focusElapsed({activeId:'a',runningSince:1000,elapsed:{b:2000}},'b',4000),2000);
const dir=mkdtempSync(path.join(tmpdir(),'rafa-focus-'));
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,session='';
const stop=async()=>{if(server?.exitCode===null){const exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await exit;}};
async function start(){
  server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:'ignore'});
  for(let i=0;i<100;i++){
    try{if((await fetch('http://127.0.0.1:'+port+'/api/auth/status')).ok)return;}catch{}
    if(server.exitCode!==null)throw Error('Focus test server failed');
    await pause(50);
  }
  throw Error('Focus test server timed out');
}
async function request(method,route,body){
  const response=await fetch('http://127.0.0.1:'+port+route,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});
  const cookie=response.headers.get('set-cookie');if(cookie)session=cookie.split(';')[0];
  return {status:response.status,data:await response.json()};
}
const act=(action,id)=>request('POST','/api/focus',{action,id});
const state=async()=>(await request('GET','/api/focus')).data;
const entries=async()=>(await request('GET','/api/entries')).data;
async function create(title,extra={}){const result=await request('POST','/api/entries',{domain:'Work',workPane:'left',type:'todo',status:'open',title,content:'',...extra});assert.equal(result.status,200);return result.data;}
function ageTimer(id,ms){const db=new DatabaseSync(path.join(dir,'rafa.sqlite'));db.prepare('UPDATE focus_timers SET running_since=? WHERE entry_id=?').run(Date.now()-ms,id);db.close();}
try{
  assert.equal(spawnSync(process.execPath,['scripts/set-password.mjs'],{env:{...process.env,DATA_DIR:dir,INITIAL_PASSWORD:'focus-test'}}).status,0);
  await start();
  assert.equal((await request('GET','/api/focus')).status,401);
  assert.equal((await act('start','missing')).status,401);
  assert.equal((await request('POST','/api/auth/login',{password:'focus-test'})).status,200);
  const a=await create('Focus A',{status:'waiting',collapsed:true});
  const b=await create('Focus B');
  const child=await create('Weekly child',{parentId:b.id,loop:'week'});
  const note=await create('Keep original note',{parentId:b.id,type:'text'});
  const removed=await create('Keep cancelled child',{parentId:b.id,status:'removed'});
  assert.equal((await act('start',a.id)).status,200);
  const first=await state();
  assert.equal(first.activeId,a.id);
  assert.equal((await entries()).find(item=>item.id===a.id).collapsed,false);
  assert.equal((await act('start',a.id)).data.focus.runningSince,first.runningSince,'Repeated starts do not reset time');
  ageTimer(a.id,63000);
  const switching=await act('start',b.id);
  assert.equal(switching.status,200);
  assert.equal(switching.data.focus.activeId,b.id);
  assert.ok(switching.data.focus.elapsed[a.id]>=63000);
  assert.equal(switching.data.items.find(item=>item.id===a.id).status,'waiting');
  assert.equal(switching.data.items.filter(item=>item.status==='doing').length,1);
  const oldA=switching.data.focus.elapsed[a.id];
  ageTimer(b.id,2000);
  const paused=(await act('pause',b.id)).data.focus;
  assert.equal(paused.activeId,'');assert.ok(paused.elapsed[b.id]>=2000);
  await pause(30);assert.equal((await state()).elapsed[b.id],paused.elapsed[b.id],'Paused time remains frozen');
  await stop();await start();
  assert.equal((await state()).elapsed[b.id],paused.elapsed[b.id],'Paused time survives restart');
  assert.equal((await act('start',a.id)).data.focus.elapsed[a.id],oldA,'Resume preserves accumulated time');
  await stop();await start();
  assert.equal((await state()).activeId,a.id,'Running timer survives restart');
  assert.equal((await act('pause',b.id)).status,400,'Stale clients cannot pause another task');
  await act('start',b.id);
  // A failing descendant write must roll back completion and timer settlement.
  let db=new DatabaseSync(path.join(dir,'rafa.sqlite'));
  db.prepare("UPDATE entries SET data=json_set(data,'$.title',?) WHERE id=?").run('x'.repeat(1001),child.id);db.close();
  assert.equal((await act('complete',b.id)).status,400);
  assert.equal((await state()).activeId,b.id);
  assert.equal((await entries()).find(item=>item.id===b.id).status,'doing');
  db=new DatabaseSync(path.join(dir,'rafa.sqlite'));db.prepare("UPDATE entries SET data=json_set(data,'$.title',?) WHERE id=?").run('Weekly child',child.id);db.close();
  const completed=await act('complete',b.id);assert.equal(completed.status,200);
  assert.equal(completed.data.focus.activeId,'');
  assert.equal(completed.data.items.find(item=>item.id===b.id).status,'done');
  assert.match(completed.data.items.find(item=>item.id===b.id).content,/#ZEN 耗时/);
  assert.equal(completed.data.items.find(item=>item.id===child.id).loopCompletedCount,1);
  assert.equal(completed.data.items.find(item=>item.id===note.id).content,'');
  assert.equal(completed.data.items.find(item=>item.id===removed.id).status,'removed');
  assert.equal((await act('complete',b.id)).status,400);
  assert.equal((await act('start',b.id)).status,400);
  await act('start',a.id);
  assert.equal((await request('PUT','/api/entries/'+a.id,{status:'done'})).status,200);
  assert.equal((await state()).activeId,'','Completing from the main list stops timing');
  const deleted=await create('Delete active task');await act('start',deleted.id);
  await request('DELETE','/api/entries/'+deleted.id);
  assert.equal((await state()).activeId,'');assert.equal(Object.hasOwn((await state()).elapsed,deleted.id),false);
  assert.equal((await act('start','missing')).status,400);
  assert.equal((await act('invalid',a.id)).status,400);
  console.log('PASS: focus authentication, singleton timing, pause/resume, restart persistence, stale operations, atomic completion, recurring children and deletion');
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
