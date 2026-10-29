import React,{createContext,useContext,useEffect,useRef,useState} from 'react';

const ImagePreviewContext=createContext(()=>{});

export function PreviewImage({src,alt='',className}){
  const preview=useContext(ImagePreviewContext);
  function open(event){
    event.stopPropagation();
    event.currentTarget.focus({preventScroll:true});
    preview({src,alt});
  }
  return <img src={src} alt={alt} className={className} draggable={false} role="button" tabIndex={0} aria-label={'查看大图：'+alt} onPointerDown={event=>event.stopPropagation()} onClick={open} onKeyDown={event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();open(event);}
  }}/>;
}

function ImageViewer({image,onClose}){
  const dialog=useRef(null);
  useEffect(()=>{
    const node=dialog.current,previous=document.activeElement;
    node.showModal();
    return()=>{node.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <dialog ref={dialog} className="image-viewer" aria-label="图片大图预览" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onClose();}
  }} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose();}}>
    <button className="image-viewer-close" type="button" aria-label="关闭图片预览" autoFocus onClick={onClose}>×</button>
    <img className="image-viewer-image" src={image.src} alt={image.alt} draggable={false}/>
  </dialog>;
}

export function ImagePreviewProvider({children}){
  const [image,setImage]=useState(null);
  return <ImagePreviewContext.Provider value={setImage}>{children}{image&&<ImageViewer image={image} onClose={()=>setImage(null)}/>}</ImagePreviewContext.Provider>;
}
