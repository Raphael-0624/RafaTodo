import React,{useEffect,useRef,useState} from 'react';

export function TaskDialog({title,onClose,onAfterClose,busy=false,children}){
  const dialog=useRef(null),titleId=React.useId();
  useEffect(()=>{
    const node=dialog.current;
    const returnFocus=document.activeElement;
    if(!node.open)node.showModal();
    return()=>{
      if(node.open)node.close();
      if(onAfterClose)onAfterClose();
      else if(returnFocus instanceof HTMLElement&&returnFocus.isConnected)returnFocus.focus();
    };
  },[]);
  return <dialog className="task-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClick={event=>event.stopPropagation()}>
    <header className="task-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}

export function LoopHistoryDialog({item,onClose}){
  const [history,setHistory]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const abort=useRef(null),inflight=useRef(false);
  async function load(offset=0){
    if(inflight.current)return;
    inflight.current=true;setLoading(true);setError('');
    const controller=new AbortController();abort.current=controller;
    try{
      const response=await fetch('/api/entries/'+encodeURIComponent(item.id)+'/loop-history?offset='+offset,{signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'读取记录失败');
      if(!controller.signal.aborted)setHistory(previous=>({...data,records:offset?[...(previous?.records||[]),...data.records]:data.records}));
    }catch(error){if(error.name!=='AbortError')setError(error.message);}
    finally{inflight.current=false;if(!controller.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{load();return()=>abort.current?.abort();},[]);
  const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:history.timeZone,hour12:false});
  const periodLabel=record=>{
    if(record.loop==='day')return record.period;
    const end=new Date(record.period+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);
    return record.period+' — '+end.toISOString().slice(0,10);
  };
  return <TaskDialog title="循环完成记录" onClose={onClose}>
    <div className="task-dialog-body"><p className="dialog-task-title">{item.title}</p>
      {history&&<p className="dialog-hint">累计 {history.total} 次 · 时区 {history.timeZone}</p>}
      {error&&<p role="alert" className="dialog-error">{error} <button onClick={()=>load(history?.nextOffset||0)}>重试</button></p>}
      {!history&&loading&&<p role="status">正在读取…</p>}
      {history?.total===0&&<p className="dialog-empty">还没有完成记录，手动完成后会显示在这里。</p>}
      <ol className="loop-history-list">{history?.records.map(record=><li key={record.loop+record.period}><span className={'loop-history-kind '+record.loop}>{record.loop==='day'?'每日':'每周'}</span><div><strong>{periodLabel(record)}</strong><time dateTime={record.completedAt}>{stamp(record.completedAt)} 完成</time></div></li>)}</ol>
      {history?.nextOffset!==null&&history?.nextOffset!==undefined&&<button className="dialog-secondary" disabled={loading} onClick={()=>load(history.nextOffset)}>{loading?'读取中…':'加载更早记录'}</button>}
    </div>
  </TaskDialog>;
}
