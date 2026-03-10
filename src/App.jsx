import { useState, useRef, useEffect, useMemo, memo, useCallback } from "react";

// ══════ 초성 검색 + 특수 검색어 ══════
const CHOSUNG=["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function isChosungOnly(s){return s.length>0&&[...s].every(c=>CHOSUNG.includes(c)||/[^가-힣]/.test(c));}
function toChosung(s){return[...s].map(c=>{const n=c.charCodeAt(0)-0xAC00;return(n>=0&&n<=11171)?CHOSUNG[Math.floor(n/588)]:c;}).join("");}

const dispName=i=>i.colorCat?`${i.name} - ${i.colorCat}`:i.name;

// 된소리 매핑: 평음 초성 → 해당 된소리 포함 그룹
const TENSED={
  "ㄱ":["ㄱ","ㄲ"], "ㄴ":["ㄴ"], "ㄷ":["ㄷ","ㄸ"], "ㄹ":["ㄹ"],
  "ㅁ":["ㅁ"], "ㅂ":["ㅂ","ㅃ"], "ㅅ":["ㅅ","ㅆ"], "ㅇ":["ㅇ"],
  "ㅈ":["ㅈ","ㅉ"], "ㅊ":["ㅊ"], "ㅋ":["ㅋ"], "ㅌ":["ㅌ"], "ㅍ":["ㅍ"], "ㅎ":["ㅎ"],
};

// 특수 검색어 파싱: "[숫자만]", "[영어만]", "[자음ㄱ만]" 등
function parseSpecialQuery(q){
  const m=q.match(/^\[(.+)만\]$/);
  if(!m)return null;
  const key=m[1];
  if(key==="숫자")return {type:"digit"};
  if(key==="영어")return {type:"alpha"};
  const jaum=key.replace("자음","");
  if(TENSED[jaum])return {type:"jaum", group:TENSED[jaum]};
  return null;
}

function itemMatchesSpecial(item, spec){
  // ★ 첫 글자 기준으로만 판단
  const first=(item.name||"").trimStart()[0]||"";
  if(spec.type==="digit")  return /[0-9０-９]/.test(first);
  if(spec.type==="alpha")  return /[a-zA-Zａ-ｚＡ-Ｚ]/.test(first);
  if(spec.type==="jaum"){
    // 한글이면 초성 추출, 아니면 그대로
    const fc=toChosung(first);
    return spec.group.includes(fc);
  }
  return false;
}

function matchSearch(t,q){if(!q)return true;if(t.toLowerCase().includes(q.toLowerCase()))return true;if(isChosungOnly(q))return toChosung(t).includes(q);return false;}

// 항목 전체 필터 (일반 검색 + 특수 검색어)
function itemMatchesQuery(item, query){
  if(!query)return true;
  // 복합 쿼리 지원: "[숫자만] [영어만]" 등 여러 태그 동시 적용
  const parts=query.trim().split(/\s+/);
  return parts.every(part=>{
    if(part==="[습득]") return item.acquired===true;
    if(part==="[미습득]") return item.acquired===false;
    const spec=parseSpecialQuery(part);
    if(spec)return itemMatchesSpecial(item, spec);
    const fields=[dispName(item), item.note||"", item.category||""];
    return fields.some(f=>matchSearch(f, part));
  });
}

// ══════ 스토리지 ══════
// 이미지: Cloudinary (클라우드, 용량 무제한)
// 텍스트: localStorage (수KB 수준, 문제없음)
const SK="my_catalog_v1";
const OLD_KEYS=["catalog_v9","catalog_v8","catalog_all_v7","catalog_all_v6"];

// Cloudinary 설정 저장/불러오기
const CK="my_catalog_cloudinary";
function getCdnConfig(){
  try{const v=localStorage.getItem(CK);return v?JSON.parse(v):null;}catch{return null;}
}
function setCdnConfig(cfg){
  try{localStorage.setItem(CK,JSON.stringify(cfg));}catch{}
}

// Cloudinary 이미지 업로드
// image: File 객체 → Cloudinary URL 반환
async function uploadToCloudinary(file, config){
  const fd=new FormData();
  fd.append("file", file);
  fd.append("upload_preset", config.uploadPreset);
  fd.append("folder", "catalog_app");
  const res=await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,{method:"POST",body:fd});
  if(!res.ok)throw new Error("업로드 실패");
  const data=await res.json();
  return data.secure_url; // https://res.cloudinary.com/... URL 반환
}

// Cloudinary 이미지 삭제 (Public ID 필요)
// URL에서 public_id 추출: .../catalog_app/파일명.jpg → catalog_app/파일명
function getPublicId(url){
  try{
    const m=url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    return m?m[1]:null;
  }catch{return null;}
}
async function deleteFromCloudinary(url, config){
  // 클라이언트에서 직접 삭제는 서명 필요 → 무시 (Cloudinary 대시보드에서 정리)
  // 실용적으로 URL만 제거하는 것으로 처리
  return;
}

function lsGet(fb){
  try{
    let v=localStorage.getItem(SK)||sessionStorage.getItem(SK);
    if(v)return JSON.parse(v);
    for(const k of OLD_KEYS){
      v=localStorage.getItem(k)||sessionStorage.getItem(k);
      if(v){const parsed=JSON.parse(v);lsSet(parsed);return parsed;}
    }
    return fb;
  }catch{return fb;}
}
function lsSet(v){
  // 이미지는 Cloudinary URL(문자열)이므로 그대로 저장해도 가벼움
  const s=JSON.stringify(v);
  try{localStorage.setItem(SK,s);}catch{}
  try{sessionStorage.setItem(SK,s);}catch{}
}
async function wsGet(){
  try{
    if(typeof window.storage?.get!=="function")return null;
    const r=await window.storage.get(SK,true);
    return r?.value?JSON.parse(r.value):null;
  }catch{return null;}
}
async function wsSet(v){
  try{
    if(typeof window.storage?.set==="function")
      await window.storage.set(SK,JSON.stringify(v),true);
  }catch{}
}

// ══════ 기본값 ══════
const DEF_CC=[
  {name:"레드",hex:"#e05050"},
  {name:"오렌지",hex:"#e8873a"},
  {name:"옐로",hex:"#d4b800"},
  {name:"그린",hex:"#4a9e6a"},
  {name:"블루",hex:"#4a7ec9"},
  {name:"퍼플",hex:"#8860c8"},
  {name:"블랙",hex:"#333333"},
  {name:"화이트",hex:"#bbbbbb"},
  {name:"그레이",hex:"#888888"},
  {name:"브라운",hex:"#8b5e3c"},
  {name:"라이트브라운",hex:"#c49a6c"},
  {name:"다크브라운",hex:"#5c3317"},
  {name:"체리",hex:"#8b1a2a"},
  {name:"내추럴우드",hex:"#b5895a"},
  {name:"라이트우드",hex:"#d4b896"},
  {name:"다크우드",hex:"#4a2e1a"},
  {name:"골드",hex:"#c9a84c"},
  {name:"실버",hex:"#a8a8a8"},
  {name:"퓨어화이트",hex:"#f5f5f5"},
  {name:"내추럴",hex:"#d6c9a8"},
  {name:"아이보리",hex:"#f5f0e0"},
  {name:"라이트블루",hex:"#89b4d9"},
  {name:"월넛",hex:"#5c4033"},
];
const DEF_CATS=["수집품","도서","의류","전자기기","기타","중복"];
const DEF_ITEMS=[{id:1,name:"빈티지 카메라",category:"수집품",colorCat:"블랙",acquired:true,quantity:1,date:"2024-01-10",image:null,note:"Leica M3",price:0},{id:2,name:"디자인 패턴",category:"도서",colorCat:"",acquired:false,quantity:2,date:"2024-02-15",image:null,note:"Gang of Four",price:0},{id:3,name:"레더 재킷",category:"의류",colorCat:"브라운",acquired:true,quantity:1,date:"2024-03-01",image:null,note:"빈티지 스타일",price:0}];
const DEF_STATE={items:DEF_ITEMS,categories:DEF_CATS,colorCats:DEF_CC,settings:{photoMode:false,viewMode:"이미지형",gridCols:3,sortBy:"date-desc"}};
const SORT_OPTS=[{v:"date-desc",l:"최근 추가순"},{v:"date-asc",l:"오래된순"},{v:"name-asc",l:"이름 ↑"},{v:"name-desc",l:"이름 ↓"},{v:"category-name-asc",l:"카테고리→이름 ↑"},{v:"category-name-desc",l:"카테고리→이름 ↓"},{v:"acquired-first",l:"습득 먼저"},{v:"not-acquired-first",l:"미습득 먼저"}];
const GRID_COLS=[2,3,4,5,6];
const getHex=(cc,n)=>cc.find(c=>c.name===n)?.hex||"#aaa";

// ══════ 이미지 압축 + Cloudinary 업로드 ══════
function compressAndUpload(file, config, onProgress){
  return new Promise((resolve, reject)=>{
    const r=new FileReader();
    r.onerror=()=>reject(new Error("파일 읽기 실패"));
    r.onload=e=>{
      const img=new window.Image();
      img.onerror=()=>reject(new Error("이미지 로드 실패"));
      img.onload=async()=>{
        try{
          const MAX=1200;
          let w=img.width, h=img.height;
          if(w>MAX||h>MAX){if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
          const cv=document.createElement("canvas");
          cv.width=w; cv.height=h;
          const ctx=cv.getContext("2d");
          ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
          const base64=cv.toDataURL("image/jpeg",0.85);

          // base64 → Cloudinary 업로드
          const fd=new FormData();
          fd.append("file", base64);
          fd.append("upload_preset", config.uploadPreset);
          fd.append("folder", "catalog_app");
          const res=await fetch(
            `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
            {method:"POST", body:fd}
          );
          if(!res.ok)throw new Error("업로드 실패 ("+res.status+")");
          const data=await res.json();
          resolve(data.secure_url);
        }catch(err){reject(err);}
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
  });
}

// ══════ Cloudinary 설정 UI ══════
function CloudinarySetup({onSave}){
  const [cloudName,setCloudName]=useState("");
  const [uploadPreset,setUploadPreset]=useState("");
  const [err,setErr]=useState("");
  const IS2={width:"100%",padding:"10px 12px",borderRadius:8,border:"2px solid #dddddd",background:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",color:"#222222",boxSizing:"border-box",marginBottom:10};

  function handleSave(){
    const cn=cloudName.trim();
    const up=uploadPreset.trim();
    if(!cn||!up){setErr("Cloud Name과 Upload Preset을 모두 입력해주세요");return;}
    setErr("");
    onSave({cloudName:cn,uploadPreset:up});
  }

  return(
    <div style={{fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif",minHeight:"100vh",background:"#f8f8f8",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff8f0",borderRadius:16,padding:"28px 22px",maxWidth:420,width:"100%",boxShadow:"0 8px 32px rgba(0,0,0,.12)"}}>
        <div style={{fontSize:32,textAlign:"center",marginBottom:8}}>☁️</div>
        <h2 style={{margin:"0 0 6px",fontSize:18,fontWeight:700,textAlign:"center"}}>Cloudinary 연결</h2>
        <p style={{margin:"0 0 20px",fontSize:13,color:"#888",textAlign:"center",lineHeight:1.6}}>이미지를 클라우드에 저장하기 위해<br/>최초 1회 설정이 필요합니다</p>

        <div style={{background:"#f0f4ff",borderRadius:10,padding:"12px 14px",marginBottom:18,fontSize:12,color:"#3a5a9a",lineHeight:1.8}}>
          <b>📋 설정 방법</b><br/>
          1. <a href="https://cloudinary.com" target="_blank" rel="noreferrer" style={{color:"#4a7ec9"}}>cloudinary.com</a> 무료 가입<br/>
          2. Dashboard → Cloud Name 복사<br/>
          3. Settings → Upload → Add upload preset<br/>
          4. Preset 이름 복사 (Signing Mode: <b>Unsigned</b>)
        </div>

        <label style={{display:"block",fontSize:12,fontWeight:700,color:"#555",marginBottom:5}}>Cloud Name</label>
        <input value={cloudName} onChange={e=>setCloudName(e.target.value)} placeholder="예: my-cloud-abc123" style={IS2}/>

        <label style={{display:"block",fontSize:12,fontWeight:700,color:"#555",marginBottom:5}}>Upload Preset</label>
        <input value={uploadPreset} onChange={e=>setUploadPreset(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleSave()}
          placeholder="예: catalog_unsigned" style={IS2}/>

        <button onClick={handleSave}
          style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:(cloudName.trim()&&uploadPreset.trim())?"#444444":"#cccccc",color:"#222222",fontSize:15,fontWeight:700,cursor:(cloudName.trim()&&uploadPreset.trim())?"pointer":"not-allowed",fontFamily:"inherit"}}>
          ✓ 연결하고 시작하기
        </button>
        {err&&<div style={{marginTop:8,fontSize:12,color:"#e05050",textAlign:"center"}}>{err}</div>}
        <p style={{margin:"10px 0 0",fontSize:11,color:"#aaa",textAlign:"center"}}>입력 후 실제 이미지 업로드 시 연결이 확인됩니다</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  탭/롱프레스 훅
//
//  핵심 원칙:
//  1. DOM 이벤트 직접 등록 (passive:false) → preventDefault 가능
//  2. touchend에서 preventDefault → 브라우저 ghost click 완전 차단
//  3. onTap/onLong ref에 저장 → React 렌더와 무관하게 항상 최신
//  4. 두 손가락 터치는 완전 무시
// ══════════════════════════════════════════════════════════════
function useTapLong(elRef, getTap, getLong, delay=500){
  // getTap/getLong은 매 렌더에서 최신 값을 반환하는 getter 함수
  const getTapRef=useRef(getTap);
  const getLongRef=useRef(getLong);
  getTapRef.current=getTap;
  getLongRef.current=getLong;

  useEffect(()=>{
    const el=elRef.current;
    if(!el)return;
    let timer=null, fired=false, dragged=false, sx=0, sy=0;

    function onStart(e){
      if(e.touches?.length>1){clearTimeout(timer);return;}
      fired=false; dragged=false;
      const p=e.touches?.[0]??e;
      sx=p.clientX; sy=p.clientY;
      clearTimeout(timer);
      timer=setTimeout(()=>{
        if(!dragged){fired=true; getLongRef.current()({x:sx,y:sy});}
      },delay);
    }
    function onMove(e){
      const p=e.touches?.[0]??e;
      if(Math.abs(p.clientX-sx)>10||Math.abs(p.clientY-sy)>10){
        dragged=true; clearTimeout(timer);
      }
    }
    function onEnd(e){
      clearTimeout(timer);
      if(!fired&&!dragged){
        // ★ ghost click 완전 차단
        e.preventDefault();
        getTapRef.current()();
      }
    }
    function onCancel(){clearTimeout(timer);}
    function onCtx(e){e.preventDefault();}

    // ★ passive:false — preventDefault 사용 가능
    el.addEventListener("touchstart", onStart, {passive:false});
    el.addEventListener("touchmove",  onMove,  {passive:true});
    el.addEventListener("touchend",   onEnd,   {passive:false});
    el.addEventListener("touchcancel",onCancel,{passive:true});
    el.addEventListener("mousedown",  onStart, {passive:true});
    el.addEventListener("mousemove",  onMove,  {passive:true});
    el.addEventListener("mouseup",    onEnd,   {passive:true});
    el.addEventListener("mouseleave", onCancel,{passive:true});
    el.addEventListener("contextmenu",onCtx,   {passive:false});
    return()=>{
      clearTimeout(timer);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
      el.removeEventListener("touchcancel",onCancel);
      el.removeEventListener("mousedown",  onStart);
      el.removeEventListener("mousemove",  onMove);
      el.removeEventListener("mouseup",    onEnd);
      el.removeEventListener("mouseleave", onCancel);
      el.removeEventListener("contextmenu",onCtx);
    };
  },[]);// eslint-disable-line
}

// ══════════════════════════════════════════════════════════════
//  가상 스크롤 훅 (이미지형 그리드 전용)
//  화면에 보이는 행만 렌더링 → 1000개도 DOM에 ~30개 유지
// ══════════════════════════════════════════════════════════════
function useVirtualGrid(items, cols, rowHeight, overscan=3){
  const containerRef=useRef(null);
  const [scrollTop,setScrollTop]=useState(0);
  const [viewH,setViewH]=useState(600);

  useEffect(()=>{
    const el=window;
    const onScroll=()=>setScrollTop(window.scrollY);
    const onResize=()=>setViewH(window.innerHeight);
    setViewH(window.innerHeight);
    el.addEventListener("scroll",onScroll,{passive:true});
    el.addEventListener("resize",onResize,{passive:true});
    return()=>{el.removeEventListener("scroll",onScroll);el.removeEventListener("resize",onResize);};
  },[]);

  const rows=Math.ceil(items.length/cols);
  const totalH=rows*rowHeight;
  const offsetTop=containerRef.current?.getBoundingClientRect().top+window.scrollY||0;
  const relScroll=Math.max(0,scrollTop-offsetTop);

  const startRow=Math.max(0,Math.floor(relScroll/rowHeight)-overscan);
  const endRow=Math.min(rows-1,Math.ceil((relScroll+viewH)/rowHeight)+overscan);

  const visibleItems=[];
  for(let r=startRow;r<=endRow;r++){
    for(let c=0;c<cols;c++){
      const idx=r*cols+c;
      if(idx<items.length)visibleItems.push({item:items[idx],idx});
    }
  }
  const paddingTop=startRow*rowHeight;
  const paddingBottom=Math.max(0,(rows-1-endRow)*rowHeight);

  return{containerRef,visibleItems,totalH,paddingTop,paddingBottom};
}

// ══════ 공통 UI ══════
const Btn=({children,onClick,style,disabled,...r})=>(
  <button onClick={onClick} disabled={disabled} style={{fontFamily:"inherit",cursor:disabled?"not-allowed":"pointer",...style}}{...r}>{children}</button>
);
const Toggle=({value,onChange})=>(
  <div onClick={()=>onChange(!value)} style={{width:46,height:26,borderRadius:99,background:value?"#444444":"#dddddd",position:"relative",cursor:"pointer",flexShrink:0}}>
    <div style={{position:"absolute",top:3,left:value?23:3,width:20,height:20,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.2)",transition:"left .2s"}}/>
  </div>
);
const Overlay=({children,onClick})=>(
  <div onClick={onClick} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.62)",zIndex:300,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"0 12px 40px",overflowY:"auto"}}>
    {children}
  </div>
);
const Modal=({children,onClick,style})=>(
  <div onClick={onClick} style={{background:"#fff8f0",borderRadius:16,width:"100%",padding:"22px 20px",boxShadow:"0 20px 60px rgba(0,0,0,.32)",marginTop:68,...style}}>
    {children}
  </div>
);
const Empty=()=>(
  <div style={{textAlign:"center",padding:"60px 20px",color:"#888888"}}>
    <div style={{fontSize:44,marginBottom:10}}>📂</div><p>항목이 없습니다.</p>
  </div>
);
const Confirm=({message,onOk,onCancel})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"#fff8f0",borderRadius:14,padding:"22px 20px",maxWidth:320,width:"100%"}}>
      <p style={{margin:"0 0 18px",fontSize:15,lineHeight:1.6}}>{message}</p>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={onCancel} style={{flex:1,padding:10,borderRadius:8,border:"2px solid #cccccc",background:"transparent",color:"#666666",fontSize:14,fontWeight:900}}>취소</Btn>
        <Btn onClick={onOk}    style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#e05050",color:"#fff",fontSize:14,fontWeight:700}}>삭제</Btn>
      </div>
    </div>
  </div>
);
function CtxMenu({x,y,onCopy,onEdit,onDelete,onClose}){
  useEffect(()=>{
    const h=e=>{if(!e.target.closest?.("[data-ctx]"))onClose();};
    const id=setTimeout(()=>window.addEventListener("pointerdown",h),80);
    return()=>{clearTimeout(id);window.removeEventListener("pointerdown",h);};
  },[onClose]);
  const W=160,H=136;
  const lx=Math.min(Math.max(x,8),(window.innerWidth||400)-W-8);
  const ly=Math.min(Math.max(y,8),(window.innerHeight||700)-H-8);
  return(
    <div data-ctx="1" style={{position:"fixed",left:lx,top:ly,zIndex:700,background:"#222222",borderRadius:12,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.55)",minWidth:W}}>
      {[{icon:"📋",label:"복사",fn:onCopy},{icon:"✏️",label:"수정",fn:onEdit,sep:true},{icon:"🗑",label:"삭제",fn:onDelete,danger:true}].map(({icon,label,fn,sep,danger})=>(
        <button key={label} onClick={fn} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 16px",background:"transparent",border:"none",borderBottom:sep?"1px solid #2a2010":"none",color:danger?"#ff7060":"#ffffff",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
          {icon} {label}
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  ImageCard
// ══════════════════════════════════════════════════════════════
const ImageCard=memo(function ImageCard({item,hideAcquired,hideQuantity,colorCats,selected,selectMode,onOpen,onToggle,onSelect,onLong,gridCols=3,nameEllipsis=true}){
  const ref=useRef(null);
  const hex=item.colorCat?getHex(colorCats,item.colorCat):null;
  useTapLong(ref, ()=>(selectMode?onSelect:onOpen), ()=>onLong);
  const pos=item.imagePosition||"50% 50%";
  return(
    <div ref={ref} style={{background:"#fff",border:`2px solid ${selected?"#4a7ec9":(item.acquired&&!hideAcquired?"#444444":"#e0e0e0")}`,borderRadius:10,overflow:"hidden",cursor:"pointer",boxShadow:selected?"0 0 0 3px rgba(74,126,201,.3)":"0 2px 8px rgba(0,0,0,.07)",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none",touchAction:"pan-y"}}>
      <div style={{position:"relative",paddingTop:"100%",background:"#fff"}}>
        {item.image?<img src={item.image} alt="" draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:pos,background:"#fff"}}/>
          :<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:"#c0b8a8",background:"#f8f5f0"}}>🖼️</div>}
        {selectMode&&(
          <div style={{position:"absolute",top:5,left:5,width:26,height:26,borderRadius:6,border:`3px solid ${selected?"#4a7ec9":"rgba(80,80,80,.7)"}`,background:selected?"#4a7ec9":"rgba(255,255,255,.95)",display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",zIndex:10,boxShadow:"0 2px 6px rgba(0,0,0,.4)"}}>
            {selected&&<span style={{color:"#fff",fontSize:16,lineHeight:1}}>✓</span>}
          </div>
        )}
        {!hideQuantity&&(item.quantity??1)>0&&<div style={{position:"absolute",top:5,right:5,background:"rgba(0,0,0,.55)",color:"#ffffff",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:99}}>×{item.quantity??1}</div>}
      </div>
      <div style={{padding:"4px 5px",textAlign:"center"}}>
        <div style={{fontWeight:700,fontSize:gridCols<=2?13:gridCols<=3?12:gridCols<=4?11:10,color:"#222222",textAlign:"center",
          whiteSpace:nameEllipsis?"nowrap":"normal",
          overflow:nameEllipsis?"hidden":"visible",
          textOverflow:nameEllipsis?"ellipsis":"clip",
          wordBreak:"break-word",lineHeight:1.3}}>
          {item.name}{item.colorCat&&<span style={{color:hex}}> - {item.colorCat}</span>}
        </div>
      </div>
      {!hideAcquired&&!selectMode&&(
        <div style={{padding:"0 5px 5px"}}>
          <button
            onTouchEnd={e=>{e.stopPropagation();e.preventDefault();onToggle();}}
            onClick={e=>{e.stopPropagation();onToggle();}}
            style={{width:"100%",padding:3,borderRadius:5,border:"1.5px solid",borderColor:item.acquired?"#444444":"#cccccc",background:item.acquired?"#444444":"transparent",color:item.acquired?"#222222":"#666666",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
            {item.acquired?"✓ 습득":"○ 미습득"}
          </button>
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════
//  ListRow
// ══════════════════════════════════════════════════════════════
const ListRow=memo(function ListRow({item,hideAcquired,hideQuantity,colorCats,selected,selectMode,onOpen,onToggle,onSelect,onLong}){
  const ref=useRef(null);
  const hex=item.colorCat?getHex(colorCats,item.colorCat):null;
  useTapLong(ref, ()=>(selectMode?onSelect:onOpen), ()=>onLong);
  return(
    <div ref={ref} style={{display:"flex",alignItems:"center",gap:10,background:selected?"#eef3fb":"#fff",border:`2px solid ${selected?"#4a7ec9":(item.acquired&&!hideAcquired?"#444444":"#e0e0e0")}`,borderRadius:10,padding:"8px 12px",cursor:"pointer",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none",touchAction:"pan-y"}}>
      {selectMode&&(
        <div style={{width:26,height:26,borderRadius:6,flexShrink:0,pointerEvents:"none",border:`3px solid ${selected?"#4a7ec9":"rgba(80,80,80,.7)"}`,background:selected?"#4a7ec9":"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}>
          {selected&&<span style={{color:"#fff",fontSize:16,lineHeight:1}}>✓</span>}
        </div>
      )}
      <div style={{width:44,height:44,borderRadius:7,overflow:"hidden",flexShrink:0,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #ede4d0"}}>
        {item.image?<img src={item.image} alt="" draggable={false} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:item.imagePosition||"50% 50%"}}/>:<span style={{fontSize:18,opacity:.5}}>🖼️</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:11,color:"#222222",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {item.name}{item.colorCat&&<span style={{color:hex}}> - {item.colorCat}</span>}
        </div>
        <div style={{fontSize:11,color:"#888888",marginTop:1}}>{item.category}{item.note?` · ${item.note}`:""}</div>
      </div>
      {!hideQuantity&&(item.quantity??1)>0&&<div style={{background:"#222222",color:"#ffffff",fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:99,flexShrink:0}}>×{item.quantity??1}</div>}
      {!hideQuantity&&item.price>0&&<div style={{background:"#2a4a2a",color:"#a8e0a8",fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:99,flexShrink:0}}>₩{((item.price||0)*(item.quantity??1)).toLocaleString()}{(item.quantity??1)>1&&<span style={{fontSize:9,opacity:.8}}> (×{item.quantity??1})</span>}</div>}
      {!hideAcquired&&!selectMode&&(
        <button
          onTouchEnd={e=>{e.stopPropagation();e.preventDefault();onToggle();}}
          onClick={e=>{e.stopPropagation();onToggle();}}
          style={{padding:"4px 10px",borderRadius:99,border:"1.5px solid",borderColor:item.acquired?"#444444":"#cccccc",background:item.acquired?"#444444":"transparent",color:item.acquired?"#222222":"#666666",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>
          {item.acquired?"✓":"미습득"}
        </button>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════
//  AddModal
//  ★ 사진 버그 근본 해결:
//    <input type="file">을 "사진 선택" 버튼 위에 직접 absolute로 덮음
//    → 사용자가 input을 직접 터치 → iOS gesture chain 끊김 없음
//    → fileRef.current.click() 우회 불필요
// ══════════════════════════════════════════════════════════════
function AddModal({categories,colorCats,editItem,onSave,onClose,cdnConfig}){
  const [name,    setName]    =useState(editItem?.name||"");
  const [category,setCategory]=useState(editItem?.category||categories[0]||"");
  const [colorCat,setColorCat]=useState(editItem?.colorCat||"");
  const [note,    setNote]    =useState(editItem?.note||"");
  const [quantity,setQuantity]=useState(editItem?.quantity??1);
  const [price,   setPrice]   =useState(editItem?.price??0);
  const [image,   setImage]   =useState(editItem?.image||null); // Cloudinary URL or null
  const [imagePosition,setImagePosition]=useState(editItem?.imagePosition||"50% 50%");
  const [dragOver,setDragOver]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [uploadErr,setUploadErr]=useState("");
  const [adjusting,setAdjusting]=useState(false);
  const adjRef=useRef(null);
  const adjDrag=useRef(null);

  // 이미지 위치 조정 드래그 핸들러
  function onAdjPointerDown(e){
    e.preventDefault();
    const box=adjRef.current.getBoundingClientRect();
    const startX=e.clientX, startY=e.clientY;
    const [px,py]=imagePosition.split(" ").map(v=>parseFloat(v));
    adjDrag.current={startX,startY,px,py,w:box.width,h:box.height};
    window.addEventListener("pointermove",onAdjPointerMove);
    window.addEventListener("pointerup",onAdjPointerUp);
  }
  function onAdjPointerMove(e){
    if(!adjDrag.current)return;
    const {startX,startY,px,py,w,h}=adjDrag.current;
    const dx=(e.clientX-startX)/w*100;
    const dy=(e.clientY-startY)/h*100;
    const nx=Math.max(0,Math.min(100,px-dx));
    const ny=Math.max(0,Math.min(100,py-dy));
    setImagePosition(`${nx.toFixed(1)}% ${ny.toFixed(1)}%`);
    adjDrag.current={...adjDrag.current,startX:e.clientX,startY:e.clientY,px:nx,py:ny};
  }
  function onAdjPointerUp(){
    adjDrag.current=null;
    window.removeEventListener("pointermove",onAdjPointerMove);
    window.removeEventListener("pointerup",onAdjPointerUp);
  }

  async function handleFile(file){
    if(!file||!file.type.startsWith("image/"))return;
    setUploading(true);
    setUploadErr("");
    try{
      const url=await compressAndUpload(file, cdnConfig);
      setImage(url);
      setImagePosition("50% 50%");
      setAdjusting(true); // 업로드 되면 바로 위치 조정 모드
    }catch(err){
      setUploadErr("업로드 실패: "+err.message);
    }finally{setUploading(false);}
  }

  const IS={width:"100%",padding:"9px 12px",borderRadius:8,border:"2px solid #dddddd",background:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",color:"#222222",boxSizing:"border-box"};
  const LS={display:"block",fontSize:12,fontWeight:700,color:"#555555",marginBottom:5};

  return(
    <Overlay onClick={onClose}>
      <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:440,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <h2 style={{margin:0,fontSize:17,fontWeight:700}}>{editItem?"항목 수정":"새 항목 추가"}</h2>
          <Btn onClick={()=>{if(name.trim()&&!uploading)onSave({name:name.trim(),category,colorCat,note,image,imagePosition,quantity,price});}}
            disabled={uploading}
            style={{padding:"7px 16px",borderRadius:8,border:"none",background:(name.trim()&&!uploading)?"#444444":"#dddddd",color:"#222222",fontSize:14,fontWeight:700,cursor:(name.trim()&&!uploading)?"pointer":"not-allowed"}}>
            {editItem?"저장":"추가"}
          </Btn>
        </div>

        {/* ★ 사진 영역 */}
        <div style={{marginBottom:8}}>
          {/* 1:1 미리보기 */}
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}}
            style={{position:"relative",paddingTop:"100%",border:`2px dashed ${adjusting?"#4a7ec9":dragOver?"#444444":"#cccccc"}`,borderRadius:10,overflow:"hidden",background:dragOver?"#f0f0f0":"#f5f5f5",marginBottom:4}}>
            {image
              ?<>
                <img ref={adjRef} src={image} alt="" draggable={false}
                  onPointerDown={adjusting?onAdjPointerDown:undefined}
                  style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:imagePosition,background:"#fff",cursor:adjusting?"grab":"default",userSelect:"none",touchAction:"none"}}/>
                {adjusting&&(
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                    <div style={{background:"rgba(0,0,0,.55)",color:"#fff",fontSize:11,padding:"5px 10px",borderRadius:20,textAlign:"center"}}>↕↔ 드래그로 위치 조정</div>
                  </div>
                )}
              </>
              :<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#888888",pointerEvents:"none"}}>
                <div style={{fontSize:28}}>📷</div>
                <div style={{fontSize:11,marginTop:4}}>아래 버튼으로 선택하거나 드래그</div>
              </div>}
          </div>

          {image&&!uploading&&(
            <div style={{display:"flex",justifyContent:"center",marginBottom:4}}>
              <button type="button" onClick={()=>setAdjusting(a=>!a)}
                style={{padding:"5px 14px",borderRadius:20,border:`2px solid ${adjusting?"#4a7ec9":"#cccccc"}`,background:adjusting?"#eef4ff":"transparent",color:adjusting?"#4a7ec9":"#888",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                {adjusting?"✓ 위치 조정 완료":"✏️ 이미지 위치 조정"}
              </button>
            </div>
          )}

          {uploadErr&&<div style={{fontSize:12,color:"#e05050",marginTop:4,padding:"6px 10px",background:"#fff0f0",borderRadius:6}}>{uploadErr}</div>}
          {/* ★ 버튼 위에 input을 직접 absolute로 덮음 — iOS에서도 gesture chain 유지 */}
          <div style={{display:"flex",gap:8}}>
            <div style={{position:"relative",flex:1,overflow:"hidden",borderRadius:7}}>
              <button type="button" style={{width:"100%",padding:"9px",borderRadius:7,border:"2px solid #cccccc",background:uploading?"#e8f0ff":"#f5f5f5",color:uploading?"#4a7ec9":"#555555",fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"block"}}>
                {uploading?"⏳ 업로드 중...":"📷 사진 선택"}
              </button>
              <input
                type="file" accept="image/*"
                disabled={uploading}
                style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:uploading?"not-allowed":"pointer",fontSize:0}}
                onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value="";}}
              />
            </div>
            {image&&!uploading&&(
              <button type="button" onClick={()=>{setImage(null);setImagePosition("50% 50%");setAdjusting(false);}}
                style={{padding:"9px 14px",borderRadius:7,border:"2px solid #c0503a",background:"transparent",color:"#e05050",fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                ✕ 제거
              </button>
            )}
          </div>
        </div>

        <label style={LS}>이름 *</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="항목 이름" style={{...IS,marginBottom:10}}/>

        <label style={LS}>카테고리</label>
        <select value={category} onChange={e=>setCategory(e.target.value)} style={{...IS,marginBottom:10,cursor:"pointer"}}>
          {categories.map(c=><option key={c}>{c}</option>)}
        </select>

        <label style={LS}>색상 카테고리</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
          <Btn onClick={()=>setColorCat("")} style={{padding:"4px 9px",borderRadius:99,border:`2px solid ${colorCat===""?"#888":"#dddddd"}`,background:colorCat===""?"#88888822":"transparent",color:colorCat===""?"#444":"#666666",fontSize:12,fontWeight:colorCat===""?700:400}}>없음</Btn>
          {colorCats.map(col=>(
            <Btn key={col.name} onClick={()=>setColorCat(col.name)}
              style={{padding:"4px 9px",borderRadius:99,border:`2px solid ${colorCat===col.name?col.hex:"#dddddd"}`,background:colorCat===col.name?col.hex+"22":"transparent",color:colorCat===col.name?col.hex:"#666666",fontSize:12,fontWeight:colorCat===col.name?700:400,display:"flex",alignItems:"center",gap:3}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:col.hex,display:"inline-block"}}/>{col.name}
            </Btn>
          ))}
        </div>

        <label style={LS}>수량</label>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <Btn onClick={()=>setQuantity(q=>Math.max(0,q-1))} style={{width:32,height:32,borderRadius:8,border:"2px solid #dddddd",background:"transparent",color:"#222222",fontSize:20,fontWeight:700,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>−</Btn>
          <input type="number" min="0" value={quantity} onChange={e=>setQuantity(Math.max(0,parseInt(e.target.value)||0))} style={{...IS,width:65,textAlign:"center",padding:6}}/>
          <Btn onClick={()=>setQuantity(q=>q+1)} style={{width:32,height:32,borderRadius:8,border:"2px solid #dddddd",background:"transparent",color:"#222222",fontSize:20,fontWeight:700,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</Btn>
        </div>

        <label style={LS}>금액 (선택)</label>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <span style={{color:"#555555",fontSize:14,fontWeight:700,flexShrink:0}}>₩</span>
          <input type="number" min="0" value={price||""} onChange={e=>setPrice(Math.max(0,parseInt(e.target.value)||0))}
            placeholder="0" style={{...IS,flex:1}}/>
        </div>

        <label style={LS}>메모 (선택)</label>
        <input value={note} onChange={e=>setNote(e.target.value)} placeholder="간단한 메모" style={{...IS,marginBottom:16}}/>

        <div style={{display:"flex",gap:10}}>
          <Btn onClick={onClose} style={{flex:1,padding:11,borderRadius:8,border:"2px solid #cccccc",background:"transparent",color:"#666666",fontSize:14,fontWeight:900}}>취소</Btn>
          <Btn onClick={()=>{if(name.trim()&&!uploading)onSave({name:name.trim(),category,colorCat,note,image,imagePosition,quantity,price});}}
            disabled={uploading}
            style={{flex:2,padding:11,borderRadius:8,border:"none",background:(name.trim()&&!uploading)?"#444444":"#dddddd",color:"#222222",fontSize:14,fontWeight:700}}>
            {uploading?"업로드 중...":(editItem?"저장":"추가")}
          </Btn>
        </div>
      </Modal>
    </Overlay>
  );
}

// ══════════════════════════════════════════════════════════════
//  VirtualGrid — 화면에 보이는 행만 DOM에 렌더링
//  카드 높이를 동적으로 측정해 정확한 패딩 계산
// ══════════════════════════════════════════════════════════════
function VirtualGrid({items,cols,hideAcquired,hideQuantity,colorCats,sel,selectMode,nameEllipsis,onOpen,onToggle,onSelect,onLong}){
  // 카드 높이: 화면 너비에서 cols와 gap을 고려해 추정
  // 정사각형 이미지(100%) + 이름 + 버튼 영역 ≒ 카드너비 * 1.38
  const [cardH,setCardH]=useState(160);
  const measureRef=useRef(null);
  useEffect(()=>{
    if(measureRef.current){
      const h=measureRef.current.getBoundingClientRect().height;
      if(h>40)setCardH(h+8); // +8은 gap
    }
  });

  const GAP=8;
  const cardW=Math.floor((Math.min(window.innerWidth,480)-16-(GAP*(cols-1)))/cols);
  const rowH=cardH;
  const {containerRef,visibleItems,totalH,paddingTop,paddingBottom}=useVirtualGrid(items,cols,rowH);

  return(
    <div ref={containerRef} style={{position:"relative",minHeight:totalH}}>
      <div style={{height:paddingTop}}/>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},${cardW}px)`,gap:GAP,justifyContent:"start"}}>
        {visibleItems.map(({item,idx})=>(
          <div key={item.id} ref={idx===0?measureRef:null}>
            <ImageCard item={item} hideAcquired={hideAcquired} hideQuantity={hideQuantity} colorCats={colorCats}
              selected={sel.has(item.id)} selectMode={selectMode} gridCols={cols} nameEllipsis={nameEllipsis}
              onOpen={()=>onOpen(item)} onToggle={()=>onToggle(item.id)}
              onSelect={()=>onSelect(item.id)} onLong={pos=>onLong(pos,item)}/>
          </div>
        ))}
      </div>
      <div style={{height:paddingBottom}}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Main App
// ══════════════════════════════════════════════════════════════
export default function CatalogApp(){
  const [cdnConfig,setCdnConfig_]=useState(()=>getCdnConfig()); // Cloudinary 설정
  const [items,setItems]=useState(DEF_ITEMS);
  const [categories,setCategories]=useState(DEF_CATS);
  const [colorCats,setColorCats]=useState(DEF_CC);
  const [hideAcquired,setHideAcquired]=useState(false);
  const [hideQuantity,setHideQuantity]=useState(false);
  const [viewMode,setViewMode]=useState("이미지형");
  const [gridCols,setGridCols]=useState(3);
  const [sortBy,setSortBy]=useState("date-desc");
  const [search,setSearch]=useState("");
  const [activeCats,setActiveCats]=useState([]);
  const [modal,setModal]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [viewItem,setViewItem]=useState(null);
  const [settings,setSettings]=useState(false);
  const [selectMode,setSelectMode]=useState(false);
  const [sel,setSel]=useState(new Set());
  const [bulkMove,setBulkMove]=useState(false);
  const [bulkCat,setBulkCat]=useState("");
  const [confirm,setConfirm]=useState(null);
  const [ctx,setCtx]=useState(null);
  const [toast,setToast]=useState("");
  const [loading,setLoading]=useState(true);
  const [syncLbl,setSyncLbl]=useState("로딩 중...");
  const [showSyncLbl,setShowSyncLbl]=useState(true);
  const [unsaved,setUnsaved]=useState(false);
  const [nameEllipsis,setNameEllipsis]=useState(true); // 이름생략모드
  const [newCat,setNewCat]=useState("");
  const [newCN,setNewCN]=useState("");
  const [newCH,setNewCH]=useState("#888888");
  const [editCI,setEditCI]=useState(null);
  const [editCN,setEditCN]=useState("");
  const [editCH,setEditCH]=useState("#888888");
  const [headerVis,setHeaderVis]=useState(true);
  const [hdrH,setHdrH]=useState(130);

  const nextId=useRef(100),toastT=useRef(null),stRef=useRef(null),hashRef=useRef(""),readyRef=useRef(false),saveT=useRef(null),saving=useRef(false),lastSY=useRef(0),hdrRef=useRef(null);

  useEffect(()=>{stRef.current={items,categories,colorCats,settings:{hideAcquired,hideQuantity,viewMode,gridCols,sortBy,nameEllipsis}};},[items,categories,colorCats,hideAcquired,hideQuantity,viewMode,gridCols,sortBy]);
  useEffect(()=>{
    const fn=()=>{const c=window.scrollY;setHeaderVis(c<10||c<lastSY.current);lastSY.current=c;};
    window.addEventListener("scroll",fn,{passive:true});return()=>window.removeEventListener("scroll",fn);
  },[]);
  useEffect(()=>{
    const measure=()=>{if(hdrRef.current)setHdrH(hdrRef.current.offsetHeight+4);};
    measure();
    const ro=new ResizeObserver(measure);
    if(hdrRef.current)ro.observe(hdrRef.current);
    return()=>ro.disconnect();
  },[selectMode,hideAcquired,hideQuantity,viewMode]);

  const showToast=msg=>{setToast(msg);clearTimeout(toastT.current);toastT.current=setTimeout(()=>setToast(""),2200);};
  const doSave=async(silent=false)=>{
    if(!readyRef.current||saving.current)return;
    const st=stRef.current;if(!st)return;
    saving.current=true;lsSet(st);await wsSet(st);
    hashRef.current=JSON.stringify(st);saving.current=false;setUnsaved(false);
    if(!silent)showToast("✓ 저장됨");
  };
  const sched=()=>{setUnsaved(true);clearTimeout(saveT.current);saveT.current=setTimeout(()=>doSave(true),3000);};

  useEffect(()=>{
    let gone=false;
    (async()=>{
      const local=lsGet(null),shared=await wsGet();
      if(gone)return;
      let d=local||DEF_STATE,lbl="💾 기기 저장";
      setTimeout(()=>setShowSyncLbl(false),3000);
      if(shared){d=shared;lbl="☁️ 공유 동기화";lsSet(d);}
      const{items:i,categories:c,colorCats:cc,settings:s}=d;
      setItems(i??DEF_ITEMS);setCategories(c??DEF_CATS);setColorCats(cc??DEF_CC);
      setHideAcquired(s?.hideAcquired??s?.photoMode??false);setHideQuantity(s?.hideQuantity??s?.photoMode??false);setViewMode(s?.viewMode??"이미지형");setGridCols(s?.gridCols??3);setSortBy(s?.sortBy??"date-desc");setNameEllipsis(s?.nameEllipsis??true);
      nextId.current=Math.max(100,...(i??DEF_ITEMS).map(x=>x.id))+1;
      hashRef.current=JSON.stringify(d);setSyncLbl(lbl);readyRef.current=true;setLoading(false);
    })();
    return()=>{gone=true;};
  },[]);
  useEffect(()=>{if(readyRef.current)sched();},[items,categories,colorCats,hideAcquired,hideQuantity,viewMode,gridCols,sortBy]);
  useEffect(()=>{
    if(loading||typeof window.storage?.get!=="function")return;
    const id=setInterval(async()=>{
      if(saving.current||saveT.current)return;
      const sh=await wsGet();if(!sh)return;
      const h=JSON.stringify(sh);
      if(h!==hashRef.current){
        hashRef.current=h;lsSet(sh);
        const{items:i,categories:c,colorCats:cc,settings:s}=sh;
        setItems(i??DEF_ITEMS);setCategories(c??DEF_CATS);setColorCats(cc??DEF_CC);
        setHideAcquired(s?.hideAcquired??s?.photoMode??false);setHideQuantity(s?.hideQuantity??s?.photoMode??false);setViewMode(s?.viewMode??"이미지형");setGridCols(s?.gridCols??3);setSortBy(s?.sortBy??"date-desc");setNameEllipsis(s?.nameEllipsis??true);
        nextId.current=Math.max(nextId.current,...(i??[]).map(x=>x.id))+1;
        showToast("🔄 동기화됨");
      }
    },4000);
    return()=>clearInterval(id);
  },[loading]);

  const HB={border:"none",borderRadius:7,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"};
  const IS={width:"100%",padding:"9px 12px",borderRadius:8,border:"2px solid #dddddd",background:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",color:"#222222",boxSizing:"border-box"};
  const LS={display:"block",fontSize:12,fontWeight:700,color:"#555555",marginBottom:5};

  const openAdd=()=>{setEditItem(null);setModal(true);};
  const openEdit=useCallback(it=>{setEditItem(it);setViewItem(null);setCtx(null);setModal(true);},[]);
  // 이름+색상 중복 감지 → 중복 카테고리로 자동 이동
  const applyDupCheck=useCallback((newItem, allItems)=>{
    const isDup=allItems.some(it=>
      it.id!==newItem.id &&
      it.name.trim()===newItem.name.trim() &&
      it.colorCat===newItem.colorCat
    );
    return isDup?{...newItem,category:"중복"}:newItem;
  },[]);

  const handleSave=useCallback(form=>{
    if(editItem){
      setItems(p=>{
        const updated=p.map(it=>it.id===editItem.id?{...it,...form}:it);
        // 수정된 항목 중복 체크
        const others=updated.filter(it=>it.id!==editItem.id);
        return updated.map(it=>it.id===editItem.id?applyDupCheck(it,others):it);
      });
    } else {
      setItems(p=>{
        const newItem={id:nextId.current++,acquired:false,date:new Date().toISOString().split("T")[0],...form};
        const checked=applyDupCheck(newItem,p);
        // 기존 항목 중에 이 항목과 이름+색상이 같은 것도 중복으로 표시
        const updatedP=p.map(it=>
          it.name.trim()===newItem.name.trim()&&it.colorCat===newItem.colorCat
            ?{...it,category:"중복"}:it
        );
        return [...updatedP,checked];
      });
    }
    setModal(false);
  },[editItem,applyDupCheck]);
  const copyItem=useCallback(it=>{setItems(p=>[...p,{...it,id:nextId.current++,name:`${it.name} (복사)`,date:new Date().toISOString().split("T")[0]}]);setCtx(null);showToast("📋 복사됨");},[]);
  const togAcq=useCallback((id)=>{setItems(p=>p.map(it=>it.id===id?{...it,acquired:!it.acquired}:it));setViewItem(v=>v?.id===id?{...v,acquired:!v.acquired}:v);},[]);
  const delItem=useCallback(id=>{setCtx(null);setConfirm({msg:"이 항목을 삭제할까요?",ok:()=>{setItems(p=>p.filter(it=>it.id!==id));setViewItem(null);setConfirm(null);}});},[]);
  const togSel=useCallback(id=>setSel(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;}),[]);
  const clearSel=useCallback(()=>{setSel(new Set());setSelectMode(false);},[]);
  const doBulkDel=useCallback(()=>{if(!sel.size)return;const ids=new Set(sel);setConfirm({msg:`${ids.size}개 항목을 삭제할까요?`,ok:()=>{setItems(p=>p.filter(it=>!ids.has(it.id)));clearSel();setConfirm(null);}});},[sel,clearSel]);
  const doBulkMove=useCallback(()=>{if(!bulkCat)return;const ids=new Set(sel);setItems(p=>p.map(it=>ids.has(it.id)?{...it,category:bulkCat}:it));setBulkMove(false);clearSel();},[bulkCat,sel,clearSel]);
  const addCat=()=>{const v=newCat.trim();if(v&&!categories.includes(v)){setCategories(p=>[...p,v]);setNewCat("");}else{setNewCat("");}};
  const remCat=c=>{setCategories(p=>p.filter(x=>x!==c));setActiveCats(p=>p.filter(x=>x!==c));};
  const addCC=()=>{const v=newCN.trim();if(v&&!colorCats.find(c=>c.name===v))setColorCats(p=>[...p,{name:v,hex:newCH}]);setNewCN("");setNewCH("#888888");};
  const remCC=n=>{setColorCats(p=>p.filter(c=>c.name!==n));setItems(p=>p.map(it=>it.colorCat===n?{...it,colorCat:""}:it));};
  const startEC=i=>{setEditCI(i);setEditCN(colorCats[i].name);setEditCH(colorCats[i].hex);};
  const saveEC=()=>{if(!editCN.trim())return;const old=colorCats[editCI].name;setColorCats(p=>p.map((c,i)=>i===editCI?{name:editCN.trim(),hex:editCH}:c));setItems(p=>p.map(it=>it.colorCat===old?{...it,colorCat:editCN.trim()}:it));setEditCI(null);};

  // ★ useMemo: 검색/필터/정렬을 의존성이 바뀔 때만 재계산
  const disp=useMemo(()=>[...items]
    .filter(it=>activeCats.length===0||activeCats.includes(it.category))
    .filter(it=>itemMatchesQuery(it, search))
    .sort((a,b)=>{
      if(sortBy==="name-asc")return dispName(a).localeCompare(dispName(b),"ko");
      if(sortBy==="name-desc")return dispName(b).localeCompare(dispName(a),"ko");
      if(sortBy==="date-desc")return b.date.localeCompare(a.date);
      if(sortBy==="date-asc")return a.date.localeCompare(b.date);
      if(sortBy==="acquired-first")return b.acquired-a.acquired;
      if(sortBy==="not-acquired-first")return a.acquired-b.acquired;
      if(sortBy==="category-name-asc"){const cc=a.category.localeCompare(b.category,"ko");return cc||dispName(a).localeCompare(dispName(b),"ko");}
      if(sortBy==="category-name-desc"){const cc=a.category.localeCompare(b.category,"ko");return cc||dispName(b).localeCompare(dispName(a),"ko");}
      return 0;
    }),[items,activeCats,search,sortBy]);

  const acq=items.filter(it=>it.acquired).length;
  const FULL=selectMode?hdrH+44:hdrH;

  if(loading)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f8f8f8",fontFamily:"serif"}}>
      <div style={{textAlign:"center",color:"#888888"}}><div style={{fontSize:40,marginBottom:12}}>📋</div><div>불러오는 중...</div></div>
    </div>
  );

  // Cloudinary 미설정 시 설정 화면 표시
  if(!cdnConfig)return(
    <CloudinarySetup onSave={cfg=>{setCdnConfig(cfg);setCdnConfig_(cfg);}}/>
  );

  function setCdnConfig(cfg){setCdnConfig_(cfg);setCdnConfig_local(cfg);}
  function setCdnConfig_local(cfg){try{localStorage.setItem(CK,JSON.stringify(cfg));}catch{}}

  return(
    <div style={{fontFamily:"'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif",minHeight:"100vh",letterSpacing:"0.05em",background:"#f8f8f8",color:"#222222"}}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet"/>

      {/* 토스트 */}
      <div style={{position:"fixed",bottom:22,right:16,zIndex:999,pointerEvents:"none",opacity:toast?1:0,transform:toast?"translateY(0)":"translateY(10px)",transition:"all .3s"}}>
        <div style={{background:"#222222",color:"#ffffff",padding:"7px 14px",borderRadius:99,fontSize:13,fontWeight:900}}>{toast}</div>
      </div>
      {showSyncLbl&&<div style={{position:"fixed",top:5,right:5,zIndex:200,fontSize:7,color:"#888",background:"rgba(255,255,255,.88)",borderRadius:99,padding:"2px 8px",pointerEvents:"none",transition:"opacity .5s",opacity:showSyncLbl?1:0}}>{syncLbl}</div>}
      {ctx&&<CtxMenu x={ctx.x} y={ctx.y} onCopy={()=>copyItem(ctx.item)} onEdit={()=>openEdit(ctx.item)} onDelete={()=>delItem(ctx.item.id)} onClose={()=>setCtx(null)}/>}

      {/* 헤더 — 크롬/모바일 모두 동일하게 보이도록 단순 구조 */}
      <header ref={hdrRef} style={{background:"#222222",padding:"10px 14px 8px",position:"fixed",top:0,left:0,right:0,zIndex:100,boxShadow:"0 2px 16px rgba(0,0,0,.45)",transition:"transform .3s",transform:headerVis?"translateY(0)":"translateY(-100%)"}}>

        {/* Row 1: 타이틀 + 추가 + 통계 + 저장 */}
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"nowrap"}}>
          <span style={{fontSize:22,fontWeight:900,color:"#ffffff",flexShrink:0}}>🍃 모동숲</span>
          <Btn onClick={openAdd} style={{...HB,background:"#ffffff",color:"#222222",padding:"5px 13px",fontSize:15,flexShrink:0,border:"none"}}>+ 추가</Btn>
          <span style={{fontSize:14,color:"#aaaaaa",whiteSpace:"nowrap",flexShrink:0}}>전체 {items.length} · 습득 <b onClick={()=>{setActiveCats([]);setSearch("[습득]");}} style={{color:"#ffffff",cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}>{acq}</b></span>
          <div style={{flex:1}}/>
          <Btn onClick={()=>doSave(false)} style={{...HB,background:unsaved?"#f5c842":"#444444",color:"#222222",border:`1.5px solid ${unsaved?"#f5c842":"#666666"}`,padding:"5px 11px",fontSize:14,flexShrink:0,boxShadow:unsaved?"0 0 6px rgba(245,200,66,.5)":"none"}}>
            {unsaved?"💾 저장":"✓ 저장됨"}
          </Btn>
        </div>

        {/* Row 2: 검색 + 정렬 */}
        <div style={{display:"flex",gap:6,marginBottom:4}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            onFocus={()=>setActiveCats([])}
            placeholder="🔍 검색 · [숫자만] [영어만] [자음ㄱ만]…" style={{flex:1,padding:"6px 10px",borderRadius:7,border:"1.5px solid #555555",background:"#333333",color:"#ffffff",fontFamily:"inherit",fontSize:14,outline:"none",minWidth:0}}/>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{padding:"5px 4px",borderRadius:7,border:"1.5px solid #555555",background:"#333333",color:"#ffffff",fontFamily:"inherit",fontSize:14,cursor:"pointer",flexShrink:0,maxWidth:110}}>
            {SORT_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        {/* 특수 검색 버튼 */}
        <div style={{display:"flex",gap:4,marginBottom:6,overflowX:"auto",scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {["숫자","영어","ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"].map(k=>{
            const tag=k.length===1&&!"숫자영어".includes(k)?`[자음${k}만]`:`[${k}만]`;
            const active=search.includes(tag);
            return(
              <button key={k} onClick={()=>{
                setActiveCats([]);
                setSearch(p=>p.includes(tag)?p.replace(tag,"").trim():((p?p+" ":"")+tag).trim());
              }}
                style={{padding:"3px 7px",borderRadius:99,border:`1.5px solid ${active?"#ffffff":"#666666"}`,background:active?"#ffffff":"#333333",color:active?"#222222":"#cccccc",fontSize:12,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>
                {{"숫자":"숫자","영어":"영어","ㄱ":"ㄱ·ㄲ","ㄴ":"ㄴ","ㄷ":"ㄷ·ㄸ","ㄹ":"ㄹ","ㅁ":"ㅁ","ㅂ":"ㅂ·ㅃ","ㅅ":"ㅅ·ㅆ","ㅇ":"ㅇ","ㅈ":"ㅈ·ㅉ","ㅊ":"ㅊ","ㅋ":"ㅋ","ㅌ":"ㅌ","ㅍ":"ㅍ","ㅎ":"ㅎ"}[k]}
              </button>
            );
          })}
        </div>

        {/* Row 3: 뷰 + 열 + 선택 + 설정 */}
        <div style={{display:"flex",gap:5,alignItems:"center",overflowX:"auto",paddingBottom:2,scrollbarWidth:"none",msOverflowStyle:"none"}}>
          <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1.5px solid #666666",flexShrink:0}}>
            {["이미지형","목록형"].map(m=>(
              <Btn key={m} onClick={()=>setViewMode(m)} style={{...HB,borderRadius:0,padding:"5px 9px",fontSize:14,background:viewMode===m?"#ffffff":"#333333",color:viewMode===m?"#222222":"#cccccc"}}>{m}</Btn>
            ))}
          </div>
          {viewMode==="이미지형"&&<>
            <span style={{color:"#cccccc",fontSize:14,flexShrink:0}}>열:</span>
            {GRID_COLS.map(n=>(
              <Btn key={n} onClick={()=>setGridCols(n)} style={{...HB,padding:"4px 8px",background:gridCols===n?"#ffffff":"#333333",color:gridCols===n?"#222222":"#cccccc",border:"1.5px solid #666666",borderRadius:6,fontSize:14,flexShrink:0,minWidth:28,textAlign:"center"}}>{n}</Btn>
            ))}
          </>}
          <Btn onClick={()=>{setSelectMode(s=>!s);setSel(new Set());}} style={{...HB,background:selectMode?"#4a7ec9":"#333333",color:selectMode?"#fff":"#cccccc",border:"1.5px solid #666666",padding:"5px 10px",fontSize:14,flexShrink:0}}>
            {selectMode?"✓선택중":"☐선택"}
          </Btn>
          <Btn onClick={()=>setSettings(true)} style={{...HB,background:"#333333",color:"#cccccc",border:"1.5px solid #666666",padding:"5px 10px",fontSize:14,flexShrink:0}}>⚙️</Btn>
        </div>
      </header>

      {selectMode&&(
        <div style={{background:"#1e3a5f",padding:"8px 14px",position:"fixed",top:headerVis?hdrH:0,left:0,right:0,zIndex:99,transition:"top .3s",boxShadow:"0 2px 10px rgba(0,0,0,.3)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,overflowX:"auto",scrollbarWidth:"none"}}>
            <span style={{color:"#a8c8f0",fontSize:13,fontWeight:700,flexShrink:0}}>{sel.size}개</span>
            {[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+((it?.price||0)*(it?.quantity??1));},0)>0&&(
              <span style={{color:"#a8e0a8",fontSize:12,fontWeight:700,flexShrink:0}}>
                합계 ₩{[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+((it?.price||0)*(it?.quantity??1));},0).toLocaleString()}
              </span>
            )}
            <Btn onClick={()=>setSel(new Set(disp.map(it=>it.id)))} style={{...HB,background:"transparent",color:"#a8c8f0",border:"1px solid #4a7ec9",padding:"3px 9px",fontSize:12,flexShrink:0}}>전체</Btn>
            <Btn onClick={()=>setSel(new Set())} style={{...HB,background:"transparent",color:"#a8c8f0",border:"1px solid #4a7ec9",padding:"3px 9px",fontSize:12,flexShrink:0}}>해제</Btn>
            <div style={{flex:1}}/>
            <Btn onClick={()=>{setBulkCat(categories[0]||"");setBulkMove(true);}} disabled={!sel.size} style={{...HB,background:sel.size?"#4a7ec9":"#334",color:"#fff",padding:"5px 10px",fontSize:12,flexShrink:0,opacity:sel.size?1:.5}}>📁이동</Btn>
            <Btn onClick={doBulkDel} disabled={!sel.size} style={{...HB,background:sel.size?"#e05050":"#334",color:"#fff",padding:"5px 10px",fontSize:12,flexShrink:0,opacity:sel.size?1:.5}}>🗑삭제</Btn>
            <Btn onClick={clearSel} style={{...HB,background:"transparent",color:"#a8c8f0",border:"1px solid #4a7ec9",padding:"3px 9px",fontSize:12,flexShrink:0}}>취소</Btn>
          </div>
        </div>
      )}

      <main style={{maxWidth:1100,margin:"0 auto",padding:`${FULL+12}px 12px 28px`}}>
        <div style={{background:"#e8dcc8",borderRadius:99,height:5,marginBottom:10,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:99,background:"linear-gradient(90deg,#44a84c,#e8c96a)",width:items.length?`${(acq/items.length)*100}%`:"0%",transition:"width .5s"}}/>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",paddingBottom:3,scrollbarWidth:"none"}}>
          {["전체",...categories].map(c=>{
            const isAll=c==="전체";
            const active=isAll?(activeCats.length===0):activeCats.includes(c);
            return(
              <Btn key={c} onClick={()=>{
                if(isAll){setActiveCats([]);setSearch("");return;}
                setActiveCats(p=>p.includes(c)?p.filter(x=>x!==c):[...p,c]);
              }} style={{padding:"4px 12px",borderRadius:99,border:"2px solid",borderColor:active?"#444444":"#dddddd",background:active?"#444444":"transparent",color:active?"#222222":"#666666",fontWeight:active?700:400,fontSize:16,whiteSpace:"nowrap",flexShrink:0}}>{c}</Btn>
            );
          })}
        </div>
        {viewMode==="이미지형"&&(disp.length===0?<Empty/>:
          <VirtualGrid
            items={disp} cols={gridCols}
            hideAcquired={hideAcquired} hideQuantity={hideQuantity} colorCats={colorCats}
            sel={sel} selectMode={selectMode} nameEllipsis={nameEllipsis}
            onOpen={setViewItem} onToggle={togAcq} onSelect={togSel}
            onLong={(pos,it)=>setCtx({...pos,item:it})}
          />
        )}
        {viewMode==="목록형"&&(disp.length===0?<Empty/>:
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {disp.map(it=>(
              <ListRow key={it.id} item={it} hideAcquired={hideAcquired} hideQuantity={hideQuantity} colorCats={colorCats}
                selected={sel.has(it.id)} selectMode={selectMode}
                onOpen={()=>setViewItem(it)} onToggle={()=>togAcq(it.id)}
                onSelect={()=>togSel(it.id)} onLong={pos=>setCtx({...pos,item:it})}/>
            ))}
          </div>
        )}
      </main>

      {confirm&&<Confirm message={confirm.msg} onOk={confirm.ok} onCancel={()=>setConfirm(null)}/>}

      {bulkMove&&(
        <Overlay onClick={()=>setBulkMove(false)}>
          <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:340}}>
            <h2 style={{margin:"0 0 8px",fontSize:16,fontWeight:700}}>📁 카테고리 이동</h2>
            <p style={{margin:"0 0 14px",fontSize:13,color:"#666666"}}><b>{sel.size}개</b> 항목 이동:</p>
            <select value={bulkCat} onChange={e=>setBulkCat(e.target.value)} style={{...IS,marginBottom:18,cursor:"pointer"}}>
              {categories.map(c=><option key={c}>{c}</option>)}
            </select>
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={()=>setBulkMove(false)} style={{flex:1,padding:10,borderRadius:8,border:"2px solid #cccccc",background:"transparent",color:"#666666",fontSize:14,fontWeight:900}}>취소</Btn>
              <Btn onClick={doBulkMove} style={{flex:2,padding:10,borderRadius:8,border:"none",background:"#4a7ec9",color:"#fff",fontSize:14,fontWeight:700}}>이동</Btn>
            </div>
          </Modal>
        </Overlay>
      )}

      {viewItem&&(
        <Overlay onClick={()=>setViewItem(null)}>
          <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:400,padding:0,overflow:"hidden"}}>
            <div style={{position:"relative",paddingTop:"100%",background:"#fff"}}>
              {viewItem.image?<img src={viewItem.image} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",background:"#fff"}}/>
                :<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:50,background:"#f8f5f0"}}>🖼️</div>}
            </div>
            <div style={{padding:"14px 18px"}}>
              <div style={{fontSize:11,color:"#444444",fontWeight:700,marginBottom:5}}>{viewItem.category}</div>
              <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>
                {viewItem.name}{viewItem.colorCat&&<span style={{color:getHex(colorCats,viewItem.colorCat)}}> - {viewItem.colorCat}</span>}
              </h2>
              {viewItem.note&&<p style={{margin:"0 0 5px",color:"#666666",fontSize:13}}>{viewItem.note}</p>}
              {viewItem.price>0&&<p style={{margin:"0 0 5px",fontSize:13,color:"#2a6a2a",fontWeight:700}}>₩{((viewItem.price||0)*(viewItem.quantity??1)).toLocaleString()}{(viewItem.quantity??1)>1&&<span style={{fontSize:11,color:"#5a8060"}}> (단가 ₩{viewItem.price.toLocaleString()})</span>}</p>}
              {(viewItem.quantity??1)>1&&<p style={{margin:"0 0 5px",fontSize:12,color:"#a09070"}}>수량: {viewItem.quantity}</p>}
              <p style={{margin:"0 0 12px",fontSize:11,color:"#a09070"}}>추가일: {viewItem.date}</p>
              <div style={{display:"flex",gap:8}}>
                {!hideAcquired&&<Btn onClick={()=>togAcq(viewItem.id)} style={{flex:1,padding:9,borderRadius:8,border:"2px solid #444444",background:viewItem.acquired?"#444444":"transparent",color:viewItem.acquired?"#222222":"#444444",fontWeight:700,fontSize:13}}>{viewItem.acquired?"✓ 습득완료":"○ 습득체크"}</Btn>}
                <Btn onClick={()=>openEdit(viewItem)} style={{padding:"9px 12px",borderRadius:8,border:"2px solid #8a7060",background:"transparent",color:"#8a7060",fontSize:13}}>수정</Btn>
                <Btn onClick={()=>delItem(viewItem.id)} style={{padding:"9px 12px",borderRadius:8,border:"2px solid #c0503a",background:"transparent",color:"#e05050",fontSize:13}}>삭제</Btn>
              </div>
            </div>
          </Modal>
        </Overlay>
      )}

      {modal&&<AddModal categories={categories} colorCats={colorCats} editItem={editItem} onSave={handleSave} onClose={()=>setModal(false)} cdnConfig={cdnConfig}/>}

      {settings&&(
        <Overlay onClick={()=>setSettings(false)}>
          <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:460,maxHeight:"86vh",overflowY:"auto"}}>
            <h2 style={{margin:"0 0 16px",fontSize:17,fontWeight:700}}>⚙️ 설정</h2>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>습득 체크 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>습득 체크 버튼을 숨깁니다</div></div>
              <Toggle value={hideAcquired} onChange={setHideAcquired}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>수량 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>수량 표시를 숨깁니다</div></div>
              <Toggle value={hideQuantity} onChange={setHideQuantity}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8",marginBottom:16}}>
              <div><div style={{fontWeight:700,fontSize:14}}>이름 생략 모드</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>켜면 긴 이름을 …으로 생략, 끄면 줄바꿈으로 전체 표시</div></div>
              <Toggle value={nameEllipsis} onChange={setNameEllipsis}/>
            </div>
            {/* 엑셀 가져오기 */}
            <div style={{marginBottom:16,padding:"12px 14px",background:"#f0f8f0",borderRadius:10,border:"1.5px solid #b0d8b0"}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#2a5a2a"}}>📊 엑셀로 항목 가져오기</div>
              <div style={{fontSize:11,color:"#5a8060",marginBottom:8,lineHeight:1.5}}>
                엑셀 파일 형식: <b>A이름 · B색상 · C수량 · D금액 · E카테고리 · F메모</b><br/>
                1행은 헤더(제목)로 인식됩니다.
              </div>
              <div style={{position:"relative",borderRadius:7,overflow:"hidden"}}>
                <button type="button" style={{width:"100%",padding:"9px",borderRadius:7,border:"2px solid #b0d8b0",background:"#e0f0e0",color:"#2a5a2a",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  📂 엑셀 파일 선택 (.xlsx / .csv)
                </button>
                <input type="file" accept=".xlsx,.xls,.csv"
                  style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}
                  onChange={e=>{
                    const f=e.target.files?.[0]; if(!f)return;
                    const name=f.name.toLowerCase();
                    // CSV는 직접 처리, XLSX는 cdnjs SheetJS로 처리
                    if(name.endsWith(".csv")){
                      const reader=new FileReader();
                      reader.onload=ev=>{
                        try{
                          const lines=ev.target.result.replace(/\r/g,"").split("\n").filter(l=>l.trim());
                          if(lines.length<2){showToast("데이터가 없습니다");return;}
                          const newItems=lines.slice(1).map(line=>{
                            const cols=line.split(',').map(s=>{const t=s.trim();return t.startsWith('"')&&t.endsWith('"')?t.slice(1,-1):t;});
                            if(!cols[0])return null;
                            // A이름 B색상 C수량 D금액 E카테고리 F메모
                            return{id:nextId.current++,name:cols[0]||"",colorCat:cols[1]||"",quantity:parseInt(cols[2])||1,price:parseInt(cols[3])||0,category:cols[4]||categories[0]||"기타",note:cols[5]||"",acquired:false,date:new Date().toISOString().split("T")[0],image:null};
                          }).filter(Boolean);
                          if(!newItems.length){showToast("유효한 항목이 없습니다");return;}
                          // 중복 체크 (새 항목끼리 + 기존 항목과)
                          setItems(prev=>{
                            const all=[...prev];
                            const checked=newItems.map(ni=>{
                              const isDup=all.some(it=>it.name.trim()===ni.name.trim()&&it.colorCat===ni.colorCat);
                              return isDup?{...ni,category:"중복"}:ni;
                            });
                            // 기존 항목도 새 항목과 중복이면 중복 카테고리로
                            const updatedPrev=all.map(it=>{
                              const isDup=newItems.some(ni=>ni.name.trim()===it.name.trim()&&ni.colorCat===it.colorCat);
                              return isDup?{...it,category:"중복"}:it;
                            });
                            return [...updatedPrev,...checked];
                          });
                          showToast(`✓ ${newItems.length}개 항목을 가져왔습니다`);
                        }catch{showToast("파일을 읽을 수 없습니다");}
                      };
                      reader.readAsText(f,"utf-8");
                    } else {
                      // XLSX: cdnjs에서 SheetJS 동적 로드
                      const reader=new FileReader();
                      reader.onload=ev=>{
                        const script=document.createElement("script");
                        script.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                        script.onload=()=>{
                          try{
                            const XLSX=window.XLSX;
                            const wb=XLSX.read(ev.target.result,{type:"array"});
                            const ws=wb.Sheets[wb.SheetNames[0]];
                            const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
                            if(rows.length<2){showToast("데이터가 없습니다");return;}
                            const newItems=rows.slice(1).filter(r=>r[0]?.toString().trim()).map(r=>({
                              id:nextId.current++,name:r[0]?.toString().trim()||"",colorCat:r[1]?.toString().trim()||"",
                              quantity:parseInt(r[2])||1,price:parseInt(r[3])||0,
                              category:r[4]?.toString().trim()||categories[0]||"기타",note:r[5]?.toString().trim()||"",
                              acquired:false,date:new Date().toISOString().split("T")[0],image:null,
                            }));
                            if(!newItems.length){showToast("유효한 항목이 없습니다");return;}
                            setItems(prev=>{
                              const all=[...prev];
                              const checked=newItems.map(ni=>{
                                const isDup=all.some(it=>it.name.trim()===ni.name.trim()&&it.colorCat===ni.colorCat);
                                return isDup?{...ni,category:"중복"}:ni;
                              });
                              const updatedPrev=all.map(it=>{
                                const isDup=newItems.some(ni=>ni.name.trim()===it.name.trim()&&ni.colorCat===it.colorCat);
                                return isDup?{...it,category:"중복"}:it;
                              });
                              return [...updatedPrev,...checked];
                            });
                            showToast(`✓ ${newItems.length}개 항목을 가져왔습니다`);
                          }catch{showToast("파일을 읽을 수 없습니다");}
                        };
                        script.onerror=()=>showToast("라이브러리 로드 실패");
                        if(!window.XLSX) document.head.appendChild(script);
                        else script.onload();
                      };
                      reader.readAsArrayBuffer(f);
                    }
                    e.target.value="";
                  }}/>
              </div>
            </div>

            <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>카테고리 관리</div>
            <div style={{display:"flex",gap:7,marginBottom:9}}>
              <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCat()} placeholder="새 카테고리 이름" style={IS}/>
              <Btn onClick={addCat} style={{padding:"8px 12px",borderRadius:8,background:"#444444",border:"none",fontWeight:700,color:"#222222",whiteSpace:"nowrap",fontSize:13}}>추가</Btn>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18}}>
              {categories.map(c=>(
                <div key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#f8f8f8",border:"1.5px solid #dddddd",borderRadius:99,padding:"4px 10px 4px 12px"}}>
                  <span style={{fontSize:13}}>{c}</span>
                  <Btn onClick={()=>remCat(c)} style={{background:"none",border:"none",color:"#e05050",fontSize:15,padding:"0 0 0 4px",lineHeight:1}}>×</Btn>
                </div>
              ))}
            </div>
            <div style={{borderTop:"1px solid #e8dcc8",paddingTop:14}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:9}}>색상 카테고리 관리</div>
              <div style={{display:"flex",gap:7,marginBottom:9,alignItems:"center"}}>
                <input value={newCN} onChange={e=>setNewCN(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCC()} placeholder="색상 이름" style={{...IS,flex:1}}/>
                <input type="color" value={newCH} onChange={e=>setNewCH(e.target.value)} style={{width:38,height:36,borderRadius:7,border:"2px solid #dddddd",cursor:"pointer",padding:2}}/>
                <Btn onClick={addCC} style={{padding:"7px 12px",borderRadius:8,background:"#444444",border:"none",fontWeight:700,color:"#222222",whiteSpace:"nowrap",fontSize:13}}>추가</Btn>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {colorCats.map((col,idx)=>(
                  <div key={col.name+idx}>
                    {editCI===idx?(
                      <div style={{display:"flex",gap:6,alignItems:"center",background:"#f8f8f8",borderRadius:8,padding:"7px 10px",border:"1.5px solid #444444"}}>
                        <input value={editCN} onChange={e=>setEditCN(e.target.value)} style={{...IS,flex:1,padding:"5px 9px",fontSize:13}}/>
                        <input type="color" value={editCH} onChange={e=>setEditCH(e.target.value)} style={{width:34,height:32,borderRadius:6,border:"2px solid #dddddd",cursor:"pointer",padding:2}}/>
                        <Btn onClick={saveEC} style={{padding:"5px 10px",borderRadius:7,background:"#444444",border:"none",fontWeight:700,color:"#222222",fontSize:12}}>저장</Btn>
                        <Btn onClick={()=>setEditCI(null)} style={{padding:"5px 8px",borderRadius:7,background:"transparent",border:"1.5px solid #cccccc",color:"#666666",fontSize:12}}>취소</Btn>
                      </div>
                    ):(
                      <div style={{display:"flex",alignItems:"center",gap:8,background:"#f8f8f8",borderRadius:8,padding:"7px 11px",border:"1.5px solid #e0d4b8"}}>
                        <span style={{width:15,height:15,borderRadius:"50%",background:col.hex,flexShrink:0}}/>
                        <span style={{flex:1,fontSize:13,fontWeight:900}}>{col.name}</span>
                        <span style={{fontSize:10,color:"#aaa",fontFamily:"monospace"}}>{col.hex}</span>
                        <Btn onClick={()=>startEC(idx)} style={{padding:"3px 9px",borderRadius:6,border:"1.5px solid #cccccc",background:"transparent",color:"#666666",fontSize:12}}>수정</Btn>
                        <Btn onClick={()=>remCC(col.name)} style={{padding:"3px 7px",borderRadius:6,border:"1.5px solid #c0503a",background:"transparent",color:"#e05050",fontSize:12}}>삭제</Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* ══ Cloudinary 설정 ══ */}
            <div style={{borderTop:"1px solid #e8dcc8",paddingTop:14,marginTop:4}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#2a1008"}}>☁️ Cloudinary 연결 정보</div>
              <div style={{fontSize:12,color:"#666",marginBottom:8,background:"#f0f4ff",borderRadius:8,padding:"8px 12px",lineHeight:1.7}}>
                Cloud Name: <b>{cdnConfig?.cloudName}</b><br/>
                Upload Preset: <b>{cdnConfig?.uploadPreset}</b>
              </div>
              <Btn onClick={()=>setConfirm({msg:"Cloudinary 설정을 초기화할까요?\n(저장된 이미지 URL은 유지됩니다)",ok:()=>{try{localStorage.removeItem(CK);}catch{}setCdnConfig_(null);setConfirm(null);}})}
                style={{width:"100%",padding:"9px",borderRadius:8,border:"2px solid #c0503a",background:"transparent",color:"#e05050",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                🔄 Cloudinary 재설정
              </Btn>
            </div>
            {/* ══ JSON 백업 / 복원 ══ */}
            <div style={{borderTop:"1px solid #e8dcc8",paddingTop:14,marginTop:4}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#2a1008"}}>💾 데이터 백업 · 복원</div>
              <div style={{fontSize:11,color:"#888888",marginBottom:10,lineHeight:1.5}}>
                이미지는 Cloudinary에 안전하게 저장됩니다.<br/>
                JSON 백업에는 이미지 URL이 포함됩니다.<br/>
                복원 시 현재 데이터를 덮어씁니다.
              </div>
              <div style={{display:"flex",gap:8}}>
                {/* 내보내기 버튼 */}
                <Btn onClick={()=>{
                  const data={items,categories,colorCats,settings:{hideAcquired,hideQuantity,viewMode,gridCols,sortBy,nameEllipsis},exportedAt:new Date().toISOString()};
                  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
                  const url=URL.createObjectURL(blob);
                  const a=document.createElement("a");
                  a.href=url;
                  a.download=`모동숲_백업_${new Date().toISOString().slice(0,10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  showToast("✓ 백업 파일 저장됨");
                }} style={{flex:1,padding:"10px",borderRadius:8,border:"2px solid #444444",background:"#44444422",color:"#7a5a00",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  📥 JSON 내보내기
                </Btn>
                {/* 복원 버튼 */}
                <div style={{position:"relative",flex:1,borderRadius:8,overflow:"hidden"}}>
                  <button type="button" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #4a7ec9",background:"#4a7ec922",color:"#1a3a6a",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    📤 JSON 복원
                  </button>
                  <input type="file" accept=".json"
                    style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}
                    onChange={e=>{
                      const f=e.target.files?.[0]; if(!f)return;
                      const reader=new FileReader();
                      reader.onload=ev=>{
                        try{
                          const data=JSON.parse(ev.target.result);
                          if(!data.items||!Array.isArray(data.items)){showToast("올바른 백업 파일이 아닙니다");return;}
                          setItems(data.items);
                          if(data.categories)setCategories(data.categories);
                          if(data.colorCats)setColorCats(data.colorCats);
                          if(data.settings){
                            const s=data.settings;
                            if(s.hideAcquired!==undefined)setHideAcquired(s.hideAcquired);
                            else if(s.photoMode!==undefined){setHideAcquired(s.photoMode);setHideQuantity(s.photoMode);}
                            if(s.hideQuantity!==undefined)setHideQuantity(s.hideQuantity);
                            if(s.viewMode)setViewMode(s.viewMode);
                            if(s.gridCols)setGridCols(s.gridCols);
                            if(s.sortBy)setSortBy(s.sortBy);
                            if(s.nameEllipsis!==undefined)setNameEllipsis(s.nameEllipsis);
                          }
                          nextId.current=Math.max(100,...data.items.map(x=>x.id||0))+1;
                          showToast(`✓ ${data.items.length}개 항목 복원 완료`);
                        }catch{showToast("파일을 읽을 수 없습니다");}
                      };
                      reader.readAsText(f,"utf-8");
                      e.target.value="";
                    }}/>
                </div>
              </div>
            </div>

            <Btn onClick={()=>setSettings(false)} style={{marginTop:16,width:"100%",padding:11,borderRadius:8,background:"#222222",color:"#ffffff",border:"none",fontWeight:700,fontSize:14}}>닫기</Btn>
          </Modal>
        </Overlay>
      )}
    </div>
  );
}
