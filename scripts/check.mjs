import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {domains,parseLine,toLine,pasteLink,moveEntries,nextPosition,workPaneMap,compactEntryPositions,normalizeEntryLayout,loopPeriodKey} from '../src/lib/entries.js';
const group=parseLine('## 项目 sig:🚀 tone:sage');
assert.equal(group.type,'group');assert.equal(group.title,'项目');assert.equal(group.signature,'🚀');assert.equal(group.tone,'sage');
assert.equal(toLine(group),'## 项目 sig:🚀 tone:sage');
assert.equal(parseLine(toLine({...group,id:'group',collapsed:true}),{...group,id:'group',collapsed:true}).collapsed,true);
assert.equal(parseLine('---').type,'divider');assert.equal(toLine(parseLine('---')),'---');
const bullet=parseLine('- 清理收件箱 #整理');
assert.equal(bullet.type,'bullet');assert.equal(bullet.title,'清理收件箱');assert.equal(bullet.tags,'整理');
assert.equal(toLine(bullet),'- 清理收件箱 #整理');
assert.equal(parseLine('- [ ] 清理收件箱').type,'todo');
assert.equal(parseLine('- [x] 清理收件箱').status,'done');
assert.equal(parseLine('- [-] 清理收件箱').status,'removed');
const pasted=pasteLink('查看说明',2,4,'https://example.com/docs');
assert.equal(pasted.text,'查看[说明](https://example.com/docs)');assert.equal(pasted.caret,pasted.text.length);
assert.equal(pasteLink('说明',0,2,'javascript:alert(1)'),null);
const inlineLink=parseLine('参考 [说明](https://example.com/docs) 后继续');
assert.equal(inlineLink.title,'参考 [说明](https://example.com/docs) 后继续');assert.equal(inlineLink.url,'');
for(const status of ['open','doing','waiting','done','removed']){
  const task={id:'task',type:'todo',status,title:'原任务',content:'',owner:'小明',tags:'工作'};
  const line=toLine(task,[],{hideTaskPrefix:true});
  assert.ok(!line.startsWith('- ['));
  const edited=parseLine(line.replace('原任务','修改任务'),task);
  assert.equal(edited.status,status);assert.equal(edited.owner,'小明');assert.equal(edited.title,'修改任务 @小明');
}
const mentionTask={id:'mention',type:'todo',status:'open',title:'开会 @小明',content:'',owner:'小红',people:'小明',tags:''};
assert.equal(toLine(mentionTask,[],{hideTaskPrefix:true}),'开会 @小明 @小红');
const editedMention=parseLine(toLine(mentionTask,[],{hideTaskPrefix:true}),mentionTask);
assert.equal(editedMention.owner,'小明');assert.equal(editedMention.title,'开会 @小明 @小红');
assert.equal(toLine(editedMention,[],{hideTaskPrefix:true}),'开会 @小明 @小红');
assert.equal(toLine({...mentionTask,title:'开会 @小明，讨论',owner:'小明'},[],{hideTaskPrefix:true}),'开会 @小明，讨论');
assert.equal(toLine({...mentionTask,title:'开会 @小明明',owner:'小明',people:''},[],{hideTaskPrefix:true}),'开会 @小明明 @小明');
const prefixed=parseLine('%需求 登录页重做');
assert.equal(prefixed.prefixLabel,'需求');assert.equal(prefixed.title,'登录页重做');
assert.equal(toLine(prefixed),'- [ ] %需求 登录页重做');
assert.equal(parseLine('需求 %会议 讨论').prefixLabel,'');
assert.equal(parseLine('%需求 登录页重做').type,'todo');
assert.equal(parseLine('%需求',{domain:'Work'},[]).prefixLabel,'需求');
assert.equal(parseLine('%需求', {domain:'Work'}, []).title, '');
assert.equal(toLine(parseLine('%需求 登录页重做')),'- [ ] %需求 登录页重做');
assert.equal(parseLine('%需求 %需求 登录页重做').title,'登录页重做');
assert.equal(parseLine('%需求 登录页重做').title,'登录页重做');
const dayLoop=parseLine('%需求 !loop-day 每日复盘');
assert.equal(dayLoop.loop,'day');assert.equal(dayLoop.prefixLabel,'需求');assert.equal(dayLoop.title,'每日复盘');
assert.equal(toLine(dayLoop),'- [ ] %需求 每日复盘 !loop-day');
const weekLoop=parseLine('!loop-week 周计划');
assert.equal(weekLoop.loop,'week');assert.equal(weekLoop.title,'周计划');
assert.equal(parseLine('!loop-day',{domain:'Daily'},[]).title,'');
assert.equal(parseLine('## 分组 !loop-day').loop,'');
assert.equal(parseLine('> 文本 !loop-week').loop,'');
assert.equal(parseLine('- 列表 !loop-day').loop,'');
assert.equal(parseLine('--- !loop-day').type,'todo');
assert.equal(parseLine('!loop-month 月度任务').loop,'');
assert.equal(loopPeriodKey('day',new Date('2026-10-26T15:59:00Z'),'Asia/Shanghai'),'2026-10-26');
assert.equal(loopPeriodKey('day',new Date('2026-10-26T16:00:00Z'),'Asia/Shanghai'),'2026-10-27');
assert.equal(loopPeriodKey('week',new Date('2026-10-26T00:00:00Z'),'Asia/Shanghai'),'2026-10-26');
assert.equal(loopPeriodKey('week',new Date('2026-10-25T15:59:00Z'),'Asia/Shanghai'),'2026-10-19');
const paneEntry=(id,workPane,position)=>({id,domain:'Work',workPane,parentId:'',type:'todo',status:'open',title:id,position,createdAt:'2026-01-01'});
const moved=moveEntries([paneEntry('left',  'left',0),paneEntry('right','right',0)],{id:'left',targetId:'right',domain:'Work',placement:'after'});
assert.equal(moved.find(entry=>entry.id==='left').workPane,'right');
const treeEntries=[paneEntry('parent','left',0),{...paneEntry('child','right',0),parentId:'parent'},paneEntry('other','right',1)];
const treePanes=workPaneMap(treeEntries);
assert.equal(treePanes.get('parent'),'left');assert.equal(treePanes.get('child'),'left');assert.equal(treePanes.get('other'),'right');
const movedTree=moveEntries(treeEntries,{id:'parent',targetId:'other',domain:'Work',placement:'after'});
assert.equal(movedTree.find(entry=>entry.id==='parent').workPane,'right');assert.equal(movedTree.find(entry=>entry.id==='child').workPane,'right');
const positionEntries=[paneEntry('left-last','left',9),paneEntry('right-last','right',2),{...paneEntry('child','left',99),parentId:'left-last'}];
assert.equal(nextPosition(positionEntries,{domain:'Work',workPane:'left'}),10);
assert.equal(nextPosition(positionEntries,{domain:'Work',workPane:'right'}),3);
assert.equal(nextPosition(positionEntries,{domain:'Work',workPane:'left',parentId:'left-last'}),100);
assert.equal(nextPosition([...positionEntries,{...paneEntry('archived','left',50),archivedAt:'2026-01-02'}],{domain:'Work',workPane:'left'}),10);
const legacyWork=[
  {id:'legacy-root-a',domain:'Work',parentId:'',type:'todo',status:'open',title:'A',position:0,createdAt:'2026-01-01T00:00:00.000Z'},
  {id:'legacy-child-a',domain:'Work',parentId:'legacy-root-a',type:'todo',status:'open',title:'A child',position:1,createdAt:'2026-01-02T00:00:00.000Z'},
  {id:'legacy-root-b',domain:'Work',parentId:'',type:'todo',status:'open',title:'B',position:0,createdAt:'2026-01-03T00:00:00.000Z'},
  {id:'legacy-child-b',domain:'Work',parentId:'legacy-root-b',type:'todo',status:'open',title:'B child',position:1,createdAt:'2026-01-04T00:00:00.000Z',updatedAt:'2026-01-04T00:00:00.000Z'}
];
const normalized=normalizeEntryLayout(legacyWork);
assert.equal(normalized.find(item=>item.id==='legacy-child-a').workPane,normalized.find(item=>item.id==='legacy-root-a').workPane);
assert.equal(normalized.find(item=>item.id==='legacy-child-b').workPane,normalized.find(item=>item.id==='legacy-root-b').workPane);
assert.notEqual(normalized.find(item=>item.id==='legacy-root-a').workPane,normalized.find(item=>item.id==='legacy-root-b').workPane);
assert.equal(normalized.find(item=>item.id==='legacy-child-b').updatedAt,'2026-01-04T00:00:00.000Z');
assert.deepEqual(normalizeEntryLayout(normalized),normalized);
const duplicatePositions=[
  {id:'left-a',domain:'Work',workPane:'left',parentId:'',position:4,createdAt:'2026-01-01T00:00:00.000Z'},
  {id:'left-b',domain:'Work',workPane:'left',parentId:'',position:4,createdAt:'2026-01-02T00:00:00.000Z'},
  {id:'right-a',domain:'Work',workPane:'right',parentId:'',position:0,createdAt:'2026-01-03T00:00:00.000Z'},
  {id:'right-b',domain:'Work',workPane:'right',parentId:'',position:0,createdAt:'2026-01-04T00:00:00.000Z'},
  {id:'life-a',domain:'Life',parentId:'',position:8,createdAt:'2026-01-05T00:00:00.000Z'},
  {id:'life-archived',domain:'Life',parentId:'',position:99,createdAt:'2026-01-06T00:00:00.000Z',archivedAt:'2026-01-07T00:00:00.000Z'}
];
const compacted=compactEntryPositions(duplicatePositions);
for(const [pane,ids] of [['left',['left-a','left-b']],['right',['right-a','right-b']]])assert.deepEqual(ids.map(id=>compacted.find(item=>item.id===id).position),[0,1]);
assert.equal(compacted.find(item=>item.id==='life-a').position,0);
assert.equal(compacted.find(item=>item.id==='life-archived').position,99);
assert.equal(duplicatePositions.find(item=>item.id==='left-a').position,4);
const migrationDir=mkdtempSync(path.join(tmpdir(),'rafa-layout-'));
try{
  const migrationDb=new DatabaseSync(path.join(migrationDir,'rafa.sqlite'));
  migrationDb.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const insert=migrationDb.prepare('INSERT INTO entries VALUES (?,?)');
  for(const item of legacyWork)insert.run(item.id,JSON.stringify(item));
  migrationDb.close();
  const migrationEnv={...process.env,DATA_DIR:migrationDir};
  const dryRun=spawnSync(process.execPath,['scripts/migrate-layout.mjs'],{env:migrationEnv,encoding:'utf8'});
  assert.equal(dryRun.status,0,dryRun.stderr);
  assert.match(dryRun.stdout,/模式：dry-run/);
  let migratedDb=new DatabaseSync(path.join(migrationDir,'rafa.sqlite'));
  assert.equal(migratedDb.prepare('SELECT data FROM entries WHERE id=?').get('legacy-child-b').data,JSON.stringify(legacyWork[3]));
  migratedDb.close();
  const applied=spawnSync(process.execPath,['scripts/migrate-layout.mjs','--apply'],{env:migrationEnv,encoding:'utf8'});
  assert.equal(applied.status,0,applied.stderr);
  migratedDb=new DatabaseSync(path.join(migrationDir,'rafa.sqlite'));
  const stored=migratedDb.prepare('SELECT data FROM entries ORDER BY id').all().map(row=>JSON.parse(row.data));
  const byId=items=>items.slice().sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(byId(stored),byId(normalizeEntryLayout(legacyWork)));
  assert.equal(stored.find(item=>item.id==='legacy-child-b').updatedAt,'2026-01-04T00:00:00.000Z');
  migratedDb.close();
  const secondRun=spawnSync(process.execPath,['scripts/migrate-layout.mjs','--apply'],{env:migrationEnv,encoding:'utf8'});
  assert.equal(secondRun.status,0,secondRun.stderr);
  assert.match(secondRun.stdout,/将改动：0/);
}finally{rmSync(migrationDir,{recursive:true,force:true});}
const dir=mkdtempSync(path.join(tmpdir(),'rafa-check-'));
let server;
const freePort=()=>new Promise((resolve,reject)=>{const probe=createServer();probe.unref();probe.once('error',reject);probe.listen(3200,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>setTimeout(()=>resolve(port),50));});});
const port=await freePort();
const setPassword=password=>{const result=spawnSync(process.execPath,['scripts/set-password.mjs'],{env:{...process.env,DATA_DIR:dir,INITIAL_PASSWORD:password}});assert.equal(result.status,0,result.stderr.toString());return result.stdout.toString();};
const start=()=>new Promise((resolve,reject)=>{server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',chunk=>stderr+=chunk);server.once('error',reject);server.once('exit',code=>{if(code!==null&&code!==0)reject(new Error(stderr||'server exited '+code));});const probe=()=>fetch('http://127.0.0.1:'+port+'/api/auth/status').then(()=>resolve()).catch(()=>setTimeout(probe,100));probe();});
const stop=()=>new Promise(resolve=>{if(!server||server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill();});
let session='';
const request=async(method,route,body)=>{const r=await fetch('http://127.0.0.1:'+port+route,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});const cookie=r.headers.get('set-cookie');if(cookie)session=cookie.split(';')[0];return {status:r.status,data:await r.json()};};
const assetStatus=async route=>(await fetch('http://127.0.0.1:'+port+route,{headers:session?{Cookie:session}:{}})).status;
const activityFor=async domain=>{const route='/api/activity?from='+new Date().toISOString().slice(0,10)+'&to='+new Date().toISOString().slice(0,10)+'&domain='+encodeURIComponent(domain);return (await request('GET',route)).data[0]||{created:0,completed:0,updated:0,removed:0};};
const assertContiguousPositions=entries=>{
  const groups=new Map();
  const panes=workPaneMap(entries);
  for(const item of entries){
    const pane=item.domain==='Work'?(panes.get(item.id)||'left'):'';
    const key=[item.domain,pane,item.parentId||''].join('\0');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  for(const items of groups.values()){
    const positions=items.map(item=>item.position).sort((a,b)=>a-b);
    assert.deepEqual(positions,positions.map((_,index)=>index));
  }
};
try{
  assert.match(setPassword('original'),/原有登录会话已失效/);
  await start();
  assert.equal((await request('GET','/api/entries')).status,401);
  assert.equal(await assetStatus('/uploads/missing.png'),401);
  assert.equal((await request('POST','/api/auth/login',{password:'bad'})).status,401);
  assert.equal((await request('POST','/api/auth/login',{password:'original'})).status,200);

  let {data:item}=await request('POST','/api/entries',{domain:'Work',type:'todo',title:'Persistence check',content:'',dependencies:[]});
  assert.ok(item.createdAt);
  assert.equal(item.completedAt,null);
  const id=item.id;
  ({data:item}=await request('PUT','/api/entries/'+id,{...item,status:'done'}));
  assert.ok(item.completedAt);
  assert.equal(item.createdAt,(await request('GET','/api/entries')).data[0].createdAt);
  ({data:item}=await request('PUT','/api/entries/'+id,{...item,status:'removed'}));
  assert.ok(item.removedAt);
  assert.ok(item.completedAt);
  assert.equal((await request('PUT','/api/entries/'+id,{...item,parentId:id})).status,400);

  // Sessions live in SQLite, so a restart must not log the browser out.
  await stop();
  const db=new DatabaseSync(path.join(dir,'rafa.sqlite'));
  db.prepare('INSERT INTO entries VALUES (?,?)').run('old-idea',JSON.stringify({...item,id:'old-idea',domain:'Idea'}));
  db.close();
  await start();
  let entries=(await request('GET','/api/entries')).data;
  assert.equal(entries.find(entry=>entry.id===id).id,id);

  // Changing the password revokes every existing cookie immediately.
  assert.match(setPassword('replacement'),/原有登录会话已失效/);
  assert.equal((await request('GET','/api/entries')).status,401);
  assert.equal((await request('POST','/api/auth/login',{password:'original'})).status,401);
  assert.equal((await request('POST','/api/auth/login',{password:'replacement'})).status,200);
  entries=(await request('GET','/api/entries')).data;
  assert.equal(entries.find(entry=>entry.id==='old-idea').domain,'Glean & Idea');

  assert.equal((await request('POST','/api/entries',{domain:'Life',type:'link',title:'bad',content:'',url:'javascript:alert(1)'})).status,400);
  const child=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Child',content:'',parentId:id,dependencies:[id],related:[id]})).data;
  assert.equal((await request('DELETE','/api/entries/missing')).status,404);
  const deleted=await request('DELETE','/api/entries/'+id);
  assert.equal(deleted.status,200);
  assert.ok(!deleted.data.some(entry=>entry.id===id));
  const retained=deleted.data.find(entry=>entry.id===child.id);
  assert.equal(retained.parentId,'');
  assert.deepEqual(retained.dependencies,[]);
  assert.deepEqual(retained.related,[]);

  // New rows append to their own visible list, even though WORK panes share a domain.
  const leftParent=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Left parent',content:'',workPane:'left'})).data;
  const rightParent=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Right parent',content:'',workPane:'right'})).data;
  const leftA=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Left A',content:'',parentId:leftParent.id,workPane:'left'})).data;
  const leftB=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Left B',content:'',parentId:leftParent.id,workPane:'left'})).data;
  const rightA=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Right A',content:'',parentId:rightParent.id,workPane:'right'})).data;
  const rightB=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'Right B',content:'',parentId:rightParent.id,workPane:'right'})).data;
  assert.ok(leftB.position>leftA.position);
  assert.ok(rightB.position>rightA.position);
  entries=(await request('GET','/api/entries')).data;
  assert.deepEqual(entries.filter(entry=>entry.parentId===leftParent.id).sort((a,b)=>a.position-b.position).map(entry=>entry.title),['Left A','Left B']);
  assert.deepEqual(entries.filter(entry=>entry.parentId===rightParent.id).sort((a,b)=>a.position-b.position).map(entry=>entry.title),['Right A','Right B']);
  const prefixed=(await request('POST','/api/entries',{domain:'Work',type:'todo',status:'open',title:'登录页重做',content:'',prefixLabel:'需求',workPane:'left'})).data;
  assert.equal(prefixed.prefixLabel,'需求');

  // DAILY is a normal column now. LOOP tasks only count explicit completions,
  // and the same completion is idempotent within a period.
  assert.equal(domains.includes('Daily'),true);
  const dailyOne=(await request('POST','/api/entries',{domain:'Daily',type:'todo',status:'open',title:'每日复盘',content:'',loop:'day'})).data;
  assert.equal(dailyOne.domain,'Daily');assert.equal(dailyOne.loop,'day');assert.equal(dailyOne.loopCompletedCount,0);
  const dailyDoneOnCreate=(await request('POST','/api/entries',{domain:'Daily',type:'todo',status:'done',title:'创建时已完成',content:'',loop:'day'})).data;
  assert.equal(dailyDoneOnCreate.loopCompletedCount,1);
  let loopDone=(await request('PUT','/api/entries/'+dailyOne.id,{...dailyOne,status:'done'})).data;
  assert.equal(loopDone.status,'done');assert.equal(loopDone.loopCompletedCount,1);
  loopDone=(await request('PUT','/api/entries/'+loopDone.id,{...loopDone,status:'done'})).data;
  assert.equal(loopDone.loopCompletedCount,1);
  loopDone=(await request('PUT','/api/entries/'+loopDone.id,{...loopDone,status:'open'})).data;
  assert.equal(loopDone.status,'open');assert.equal(loopDone.loopCompletedCount,0);
  loopDone=(await request('PUT','/api/entries/'+loopDone.id,{...loopDone,status:'done'})).data;
  assert.equal(loopDone.loopCompletedCount,1);
  assert.equal((await request('POST','/api/entries',{domain:'Daily',type:'todo',title:'不是循环任务',content:''})).data.loop,'');

  // A title edit is only a text update: the UUID-scoped counter must survive.
  const renamedLoop=(await request('PUT','/api/entries/'+loopDone.id,{...loopDone,title:'改名后的每日复盘'})).data;
  assert.equal(renamedLoop.title,'改名后的每日复盘');
  assert.equal(renamedLoop.loopCompletedCount,1);
  assert.equal(renamedLoop.status,'done');
  const renamedAgain=(await request('PUT','/api/entries/'+renamedLoop.id,{...renamedLoop,title:'再换一次标题'})).data;
  assert.equal(renamedAgain.id,renamedLoop.id);
  assert.equal(renamedAgain.loopCompletedCount,1);
  assert.equal(renamedAgain.status,'done');
  const staleTitleWrite=(await request('PUT','/api/entries/'+renamedAgain.id,{...renamedAgain,title:'每日复盘'})).data;
  assert.equal(staleTitleWrite.id,renamedLoop.id);
  assert.equal(staleTitleWrite.loopCompletedCount,1);
  const once=renamedLoop;

  // The ledger is the source of truth. Removing this period's record simulates
  // crossing midnight without rewriting the task JSON; the old completion stays
  // in history, but the new period has no completion.
  await stop();
  const loopDb=new DatabaseSync(path.join(dir,'rafa.sqlite'));
  loopDb.prepare('UPDATE loop_completions SET period_key=? WHERE entry_id=?').run('2000-01-01',once.id);
  loopDb.close();
  await start();
  entries=(await request('GET','/api/entries')).data;
  const reset=entries.find(entry=>entry.id===once.id);
  assert.equal(reset.status,'open');assert.equal(reset.loopCompletedCount,1);assert.notEqual(reset.loopPeriod,'2000-01-01');
  const nextDone=(await request('PUT','/api/entries/'+reset.id,{...reset,status:'done'})).data;
  assert.equal(nextDone.loopCompletedCount,2);
  const nextRenamed=(await request('PUT','/api/entries/'+nextDone.id,{...nextDone,title:'再次改名'})).data;
  assert.equal(nextRenamed.loopCompletedCount,2);

  // Switching day -> week preserves historical total but starts the new rule
  // open. Switching back also preserves history and never invents a count.
  const switched=(await request('PUT','/api/entries/'+nextRenamed.id,{...nextRenamed,loop:'week'})).data;
  assert.equal(switched.loop,'week');assert.equal(switched.status,'open');assert.equal(switched.loopCompletedCount,2);
  const switchedDone=(await request('PUT','/api/entries/'+switched.id,{...switched,status:'done'})).data;
  assert.equal(switchedDone.loopCompletedCount,3);

  // A weekly task keeps its own Monday-based period.
  const weekOne=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'每周整理',content:'',loop:'week'})).data;
  const weekDone=(await request('PUT','/api/entries/'+weekOne.id,{...weekOne,status:'done'})).data;
  assert.equal(weekDone.loopCompletedCount,1);assert.match(weekDone.loopPeriod,/^\d{4}-\d{2}-\d{2}$/);

  // Legacy DAILY rows become ordinary Daily tasks exactly once.
  await stop();
  const legacyDb=new DatabaseSync(path.join(dir,'rafa.sqlite'));
  legacyDb.prepare("DELETE FROM settings WHERE key='daily-migrated'").run();
  legacyDb.prepare("INSERT INTO daily_items (id,text,position,created_at) VALUES (?,?,?,?)").run('legacy-daily','旧每日事项',0,'2026-01-01T00:00:00.000Z');
  legacyDb.close();
  await start();
  entries=(await request('GET','/api/entries')).data;
  const legacy=entries.find(entry=>entry.id==='daily-legacy-daily');
  assert.equal(legacy?.domain,'Daily');assert.equal(legacy?.title,'旧每日事项');assert.equal(legacy?.loop,'');

  // Deleting a middle row compacts positions without counting extra activity.
  const lifeA=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Life A',content:''})).data;
  const lifeB=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Life B',content:''})).data;
  const lifeC=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Life C',content:''})).data;
  const lifeStart=lifeA.position;
  assert.deepEqual([lifeA.position,lifeB.position,lifeC.position],[lifeStart,lifeStart+1,lifeStart+2]);
  const afterCreateActivity=await activityFor('Life');
  const afterDelete=(await request('DELETE','/api/entries/'+lifeB.id)).data;
  const remainingLife=afterDelete.filter(entry=>entry.domain==='Life'&&['Life A','Life C'].includes(entry.title)).sort((a,b)=>a.position-b.position);
  assert.deepEqual(remainingLife.map(entry=>entry.title),['Life A','Life C']);
  assert.equal(remainingLife[1].position,remainingLife[0].position+1);
  assert.deepEqual(await activityFor('Life'),afterCreateActivity);

  // Archiving compacts the visible list but is a layout operation, not activity.
  const done=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'done',title:'Archived done',content:''})).data;
  const blockedParent=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'done',title:'Done parent with open child',content:''})).data;
  const blockedChild=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Open child',content:'',parentId:blockedParent.id})).data;
  const beforeArchiveActivity=await activityFor('Life');
  const doneBeforeArchive=(await request('GET','/api/entries')).data.filter(entry=>entry.domain==='Life'&&['done','removed'].includes(entry.status)).length;
  const archivedResult=await request('POST','/api/archive',{domain:'Life'});
  assert.equal(archivedResult.status,200);
  assert.ok(archivedResult.data.count>=1&&archivedResult.data.count<=doneBeforeArchive);
  const visibleLife=archivedResult.data.items.filter(entry=>entry.domain==='Life');
  assert.ok(visibleLife.some(entry=>entry.id===blockedParent.id));
  assert.ok(visibleLife.some(entry=>entry.id===blockedChild.id));
  assert.ok(!visibleLife.some(entry=>entry.id===done.id));
  assertContiguousPositions(visibleLife);
  assert.deepEqual(await activityFor('Life'),beforeArchiveActivity);
  assert.ok((await request('GET','/api/archive')).data.some(entry=>entry.id===done.id));

  // Recurring tasks and their ancestors stay visible, regardless of status or domain.
  for(const domain of domains){
    const placement=domain==='Work'?{workPane:'left'}:{};
    const parent=(await request('POST','/api/entries',{...placement,domain,type:'todo',status:'done',title:'Parent of recurring task',content:''})).data;
    const recurring=[];
    for(const loop of ['day','week']){
      for(const status of ['open','done','removed']){
        const result=await request('POST','/api/entries',{...placement,domain,type:'todo',status,title:loop+' '+status,content:'',loop,parentId:status==='done'?parent.id:''});
        assert.equal(result.status,200);
        recurring.push(result.data);
      }
    }
    const ordinary=(await request('POST','/api/entries',{...placement,domain,type:'todo',status:'done',title:'Ordinary completed task',content:''})).data;
    const activityBefore=await activityFor(domain);
    const result=await request('POST','/api/archive',{domain});
    assert.equal(result.status,200);
    const visible=new Map(result.data.items.map(item=>[item.id,item]));
    assert.ok(visible.has(parent.id));
    assert.ok(!visible.has(ordinary.id));
    for(const item of recurring){
      assert.ok(visible.has(item.id),'Archive must retain '+domain+' '+item.loop+' '+item.status);
      const retained=visible.get(item.id);
      assert.ok(!retained.archivedAt);
      assert.equal(retained.status,item.status);
      assert.equal(retained.loopCompletedCount,item.loopCompletedCount);
      assert.equal(retained.completedAt,item.completedAt);
      assert.equal(retained.updatedAt,item.updatedAt);
      assert.equal(retained.parentId,item.parentId);
    }
    const archived=(await request('GET','/api/archive')).data;
    assert.ok(archived.some(item=>item.id===ordinary.id));
    assert.ok(!archived.some(item=>item.id===parent.id||recurring.some(loop=>loop.id===item.id)));
    assertContiguousPositions(result.data.items);
    assert.deepEqual(await activityFor(domain),activityBefore);
    const repeated=await request('POST','/api/archive',{domain});
    assert.equal(repeated.status,200);
    assert.equal(repeated.data.count,0);
    for(const item of recurring)assert.ok(repeated.data.items.some(entry=>entry.id===item.id));
  }

  // A move counts once; sibling rows renumbered only by compaction keep updatedAt.
  const moveA=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Move A',content:''})).data;
  const moveB=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Move B',content:''})).data;
  const moveC=(await request('POST','/api/entries',{domain:'Life',type:'todo',status:'open',title:'Move C',content:''})).data;
  const beforeMoveActivity=await activityFor('Life');
  const movedResult=await request('POST','/api/entries/move',{id:moveC.id,targetId:moveA.id,domain:'Life',placement:'before'});
  assert.equal(movedResult.status,200);
  assert.equal(movedResult.data.find(entry=>entry.id===moveA.id).updatedAt,moveA.updatedAt);
  assert.equal(movedResult.data.find(entry=>entry.id===moveB.id).updatedAt,moveB.updatedAt);
  assert.equal((await activityFor('Life')).updated,beforeMoveActivity.updated+1);

  // Image files are removed only after the last live or archived reference is gone.
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const uploadImage=async()=>{const uploaded=await request('POST','/api/upload',{base64:png,mime:'image/png'});assert.equal(uploaded.status,200);return uploaded.data.url;};
  const soloUrl=await uploadImage();
  assert.equal(await assetStatus(soloUrl),200);
  const solo=(await request('POST','/api/entries',{domain:'Life',type:'image',title:'Solo image',content:'',image:soloUrl,status:'open'})).data;
  await request('DELETE','/api/entries/'+solo.id);
  assert.equal(await assetStatus(soloUrl),404);

  const sharedUrl=await uploadImage();
  const archivedImage=(await request('POST','/api/entries',{domain:'Life',type:'image',title:'Archived reference',content:'',image:sharedUrl,status:'open',archivedAt:new Date().toISOString()})).data;
  const visibleImage=(await request('POST','/api/entries',{domain:'Life',type:'image',title:'Visible reference',content:'',image:sharedUrl,status:'open'})).data;
  await request('DELETE','/api/entries/'+visibleImage.id);
  assert.equal(await assetStatus(sharedUrl),200);
  await request('DELETE','/api/entries/'+archivedImage.id);
  assert.equal(await assetStatus(sharedUrl),404);

  const orphanPath=path.join(dir,'uploads','orphan-test.png');
  writeFileSync(orphanPath,Buffer.from(png,'base64'));
  const cleanupEnv={...process.env,DATA_DIR:dir};
  const cleanupDryRun=spawnSync(process.execPath,['scripts/cleanup-uploads.mjs'],{env:cleanupEnv,encoding:'utf8'});
  assert.equal(cleanupDryRun.status,0,cleanupDryRun.stderr);
  assert.match(cleanupDryRun.stdout,/模式：dry-run/);
  assert.match(cleanupDryRun.stdout,/orphan-test\.png/);
  assert.ok(existsSync(orphanPath));
  const cleanupApply=spawnSync(process.execPath,['scripts/cleanup-uploads.mjs','--apply'],{env:cleanupEnv,encoding:'utf8'});
  assert.equal(cleanupApply.status,0,cleanupApply.stderr);
  assert.match(cleanupApply.stdout,/已删除 1 个孤立文件/);
  assert.ok(!existsSync(orphanPath));

  for(let i=0;i<5;i++)assert.equal((await request('POST','/api/auth/login',{password:'bad'})).status,401);
  assert.equal((await request('POST','/api/auth/login',{password:'replacement'})).status,429);
  console.log('PASS: auth persistence and revocation, login limit, append order, prefix labels, layout compaction, activity counters, uploads, migration, validation and deletion');
}finally{
  if(server?.exitCode===null)await stop();
  rmSync(dir,{recursive:true,force:true});
}
