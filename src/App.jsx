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
  const parts=query.trim().split(/\s+/);
  // 특수태그([숫자만],[영어만],[자음ㄱ만],[습득] 등)는 OR 조건
  // 일반 텍스트 검색은 AND 조건
  const specialParts=parts.filter(p=>p.startsWith("[")&&p.endsWith("]"));
  const textParts=parts.filter(p=>!(p.startsWith("[")&&p.endsWith("]")));
  // 특수태그: 하나라도 해당되면 통과
  if(specialParts.length>0){
    const matchesSpecial=specialParts.some(part=>{
      if(part==="[습득]") return item.acquired===true;
      if(part==="[미습득]") return item.acquired===false;
      const spec=parseSpecialQuery(part);
      return spec?itemMatchesSpecial(item,spec):false;
    });
    if(!matchesSpecial)return false;
  }
  // 일반 텍스트: 전부 해당되어야 통과
  if(textParts.length>0){
    const fields=[dispName(item), item.note||"", item.category||""];
    if(!textParts.every(p=>fields.some(f=>matchSearch(f,p))))return false;
  }
  return true;
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

// ══════ 테마 정의 ══════
const THEMES={
  "블랙":    {name:"🖤 블랙",    header:"#222222", headerText:"#ffffff", headerSubText:"#aaaaaa", accent:"#4a7a4a", accentText:"#ffffff", bg:"#f8f5f0", card:"#ffffff", cardBorder:"#e0d8c8", cardEmpty:"#f5f5f5", cardIcon:"#c0b8a8", acquiredBorder:"#444444", itemName:"#222222", itemSub:"#888888", catActive:"#444444", catActiveText:"#ffffff", catInactiveText:"#666666", selectBar:"#1e3a5f", btnBg:"#333333", btnText:"#cccccc", btnBorder:"#666666", qtyBg:"rgba(0,0,0,.55)", qtyText:"#ffffff", priceBg:"rgba(30,60,30,.75)", priceText:"#a8e8a8"},
  "벚꽃":    {name:"🌸 벚꽃",    header:"#5a2a3a", headerText:"#ffe0ea", headerSubText:"#f0a0b8", accent:"#c0607a", accentText:"#ffffff", bg:"#fff5f8", card:"#ffffff", cardBorder:"#f0d0da", cardEmpty:"#fff8fa", cardIcon:"#e0a0b8", acquiredBorder:"#c0607a", itemName:"#3a1020", itemSub:"#a06070", catActive:"#c0607a", catActiveText:"#ffffff", catInactiveText:"#a06070", selectBar:"#5a2a3a", btnBg:"#6a3045", btnText:"#ffd0e0", btnBorder:"#8a5060", qtyBg:"rgba(90,42,58,.7)", qtyText:"#ffe0ea", priceBg:"rgba(80,20,40,.7)", priceText:"#ffb8cc"},
  "바다":    {name:"🌊 바다",    header:"#1a3a5a", headerText:"#c0e8ff", headerSubText:"#80b8e0", accent:"#2a7ab0", accentText:"#ffffff", bg:"#f0f8ff", card:"#ffffff", cardBorder:"#b8d8f0", cardEmpty:"#f0f8ff", cardIcon:"#80b8d8", acquiredBorder:"#2a7ab0", itemName:"#1a2a3a", itemSub:"#5080a0", catActive:"#2a7ab0", catActiveText:"#ffffff", catInactiveText:"#5080a0", selectBar:"#1a3a5a", btnBg:"#1e3a5a", btnText:"#a0d0f0", btnBorder:"#3a6080", qtyBg:"rgba(26,58,90,.7)", qtyText:"#c0e8ff", priceBg:"rgba(10,50,80,.7)", priceText:"#90d8f8"},
  "가을":    {name:"🍂 가을",    header:"#3a2010", headerText:"#ffe0b0", headerSubText:"#c09060", accent:"#c06820", accentText:"#ffffff", bg:"#fff8f0", card:"#ffffff", cardBorder:"#e8d0b0", cardEmpty:"#fff5ec", cardIcon:"#c09060", acquiredBorder:"#c06820", itemName:"#2a1800", itemSub:"#906040", catActive:"#c06820", catActiveText:"#ffffff", catInactiveText:"#906040", selectBar:"#3a2010", btnBg:"#3a2010", btnText:"#f0c080", btnBorder:"#7a5030", qtyBg:"rgba(58,32,16,.7)", qtyText:"#ffe0b0", priceBg:"rgba(80,40,10,.7)", priceText:"#ffc060"},
  "화이트":  {name:"🤍 화이트",  header:"#f0f0f0", headerText:"#222222", headerSubText:"#888888", accent:"#555555", accentText:"#ffffff", bg:"#ffffff", card:"#f8f8f8", cardBorder:"#e0e0e0", cardEmpty:"#f5f5f5", cardIcon:"#aaaaaa", acquiredBorder:"#555555", itemName:"#222222", itemSub:"#888888", catActive:"#444444", catActiveText:"#ffffff", catInactiveText:"#666666", selectBar:"#444444", btnBg:"#e8e8e8", btnText:"#333333", btnBorder:"#cccccc", qtyBg:"rgba(60,60,60,.7)", qtyText:"#ffffff", priceBg:"rgba(40,80,40,.7)", priceText:"#80d080"},
  "숲속노트": {name:"🌿 숲속노트", header:"#1e3d2a", headerText:"#e8f5e2", headerSubText:"#90c898", accent:"#2d7a4a", accentText:"#ffffff", bg:"#f5f0e8", card:"#fffdf7", cardBorder:"#d8e8d0", cardEmpty:"#f5f8f0", cardIcon:"#90b890", acquiredBorder:"#2d7a4a", itemName:"#1a2e1e", itemSub:"#6a9070", catActive:"#2d7a4a", catActiveText:"#ffffff", catInactiveText:"#6a9070", selectBar:"#1e3d2a", btnBg:"#243d2e", btnText:"#b8d8b8", btnBorder:"#3a6048", qtyBg:"rgba(20,50,30,.65)", qtyText:"#d0f0d0", priceBg:"rgba(15,60,30,.7)", priceText:"#90e8a8"},
  "딥다크":  {name:"🌙 딥다크",  header:"#0a0a0a", headerText:"#d0aaff", headerSubText:"#8855cc", accent:"#9933ff", accentText:"#ffffff", bg:"#0d0d0d", card:"#1a1a1a", cardBorder:"#4a2a8a", cardEmpty:"#222235", cardIcon:"#7755aa", acquiredBorder:"#9933ff", itemName:"#e8d8ff", itemSub:"#9977cc", catActive:"#7722dd", catActiveText:"#ffffff", catInactiveText:"#7755aa", selectBar:"#0a0a0a", btnBg:"#1a1a2e", btnText:"#cc88ff", btnBorder:"#5522aa", qtyBg:"rgba(80,0,160,.6)", qtyText:"#e0c0ff", priceBg:"rgba(60,0,120,.7)", priceText:"#cc88ff"},
  "파스텔":  {name:"🍬 파스텔",  header:"#f8f0ff", headerText:"#8855aa", headerSubText:"#cc99dd", accent:"#dd88cc", accentText:"#ffffff", bg:"#fdf8ff", card:"#ffffff", cardBorder:"#eebbee", cardEmpty:"#faf0ff", cardIcon:"#cc99dd", acquiredBorder:"#dd88cc", itemName:"#5a2a7a", itemSub:"#aa88bb", catActive:"#dd88cc", catActiveText:"#ffffff", catInactiveText:"#bb88cc", selectBar:"#e8d0f8", btnBg:"#f0e0f8", btnText:"#9966bb", btnBorder:"#ddbbed", qtyBg:"rgba(180,100,200,.5)", qtyText:"#ffffff", priceBg:"rgba(160,80,180,.5)", priceText:"#ffffff"},
  "레몬":   {name:"🍋 레몬",   header:"#3d3400", headerText:"#fff8cc", headerSubText:"#c8a820", accent:"#c8960a", accentText:"#ffffff", bg:"#fffde8", card:"#ffffff", cardBorder:"#f0e8b0", cardEmpty:"#fffae0", cardIcon:"#d4b840", acquiredBorder:"#c8960a", itemName:"#2a2000", itemSub:"#8a7020", catActive:"#c8960a", catActiveText:"#ffffff", catInactiveText:"#907828", selectBar:"#3a3000", btnBg:"#3a3000", btnText:"#ffe066", btnBorder:"#7a6010", qtyBg:"rgba(80,60,0,.55)", qtyText:"#fff8cc", priceBg:"rgba(100,70,0,.6)", priceText:"#ffe08a"},
  "산뜻":   {name:"🌼 산뜻",   header:"#ecdc75", headerText:"#ffffff", headerSubText:"#555533", accent:"#c9b032", accentText:"#dcbc18", bg:"#fff7cd", card:"#ffffff", cardBorder:"#e8e070", cardEmpty:"#faf8d8", cardIcon:"#c8b830", acquiredBorder:"#c9b032", itemName:"#444444", itemSub:"#777777", catActive:"#c9b032", catActiveText:"#ffffff", catInactiveText:"#666644", selectBar:"#c9b032", selectBarText:"#444422", btnBg:"#ecdc75", btnText:"#555533", btnBorder:"#c9b032", titleText:"#555544", activeText:"#dcbc18", qtyBg:"rgba(120,100,0,.55)", qtyText:"#fffacc", priceBg:"rgba(140,110,0,.6)", priceText:"#fff0a0"},
};
const DEF_THEME="블랙";
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
          style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:(cloudName.trim()&&uploadPreset.trim())?"#444444":"#cccccc",color:"#ffffff",fontSize:15,fontWeight:700,cursor:(cloudName.trim()&&uploadPreset.trim())?"pointer":"not-allowed",fontFamily:"inherit"}}>
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
  <button type="button" onClick={onClick} disabled={disabled} style={{fontFamily:"inherit",cursor:disabled?"not-allowed":"pointer",...style}}{...r}>{children}</button>
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
const Confirm=({message,onOk,onCancel,choices})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"#fff8f0",borderRadius:14,padding:"22px 20px",maxWidth:320,width:"100%"}}>
      <p style={{margin:"0 0 18px",fontSize:15,lineHeight:1.6,whiteSpace:"pre-line"}}>{message}</p>
      {choices?(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {choices.map(({label,fn},i)=>(
            <Btn key={i} onClick={fn} style={{padding:11,borderRadius:8,border:i===choices.length-1?"2px solid #cccccc":"none",background:i===choices.length-1?"transparent":i===0?"#4a7ec9":"#888888",color:i===choices.length-1?"#666666":"#fff",fontSize:14,fontWeight:700}}>{label}</Btn>
          ))}
        </div>
      ):(
        <div style={{display:"flex",gap:10}}>
          <Btn onClick={onCancel} style={{flex:1,padding:10,borderRadius:8,border:"2px solid #cccccc",background:"transparent",color:"#666666",fontSize:14,fontWeight:900}}>취소</Btn>
          <Btn onClick={onOk}    style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#e05050",color:"#fff",fontSize:14,fontWeight:700}}>삭제</Btn>
        </div>
      )}
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
const ImageCard=memo(function ImageCard({item,hideAcquired,hideQuantity,hidePrice,colorCats,selected,selectMode,onOpen,onToggle,onSelect,onLong,gridCols=3,nameEllipsis=true,nameFontSize=0}){
  const ref=useRef(null);
  const hex=item.colorCat?getHex(colorCats,item.colorCat):null;
  useTapLong(ref, ()=>(selectMode?onSelect:onOpen), ()=>onLong);
  const pos=item.imagePosition||"50% 50%";
  return(
    <div ref={ref} data-card="1" style={{position:"relative",background:"var(--t-card-bg,#fff)",border:`2px solid ${selected?"#4a7ec9":(item.acquired&&!hideAcquired?"var(--t-acquired-border,#444)":"var(--t-card-border)")}`,borderRadius:10,overflow:"hidden",cursor:"pointer",boxShadow:selected?"0 0 0 3px rgba(74,126,201,.3)":"0 2px 8px rgba(0,0,0,.07)",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none",touchAction:"pan-y"}}>
      {/* 이미지 영역: paddingTop:100% 유지 */}
      <div style={{position:"relative",paddingTop:"100%",overflow:"hidden",background:"var(--t-card-bg,#fff)"}}>
        {item.image
          ?<img src={item.image} alt="" draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:pos,background:"#fff"}}/>
          :<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:"var(--t-card-icon,#c0b8a8)",background:"var(--t-card-empty,#f8f8f8)"}}>🖼️</div>}
        {selectMode&&(
          <div style={{position:"absolute",top:5,left:5,width:26,height:26,borderRadius:6,border:`3px solid ${selected?"#4a7ec9":"rgba(80,80,80,.7)"}`,background:selected?"#4a7ec9":"rgba(255,255,255,.95)",display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",zIndex:10,boxShadow:"0 2px 6px rgba(0,0,0,.4)"}}>
            {selected&&<span style={{color:"#fff",fontSize:16,lineHeight:1}}>✓</span>}
          </div>
        )}
        {/* 금액 뱃지 */}
        {!hidePrice&&(item.price||0)>0&&(
          <div data-badge="price" style={{position:"absolute",bottom:5,right:5,background:"var(--t-price-bg)",color:"var(--t-price-text)",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:99,zIndex:5,pointerEvents:"none"}}>₩{(item.price||0).toLocaleString()}</div>
        )}
      </div>
      {/* 수량 뱃지 */}
      {!hideQuantity&&(item.quantity??1)>0&&(
        <div data-badge="qty" style={{position:"absolute",top:5,right:5,background:"var(--t-qty-bg)",color:"var(--t-qty-text)",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:99,zIndex:5,pointerEvents:"none"}}>×{item.quantity??1}</div>
      )}
      <div style={{padding:"4px 5px",textAlign:"center"}}>
        <div style={{fontWeight:700,fontSize:nameFontSize||( gridCols<=2?13:gridCols<=3?12:gridCols<=4?11:10),color:"var(--t-item-name,#222222)",textAlign:"center",
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
const ListRow=memo(function ListRow({item,hideAcquired,hideQuantity,hidePrice,colorCats,selected,selectMode,onOpen,onToggle,onSelect,onLong,nameFontSize=0}){
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
        <div style={{fontWeight:700,fontSize:nameFontSize||11,color:"var(--t-item-name,#222222)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {item.name}{item.colorCat&&<span style={{color:hex}}> - {item.colorCat}</span>}
        </div>
        <div style={{fontSize:11,color:"var(--t-item-sub,#888888)",marginTop:1}}>{item.category}{item.note?` · ${item.note}`:""}</div>
      </div>
      {!hideQuantity&&(item.quantity??1)>0&&<div style={{background:"var(--t-qty-bg)",color:"var(--t-qty-text)",fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:99,flexShrink:0}}>×{item.quantity??1}</div>}
      {!hidePrice&&item.price>0&&<div style={{background:"var(--t-price-bg)",color:"var(--t-price-text)",fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:99,flexShrink:0,whiteSpace:"nowrap"}}>₩{((item.price||0)*(item.quantity??1)).toLocaleString()}</div>}
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
//  CatInput — 카테고리/색상 추가 입력창 (완전 독립 컴포넌트)
// ══════════════════════════════════════════════════════════════
function CatInput({onAdd,IS,colorPicker=false,newCH,setNewCH}){
  const [key,setKey]=useState(0);
  const valRef=useRef("");
  const submit=()=>{
    const v=valRef.current.trim();
    if(!v)return;
    onAdd(v);
    valRef.current="";
    setKey(k=>k+1); // input을 완전히 새로 마운트 → 값/이벤트 초기화
  };
  return(
    <div style={{display:"flex",gap:7,marginBottom:9,alignItems:"center"}}>
      <input key={key}
        defaultValue=""
        onChange={e=>{valRef.current=e.target.value;}}
        onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submit();}}}
        placeholder={colorPicker?"색상 이름":"새 카테고리 이름"}
        style={colorPicker?{...IS,flex:1}:IS}/>
      {colorPicker&&<input type="color" value={newCH} onChange={e=>setNewCH(e.target.value)} style={{width:38,height:36,borderRadius:7,border:"2px solid #dddddd",cursor:"pointer",padding:2}}/>}
      <button type="button"
        onMouseDown={e=>e.preventDefault()}
        onTouchStart={e=>e.preventDefault()}
        onClick={submit}
        style={{padding:"8px 12px",borderRadius:8,background:"#444444",border:"none",fontWeight:700,color:"#ffffff",whiteSpace:"nowrap",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>추가</button>
    </div>
  );
}

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
            style={{padding:"7px 16px",borderRadius:8,border:"none",background:(name.trim()&&!uploading)?"#444444":"#bbbbbb",color:"#ffffff",fontSize:14,fontWeight:700,cursor:(name.trim()&&!uploading)?"pointer":"not-allowed"}}>
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
          <Btn onClick={onClose} style={{flex:1,padding:11,borderRadius:8,border:"2px solid #aaaaaa",background:"transparent",color:"#444444",fontSize:14,fontWeight:900}}>취소</Btn>
          <Btn onClick={()=>{if(name.trim()&&!uploading)onSave({name:name.trim(),category,colorCat,note,image,imagePosition,quantity,price});}}
            disabled={uploading}
            style={{flex:2,padding:11,borderRadius:8,border:"none",background:(name.trim()&&!uploading)?"#444444":"#bbbbbb",color:"#ffffff",fontSize:14,fontWeight:700}}>
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
function VirtualGrid({items,cols,hideAcquired,hideQuantity,hidePrice,colorCats,sel,selectMode,nameEllipsis,nameFontSize=0,onOpen,onToggle,onSelect,onLong}){
  const [cardH,setCardH]=useState(160);
  const [containerW,setContainerW]=useState(0);
  const measureRef=useRef(null);
  const wrapRef=useRef(null);

  useEffect(()=>{
    if(measureRef.current){
      const h=measureRef.current.getBoundingClientRect().height;
      if(h>40)setCardH(h+8);
    }
  });

  // ResizeObserver로 실제 컨테이너 너비를 정확히 측정
  // window.innerWidth는 핀치줌/viewport 미설정 시 부정확해서 사용 안 함
  useEffect(()=>{
    const el=wrapRef.current; if(!el) return;
    const ro=new ResizeObserver(entries=>{
      const w=entries[0]?.contentRect?.width||el.offsetWidth;
      if(w>0) setContainerW(w);
    });
    ro.observe(el);
    setContainerW(el.offsetWidth);
    return()=>ro.disconnect();
  },[]);

  const GAP=8;
  const effectiveW=containerW>0?containerW:window.innerWidth;
  const cardW=Math.floor((effectiveW-(GAP*(cols-1)))/cols);
  const rowH=cardH;
  const {containerRef,visibleItems,totalH,paddingTop,paddingBottom}=useVirtualGrid(items,cols,rowH);

  return(
    <div ref={wrapRef} style={{width:"100%"}}>
      <div ref={containerRef} style={{position:"relative",minHeight:totalH}}>
        <div style={{height:paddingTop}}/>
        <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},${cardW>0?cardW+"px":"1fr"})`,gap:GAP,justifyContent:"start"}}>
          {visibleItems.map(({item,idx})=>(
            <div key={item.id} ref={idx===0?measureRef:null}>
              <ImageCard item={item} hideAcquired={hideAcquired} hideQuantity={hideQuantity} hidePrice={hidePrice} colorCats={colorCats}
                selected={sel.has(item.id)} selectMode={selectMode} gridCols={cols} nameEllipsis={nameEllipsis} nameFontSize={nameFontSize}
                onOpen={()=>onOpen(item)} onToggle={()=>onToggle(item.id)}
                onSelect={()=>onSelect(item.id)} onLong={pos=>onLong(pos,item)}/>
            </div>
          ))}
        </div>
        <div style={{height:paddingBottom}}/>
      </div>
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
  const [themeOpen,setThemeOpen]=useState(false);
  const [hideQuantity,setHideQuantity]=useState(false);
  const [hidePrice,setHidePrice]=useState(false);
  const [themeName,setThemeName]=useState(DEF_THEME);
  const [customTheme,setCustomTheme]=useState({header:"#222222",bg:"#f8f5f0",accent:"#4a7a4a"});
  const [viewMode,setViewMode]=useState("이미지형");
  const [gridCols,setGridCols]=useState(3);
  const [sortBy,setSortBy]=useState("date-desc");
  const [search,setSearch]=useState("");
  const [activeCats,setActiveCats]=useState([]);
  const [modal,setModal]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [viewItem,setViewItem]=useState(null);
  const [settings,setSettings]=useState(false);
  const [settingsTab,setSettingsTab]=useState("표시");
  const [settingsExpanded,setSettingsExpanded]=useState(false);
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
  const [nameFontSize,setNameFontSize]=useState(0); // 0=기본(자동)
  const [hideCapture,setHideCapture]=useState(false);
  const [newCat,setNewCat]=useState("");
  const [newCN,setNewCN]=useState("");
  const [newCH,setNewCH]=useState("#888888");
  const [editCI,setEditCI]=useState(null);
  const [editCatIdx,setEditCatIdx]=useState(null);
  const [editCN,setEditCN]=useState("");
  const [editCH,setEditCH]=useState("#888888");
  const [headerVis,setHeaderVis]=useState(true);
  const [hdrH,setHdrH]=useState(130);

  const nextId=useRef(100),toastT=useRef(null),stRef=useRef(null),hashRef=useRef(""),readyRef=useRef(false),saveT=useRef(null),saving=useRef(false),lastSY=useRef(0),hdrRef=useRef(null),newCatRef=useRef(null),newCNRef=useRef(null),captureRef=useRef(null);

  useEffect(()=>{stRef.current={items,categories,colorCats,settings:{hideAcquired,hideQuantity,hidePrice,viewMode,gridCols,sortBy,nameEllipsis,nameFontSize,themeName,customTheme}};},[items,categories,colorCats,hideAcquired,hideQuantity,hidePrice,viewMode,gridCols,sortBy,themeName,customTheme,nameFontSize]);
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

  // viewport 메타태그 강제 설정 — Hook 규칙상 조건부 return 이전에 위치
  useEffect(()=>{
    let vp=document.querySelector('meta[name="viewport"]');
    if(!vp){vp=document.createElement("meta");vp.name="viewport";document.head.appendChild(vp);}
    vp.content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
  },[]);

  const captureCountRef=useRef(null);
  if(!captureCountRef.current){
    try{
      const saved=JSON.parse(localStorage.getItem("rds_cap")||"{}");
      const today=new Date().toISOString().slice(0,10);
      captureCountRef.current=(saved.date===today)?{...saved}:{date:today,count:0};
    }catch(e){
      captureCountRef.current={date:new Date().toISOString().slice(0,10),count:0};
    }
  }

  const showToast=msg=>{setToast(msg);clearTimeout(toastT.current);toastT.current=setTimeout(()=>setToast(""),2200);};

  const doCapture=useCallback(()=>{
    const grid=captureRef.current; if(!grid){showToast("캡쳐 영역 없음");return;}
    const cards=[...grid.querySelectorAll("[data-card]")];
    if(!cards.length){showToast("캡쳐할 항목이 없습니다");return;}

    const viewBottom=window.innerHeight;
    const targetCards=cards.filter(c=>{
      const r=c.getBoundingClientRect();
      return r.top>=-4 && r.bottom<=viewBottom+4;
    });
    if(!targetCards.length) targetCards.push(...cards.slice(0,4));

    const SCALE=window.devicePixelRatio||2;
    const PAD=10;
    const bg=getComputedStyle(grid).backgroundColor||"#f8f5f0";

    // 카드 범위 계산 (viewport 기준)
    let minTop=Infinity,maxBottom=-Infinity,minLeft=Infinity,maxRight=-Infinity;
    for(const c of targetCards){
      const r=c.getBoundingClientRect();
      minTop=Math.min(minTop,r.top); maxBottom=Math.max(maxBottom,r.bottom);
      minLeft=Math.min(minLeft,r.left); maxRight=Math.max(maxRight,r.right);
    }
    const totalW=Math.round(maxRight-minLeft);
    const totalH=Math.round(maxBottom-minTop);

    const out=document.createElement("canvas");
    out.width=(totalW+PAD*2)*SCALE;
    out.height=(totalH+PAD*2)*SCALE;
    const ctx=out.getContext("2d");
    ctx.scale(SCALE,SCALE);
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,out.width,out.height);

    // 각 카드를 canvas에 직접 그리기
    const drawCard=(card)=>new Promise(resolve=>{
      const r=card.getBoundingClientRect();
      const x=r.left-minLeft+PAD;
      const y=r.top-minTop+PAD;
      const w=r.width;
      const h=r.height;
      const cardBg=getComputedStyle(card).backgroundColor||"#fff";
      const radius=10;

      // 카드 배경 (둥근 모서리)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x+radius,y); ctx.lineTo(x+w-radius,y);
      ctx.quadraticCurveTo(x+w,y,x+w,y+radius);
      ctx.lineTo(x+w,y+h-radius);
      ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);
      ctx.lineTo(x+radius,y+h);
      ctx.quadraticCurveTo(x,y+h,x,y+h-radius);
      ctx.lineTo(x,y+radius);
      ctx.quadraticCurveTo(x,y,x+radius,y);
      ctx.closePath();
      ctx.fillStyle=cardBg;
      ctx.fill();
      ctx.strokeStyle=getComputedStyle(card).borderColor||"#e0d8c8";
      ctx.lineWidth=1.5;
      ctx.stroke();
      ctx.clip();

      // 이미지 영역 (정사각형)
      const imgDiv=card.querySelector("div[style*='paddingTop']");
      const imgH=imgDiv?imgDiv.offsetWidth:w;
      const imgEl=card.querySelector("img");

      const drawTextAndBadges=()=>{
        ctx.restore();

        // 텍스트 영역
        const nameDiv=card.querySelector("div[style*='fontWeight']");
        if(nameDiv){
          const nameRect=nameDiv.getBoundingClientRect();
          const ny=nameRect.top-minTop+PAD;
          const nh=nameRect.height;
          const fs=parseFloat(getComputedStyle(nameDiv).fontSize)||11;
          ctx.save();
          ctx.font=`700 ${fs}px sans-serif`;
          ctx.fillStyle=getComputedStyle(nameDiv).color||"#222";
          ctx.textAlign="center";
          ctx.textBaseline="middle";
          // 텍스트가 여러 줄이면 줄바꿈 처리
          const text=nameDiv.textContent||"";
          const maxW=w-8;
          const lines=[];
          let line="";
          for(const ch of text){
            const test=line+ch;
            if(ctx.measureText(test).width>maxW&&line){
              lines.push(line); line=ch;
            } else line=test;
          }
          if(line) lines.push(line);
          const lh=fs*1.3;
          const startY=ny+nh/2-(lines.length-1)*lh/2;
          lines.forEach((l,i)=>ctx.fillText(l,x+w/2,startY+i*lh,maxW));
          ctx.restore();
        }

        // 뱃지 그리기
        const badges=card.querySelectorAll("[data-badge]");
        for(const b of badges){
          const br2=b.getBoundingClientRect();
          const bx=br2.left-minLeft+PAD;
          const by2=br2.top-minTop+PAD;
          const bw=br2.width;
          const bh=br2.height;
          if(bw<2||bh<2) continue;
          const bStyle=getComputedStyle(b);
          const br=bh/2;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(bx+br,by2); ctx.lineTo(bx+bw-br,by2);
          ctx.arc(bx+bw-br,by2+br,br,-Math.PI/2,Math.PI/2);
          ctx.lineTo(bx+br,by2+bh);
          ctx.arc(bx+br,by2+br,br,Math.PI/2,Math.PI*1.5);
          ctx.closePath();
          ctx.fillStyle=bStyle.backgroundColor;
          ctx.fill();
          ctx.font=`700 ${parseFloat(bStyle.fontSize)||10}px sans-serif`;
          ctx.fillStyle=bStyle.color;
          ctx.textAlign="center";
          ctx.textBaseline="middle";
          ctx.fillText(b.textContent.trim(),bx+bw/2,by2+bh/2);
          ctx.restore();
        }
        resolve();
      };

      if(imgEl&&imgEl.complete&&imgEl.naturalWidth>0){
        ctx.drawImage(imgEl,x,y,w,imgH);
        drawTextAndBadges();
      } else {
        // 이미지 없음 - 빈 배경
        ctx.fillStyle=getComputedStyle(imgDiv||card).backgroundColor||"#f5f5f5";
        ctx.fillRect(x,y,w,imgH);
        drawTextAndBadges();
      }
    });

    Promise.all(targetCards.map(drawCard)).then(()=>{
      const today=new Date().toISOString().slice(0,10);
      if(captureCountRef.current.date!==today){
        captureCountRef.current={date:today,count:1};
      } else {
        captureCountRef.current.count+=1;
      }
      try{ localStorage.setItem("rds_cap",JSON.stringify(captureCountRef.current)); }catch(e){}
      const fname=`링동숲_${today}-${captureCountRef.current.count}.png`;
      const a=document.createElement("a");
      a.href=out.toDataURL("image/png");
      a.download=fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`✓ 저장됨 (${fname})`);
    });
  // eslint-disable-next-line
  },[]);
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
      setHideAcquired(s?.hideAcquired??s?.photoMode??false);setHideQuantity(s?.hideQuantity??s?.photoMode??false);setHidePrice(s?.hidePrice??false);setViewMode(s?.viewMode??"이미지형");setGridCols(s?.gridCols??3);setSortBy(s?.sortBy??"date-desc");setNameEllipsis(s?.nameEllipsis??true);if(s?.nameFontSize!==undefined)setNameFontSize(s.nameFontSize);
      if(s?.themeName)setThemeName(s.themeName);if(s?.customTheme)setCustomTheme(s.customTheme);
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
        setHideAcquired(s?.hideAcquired??s?.photoMode??false);setHideQuantity(s?.hideQuantity??s?.photoMode??false);setHidePrice(s?.hidePrice??false);setViewMode(s?.viewMode??"이미지형");setGridCols(s?.gridCols??3);setSortBy(s?.sortBy??"date-desc");setNameEllipsis(s?.nameEllipsis??true);if(s?.nameFontSize!==undefined)setNameFontSize(s.nameFontSize);
        if(s?.themeName)setThemeName(s.themeName);if(s?.customTheme)setCustomTheme(s.customTheme);
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

  // 수량 0이면 "[0]" 카테고리로 자동 이동 (단, 이미 "[0]"이면 유지)
  const applyZeroQty=useCallback((item)=>{
    if((item.quantity??1)===0 && item.category!=="0") return {...item,category:"0"};
    return item;
  },[]);

  const handleSave=useCallback(form=>{
    if(editItem){
      setItems(p=>{
        const updated=p.map(it=>it.id===editItem.id?{...it,...form}:it);
        const others=updated.filter(it=>it.id!==editItem.id);
        return updated.map(it=>it.id===editItem.id?applyZeroQty(applyDupCheck(it,others)):it);
      });
    } else {
      setItems(p=>{
        const newItem={id:nextId.current++,acquired:false,date:new Date().toISOString().split("T")[0],...form};
        const checked=applyZeroQty(applyDupCheck(newItem,p));
        const updatedP=p.map(it=>
          it.name.trim()===newItem.name.trim()&&it.colorCat===newItem.colorCat
            ?{...it,category:"중복"}:it
        );
        return [...updatedP,checked];
      });
    }
    setModal(false);
  },[editItem,applyDupCheck,applyZeroQty]);
  const copyItem=useCallback(it=>{setItems(p=>[...p,{...it,id:nextId.current++,name:`${it.name} (복사)`,date:new Date().toISOString().split("T")[0]}]);setCtx(null);showToast("📋 복사됨");},[]);
  const togAcq=useCallback((id)=>{setItems(p=>p.map(it=>it.id===id?{...it,acquired:!it.acquired}:it));setViewItem(v=>v?.id===id?{...v,acquired:!v.acquired}:v);},[]);
  const delItem=useCallback(id=>{setCtx(null);setConfirm({msg:"이 항목을 삭제할까요?",ok:()=>{setItems(p=>p.filter(it=>it.id!==id));setViewItem(null);setConfirm(null);}});},[]);
  const togSel=useCallback(id=>setSel(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;}),[]);
  const clearSel=useCallback(()=>{setSel(new Set());setSelectMode(false);},[]);
  const doBulkDel=useCallback(()=>{if(!sel.size)return;const ids=new Set(sel);setConfirm({msg:`${ids.size}개 항목을 삭제할까요?`,ok:()=>{setItems(p=>p.filter(it=>!ids.has(it.id)));clearSel();setConfirm(null);}});},[sel,clearSel]);
  const doBulkMove=useCallback(()=>{if(!bulkCat)return;const ids=new Set(sel);setItems(p=>p.map(it=>ids.has(it.id)?{...it,category:bulkCat}:it));setBulkMove(false);clearSel();},[bulkCat,sel,clearSel]);
  const doBulkCopy=useCallback(()=>{if(!bulkCat)return;const ids=new Set(sel);setItems(p=>[...p,...p.filter(it=>ids.has(it.id)).map(it=>({...it,id:nextId.current++,name:`${it.name} [복사]`,category:bulkCat,date:new Date().toISOString().split("T")[0]}))]);setBulkMove(false);clearSel();showToast(`📋 ${ids.size}개 복사됨`);},[bulkCat,sel,clearSel]);
  const addCat=()=>{
    const v=(newCatRef.current?.value||"").trim();
    if(!v)return;
    if(!categories.includes(v))setCategories(p=>[...p,v]);
    setNewCat("");
    if(newCatRef.current)newCatRef.current.value="";
  };
  const addCC=()=>{
    const v=(newCNRef.current?.value||"").trim();
    if(!v)return;
    if(!colorCats.find(c=>c.name===v))setColorCats(p=>[...p,{name:v,hex:newCH}]);
    setNewCN("");setNewCH("#888888");
    if(newCNRef.current)newCNRef.current.value="";
  };
  const remCat=c=>{
    const count=items.filter(it=>it.category===c).length;
    if(count===0){setCategories(p=>p.filter(x=>x!==c));setActiveCats(p=>p.filter(x=>x!==c));return;}
    setConfirm({
      msg:`"${c}" 카테고리에 항목이 ${count}개 있어요.\n삭제 후 항목을 어떻게 처리할까요?`,
      choices:[
        {label:"기타로 이동",fn:()=>{setItems(p=>p.map(it=>it.category===c?{...it,category:"기타"}:it));setCategories(p=>p.filter(x=>x!==c));setActiveCats(p=>p.filter(x=>x!==c));setConfirm(null);}},
        {label:"빈값으로 처리",fn:()=>{setItems(p=>p.map(it=>it.category===c?{...it,category:""}:it));setCategories(p=>p.filter(x=>x!==c));setActiveCats(p=>p.filter(x=>x!==c));setConfirm(null);}},
        {label:"취소",fn:()=>setConfirm(null)},
      ]
    });
  };
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

  // 현재 테마 계산
  const theme = themeName==="커스텀"
    ? {...THEMES["블랙"], header:customTheme.header, bg:customTheme.bg, accent:customTheme.accent, accentText:"#ffffff", catActive:customTheme.accent, catActiveText:"#ffffff", selectBar:customTheme.header, btnBg:customTheme.header}
    : (THEMES[themeName]??THEMES["블랙"]);

  return(
    <div style={{fontFamily:"'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif",minHeight:"100vh",letterSpacing:"0.05em",background:theme.bg,color:"#222222",
      "--t-qty-bg":theme.qtyBg,"--t-qty-text":theme.qtyText,"--t-price-bg":theme.priceBg,"--t-price-text":theme.priceText,"--t-card-border":theme.cardBorder,"--t-cat-inactive":theme.catInactiveText,"--t-card-bg":theme.card,"--t-card-empty":theme.cardEmpty,"--t-card-icon":theme.cardIcon,"--t-acquired-border":theme.acquiredBorder,"--t-item-name":theme.itemName,"--t-item-sub":theme.itemSub}}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet"/>

      {/* 토스트 */}
      <div style={{position:"fixed",bottom:22,right:16,zIndex:999,pointerEvents:"none",opacity:toast?1:0,transform:toast?"translateY(0)":"translateY(10px)",transition:"all .3s"}}>
        <div style={{background:"#222222",color:"#ffffff",padding:"7px 14px",borderRadius:99,fontSize:13,fontWeight:900}}>{toast}</div>
      </div>
      {showSyncLbl&&<div style={{position:"fixed",top:5,right:5,zIndex:200,fontSize:7,color:"#888",background:"rgba(255,255,255,.88)",borderRadius:99,padding:"2px 8px",pointerEvents:"none",transition:"opacity .5s",opacity:showSyncLbl?1:0}}>{syncLbl}</div>}
      {ctx&&<CtxMenu x={ctx.x} y={ctx.y} onCopy={()=>copyItem(ctx.item)} onEdit={()=>openEdit(ctx.item)} onDelete={()=>delItem(ctx.item.id)} onClose={()=>setCtx(null)}/>}

      {/* 헤더 — 크롬/모바일 모두 동일하게 보이도록 단순 구조 */}
      <header ref={hdrRef} style={{background:theme.header,padding:"10px 14px 8px",position:"fixed",top:0,left:0,right:0,zIndex:100,boxShadow:"0 2px 16px rgba(0,0,0,.45)",transition:"transform .3s",transform:headerVis?"translateY(0)":"translateY(-100%)"}}>

        {/* Row 1: 타이틀 + 추가 + 통계 + 저장 */}
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"nowrap"}}>
          <span style={{fontSize:22,fontWeight:900,color:theme.titleText||theme.headerText,flexShrink:0}}>🍃 링동숲</span>
          <Btn onClick={openAdd} style={{...HB,background:theme.headerText,color:theme.header,padding:"5px 13px",fontSize:15,flexShrink:0,border:"none"}}>+ 추가</Btn>
          <span style={{fontSize:14,color:theme.headerSubText,whiteSpace:"nowrap",flexShrink:0}}>전체 <b onClick={()=>{setActiveCats([]);setSearch("");}} style={{color:theme.titleText||theme.headerText,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}>{items.length}</b> · 습득 <b onClick={()=>{setActiveCats([]);setSearch("[습득]");}} style={{color:theme.titleText||theme.headerText,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}>{acq}</b></span>
          <div style={{flex:1}}/>
          <Btn onClick={()=>doSave(false)} style={{...HB,background:unsaved?"#f5c842":theme.btnBg,color:unsaved?"#222222":theme.btnText,border:`1.5px solid ${unsaved?"#f5c842":theme.btnBorder}`,padding:"5px 11px",fontSize:14,flexShrink:0,boxShadow:unsaved?"0 0 6px rgba(245,200,66,.5)":"none"}}>
            {unsaved?"💾 저장":"✓ 저장됨"}
          </Btn>
        </div>

        {/* Row 2: 검색 + 정렬 */}
        <div style={{display:"flex",gap:6,marginBottom:4}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 검색 · [숫자만] [영어만] [자음ㄱ만]…" style={{flex:1,padding:"6px 10px",borderRadius:7,border:`1.5px solid ${theme.btnBorder}`,background:theme.btnBg,color:theme.btnText,fontFamily:"inherit",fontSize:14,outline:"none",minWidth:0}}/>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{padding:"5px 4px",borderRadius:7,border:`1.5px solid ${theme.btnBorder}`,background:theme.btnBg,color:theme.btnText,fontFamily:"inherit",fontSize:14,cursor:"pointer",flexShrink:0,maxWidth:110}}>
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
                setSearch(p=>p.includes(tag)?p.replace(tag,"").trim():((p?p+" ":"")+tag).trim());
              }}
                style={{padding:"3px 7px",borderRadius:99,border:`1.5px solid ${active?theme.headerText:theme.btnBorder}`,background:active?theme.headerText:theme.btnBg,color:active?(theme.activeText||theme.header):theme.btnText,fontSize:12,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>
                {{"숫자":"숫자","영어":"영어","ㄱ":"ㄱ·ㄲ","ㄴ":"ㄴ","ㄷ":"ㄷ·ㄸ","ㄹ":"ㄹ","ㅁ":"ㅁ","ㅂ":"ㅂ·ㅃ","ㅅ":"ㅅ·ㅆ","ㅇ":"ㅇ","ㅈ":"ㅈ·ㅉ","ㅊ":"ㅊ","ㅋ":"ㅋ","ㅌ":"ㅌ","ㅍ":"ㅍ","ㅎ":"ㅎ"}[k]}
              </button>
            );
          })}
        </div>

        {/* Row 3: 뷰 + 열 + 선택 + 설정 */}
        <div style={{display:"flex",gap:5,alignItems:"center",overflowX:"auto",paddingBottom:2,scrollbarWidth:"none",msOverflowStyle:"none"}}>
          <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1.5px solid ${theme.btnBorder}`,flexShrink:0}}>
            {["이미지형","목록형"].map(m=>(
              <Btn key={m} onClick={()=>{setViewMode(m);setGridCols(m==="목록형"?1:3);}} style={{...HB,borderRadius:0,padding:"5px 9px",fontSize:14,background:viewMode===m?theme.headerText:theme.btnBg,color:viewMode===m?(theme.activeText||theme.header):theme.btnText}}>{m}</Btn>
            ))}
          </div>
          <>
            <span style={{color:theme.btnText,fontSize:14,flexShrink:0}}>열:</span>
            {(viewMode==="목록형"?[1,2]:GRID_COLS).map(n=>(
              <Btn key={n} onClick={()=>setGridCols(n)} style={{...HB,padding:"4px 8px",background:gridCols===n?theme.headerText:theme.btnBg,color:gridCols===n?(theme.activeText||theme.header):theme.btnText,border:`1.5px solid ${theme.btnBorder}`,borderRadius:6,fontSize:14,flexShrink:0,minWidth:28,textAlign:"center"}}>{n}</Btn>
            ))}
          </>
          <Btn onClick={()=>{setSelectMode(s=>!s);setSel(new Set());}} style={{...HB,background:selectMode?theme.accent:theme.btnBg,color:selectMode?theme.accentText:theme.btnText,border:`1.5px solid ${theme.btnBorder}`,padding:"5px 10px",fontSize:14,flexShrink:0,height:"34px",boxSizing:"border-box",display:"flex",alignItems:"center"}}>
            {selectMode?"☑️ 선택중":"☑️ 선택"}
          </Btn>
          <Btn onClick={()=>setSettings(true)} style={{...HB,background:theme.btnBg,color:theme.btnText,border:`1.5px solid ${theme.btnBorder}`,padding:"1px 10px",fontSize:18,flexShrink:0,lineHeight:"24px",height:"34px",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center"}}>⚙️</Btn>
        </div>
      </header>

      {selectMode&&(
        <div style={{background:theme.selectBar,padding:"8px 14px",position:"fixed",top:headerVis?hdrH:0,left:0,right:0,zIndex:99,transition:"top .3s",boxShadow:"0 2px 10px rgba(0,0,0,.3)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,overflowX:"auto",scrollbarWidth:"none"}}>
            <span style={{color:theme.selectBarText||"#a8c8f0",fontSize:13,fontWeight:700,flexShrink:0}}>
              {sel.size}개
              {[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+(it?.quantity??1);},0) !== sel.size &&
                <span style={{color:theme.selectBarText||"#c8d8f0",fontWeight:400}}> ({[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+(it?.quantity??1);},0)}개)</span>
              }
            </span>
            {[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+((it?.price||0)*(it?.quantity??1));},0)>0&&(
              <span style={{color:theme.selectBarText||"#a8e0a8",fontSize:12,fontWeight:700,flexShrink:0}}>
                합계 ₩{[...sel].reduce((sum,id)=>{const it=items.find(x=>x.id===id);return sum+((it?.price||0)*(it?.quantity??1));},0).toLocaleString()}
              </span>
            )}
            <Btn onClick={()=>setSel(new Set(disp.map(it=>it.id)))} style={{...HB,background:"transparent",color:theme.selectBarText||"#a8c8f0",border:`1px solid ${theme.selectBarText||"#4a7ec9"}`,padding:"3px 9px",fontSize:12,flexShrink:0}}>전체</Btn>
            <Btn onClick={()=>setSel(new Set())} style={{...HB,background:"transparent",color:theme.selectBarText||"#a8c8f0",border:`1px solid ${theme.selectBarText||"#4a7ec9"}`,padding:"3px 9px",fontSize:12,flexShrink:0}}>해제</Btn>
            <div style={{flex:1}}/>
            <Btn onClick={()=>{setBulkCat(categories[0]||"");setBulkMove(true);}} disabled={!sel.size} style={{...HB,background:sel.size?"#4a7ec9":"#334",color:"#fff",padding:"5px 10px",fontSize:12,flexShrink:0,opacity:sel.size?1:.5}}>📁이동</Btn>
            <Btn onClick={doBulkDel} disabled={!sel.size} style={{...HB,background:sel.size?"#e05050":"#334",color:"#fff",padding:"5px 10px",fontSize:12,flexShrink:0,opacity:sel.size?1:.5}}>🗑삭제</Btn>
            <Btn onClick={clearSel} style={{...HB,background:"transparent",color:theme.selectBarText||"#a8c8f0",border:`1px solid ${theme.selectBarText||"#4a7ec9"}`,padding:"3px 9px",fontSize:12,flexShrink:0}}>취소</Btn>
          </div>
        </div>
      )}

      <main style={{maxWidth:1100,margin:"0 auto",padding:`${FULL+12}px 12px 28px`}}>
        <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",paddingBottom:3,scrollbarWidth:"none"}}>
          {["전체",...categories].map(c=>{
            const isAll=c==="전체";
            const active=isAll?(activeCats.length===0):activeCats.includes(c);
            return(
              <Btn key={c} onClick={()=>{
                if(isAll){setActiveCats([]);setSearch("");return;}
                setActiveCats(p=>p.includes(c)?p.filter(x=>x!==c):[...p,c]);
              }} style={{padding:"4px 12px",borderRadius:99,border:"2px solid",borderColor:active?theme.catActive:"var(--t-card-border)",background:active?theme.catActive:"transparent",color:active?theme.catActiveText:"var(--t-cat-inactive)",fontWeight:active?700:400,fontSize:16,whiteSpace:"nowrap",flexShrink:0}}>{c}</Btn>
            );
          })}
        </div>
        <div ref={captureRef} style={{background:theme.bg,padding:"8px 0"}}>
        {viewMode==="이미지형"&&(disp.length===0?<Empty/>:
          <VirtualGrid
            items={disp} cols={gridCols}
            hideAcquired={hideAcquired} hideQuantity={hideQuantity} hidePrice={hidePrice} colorCats={colorCats}
            sel={sel} selectMode={selectMode} nameEllipsis={nameEllipsis} nameFontSize={nameFontSize}
            onOpen={setViewItem} onToggle={togAcq} onSelect={togSel}
            onLong={(pos,it)=>setCtx({...pos,item:it})}
          />
        )}
        {viewMode==="목록형"&&(disp.length===0?<Empty/>:
          <div style={{display:"grid",gridTemplateColumns:viewMode==="목록형"?(gridCols>=2?"repeat(2,minmax(0,1fr))":"1fr"):`repeat(${gridCols},minmax(0,1fr))`,gap:7}}>
            {disp.map(it=>(
              <ListRow key={it.id} item={it} hideAcquired={hideAcquired} hideQuantity={hideQuantity} hidePrice={hidePrice} colorCats={colorCats}
                selected={sel.has(it.id)} selectMode={selectMode} nameFontSize={nameFontSize}
                onOpen={()=>setViewItem(it)} onToggle={()=>togAcq(it.id)}
                onSelect={()=>togSel(it.id)} onLong={pos=>setCtx({...pos,item:it})}/>
            ))}
          </div>
        )}
        </div>
      </main>

      {/* 📸 플로팅 캡쳐 버튼 */}
      {!hideCapture&&(
        <button type="button" onClick={doCapture}
          style={{position:"fixed",bottom:100,right:60,zIndex:200,width:56,height:56,borderRadius:"50%",border:"none",background:"rgba(0,0,0,0.18)",backdropFilter:"blur(3px)",WebkitBackdropFilter:"blur(3px)",color:"#fff",fontSize:26,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 18px rgba(0,0,0,.15)",transition:"transform .15s"}}>
          📸
        </button>
      )}

      {confirm&&<Confirm message={confirm.msg} onOk={confirm.ok} onCancel={()=>setConfirm(null)} choices={confirm.choices}/>}

      {bulkMove&&(
        <Overlay onClick={()=>setBulkMove(false)}>
          <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:340}}>
            <h2 style={{margin:"0 0 8px",fontSize:16,fontWeight:700}}>📁 카테고리 이동</h2>
            <p style={{margin:"0 0 14px",fontSize:13,color:"#666666"}}><b>{sel.size}개</b> 항목:</p>
            <select value={bulkCat} onChange={e=>setBulkCat(e.target.value)} style={{...IS,marginBottom:14,cursor:"pointer"}}>
              {categories.map(c=><option key={c}>{c}</option>)}
            </select>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <Btn onClick={doBulkMove} style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#4a7ec9",color:"#fff",fontSize:13,fontWeight:700}}>📁 이동</Btn>
              <Btn onClick={doBulkCopy} style={{flex:1,padding:10,borderRadius:8,border:"none",background:"#6a9a4a",color:"#fff",fontSize:13,fontWeight:700}}>📋 복사하여 이동</Btn>
            </div>
            <Btn onClick={()=>setBulkMove(false)} style={{width:"100%",padding:9,borderRadius:8,border:"2px solid #cccccc",background:"transparent",color:"#666666",fontSize:14,fontWeight:900}}>취소</Btn>
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
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <Btn onClick={()=>openEdit(viewItem)} style={{flex:1,padding:9,borderRadius:8,border:"2px solid #8a7060",background:"transparent",color:"#8a7060",fontWeight:700,fontSize:13}}>✏️ 수정</Btn>
                <Btn onClick={()=>togAcq(viewItem.id)} style={{flex:1,padding:9,borderRadius:8,border:"2px solid #444444",background:viewItem.acquired?"#444444":"transparent",color:viewItem.acquired?"#ffffff":"#444444",fontWeight:700,fontSize:13}}>{viewItem.acquired?"✓ 습득":"○ 미습득"}</Btn>
                <Btn onClick={()=>delItem(viewItem.id)} style={{flex:1,padding:9,borderRadius:8,border:"2px solid #c0503a",background:"transparent",color:"#e05050",fontWeight:700,fontSize:13}}>🗑 삭제</Btn>
              </div>
            </div>
          </Modal>
        </Overlay>
      )}

      {modal&&<AddModal categories={categories} colorCats={colorCats} editItem={editItem} onSave={handleSave} onClose={()=>setModal(false)} cdnConfig={cdnConfig}/>}

      {settings&&(
        <Overlay onClick={()=>setSettings(false)}>
          <Modal onClick={e=>e.stopPropagation()} style={{maxWidth:460,maxHeight:settingsExpanded?"96vh":"60vh",overflowY:"auto",transition:"max-height .3s"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <h2 style={{margin:0,fontSize:17,fontWeight:700,color:theme.accent}}>⚙️ 설정</h2>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <Btn onClick={()=>setSettingsExpanded(p=>!p)} style={{padding:"4px 10px",borderRadius:7,border:`1.5px solid ${theme.btnBorder}`,background:theme.btnBg,color:theme.btnText,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {settingsExpanded?"🔼 줄이기":"🔽 늘리기"}
                </Btn>
                <Btn onClick={()=>setSettings(false)} style={{padding:"4px 10px",borderRadius:7,border:"1.5px solid #ccc",background:"#444",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✕ 닫기</Btn>
              </div>
            </div>
            {/* 탭 */}
            {(()=>{
              const tabs=[["표시","👀"],["카테고리","📁"],["테마","🎨"],["데이터","💾"]];
              return(
                <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:`2px solid ${theme.accent}22`,paddingBottom:6}}>
                  {tabs.map(([t,ic])=>(
                    <Btn key={t} onClick={()=>setSettingsTab(t)}
                      style={{flex:1,padding:"6px 4px",borderRadius:"8px 8px 0 0",border:`1.5px solid ${settingsTab===t?theme.accent:"#ddd"}`,background:settingsTab===t?theme.accent:"#f8f8f8",color:settingsTab===t?"#fff":"#666",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                      {ic} {t}
                    </Btn>
                  ))}
                </div>
              );
            })()}

            {/* 탭: 표시 */}
            {settingsTab==="표시"&&(<>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>습득 체크 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>습득 체크 버튼을 숨깁니다</div></div>
              <Toggle value={hideAcquired} onChange={setHideAcquired}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>수량 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>수량 표시를 숨깁니다</div></div>
              <Toggle value={hideQuantity} onChange={setHideQuantity}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>가격 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>가격 표시를 숨깁니다</div></div>
              <Toggle value={hidePrice} onChange={setHidePrice}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8",marginBottom:16}}>
              <div><div style={{fontWeight:700,fontSize:14}}>이름 생략 모드</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>켜면 긴 이름을 …으로 생략, 끄면 줄바꿈으로 전체 표시</div></div>
              <Toggle value={nameEllipsis} onChange={setNameEllipsis}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #e8dcc8",marginBottom:16}}>
              <div><div style={{fontWeight:700,fontSize:14}}>📸 캡쳐 버튼 숨기기</div><div style={{fontSize:12,color:"#888888",marginTop:2}}>우측 하단 캡쳐 버튼을 숨깁니다</div></div>
              <Toggle value={hideCapture} onChange={setHideCapture}/>
            </div>
            <div style={{padding:"10px 0",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>항목 이름 크기</div>
                  <div style={{fontSize:12,color:"#888888",marginTop:2}}>현재: {nameFontSize ? `${nameFontSize}px` : `자동(${gridCols<=2?13:gridCols<=3?12:gridCols<=4?11:10}px)`}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Btn onClick={()=>setNameFontSize(0)} style={{padding:"3px 10px",borderRadius:6,border:`1.5px solid ${nameFontSize===0?theme.accent:"#ccc"}`,background:nameFontSize===0?theme.accent:"transparent",color:nameFontSize===0?"#fff":"#666",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>자동</Btn>
                  <span style={{fontWeight:700,fontSize:16,minWidth:28,textAlign:"right",color:nameFontSize?theme.accent:"#aaa"}}>{nameFontSize||"-"}</span>
                </div>
              </div>
              {(()=>{
                const autoSize=gridCols<=2?13:gridCols<=3?12:gridCols<=4?11:10;
                const displayVal=nameFontSize||autoSize;
                return(<>
                  <input type="range" min={8} max={20} step={1} value={displayVal}
                    onChange={e=>setNameFontSize(Number(e.target.value))}
                    style={{width:"100%",accentColor:theme.accent}}/>
                  <div style={{position:"relative",height:16,marginTop:2}}>
                    {[8,10,12,14,16,18,20].map(n=>(
                      <span key={n} style={{position:"absolute",left:`${((n-8)/12)*100}%`,transform:"translateX(-50%)",fontSize:11,color:displayVal===n?theme.accent:"#aaa",fontWeight:displayVal===n?700:400}}>{n}</span>
                    ))}
                  </div>
                </>);
              })()}
            </div>
            </>)}

            {/* 탭: 카테고리 */}
            {settingsTab==="카테고리"&&(<>
            <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:theme.accent}}>📁 카테고리 관리</div>
            <CatInput onAdd={v=>{if(v&&!categories.includes(v))setCategories(p=>[...p,v]);}} IS={IS}/>
            <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:18}}>
              {categories.map((c,i)=>(
                <div key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#f8f8f8",border:"1.5px solid #dddddd",borderRadius:8,padding:"5px 8px"}}>
                  <button type="button" onClick={()=>setCategories(p=>{if(i===0)return p;const a=[...p];[a[i-1],a[i]]=[a[i],a[i-1]];return a;})}
                    style={{background:"none",border:"none",color:i===0?"#cccccc":"#888888",fontSize:14,cursor:i===0?"default":"pointer",padding:"2px 4px",lineHeight:1}}>▲</button>
                  {editCatIdx===i?(
                    <input autoFocus defaultValue={c} onBlur={e=>{const v=e.target.value.trim();if(v&&v!==c&&!categories.includes(v)){setCategories(p=>p.map(x=>x===c?v:x));setItems(p=>p.map(it=>it.category===c?{...it,category:v}:it));}setEditCatIdx(null);}}
                      onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditCatIdx(null);}}
                      style={{flex:1,fontSize:13,textAlign:"center",border:"1.5px solid #4a7ec9",borderRadius:5,padding:"2px 6px",outline:"none"}}/>
                  ):(
                    <span style={{flex:1,fontSize:13,textAlign:"center"}}>{c}</span>
                  )}
                  <button type="button" onClick={()=>setCategories(p=>{if(i===p.length-1)return p;const a=[...p];[a[i],a[i+1]]=[a[i+1],a[i]];return a;})}
                    style={{background:"none",border:"none",color:i===categories.length-1?"#cccccc":"#888888",fontSize:14,cursor:i===categories.length-1?"default":"pointer",padding:"2px 4px",lineHeight:1}}>▼</button>
                  <button type="button" onClick={()=>setEditCatIdx(i===editCatIdx?null:i)}
                    style={{background:"#f0f4ff",border:"1.5px solid #c0cce8",borderRadius:6,color:"#4a7ec9",fontSize:12,fontWeight:700,padding:"3px 10px",lineHeight:1,cursor:"pointer",marginLeft:8}}>수정</button>
                  <button type="button" onClick={()=>remCat(c)}
                    style={{background:"#fff0f0",border:"1.5px solid #f0c0c0",borderRadius:6,color:"#e05050",fontSize:12,fontWeight:700,padding:"3px 10px",lineHeight:1,cursor:"pointer"}}>삭제</button>
                </div>
              ))}
            </div>
            <div style={{borderTop:"1px solid #e8dcc8",paddingTop:14}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:9,color:theme.accent}}>🎨 색상 카테고리 관리</div>
              <CatInput onAdd={v=>{if(v&&!colorCats.find(c=>c.name===v))setColorCats(p=>[...p,{name:v,hex:newCH}]);}} IS={IS} colorPicker newCH={newCH} setNewCH={setNewCH}/>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {colorCats.map((col,idx)=>(
                  <div key={col.name+idx}>
                    {editCI===idx?(
                      <div style={{display:"flex",gap:6,alignItems:"center",background:"#f8f8f8",borderRadius:8,padding:"7px 10px",border:"1.5px solid #444444"}}>
                        <input value={editCN} onChange={e=>setEditCN(e.target.value)} style={{...IS,flex:1,padding:"5px 9px",fontSize:13}}/>
                        <input type="color" value={editCH} onChange={e=>setEditCH(e.target.value)} style={{width:34,height:32,borderRadius:6,border:"2px solid #dddddd",cursor:"pointer",padding:2}}/>
                        <Btn onClick={saveEC} style={{padding:"5px 10px",borderRadius:7,background:"#444444",border:"none",fontWeight:700,color:"#ffffff",fontSize:12}}>저장</Btn>
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
            </>)}
            {/* 탭: 테마 */}
            {settingsTab==="테마"&&(<>
              <div style={{borderRadius:10,overflow:"hidden",border:"1.5px solid #ddd",marginBottom:10}}>
                <div style={{background:theme.header,padding:"7px 12px",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{color:theme.titleText||theme.headerText,fontWeight:700,fontSize:13}}>🍃 링동숲</span>
                  <span style={{background:theme.headerText,color:theme.activeText||theme.header,borderRadius:6,padding:"1px 8px",fontSize:11,fontWeight:700}}>+ 추가</span>
                  <span style={{color:theme.headerSubText,fontSize:11}}>전체 <b style={{color:theme.titleText||theme.headerText}}>264</b> · 습득 <b style={{color:theme.titleText||theme.headerText}}>1</b></span>
                </div>
                <div style={{background:theme.bg,padding:"6px 10px",display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{background:theme.catActive,color:theme.catActiveText,borderRadius:99,padding:"2px 10px",fontSize:12,fontWeight:700}}>전체</span>
                  <span style={{border:`1.5px solid ${theme.cardBorder}`,color:theme.catInactiveText,borderRadius:99,padding:"2px 10px",fontSize:12}}>가구</span>
                  <div style={{display:"flex",gap:5,marginLeft:4}}>
                    {[0,1].map(i=>(
                      <div key={i} style={{width:34,height:34,borderRadius:6,border:`1.5px solid ${theme.cardBorder}`,background:i===0?theme.card:theme.cardEmpty,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🖼️</div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{background:"#f8f8f8",borderRadius:10,padding:"10px",border:"1.5px solid #ddd"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                  {Object.entries(THEMES).map(([key,t])=>(
                    <button key={key} type="button" onClick={()=>setThemeName(key)}
                      style={{padding:"5px 10px",borderRadius:8,border:`2px solid ${themeName===key?t.accent:"#dddddd"}`,background:themeName===key?t.header:"#ffffff",color:themeName===key?(t.titleText||t.headerText):"#444444",fontSize:12,fontWeight:themeName===key?700:400,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                      {t.name}
                    </button>
                  ))}
                  <button type="button" onClick={()=>setThemeName("커스텀")}
                    style={{padding:"5px 10px",borderRadius:8,border:`2px solid ${themeName==="커스텀"?"#888":"#dddddd"}`,background:themeName==="커스텀"?"#444":"#fff",color:themeName==="커스텀"?"#fff":"#444",fontSize:12,fontWeight:themeName==="커스텀"?700:400,cursor:"pointer",fontFamily:"inherit"}}>
                    🖌️ 커스텀
                  </button>
                </div>
                {themeName==="커스텀"&&(
                  <div style={{background:"#ffffff",borderRadius:8,padding:"10px",border:"1.5px solid #ddd",display:"flex",flexDirection:"column",gap:8}}>
                    {[["header","헤더 배경색"],["bg","앱 배경색"],["accent","강조색 (버튼/탭)"]].map(([key,label])=>(
                      <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:12,color:"#444"}}>{label}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:24,height:24,borderRadius:5,background:customTheme[key],border:"1.5px solid #ccc"}}/>
                          <input type="color" value={customTheme[key]} onChange={e=>setCustomTheme(p=>({...p,[key]:e.target.value}))}
                            style={{width:32,height:28,borderRadius:5,border:"1.5px solid #ccc",cursor:"pointer",padding:1}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>)}

            {/* 탭: 데이터 */}
            {settingsTab==="데이터"&&(<>
              <div style={{marginBottom:12,padding:"12px 14px",background:"#f0f8f0",borderRadius:10,border:"1.5px solid #b0d8b0"}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#2a5a2a"}}>📊 엑셀 가져오기 · 내보내기</div>
                <div style={{fontSize:11,color:"#5a8060",marginBottom:8,lineHeight:1.5}}>
                  형식: <b>A이름 · B색상 · C수량 · D금액 · E카테고리 · F메모</b>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{position:"relative",flex:1,borderRadius:7,overflow:"hidden"}}>
                    <button type="button" style={{width:"100%",padding:"9px",borderRadius:7,border:"2px solid #b0d8b0",background:"#e0f0e0",color:"#2a5a2a",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>📂 가져오기</button>
                    <input type="file" accept=".xlsx,.xls,.csv" style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}
                      onChange={e=>{
                        const f=e.target.files?.[0]; if(!f)return;
                        const name=f.name.toLowerCase();
                        if(name.endsWith(".csv")){
                          const reader=new FileReader();
                          reader.onload=ev=>{
                            try{
                              const lines=ev.target.result.replace(/\r/g,"").split("\n").filter(l=>l.trim());
                              if(lines.length<2){showToast("데이터가 없습니다");return;}
                              const newItems=lines.slice(1).map(line=>{
                                const cols=line.split(',').map(s=>{const t=s.trim();return t.startsWith('"')&&t.endsWith('"')?t.slice(1,-1):t;});
                                if(!cols[0])return null;
                                return{id:nextId.current++,name:cols[0]||"",colorCat:cols[1]||"",quantity:parseInt(cols[2])||1,price:parseInt(cols[3])||0,category:cols[4]||categories[0]||"기타",note:cols[5]||"",acquired:false,date:new Date().toISOString().split("T")[0],image:null};
                              }).filter(Boolean);
                              if(!newItems.length){showToast("유효한 항목이 없습니다");return;}
                              setItems(prev=>{
                                const all=[...prev];
                                const checked=newItems.map(ni=>{const isDup=all.some(it=>it.name.trim()===ni.name.trim()&&it.colorCat===ni.colorCat);return isDup?{...ni,category:"중복"}:ni;});
                                const updatedPrev=all.map(it=>{const isDup=newItems.some(ni=>ni.name.trim()===it.name.trim()&&ni.colorCat===it.colorCat);return isDup?{...it,category:"중복"}:it;});
                                return [...updatedPrev,...checked];
                              });
                              showToast(`✓ ${newItems.length}개 가져왔습니다`);
                            }catch{showToast("파일을 읽을 수 없습니다");}
                          };
                          reader.readAsText(f,"utf-8");
                        } else {
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
                                  const checked=newItems.map(ni=>{const isDup=all.some(it=>it.name.trim()===ni.name.trim()&&it.colorCat===ni.colorCat);return isDup?{...ni,category:"중복"}:ni;});
                                  const updatedPrev=all.map(it=>{const isDup=newItems.some(ni=>ni.name.trim()===it.name.trim()&&ni.colorCat===it.colorCat);return isDup?{...it,category:"중복"}:it;});
                                  return [...updatedPrev,...checked];
                                });
                                showToast(`✓ ${newItems.length}개 가져왔습니다`);
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
                  <Btn onClick={()=>{
                    const script=document.createElement("script");
                    script.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                    script.onload=()=>{
                      try{
                        const XLSX=window.XLSX;
                        const rows=[["이름","색상","수량","금액","카테고리","메모","습득여부"],...items.map(it=>[it.name,it.colorCat||"",it.quantity??1,it.price||0,it.category||"",it.note||"",it.acquired?"습득":"미습득"])];
                        const ws=XLSX.utils.aoa_to_sheet(rows);
                        const wb=XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb,ws,"카탈로그");
                        XLSX.writeFile(wb,`링동숲_카탈로그_${new Date().toISOString().slice(0,10)}.xlsx`);
                        showToast(`✓ 엑셀 내보내기 완료 (${items.length}개)`);
                      }catch{showToast("내보내기 실패");}
                    };
                    script.onerror=()=>showToast("라이브러리 로드 실패");
                    if(!window.XLSX) document.head.appendChild(script);
                    else script.onload();
                  }} style={{flex:1,padding:"9px",borderRadius:7,border:"2px solid #2a7a2a",background:"#2a7a2a",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    📤 내보내기
                  </Btn>
                </div>
              </div>
              <div style={{marginBottom:12,padding:"12px 14px",background:"#f0f4ff",borderRadius:10,border:"1.5px solid #c0cce8"}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#1a3a6a"}}>💾 데이터 백업 · 복원</div>
                <div style={{fontSize:11,color:"#5a7098",marginBottom:8,lineHeight:1.5}}>JSON 백업에는 이미지 URL이 포함됩니다. 복원 시 현재 데이터를 덮어씁니다.</div>
                <div style={{display:"flex",gap:8}}>
                  <Btn onClick={()=>{
                    const data={items,categories,colorCats,settings:{hideAcquired,hideQuantity,viewMode,gridCols,sortBy,nameEllipsis,nameFontSize},exportedAt:new Date().toISOString()};
                    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
                    const url=URL.createObjectURL(blob);
                    const a=document.createElement("a");
                    a.href=url;a.download=`링동숲_백업_${new Date().toISOString().slice(0,10)}.json`;a.click();
                    URL.revokeObjectURL(url);showToast("✓ 백업 파일 저장됨");
                  }} style={{flex:1,padding:"10px",borderRadius:8,border:"2px solid #4a7ec9",background:"#4a7ec922",color:"#1a3a6a",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    📥 JSON 내보내기
                  </Btn>
                  <div style={{position:"relative",flex:1,borderRadius:8,overflow:"hidden"}}>
                    <button type="button" style={{width:"100%",padding:"10px",borderRadius:8,border:"2px solid #888",background:"#88888822",color:"#333",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>📤 JSON 복원</button>
                    <input type="file" accept=".json" style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}
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
                              if(s.nameFontSize!==undefined)setNameFontSize(s.nameFontSize);
                            }
                            nextId.current=Math.max(100,...data.items.map(x=>x.id||0))+1;
                            showToast(`✓ ${data.items.length}개 항목 복원 완료`);
                          }catch{showToast("파일을 읽을 수 없습니다");}
                        };
                        reader.readAsText(f,"utf-8");e.target.value="";
                      }}/>
                  </div>
                </div>
              </div>
              <div style={{padding:"12px 14px",background:"#fff8f0",borderRadius:10,border:"1.5px solid #f0d8b0"}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#7a3a00"}}>☁️ Cloudinary 연결 정보</div>
                <div style={{fontSize:12,color:"#666",marginBottom:8,lineHeight:1.7}}>
                  Cloud Name: <b>{cdnConfig?.cloudName}</b><br/>Upload Preset: <b>{cdnConfig?.uploadPreset}</b>
                </div>
                <Btn onClick={()=>setConfirm({msg:"Cloudinary 설정을 초기화할까요?\n(저장된 이미지 URL은 유지됩니다)",ok:()=>{try{localStorage.removeItem(CK);}catch{}setCdnConfig_(null);setConfirm(null);}})}
                  style={{width:"100%",padding:"9px",borderRadius:8,border:"2px solid #c0503a",background:"transparent",color:"#e05050",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  🔄 Cloudinary 재설정
                </Btn>
              </div>
            </>)}
          </Modal>
        </Overlay>
      )}
    </div>
  );
}
