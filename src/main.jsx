import React,{useState,useEffect,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus,ArrowUpRight,Check,TextT,LinkSimple,ImageSquare,DotsSixVertical,DotsThree,X,Trash,ArrowCounterClockwise,CaretDown,CaretRight,ChartBar,Archive,PushPin,MagicWand} from '@phosphor-icons/react';
import {domains,parseLine,toLine,treeRows,workPaneMap,pasteLink} from './lib/entries.js';
import './style.css';

function newId(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}

async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'请求失败');
  return data;
}
const titleOf=item=>item.title||item.content||item.url||'图片';
function inline(value,enableLinks=true){return String(value).split(/(`[^`]+`|!?\[[^\]]+\]\(https?:\/\/[^\s)]+\)|==[^=]+==|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|@[\p{L}\p{N}_·.-]+)/gu).map((part,index)=>{const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(link&&!enableLinks)return <span key={index} className="markdown-link">{link[1]}</span>;if(link)return <a key={index} className="markdown-link" href={link[2]} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>{link[1]}<ArrowUpRight size={11}/></a>;if(part.startsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;if(part.startsWith('@'))return <span key={index} className="person-inline">{part}</span>;if(part.startsWith('=='))return <mark key={index}>{part.slice(2,-2)}</mark>;if(part.startsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;if(part.startsWith('~~'))return <del key={index}>{part.slice(2,-2)}</del>;if(part.startsWith('*'))return <em key={index}>{part.slice(1,-1)}</em>;return part;});}
const editLine=(item,entries)=>toLine(item,entries,{hideTaskPrefix:true});
function previewType(value){
  const text=value.trim();
  if(/^---+$/.test(text))return 'divider';
  if(/^##\s+/.test(text))return 'group';
  if(/^-\s+/.test(text)&&!/^-\s+\[[ xX-]\]/.test(text))return 'bullet';
  if(/^>\s?/.test(text))return 'text';
  if(/!\[[^\]]*\]\([^\s)]+\)/.test(text))return 'image';
  if(/^\[[^\]]+\]\(https?:\/\/[^\s)]+\)$/.test(text)||/^https?:\/\/[^\s]+$/i.test(text))return 'link';
  return 'todo';
}
const prefersReducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=value=>Math.min(75,Math.max(25,value));
const sideLayout=width=>width>=900?'three':width>=660?'two':'stacked';
const sideHeight=(value,fallback)=>Math.min(70,Math.max(10,Number(value)||fallback));
function layoutFromSide(daily,life){
  const d=sideHeight(daily,22),total=Math.min(90,d+sideHeight(life,38));
  return {daily:d,life:total-d,total};
}
function readLayout(){try{const value=JSON.parse(localStorage.getItem('rafa-layout'));const sides=layoutFromSide(value?.daily,value?.life);return {work:clamp(Number(value?.work)||50),...sides,workSplit:Math.min(80,Math.max(20,Number(value?.workSplit)||50))};}catch{return {work:50,...layoutFromSide(22,38),workSplit:50};}}
const dayKey=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-CA');};
function readStored(key,fallback){try{const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}}
function buildIndexes(items){
  const byId=new Map(items.map(item=>[item.id,item])),childrenByParent=new Map();
  for(const item of items){const key=item.parentId||'';if(!childrenByParent.has(key))childrenByParent.set(key,[]);childrenByParent.get(key).push(item);}
  const descendants=id=>{const result=new Set(),queue=[id];while(queue.length){for(const child of childrenByParent.get(queue.pop())||[])if(!result.has(child.id)){result.add(child.id);queue.push(child.id);}}return result;};
  const workRows=treeRows(items,'Work'),workPanes=workPaneMap(items,workRows);
  return {byId,childrenByParent,descendants,workRows,workPanes};
}
function localEndPosition(entries,item){
  const panes=item.domain==='Work'?workPaneMap(entries):null,pane=item.workPane==='right'?'right':'left';
  const siblings=entries.filter(entry=>entry.domain===item.domain&&(entry.parentId||'')===(item.parentId||'')&&(item.domain!=='Work'||(panes.get(entry.id)||'left')===pane));
  return Math.max(-1,...siblings.map(entry=>Number.isFinite(entry.position)?entry.position:-1))+1;
}
function placeOptimisticEntry(entries,item,insert){
  let next=[...entries,item];
  if(!insert?.targetId)return next;
  const target=next.find(entry=>entry.id===insert.targetId);
  if(!target)return next;
  const panes=item.domain==='Work'?workPaneMap(next):null;
  const workPane=item.domain==='Work'?(insert.placement==='end'?item.workPane:panes.get(target.id)||item.workPane||'left'):'';
  const parentId=insert.placement==='inside'?target.id:insert.placement==='end'?'':target.parentId||'';
  const moved={...item,parentId,...(item.domain==='Work'?{workPane}:{})};
  next=next.map(entry=>entry.id===moved.id?moved:entry);
  const samePane=entry=>item.domain!=='Work'||(panes.get(entry.id)||'left')===workPane;
  const siblings=treeRows(next,item.domain).map(row=>row.item).filter(entry=>entry.id!==moved.id&&(entry.parentId||'')===parentId&&samePane(entry));
  let index=insert.placement==='before'?siblings.findIndex(entry=>entry.id===target.id):insert.placement==='after'?siblings.findIndex(entry=>entry.id===target.id)+1:siblings.length;
  if(index<0)index=siblings.length;
  siblings.splice(index,0,moved);
  const positions=new Map(siblings.map((entry,position)=>[entry.id,position]));
  return next.map(entry=>positions.has(entry.id)?{...entry,position:positions.get(entry.id)}:entry);
}
function Toast({message,onClose}){useEffect(()=>{if(!message)return;const timer=setTimeout(onClose,3600);return()=>clearTimeout(timer);},[message,onClose]);if(!message)return null;return <div className="toast" role="alert" onClick={onClose}>{message}</div>}
function ErrorNotice({message,retry,onClose}){
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>closeRef.current?.(),retry?12000:3600);return()=>clearTimeout(timer);},[message,Boolean(retry)]);
  if(!message)return null;
  return <div className={'toast error-toast '+(retry?'has-retry':'')} role="alert">
    <span className="toast-message">{message}</span>
    {retry&&<button className="toast-retry" onClick={()=>{onClose?.();retry.run();}}>重试</button>}
    <button className="toast-close" aria-label="关闭提示" title="关闭" onClick={onClose}>×</button>
  </div>;
}
function LoopLabel({item}){
  if(item.type!=='todo'||!['day','week'].includes(item.loop))return null;
  return <span className={'loop-label loop-'+item.loop}>{item.loop==='day'?'每日':'每周'} | {item.loopCompletedCount||0}次</span>;
}
function ArchiveModal({open,items,onClose}){
  if(!open)return null;
  const byId=new Map(items.map(item=>[item.id,item]));
  const archiveTime=item=>item.archivedAt||item.completedAt||item.removedAt||'';
  const sortByTime=(a,b)=>archiveTime(b).localeCompare(archiveTime(a));
  function rowsFor(domain){
    const entries=items.filter(item=>item.domain===domain),seen=new Set(),rows=[];
    function append(item,depth){if(seen.has(item.id))return;seen.add(item.id);rows.push({item,depth});entries.filter(child=>child.parentId===item.id).sort(sortByTime).forEach(child=>append(child,depth+1));}
    entries.filter(item=>!byId.has(item.parentId)||byId.get(item.parentId)?.domain!==domain).sort(sortByTime).forEach(item=>append(item,0));
    entries.filter(item=>!seen.has(item.id)).sort(sortByTime).forEach(item=>append(item,0));
    return rows;
  }
  const typeName=item=>item.type==='group'?'分组':item.type==='todo'?'任务':item.type==='link'?'链接':item.type==='image'?'图片':item.type==='bullet'?'列表':item.type==='text'?'文本':'分隔';
  const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const metadata=item=>[
    item.priority==='urgent'?'!! 紧急':item.priority==='high'?'! 重要':'',
    item.owner?'@'+item.owner:'',...(item.people||'').split(/[,，]\s*/).filter(Boolean).map(name=>'@'+name),
    ...(item.tags||'').split(/[,，]\s*/).filter(Boolean).map(tag=>'#'+tag),
    item.dueDate?'截止 '+item.dueDate:'',item.planDate?'计划 '+item.planDate:'',item.followupDate?'跟进 '+item.followupDate:'',item.stage?'阶段 '+item.stage:'',
    ...Object.entries(item.custom||{}).filter(([,value])=>value).map(([key,value])=>key+' · '+value),
    ...(item.dependencies||[]).map(id=>'前置 '+(byId.get(id)?.title||id)),...(item.related||[]).map(id=>'关联 '+(byId.get(id)?.title||id))
  ].filter(Boolean);
  return <div className="archive-backdrop" onPointerDown={onClose}><div className="archive-modal" role="dialog" aria-label="归档内容" onPointerDown={event=>event.stopPropagation()}>
    <div className="archive-head"><div><strong>归档</strong><span className="archive-total">{items.length} 条</span></div><button onClick={onClose} aria-label="关闭归档">×</button></div>
    {domains.map(domain=>{const rows=rowsFor(domain);return <section className="archive-section" key={domain}><h2><span className={'archive-domain-dot archive-domain-'+domain.replace(/\W/g,'').toLowerCase()}/>{domain==='Glean & Idea'?'GLEAN & IDEA':domain.toUpperCase()} <span>{rows.length}</span></h2>{rows.length?<div className="archive-list">{rows.map(({item,depth})=><article className="archive-item" key={item.id} style={{'--archive-depth':depth}}>
      <div className="archive-item-head"><span className={'archive-status archive-status-'+item.status}><i/>{item.status==='done'?'已完成':item.status==='removed'?'已取消':'已归档'}</span><span className="archive-type">{typeName(item)}</span><time title={'归档时间 '+stamp(item.archivedAt)}>{stamp(archiveTime(item))}</time></div>
      <div className="archive-title"><LoopLabel item={item}/>{item.prefixLabel&&<span className="prefix-label">{item.prefixLabel}</span>}{inline(titleOf(item))}</div>
      {item.content&&<p className="archive-note">{inline(item.content)}</p>}
      {item.image&&<img className="archive-image" src={item.image} alt={item.title||'归档图片'}/>}
      {item.url&&<a className="archive-link" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}
      {metadata(item).length>0&&<div className="archive-tags">{metadata(item).map((value,index)=><span key={index}>{value}</span>)}</div>}
      <div className="archive-dates"><span>创建 {stamp(item.createdAt)||'—'}</span>{item.updatedAt&&<span>更新 {stamp(item.updatedAt)}</span>}{item.completedAt&&<span>完成 {stamp(item.completedAt)}</span>}{item.removedAt&&<span>取消 {stamp(item.removedAt)}</span>}</div>
    </article>)}</div>:<p className="archive-empty">暂无归档</p>}</section>})}
  </div></div>;
}
const HEATMAP_DOMAINS=[['Work','WORK'],['Daily','DAILY'],['Life','LIFE'],['Glean & Idea','GLEAN']];
const heatLevel=count=>count<=0?0:count===1?1:count<=3?2:count<=6?3:4;
function Heatmap({items,open,onClose}){
  const [activeDomains,setActiveDomains]=useState(()=>new Set(HEATMAP_DOMAINS.map(([value])=>value))),[activity,setActivity]=useState([]),[selected,setSelected]=useState(()=>dayKey(new Date())),[hovered,setHovered]=useState(null);
  useEffect(()=>{if(!open)return;setSelected(dayKey(new Date()));const end=new Date(),start=new Date(end);start.setDate(end.getDate()-364);api('/api/activity?from='+dayKey(start)+'&to='+dayKey(end)).then(setActivity).catch(()=>setActivity([]));},[open]);
  if(!open)return null;
  const end=new Date(),start=new Date(end);start.setDate(end.getDate()-364);start.setDate(start.getDate()-start.getDay());
  const cells=Array.from({length:53*7},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return dayKey(date);});
  const weeks=Array.from({length:53},(_,week)=>Array.from({length:7},(_,day)=>{const date=new Date(start);date.setDate(start.getDate()+week*7+day);return date;}));
  const monthMarks=[];
  weeks.forEach((week,index)=>{const date=week[3],year=date.getFullYear(),month=date.getMonth()+1,key=year+'-'+month,previous=monthMarks[monthMarks.length-1];if(previous?.key===key)return;monthMarks.push({key,start:index,year,month,showYear:Boolean(previous)&&month===1});});
  monthMarks.forEach((mark,index)=>{mark.end=index+1<monthMarks.length?monthMarks[index+1].start:53;});
  const byDate=new Map();for(const row of activity){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
  const visibleRows=date=>(byDate.get(date)||[]).filter(row=>activeDomains.has(row.domain));
  const detail=date=>visibleRows(date).flatMap(row=>{const counts=[['创建',row.created],['完成',row.completed],['更新',row.updated],['取消',row.removed]].filter(([,count])=>count);return counts.length?[row.domain.toUpperCase()+' '+counts.map(([name,count])=>name+count).join(' ')]:[];});
  const selectedItems=selected?items.filter(item=>item.domain&&activeDomains.has(item.domain)&&[item.createdAt,item.updatedAt,item.completedAt,item.removedAt].some(value=>dayKey(value)===selected)):[];
  return <div className="heatmap-overlay" role="presentation">
    <div className="heatmap-popover" role="dialog" aria-modal="true" aria-label="活动热力图">
    <div className="heatmap-head"><strong>活动热力图</strong><button onClick={onClose} aria-label="关闭热力图" title="关闭热力图"><X size={18}/></button></div>
    <div className="heatmap-filters"><button className={activeDomains.size===HEATMAP_DOMAINS.length?'active':''} onClick={()=>{setActiveDomains(new Set(HEATMAP_DOMAINS.map(([value])=>value)));setSelected('');}}>全部</button>{HEATMAP_DOMAINS.map(([value,label])=><button key={value} className={'heat-domain-'+value.replace(/\W/g,'').toLowerCase()+(activeDomains.has(value)?' active':'')} aria-pressed={activeDomains.has(value)} onClick={()=>{setActiveDomains(previous=>{const next=new Set(previous);if(next.has(value))next.delete(value);else next.add(value);return next;});setSelected('');}}><i/>{label}</button>)}</div>
    <div className="heatmap-months" aria-hidden="true"><span className="heatmap-month-spacer"/><div className="heatmap-month-cells">{monthMarks.map((mark,index)=><span key={mark.key} className={'heatmap-month-mark'+(index===0?' first':'')+(mark.showYear?' show-year':'')+((index===monthMarks.length-1&&53-mark.start<5)?' end':'')} style={{gridColumn:(mark.start+1)+' / span '+Math.max(1,mark.end-mark.start)}} title={mark.year+'年'+mark.month+'月'}>{mark.showYear&&<small>{mark.year}</small>}{mark.month}月</span>)}</div></div>
    <div className="heatmap-grid" aria-label="最近一年活动"><div className="heatmap-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div className="heatmap-cells">{cells.map((date,index)=>{const rows=byDate.get(date)||[],byDomain=new Map(rows.map(row=>[row.domain,row])),present=HEATMAP_DOMAINS.map(([value,label])=>{const row=byDomain.get(value),count=row?Number(row.created||0)+Number(row.completed||0)+Number(row.updated||0)+Number(row.removed||0):0;return {value,label,count};}).filter(entry=>entry.count>0),active=present.filter(entry=>activeDomains.has(entry.value)),description=[date,...detail(date)].join('\n');return <button key={date+'-'+index} className={'heat-cell count-'+active.length+(selected===date?' selected':'')} aria-label={description} onMouseEnter={event=>{const rect=event.currentTarget.getBoundingClientRect();setHovered({date,x:Math.min(rect.left,window.innerWidth-240),y:rect.bottom+8});}} onMouseLeave={()=>setHovered(null)} onFocus={event=>{const rect=event.currentTarget.getBoundingClientRect();setHovered({date,x:Math.min(rect.left,window.innerWidth-240),y:rect.bottom+8});}} onBlur={()=>setHovered(null)} onClick={()=>setSelected(date)}>{active.map(({value,label,count})=><i key={value} className={'heat-domain-'+value.replace(/\W/g,'').toLowerCase()+' level-'+heatLevel(count)} title={label+' '+count}/>)}</button>})}</div></div>
    {hovered&&<div className="heatmap-tooltip" style={{left:Math.max(8,hovered.x),top:Math.min(hovered.y,window.innerHeight-120)}} role="tooltip"><strong>{hovered.date}</strong>{detail(hovered.date).map((line,index)=><span key={index}>{line}</span>)}</div>}
    <div className={'heatmap-detail'+(selected?' has-selection':'')}>{selected?<><div className="heatmap-detail-head"><strong>{selected}</strong><span>{detail(selected).join(' · ')||'无活动'}</span></div>{selectedItems.length?<div className="heatmap-items">{selectedItems.map(item=><div className="heatmap-task" key={item.id} role="button" tabIndex={0} onClick={()=>{onClose();document.querySelector(`[data-entry-id="${item.id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onClose();document.querySelector(`[data-entry-id="${item.id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});}}} aria-label={'定位 '+titleOf(item)}><div className="entry-read"><div className="entry-body"><EntryContent item={item} items={items}/></div></div></div>)}</div>:<span className="heatmap-empty">当天没有可回顾的条目</span>}</>:<p className="heatmap-detail-placeholder">点击日期查看当天回顾</p>}</div>
    </div>
  </div>;
}
function EntryContent({item,items=[]}) {
  const divider=item.type==='divider',done=item.status==='done',removed=item.status==='removed';
  const overdue=item.type==='todo'&&item.dueDate&&item.dueDate<new Date().toLocaleDateString('en-CA')&&!done&&!removed;
  const statusDate=removed?item.removedAt:done?item.completedAt:null;
  const statusCaption=statusDate?new Date(statusDate).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})+(removed?'取消':'完成'):'';
  return <>
          <span className="entry-title">{divider?<span className="md-rule"/>:<><LoopLabel item={item}/>{item.prefixLabel&&<span className="prefix-label">{item.prefixLabel}</span>}{inline(titleOf(item))}</>}</span>
          {item.content&&item.title&&<span className="entry-note">{item.content.split('\n').map((line,index)=><span className="note-line" key={index}>{inline(line)}</span>)}</span>}
          {item.image&&<img className="thumb" src={item.image} alt={item.title||'条目图片'}/>}
          <span className="entry-meta">
            {item.priority==='urgent'&&<span className="urgent">!! 紧急</span>}{item.priority==='high'&&<span className="high">! 重要</span>}
            {item.owner&&!item.title.includes('@'+item.owner)&&<span className="person">@{item.owner}</span>}
            {item.people&&item.people.split(/[,，]\s*/).filter(name=>name&&!item.title.includes('@'+name)).map(name=><span key={name} className="person related-person">@{name}</span>)}
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
  </>;
}
function inboxEntry(draft) {
  const value={...draft,type:'todo',status:'open',parentId:''};
  delete value.id;delete value.decision;delete value.entryId;
  return value;
}
function InboxDialog({onClose,children}) {
  const dialog=useRef(null);
  useEffect(()=>{dialog.current.showModal();},[]);
  return <dialog ref={dialog} className="inbox-drafts" aria-label="AI 草稿预览" onCancel={onClose} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}}>{children}</dialog>;
}

const Editor=React.memo(function EntryEditor({draft,items,initialText,onSave,onClose,onUpload,onIndent,onNext,onTextChange}){
  const [text,setTextState]=useState(initialText),textarea=useRef(null);
  const [hint,setHint]=useState(null),[choice,setChoice]=useState(0);
  const presets=React.useMemo(()=>{
    const people=[],tags=[],prefixes=[];
    for(const item of items){
      if(item.owner)people.push(item.owner);
      if(item.people)people.push(...item.people.split(/[,，]\s*/));
      if(item.tags)tags.push(...item.tags.split(/[,，]\s*/));
      if(item.prefixLabel)prefixes.push(item.prefixLabel);
    }
    return {'@':[...new Set(people.filter(Boolean))],'#':[...new Set(tags.filter(Boolean))],'%':[...new Set(prefixes.filter(Boolean))]};
  },[items]);
  const setText=value=>{setTextState(value);onTextChange?.(value);};
  useEffect(()=>{setTextState(initialText);onTextChange?.(initialText);setHint(null);},[initialText,draft?.editorKey,draft?.id]);
  useEffect(()=>{
    let frame=0;
    const measure=()=>{frame=0;if(!textarea.current)return;textarea.current.style.height='0px';textarea.current.style.height=Math.max(25,textarea.current.scrollHeight)+'px';};
    frame=requestAnimationFrame(measure);
    return()=>cancelAnimationFrame(frame);
  },[text]);
  function suggest(value,caret){
    const match=value.slice(0,caret).match(/(?:^|\s)([@#%])([^\s@#%]*)$/);
    if(!match){setHint(null);return;}
    const symbol=match[1],query=match[2];
    const pool=presets[symbol]||[],options=pool.filter(item=>item.toLowerCase().startsWith(query.toLowerCase())&&item!==query).slice(0,5);
    setChoice(0);setHint(options.length?{symbol,start:caret-query.length-1,end:caret,options}:null);
  }
  function complete(value){
    if(!hint)return;
    const next=text.slice(0,hint.start)+hint.symbol+value+' '+text.slice(hint.end),caret=hint.start+value.length+2;
    setText(next);setHint(null);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(caret,caret);});
  }
  const preview={type:previewType(text)};
  return <div className="write-row">
    <span className={'write-mark '+(preview.type==='todo'?'task-mark':'')}>{preview.type==='text'?<TextT size={15}/>:preview.type==='link'?<LinkSimple size={15}/>:preview.type==='image'?<ImageSquare size={15}/>:null}</span>
    <div className="write-input">
        <textarea ref={textarea} autoFocus rows="1" aria-label="直接编辑条目" placeholder="写一条…" value={text} onChange={event=>{setText(event.target.value);suggest(event.target.value,event.target.selectionStart);}} onClick={event=>suggest(text,event.target.selectionStart)}
        onPaste={event=>{const file=Array.from(event.clipboardData.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();onUpload(file);return;}const value=event.clipboardData.getData('text/plain').trim(),start=event.target.selectionStart,end=event.target.selectionEnd;const result=pasteLink(text,start,end,value);if(result){event.preventDefault();setText(result.text);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(result.caret,result.caret);});return;}if(start===end&&/^https?:\/\/[^\s<>]+$/i.test(value)){event.preventDefault();const inserted=text.slice(0,start)+value+text.slice(end);setText(inserted);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+value.length,start+value.length);});(async()=>{try{const preview=await api('/api/link-preview','POST',{url:value});const title=String(preview.title||'').trim();if(!title||textarea.current?.value!==inserted)return;const safeTitle=title.replace(/[\[\]\n]/g,' ').trim();const next=text.slice(0,start)+'['+safeTitle+']('+value+')'+text.slice(end);setText(next);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+('['+safeTitle+']('+value+')').length,start+('['+safeTitle+']('+value+')').length);});}catch{}})();}}}
        onKeyDown={event=>{
          if(event.nativeEvent.isComposing||event.keyCode===229)return;
          if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key==='Enter'){event.preventDefault();onNext(text);return;}
          if((event.metaKey||event.ctrlKey)&&['b','i','='].includes(event.key.toLowerCase())){event.preventDefault();const marker=event.key.toLowerCase()==='b'?'**':event.key.toLowerCase()==='i'?'*':'==';const start=event.target.selectionStart,end=event.target.selectionEnd;setText(text.slice(0,start)+marker+text.slice(start,end)+marker+text.slice(end));requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+marker.length,end+marker.length);});return;}
          if(event.key==='Escape'){event.preventDefault();if(hint)setHint(null);else onClose();return;}
          if(hint&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setChoice(previous=>(previous+(event.key==='ArrowDown'?1:-1)+hint.options.length)%hint.options.length);return;}
          if(hint&&(event.key==='Tab'||event.key==='Enter')){event.preventDefault();complete(hint.options[choice]);return;}
          if(event.key==='Tab'){event.preventDefault();onIndent(event.shiftKey,text);return;}
          if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onSave(text);}
        }}/>
      {hint&&<div className="suggestions" role="listbox" aria-label={hint.symbol==='@'?'人员建议':hint.symbol==='%'?'前缀建议':'标签建议'}>{hint.options.map((value,index)=><button key={value} className={choice===index?'selected':''} onMouseDown={event=>event.preventDefault()} onClick={()=>complete(value)} role="option" aria-selected={choice===index}>{hint.symbol}{value}</button>)}</div>}
    </div>
  </div>;
});
const EntryEditor=Editor;

function App(){
  const [items,setItems]=useState([]),[draft,setDraft]=useState(null);
  const indexes=React.useMemo(()=>buildIndexes(items),[items]);
  const [pending,setPending]=useState(()=>new Set()),[loading,setLoading]=useState(true),[entriesLoaded,setEntriesLoaded]=useState(false),[error,setErrorState]=useState(''),[retryAction,setRetryAction]=useState(null);
  const markPending=(key,value)=>setPending(previous=>{const next=new Set(previous);if(value)next.add(key);else next.delete(key);return next;});
  function setError(message,retry=null){setErrorState(message);setRetryAction(retry?{run:retry}:null);}
  const [authenticated,setAuthenticated]=useState(null),[password,setPassword]=useState(''),[loggingIn,setLoggingIn]=useState(false);
  const [drop,setDrop]=useState(null),[dragging,setDragging]=useState(''),[menu,setMenu]=useState(null),[confirmDelete,setConfirmDelete]=useState(''),[confirmArchive,setConfirmArchive]=useState('');
  const drag=useRef(null),currentDrop=useRef(null),suppressClick=useRef(false);
  const saving=useRef(new Map()),editorTextRef=useRef(''),draftRef=useRef(null);draftRef.current=draft;
  const [picker,setPicker]=useState('');
  const [heatmapOpen,setHeatmapOpen]=useState(false);
  const [archiveOpen,setArchiveOpen]=useState(false),[archived,setArchived]=useState([]),[archiveBusy,setArchiveBusy]=useState(false);
  const [zen,setZen]=useState(null),[zenNow,setZenNow]=useState(Date.now()),[zenConfirm,setZenConfirm]=useState('');
  const [inboxText,setInboxText]=useState(()=>readStored('rafa-inbox-text','')),[inboxBatches,setInboxBatches]=useState(()=>readStored('rafa-inbox-batches',[])),[inboxBusy,setInboxBusy]=useState(false),[inboxAdopting,setInboxAdopting]=useState(''),[inboxPhase,setInboxPhase]=useState(''),[inboxOpen,setInboxOpen]=useState(false);
  const autoProcessed=useRef(readStored('rafa-inbox-auto-source',''));
  const [layout,setLayout]=useState(readLayout);
  const [boardWidth,setBoardWidth]=useState(0);
  const board=useRef(null),beforePositions=useRef(null),workScrollRefs=useRef({left:null,right:null}),scrollSaveFrame=useRef(0),scrollRestored=useRef(false);
  useLayoutEffect(()=>{
    const node=board.current;if(!node)return;
    const measure=()=>setBoardWidth(node.clientWidth);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(node);
    window.addEventListener('resize',measure);
    return ()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[authenticated,loading]);
  useLayoutEffect(()=>{
    const previous=beforePositions.current;beforePositions.current=null;
    if(!previous||prefersReducedMotion())return;
    for(const node of board.current?.querySelectorAll('[data-entry-id]')||[]){
      const old=previous.get(node.dataset.entryId);if(!old)continue;
      const rect=node.getBoundingClientRect(),x=old.left-rect.left,y=old.top-rect.top;
      if(Math.abs(x)+Math.abs(y)>1)node.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  },[items]);
  const byId=indexes.byId,descendantsOf=indexes.descendants;
  const sideWidth=boardWidth*(1-layout.work/100),rightLayout=sideLayout(sideWidth);
  function applyItems(next,{animate=true}={}){
    beforePositions.current=animate&&!prefersReducedMotion()?new Map([...board.current?.querySelectorAll('[data-entry-id]')||[]].map(node=>[node.dataset.entryId,node.getBoundingClientRect()])):null;
    itemsRef.current=next;
    setItems(next);
  }
  function feedback(id){
    if(prefersReducedMotion())return;
    requestAnimationFrame(()=>{
      const node=board.current?.querySelector(`[data-entry-id="${id}"]`);
      node?.classList.add('is-feedback');
      setTimeout(()=>node?.classList.remove('is-feedback'),700);
    });
  }
  async function locatePinned(item){
    const entries=itemsRef.current,byId=new Map(entries.map(entry=>[entry.id,entry]));
    const collapsed=[];let parent=byId.get(item.parentId);
    while(parent){if(parent.collapsed)collapsed.push(parent);parent=byId.get(parent.parentId);}
    if(collapsed.length){
      try{const expanded=await Promise.all(collapsed.map(group=>api('/api/entries/'+group.id,'PUT',{...group,collapsed:false})));const patches=new Map(expanded.map(group=>[group.id,group]));applyItems(entries.map(entry=>patches.get(entry.id)||entry));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
      catch(error){setError(error.message);return;}
    }
    const node=board.current?.querySelector(`[data-entry-id="${item.id}"]`);
    if(!node)return;
    node.scrollIntoView({behavior:prefersReducedMotion()?'instant':'smooth',block:'center'});
    if(!prefersReducedMotion())setTimeout(()=>{const read=node.querySelector('.entry-read');if(read)read.animate([{backgroundColor:'#c9e3c6'},{backgroundColor:getComputedStyle(read).backgroundColor}],{duration:1100,easing:'ease-out'});},300);
  }

  useEffect(()=>{try{localStorage.setItem('rafa-layout',JSON.stringify(layout));}catch{}},[layout]);
  useEffect(()=>{
    if(!authenticated)return;
    const refresh=()=>{if(document.visibilityState!=='visible')return;api('/api/entries').then(entries=>{itemsRef.current=entries;setItems(entries);}).catch(()=>{});};
    const timer=setInterval(refresh,30000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[authenticated]);
  useEffect(()=>{
    if(!entriesLoaded||scrollRestored.current)return;
    scrollRestored.current=true;
    const saved=readStored('rafa-work-scroll',{})||{};
    for(const pane of ['left','right'])requestAnimationFrame(()=>{const node=workScrollRefs.current[pane];if(node&&Number.isFinite(saved[pane]))node.scrollTop=saved[pane];});
  },[entriesLoaded]);
  useEffect(()=>()=>{cancelAnimationFrame(scrollSaveFrame.current);},[]);
  useEffect(()=>{try{localStorage.setItem('rafa-inbox-text',JSON.stringify(inboxText));}catch{}},[inboxText]);
  useEffect(()=>{try{localStorage.setItem('rafa-inbox-batches',JSON.stringify(inboxBatches));}catch{}},[inboxBatches]);
  useEffect(()=>{if(!inboxText.trim()||inboxBusy)return;const source=inboxText.trim();if(source===autoProcessed.current)return;const timer=setTimeout(()=>runInboxAI(source),60000);return()=>clearTimeout(timer);},[inboxText,inboxBusy]);
  const itemsRef=useRef(items);itemsRef.current=items;
  useEffect(()=>{if(!zen)return;const timer=setInterval(()=>setZenNow(Date.now()),1000);return()=>clearInterval(timer);},[zen]);
  useEffect(()=>{if(!zen)return;const onKeyDown=event=>{if(event.key==='Escape'){event.preventDefault();setZenConfirm('hold');}};document.addEventListener('keydown',onKeyDown);return()=>document.removeEventListener('keydown',onKeyDown);},[zen]);
  function startZen(item){setMenu(null);setZen({id:item.id,startedAt:Date.now()});setZenNow(Date.now());setZenConfirm('');}
  function zenDuration(milliseconds){const seconds=Math.max(0,Math.floor(milliseconds/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;return (hours?hours+'时':'')+(minutes?minutes+'分':'')+rest+'秒';}
  function zenClock(milliseconds){const seconds=Math.max(0,Math.floor(milliseconds/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;return hours?[hours,minutes,rest].map(value=>String(value).padStart(2,'0')).join(':'):[minutes,rest].map(value=>String(value).padStart(2,'0')).join(':');}
  function zenTree(item){const byParent=new Map();for(const entry of itemsRef.current){if(!byParent.has(entry.parentId||''))byParent.set(entry.parentId||'',[]);byParent.get(entry.parentId||'').push(entry);}const result=[];function visit(entry,depth){result.push({item:entry,depth});for(const child of byParent.get(entry.id)||[])visit(child,depth+1);}visit(item,0);return result;}
  function zenDescription(value){const parts=[],pattern=/(!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/uploads\/[^\s)]+)\)|(\n))/g;let start=0,match;while((match=pattern.exec(value))){if(match.index>start)parts.push(inline(value.slice(start,match.index)));parts.push(match[4]?<br key={'br-'+match.index}/>:<img key={'img-'+match.index} src={match[3]} alt={match[2]||'描述图片'}/>);start=pattern.lastIndex;}if(start<value.length)parts.push(inline(value.slice(start)));return parts;}
  function zenMetadata(item){const rows=[];if(item.type)rows.push(item.type==='todo'?'任务':item.type==='group'?'分组':item.type==='text'?'文本':item.type==='link'?'链接':item.type==='image'?'图片':item.type==='bullet'?'条目':'分隔线');if(item.status==='done')rows.push('已完成');else if(item.status==='doing')rows.push('进行中');else if(item.status==='waiting')rows.push('等待中');else if(item.status==='removed')rows.push('已取消');if(item.priority==='urgent')rows.push('!! 紧急');else if(item.priority==='high')rows.push('! 重要');if(item.owner)rows.push('@'+item.owner);for(const person of (item.people||'').split(/[,，]\s*/).filter(Boolean))rows.push('@'+person);for(const tag of (item.tags||'').split(/[,，]\s*/).filter(Boolean))rows.push('#'+tag);for(const [key,label] of [['dueDate','截止'],['planDate','计划'],['followupDate','跟进'],['stage','阶段']])if(item[key])rows.push(label+' '+item[key]);for(const [key,value] of Object.entries(item.custom||{}))if(value)rows.push(key+' · '+value);for(const id of item.dependencies||[])rows.push('前置 · '+(itemsRef.current.find(entry=>entry.id===id)?.title||id));for(const id of item.related||[])rows.push('关联 · '+(itemsRef.current.find(entry=>entry.id===id)?.title||id));return rows;}
  async function finishZen(action){
    if(!zen||pending.has('zen'))return;
    if(zenConfirm!==action){setZenConfirm(action);return;}
    setError('');
    const elapsed=zenDuration(Date.now()-zen.startedAt),record=`#ZEN ${action==='done'?'耗时':'已耗时'}${elapsed}`;
    try{
      if(draft&&!await save())return;
      markPending('zen',true);
      const entries=itemsRef.current,root=entries.find(item=>item.id===zen.id);
      if(!root){setZen(null);return;}
      const tree=zenTree(root),updates=new Map();
      if(action==='done'){
        for(const {item} of tree)if(item.type==='todo'&&item.status!=='removed'&&item.status!=='done')updates.set(item.id,{...item,status:'done'});
        const latest=updates.get(root.id)||root;
        updates.set(root.id,{...latest,content:[latest.content,record].filter(Boolean).join('\n')});
      }else{
        updates.set(root.id,{...root,content:[root.content,record].filter(Boolean).join('\n')});
      }
      for(const [id,value] of updates)replaceItem(await api('/api/entries/'+id,'PUT',value));
      setZen(null);setZenConfirm('');
    }catch(error){setError(error.message);}finally{markPending('zen',false);}
  }
  useEffect(()=>{api('/api/auth/status').then(status=>{setAuthenticated(status.authenticated);if(status.authenticated){api('/api/entries').then(entries=>{itemsRef.current=entries;setItems(entries);setEntriesLoaded(true);}).catch(e=>setError(e.message));api('/api/archive').then(setArchived).catch(e=>setError(e.message));}}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  useEffect(()=>()=>{drag.current?.cleanup?.();},[]);
  useEffect(()=>{
    if(!draft)return;
    const commit=event=>{if(!event.target.closest('.write-row, .drag-handle, .row-actions, .group-controls'))save();};
    document.addEventListener('pointerdown',commit);
    return ()=>document.removeEventListener('pointerdown',commit);
  },[draft?.editorKey,draft?.editorSeed,draft?.id,draft?.domain,draft?.workPane]);
  useEffect(()=>{const closeTransient=event=>{if(!event.target.closest('.context-menu,.row-actions'))setMenu(null);if(!event.target.closest('.row-actions,.context-menu'))setConfirmDelete('');if(!event.target.closest('.column-archive'))setConfirmArchive('');};document.addEventListener('pointerdown',closeTransient);return()=>document.removeEventListener('pointerdown',closeTransient);},[]);
  async function archiveDomain(domain){if(archiveBusy)return;if(confirmArchive!==domain){setConfirmArchive(domain);return;}setConfirmArchive('');setArchiveBusy(true);setError('');try{const result=await api('/api/archive','POST',{domain});itemsRef.current=result.items;setItems(result.items);setArchived(await api('/api/archive'));setError(result.count?`已归档 ${result.count} 条`:'没有可归档的内容');}catch(e){setError(e.message);}finally{setArchiveBusy(false);}}
  async function openArchive(){setArchiveOpen(true);try{setArchived(await api('/api/archive'));}catch(e){setError(e.message);}}
  function replaceItem(saved,options){applyItems(itemsRef.current.some(item=>item.id===saved.id)?itemsRef.current.map(item=>item.id===saved.id?saved:item):[...itemsRef.current,saved],options);}
  function updateInboxDraft(batchId,draftId,patch){setInboxBatches(previous=>previous.map(batch=>batch.id!==batchId?batch:{...batch,drafts:batch.drafts.map(draft=>draft.id===draftId?{...draft,...patch}:draft)}));}
  async function runInboxAI(source=inboxText.trim()){
    if(!source||inboxBusy)return;
    setInboxBusy(true);setInboxPhase('正在整理');setError('');
    try{
      const result=await api('/api/ai/parse','POST',{input:source});
      const drafts=(result.items||[]).map(item=>({...item,id:newId(),decision:'pending'}));
      autoProcessed.current=source;try{localStorage.setItem('rafa-inbox-auto-source',JSON.stringify(source));}catch{}
      if(!drafts.length){setInboxPhase('没有识别出任务');return;}
      const batch={id:newId(),source,createdAt:new Date().toISOString(),drafts};
      setInboxBatches(previous=>[batch,...previous]);setInboxOpen(true);setInboxPhase(`整理出 ${drafts.length} 条`);
      setTimeout(()=>setInboxPhase(''),3000);
    }catch(error){autoProcessed.current=source;try{localStorage.setItem('rafa-inbox-auto-source',JSON.stringify(source));}catch{}setError(error.message);setInboxPhase('整理失败，可点击按钮重试');}
    finally{setInboxBusy(false);}
  }
  async function adoptInboxDraft(batch,draft){
    if(inboxAdopting)return;setInboxAdopting(draft.id);
    try{const value=inboxEntry(draft);const saved=await api('/api/entries','POST',value);replaceItem(saved);updateInboxDraft(batch.id,draft.id,{decision:'accepted',entryId:saved.id});}
    catch(error){setError(error.message);}finally{setInboxAdopting('');}
  }
  function clearInbox(){setInboxText('');setInboxBatches([]);autoProcessed.current='';try{localStorage.removeItem('rafa-inbox-auto-source');}catch{}setInboxOpen(false);setInboxPhase('');}
  async function login(event){event.preventDefault();if(!password.trim()||loggingIn)return;setLoggingIn(true);setError('');try{await api('/api/auth/login','POST',{password});setPassword('');setAuthenticated(true);const entries=await api('/api/entries');itemsRef.current=entries;setItems(entries);setEntriesLoaded(true);}catch(e){setError(e.message);}finally{setLoggingIn(false);}}
  function close(){editorTextRef.current='';setDraft(null);}
  async function save(closeAfter=true,source=editorTextRef.current??draftRef.current?.editorSeed??''){
    const current=draftRef.current;
    if(!current)return false;
    if(!source.trim()){close();return true;}
    if(current.id&&source===editLine(current,itemsRef.current)){if(closeAfter)close();return current;}
    const key=current.id||current.editorKey||'new',inflight=saving.current.get(key);if(inflight)return inflight;
    let value;
    try{value=parseLine(source,current,itemsRef.current);}catch(e){setError(e.message);return false;}
    delete value.insert;delete value.editorSeed;delete value.editorKey;if(!value.id)delete value.position;
    if(value.type!=='divider'&&!value.title&&!value.content&&!value.image&&!value.url){close();return true;}
    const optimisticId=value.id||newId(),previous=value.id?itemsRef.current.find(entry=>entry.id===value.id)||null:null,now=new Date().toISOString();
    const optimistic={...current,...value,id:optimisticId,createdAt:previous?.createdAt||current.createdAt||now,updatedAt:now,completedAt:value.type==='todo'?(value.status==='done'?(previous?.completedAt||now):null):null,removedAt:value.status==='removed'?(previous?.removedAt||now):null};
    if(!previous)optimistic.position=localEndPosition(itemsRef.current,optimistic);
    applyItems(value.id?itemsRef.current.map(entry=>entry.id===value.id?optimistic:entry):placeOptimisticEntry(itemsRef.current,optimistic,current.insert));
    markPending(key,true);setError('');
    if(closeAfter)close();
    const operation=(async()=>{
      try{
        const saved=await api('/api/entries'+(value.id?'/'+value.id:''),value.id?'PUT':'POST',value);
        if(!value.id&&current.insert){
          const located={...saved,parentId:optimistic.parentId,workPane:optimistic.workPane,position:optimistic.position};
          applyItems(itemsRef.current.map(entry=>entry.id===optimisticId?located:entry));
          const spec={id:saved.id,targetId:current.insert.targetId,domain:saved.domain,workPane:saved.workPane,placement:current.insert.placement};
          try{applyItems(await api('/api/entries/move','POST',spec));}
          catch(moveError){setError(moveError.message,()=>move(spec));return located;}
        }else applyItems(itemsRef.current.map(entry=>entry.id===optimisticId?saved:entry));
        feedback(saved.id);
        if(!closeAfter){const seed=editLine(saved,itemsRef.current);editorTextRef.current=seed;setDraft({...saved,editorSeed:seed,editorKey:newId()});}
        return saved;
      }catch(e){
        const rolledBack=previous?itemsRef.current.map(entry=>entry.id===previous.id?previous:entry):itemsRef.current.filter(entry=>entry.id!==optimisticId);
        applyItems(rolledBack);editorTextRef.current=source;setDraft(previous?{...previous,editorSeed:source,editorKey:current.editorKey||newId()}:{...current,id:'',editorSeed:source,editorKey:current.editorKey||newId()});
        setError(e.message,()=>save(false,source));
        return false;
      }finally{markPending(key,false);}
    })();
    saving.current.set(key,operation);
    try{return await operation;}finally{saving.current.delete(key);}
  }
  async function open(item,domain,parentId='',pane=''){
    if(suppressClick.current)return;
    if(draft&&(item?.id===draft.id&&item?.id||!item&&!draft.id&&draft.domain===domain&&(!pane||(draft.workPane||'left')===pane))){document.querySelector('.write-input textarea')?.focus();return;}
    if(draft&&!await save())return;
    const parent=itemsRef.current.find(entry=>entry.id===parentId);
    if(parent?.collapsed){try{replaceItem(await api('/api/entries/'+parent.id,'PUT',{...parent,collapsed:false}));}catch(error){setError(error.message);return;}}
    const value=item||{domain,title:'',content:'',type:'todo',status:'open',parentId,workPane:domain==='Work'?pane||'left':''};
    const seed=item?editLine(item,items):'';editorTextRef.current=seed;setDraft({...value,editorSeed:seed,editorKey:newId()});setError('');
  }
  async function insertNear(item,placement,type){setMenu(null);if(draft&&!await save())return;const prefix=type==='group'?'## ':type==='text'?'> ':'';editorTextRef.current=prefix;setDraft({domain:item.domain,type,status:'open',title:'',content:'',parentId:item.parentId||'',workPane:item.workPane||'',insert:{targetId:item.id,placement},editorSeed:prefix,editorKey:newId()});}
  async function updateStatus(item,status=item.status==='done'?'open':'done'){
    if(pending.has(item.id))return;
    if(draft){const saved=await save();if(!saved)return;if(saved.id===item.id)item=saved;}
    const current=itemsRef.current.find(entry=>entry.id===item.id)||item;
    if(current.status===status)return;
    const now=new Date().toISOString(),optimistic={...current,status,updatedAt:now,completedAt:current.type==='todo'?(status==='done'?(current.completedAt||now):null):null,removedAt:status==='removed'?(current.removedAt||now):null};
    const commit=()=>updateStatus(current,status);
    markPending(current.id,true);setError('');
    applyItems(itemsRef.current.map(entry=>entry.id===current.id?optimistic:entry),{animate:false});
    feedback(current.id);
    try{replaceItem(await api('/api/entries/'+current.id,'PUT',{...current,status}),{animate:false});}
    catch(e){applyItems(itemsRef.current.map(entry=>entry.id===current.id?current:entry),{animate:false});setError(e.message,commit);}
    finally{markPending(current.id,false);}
  }
  async function togglePin(item){
    setMenu(null);
    if(draft&&!await save())return;
    const current=itemsRef.current.find(entry=>entry.id===item.id)||item;
    if(pending.has(current.id))return;
    if(!current.pinnedAt&&itemsRef.current.filter(entry=>entry.domain===current.domain&&entry.pinnedAt).length>=3){setError('每个栏目最多置顶 3 条');return;}
    const patch={pinnedAt:current.pinnedAt?'':new Date().toISOString()},optimistic={...current,...patch},commit=()=>togglePin(current);
    markPending(current.id,true);setError('');
    applyItems(itemsRef.current.map(entry=>entry.id===current.id?optimistic:entry),{animate:false});
    try{replaceItem(await api('/api/entries/'+current.id,'PUT',{...current,...patch}),{animate:false});}
    catch(e){applyItems(itemsRef.current.map(entry=>entry.id===current.id?current:entry),{animate:false});setError(e.message,commit);}
    finally{markPending(current.id,false);}
  }
  async function configureGroup(item,patch){
    if(draft&&!await save())return;
    const current=itemsRef.current.find(entry=>entry.id===item.id)||item;
    if(pending.has(current.id))return;
    const optimistic={...current,...patch},commit=()=>configureGroup(current,patch);
    markPending(current.id,true);setError('');
    applyItems(itemsRef.current.map(entry=>entry.id===current.id?optimistic:entry),{animate:false});
    try{replaceItem(await api('/api/entries/'+current.id,'PUT',{...current,...patch}),{animate:false});}
    catch(e){applyItems(itemsRef.current.map(entry=>entry.id===current.id?current:entry),{animate:false});setError(e.message,commit);}
    finally{markPending(current.id,false);}
  }
  async function deleteItem(item){
    if(pending.has(item.id))return;
    if(confirmDelete!==item.id){setConfirmDelete(item.id);return;}
    setConfirmDelete('');
    if(draft?.id===item.id)close();else if(draft&&!await save())return;
    markPending(item.id,true);setError('');
    try{
      const next=await api('/api/entries/'+item.id,'DELETE');
      const node=[...board.current?.querySelectorAll('[data-entry-id]')||[]].find(node=>node.dataset.entryId===item.id);
      if(node&&!prefersReducedMotion())await node.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(8px)'}],{duration:140,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});
      applyItems(next);
    }catch(e){setError(e.message);}finally{markPending(item.id,false);}
  }
  function resize(event,kind){
    if(event.button!==0)return;
    event.preventDefault();
    const handle=event.currentTarget,rect=(kind==='workSplit'?handle.parentElement:board.current).getBoundingClientRect();
    try{handle.setPointerCapture(event.pointerId);}catch{}
    const move=event=>{
      if(kind==='daily'||kind==='life'){
        const value=(event.clientY-rect.top)/rect.height*100,daily=kind==='daily'?value:layout.total-value;
        setLayout(previous=>{
          const d=Math.min(Math.max(10,daily),previous.total-10);
          return {...previous,daily:d,life:previous.total-d};
        });
        return;
      }
      const value=kind==='workSplit'?(event.clientX-rect.left)/rect.width*100:(event.clientX-rect.left)/rect.width*100;
      setLayout(previous=>({...previous,[kind]:kind==='workSplit'?Math.min(80,Math.max(20,value)):clamp(value)}));
    };
    const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);document.body.classList.remove('is-resizing');};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);document.body.classList.add('is-resizing');
  }
  function divider(axis){const side=axis==='daily'||axis==='life';const value=side?(axis==='daily'?layout.daily:layout.total-layout.daily):layout[axis],min=side?10:25,max=side?layout.total-10:75,amount=2;return <div className={'divider divider-'+axis} role="separator" tabIndex={0} aria-label={axis==='work'?'调整 WORK 宽度':axis==='daily'?'调整 DAILY 高度':'调整 LIFE 高度'} aria-orientation={axis==='work'?'vertical':'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} onPointerDown={event=>resize(event,axis)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();const direction=event.key==='Home'?0:(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);setLayout(previous=>{if(side){const current=axis==='daily'?previous.daily:previous.total-previous.daily;const next=direction===0?(axis==='daily'?22:38):current+direction*amount;const d=axis==='daily'?Math.min(Math.max(10,next),previous.total-10):previous.total-Math.min(Math.max(10,next),previous.total-10);return {...previous,daily:d,life:previous.total-d};}return {...previous,[axis]:direction===0?50:clamp(previous[axis]+direction*amount)};});}}/>;}
  function workDivider(){return <div className="divider divider-worksplit" role="separator" tabIndex={0} aria-label="调整 WORK 左右栏宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.workSplit)} onPointerDown={event=>resize(event,'workSplit')} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();setLayout(previous=>({...previous,workSplit:event.key==='Home'?50:Math.min(80,Math.max(20,previous.workSplit+(event.key==='ArrowLeft'?-2:2)))}));}}}/>;}
  async function move(spec){
    if(pending.has('move'))return;
    markPending('move',true);setError('');
    try{applyItems(await api('/api/entries/move','POST',spec));feedback(spec.id);}catch(e){setError(e.message,()=>move(spec));}finally{markPending('move',false);}
  }
  function beginDrag(event,item){
    if(event.button!==0||pending.has('move'))return;
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
        const pane=column.dataset.workPane||node?.closest('[data-work-pane]')?.dataset.workPane||'';
        const groupBlock=node?.closest('.group-block');
        if(!row&&groupBlock){const groupRow=groupBlock.querySelector('[data-entry-id]');if(groupRow)next={id:item.id,targetId:groupRow.dataset.entryId,domain,workPane:pane,placement:'inside'};}
        if(row){
          const box=row.getBoundingClientRect(),portion=(event.clientY-box.top)/box.height;
          const target=itemsRef.current.find(entry=>entry.id===row.dataset.entryId);
          if(target&&target.id!==item.id){
            const indent=Number(row.dataset.depth||0)*22;
            const placement=portion>.25&&portion<.75&&event.clientX>box.left+indent+55?'inside':portion<.5?'before':'after';
            next={id:item.id,targetId:target.id,domain,workPane:pane,placement};
          }
        }else if(!next)next={id:item.id,domain,workPane:pane,placement:'end'};
      }
      currentDrop.current=next;setDrop(next);
      if(column){
        const workColumn=node?.closest('[data-work-pane]'),scroller=workColumn?.querySelector('.work-col-scroll')||column.querySelector('.column-scroll'),box=scroller?.getBoundingClientRect();
        if(box&&scroller){if(event.clientY<box.top+45)scroller.scrollBy(0,-12);if(event.clientY>box.bottom-45)scroller.scrollBy(0,12);}
      }
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
  async function insertNextTask(source){
    if(!draft||pending.has(draft.id||draft.editorKey||'new'))return;
    const nextDraft=draft;
    const saved=await save(false,source);
    if(!saved||saved===true)return;
    editorTextRef.current='';
    setDraft({domain:saved.domain,type:'todo',status:'open',title:'',content:'',parentId:saved.parentId||'',workPane:saved.workPane||nextDraft.workPane||'',insert:{targetId:saved.id,placement:'after'},editorSeed:'',editorKey:newId()});
  }
  async function indent(outdent,source=draft?.editorSeed||''){
    if(!draft)return;
    let item=draft;
    if(source.trim()){const saved=await save(false,source);if(!saved||saved===true)return;item=saved;}
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
  async function upload(file,draftValue=draft){
    if(!file)return;
    const base=draftValue||draft||{domain:'Work',type:'image',parentId:''};
    const editorKey=base.editorKey||newId();
    markPending('upload',true);setError('');
    try{
      if(file.size>8*1024*1024)throw new Error('图片不能超过 8MB');
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const result=await api('/api/upload','POST',{base64,mime:file.type});
      const current=base===draft?editorTextRef.current??base.editorSeed??'':base.editorSeed??'',seed=(current?current+' ':'')+'!['+file.name.replace(/[\[\]]/g,'')+']('+result.url+')';
      editorTextRef.current=seed;setDraft({...base,editorSeed:seed,editorKey});
    }catch(e){setError(e.message);}finally{markPending('upload',false);}
  }
  function editor(){
    return <EntryEditor key={draft.editorKey||draft.id} draft={draft} items={items} initialText={draft.editorSeed||''} onTextChange={value=>{editorTextRef.current=value;}} onSave={source=>save(true,source)} onClose={close} onUpload={file=>upload(file,draft)} onIndent={(outdent,source)=>indent(outdent,source)} onNext={source=>insertNextTask(source)}/>;
  }
  function row(item,depth){
    const editing=draft?.id===item.id,done=item.status==='done',removed=item.status==='removed',group=item.type==='group',divider=item.type==='divider';
    const descendants=descendantsOf(item.id);
    const tasks=items.filter(entry=>entry.id!==item.id&&descendants.has(entry.id)&&entry.type==='todo'&&entry.status!=='removed');
    const target=drop?.targetId===item.id?drop.placement:'';
    const timeTitle=[['createdAt','创建'],['updatedAt','更新'],['completedAt','完成'],['removedAt','移除']].filter(([key])=>item[key]).map(([key,name])=>name+'：'+new Date(item[key]).toLocaleString('zh-CN',{hour12:false})).join('\n');
    return <div key={item.id} className={'entry '+(done?'is-done ':'')+(removed?'is-removed ':'')+(group?'is-group ':'')+(divider?'is-divider ':'')+(item.url?'has-link ':'')+(item.pinnedAt?'is-pinned ':'')+(dragging===item.id?'drag-source ':'')+(target?'drop-'+target:'')} data-entry-id={item.id} data-depth={depth} style={{'--depth':depth}} onPointerDown={event=>{if(event.target.closest('button,a,textarea,input,.row-actions,.group-controls,.group-picker'))return;beginDrag(event,item);}} onClick={event=>{if(event.target.closest('button,a,textarea,.entry-body,.row-actions,.group-controls,.group-picker')||editing)return;open(item);}} onContextMenu={event=>{if(event.target.closest('textarea'))return;event.preventDefault();setMenu({x:event.clientX, y:event.clientY,item});}}>
      <button className="drag-handle" title="拖动排序；放在文字中间成为子条目" aria-label={'拖动 '+titleOf(item)} onPointerDown={event=>{event.stopPropagation();beginDrag(event,item);}}><DotsSixVertical size={14}/></button>
      {editing?editor():<div className="entry-read">
        {!group&&descendants.size>0&&<button className={'group-toggle task-toggle '+(item.collapsed?'collapsed':'')} aria-label={(item.collapsed?'展开':'收起')+descendants.size+' 个子条目'} aria-expanded={!item.collapsed} disabled={pending.has(item.id)} onClick={()=>configureGroup(item,{collapsed:!item.collapsed})}><CaretDown size={13}/></button>}
        {group?<><button className={'group-toggle '+(item.collapsed?'collapsed':'')} aria-label={item.collapsed?'展开分组':'收起分组'} aria-expanded={!item.collapsed} onClick={()=>configureGroup(item,{collapsed:!item.collapsed})}><CaretDown size={15}/></button><button className="group-signature" title="选择分组图标和底色" onClick={()=>setPicker(picker===item.id?'':item.id)}>{item.signature||'🌿'}</button>{picker===item.id&&<div className="group-picker"><div>{['🌿','📌','📝','🚀','💡','🏠','💼'].map(signature=><button key={signature} aria-label={'图标 '+signature} onClick={()=>{configureGroup(item,{signature});setPicker('');}}>{signature}</button>)}</div><div>{['sage','sand','blue','rose','none'].map(tone=><button className={'tone-swatch tone-'+tone} key={tone} aria-label={'底色 '+tone} onClick={()=>{configureGroup(item,{tone});setPicker('');}}/>)}</div></div>}</>:divider?<span className="kind-mark">—</span>:item.type==='todo'?<button className={'checkbox '+(done?'checked':'')} aria-label={done?'重新打开任务':'完成任务'} onClick={()=>updateStatus(item)} disabled={pending.has(item.id)}>{done&&<Check size={11} weight="bold"/>}{removed&&<span>−</span>}</button>:<span className="kind-mark">{item.type==='text'?<TextT size={15}/>:item.type==='link'?<LinkSimple size={15}/>:item.type==='bullet'?<span>•</span>:<ImageSquare size={15}/>}</span>}
        <div className={'entry-body '+(item.url?'linked-body':'')} title={timeTitle} role="button" tabIndex={0} onClick={event=>{if(event.target.closest('a'))return;open(item);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(item);}}} aria-label={'编辑 '+titleOf(item)}>
          <EntryContent item={item} items={items}/>
        </div>
        {group&&<div className="group-controls"><span className="group-count" title="已完成 / 总任务数（不含取消）">{tasks.filter(task=>task.status==='done').length}/{tasks.length}</span><button title="在分组内写一条" aria-label="在分组内新增条目" onClick={()=>open(null,item.domain,item.id)}><Plus size={14}/></button>

        </div>}
        <div className="row-actions">
          <button className="row-menu-trigger" title="更多操作" aria-label={'更多操作：'+titleOf(item)} aria-haspopup="menu" aria-expanded={menu?.item?.id===item.id} disabled={pending.has(item.id)} onClick={event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setMenu(menu?.item?.id===item.id?null:{x:rect.right-180,y:rect.bottom+4,item,kind:'row'});}}><DotsThree size={17} weight="bold"/></button>
        </div>
      </div>}
    </div>;
  }
  function renderTree(domain,pane=''){
    const allRows=indexes.workRows;
    const paneRows=domain==='Work'?allRows.filter(({item})=>(indexes.workPanes.get(item.id)||'left')===pane):treeRows(items,domain);
    const rows=paneRows;
    function renderBranch(parentId='',level=0){return rows.filter(({item})=>(item.parentId||'')===parentId||!parentId&&item.parentId&&!items.some(entry=>entry.id===item.parentId&&entry.domain===domain)).map(({item})=>{
      const children=renderBranch(item.id,item.type==='group'?0:level+1);
      const insertion=draft&&!draft.id&&draft.insert?.targetId===item.id?editor():null;
      if(item.type==='group')return <React.Fragment key={item.id}>{draft?.insert?.placement==='before'&&insertion}<div className={'group-block tone-'+(['sage','sand','blue','rose','none'].includes(item.tone)?item.tone:'sage')} style={{marginLeft:level?18:0}}>{row(item,0)}{!item.collapsed&&<div className="group-children">{children}{draft&&!draft.id&&!draft.insert&&draft.parentId===item.id&&editor()}</div>}</div>{draft?.insert?.placement==='after'&&insertion}</React.Fragment>;
      return <React.Fragment key={item.id}>{draft?.insert?.placement==='before'&&insertion}{row(item,level)}{!item.collapsed&&children}{!item.collapsed&&draft&&!draft.id&&!draft.insert&&draft.parentId===item.id&&editor()}{draft?.insert?.placement==='after'&&insertion}</React.Fragment>;
    });}
    return renderBranch();
  }
  function paneOf(item){
    if(item.domain!=='Work')return '';
    return indexes.workPanes.get(item.id)||'left';
  }
  function workAddRow(pane){
    const active=draft&&!draft.id&&!draft.insert&&!draft.parentId&&draft.domain==='Work'&&(draft.workPane||'left')===pane;
    return <div className="add-row">{active?editor():<button onClick={()=>open(null,'Work','',pane)} aria-label={'在 WORK '+pane+' 栏新增条目'}><Plus size={14}/><span>写一条…</span></button>}</div>;
  }
  function saveWorkScroll(){
    cancelAnimationFrame(scrollSaveFrame.current);
    scrollSaveFrame.current=requestAnimationFrame(()=>{
      const value={};
      for(const pane of ['left','right']){const node=workScrollRefs.current[pane];if(node)value[pane]=node.scrollTop;}
      try{localStorage.setItem('rafa-work-scroll',JSON.stringify(value));}catch{}
    });
  }
  function workPane(pane){
    const endDrop=drop?.domain==='Work'&&drop.placement==='end'&&(drop.workPane||'left')===pane;
    return <div className={'work-col '+(endDrop?'is-end-drop':'')} data-work-pane={pane} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{const file=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,{domain:'Work',type:'image',parentId:'',workPane:pane});}}}>
      <div className="work-col-scroll" ref={node=>{workScrollRefs.current[pane]=node;}} onScroll={saveWorkScroll}>
        <div className="column-content">{loading?<div className="loading">加载中…</div>:renderTree('Work',pane)}</div>
        {workAddRow(pane)}
        {dragging&&endDrop&&<div className="work-end-drop">放到{pane==='left'?'左':'右'}栏末尾</div>}
      </div>
    </div>;
  }
  function columnSection(domain){
    return <section className={'column '+(drop?.domain===domain&&drop.placement==='end'?'drop-column':'')} key={domain} data-domain={domain} aria-label={domain}
      onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}}
      onDrop={event=>{const file=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();upload(file,domain);}}}>
      <div className="column-watermark" aria-hidden="true">{domain==='Glean & Idea'?<>GLEAN<span>& IDEA</span></>:domain.toUpperCase()}</div>
      <div className="column-head"><h1>{domain.toUpperCase()}</h1><span>{items.filter(item=>item.domain===domain&&item.type==='todo'&&!['done','removed'].includes(item.status)).length}</span><button className={'column-archive '+(confirmArchive===domain?'confirm-archive':'')} onClick={()=>archiveDomain(domain)} disabled={archiveBusy} aria-label={confirmArchive===domain?'确认归档':'归档 '+domain+' 已完成和已移除的内容'} title={confirmArchive===domain?'再次点击确认归档':'归档本栏'}>{confirmArchive===domain?'确认归档':<Archive size={16}/>}</button></div>
      {items.some(item=>item.domain===domain&&item.pinnedAt)&&<div className="pinned-list" aria-label={domain+' 置顶条目'}>{items.filter(item=>item.domain===domain&&item.pinnedAt).sort((a,b)=>a.pinnedAt.localeCompare(b.pinnedAt)).map(item=><div className="pinned-item" key={item.id} onContextMenu={event=>{event.preventDefault();setMenu({x:event.clientX,y:event.clientY,item});}}><PushPin size={13} weight="fill"/><button className="pinned-title" onClick={()=>locatePinned(item)} title={titleOf(item)}><span className="pinned-title-text">{inline(titleOf(item),false)}</span>{item.content&&<span className="pinned-note">{item.content.split('\n').map((line,index)=><span key={index}>{inline(line,false)}</span>)}</span>}<span className="pinned-meta">{item.priority==='urgent'?'!! 紧急':item.priority==='high'?'! 重要':''}{item.owner?' @'+item.owner:''}{item.tags?' '+item.tags.split(/[,，]\s*/).map(tag=>'#'+tag).join(' '):''}{item.dueDate?' 截止 '+item.dueDate:''}</span></button><button className="pinned-unpin" onClick={()=>togglePin(item)} aria-label={'取消置顶 '+titleOf(item)} title="取消置顶"><PushPin size={13} weight="fill"/></button></div>)}</div>}
      {domain==='Work'?<div className="column-scroll work-scroll"><div className="work-cols" style={{'--work-split':layout.workSplit+'%'}}>{workPane('left')}{workDivider()}{workPane('right')}</div></div>:<div className="column-scroll">
      <div className="column-content">{loading?<div className="loading">加载中…</div>:renderTree(domain)}</div>
      <div className="add-row">{draft&&!draft.id&&!draft.insert&&!draft.parentId&&draft.domain===domain?editor():<button onClick={()=>open(null,domain)} aria-label={'在 '+domain+' 新增条目'}><Plus size={14}/><span>写一条…</span></button>}</div>
      </div>}
      {domain==='Work'&&<div className="inbox-wrap"><div className="inbox"><div className="inbox-entry"><textarea id="work-inbox" value={inboxText} onChange={event=>setInboxText(event.target.value)} placeholder="随手记下新信息，不必整理…" aria-label="INBOX 原文"/><button className="inbox-run" onClick={()=>runInboxAI()} disabled={!inboxText.trim()||inboxBusy} title="整理为任务草稿" aria-label="AI 整理"><MagicWand size={17}/></button></div><div className="inbox-status" aria-live="polite">{inboxBusy?inboxPhase:inboxPhase||'停止输入 60 秒后自动整理'}{inboxBatches.length>0&&<button className="inbox-review" onClick={()=>setInboxOpen(value=>!value)}>{inboxOpen?'草稿预览中':`查看 AI 草稿 (${inboxBatches.reduce((sum,batch)=>sum+batch.drafts.filter(draft=>draft.decision==='pending').length,0)} 待处理)`}</button>}</div></div>

      </div>}
    </section>;
  }
  if(authenticated===null||loading)return <div className="auth-screen"><div className="auth-brand"><img className="auth-cat" src="/rafa-cat.png" alt=""/><div className="auth-mark">Rafa<span>todo</span><i/></div></div><span className="auth-loading">正在打开…</span><ErrorNotice message={error} retry={retryAction} onClose={()=>setError('')}/></div>;
  if(!authenticated)return <div className="auth-screen"><form className="auth-form" onSubmit={login}><div className="auth-brand"><img className="auth-cat" src="/rafa-cat.png" alt=""/><div className="auth-mark">Rafa<span>todo</span><i/></div></div><div className="auth-input"><input id="password" type="password" autoFocus autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} aria-label="密码" placeholder="••••••" onKeyDown={event=>{if(event.key==='Enter')login(event);}}/></div></form><ErrorNotice message={error} retry={retryAction} onClose={()=>setError('')}/></div>;
  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="RafaTodo 首页"><img className="brand-cat" src="/rafa-cat.png" alt=""/>Rafa<span>todo</span><i/></a><div className="top-tools"><button className="archive-view" onClick={openArchive} aria-label="查看归档" title="查看归档"><Archive size={18}/></button><button className={'heatmap-trigger '+(heatmapOpen?'active':'')} onClick={()=>setHeatmapOpen(value=>!value)} aria-label="打开活动热力图" title="活动热力图"><ChartBar size={18}/></button></div><Heatmap items={items} open={heatmapOpen} onClose={()=>setHeatmapOpen(false)}/><ArchiveModal open={archiveOpen} items={archived} onClose={()=>setArchiveOpen(false)}/></header>
    <ErrorNotice message={error} retry={retryAction} onClose={()=>setError('')}/>
    <main ref={board} className="board" data-side-layout={rightLayout} style={{'--work':layout.work+'%','--daily':layout.daily+'%','--life':layout.life+'%','--glean':Math.max(10,100-layout.total)+'%'}}><div className="side-board">{domains.filter(domain=>domain!=='Work').map(columnSection)}</div>{columnSection('Work')}{divider('work')}{divider('daily')}{divider('life')}</main>
    {inboxOpen&&<InboxDialog onClose={()=>setInboxOpen(false)}>
      <div className="inbox-drafts-head"><strong>AI 草稿 <span>{inboxBatches.reduce((sum,batch)=>sum+batch.drafts.filter(draft=>draft.decision==='pending').length,0)} 待处理</span></strong><button autoFocus onClick={()=>setInboxOpen(false)} aria-label="关闭 AI 草稿"><X size={18}/></button></div>
      <div className="inbox-drafts-list">{inboxBatches.length?inboxBatches.map(batch=><section className="inbox-batch" key={batch.id}>
        <div className="inbox-batch-title"><time>{new Date(batch.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><span title={batch.source}>{batch.source}</span></div>
        {batch.drafts.map(draft=><article className={'inbox-card '+(draft.decision||'pending')} key={draft.id}>
          <div className="inbox-card-preview"><span className="inbox-card-domain">{draft.domain}</span><div className="entry-read"><span className="checkbox" aria-hidden="true"/><div className="entry-body"><EntryContent item={inboxEntry(draft)} items={items}/></div></div></div>
          <div className="inbox-card-actions">{draft.decision==='accepted'?<span><Check size={13}/> 已采纳</span>:draft.decision==='ignored'?<span>已忽略</span>:<><button className="inbox-adopt" disabled={!!inboxAdopting} onClick={()=>adoptInboxDraft(batch,draft)}>{inboxAdopting===draft.id?'采纳中…':'采纳'}</button><button disabled={!!inboxAdopting} onClick={()=>updateInboxDraft(batch.id,draft.id,{decision:'ignored'})}>忽略</button></>}</div>
        </article>)}
      </section>):<p className="inbox-empty">整理后的任务草稿会显示在这里</p>}</div>
      <div className="inbox-drafts-foot"><span>逐条采纳，即刻加入对应栏目。</span>{inboxBatches.length>0&&inboxBatches.every(batch=>batch.drafts.every(draft=>draft.decision!=='pending'))&&<button onClick={clearInbox}>清空原文与已处理批次</button>}</div>
    </InboxDialog>}
    {zen&&(()=>{const root=items.find(item=>item.id===zen.id);if(!root)return null;const rows=zenTree(root);return <div className="zen-screen" role="dialog" aria-modal="true" aria-label="ZEN 专注模式"><div className="zen-atmosphere" aria-hidden="true"><i/><i/><i/><i/></div><div className="zen-content"><div className="zen-label">ZEN <span>{root.domain.toUpperCase()}</span></div><div className="zen-timer" aria-live="off">{zenClock(zenNow-zen.startedAt)}</div><div className="zen-tree">{rows.map(({item,depth})=><article className={'zen-task '+(item.status==='done'?'is-done':'')} key={item.id} style={{'--zen-depth':depth}}><div className="zen-task-line"><span className="zen-mark">{item.status==='done'?'✓':item.type==='group'?'◇':'·'}</span><div className="zen-task-body"><h1>{inline(titleOf(item))}</h1>{item.content&&<p>{zenDescription(item.content)}</p>}{item.image&&<img className="zen-main-image" src={item.image} alt={item.title||'任务图片'}/>}</div></div>{zenMetadata(item).length>0&&<div className="zen-meta">{zenMetadata(item).map((value,index)=><span key={index}>{value}</span>)}</div>}{item.url&&<a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}</article>)}</div><div className="zen-actions">{zenConfirm==='hold'?<><button onClick={()=>setZenConfirm('')} disabled={pending.has('zen')}>取消</button><button className="zen-hold confirming" onClick={()=>finishZen('hold')} disabled={pending.has('zen')}>确认搁置？</button></>:<><button className={'zen-done '+(zenConfirm==='done'?'confirming':'')} onClick={()=>finishZen('done')} disabled={pending.has('zen')}>{zenConfirm==='done'?'确认完成？':<><Check size={16}/>完成</>}</button>{zenConfirm==='done'?<button onClick={()=>setZenConfirm('')} disabled={pending.has('zen')}>取消</button>:<button className="zen-hold" onClick={()=>finishZen('hold')} disabled={pending.has('zen')}>搁置</button>}</>}</div></div></div>})()}
    {dragging&&<div className="drag-caption">{drop?.placement==='inside'?'成为子条目':drop?.placement==='end'?(drop.domain==='Work'?'移到'+(drop.workPane==='right'?'右栏':'左栏')+'末尾':'移到 '+drop.domain+' 末尾'):drop?'移动到这里':'拖到目标位置'}</div>}
    {menu&&<div className={'context-menu '+(menu.kind==='row'?'row-menu':'')} role="menu" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-190)),top:Math.min(menu.y,window.innerHeight-(menu.kind==='row'?270:220))}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setMenu(null);}}}>
      {menu.kind==='row'?<>
        {menu.item.type!=='divider'&&<button role="menuitem" disabled={pending.has(menu.item.id)} onClick={()=>startZen(menu.item)}>ZEN 专注</button>}
        <button role="menuitem" disabled={pending.has(menu.item.id)} onClick={()=>togglePin(menu.item)}>{menu.item.pinnedAt?'取消置顶':'置顶'}</button>
        <button role="menuitem" disabled={pending.has(menu.item.id)} onClick={()=>{updateStatus(menu.item,menu.item.status==='removed'?'open':'removed');setMenu(null);}}>{menu.item.status==='removed'?'恢复条目':'取消条目'}</button>
        <span className="context-separator"/>
        <button role="menuitem" className={confirmDelete===menu.item.id?'confirm-delete':''} disabled={pending.has(menu.item.id)} onClick={()=>{if(confirmDelete===menu.item.id){deleteItem(menu.item);setMenu(null);}else setConfirmDelete(menu.item.id);}}>{confirmDelete===menu.item.id?'再次点击确认删除':'永久删除'}</button>
      </>:<>
        <button onClick={()=>startZen(menu.item)}>ZEN 专注</button>
        <button onClick={()=>insertNear(menu.item,'before','group')}>在上方插入标题</button><button onClick={()=>insertNear(menu.item,'after','group')}>在下方插入标题</button>
        <button onClick={()=>togglePin(menu.item)}>{menu.item.pinnedAt?'取消 PIN':'PIN 置顶'}</button>
        <button onClick={()=>insertNear(menu.item,'after','todo')}>插入任务</button><button onClick={()=>{setMenu(null);open(null,menu.item.domain,menu.item.id);}}>插入子任务</button>
      </>}
    </div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
