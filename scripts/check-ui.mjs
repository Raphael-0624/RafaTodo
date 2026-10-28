import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {treeRows,workPaneMap} from '../src/lib/entries.js';

const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const start=source.indexOf('  function renderTree('),end=source.indexOf('  function paneOf(',start);
assert.ok(start>=0&&end>start);
const {code}=await transformWithOxc(source.slice(start,end),'tree-test.jsx',{jsx:{runtime:'classic'}});
const renderTreeFor=items=>new Function('React','items','indexes','draft','row','editor','treeRows',code+';return renderTree;')(
  React,items,{workRows:treeRows(items,'Work'),workPanes:workPaneMap(items)},null,
  item=>React.createElement('div',{'data-id':item.id},item.title),()=>null,treeRows
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
console.log('PASS: ordinary and grouped subtree collapse across all columns');
