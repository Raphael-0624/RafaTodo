export const defaultLayout={workHeight:65,dailyEnd:100/3,lifeEnd:200/3};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const number=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;

export function normalizeLayout(value){
  const dailyEnd=clamp(number(value?.dailyEnd,defaultLayout.dailyEnd),15,70);
  return {
    workHeight:clamp(number(value?.workHeight,defaultLayout.workHeight),30,80),
    dailyEnd,
    lifeEnd:clamp(number(value?.lifeEnd,defaultLayout.lifeEnd),dailyEnd+15,85)
  };
}

export function dividerBounds(layout,axis){
  if(axis==='workHeight')return {min:30,max:80};
  if(axis==='dailyEnd')return {min:15,max:layout.lifeEnd-15};
  return {min:layout.dailyEnd+15,max:85};
}

export function moveDivider(layout,axis,value){
  const {min,max}=dividerBounds(layout,axis);
  return {...layout,[axis]:clamp(number(value,layout[axis]),min,max)};
}
