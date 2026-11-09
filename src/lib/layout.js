import {domains,workPanes} from './entries.js';

export const defaultLayout={active:'Work',columns:{Work:3,Daily:1,Life:1,'Glean & Idea':1}};

export function normalizeLayout(value){
  return {
    active:domains.includes(value?.active)?value.active:defaultLayout.active,
    columns:Object.fromEntries(domains.map(domain=>[domain,[1,2,3].includes(value?.columns?.[domain])?value.columns[domain]:defaultLayout.columns[domain]]))
  };
}

export function cycleColumns(layout,domain){
  if(!domains.includes(domain))return layout;
  return {...layout,columns:{...layout.columns,[domain]:layout.columns[domain]%3+1}};
}

// Folding is presentation only: append hidden lanes to the last visible lane.
export function visiblePanes(count,pane){
  const index=workPanes.indexOf(pane);
  return index===count-1?workPanes.slice(index):[pane];
}
