import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {domains,treeRows,workPaneMap,domainPaneMap,moveEntries,nextPosition,normalizeEntryLayout} from '../src/lib/entries.js';
import {defaultLayout,normalizeLayout,cycleColumns,visiblePanes} from '../src/lib/layout.js';
import {selectedSubtrees,batchMoveEntries,dropPlacement,pastedLines} from '../src/lib/interactions.js';

const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
for(const name of ['sketch-rule','sketch-divider']){
  const svg=readFileSync(new URL('../public/'+name+'.svg',import.meta.url),'utf8');
  assert.equal((svg.match(/<path\b/g)||[]).length,1,'Separators have one curved stroke without a shadow line');
}
assert.deepEqual(normalizeLayout(null),defaultLayout);
assert.deepEqual(normalizeLayout({workHeight:Infinity,dailyEnd:'20',lifeEnd:NaN}),defaultLayout);
assert.deepEqual(normalizeLayout({active:'unknown',columns:{Work:0,Daily:'2',Life:Infinity}}),defaultLayout);
assert.deepEqual(normalizeLayout({active:'Life',columns:{Daily:2}}),{active:'Life',columns:{Work:3,Daily:2,Life:1,'Glean & Idea':1}});
for(const domain of domains){
  let layout=normalizeLayout();
  const original=layout.columns[domain];
  for(let i=0;i<3;i++)layout=cycleColumns(layout,domain);
  assert.equal(layout.columns[domain],original);
  assert.deepEqual(layout,defaultLayout);
}
assert.deepEqual(visiblePanes(1,'left'),['left','right','third']);
assert.deepEqual(visiblePanes(2,'left'),['left']);
assert.deepEqual(visiblePanes(2,'right'),['right','third']);
assert.deepEqual(visiblePanes(3,'right'),['right']);
const thirdItems=[
  {id:'left',domain:'Work',workPane:'left',position:0},
  {id:'right',domain:'Work',workPane:'right',position:0},
  {id:'third',domain:'Work',workPane:'third',position:0},
  {id:'child',domain:'Work',parentId:'third',workPane:'left',position:0}
];
assert.equal(workPaneMap(thirdItems).get('child'),'third');
assert.equal(nextPosition(thirdItems,{domain:'Work',workPane:'third'}),1);
assert.deepEqual(normalizeEntryLayout(thirdItems).map(item=>item.workPane),['left','right','third','third']);
const toThird=moveEntries(thirdItems,{id:'right',domain:'Work',workPane:'third',placement:'end'});
assert.equal(toThird.find(item=>item.id==='right').workPane,'third');
assert.equal(toThird.find(item=>item.id==='left').workPane,'left');
const start=source.indexOf('  function renderTree('),end=source.indexOf('  function paneOf(',start);
assert.ok(start>=0&&end>start);
const {code}=await transformWithOxc(source.slice(start,end),'tree-test.jsx',{jsx:{runtime:'classic'}});
const renderTreeFor=(items,drop=null)=>new Function('React','items','indexes','draft','row','editor','treeRows','drop',code+';return renderTree;')(
  React,items,{rows:new Map(domains.map(domain=>[domain,treeRows(items,domain)])),panes:new Map(domains.flatMap(domain=>[...domainPaneMap(items,domain)]))},null,
  item=>React.createElement('div',{'data-id':item.id},item.title),()=>null,treeRows,drop
);
for(const domain of ['Work','Daily','Life','Glean & Idea']){
  for(const type of ['todo','group','text']){
    const items=[
      {id:'parent',title:'parent',domain,type,workPane:'left',collapsed:true},
      {id:'child',title:'child',domain,type:'todo',parentId:'parent',workPane:'left'},
      {id:'grandchild',title:'grandchild',domain,type:'todo',parentId:'child',workPane:'left'},
      {id:'sibling',title:'sibling',domain,type:'todo',workPane:'left'}
    ];
    const render=()=>renderToStaticMarkup(React.createElement(React.Fragment,null,renderTreeFor(items)(domain,'left')));
    let markup=render();
    assert.ok(markup.includes('data-id="parent"'));
    assert.ok(markup.includes('data-id="sibling"'));
    assert.ok(!markup.includes('data-id="child"'));
    assert.ok(!markup.includes('data-id="grandchild"'));
    items[0].collapsed=false;
    markup=render();
    assert.ok(markup.includes('data-id="child"'));
    assert.ok(markup.includes('data-id="grandchild"'));
    items[1].collapsed=true;
    assert.ok(!render().includes('data-id="grandchild"'));
  }
}
for(const domain of domains){
  const items=thirdItems.map(item=>({...item,domain,title:item.id,type:'todo'}));
  const before=JSON.stringify(items),panes=domainPaneMap(items,domain);
  assert.equal(panes.get('child'),'third');
  for(const count of [1,2,3]){
    const markup=renderToStaticMarkup(React.createElement(React.Fragment,null,['left','right','third'].slice(0,count).flatMap(pane=>visiblePanes(count,pane).map(source=>renderTreeFor(items)(domain,source)))));
    for(const item of items)assert.equal(markup.split('data-id="'+item.id+'"').length-1,1,'Every task renders exactly once when folding '+domain);
    assert.equal(JSON.stringify(items),before,'View changes never mutate lane or parent data');
  }
}
const fixtures=[
  {id:'parent',title:'parent',type:'todo',domain:'Work',workPane:'right',position:0},
  {id:'child',title:'child',type:'todo',domain:'Work',parentId:'parent',workPane:'right',position:0},
  {id:'sibling',title:'sibling',type:'todo',domain:'Work',workPane:'left',position:0}
];
assert.deepEqual(selectedSubtrees(fixtures,['parent','child']).roots.map(item=>item.id),['parent']);
assert.deepEqual([...selectedSubtrees(fixtures,['parent','child']).affected],['parent','child']);
const moved=batchMoveEntries(fixtures,['parent','child'],'Life');
assert.equal(moved.items.find(item=>item.id==='child').parentId,'parent');
assert.equal(moved.items.find(item=>item.id==='parent').domain,'Life');
assert.equal(moved.items.find(item=>item.id==='child').domain,'Life');
assert.equal(fixtures[0].domain,'Work');
assert.throws(()=>batchMoveEntries(fixtures,['parent'],'Work','invalid'));
assert.ok(renderToStaticMarkup(React.createElement(React.Fragment,null,renderTreeFor(fixtures,{targetId:'parent',placement:'after'})('Work','right'))).includes('branch-drop-after'));
for(const [x,y,expected] of [[100,5,'before'],[100,95,'after'],[100,50,'inside'],[5,45,'before'],[5,55,'after']])assert.equal(dropPlacement({x,y,left:0,top:0,height:100}),expected);
assert.equal(dropPlacement({x:100,y:50,left:0,top:0,height:100,allowInside:false}),'after');
assert.equal(dropPlacement({x:140,y:50,left:100,top:0,height:100}),'after');
assert.deepEqual(pastedLines(' one\r\n\r\n two\rthree\n'),['one','two','three']);
assert.deepEqual(pastedLines(' \n '),[]);

const labelStart=source.indexOf('function LoopLabel('),labelEnd=source.indexOf('function ArchiveModal(',labelStart);
const labelCode=(await transformWithOxc(source.slice(labelStart,labelEnd),'label-test.jsx',{jsx:{runtime:'classic'}})).code;
const LoopLabel=new Function('React',labelCode+';return LoopLabel;')(React);
for(const [loop,label] of [['day','每日'],['week','每周']]){
  const markup=renderToStaticMarkup(React.createElement(LoopLabel,{item:{type:'todo',loop,loopCompletedCount:5},onHistory(){}}));
  assert.ok(markup.includes('<button'));
  assert.ok(markup.includes(label+' | 5次'));
  assert.ok(markup.includes('查看完成记录'));
}
console.log('PASS: drawer settings, per-domain lanes, non-mutating folded views, subtree collapse, batch selection, drop zones, paste and labels');
