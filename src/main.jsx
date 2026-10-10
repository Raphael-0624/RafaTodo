import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus,ArrowUpRight,Check,TextT,LinkSimple,ImageSquare,DotsSixVertical,DownloadSimple,X,Trash,ArrowCounterClockwise} from '@phosphor-icons/react';
import {domains,parseLine,toLine,treeRows} from './lib/entries.js';
import './style.css';

async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'请求失败');
  return data;
}
const titleOf=item=>item.title||item.content||item.url||'图片';
const editLine=(item,entries)=>toLine(item,entries,{hideTaskPrefix:true});
const clamp=value=>Math.min(75,Math.max(25,value));
function readLayout(){try{const value=JSON.parse(localStorage.getItem('rafa-layout'));return {work:clamp(Number(value?.work)||50),life:clamp(Number(value?.life)||50)};}catch{return {work:50,life:50};}}
function App(){
  const [items,setItems]=useState([]),[draft,setDraft]=useState(null),[text,setText]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [authenticated,setAuthenticated]=useState(null),[password,setPassword]=useState(''),[loggingIn,setLoggingIn]=useState(false);
  const [drop,setDrop]=useState(null),[dragging,setDragging]=useState(''),[hint,setHint]=useState(null),[choice,setChoice]=useState(0);
  const textarea=useRef(null),drag=useRef(null),currentDrop=useRef(null),suppressClick=useRef(false);
  const saving=useRef(null);
  const [layout,setLayout]=useState(readLayout);
  const board=useRef(null);
  useEffect(()=>{try{localStorage.setItem('rafa-layout',JSON.stringify(layout));}catch{}},[layout]);
  const itemsRef=useRef(items);itemsRef.current=items;
  const draftRef=useRef(null);draftRef.current=draft;
  useEffect(()=>{api('/api/auth/status').then(status=>{setAuthenticated(status.authenticated);if(status.authenticated)api('/api/entries').then(setItems).catch(e=>setError(e.message));}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  useEffect(()=>{
    if(!textarea.current)return;
    textarea.current.style.height='0px';textarea.current.style.height=Math.max(25,textarea.current.scrollHeight)+'px';
  },[text,draft]);
  useEffect(()=>()=>{drag.current?.cleanup?.();},[]);
  useEffect(()=>{
    if(!draft)return;
    const commit=event=>{if(!event.target.closest('.write-row, .drag-handle, .row-actions'))save();};
    document.addEventListener('pointerdown',commit);
    return ()=>document.removeEventListener('pointerdown',commit);
  },[draft,text,busy]);
  function replaceItem(saved){setItems(previous=>previous.some(item=>item.id===saved.id)?previous.map(item=>item.id===saved.id?saved:item):[...previous,saved]);}
  async function login(event){event.preventDefault();if(!password.trim()||loggingIn)return;setLoggingIn(true);setError('');try{await api('/api/auth/login','POST',{password});setPassword('');setAuthenticated(true);setItems(await api('/api/entries'));}catch(e){setError(e.message);}finally{setLoggingIn(false);}}
  async function logout(){await api('/api/auth/logout','POST').catch(()=>{});setAuthenticated(false);setItems([]);close();}
  function close(){setDraft(null);setText('');setHint(null);}
  async function save(closeAfter=true){
    if(saving.current)return saving.current;
    if(!draft||busy)return false;
    if(!text.trim()){close();return true;}
    if(draft.id&&text===editLine(draft,items)){if(closeAfter)close();return draft;}
    setBusy(true);setError('');
    const operation=(async()=>{try{
      const value=parseLine(text,draft,items);
      if(!value.title&&!value.content&&!value.image&&!value.url){close();return true;}
      const saved=await api('/api/entries'+(value.id?'/'+value.id:''),value.id?'PUT':'POST',value);
      replaceItem(saved);
      if(closeAfter)close();else{setDraft(saved);setText(editLine(saved,items));}
      return saved;
    }catch(e){setError(e.message);return false;}finally{setBusy(false);}})();
    saving.current=operation;
    try{return await operation;}finally{saving.current=null;}
  }
  async function open(item,domain){
    if((busy&&!saving.current)||suppressClick.current)return;
    if(draft&&(item?.id===draft.id&&item?.id||!item&&!draft.id&&draft.domain===domain)){textarea.current?.focus();return;}
    if(draft&&!await save())return;
    const value=item||{domain,title:'',content:'',type:'todo',status:'open',parentId:'',position:Math.max(-1,...items.filter(entry=>entry.domain===domain&&!entry.parentId).map(entry=>entry.position??0))+1};
    setDraft(value);setText(item?editLine(item,items):'');setHint(null);setError('');
  }
  async function updateStatus(item,status=item.status==='done'?'open':'done'){
    if(busy&&!saving.current)return;
    if(draft){const saved=await save();if(!saved)return;if(saved.id===item.id)item=saved;}
    setBusy(true);setError('');
    try{replaceItem(await api('/api/entries/'+item.id,'PUT',{...item,status}));}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function deleteItem(item){
    if(busy)return;
    if(!window.confirm('永久删除“'+titleOf(item)+'”？子条目会保留。'))return;
    if(draft?.id===item.id)close();else if(draft&&!await save())return;
    setBusy(true);setError('');
    try{setItems(await api('/api/entries/'+item.id,'DELETE'));}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function resize(event,axis){
    if(event.button!==0)return;
    event.preventDefault();
    const handle=event.currentTarget,rect=board.current.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    const move=event=>{const value=axis==='work'?(event.clientX-rect.left)/rect.width*100:(event.clientY-rect.top)/rect.height*100;setLayout(previous=>({...previous,[axis]:clamp(value)}));};
    const finish=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);document.body.classList.remove('is-resizing');};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);document.body.classList.add('is-resizing');
  }
  function divider(axis){return <div className={'divider divider-'+axis} role="separator" tabIndex={0} aria-label={axis==='work'?'调整 WORK 宽度':'调整 LIFE 高度'} aria-orientation={axis==='work'?'vertical':'horizontal'} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(layout[axis])} onPointerDown={event=>resize(event,axis)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)){event.preventDefault();setLayout(previous=>({...previous,[axis]:event.key==='Home'?50:clamp(previous[axis]+(['ArrowLeft','ArrowUp'].includes(event.key)?-2:2))}));}}}/>;}
  async function move(spec){
    setBusy(true);setError('');
    try{setItems(await api('/api/entries/move','POST',spec));}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function beginDrag(event,item){
    if(event.button!==0||busy)return;
    event.preventDefault();
    const start={x:event.clientX,y:event.clientY},state={id:item.id,active:false};
    drag.current=state;
    function point(event){
      if(!state.active&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<5)return;
      if(!state.active){state.active=true;setDragging(item.id);document.body.classList.add('is-dragging');}
      event.preventDefault();
      const node=document.elementFromPoint(event.clientX,event.clientY);
      const row=node?.closest('[data-entry-id]'),column=node?.closest('[data-domain]');
      let next=null;
      if(column){
        const domain=column.dataset.domain;
        if(row){
          const box=row.getBoundingClientRect(),portion=(event.clientY-box.top)/box.height;
          const target=itemsRef.current.find(entry=>entry.id===row.dataset.entryId);
          if(target&&target.id!==item.id){
            const indent=Number(row.dataset.depth||0)*22;
            const placement=portion>.25&&portion<.75&&event.clientX>box.left+indent+55?'inside':portion<.5?'before':'after';
            next={id:item.id,targetId:target.id,domain,placement};
          }
        }else next={id:item.id,domain,placement:'end'};
      }
      currentDrop.current=next;setDrop(next);
      if(column){const box=column.getBoundingClientRect();if(event.clientY<box.top+45)column.scrollBy(0,-12);if(event.clientY>box.bottom-45)column.scrollBy(0,12);}
    }
    async function finish(){
      const spec=currentDrop.current;
      cleanup();
      if(state.active){suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},100);}
      if(state.active&&spec){if(draftRef.current&&!await save())return;await move(spec);}
    }
    function cancel(){cleanup();}
    function cleanup(){
      window.removeEventListener('pointermove',point);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);
      document.body.classList.remove('is-dragging');setDragging('');setDrop(null);drag.current=null;currentDrop.current=null;
    }
    state.cleanup=cleanup;
    window.addEventListener('pointermove',point,{passive:false});window.addEventListener('pointerup',finish,{once:true});window.addEventListener('pointercancel',cancel,{once:true});
  }
  function suggest(value,caret){
    const match=value.slice(0,caret).match(/(?:^|\s)([@#])([^\s@#]*)$/);
    if(!match){setHint(null);return;}
    const symbol=match[1],query=match[2];
    const values=symbol==='@'?items.flatMap(item=>[item.owner,...(item.people||'').split(/[,，]\s*/)]):items.flatMap(item=>(item.tags||'').split(/[,，]\s*/));
    const options=[...new Set(values.filter(Boolean))].filter(value=>value.toLowerCase().startsWith(query.toLowerCase())&&value!==query).slice(0,5);
    setChoice(0);setHint(options.length?{symbol,start:caret-query.length-1,end:caret,options}:null);
  }
  function complete(value){
    if(!hint)return;
    const next=text.slice(0,hint.start)+hint.symbol+value+' '+text.slice(hint.end);
    const caret=hint.start+value.length+2;setText(next);setHint(null);
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(caret,caret);});
  }
  async function indent(outdent){
    if(!draft)return;
    let item=draft;
    if(text.trim()){const saved=await save(false);if(!saved||saved===true)return;item=saved;}
    if(!item.id)return;
    const all=itemsRef.current.some(entry=>entry.id===item.id)?itemsRef.current:[...itemsRef.current,item];
    const parent=all.find(entry=>entry.id===item.parentId);
    if(outdent){if(!parent)return;await move({id:item.id,targetId:parent.id,domain:item.domain,placement:'after'});}
    else{
      const siblings=treeRows(all,item.domain).filter(row=>(row.item.parentId||'')===(item.parentId||''));
      const index=siblings.findIndex(row=>row.item.id===item.id),previous=siblings[index-1]?.item;
      if(!previous)return;await move({id:item.id,targetId:previous.id,domain:item.domain,placement:'inside'});
    }
    close();
  }
  async function upload(file,domain){
    if(!file||busy)return;
    const base=draft||{domain,type:'image',parentId:'',position:Math.max(-1,...items.filter(item=>item.domain===domain&&!item.parentId).map(item=>item.position??0))+1};
    setBusy(true);setError('');
    try{
      if(file.size>8*1024*1024)throw new Error('图片不能超过 8MB');
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const result=await api('/api/upload','POST',{base64,mime:file.type});
      setDraft(base);setText(previous=>(previous?previous+' ':'')+'!['+file.name.replace(/[\[\]]/g,'')+']('+result.url+')');setHint(null);
      requestAnimationFrame(()=>textarea.current?.focus());
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function editor(){
    let preview;try{preview=parseLine(text,draft,items);}catch{preview=draft;}
    return <div className="write-row">
      <span className={'write-mark '+(preview.type==='todo'?'task-mark':'')}>{preview.type==='text'?<TextT size={15}/>:preview.type==='link'?<LinkSimple size={15}/>:preview.type==='image'?<ImageSquare size={15}/>:null}</span>
      <div className="write-input">
        <textarea ref={textarea} autoFocus rows="1" aria-label="直接编辑条目" placeholder="写一条…" value={text} disabled={busy} onChange={event=>{setText(event.target.value);suggest(event.target.value,event.target.selectionStart);}} onClick={event=>suggest(text,event.target.selectionStart)}
          onPaste={event=>{const file=Array.from(event.clipboardData.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,draft.domain);}}}
          onKeyDown={event=>{
            if(event.nativeEvent.isComposing||event.keyCode===229)return;
            if(event.key==='Escape'){event.preventDefault();if(hint)setHint(null);else close();return;}
            if(hint&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setChoice(previous=>(previous+(event.key==='ArrowDown'?1:-1)+hint.options.length)%hint.options.length);return;}
            if(hint&&(event.key==='Tab'||event.key==='Enter')){event.preventDefault();complete(hint.options[choice]);return;}
            if(event.key==='Tab'){event.preventDefault();indent(event.shiftKey);return;}
            if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();save();}
          }}/>
        {hint&&<div className="suggestions" role="listbox" aria-label={hint.symbol==='@'?'人员建议':'标签建议'}>{hint.options.map((value,index)=><button key={value} className={choice===index?'selected':''} onMouseDown={event=>event.preventDefault()} onClick={()=>complete(value)} role="option" aria-selected={choice===index}>{hint.symbol}{value}</button>)}</div>}
      </div>
    </div>;
  }
  function row(item,depth){
    const editing=draft?.id===item.id,done=item.status==='done',removed=item.status==='removed';
    const target=drop?.targetId===item.id?drop.placement:'';
    const overdue=item.type==='todo'&&item.dueDate&&item.dueDate<new Date().toLocaleDateString('en-CA')&&!done&&!removed;
    const timeTitle=[['createdAt','创建'],['updatedAt','更新'],['completedAt','完成'],['removedAt','移除']].filter(([key])=>item[key]).map(([key,name])=>name+'：'+new Date(item[key]).toLocaleString('zh-CN',{hour12:false})).join('\n');
    return <div key={item.id} className={'entry '+(done?'is-done ':'')+(removed?'is-removed ':'')+(dragging===item.id?'drag-source ':'')+(target?'drop-'+target:'')} data-entry-id={item.id} data-depth={depth} style={{'--depth':depth}}>
      <button className="drag-handle" title="拖动排序；放在文字中间成为子条目" aria-label={'拖动 '+titleOf(item)} onPointerDown={event=>beginDrag(event,item)}><DotsSixVertical size={14}/></button>
      {editing?editor():<div className="entry-read">
        {item.type==='todo'?<button className={'checkbox '+(done?'checked':'')} aria-label={done?'重新打开任务':'完成任务'} onClick={()=>updateStatus(item)} disabled={busy}>{done&&<Check size={11} weight="bold"/>}{removed&&<span>−</span>}</button>:<span className="kind-mark">{item.type==='text'?<TextT size={15}/>:item.type==='link'?<LinkSimple size={15}/>:<ImageSquare size={15}/>}</span>}
        <button className="entry-body" title={timeTitle} onClick={()=>open(item)} aria-label={'编辑 '+titleOf(item)}>
          <span className="entry-title">{titleOf(item)}</span>
          {item.content&&item.title&&<span className="entry-note">{item.content}</span>}
          {item.image&&<img className="thumb" src={item.image} alt={item.title||'条目图片'}/>}
          <span className="entry-meta">
            {item.priority==='urgent'&&<span className="urgent">!! 紧急</span>}{item.priority==='high'&&<span className="high">! 重要</span>}
            {item.owner&&<span className="person">@{item.owner}</span>}
            {item.people&&item.people.split(/[,，]\s*/).map(name=><span key={name} className="person related-person">@{name}</span>)}
            {item.tags&&item.tags.split(/[,，]\s*/).map(tag=><span className="tag" key={tag}>#{tag}</span>)}
            {item.dueDate&&<span className={overdue?'overdue':'date'}>↗ {item.dueDate}</span>}
            {item.status==='waiting'&&<span>等待中</span>}{item.status==='doing'&&<span>进行中</span>}
            {item.stage&&<span>{item.stage}</span>}
            {item.planDate&&<span>计划 {item.planDate}</span>}{item.followupDate&&<span>跟进 {item.followupDate}</span>}
            {Object.entries(item.custom||{}).filter(([,value])=>value).map(([key,value])=><span key={key}>{key} · {value}</span>)}
            {(item.dependencies||[]).map(id=><span key={id} className="relation">← {items.find(entry=>entry.id===id)?.title||'前置任务'}</span>)}
            {(item.related||[]).map(id=><span key={id} className="relation">↔ {items.find(entry=>entry.id===id)?.title||'关联条目'}</span>)}
            {removed&&<span>已移除</span>}
          </span>
        </button>
        <div className="row-actions">
          <button title={removed?'恢复条目':'取消条目'} aria-label={removed?'恢复条目':'取消条目'} disabled={busy} onClick={()=>updateStatus(item,removed?'open':'removed')}>{removed?<ArrowCounterClockwise size={14}/>:<X size={14}/>}</button>
          <button title="永久删除" aria-label="永久删除条目" disabled={busy} onClick={()=>deleteItem(item)}><Trash size={14}/></button>
        </div>
        {item.url&&<a className="open-link" href={item.url} target="_blank" rel="noreferrer" aria-label="打开链接" title="打开链接"><ArrowUpRight size={15}/></a>}
      </div>}
    </div>;
  }
  function exportAll(){
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(items,null,2)],{type:'application/json'}));
    link.href=url;link.download='rafatodo.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(authenticated===null||loading)return <div className="auth-screen"><div className="auth-mark">rafa<span>todo</span><i/></div><span className="auth-loading">正在打开…</span></div>;
  if(!authenticated)return <div className="auth-screen"><form className="auth-form" onSubmit={login}><div className="auth-mark">rafa<span>todo</span><i/></div><label htmlFor="password">输入密码</label><div className="auth-input"><input id="password" type="password" autoFocus autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="••••••"/><button type="submit" disabled={loggingIn||!password}>{loggingIn?'…':'进入'}</button></div>{error&&<p className="auth-error">{error}</p>}</form></div>;
  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="RafaTodo 首页">rafa<span>todo</span><i/></a><div className="top-actions"><button className="export" onClick={exportAll} aria-label="导出全部条目" title="导出 JSON"><DownloadSimple size={18}/></button><button className="logout" onClick={logout}>退出</button></div></header>
    {error&&<div className="global-error" role="alert">{error}</div>}
    <main ref={board} className="board" style={{'--work':layout.work+'%','--life':layout.life+'%'}}>{domains.map(domain=><section className={'column '+(drop?.domain===domain&&drop.placement==='end'?'drop-column':'')} key={domain} data-domain={domain} aria-label={domain}
      onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}}
      onDrop={event=>{const file=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,domain);}}}>
      <div className="column-head"><h1>{domain.toUpperCase()}</h1><span>{items.filter(item=>item.domain===domain&&item.type==='todo'&&!['done','removed'].includes(item.status)).length}</span></div>
      <div className="column-content">{loading?<div className="loading">加载中…</div>:treeRows(items,domain).map(({item,depth})=>row(item,depth))}</div>
      <div className="add-row">{draft&&!draft.id&&draft.domain===domain?editor():<button onClick={()=>open(null,domain)} aria-label={'在 '+domain+' 新增条目'}><Plus size={14}/><span>写一条…</span></button>}</div>
    </section>)}{divider('work')}{divider('life')}</main>
    {dragging&&<div className="drag-caption">{drop?.placement==='inside'?'成为子条目':drop?.placement==='end'?'移到 '+drop.domain+' 末尾':drop?'移动到这里':'拖到目标位置'}</div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
