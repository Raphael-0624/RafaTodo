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
const click=async selector=>{
  await until(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,'Clickable '+selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
};
async function reload(){
  const previous=await evaluate('performance.timeOrigin');
  await send('Page.reload');
  await until(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`,'New page loaded');
}
const drawer=domain=>'[data-domain="'+domain+'"]';
async function settleDrawers(){
  await evaluate(`Promise.all([...document.querySelectorAll('.drawer,.drawer-surface')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})))`);
}
async function openDomain(domain){
  if(!await evaluate(`document.querySelector(${JSON.stringify(drawer(domain))})?.dataset.open==='true'`))await click(drawer(domain)+' .drawer-rail');
  await until(`document.querySelector(${JSON.stringify(drawer(domain))})?.dataset.open==='true'`,'Open '+domain);
  await settleDrawers();
}
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
  await reload();await until('!!document.querySelector(".board")','board');
  assert.equal(await evaluate(`(async()=>{
    const fonts=await document.fonts.load('29px "Patrick Hand"');
    return fonts.length===1&&fonts[0].status==='loaded'&&getComputedStyle(document.querySelector('.drawer-toggle h1')).fontFamily.includes('Patrick Hand');
  })()`),true,'Handwritten headings use the bundled font, not a platform fallback');
  assert.equal(await evaluate(`Promise.all(['sketch-rule','sketch-divider','sketch-highlight','sketch-frame','sketch-checkbox'].map(async name=>{
    const image=new Image();image.src='/'+name+'.svg';await image.decode();return image.naturalWidth>0;
  })).then(results=>results.every(Boolean))`),true,'All sketch strokes load without external services');
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.drawer-toggle h1'),'::after').backgroundImage.includes('sketch-highlight.svg')`),'Title marker stroke is visible');
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.drawer .checkbox')).backgroundImage.includes('sketch-checkbox.svg')`),'Tasks use hand-drawn checkboxes');
  assert.equal(await evaluate(`[...document.querySelectorAll('.column-count')].every(node=>node.textContent.trim()===''&&node.getAttribute('aria-label')?.includes('切换为'))`),true,'Column controls show only icons and keep accessible labels');
  assert.equal(await evaluate(`[...document.querySelectorAll('.drawer-rail')].every(node=>getComputedStyle(node,'::before').content==='none')`),true,'Collapsed drawer titles have no oversized frame');
  assert.equal(await evaluate(`[...document.querySelectorAll('.drawer-rail')].every(node=>{
    const path=node.querySelector('.drawer-tab-shape path');
    return getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)'&&path?.getAttribute('d').includes('C')&&getComputedStyle(path).fill!=='none';
  })`),true,'Folded rail fill and outline share a curved SVG silhouette');
  assert.equal(await evaluate(`[...document.querySelectorAll('.column-count')].every(node=>{
    const style=getComputedStyle(node);return style.borderWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(node,'::before').content==='none';
  })`),true,'Column switchers are unframed icons');
  assert.equal(await evaluate(`document.querySelectorAll('.drawer-number').length`),0,'Expanded and collapsed domain titles have no ordinal numbers');
  assert.equal(await evaluate(`[...document.querySelectorAll('.app>.topbar,.drawer .column-head,.drawer .work-col')].every(node=>{
    const style=getComputedStyle(node);return style.borderBottomWidth==='0px'&&style.borderRightWidth==='0px';
  })`),true,'Sketch separators do not have an underlying straight CSS border');
  await until(`!!document.querySelector(${JSON.stringify(row(ids.child))})`,'child visible');
  assert.equal(await evaluate('!!document.querySelector(".work-pinned-list")'),false,'No empty pinned area');
  await click(row(ids.child)+' .row-menu-trigger');
  await until('!!document.querySelector(".context-menu")');
  await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(node=>node.textContent==='置顶').click()`);
  await until('document.querySelector("[data-domain=Work] .work-pinned-list")?.textContent.includes("Child task")','WORK pins above board');
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>!!items.find(item=>item.id===${JSON.stringify(ids.child)}).pinnedAt)`,'Pin saved');
  assert.equal(await evaluate('!!document.querySelector("[data-domain=Work] .work-cols .pinned-list")'),false,'WORK pins sit above all internal lanes');
  await click(row(ids.parent)+' .task-toggle');
  await until(`!document.querySelector(${JSON.stringify(row(ids.child))})`,'child folded');
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.find(item=>item.id===${JSON.stringify(ids.parent)}).collapsed===true)`,'fold saved');
  await reload();await until(`!!document.querySelector(${JSON.stringify(row(ids.parent)+' .task-toggle[aria-expanded="false"]')})`,'fold persists');
  await click(row(ids.parent)+' .task-toggle');await until(`!!document.querySelector(${JSON.stringify(row(ids.child))})`);

  // Clicking the counter must open history, not the surrounding inline editor.
  await click(row(ids.weekly)+' .loop-label');
  await until('document.querySelector("dialog[open]")?.textContent.includes("累计 1 次")','weekly history');
  assert.equal(await evaluate('!!document.querySelector(".write-row")'),false);
  await screenshot('loop-history');await click('dialog[open] [aria-label="关闭"]');

  assert.equal(await evaluate('!!document.querySelector(".select-mode-trigger,.selection-bar")'),false);
  const geometry=async()=>{
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return evaluate(`(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const active=document.querySelector('.drawer.is-open');
    return {active:active.dataset.domain,panels:[...document.querySelectorAll('.drawer')].map(node=>({...rect(node),open:node.classList.contains('is-open')})),surface:rect(active.querySelector('.drawer-surface')),lanes:rect(active.querySelector('.work-cols')),panes:[...active.querySelectorAll('.work-col')].map(rect),inbox:rect(document.querySelector('.inbox-wrap')),input:rect(document.querySelector('#work-inbox')),pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,width:innerWidth,height:innerHeight};
    })()`);
  };
  function checkGeometry(value){
    assert.equal(value.panels.length,4);assert.equal(value.panels.filter(panel=>panel.open).length,1);
    assert.ok(value.panels.every(panel=>Math.abs(panel.y-value.panels[0].y)<1),'All four drawers share one horizontal row');
    for(let i=1;i<4;i++)assert.ok(Math.abs(value.panels[i].x-value.panels[i-1].right)<1,'Drawers stay adjacent');
    assert.ok(Math.abs(value.surface.width-value.panels.find(panel=>panel.open).width)<1,'Content uses the expanded width');
    assert.ok(value.panels.filter(panel=>!panel.open).every(panel=>panel.width>=30&&panel.width<=50),'Closed drawers become narrow rails');
    for(const pane of value.panes)assert.ok(Math.abs(pane.width-value.lanes.width/value.panes.length)<1,'Internal lanes stay equal');
    assert.ok(Math.abs(value.inbox.bottom-value.height)<1,'INBOX stays at the bottom');
    assert.ok(Math.abs(value.inbox.width-value.width)<1,'INBOX spans the workspace');
    assert.ok(value.pageWidth<=value.width&&value.pageHeight<=value.height,'No page overflow');
  }
  checkGeometry(await geometry());
  assert.ok(await evaluate(`(()=>{const pins=document.querySelector('.work-pinned-list').getBoundingClientRect(),head=document.querySelector('[data-domain=Work] .column-head').getBoundingClientRect(),lanes=document.querySelector('[data-domain=Work] .work-cols').getBoundingClientRect();return pins.y>=head.bottom&&pins.bottom<=lanes.y;})()`),'Pins sit below the domain title and above every lane');
  assert.equal(await evaluate('document.querySelectorAll(".layout-divider").length'),0,'Obsolete splitters are removed');
  const originalLayout=await evaluate(`fetch('/api/entries').then(response=>response.json()).then(items=>items.map(({id,workPane,parentId,position})=>({id,workPane,parentId,position})))`);
  for(const expected of [1,2,3]){
    await click(drawer('Work')+' .column-count');
    await until(`document.querySelector('[data-domain=Work] .work-cols').dataset.columns==='${expected}'`,'Cycle WORK lanes');
    assert.equal(await evaluate(`document.querySelectorAll('[data-domain=Work] .column-count .lane-glyph i').length`),expected,'Column icon reflects the selected number of lanes');
    for(const id of Object.values(ids).filter(id=>id!==ids.empty))assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(row(id))}).length`),1,'Folding never hides or duplicates tasks');
    assert.deepEqual(await evaluate(`fetch('/api/entries').then(response=>response.json()).then(items=>items.map(({id,workPane,parentId,position})=>({id,workPane,parentId,position})))`),originalLayout,'Column switches do not rewrite task ownership or order');
  }
  for(const [domain,count] of [['Daily',2],['Life',3],['Glean & Idea',2]]){
    await openDomain(domain);
    for(let n=1;n<count;n++)await click(drawer(domain)+' .column-count');
    await until(`document.querySelector(${JSON.stringify(drawer(domain)+' .work-cols')}).dataset.columns==='${count}'`,'Independent columns '+domain);
    checkGeometry(await geometry());
  }
  const storedDrawers=await evaluate('localStorage.getItem("rafa-drawers-v1")');
  await reload();await until('!!document.querySelector(".drawer.is-open")');
  assert.equal(await evaluate('localStorage.getItem("rafa-drawers-v1")'),storedDrawers,'Active drawer and independent counts survive reload');
  assert.equal((await geometry()).active,'Glean & Idea');
  await openDomain('Life');
  await click(drawer('Life')+' [data-work-pane=third] .add-row button');
  await send('Input.insertText',{text:'Life third lane'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.some(item=>item.title==='Life third lane'&&item.domain==='Life'&&item.workPane==='third'))`,'Creating in a non-WORK third lane persists the right ownership');
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await openDomain('Work');
  await click(drawer('Work')+' [data-work-pane=left] .add-row button');
  await send('Input.insertText',{text:'Saved before image drop'});
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4KkAAAAASUVORK5CYII='),char=>char.charCodeAt(0))],'drawer-drop.png',{type:'image/png'}));document.querySelector('[data-domain=Daily] .drawer-rail').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await until(`document.querySelector('[data-domain=Daily]').dataset.open==='true'&&document.querySelector('.write-row textarea')?.value.includes('drawer-drop.png')`,'Dropping an image opens the correct drawer');
  await settleDrawers();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.some(item=>item.domain==='Daily'&&item.type==='image'&&item.title==='drawer-drop.png')&&items.some(item=>item.domain==='Work'&&item.title==='Saved before image drop'))`,'Image drop preserves the previous editor and saves the image in its drawer');
  await openDomain('Work');
  await click(drawer('Life')+' .drawer-rail');
  await until(`document.querySelector('[data-domain=Life]').dataset.open==='true'`);
  const surfaceWidth=await evaluate(`document.querySelector('[data-domain=Life] .drawer-surface').getBoundingClientRect().width`);
  await pause(80);
  assert.equal(await evaluate(`document.querySelector('[data-domain=Life] .drawer-surface').getBoundingClientRect().width`),surfaceWidth,'Content width stays fixed during shell animation');
  await click(drawer('Daily')+' .drawer-rail');await openDomain('Daily');checkGeometry(await geometry());
  await openDomain('Work');
  // A failed save must leave both the current drawer and the input intact.
  await click(drawer('Work')+' [data-work-pane=left] .add-row button');
  await send('Input.insertText',{text:'Save before switching'});
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/entries'&&args[1]?.method==='POST'){window.fetch=original;throw Error('Simulated save failure');}return original(...args);};})()`);
  await click(drawer('Daily')+' .drawer-rail');
  await until('document.querySelector(".toast-message")?.textContent.includes("Simulated save failure")','Failed save is visible');
  assert.equal((await geometry()).active,'Work');
  assert.equal(await evaluate('document.querySelector(".write-row textarea").value'),'Save before switching','Failed switch retains input');
  await openDomain('Daily');await until('!document.querySelector(".write-row")','Successful switch saves first');
  assert.ok(await evaluate(`fetch('/api/entries').then(response=>response.json()).then(items=>items.some(item=>item.title==='Save before switching'&&item.domain==='Work'))`));
  await openDomain('Work');

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
  await click('[data-domain="Work"] [data-work-pane="third"] .add-row button');
  await until('!!document.querySelector(".write-row textarea")');
  await send('Input.insertText',{text:'Third pane task'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await until('Array.from(document.querySelectorAll("[data-domain=Work] [data-work-pane=third] .entry-title")).some(node=>node.textContent==="Third pane task")');
  await reload();await until('!!document.querySelector(".board")');
  await until('Array.from(document.querySelectorAll("[data-domain=Work] [data-work-pane=third] .entry-title")).some(node=>node.textContent==="Third pane task")');
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

  const crossPane=await evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(row(ids.sibling)+' .drag-handle')}).getBoundingClientRect();const target=document.querySelector('[data-domain="Work"] [data-work-pane="third"]').getBoundingClientRect();return {x:source.x+8,y:source.y+8,tx:target.x+80,ty:target.bottom-65};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:crossPane.x,y:crossPane.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:crossPane.tx,y:crossPane.ty,buttons:1});
  await until('!!document.querySelector("[data-domain=Work] [data-work-pane=third].is-end-drop")','Drop into third pane');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:crossPane.tx,y:crossPane.ty,button:'left',clickCount:1});
  await until(`document.querySelector(${JSON.stringify(row(ids.sibling))})?.closest('[data-work-pane]')?.dataset.workPane==='third'`,'Third pane drag saved');

  async function dragToDrawer(id,domain,pane){
    await evaluate(`Promise.all(document.querySelector('.board').getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))`);
    await pause(120);
    const points=await evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(row(id)+' .drag-handle')}),rail=document.querySelector(${JSON.stringify(drawer(domain)+' .drawer-rail')});source.scrollIntoView({block:'center',behavior:'instant'});const s=source.getBoundingClientRect(),r=rail.getBoundingClientRect();return {x:s.x+7,y:s.y+8,tx:r.x+r.width/2,ty:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:points.x,y:points.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.tx,y:points.ty,buttons:1});
    await until(`document.querySelector(${JSON.stringify(drawer(domain))}).dataset.open==='true'`,'Hover opens '+domain);
    await settleDrawers();
    const target=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(drawer(domain)+' [data-work-pane="'+pane+'"]')}).getBoundingClientRect();return {x:r.x+80,y:r.bottom-65};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target,buttons:1});
    await until(`!!document.querySelector(${JSON.stringify(drawer(domain)+' [data-work-pane="'+pane+'"].is-end-drop')})`,'Cross-drawer end target');
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
    await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.some(item=>item.id===${JSON.stringify(id)}&&item.domain===${JSON.stringify(domain)}&&item.workPane===${JSON.stringify(pane)}))`,'Cross-drawer move saved');
    await pause(120);
  }
  await dragToDrawer(ids.sibling,'Daily','right');
  await dragToDrawer(ids.sibling,'Work','third');

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  checkGeometry(await geometry());
  await inboxValue('Mobile wrapped content '.repeat(30));
  await until('document.querySelector("#work-inbox").clientHeight>60','Mobile INBOX wraps');
  checkGeometry(await geometry());await screenshot('mobile-layout');
  await inboxValue('');
  await evaluate(`document.querySelector('[data-domain=Work] .work-scroll').scrollLeft=120`);
  await until(`JSON.parse(localStorage.getItem('rafa-drawer-scroll'))?.['Work:3:x']===120`,'Mobile horizontal scroll saved');
  await openDomain('Life');
  await click(row(ids.empty)+' .loop-label');
  await until('document.querySelector("dialog[open]")?.textContent.includes("还没有完成记录")','empty history');
  assert.ok(await evaluate('document.querySelector("dialog[open]").getBoundingClientRect().right<=window.innerWidth'));
  await click('dialog[open] [aria-label="关闭"]');
  await openDomain('Work');
  await until(`document.querySelector('[data-domain=Work] .work-scroll').scrollLeft===120`,'Returning to a drawer restores horizontal scroll');
  await screenshot('mobile-drawers');
  await send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
  checkGeometry(await geometry());
  await evaluate(`(async()=>{
    for(const [domain,workPane] of ['Work','Daily','Life','Glean & Idea'].flatMap(domain=>['left','right','third'].map(pane=>[domain,pane]))){
      const response=await fetch('/api/entries/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain,workPane,text:Array.from({length:35},(_,i)=>domain+' scroll '+i).join('\\n')})});
      if(!response.ok)throw Error('Scroll fixture failed');
    }
  })()`);
  await reload();await until('document.querySelectorAll(".entry").length>400');
  checkGeometry(await geometry());
  for(const domain of ['Work','Daily','Life','Glean & Idea']){
    await openDomain(domain);
    const scrolls=await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(drawer(domain)+' .work-col-scroll')})];nodes.forEach(node=>node.scrollTop=0);return nodes.map((node,index)=>{node.scrollTop=50;const result={scrollable:node.scrollHeight>node.clientHeight,moved:node.scrollTop===50,independent:nodes.every((other,i)=>i===index||other.scrollTop===0)};node.scrollTop=0;return result;});})()`);
    assert.ok(scrolls.every(value=>value.scrollable&&value.moved&&value.independent),'Every visible lane scrolls independently in '+domain);
    await evaluate(`document.querySelector(${JSON.stringify(drawer(domain)+' .work-col-scroll')}).scrollTop=90`);
    await until(`Object.entries(JSON.parse(localStorage.getItem('rafa-drawer-scroll'))).some(([key,top])=>key.startsWith(${JSON.stringify(domain+':')})&&key.endsWith(':left')&&top===90)`,'Scroll saved '+domain);
  }
  await openDomain('Work');
  await until(`document.querySelector('[data-domain=Work] .work-col-scroll').scrollTop===90`,'Switch restores WORK scroll');
  await reload();await until(`document.querySelector('[data-domain=Work] .work-col-scroll')?.scrollTop===90`,'Reload restores scroll');
  await click(row(ids.parent)+' .task-toggle');
  await until(`!document.querySelector(${JSON.stringify(row(ids.child))})`,'Fold before locating a pin');
  await click('.work-pinned-list .pinned-title');
  await until(`!!document.querySelector(${JSON.stringify(row(ids.child))})`,'Pinned task locator preserves task interactions');
  await click('.work-pinned-list .pinned-unpin');
  await until('!document.querySelector(".work-pinned-list")','Unpin removes the empty top area');
  await until(`fetch('/api/entries').then(response=>response.json()).then(items=>!items.find(item=>item.id===${JSON.stringify(ids.child)}).pinnedAt)`,'Unpin saved');

  async function taskAction(id,label){
    const domain=await evaluate(`fetch('/api/entries').then(response=>response.json()).then(items=>items.find(item=>item.id===${JSON.stringify(id)}).domain)`);
    await openDomain(domain);
    await click(row(id)+' .row-menu-trigger');
    await until('!!document.querySelector(".context-menu")');
    await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(node=>node.textContent===${JSON.stringify(label)}).click()`);
  }
  const focusState=()=>evaluate(`fetch('/api/focus').then(response=>response.json())`);
  const floatButton=label=>evaluate(`Array.from(document.querySelectorAll('.focus-card-actions button')).find(node=>node.textContent===${JSON.stringify(label)}).click()`);
  await taskAction(ids.parent,'设为进行中');
  await until('!!document.querySelector(".focus-card")','Start floating task');
  assert.equal(await evaluate('document.querySelectorAll(".focus-card").length'),1);
  assert.ok(await evaluate(`!!document.querySelector('[data-focus-entry-id="${ids.child}"]')`),'Float includes child tasks');
  assert.equal(await evaluate(`document.querySelector('[data-focus-entry-id="${ids.child}"] .entry-body').innerHTML`),await evaluate(`document.querySelector(${JSON.stringify(row(ids.child)+' .entry-body')}).innerHTML`),'Float shares main task formatting');
  await click(`[data-focus-entry-id="${ids.parent}"] .task-toggle`);
  await until(`!document.querySelector(${JSON.stringify(row(ids.child))})&&!document.querySelector('[data-focus-entry-id="${ids.child}"]')`,'Float folding syncs to main list');
  await click(`[data-focus-entry-id="${ids.parent}"] .task-toggle`);
  await until(`!!document.querySelector('[data-focus-entry-id="${ids.child}"]')`);
  await click(`[data-focus-entry-id="${ids.child}"] .row-menu-trigger`);
  await until('!!document.querySelector(".context-menu")');
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.context-menu').getBoundingClientRect();return !!document.elementFromPoint(r.x+20,r.y+15)?.closest('.context-menu');})()`),'Task menus remain clickable above the float');
  await evaluate(`document.querySelector('.context-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  const running=await focusState();assert.equal(running.activeId,ids.parent);
  const initialClock=await evaluate('document.querySelector(".focus-timer").textContent');
  await until(`document.querySelector('.focus-timer').textContent!==${JSON.stringify(initialClock)}`,'Timer ticks');
  await reload();await until('!!document.querySelector(".focus-card")','Float restores on reload');
  assert.equal((await focusState()).runningSince,running.runningSince,'Reload does not reset timing');
  await evaluate(`Promise.all(document.querySelector('.focus-card').getAnimations().map(animation=>animation.finished))`);
  await screenshot('focus-card');
  await floatButton('ZEN');await until('!!document.querySelector(".zen-screen")');
  assert.equal(await evaluate('!!document.querySelector(".focus-card")'),false,'ZEN replaces its minimized card');
  assert.equal((await focusState()).runningSince,running.runningSince);
  await click('.zen-hold');await until('!!document.querySelector(".focus-card")&&!document.querySelector(".zen-screen")','One-click ZEN minimize');
  assert.equal((await focusState()).runningSince,running.runningSince,'Minimizing keeps the same clock');
  await floatButton('暂停');await until('!document.querySelector(".focus-card")','Pause hides the card');
  const pausedFocus=await focusState();assert.equal(pausedFocus.activeId,'');assert.ok(pausedFocus.elapsed[ids.parent]>=1000);
  await pause(1100);assert.equal((await focusState()).elapsed[ids.parent],pausedFocus.elapsed[ids.parent]);
  await reload();
  await until(`document.querySelector(${JSON.stringify(row(ids.parent)+' .row-menu-trigger')})?.textContent==='继续'`,'Paused entry survives reload');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ids.parent)+' .row-menu-trigger')}).textContent`),'继续');
  await taskAction(ids.parent,'继续');await until('!!document.querySelector(".focus-card")');
  assert.equal((await focusState()).elapsed[ids.parent],pausedFocus.elapsed[ids.parent]);
  await taskAction(ids.sibling,'设为进行中');
  await until(`!!document.querySelector('[data-focus-entry-id="${ids.sibling}"]')`,'Switch to another task');
  const switchedFocus=await focusState();assert.equal(switchedFocus.activeId,ids.sibling);assert.ok(switchedFocus.elapsed[ids.parent]>=pausedFocus.elapsed[ids.parent]);
  assert.equal(await evaluate('document.querySelectorAll(".focus-card").length'),1,'Only one float exists');
  await taskAction(ids.parent,'继续');await until(`!!document.querySelector('[data-focus-entry-id="${ids.child}"]')`);
  await click(`[data-focus-entry-id="${ids.child}"] .checkbox`);
  await until(`!!document.querySelector(${JSON.stringify(row(ids.child)+'.is-done')})`,'Child completion syncs to main list');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.focus-card').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;})()`),'Float fits mobile');
  await screenshot('mobile-focus-card');
  await floatButton('完成任务');await until('!document.querySelector(".focus-card")','Finish closes the float');
  await until(`!!document.querySelector(${JSON.stringify(row(ids.parent)+'.is-done')})`,'Finish updates the main task');
  assert.equal((await focusState()).activeId,'');

  const {data:imageData}=await send('Page.captureScreenshot',{format:'png'});
  const imageIds=await evaluate(`(async()=>{
    const post=async(url,body)=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
    const {url}=await post('/api/upload',{mime:'image/png',base64:${JSON.stringify(imageData)}});
    const image=await post('/api/entries',{domain:'Work',workPane:'third',type:'image',title:'Preview image',content:'![Inline preview]('+url+')',image:url});
    const archived=await post('/api/entries',{domain:'Life',type:'image',title:'Archived preview image',content:'',image:url,status:'done'});
    await post('/api/archive',{domain:'Life'});
    return {image:image.id,archived:archived.id,url};
  })()`);
  await reload();await until(`!!document.querySelector(${JSON.stringify(row(imageIds.image)+' .thumb')})`);
  const imageSelector=row(imageIds.image)+' .thumb';
  async function openImage(selector){
    const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center',behavior:'instant'});const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await until('!!document.querySelector(".image-viewer[open]")','Image opens without editing');
    await until('document.querySelector(".image-viewer-image").naturalWidth>0','Full image loaded');
    assert.equal(await evaluate('!!document.querySelector(".write-row,.drag-caption")'),false,'Image click does not edit or drag');
    assert.equal(await evaluate('document.querySelector(".image-viewer-image").getAttribute("src")'),imageIds.url);
    assert.ok(await evaluate(`(()=>{const r=document.querySelector('.image-viewer').getBoundingClientRect();return r.x===0&&r.y===0&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1;})()`),'Fullscreen overlay');
  }
  await openImage(imageSelector);
  await click('.image-viewer-image');
  assert.equal(await evaluate('!!document.querySelector(".image-viewer[open]")'),true,'Clicking the picture keeps it open');
  await click('.image-viewer-close');await until('!document.querySelector(".image-viewer")');
  assert.equal(await evaluate(`document.activeElement.matches(${JSON.stringify(imageSelector)})`),true,'Close restores image focus');
  await openImage(imageSelector);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:300,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:300,button:'left',clickCount:1});
  await until('!document.querySelector(".image-viewer")','Blank area closes preview');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await until('!!document.querySelector(".image-viewer[open]")','Keyboard opens image');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await until('!document.querySelector(".image-viewer")','Escape closes preview');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await openImage(imageSelector);await screenshot('mobile-image-preview');
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.image-viewer-image').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`),'Large image fits mobile viewport');
  await click('.image-viewer-close');
  await click('.archive-view');
  await until('!!document.querySelector(".archive-image")');
  await evaluate(`Promise.all(document.querySelector('.archive-modal').getAnimations().map(animation=>animation.finished))`);
  await openImage('.archive-image');
  await click('.image-viewer-close');
  assert.equal(await evaluate('!!document.querySelector(".archive-modal")'),true,'Closing image keeps archive open');
  await click('[aria-label="关闭归档"]');
  await click(row(imageIds.image)+' .row-menu-trigger');
  await until('!!document.querySelector(".context-menu")');
  await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(node=>node.textContent==='ZEN 专注').click()`);
  await until('!!document.querySelector(".zen-main-image")');
  await evaluate(`Promise.all(document.querySelector('.zen-content').getAnimations().map(animation=>animation.finished))`);
  await openImage('.zen-main-image');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await until('!document.querySelector(".image-viewer")');
  assert.equal(await evaluate('!!document.querySelector(".zen-screen")&&!document.querySelector(".zen-actions .confirming")'),true,'Escape closes only the image, not ZEN');
  await openImage('.zen-task p img');
  await click('.image-viewer-close');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await until('!!document.querySelector(".focus-card")&&!document.querySelector(".zen-screen")','Escape minimizes ZEN without pausing');
  await floatButton('ZEN');await until('!!document.querySelector(".zen-screen")');
  await click('.zen-done');
  await until('document.querySelector(".zen-done")?.textContent.includes("确认完成")','ZEN keeps completion confirmation');
  assert.equal((await focusState()).activeId,imageIds.image);
  await click('.zen-done');
  await until('!document.querySelector(".zen-screen,.focus-card")','ZEN completion stops the shared timer');
  assert.equal((await focusState()).activeId,'');
  await click('[data-domain="Work"] [data-work-pane="third"] .add-row button');
  await until('!!document.querySelector(".write-row textarea")');
  await send('Input.insertText',{text:'不刷短视频 !resist'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  const resistId=await until(`fetch('/api/entries').then(response=>response.json()).then(items=>items.find(item=>item.title==='不刷短视频'&&item.resist)?.id)`,'Create habit with !resist');
  await reload();await until(`!!document.querySelector(${JSON.stringify(row(resistId)+' .resist-add')})`);
  const resistRow=row(resistId),resistLabel=resistRow+' .resist-label';
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(resistRow+' .checkbox')})`),false,'Habits do not have completion checkboxes');
  const resistCount=()=>evaluate(`document.querySelector(${JSON.stringify(resistLabel)}).textContent`);
  assert.ok((await resistCount()).includes('今日0次 · 累计0次'));
  await click(resistRow+' .resist-add');
  await until(`document.querySelector(${JSON.stringify(resistLabel)}).textContent.includes('累计1次')`,'+1 records a success');
  assert.equal(await evaluate('!!document.querySelector(".write-row")'),false,'+1 never opens editing');
  await click('.resist-toast button');
  await until(`document.querySelector(${JSON.stringify(resistLabel)}).textContent.includes('累计0次')`,'Undo removes only that success');
  await click(resistRow+' .resist-add');
  await until(`document.querySelector(${JSON.stringify(resistLabel)}).textContent.includes('累计1次')`);
  await click(resistRow+' .resist-add');
  await until(`document.querySelector(${JSON.stringify(resistLabel)}).textContent.includes('累计2次')`,'Several successes in one day');
  await click(resistLabel);await until('!!document.querySelector(".resist-history-day")','Habit history');
  assert.equal(await evaluate('document.querySelectorAll(".resist-history-day li").length'),2);
  await click('.resist-history-day li button');
  await until('document.querySelectorAll(".resist-history-day li").length===1','Delete a mistaken history record');
  assert.ok((await resistCount()).includes('累计1次'));
  await click('dialog[open] [aria-label="关闭"]');
  // Simulate a response lost after the server saved it; the explicit retry must reuse its ID.
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(args[0].includes('/resist-records')&&args[1]?.method==='POST'){window.fetch=original;await original(...args);throw Error('Simulated lost response');}return original(...args);};})()`);
  await click(resistRow+' .resist-add');
  await until('!!document.querySelector(".toast-retry")','Lost response offers retry');
  await click('.toast-retry');
  await until(`document.querySelector(${JSON.stringify(resistLabel)}).textContent.includes('累计2次')`,'Retry does not count twice');
  await evaluate(`(async()=>{
    const request=async(url,method,body)=>{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());};
    const id=${JSON.stringify(resistId)};
    await request('/api/entries/'+id,'PUT',{resist:false});
    await request('/api/focus','POST',{action:'start',id});
    await request('/api/focus','POST',{action:'pause',id});
    await request('/api/entries/'+id,'PUT',{resist:true});
  })()`);
  await reload();await until(`document.querySelector(${JSON.stringify(resistLabel)})?.textContent.includes('今日2次 · 累计2次')`,'Habit counts survive reload');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(resistRow+' .row-menu-trigger')}).textContent.includes('继续')`),false,'Converting a paused task to a habit hides the focus resume shortcut');
  await taskAction(resistId,'ZEN 专注');
  assert.equal(await evaluate('!!document.querySelector(".zen-screen,.focus-card")'),false,'Habits cannot start ZEN');
  await evaluate(`document.querySelector('.context-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await evaluate(`document.querySelector(${JSON.stringify(resistRow)}).scrollIntoView({block:'center',behavior:'instant'})`);
  assert.ok(await evaluate(`(()=>{const entry=document.querySelector(${JSON.stringify(resistRow)}),label=entry.querySelector('.resist-label').getBoundingClientRect(),add=entry.querySelector('.resist-add').getBoundingClientRect(),pane=entry.closest('.work-col').getBoundingClientRect();return label.width>70&&label.left>=pane.left&&label.right<=pane.right&&add.left>=pane.left&&add.right<=pane.right;})()`),'Mobile habit label and +1 stay readable within their pane');
  await screenshot('mobile-resist');
  await openDomain('Work');
  await evaluate(`document.querySelector('[data-domain=Work] .drawer-toggle').focus()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
  await until(`document.querySelector('[data-domain=Daily]').dataset.open==='true'`,'Keyboard switches drawers');
  await settleDrawers();
  assert.equal(await evaluate(`document.activeElement.matches('[data-domain=Daily] .drawer-toggle')`),true,'Keyboard focus follows the expanded drawer');
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await openDomain('Life');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.drawer.is-open')).transitionDuration`),'0s','Reduced motion disables the drawer transition');
  checkGeometry(await geometry());
  await screenshot('mobile-drawers-life');
  await send('Emulation.setEmulatedMedia',{features:[]});
  await openDomain('Work');
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS: desktop/mobile drawers, independent columns, non-mutating folds, save failure, hover drag, scroll/reload, keyboard/reduced motion, image preview, focus/ZEN and resist check-ins');
}catch(error){
  try{await screenshot('browser-failure');}catch{}
  throw error;
}finally{
  ws?.close();
  for(const child of [browser,app])if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exited,pause(3000)]);}
  rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
