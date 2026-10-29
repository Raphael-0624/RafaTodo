import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {treeRows,workPaneMap,moveEntries,nextPosition,normalizeEntryLayout} from '../src/lib/entries.js';
import {defaultLayout,normalizeLayout,moveDivider} from '../src/lib/layout.js';
import {selectedSubtrees,batchMoveEntries,dropPlacement,pastedLines} from '../src/lib/interactions.js';

const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
assert.deepEqual(normalizeLayout(null),defaultLayout);
assert.deepEqual(normalizeLayout({workHeight:Infinity,dailyEnd:'20',lifeEnd:NaN}),defaultLayout);
assert.deepEqual(normalizeLayout({workHeight:100,dailyEnd:100,lifeEnd:0}),{workHeight:80,dailyEnd:70,lifeEnd:85});
assert.equal(moveDivider(defaultLayout,'workHeight',0).workHeight,30);
assert.equal(moveDivider(defaultLayout,'dailyEnd',100).dailyEnd,defaultLayout.lifeEnd-15);
assert.equal(moveDivider(defaultLayout,'lifeEnd',0).lifeEnd,defaultLayout.dailyEnd+15);
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
  React,items,{workRows:treeRows(items,'Work'),workPanes:workPaneMap(items)},null,
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
console.log('PASS: subtree collapse, batch subtree selection, drop zones and markers, multiline splitting, clickable loop labels');
