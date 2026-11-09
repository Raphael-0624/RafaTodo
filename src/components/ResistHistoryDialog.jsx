import React,{useEffect,useRef,useState} from 'react';
import {TaskDialog} from './TaskDialogs.jsx';

export function ResistHistoryDialog({item,onClose,onDelete,busy}){
  const [history,setHistory]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef(null),sequence=useRef(0);
  async function load(offset=0){
    request.current?.abort();
    const controller=new AbortController(),version=++sequence.current;request.current=controller;
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/entries/'+encodeURIComponent(item.id)+'/resist-records?offset='+offset,{signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'读取记录失败');
      if(version===sequence.current)setHistory(previous=>({...data,records:offset?[...(previous?.records||[]),...data.records]:data.records}));
    }catch(error){if(error.name!=='AbortError'&&version===sequence.current)setError(error.message);}
    finally{if(version===sequence.current)setLoading(false);}
  }
  useEffect(()=>{load();return()=>{sequence.current++;request.current?.abort();};},[item.id,item.resistTotal,item.resistToday]);
  const groups=new Map();
  for(const record of history?.records||[]){if(!groups.has(record.date))groups.set(record.date,[]);groups.get(record.date).push(record);}
  return <TaskDialog title="克制打卡记录" onClose={onClose} busy={busy}>
    <div className="task-dialog-body"><p className="dialog-task-title">{item.title}</p>
      <p className="dialog-hint">今日 {item.resistToday||0} 次 · 累计 {item.resistTotal||0} 次 · 上海时区</p>
      {error&&<p className="dialog-error" role="alert">{error} <button onClick={()=>load()}>重试</button></p>}
      {loading&&!history&&<p role="status">正在读取…</p>}
      {history&&!history.records.length&&!loading&&<p className="dialog-empty">每一次成功克制都值得记录，点 +1 开始。</p>}
      {[...groups].map(([date,records])=><section className="resist-history-day" key={date}><h3>{date}</h3><ul>{records.map(record=><li key={record.id}>
        <time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</time><span>克制成功 +1</span>
        <button disabled={busy||loading} aria-label={'删除打卡记录 '+record.recordedAt} onClick={()=>onDelete(item,record.id)}>删除</button>
      </li>)}</ul></section>)}
      {history?.nextOffset!=null&&<button className="dialog-secondary" disabled={loading||busy} onClick={()=>load(history.nextOffset)}>{loading?'读取中…':'加载更早记录'}</button>}
    </div>
  </TaskDialog>;
}
