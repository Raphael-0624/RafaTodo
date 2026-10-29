export function focusElapsed(focus,id,now=Date.now()){
  const elapsed=focus?.elapsed?.[id]||0;
  return elapsed+(focus?.activeId&&focus.activeId===id&&Number.isFinite(focus.runningSince)?Math.max(0,now-focus.runningSince):0);
}

export function focusClock(milliseconds){
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
}

export function focusDuration(milliseconds){
  const seconds=Math.max(0,Math.floor(milliseconds/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return (hours?hours+'时':'')+(minutes?minutes+'分':'')+rest+'秒';
}
