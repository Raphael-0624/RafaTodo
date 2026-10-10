import React,{useState,useEffect,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus,ArrowUpRight,Check,TextT,LinkSimple,ImageSquare,DotsSixVertical,X,Trash,ArrowCounterClockwise,CaretDown,CaretRight,ChartBar} from '@phosphor-icons/react';
import {domains,parseLine,toLine,treeRows,pasteLink} from './lib/entries.js';
import './style.css';

async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'请求失败');
  return data;
}
const titleOf=item=>item.title||item.content||item.url||'图片';
function inline(value){return String(value).split(/(`[^`]+`|!?\[[^\]]+\]\(https?:\/\/[^\s)]+\)|==[^=]+==|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*)/g).map((part,index)=>{const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(link)return <a key={index} className="markdown-link" href={link[2]} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>{link[1]}<ArrowUpRight size={11}/></a>;if(part.startsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;if(part.startsWith('=='))return <mark key={index}>{part.slice(2,-2)}</mark>;if(part.startsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;if(part.startsWith('~~'))return <del key={index}>{part.slice(2,-2)}</del>;if(part.startsWith('*'))return <em key={index}>{part.slice(1,-1)}</em>;return part;});}
const editLine=(item,entries)=>toLine(item,entries,{hideTaskPrefix:true});
const prefersReducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=value=>Math.min(75,Math.max(25,value));
function readLayout(){try{const value=JSON.parse(localStorage.getItem('rafa-layout'));return {work:clamp(Number(value?.work)||50),life:clamp(Number(value?.life)||50)};}catch{return {work:50,life:50};}}
const dayKey=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-CA');};
function Heatmap({items,open,onClose}){
  const [domain,setDomain]=useState(''),[activity,setActivity]=useState([]),[selected,setSelected]=useState('');
  useEffect(()=>{if(!open)return;const end=new Date(),start=new Date(end);start.setDate(end.getDate()-181);api('/api/activity?from='+dayKey(start)+'&to='+dayKey(end)+(domain?'&domain='+encodeURIComponent(domain):'')).then(setActivity).catch(()=>setActivity([]));},[open,domain]);
  if(!open)return null;
  const end=new Date(),start=new Date(end);start.setDate(end.getDate()-181);start.setDate(start.getDate()-start.getDay());
  const cells=Array.from({length:27*7},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return dayKey(date);});
  const map=new Map(activity.map(row=>[row.date,row]));
  const selectedItems=selected?items.filter(item=>item.domain&&(domain?item.domain===domain:true)&&[item.createdAt,item.updatedAt,item.completedAt,item.removedAt].some(value=>dayKey(value)===selected)).slice(0,12):[];
  return <div className="heatmap-popover" role="dialog" aria-label="活动热力图" onPointerDown={event=>event.stopPropagation()}>
    <div className="heatmap-head"><strong>活动热力图</strong><button onClick={onClose} aria-label="关闭热力图">×</button></div>
    <div className="heatmap-filters"><button className={!domain?'active':''} onClick={()=>{setDomain('');setSelected('');}}>全部</button>{domains.map(value=><button key={value} className={domain===value?'active':''} onClick={()=>{setDomain(value);setSelected('');}}>{value==='Glean & Idea'?'GLEAN & IDEA':value.toUpperCase()}</button>)}</div>
    <div className="heatmap-grid" aria-label="最近六个月活动"><div className="heatmap-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div className="heatmap-cells">{cells.map((date,index)=>{const row=map.get(date),total=row?row.created+row.completed+row.updated+row.removed:0,level=total?Math.min(4,Math.ceil(total/3)):0;return <button key={date+'-'+index} className={'heat-cell level-'+level+(selected===date?' selected':'')} title={`${date} · ${total} 次活动`} aria-label={`${date}，${total} 次活动`} onClick={()=>setSelected(date)}/>})}</div></div>
    <div className="heatmap-legend"><span>少</span><i className="level-0"/><i className="level-1"/><i className="level-2"/><i className="level-3"/><i className="level-4"/><span>多</span></div>
    {selected&&<div className="heatmap-detail"><div className="heatmap-detail-head"><strong>{selected}</strong><span>{(()=>{const row=map.get(selected);return row?`新增 ${row.created} · 完成 ${row.completed} · 更新 ${row.updated}`:'无活动';})()}</span></div>{selectedItems.length?<div className="heatmap-items">{selectedItems.map(item=><button key={item.id} onClick={()=>{onClose();document.querySelector(`[data-entry-id="${item.id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});}}>{titleOf(item)}</button>)}</div>:<span className="heatmap-empty">当天没有可回顾的条目</span>}</div>}
  </div>;
}
function App(){
  const [items,setItems]=useState([]),[draft,setDraft]=useState(null),[text,setText]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [authenticated,setAuthenticated]=useState(null),[password,setPassword]=useState(''),[loggingIn,setLoggingIn]=useState(false);
  const [drop,setDrop]=useState(null),[dragging,setDragging]=useState(''),[hint,setHint]=useState(null),[choice,setChoice]=useState(0),[menu,setMenu]=useState(null),[confirmDelete,setConfirmDelete]=useState('');
  const textarea=useRef(null),drag=useRef(null),currentDrop=useRef(null),suppressClick=useRef(false);
  const saving=useRef(null);
  const [picker,setPicker]=useState('');
  const [heatmapOpen,setHeatmapOpen]=useState(false);

  const [layout,setLayout]=useState(readLayout);
  const board=useRef(null),beforePositions=useRef(null);
  useLayoutEffect(()=>{
    const previous=beforePositions.current;beforePositions.current=null;
    if(!previous||prefersReducedMotion())return;
    for(const node of board.current?.querySelectorAll('[data-entry-id]')||[]){
      const old=previous.get(node.dataset.entryId);if(!old)continue;
      const rect=node.getBoundingClientRect(),x=old.left-rect.left,y=old.top-rect.top;
      if(Math.abs(x)+Math.abs(y)>1)node.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  },[items]);
  function applyItems(next){
    beforePositions.current=new Map([...board.current?.querySelectorAll('[data-entry-id]')||[]].map(node=>[node.dataset.entryId,node.getBoundingClientRect()]));
    setItems(previous=>{const old=new Map(previous.map(item=>[item.id,item]));return next.map(item=>JSON.stringify(old.get(item.id))===JSON.stringify(item)?old.get(item.id):item);});
  }
  function feedback(id){
    if(prefersReducedMotion())return;
    requestAnimationFrame(()=>{const node=[...board.current?.querySelectorAll('[data-entry-id]')||[]].find(node=>node.dataset.entryId===id)?.querySelector('.entry-read');node?.animate([{backgroundColor:'#eaf1e4'},{backgroundColor:'transparent'}],{duration:360,easing:'ease-out'});});
  }
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
    const commit=event=>{if(!event.target.closest('.write-row, .drag-handle, .row-actions, .group-controls'))save();};
    document.addEventListener('pointerdown',commit);
    return ()=>document.removeEventListener('pointerdown',commit);
  },[draft,text,busy]);
  useEffect(()=>{const closeTransient=event=>{setMenu(null);if(!event.target.closest('.row-actions'))setConfirmDelete('');if(!event.target.closest('.heatmap-trigger,.heatmap-popover'))setHeatmapOpen(false);};document.addEventListener('pointerdown',closeTransient);return()=>document.removeEventListener('pointerdown',closeTransient);},[]);
  function replaceItem(saved){applyItems(itemsRef.current.some(item=>item.id===saved.id)?itemsRef.current.map(item=>item.id===saved.id?saved:item):[...itemsRef.current,saved]);}
  async function login(event){event.preventDefault();if(!password.trim()||loggingIn)return;setLoggingIn(true);setError('');try{await api('/api/auth/login','POST',{password});setPassword('');setAuthenticated(true);setItems(await api('/api/entries'));}catch(e){setError(e.message);}finally{setLoggingIn(false);}}
  function close(){setDraft(null);setText('');setHint(null);}
  async function save(closeAfter=true){
    if(saving.current)return saving.current;
    if(!draft||busy)return false;
    if(!text.trim()){close();return true;}
    if(draft.id&&text===editLine(draft,items)){if(closeAfter)close();return draft;}
    setBusy(true);setError('');
    const operation=(async()=>{try{
      const value=parseLine(text,draft,items);delete value.insert;
      if(value.type!=='divider'&&!value.title&&!value.content&&!value.image&&!value.url){close();return true;}
      const saved=await api('/api/entries'+(value.id?'/'+value.id:''),value.id?'PUT':'POST',value);
      replaceItem(saved);
      if(!value.id&&draft.insert){await move({id:saved.id,targetId:draft.insert.targetId,domain:saved.domain,placement:draft.insert.placement});}
      if(closeAfter)close();else{setDraft(saved);setText(editLine(saved,items));}
      return saved;
    }catch(e){setError(e.message);return false;}finally{setBusy(false);}})();
    saving.current=operation;
    try{return await operation;}finally{saving.current=null;}
  }
  async function open(item,domain,parentId=''){
    if((busy&&!saving.current)||suppressClick.current)return;
    if(draft&&(item?.id===draft.id&&item?.id||!item&&!draft.id&&draft.domain===domain)){textarea.current?.focus();return;}
    if(draft&&!await save())return;
    const value=item||{domain,title:'',content:'',type:'todo',status:'open',parentId,position:Math.max(-1,...items.filter(entry=>entry.domain===domain&&(entry.parentId||'')===parentId).map(entry=>entry.position??0))+1};
    setDraft(value);setText(item?editLine(item,items):'');setHint(null);setError('');
  }
  async function insertNear(item,placement,type){setMenu(null);if(draft&&!await save())return;const prefix=type==='group'?'## ':type==='text'?'> ':'';setDraft({domain:item.domain,type,status:'open',title:'',content:'',parentId:item.parentId||'',position:item.position??0,insert:{targetId:item.id,placement}});setText(prefix);setHint(null);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(prefix.length,prefix.length);});}
  async function updateStatus(item,status=item.status==='done'?'open':'done'){
    if(busy&&!saving.current)return;
    if(draft){const saved=await save();if(!saved)return;if(saved.id===item.id)item=saved;}
    setBusy(true);setError('');
    try{replaceItem(await api('/api/entries/'+item.id,'PUT',{...item,status}));feedback(item.id);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function configureGroup(item,patch){
    if(busy)return;
    if(draft&&!await save())return;
    setBusy(true);setError('');
    try{replaceItem(await api('/api/entries/'+item.id,'PUT',{...item,...patch}));}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function deleteItem(item){
    if(busy)return;
    if(confirmDelete!==item.id){setConfirmDelete(item.id);return;}
    setConfirmDelete('');
    if(draft?.id===item.id)close();else if(draft&&!await save())return;
    setBusy(true);setError('');
    try{
      const next=await api('/api/entries/'+item.id,'DELETE');
      const node=[...board.current?.querySelectorAll('[data-entry-id]')||[]].find(node=>node.dataset.entryId===item.id);
      if(node&&!prefersReducedMotion())await node.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(8px)'}],{duration:140,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});
      applyItems(next);
    }catch(e){setError(e.message);}finally{setBusy(false);}
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
    try{applyItems(await api('/api/entries/move','POST',spec));feedback(spec.id);}catch(e){setError(e.message);}finally{setBusy(false);}
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
        const groupBlock=node?.closest('.group-block');
        if(!row&&groupBlock){const groupRow=groupBlock.querySelector('[data-entry-id]');if(groupRow)next={id:item.id,targetId:groupRow.dataset.entryId,domain,placement:'inside'};}
        if(row){
          const box=row.getBoundingClientRect(),portion=(event.clientY-box.top)/box.height;
          const target=itemsRef.current.find(entry=>entry.id===row.dataset.entryId);
          if(target&&target.id!==item.id){
            const indent=Number(row.dataset.depth||0)*22;
            const placement=portion>.25&&portion<.75&&event.clientX>box.left+indent+55?'inside':portion<.5?'before':'after';
            next={id:item.id,targetId:target.id,domain,placement};
          }
        }else if(!next)next={id:item.id,domain,placement:'end'};
      }
      currentDrop.current=next;setDrop(next);
      if(column){const scroller=column.querySelector('.column-scroll'),box=scroller?.getBoundingClientRect();if(box){if(event.clientY<box.top+45)scroller.scrollBy(0,-12);if(event.clientY>box.bottom-45)scroller.scrollBy(0,12);}}
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
          onPaste={event=>{const file=Array.from(event.clipboardData.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,draft.domain);return;}const result=pasteLink(text,event.target.selectionStart,event.target.selectionEnd,event.clipboardData.getData('text/plain'));if(result){event.preventDefault();setText(result.text);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(result.caret,result.caret);});}}}
          onKeyDown={event=>{
            if(event.nativeEvent.isComposing||event.keyCode===229)return;
            if((event.metaKey||event.ctrlKey)&&['b','i','='].includes(event.key.toLowerCase())){event.preventDefault();const marker=event.key.toLowerCase()==='b'?'**':event.key.toLowerCase()==='i'?'*':'==';const start=event.target.selectionStart,end=event.target.selectionEnd;setText(text.slice(0,start)+marker+text.slice(start,end)+marker+text.slice(end));requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+marker.length,end+marker.length);});return;}
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
    const editing=draft?.id===item.id,done=item.status==='done',removed=item.status==='removed',group=item.type==='group',divider=item.type==='divider';
    const descendants=new Set([item.id]);let changed=true;while(changed){changed=false;for(const child of items){if(descendants.has(child.parentId)&&!descendants.has(child.id)){descendants.add(child.id);changed=true;}}}
    const tasks=items.filter(entry=>entry.id!==item.id&&descendants.has(entry.id)&&entry.type==='todo'&&entry.status!=='removed');
    const target=drop?.targetId===item.id?drop.placement:'';
    const overdue=item.type==='todo'&&item.dueDate&&item.dueDate<new Date().toLocaleDateString('en-CA')&&!done&&!removed;
    const statusDate=(removed?item.removedAt:done?item.completedAt:null);
    const statusCaption=statusDate?new Date(statusDate).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})+(removed?'取消':'完成'):'';
    const timeTitle=[['createdAt','创建'],['updatedAt','更新'],['completedAt','完成'],['removedAt','移除']].filter(([key])=>item[key]).map(([key,name])=>name+'：'+new Date(item[key]).toLocaleString('zh-CN',{hour12:false})).join('\n');
    return <div key={item.id} className={'entry '+(done?'is-done ':'')+(removed?'is-removed ':'')+(group?'is-group ':'')+(divider?'is-divider ':'')+(item.url?'has-link ':'')+(dragging===item.id?'drag-source ':'')+(target?'drop-'+target:'')} data-entry-id={item.id} data-depth={depth} style={{'--depth':depth}} onContextMenu={event=>{if(event.target.closest('textarea'))return;event.preventDefault();setMenu({x:event.clientX,y:event.clientY,item});}}>
      <button className="drag-handle" title="拖动排序；放在文字中间成为子条目" aria-label={'拖动 '+titleOf(item)} onPointerDown={event=>beginDrag(event,item)}><DotsSixVertical size={14}/></button>
      {editing?editor():<div className="entry-read">
        {group?<button className={'group-toggle '+(item.collapsed?'collapsed':'')} aria-label={item.collapsed?'展开分组':'收起分组'} aria-expanded={!item.collapsed} onClick={()=>configureGroup(item,{collapsed:!item.collapsed})}><CaretDown size={15}/></button>:divider?<span className="kind-mark">—</span>:item.type==='todo'?<button className={'checkbox '+(done?'checked':'')} aria-label={done?'重新打开任务':'完成任务'} onClick={()=>updateStatus(item)} disabled={busy}>{done&&<Check size={11} weight="bold"/>}{removed&&<span>−</span>}</button>:<span className="kind-mark">{item.type==='text'?<TextT size={15}/>:item.type==='link'?<LinkSimple size={15}/>:item.type==='bullet'?<span>•</span>:<ImageSquare size={15}/>}</span>}
        <div className={'entry-body '+(item.url?'linked-body':'')} title={timeTitle} role="button" tabIndex={0} onClick={event=>{if(event.target.closest('a'))return;if(item.url)window.open(item.url,'_blank','noopener,noreferrer');else open(item);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(item.url)window.open(item.url,'_blank','noopener,noreferrer');else open(item);}}} aria-label={item.url?'打开 '+titleOf(item):'编辑 '+titleOf(item)}>
          <span className="entry-title">{divider?<span className="md-rule"/>:inline(titleOf(item))}</span>
          {item.content&&item.title&&<span className="entry-note">{item.content.split('\n').map((line,index)=><span className="note-line" key={index}>{inline(line)}</span>)}</span>}
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
          </span>
          {statusCaption&&<span className="status-caption">{statusCaption}</span>}
        </div>
        {group&&<div className="group-controls"><button className="signature" title="选择分组图标和底色" onClick={()=>setPicker(picker===item.id?'':item.id)}>{item.signature||'◦'}</button><span className="group-count" title="已完成 / 总任务数（不含取消）">{tasks.filter(task=>task.status==='done').length}/{tasks.length}</span><button title="在分组内写一条" aria-label="在分组内新增条目" onClick={()=>open(null,item.domain,item.id)}><Plus size={14}/></button>
          {picker===item.id&&<div className="group-picker"><div>{['◦','📌','📝','🚀','💡','🌿','🏠','💼'].map(signature=><button key={signature} aria-label={'图标 '+signature} onClick={()=>{configureGroup(item,{signature});setPicker('');}}>{signature}</button>)}</div><div>{['sage','sand','blue','rose','none'].map(tone=><button className={'tone-swatch tone-'+tone} key={tone} aria-label={'底色 '+tone} onClick={()=>{configureGroup(item,{tone});setPicker('');}}/>)}</div></div>}
        </div>}
        <div className="row-actions">
          <button title={removed?'恢复条目':'取消条目'} aria-label={removed?'恢复条目':'取消条目'} disabled={busy} onClick={()=>updateStatus(item,removed?'open':'removed')}>{removed?<ArrowCounterClockwise size={14}/>:<X size={14}/>}</button>
          <button className={confirmDelete===item.id?'confirm-delete':''} title={confirmDelete===item.id?'再次点击确认删除':'永久删除'} aria-label={confirmDelete===item.id?'确认删除条目':'永久删除条目'} disabled={busy} onClick={()=>deleteItem(item)}>{confirmDelete===item.id?'确认删除':<Trash size={14}/>}</button>
        </div>
      </div>}
    </div>;
  }
  function renderTree(domain){
    const rows=treeRows(items,domain);
    function renderBranch(parentId='',level=0){return rows.filter(({item})=>(item.parentId||'')===parentId||!parentId&&item.parentId&&!items.some(entry=>entry.id===item.parentId&&entry.domain===domain)).map(({item})=>{
      const children=renderBranch(item.id,item.type==='group'?0:level+1);
      const insertion=draft&&!draft.id&&draft.insert?.targetId===item.id?editor():null;
      if(item.type==='group')return <React.Fragment key={item.id}>{draft?.insert?.placement==='before'&&insertion}<div className={'group-block tone-'+(['sage','sand','blue','rose','none'].includes(item.tone)?item.tone:'sage')} style={{marginLeft:level?18:0}}>{row(item,0)}{!item.collapsed&&<div className="group-children">{children}{draft&&!draft.id&&!draft.insert&&draft.parentId===item.id&&editor()}</div>}</div>{draft?.insert?.placement==='after'&&insertion}</React.Fragment>;
      return <React.Fragment key={item.id}>{draft?.insert?.placement==='before'&&insertion}{row(item,level)}{children}{draft&&!draft.id&&!draft.insert&&draft.parentId===item.id&&editor()}{draft?.insert?.placement==='after'&&insertion}</React.Fragment>;
    });}
    return renderBranch();
  }
  if(authenticated===null||loading)return <div className="auth-screen"><div className="auth-brand"><img className="auth-cat" src="/rafa-cat.png" alt=""/><div className="auth-mark">Rafa<span>todo</span><i/></div></div><span className="auth-loading">正在打开…</span></div>;
  if(!authenticated)return <div className="auth-screen"><form className="auth-form" onSubmit={login}><div className="auth-brand"><img className="auth-cat" src="/rafa-cat.png" alt=""/><div className="auth-mark">Rafa<span>todo</span><i/></div></div><div className="auth-input"><input id="password" type="password" autoFocus autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} aria-label="密码" placeholder="••••••" onKeyDown={event=>{if(event.key==='Enter')login(event);}}/></div>{error&&<p className="auth-error">{error}</p>}</form></div>;
  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="RafaTodo 首页"><img className="brand-cat" src="/rafa-cat.png" alt=""/>Rafa<span>todo</span><i/></a><button className={'heatmap-trigger '+(heatmapOpen?'active':'')} onClick={()=>setHeatmapOpen(value=>!value)} aria-label="打开活动热力图" title="活动热力图"><ChartBar size={18}/></button><Heatmap items={items} open={heatmapOpen} onClose={()=>setHeatmapOpen(false)}/></header>
    {error&&<div className="global-error" role="alert">{error}</div>}
    <main ref={board} className="board" style={{'--work':layout.work+'%','--life':layout.life+'%'}}>{domains.map(domain=><section className={'column '+(drop?.domain===domain&&drop.placement==='end'?'drop-column':'')} key={domain} data-domain={domain} aria-label={domain}
      onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}}
      onDrop={event=>{const file=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,domain);}}}>
      <div className="column-watermark" aria-hidden="true">{domain==='Glean & Idea'?<>GLEAN<span>& IDEA</span></>:domain.toUpperCase()}</div>
      <div className="column-head"><h1>{domain.toUpperCase()}</h1><span>{items.filter(item=>item.domain===domain&&item.type==='todo'&&!['done','removed'].includes(item.status)).length}</span></div>
      <div className="column-scroll">
      <div className="column-content">{loading?<div className="loading">加载中…</div>:renderTree(domain)}</div>
      <div className="add-row">{draft&&!draft.id&&!draft.insert&&!draft.parentId&&draft.domain===domain?editor():<button onClick={()=>open(null,domain)} aria-label={'在 '+domain+' 新增条目'}><Plus size={14}/><span>写一条…</span></button>}</div>
      </div>
    </section>)}{divider('work')}{divider('life')}</main>
    {dragging&&<div className="drag-caption">{drop?.placement==='inside'?'成为子条目':drop?.placement==='end'?'移到 '+drop.domain+' 末尾':drop?'移动到这里':'拖到目标位置'}</div>}
    {menu&&<div className="context-menu" style={{left:Math.min(menu.x,window.innerWidth-190),top:Math.min(menu.y,window.innerHeight-180)}} onPointerDown={event=>event.stopPropagation()}>
      <button onClick={()=>insertNear(menu.item,'before','group')}>在上方插入标题</button><button onClick={()=>insertNear(menu.item,'after','group')}>在下方插入标题</button>
      <button onClick={()=>insertNear(menu.item,'after','todo')}>插入任务</button><button onClick={()=>{setMenu(null);open(null,menu.item.domain,menu.item.id);}}>插入子任务</button>
    </div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
