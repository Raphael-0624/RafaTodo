import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';

const chrome=process.env.CHROME_BIN||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(chrome,'Set CHROME_BIN to a Chrome/Chromium executable.');
assert.ok(existsSync('dist/index.html'),'Run npm run build first.');
const dir=mkdtempSync(path.join(tmpdir(),'rafa-browser-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const port=await freePort(),debugPort=await freePort(),origin='http://127.0.0.1:'+port;
let app,browser,ws;
const errors=[],pending=new Map();let sequence=0;
async function waitFor(run,label){
  let last;
  for(let i=0;i<100;i++){try{const result=await run();if(result)return result;}catch(error){last=error;}await pause(100);}
  throw new Error('Timed out: '+label+(last?' '+last.message:''));
}
async function send(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
}
const until=(expression,label)=>waitFor(()=>evaluate(expression),label||expression);
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const button=text=>evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
const row=id=>'[data-entry-id="'+id+'"]';
async function screenshot(name){
  const {data}=await send('Page.captureScreenshot',{format:'png'});
  const file=path.join(tmpdir(),'rafatodo-'+name+'.png');writeFileSync(file,Buffer.from(data,'base64'));console.log('Screenshot: '+file);
}
try{
  const setup=spawnSync(process.execPath,['scripts/set-password.mjs'],{env:{...process.env,DATA_DIR:dir,INITIAL_PASSWORD:'browser-test'},encoding:'utf8'});
  assert.equal(setup.status,0,setup.stderr);
  app=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:'ignore'});
  await waitFor(()=>fetch(origin+'/api/auth/status').then(response=>response.ok),'test server');
  browser=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port='+debugPort,'--user-data-dir='+path.join(dir,'chrome'),'about:blank'],{stdio:'ignore'});
  const targets=await waitFor(()=>fetch('http://127.0.0.1:'+debugPort+'/json').then(response=>response.json()),'isolated Chrome');
  ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(request){if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);}}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin});
  await until('!!document.querySelector("#password")','login screen');
  const ids=await evaluate(`(async()=>{
    const api=async(url,body)=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
    await api('/api/auth/login',{password:'browser-test'});
    const parent=await api('/api/entries',{type:'todo',domain:'Work',workPane:'left',title:'Parent task',content:''});
    const child=await api('/api/entries',{type:'todo',domain:'Work',workPane:'left',parentId:parent.id,title:'Child task',content:''});
    const sibling=await api('/api/entries',{type:'todo',domain:'Work',workPane:'left',title:'Sibling task',content:''});
    const weekly=await api('/api/entries',{type:'todo',domain:'Work',workPane:'right',title:'Weekly task',content:'',loop:'week',status:'done'});
    const empty=await api('/api/entries',{type:'todo',domain:'Life',title:'Empty history task',content:'',loop:'day'});
    return {parent:parent.id,child:child.id,sibling:sibling.id,weekly:weekly.id,empty:empty.id};
  })()`);
  await send('Page.reload');await until('!!document.querySelector(".board")','board');
  await until(`!!document.querySelector(${JSON.stringify(row(ids.child))})`,'child visible');
  await click(row(ids.parent)+' .task-toggle');
  await until(`!document.querySelector(${JSON.stringify(row(ids.child))})`,'child folded');
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.find(item=>item.id===${JSON.stringify(ids.parent)}).collapsed===true)`,'fold saved');
  await send('Page.reload');await until(`!!document.querySelector(${JSON.stringify(row(ids.parent)+' .task-toggle[aria-expanded="false"]')})`,'fold persists');
  await click(row(ids.parent)+' .task-toggle');await until(`!!document.querySelector(${JSON.stringify(row(ids.child))})`);

  // Clicking the counter must open history, not the surrounding inline editor.
  await click(row(ids.weekly)+' .loop-label');
  await until('document.querySelector("dialog[open]")?.textContent.includes("累计 1 次")','weekly history');
  assert.equal(await evaluate('!!document.querySelector(".write-row")'),false);
  await screenshot('loop-history');await click('dialog[open] [aria-label="关闭"]');

  assert.equal(await evaluate('!!document.querySelector(".select-mode-trigger,.selection-bar")'),false);
  const geometry=()=>evaluate(`(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {work:rect(document.querySelector('[data-domain="Work"]')),panes:[...document.querySelectorAll('.work-col')].map(rect),lower:[...document.querySelectorAll('.side-board>.column')].map(rect),inbox:rect(document.querySelector('.inbox-wrap')),input:rect(document.querySelector('#work-inbox')),pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,width:innerWidth,height:innerHeight};
  })()`);
  function checkGeometry(value){
    assert.equal(value.panes.length,3);
    for(const pane of value.panes)assert.ok(Math.abs(pane.width-value.work.width/3)<1,'WORK panes stay equal');
    assert.ok(value.lower.every(col=>Math.abs(col.y-value.lower[0].y)<1),'Lower domains stay side by side');
    assert.ok(value.lower[0].y>=value.work.bottom,'WORK is above lower domains');
    assert.ok(Math.abs(value.inbox.bottom-value.height)<1,'INBOX stays at the bottom');
    assert.ok(Math.abs(value.inbox.width-value.work.width)<1,'INBOX spans the workspace');
    assert.ok(value.pageWidth<=value.width&&value.pageHeight<=value.height,'No page overflow');
  }
  checkGeometry(await geometry());
  async function dragDivider(selector,dx,dy){
    const box=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x+dx,y:box.y+dy,buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+dx,y:box.y+dy,button:'left',clickCount:1});
    await until('!document.body.classList.contains("is-resizing")');
  }
  const before=await geometry();
  await dragDivider('.layout-divider-horizontal',0,-100);
  await until(`document.querySelector('[data-domain="Work"]').getBoundingClientRect().height<${before.work.height-70}`,'WORK height drag');
  await dragDivider('.layout-divider-vertical',90,0);
  await until(`document.querySelector('.side-board>.column').getBoundingClientRect().width>${before.lower[0].width+60}`,'DAILY width drag');
  const lowerBefore=(await geometry()).lower;
  await dragDivider('.layout-divider-vertical:last-child',80,0);
  await until(`document.querySelector('.side-board>.column:last-of-type').getBoundingClientRect().width<${lowerBefore[2].width-50}`,'LIFE width drag');
  checkGeometry(await geometry());
  const savedLayout=await evaluate('localStorage.getItem("rafa-layout-v2")');
  await send('Page.reload');await until('!!document.querySelector(".board")');
  assert.equal(await evaluate('localStorage.getItem("rafa-layout-v2")'),savedLayout,'Divider settings persist');
  const persisted=await geometry();checkGeometry(persisted);
  assert.ok(Math.abs(persisted.work.height-(before.work.height-100))<3);

  async function inboxValue(text){
    await evaluate(`(()=>{const input=document.querySelector('#work-inbox');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  const oneLine=(await geometry()).input.height;
  assert.ok(oneLine<=36,'INBOX initially one line');
  await inboxValue('Inbox first line\nSecond line\nThird line\nFourth line');
  await until(`document.querySelector('#work-inbox').clientHeight>${oneLine+40}`,'INBOX grows');
  await inboxValue(Array(100).fill('Long pasted content').join('\n'));
  await until('document.querySelector("#work-inbox").scrollHeight>document.querySelector("#work-inbox").clientHeight','Long INBOX scrolls');
  assert.ok((await geometry()).input.height<=280);
  checkGeometry(await geometry());
  await inboxValue('');await until(`document.querySelector('#work-inbox').clientHeight<=${oneLine}`,'INBOX shrinks');

  // Creation in the new third pane must survive a reload without moving legacy panes.
  await click('.work-col[data-work-pane="third"] .add-row button');
  await until('!!document.querySelector(".write-row textarea")');
  await send('Input.insertText',{text:'Third pane task'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await until('Array.from(document.querySelectorAll("[data-work-pane=third] .entry-title")).some(node=>node.textContent==="Third pane task")');
  await send('Page.reload');await until('!!document.querySelector(".board")');
  await until('Array.from(document.querySelectorAll("[data-work-pane=third] .entry-title")).some(node=>node.textContent==="Third pane task")');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ids.parent))}).closest('[data-work-pane]').dataset.workPane`),'left');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ids.weekly))}).closest('[data-work-pane]').dataset.workPane`),'right');
  await screenshot('desktop-layout');

  // Real clipboard events exercise both choices without calling application internals.
  await click(row(ids.sibling)+' .entry-body');await until('!!document.querySelector(".write-row textarea")');
  await evaluate(`(()=>{const input=document.querySelector('.write-row textarea');input.setSelectionRange(input.value.length,input.value.length);const clipboard=new DataTransfer();clipboard.setData('text/plain','\\nPasted A\\nPasted B');input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));})()`);
  await until('document.querySelector("dialog[open]")?.textContent.includes("粘贴多行内容")');
  await button('保留一条');
  assert.equal(await evaluate('document.querySelector(".write-row textarea").value'),'Sibling task\nPasted A\nPasted B');
  assert.equal(await evaluate('document.activeElement.tagName'),'TEXTAREA','paste dialog returns focus to the editor');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await until('!document.querySelector(".write-row")');
  await click(row(ids.sibling)+' .entry-body');await until('!!document.querySelector(".write-row textarea")');
  await evaluate(`(()=>{const input=document.querySelector('.write-row textarea');input.setSelectionRange(input.value.length,input.value.length);const clipboard=new DataTransfer();clipboard.setData('text/plain','\\nSplit A\\nSplit B');input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));})()`);
  await until('!!document.querySelector("dialog[open]")');await button('按行拆分');
  await until('!document.querySelector("dialog[open]")&&!document.querySelector(".write-row")');
  await until('Array.from(document.querySelectorAll(".entry-title")).some(node=>node.textContent==="Split B")','split rows');
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(row(ids.sibling))}).length`),1);

  // Pointer-driven drag shows before/inside/after intent; Escape cancels without saving.
  const points=await evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(row(ids.sibling)+' .drag-handle')}).getBoundingClientRect();const target=document.querySelector(${JSON.stringify(row(ids.weekly))}).getBoundingClientRect();return {sx:source.x+8,sy:source.y+8,x:target.x+90,top:target.top,height:target.height};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:points.sx,y:points.sy,button:'left',clickCount:1});
  for(const [portion,kind] of [[.1,'before'],[.5,'inside'],[.9,'after']]){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x,y:points.top+points.height*portion,button:'left',buttons:1});
    await until(`!!document.querySelector(${JSON.stringify(row(ids.weekly)+'.drop-'+kind)})`,'drag '+kind);
  }
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('!document.querySelector(".drag-caption")');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.x,y:points.top+points.height*.9,button:'left',clickCount:1});

  const crossPane=await evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(row(ids.sibling)+' .drag-handle')}).getBoundingClientRect();const target=document.querySelector('[data-work-pane="third"]').getBoundingClientRect();return {x:source.x+8,y:source.y+8,tx:target.x+80,ty:target.bottom-65};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:crossPane.x,y:crossPane.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:crossPane.tx,y:crossPane.ty,buttons:1});
  await until('!!document.querySelector("[data-work-pane=third].is-end-drop")','Drop into third pane');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:crossPane.tx,y:crossPane.ty,button:'left',clickCount:1});
  await until(`document.querySelector(${JSON.stringify(row(ids.sibling))})?.closest('[data-work-pane]')?.dataset.workPane==='third'`,'Third pane drag saved');

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  checkGeometry(await geometry());
  await inboxValue('Mobile wrapped content '.repeat(30));
  await until('document.querySelector("#work-inbox").clientHeight>60','Mobile INBOX wraps');
  checkGeometry(await geometry());await screenshot('mobile-layout');
  await inboxValue('');
  await click(row(ids.empty)+' .loop-label');
  await until('document.querySelector("dialog[open]")?.textContent.includes("还没有完成记录")','empty history');
  assert.ok(await evaluate('document.querySelector("dialog[open]").getBoundingClientRect().right<=window.innerWidth'));
  await click('dialog[open] [aria-label="关闭"]');
  await send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
  checkGeometry(await geometry());
  await evaluate(`(async()=>{
    for(const [domain,workPane] of [['Work','left'],['Work','right'],['Work','third'],['Daily',''],['Life',''],['Glean & Idea','']]){
      const response=await fetch('/api/entries/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain,workPane,text:Array.from({length:35},(_,i)=>domain+' scroll '+i).join('\\n')})});
      if(!response.ok)throw Error('Scroll fixture failed');
    }
  })()`);
  await send('Page.reload');await until('document.querySelectorAll(".entry").length>200');
  checkGeometry(await geometry());
  const scrolls=await evaluate(`(()=>{
    const nodes=[...document.querySelectorAll('.work-col-scroll,.side-board .column-scroll')];
    return nodes.map((node,index)=>{node.scrollTop=50;const result={scrollable:node.scrollHeight>node.clientHeight,moved:node.scrollTop===50,independent:nodes.every((other,i)=>i===index||other.scrollTop===0)};node.scrollTop=0;return result;});
  })()`);
  assert.equal(scrolls.length,6);assert.ok(scrolls.every(value=>value.scrollable&&value.moved&&value.independent),'All six lists scroll independently');
  await evaluate(`document.querySelector('[data-work-pane="third"] .work-col-scroll').scrollTop=90`);
  await until('JSON.parse(localStorage.getItem("rafa-work-scroll"))?.third===90','Third pane scroll saved');
  await send('Page.reload');
  await until('document.querySelector("[data-work-pane=third] .work-col-scroll")?.scrollTop===90','Third pane scroll restored');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS: desktop/mobile layout, divider dragging and persistence, third pane creation, INBOX autosizing, collapse, loop records, multiline paste and drop feedback');
}finally{
  ws?.close();
  for(const child of [browser,app])if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exited,pause(3000)]);}
  rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
