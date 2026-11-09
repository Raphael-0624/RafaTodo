import React from 'react';
import {TaskDialog} from './TaskDialogs.jsx';
import {syntaxSections} from '../lib/cheatsheet.js';

export function CheatSheetDialog({onClose}){
  return <TaskDialog title="CheatSheet · 语法速查" className="cheatsheet-dialog" onClose={onClose}>
    <div className="task-dialog-body cheatsheet-body">
      <p className="cheatsheet-note">用于各分类的“写一条”和条目编辑框；INBOX 为 AI 收集入口。元数据之间用空格分隔，含空格的值使用英文双引号。</p>
      <table className="cheatsheet-table">
        <thead><tr><th scope="col">语法</th><th scope="col">一句话说明</th></tr></thead>
        {syntaxSections.map(section=><tbody key={section.title}>
          <tr className="cheatsheet-section"><th colSpan="2" scope="rowgroup">{section.title}</th></tr>
          {section.rows.map(([syntax,description])=><tr key={syntax}><th scope="row"><code>{syntax}</code></th><td>{description}</td></tr>)}
        </tbody>)}
      </table>
    </div>
  </TaskDialog>;
}
