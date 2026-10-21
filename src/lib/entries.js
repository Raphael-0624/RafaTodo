export const domains=['Work','Life','Glean & Idea'];

// Avoid a negative lookbehind here: WebKit before iOS 16.4 parses (?<! as a
// named group and throws "invalid group specifier name", which kills the bundle.
function matchLink(value){
  const found=value.match(/(^|[^!])\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  if(!found)return null;
  return [found[0].slice(found[1].length),found[2],found[3]];
}

// A plain line is a task. Only explicit notation creates metadata.
export function parseLine(raw,base={},entries=[]){
  let text=raw.trim(),type='todo',status=base.status||'open',typeExplicit=false;
  if(/^---+$/.test(text))return {...base,type:'divider',title:'',content:'',status:'open',url:'',image:'',owner:'',people:'',tags:'',priority:'normal',prefixLabel:'',custom:{},dependencies:[],related:[]};
  const group=text.match(/^##\s+([\s\S]+)$/);
  if(group){type='group';typeExplicit=true;text=group[1].trim();}
  const bullet=text.match(/^-\s+(.+)$/);
  if(bullet&&!group&&!/^\[([ xX-])\]/.test(bullet[1])){type='bullet';typeExplicit=true;text=bullet[1].trim();}
  const mark=text.match(/^-?\s*\[([ xX-])\]\s*/);
  if(mark){status=mark[1]==='-'?'removed':/x/i.test(mark[1])?'done':'open';text=text.slice(mark[0].length);}
  else if(/^>\s?/.test(text)){type='text';typeExplicit=true;text=text.replace(/^>\s?/,'');}
  const metadata={owner:'',people:'',tags:'',priority:'normal',dueDate:'',planDate:'',followupDate:'',stage:'',prefixLabel:'',custom:{},dependencies:[],related:[]};
  const prefix=text.match(/^%([\p{L}\p{N}_/-]+)(?:\s+|$)/u);
  if(prefix){metadata.prefixLabel=prefix[1];text=text.slice(prefix[0].length);}
  const people=[],tags=[];
  // Formatting and link destinations are content, never metadata.
  const protectedParts=[];
  text=text.replace(/`[^`\n]+`|!?\[[^\]\n]*\]\([^\s)]+\)/g,value=>{protectedParts.push(value);return '\u0000'+(protectedParts.length-1)+'\u0000';});
  const consume=(regex,callback)=>{text=text.replace(regex,(...args)=>{callback(...args);return '';});};
  const target=title=>entries.find(item=>item.id!==base.id&&item.title===title)?.id;
  consume(/(?:^|\s)after:\[\[([^\]]+)\]\]/g,(_,title)=>{const id=target(title);if(!id)throw new Error('找不到前置任务：'+title);metadata.dependencies.push(id);});
  consume(/(?:^|\s)\[\[([^\]]+)\]\]/g,(_,title)=>{const id=target(title);if(!id)throw new Error('找不到关联条目：'+title);metadata.related.push(id);});
  consume(/(?:^|\s)(due|plan|follow):(\d{4}-\d{2}-\d{2})(?=\s|$)/g,(_,key,value)=>{
    const date=new Date(value+'T00:00:00Z');
    if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('日期无效：'+value);
    metadata[{due:'dueDate',plan:'planDate',follow:'followupDate'}[key]]=value;
  });
  consume(/(?:^|\s)stage:("[^"]*"|[^\s]+)(?=\s|$)/g,(_,value)=>{metadata.stage=value.replace(/^"|"$/g,'');});
  consume(/(?:^|\s)([\p{L}\p{N}_-]+)::("[^"]*"|[^\s]+)(?=\s|$)/gu,(_,key,value)=>{metadata.custom[key]=value.replace(/^"|"$/g,'');});
  // Keep @people in the title so their original position remains visible.
  text=text.replace(/(?:^|\s)@("[^"]+"|[\p{L}\p{N}_·.-]+)/gu,(match,name)=>{people.push(name.replace(/^"|"$/g,''));return match;});
  consume(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu,(_,tag)=>tags.push(tag));
  consume(/(?:^|\s)(!!|!重要|!!紧急|!)(?=\s|$)/g,(_,flag)=>{metadata.priority=flag.startsWith('!!')?'urgent':'high';});
  consume(/(?:^|\s)~(doing|waiting)(?=\s|$)/g,(_,value)=>{status=value;});
  let signature=base.signature||'🌿',tone=base.tone||'sage';
  if(type==='group'){
    consume(/(?:^|\s)(?:sig|icon):([^\s]+)(?=\s|$)/g,(_,value)=>{signature=value;});
    consume(/(?:^|\s)(?:tone|color):([a-z-]+)(?=\s|$)/g,(_,value)=>{tone=value;});
  }
  text=text.replace(/\u0000(\d+)\u0000/g,(_,index)=>protectedParts[Number(index)]).trim();
  const image=text.match(/!\[([^\]]*)\]\(([^\s)]+)\)/);
  const link=matchLink(text);
  const bareUrl=!image&&!link&&text.match(/^https?:\/\/[^\s]+$/i);
  let url='',imageUrl='';
  if(image){type='image';imageUrl=image[2];text=text.replace(image[0],image[1]);}
  else if(link&&text===link[0]&&type==='todo'&&!mark&&!typeExplicit&&!(base.id&&base.type==='todo')){type='link';url=link[2];text=link[1];}
  else if(bareUrl&&type==='todo'){url=bareUrl[0];if(!mark&&!typeExplicit&&!(base.id&&base.type==='todo'))type='link';}
  metadata.owner=people[0]||'';metadata.people=people.slice(1).join(', ');metadata.tags=[...new Set(tags)].join(', ');
  const lines=text.trim().split('\n');
  return {...base,...metadata,type,status,signature,tone,title:lines.shift()?.trim()||'',content:lines.join('\n').trim(),url,image:imageUrl};
}

export function pasteLink(text,start,end,value){
  const url=value.trim();
  if(start===end||!/^[Hh][Tt][Tt][Pp][Ss]?:\/\/[^\s<>]+$/.test(url))return null;
  const label=text.slice(start,end).replace(/([\[\]\\])/g,'\\$1');
  const replacement='['+label+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';
  return {text:text.slice(0,start)+replacement+text.slice(end),caret:start+replacement.length};
}

const quote=value=>/\s/.test(value)?'"'+value+'"':value;
function hasPerson(text,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?:^|\\s)@(?:"'+escaped+'"|'+escaped+')(?![\\p{L}\\p{N}_·.-])','u').test(text);
}
export function toLine(item,entries=[],{hideTaskPrefix=false}={}){
  if(item.type==='divider')return '---';
  let text=item.title||'';
  if(item.prefixLabel&&!new RegExp('^%'+item.prefixLabel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s|$)','u').test(text))text='%'+item.prefixLabel+' '+text;
  if(item.image)text='!['+text+']('+item.image+')';
  else if(item.url&&text!==item.url)text='['+text+']('+item.url+')';
  else if(item.url)text=item.url;
  const prefix=item.type==='group'?'## ':item.type==='bullet'?'- ':hideTaskPrefix&&item.type==='todo'?'':!hideTaskPrefix&&item.status==='removed'?'- [-] ':item.type==='todo'?(item.status==='done'?'- [x] ':'- [ ] '):item.type==='text'?'> ':'';
  const tokens=[];
  const peopleText=[item.owner,...(item.people||'').split(/[,，]\s*/)].filter(Boolean);
  tokens.push(...peopleText.filter(name=>!hasPerson(text,name)).map(name=>'@'+quote(name)));
  if(item.tags)tokens.push(...item.tags.split(/[,，]\s*/).filter(Boolean).map(tag=>'#'+tag));
  if(item.priority==='high')tokens.push('!');
  if(item.priority==='urgent')tokens.push('!!');
  if(['doing','waiting'].includes(item.status))tokens.push('~'+item.status);
  if(item.type==='group'&&item.signature)tokens.push('sig:'+item.signature);
  if(item.type==='group'&&item.tone)tokens.push('tone:'+item.tone);
  for(const [key,label] of [['dueDate','due'],['planDate','plan'],['followupDate','follow'],['stage','stage']])if(item[key])tokens.push(label+':'+quote(item[key]));
  for(const [key,value] of Object.entries(item.custom||{}))if(String(value))tokens.push(key+'::'+quote(String(value)));
  for(const [key,prefix] of [['dependencies','after:'],['related','']])for(const id of item[key]||[]){const title=entries.find(entry=>entry.id===id)?.title;if(title)tokens.push(prefix+'[['+title+']]');}
  return prefix+text+(tokens.length?' '+tokens.join(' '):'')+(item.content?'\n'+item.content:'');
}

export function treeRows(entries,domain){
  const list=entries.filter(item=>item.domain===domain).sort((a,b)=>(a.position??-1)-(b.position??-1)||(a.createdAt||'').localeCompare(b.createdAt||''));
  const ids=new Set(list.map(item=>item.id)),children=new Map(),result=[],seen=new Set();
  for(const item of list){const key=item.parentId||'';if(!children.has(key))children.set(key,[]);children.get(key).push(item);}
  function append(item,depth){if(seen.has(item.id))return;seen.add(item.id);result.push({item,depth});for(const child of children.get(item.id)||[])append(child,depth+1);}
  for(const item of list.filter(item=>!ids.has(item.parentId)))append(item,0);
  for(const item of list)if(!seen.has(item.id))append(item,0);
  return result;
}

// Positions are scoped to one visible list. WORK has two independent lists even
// though their rows share the same domain, so legacy rows may contain duplicate
// numbers across panes. Append past every sibling to keep new rows at the end.
export function nextPosition(entries,{domain,parentId='',workPane=''}){
  const visible=entries.filter(item=>!item.archivedAt);
  const panes=domain==='Work'?workPaneMap(visible):null,pane=workPane==='right'?'right':'left';
  return Math.max(-1,...visible.filter(item=>item.domain===domain&&(item.parentId||'')===(parentId||'')&&(domain!=='Work'||(panes.get(item.id)||'left')===pane)).map(item=>Number.isFinite(item.position)?item.position:-1))+1;
}

// Old rows did not store a pane. Assign every root (and its whole subtree) a
// stable default, while always letting a parent's pane win for its children.
export function workPaneMap(entries,rows=treeRows(entries,'Work')){
  const byId=new Map(entries.map(item=>[item.id,item]));
  const roots=rows.filter(({depth})=>depth===0).map(({item})=>item);
  const defaults=new Map(roots.map((item,index)=>[item.id,index<Math.ceil(roots.length/2)?'left':'right']));
  const panes=new Map(),rootFor=new Map();
  for(const {item} of rows){
    const parent=byId.get(item.parentId);
    const parentPane=parent?.domain==='Work'?panes.get(parent.id):'';
    const root=parent?.domain==='Work'&&rootFor.has(parent.id)?rootFor.get(parent.id):item.id;
    rootFor.set(item.id,root);
    const ownPane=item.workPane==='left'||item.workPane==='right'?item.workPane:'';
    panes.set(item.id,parentPane||ownPane||defaults.get(root)||'left');
  }
  return panes;
}

// Renumber every visible list from zero without touching metadata. The order
// comes from treeRows, so parent/child rendering and sibling order stay intact.
export function compactEntryPositions(entries){
  const visible=entries.filter(item=>!item.archivedAt);
  const panes=workPaneMap(visible);
  const positions=new Map();
  for(const domain of new Set(visible.map(item=>item.domain))){
    const counters=new Map();
    for(const {item} of treeRows(visible,domain)){
      const key=domain+'\u0000'+(domain==='Work'?panes.get(item.id)||'left':'')+'\u0000'+(item.parentId||'');
      const position=counters.get(key)||0;
      positions.set(item.id,position);
      counters.set(key,position+1);
    }
  }
  return entries.map(item=>{
    if(item.archivedAt)return item;
    const position=positions.get(item.id);
    return position===undefined||item.position===position?item:{...item,position};
  });
}

// Persist the computed Work pane on every row, including descendants, before
// compacting positions. Running this again produces the same layout.
export function normalizeEntryLayout(entries){
  const panes=workPaneMap(entries);
  const withPanes=entries.map(item=>{
    if(item.domain!=='Work')return item;
    const workPane=panes.get(item.id)||'left';
    return item.workPane===workPane?item:{...item,workPane};
  });
  return compactEntryPositions(withPanes);
}

// Move a whole subtree; siblings retain their order and children retain their parent.
export function moveEntries(entries,{id,targetId,domain,placement,workPane},panes=workPaneMap(entries)){
  const source=entries.find(item=>item.id===id),target=entries.find(item=>item.id===targetId);
  if(!source||!domains.includes(domain)||!['before','after','inside','end'].includes(placement))throw new Error('移动位置无效');
  if(placement!=='end'&&(!target||target.domain!==domain))throw new Error('目标条目不存在');
  const descendants=new Set([id]);
  function collect(parent){for(const item of entries.filter(item=>item.parentId===parent)){if(descendants.has(item.id))throw new Error('父子关系存在循环');descendants.add(item.id);collect(item.id);}}
  collect(id);
  if(descendants.has(targetId))throw new Error('不能移到自己或自己的子条目中');
  const parentId=placement==='inside'?targetId:placement==='end'?'':target.parentId||'';
  const destinationPane=domain==='Work'?(placement==='end'?(workPane==='right'?'right':'left'):panes.get(target.id)||'left'):'';
  const inDestinationPane=item=>domain!=='Work'||panes.get(item.id)===destinationPane;
  const siblingIds=treeRows(entries,domain).map(row=>row.item).filter(item=>!item.archivedAt&&!descendants.has(item.id)&&(item.parentId||'')===parentId&&inDestinationPane(item)).map(item=>item.id);
  let index=placement==='inside'||placement==='end'?siblingIds.length:siblingIds.indexOf(targetId)+(placement==='after'?1:0);
  siblingIds.splice(index,0,id);
  const next=entries.map(item=>{
    if(!siblingIds.includes(item.id)&&!descendants.has(item.id))return item;
    const nextParent=item.id===id?parentId:item.parentId;
    return {...item,...(descendants.has(item.id)?{domain,...(domain==='Work'?{workPane:destinationPane}:{})}:{}),...(item.id===id?{parentId:nextParent}:{}),...(siblingIds.includes(item.id)?{position:siblingIds.indexOf(item.id)}:{})};
  });
  return next;
}
