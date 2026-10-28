import {domains,moveEntries,treeRows} from './entries.js';

export function selectedSubtrees(entries,ids){
  const selected=new Set(ids),byId=new Map(entries.map(item=>[item.id,item]));
  const roots=domains.flatMap(domain=>treeRows(entries.filter(item=>!item.archivedAt),domain))
    .map(({item})=>item).filter(item=>{
      if(!selected.has(item.id))return false;
      const seen=new Set([item.id]);let parent=byId.get(item.parentId);
      while(parent){
        if(selected.has(parent.id))return false;
        if(seen.has(parent.id))throw new Error('父子关系存在循环');
        seen.add(parent.id);parent=byId.get(parent.parentId);
      }
      return true;
    });
  const affected=new Set(roots.map(item=>item.id));
  let changed=true;
  while(changed){changed=false;for(const item of entries)if(!item.archivedAt&&affected.has(item.parentId)&&!affected.has(item.id)){affected.add(item.id);changed=true;}}
  return {roots,affected};
}

export function batchMoveEntries(entries,ids,domain,workPane){
  if(!domains.includes(domain)||(domain==='Work'&&!['left','right'].includes(workPane)))throw new Error('请选择目标栏目');
  const {roots,affected}=selectedSubtrees(entries,ids);
  let next=entries;
  for(const item of roots)next=moveEntries(next,{id:item.id,domain,workPane,placement:'end'});
  return {items:next,roots,affected};
}

export function dropPlacement({x,y,left,top,height,allowInside=true}){
  const portion=(y-top)/Math.max(1,height);
  if(allowInside&&portion>=.3&&portion<=.7&&x>=left+44)return 'inside';
  return portion<.5?'before':'after';
}

export function pastedLines(value){
  return String(value).replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean);
}
