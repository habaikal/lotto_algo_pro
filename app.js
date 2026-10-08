/* LOTTO QUANTUM ULTRA — EB-Markov engine (JS port of lotto_markov_predictor.py) */
'use strict';
const CFG = { aBase:10, aPair:20, aBonus:10, lPrev:0.6, lBonus:0.3, lTrend:0.01, balSum:[98,177], balOdd:[2,4], balLow:[2,4] };
const storeGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const storeSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
let ROWS=[], MODEL=null, PLAN=storeGet('lqu_plan')||'free';
let BASE_ROWS=[];
const $=s=>document.querySelector(s);
const ballCls=n=>n<=10?'b1':n<=20?'b2':n<=30?'b3':n<=40?'b4':'b5';
const ballsHTML=(nums,bonus)=>nums.map(n=>`<span class="ball ${ballCls(n)}">${n}</span>`).join('');

/* seeded rng */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* data */
async function loadCSV(){
  // file:// 로 직접 열면 fetch가 차단되어 버튼이 먹통이 된다. 반드시 로컬 서버로 실행.
  const res=await fetch('lotto_results.csv');
  if(!res.ok)throw new Error('CSV HTTP '+res.status);
  const t=await res.text();
  const lines=t.trim().split(/\r?\n/).slice(1);
  BASE_ROWS=lines.map(l=>{const p=l.split(',').map(Number);return{r:p[0],nums:[p[1],p[2],p[3],p[4],p[5],p[6]].sort((a,b)=>a-b),b:p[7]}}).filter(x=>x.nums.length===6).sort((a,b)=>a.r-b.r);
  if(!BASE_ROWS.length)throw new Error('CSV 파싱 결과 0건');
}
function dataErrorHTML(msg){
  return`<div class="glass combo full"><span class="rank">DATA ERROR</span>
    <div class="meta"><span class="chip hot">데이터 로드 실패: ${msg}</span></div>
    <p class="cap">가장 흔한 원인: <b>index.html을 더블클릭(file://)으로 열었기 때문</b>입니다. 브라우저 보안 정책상 데이터 파일을 읽지 못해 예측 버튼이 동작하지 않습니다.<br>
    해결 ① 폴더에서 <span class="mono">npx serve .</span> 실행 → 표시된 주소로 접속 ② 또는 <span class="mono">python -m http.server 8000</span> 후 http://localhost:8000 접속<br>
    그래도 안 되면 lotto_results.csv 파일이 index.html과 같은 폴더에 있는지 확인하세요.</p>
    <div class="row-btns"><button class="btn btn-neon sm" data-act="retry">⟳ 다시 시도</button></div></div>`;
}
function buildModel(rows){
  const N=rows.length,M=N-1,nextC={},prevH={},pair={},bonH={},bonP={};
  for(let i=1;i<N;i++)rows[i].nums.forEach(x=>nextC[x]=(nextC[x]||0)+1);
  for(let i=0;i<M;i++){const s=rows[i].nums,t=rows[i+1].nums,b=rows[i].b;
    bonH[b]=(bonH[b]||0)+1;s.forEach(y=>prevH[y]=(prevH[y]||0)+1);
    s.forEach(y=>t.forEach(x=>pair[y+'>'+x]=(pair[y+'>'+x]||0)+1));
    t.forEach(x=>bonP[b+'>'+x]=(bonP[b+'>'+x]||0)+1);}
  const base={};for(let x=1;x<=45;x++)base[x]=( (nextC[x]||0)+CFG.aBase)/(6*M+45*CFG.aBase);
  const rec=rows.slice(-50),rc={};rec.forEach(r=>r.nums.forEach(x=>rc[x]=(rc[x]||0)+1));
  const mean=Object.values(rc).reduce((a,b)=>a+b,0)/45;
  const sd=Math.sqrt(Object.keys(rc).length? [ ...Array(45)].reduce((s,_,i)=>s+(((rc[i+1]||0)-mean)**2),0)/45:1)||1;
  const trend={};for(let x=1;x<=45;x++)trend[x]=((rc[x]||0)-mean)/sd;
  const lifts=[];for(const k in pair){const[y,x]=k.split('>').map(Number);
    const p=pair[k]/prevH[y],l=p/( (nextC[x]||0)/M );lifts.push({y,x,l,c:pair[k],p});}
  lifts.sort((a,b)=>b.l-a.l);
  return{N,M,nextC,prevH,pair,bonH,bonP,base,trend,lifts,
    pXY:(y,x)=>((pair[y+'>'+x]||0)+CFG.aPair/45)/((prevH[y]||0)+CFG.aPair),
    pBX:(b,x)=>((bonP[b+'>'+x]||0)+CFG.aBonus/45)/((bonH[b]||0)+CFG.aBonus)};
}
function scoreAll(model,prev,bonus){
  const s={},d={};
  for(let x=1;x<=45;x++){const b=model.base[x];let v=Math.log(b),pm=0;
    prev.forEach(y=>pm+=Math.log(model.pXY(y,x)/b));pm/=prev.length;
    v+=CFG.lPrev*6*pm;
    const pb=bonus?Math.log(model.pBX(bonus,x)/b):0;v+=CFG.lBonus*pb;
    v+=CFG.lTrend*model.trend[x];s[x]=v;d[x]={base:b,pm,pb};}
  return{s,d};
}
/* 신규 회차 반영: CSV 기준 + 사용자 추가분 병합. 추가분은 브라우저에 저장.
   예측 타깃은 항상 max(회차)+1 로 자동 이동한다. */
const CUSTOM_KEY='lqu_custom';
function loadCustomDraws(){
  try{
    const j=JSON.parse(storeGet(CUSTOM_KEY)||'[]');
    if(!Array.isArray(j))return[];
    return j.filter(d=>d&&Number.isInteger(d.r)&&d.r>0&&Array.isArray(d.nums)&&d.nums.length===6
      &&d.nums.every(x=>Number.isInteger(x)&&x>=1&&x<=45)&&new Set(d.nums).size===6
      &&Number.isInteger(d.b)&&d.b>=1&&d.b<=45&&!d.nums.includes(d.b))
      .map(d=>({r:d.r,nums:[...d.nums].sort((a,b)=>a-b),b:d.b}));
  }catch(e){return[];}
}
function saveCustomDraws(list){storeSet(CUSTOM_KEY,JSON.stringify(list));}
function mergeRows(base,custom){
  const m=new Map(base.map(r=>[r.r,{r:r.r,nums:[...r.nums],b:r.b}]));
  for(const c of custom)m.set(c.r,{r:c.r,nums:[...c.nums],b:c.b});
  return[...m.values()].sort((a,b)=>a.r-b.r);
}
function refreshTitles(){
  if(!ROWS.length)return;
  const last=ROWS[ROWS.length-1];
  const pt=$('#predictTitle');if(pt)pt.textContent=`${last.r+1}회 ULTRA 예측 코어`;
  const hp=$('#heroPill');if(hp)hp.innerHTML=`<i></i>${last.r}회차 학습 완료`;
  const nr=$('#newRound');if(nr&&!nr.value)nr.value=last.r+1;
}
function rebuildAll(){
  for(const k in scoreCache)delete scoreCache[k];
  MODEL=buildModel(ROWS);
  refreshTitles();renderCustomList();renderDraw();showReady('데이터 준비 완료 — ⟳ 양자 재생성을 누르면 예측이 생성됩니다');renderLab();renderHistory();
}
function renderCustomList(){
  const box=$('#customList');if(!box)return;
  const list=loadCustomDraws().sort((a,b)=>b.r-a.r);
  box.innerHTML=(list.length?`<span class="chip hot">추가 반영 ${list.length}건</span>`:`<span class="chip">추가 반영 없음 (CSV 기준)</span>`)+
    list.map(d=>`<span class="chip">${d.r}회 ${d.nums.join(',')}+${d.b} <a href="#" data-del="${d.r}" style="color:#fca5a5">삭제</a></span>`).join(' ');
  box.querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{e.preventDefault();
    saveCustomDraws(loadCustomDraws().filter(d=>d.r!==+a.dataset.del));
    ROWS=mergeRows(BASE_ROWS,loadCustomDraws());rebuildAll();toast('삭제됨 — 모델 재학습 완료');});
}
function addDraw(){
  const r=Math.floor(+$('#newRound').value);
  const nums=[...new Set(parseNums($('#newNums').value))].sort((a,b)=>a-b);
  const b=Math.floor(+$('#newBonus').value);
  if(!Number.isInteger(r)||r<=0)return toast('회차를 확인하세요 (1 이상의 정수)');
  if(nums.length!==6)return toast('당첨번호 6개를 쉼표로 입력하세요 (1~45, 중복 불가)');
  if(!Number.isInteger(b)||b<1||b>45)return toast('보너스 번호를 입력하세요 (1~45)');
  if(nums.includes(b))return toast('보너스는 당첨번호 6개와 달라야 합니다');
  const list=loadCustomDraws().filter(d=>d.r!==r);const overwrote=list.length!==loadCustomDraws().length;
  list.push({r,nums,b});saveCustomDraws(list);
  ROWS=mergeRows(BASE_ROWS,loadCustomDraws());rebuildAll();
  $('#newNums').value='';$('#newBonus').value='';
  const last=ROWS[ROWS.length-1];$('#newRound').value=last.r+1;
  toast(`${r}회 반영${overwrote?' (덮어씀)':''} → ${last.r+1}회 예측 모드`);
}
function exportMergedCSV(){
  if(!ROWS.length)return;
  const body=ROWS.map(r=>[r.r,...r.nums,r.b].join(',')).join('\n');
  download(`lotto_results_merged_${ROWS[ROWS.length-1].r}.csv`,'회차,번호1,번호2,번호3,번호4,번호5,번호6,보너스\n'+body,'text/csv;charset=utf-8');
  toast('병합 CSV 저장 — lotto_results.csv 교체용');
}
let clearArmed=false;
function clearCustom(){
  if(!clearArmed){clearArmed=true;$('#clearCustomBtn').textContent='정말 초기화? 다시 클릭';
    setTimeout(()=>{clearArmed=false;const el=$('#clearCustomBtn');if(el)el.textContent='추가분 초기화';},3000);return;}
  clearArmed=false;$('#clearCustomBtn').textContent='추가분 초기화';
  saveCustomDraws([]);ROWS=mergeRows(BASE_ROWS,[]);rebuildAll();toast('추가분 초기화 — CSV 기준으로 복귀');
}
const esc=v=>String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const balanced=c=>{const s=c.reduce((a,b)=>a+b,0),o=c.filter(v=>v%2).length,l=c.filter(v=>v<=22).length;
  return s>=CFG.balSum[0]&&s<=CFG.balSum[1]&&o>=CFG.balOdd[0]&&o<=CFG.balOdd[1]&&l>=CFG.balLow[0]&&l<=CFG.balLow[1];};
/* 핵심 알고리즘 보호: 서버 스코어링 후크. 비워두면 로컬 계산.
   실서비스에서 모델 가중치를 보호하려면 스코어 API를 두고 아래 URL만 설정하면 된다.
   (클라이언트 JS 난독화는 우회 가능하므로 유일한 실효 보호책은 서버 이전이다) */
const REMOTE_API='';
const scoreCache={};
async function getScores(prev,bonus){
  const key=prev.join(',')+'|'+bonus;
  if(scoreCache[key])return scoreCache[key].s;
  if(REMOTE_API){
    try{
      const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),8000);
      const r=await fetch(REMOTE_API,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prev,bonus}),signal:ctl.signal});
      clearTimeout(to);
      if(r.ok){const j=await r.json();if(j&&j.scores){scoreCache[key]={s:j.scores};return j.scores;}}
    }catch(e){/* 서버 실패 시 로컬 폴백 */}
  }
  const{s}=scoreAll(MODEL,prev,bonus);
  scoreCache[key]={s};return s;
}
function parseNums(str){return(str||'').split(/[, ]+/).map(Number).filter(n=>n>=1&&n<=45)}
/* 희귀패턴 제거: 이론+실측이 모두 희귀한 영역만 차단. 어떤 조합의 확률도 1/8,145,060으로 동일하므로
   이 필터는 기대값 향상이 아니라 슬롯 정리 기능이다. */
const maxRun=c=>{let m=1,cur=1;for(let i=1;i<c.length;i++){if(c[i]===c[i-1]+1){cur++;m=Math.max(m,cur);}else cur=1;}return m;};
const rareOpts=()=>({run4:$('#fRun4')?.checked??true, overlap4:$('#fOverlap4')?.checked??true,
  parity:$('#fParity')?.checked??true, sum:$('#fSum')?.checked??true});
function rareReject(c,prevS,o){
  if(o.run4&&maxRun(c)>=4)return'연속4+';
  if(o.overlap4&&c.filter(x=>prevS.has(x)).length>=4)return'직전중복4+';
  if(o.parity){const n=c.filter(v=>v%2).length;if(n===0||n===6)return'전홀/전짝';}
  if(o.sum){const s=c.reduce((a,b)=>a+b,0);if(s<70||s>210)return'극단합';}
  return null;
}
/* 대량 생성 최적화 버전: 누적가중치+이진탐색, 청크 비동기(프로그레스), 윈도우 분산검사.
   n<=200은 전수 분산검사, 그 이상은 최근 120개 윈도우 검사로 O(n^2) 회피. */
async function sampleCombos(model,prev,bonus,n,seed,temp,inc,exc,onProgress){
  const s=await getScores(prev,bonus),mx=Math.max(...Object.values(s));
  const w=[];for(let x=1;x<=45;x++)w[x]=Math.exp((s[x]-mx)/temp);
  const rng=mulberry32(seed),prevS=new Set(prev),excS=new Set(exc),seen=new Set();
  const o=rareOpts(),rej={};
  const pool=[...Array(45)].map((_,i)=>i+1).filter(x=>!excS.has(x));
  const pw=pool.map(x=>w[x]),cum=[];let acc=0;for(const v of pw){acc+=v;cum.push(acc);}
  const wpick=()=>{let r=rng()*acc,lo=0,hi=cum.length-1;while(lo<hi){const m=(lo+hi)>>1;if(cum[m]<r)lo=m+1;else hi=m;}return pool[lo];};
  const must=[...new Set(inc)].filter(x=>!excS.has(x)).slice(0,5);
  const fullDiv=n<=200,WIN=120;
  const cap=n<=20?30000:Math.min(400000,n*30+5000);
  const out=[];const t0=performance.now();
  const diverse=c=>{
    const win=fullDiv?out:out.slice(-WIN);
    for(const q of win){let h=0;for(const x of c)if(q.includes(x)&&++h>3)return false;}
    return true;
  };
  for(let t=0;out.length<n&&t<cap;t++){
    let c=[];
    if(must.length&&rng()<0.7){c=[...must];while(c.length<6)c.push(pool[(rng()*pool.length)|0]);}
    else{while(c.length<6)c.push(wpick());}
    c=[...new Set(c)].sort((a,b)=>a-b);if(c.length!==6)continue;
    if(must.length) {let ok=true;for(const m of must)if(!c.includes(m)){ok=false;break;}if(!ok)continue;}
    const k=c[0]*45**5+c[1]*45**4+c[2]*45**3+c[3]*45**2+c[4]*45+c[5];
    if(seen.has(k))continue;seen.add(k);
    if(!balanced(c))continue;
    const rr=rareReject(c,prevS,o);if(rr){rej[rr]=(rej[rr]||0)+1;continue;}
    if(!diverse(c))continue;
    out.push(c);
    if(onProgress&&(out.length&127)===0){onProgress(out.length/n);await new Promise(r=>setTimeout(r,0));}
  }
  out.sort((a,b)=>scoreSum(s,b)-scoreSum(s,a));
  if(onProgress)onProgress(1);
  return{combos:out,scores:s,rej,ms:performance.now()-t0,short:Math.max(0,n-out.length)};
}
const scoreSum=(s,c)=>c.reduce((a,x)=>a+s[x],0);

/* charts (vanilla canvas) */
function bar(el,data,{color='#22d3ee',labels=null}={}){
  const c=typeof el==='string'?$(el):el,dpr=devicePixelRatio||1,W=c.clientWidth||600,H=+c.getAttribute('height')||200;
  c.width=W*dpr;c.height=H*dpr;const g=c.getContext('2d');g.scale(dpr,dpr);
  const mx=Math.max(...data);g.clearRect(0,0,W,H);
  const bw=W/data.length;
  data.forEach((v,i)=>{const h=(H-24)*v/mx;const gr=g.createLinearGradient(0,H,0,H-h);
    gr.addColorStop(0,'#8b5cf6');gr.addColorStop(1,color);g.fillStyle=gr;
    g.fillRect(i*bw+1,H-18-h,bw-2,h);
    if(labels&&bw>28){g.fillStyle='#93a0bd';g.font='9px monospace';g.textAlign='center';g.fillText(labels[i],i*bw+bw/2,H-4);}});
}

/* render */
function toast(m){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2400);}
function renderDraw(){
  const last=ROWS[ROWS.length-1];
  $('#drawRound').textContent=last.r+'회';
  $('#lastBalls').innerHTML=ballsHTML(last.nums);
  $('#lastBonus').innerHTML=`<span class="ball ${ballCls(last.b)} bonus">${last.b}</span>`;
  $('#statRounds').textContent=ROWS.length;
  const{s}=scoreAll(MODEL,last.nums,last.b);
  const top=[...Array(45)].map((_,i)=>i+1).sort((a,b)=>s[b]-s[a]).slice(0,5);
  const vals=top.map(x=>s[x]),mn=Math.min(...vals),mx=Math.max(...vals);
  $('#topScores').innerHTML=top.map(x=>`<div class="score-row"><b class="mono">#${x}</b><div class="bar"><i style="width:${8+92*(s[x]-mn)/((mx-mn)||1)}%"></i></div><span class="mono">${s[x].toFixed(2)}</span></div>`).join('');
  $('#topScoreMeta').textContent=`prev ${last.r}회 → next ${last.r+1}회`;
  // score map
  const svals=[...Array(45)].map((_,i)=>s[i+1]),lo=Math.min(...svals),hi=Math.max(...svals);
  $('#scoreMap').innerHTML=[...Array(45)].map((_,i)=>{const x=i+1;
    return`<div class="scell" data-n="${x}"><b>${x}</b><div class="bar"><i style="width:${6+94*(s[x]-lo)/((hi-lo)||1)}%"></i></div><small>${s[x].toFixed(2)}</small></div>`;}).join('');
  document.querySelectorAll('.scell').forEach(el=>el.onclick=()=>{const n=+el.dataset.n;
    const cur=$('#excludeNums').value;$('#excludeNums').value=cur?cur+', '+n:''+n;toast(n+'번 제외 목록에 추가');});
}
const PLAN_MAX={free:5,pro:500,ultra:10000};
function planLimit(n){n=Math.min(Math.max(1,Math.floor(+n)||5),10000);return Math.min(n,PLAN_MAX[PLAN]||5);}
let LAST_GEN=null,PAGE=0;const PAGE_SIZE=50;
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true;}
  catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();
    let ok=false;try{ok=document.execCommand('copy')}catch(_){}ta.remove();return ok;}
}
async function renderCombos(){
  if(!ROWS.length||!MODEL){$('#comboGrid').innerHTML=dataErrorHTML('학습 데이터 없음');bindComboGrid();return;}
  const last=ROWS[ROWS.length-1];
  const want=Math.min(Math.max(1,Math.floor(+$('#comboCount').value)||5),10000);
  const n=planLimit(want);
  if(want>n)toast(`${PLAN.toUpperCase()} 상한 ${n}게임으로 조정 (ULTRA=10,000)`);
  let temp=+$('#temperature').value;if(!isFinite(temp)||temp<=0||temp>5)temp=1.5;
  let seed=Math.floor(+$('#seedInput').value);if(!isFinite(seed))seed=7;
  const inc0=parseNums($('#includeNums').value).slice(0,5), exc0=parseNums($('#excludeNums').value);
  const inc=PLAN==='free'?[]:inc0, exc=PLAN==='free'?[]:exc0;
  if(PLAN==='free'&&(inc0.length||exc0.length))toast('포함/제외 고정은 PRO 이상 — 입력은 무시됩니다');
  $('#genBar').classList.remove('hidden');$('#genFill').style.width='2%';$('#genTxt').textContent='양자 생성 중…';
  $('#bulkRow').classList.add('hidden');
  const{combos,scores,rej,ms,short}=await sampleCombos(MODEL,last.nums,last.b,n,seed,temp,inc,exc,
    p=>{$('#genFill').style.width=Math.round(p*100)+'%';$('#genTxt').textContent=`양자 생성 중… ${Math.round(p*100)}%`;});
  $('#genBar').classList.add('hidden');
  LAST_GEN={combos,scores,target:last.r+1,prev:last.nums,ms};PAGE=0;
  const rejTxt=Object.entries(rej).map(([k,v])=>`${esc(k)} ${v}건`).join(' · ');
  const onList=[ $('#fRun4')?.checked&&'연속4+제거', $('#fOverlap4')?.checked&&'직전중복4+제거', $('#fParity')?.checked&&'전홀/전짝제거', $('#fSum')?.checked&&'극단합제거'].filter(Boolean).join(' · ')||'필터 OFF';
  let head=`<div class="glass combo full"><span class="rank">FILTER LOG</span>
    <div class="meta"><span class="chip hot">적용중: ${esc(onList)}</span>${rejTxt?`<span class="chip">차단: ${rejTxt}</span>`:`<span class="chip">차단 건 없음</span>`}
    <span class="chip">${combos.length.toLocaleString()}게임 · ${(ms/1000).toFixed(1)}초</span>
    ${short?`<span class="chip hot">조건 충족 ${short}게임 부족 (필터 완화 권장)</span>`:''}</div></div>`;
  if(n<=20){
    $('#comboGrid').innerHTML=head+combos.map((c,i)=>{const rep=c.filter(x=>last.nums.includes(x));
    return`<div class="glass combo"><span class="rank">COMBO ${String(i+1).padStart(2,'0')}</span>
    <div class="balls">${ballsHTML(c)}</div>
    <div class="meta"><span class="chip">합 ${c.reduce((a,b)=>a+b,0)}</span><span class="chip">홀 ${c.filter(v=>v%2).length}</span>
    <span class="chip ${rep.length?'hot':''}">직전중복 ${rep.length}${rep.length?' ('+rep.join(',')+')':''}</span>
    <span class="chip">Σscore ${scoreSum(scores,c).toFixed(2)}</span></div>
    <div class="row-btns"><button class="btn btn-ghost sm" data-copy="${c.join(',')}">복사</button></div></div>`;}).join('');
  }else{
    $('#comboGrid').innerHTML=head+`<div class="glass combo full"><span class="rank">BULK TABLE</span><div class="table-wrap"><table id="bulkTable">
      <thead><tr><th>#</th><th>번호</th><th>합</th><th>홀</th><th>중복</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="pager"><button class="btn btn-ghost sm" id="pgPrev">← 이전</button><span id="pgInfo" class="mono"></span><button class="btn btn-ghost sm" id="pgNext">다음 →</button></div></div>`;
    renderPage();
  }
  if(combos.length)$('#bulkRow').classList.remove('hidden');
  bindComboGrid();
}
function renderPage(){
  if(!LAST_GEN)return;
  const{combos,prev}=LAST_GEN,pages=Math.max(1,Math.ceil(combos.length/PAGE_SIZE));
  PAGE=Math.min(Math.max(0,PAGE),pages-1);
  const rows=combos.slice(PAGE*PAGE_SIZE,PAGE*PAGE_SIZE+PAGE_SIZE);
  const tb=$('#bulkTable tbody');if(!tb)return;
  tb.innerHTML=rows.map((c,k)=>{const i=PAGE*PAGE_SIZE+k,rep=c.filter(x=>prev.includes(x));
    return`<tr><td class="mono">${(i+1).toLocaleString()}</td><td><div class="balls">${ballsHTML(c)}</div></td>
    <td class="mono">${c.reduce((a,b)=>a+b,0)}</td><td class="mono">${c.filter(v=>v%2).length}</td>
    <td class="mono">${rep.length}</td><td><button class="btn btn-ghost sm" data-copy="${c.join(',')}">복사</button></td></tr>`;}).join('');
  const pi=$('#pgInfo');if(pi)pi.textContent=`${PAGE+1} / ${pages} 페이지 (총 ${combos.length.toLocaleString()}게임)`;
  const pv=$('#pgPrev'),nx=$('#pgNext');
  if(pv)pv.onclick=()=>{PAGE--;renderPage();bindComboGrid();};
  if(nx)nx.onclick=()=>{PAGE++;renderPage();bindComboGrid();};
  document.querySelectorAll('#bulkTable .ball').forEach(b=>{b.style.width='28px';b.style.height='28px';b.style.fontSize='.72rem';});
}
function bindComboGrid(){
  document.querySelectorAll('#comboGrid [data-copy]').forEach(b=>b.onclick=async()=>{
    toast(await copyText(b.dataset.copy)?'복사됨: '+b.dataset.copy:'복사 실패 — 직접 옮겨 적어주세요');});
  const rt=document.querySelector('#comboGrid [data-act="retry"]');
  if(rt)rt.onclick=()=>location.reload();
}
/* 일괄 저장: CSV(엑셀 BOM)·TXT — 개인정보 포함 없음, 순수 번호만 저장 */
function stampName(ext){const d=new Date(),p=v=>String(v).padStart(2,'0');
  return`lotto-${LAST_GEN?LAST_GEN.target:''}game-ultra-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;}
function download(name,content,type){
  const b=new Blob([content],{type});const u=URL.createObjectURL(b);
  const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(u);a.remove();},500);
}
function bulkCSV(){if(!LAST_GEN)return;
  const head='게임,번호1,번호2,번호3,번호4,번호5,번호6,합,홀수,직전중복\n';
  const body=LAST_GEN.combos.map((c,i)=>[i+1,...c,c.reduce((a,b)=>a+b,0),c.filter(v=>v%2).length,
    c.filter(x=>LAST_GEN.prev.includes(x)).length].join(',')).join('\n');
  download(stampName('csv'),'﻿'+head+body,'text/csv;charset=utf-8');toast(LAST_GEN.combos.length.toLocaleString()+'게임 CSV 저장');}
function bulkTXT(){if(!LAST_GEN)return;
  const body=LAST_GEN.combos.map((c,i)=>`${String(i+1).padStart(5,' ')}. ${c.map(x=>String(x).padStart(2,' ')).join(' ')}`).join('\n');
  download(stampName('txt'),`LOTTO QUANTUM ULTRA ${LAST_GEN.target}회 예측 ${LAST_GEN.combos.length}게임 (독립시행·당첨보장 없음)\n${body}`,'text/plain;charset=utf-8');toast('TXT 저장');}
async function copyAll(){if(!LAST_GEN)return;
  toast(await copyText(LAST_GEN.combos.map(c=>c.join(',')).join('\n'))?LAST_GEN.combos.length.toLocaleString()+'게임 전체 복사됨':'복사 실패');}
/* SNS 전송: 공유 텍스트에 개인정보 없음. 대량은 Top5 요약 + 페이지 링크 공유 */
function shareText(){if(!LAST_GEN)return'';
  const top=LAST_GEN.combos.slice(0,5).map((c,i)=>`${i+1}게임 ${c.join(',')}`).join('\n');
  return`[LOTTO QUANTUM ULTRA] ${LAST_GEN.target}회 예측 Top5\n${top}\n#로또예측 ${location.href}`;}
async function sysShare(){const t=shareText();if(!t)return;
  if(navigator.share){try{await navigator.share({title:'LOTTO QUANTUM ULTRA',text:t});}catch(e){}}
  else window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(t),'_blank','noopener');}
function snsShare(net){const t=shareText();if(!t)return;const u=encodeURIComponent(location.href),x=encodeURIComponent(t);
  const url=net==='x'?'https://twitter.com/intent/tweet?text='+x
    :net==='tg'?'https://t.me/share/url?url='+u+'&text='+x
    :'https://www.facebook.com/sharer/sharer.php?u='+u;
  window.open(url,'_blank','noopener,width=600,height=540');}
function renderLab(){
  const freq=[...Array(45)].map((_,i)=>ROWS.filter(r=>r.nums.includes(i+1)).length);
  bar('#chartFreq',freq,{labels:[...Array(45)].map((_,i)=>i+1)});
  $('#transList').innerHTML=MODEL.lifts.slice(0,12).map(t=>`<div class="trow"><span>${t.y}→${t.x}</span><div class="bar"><i style="width:${Math.min(100,t.l/1.7*100)}%"></i></div><span>${t.l.toFixed(2)}</span></div>`).join('');
  const sums=ROWS.map(r=>r.nums.reduce((a,b)=>a+b,0));
  const bins=new Array(12).fill(0);sums.forEach(s=>{const i=Math.min(11,Math.floor((s-40)/18));bins[i]++;});
  bar('#chartSum',bins,{color:'#e879f9',labels:bins.map((_,i)=>40+i*18+'~')});
  // repeat obs vs theory
  const rep=[0,0,0,0,0];for(let i=0;i<ROWS.length-1;i++)rep[Math.min(4,ROWS[i].nums.filter(x=>ROWS[i+1].nums.includes(x)).length)]++;
  bar('#chartRep',rep,{color:'#fbbf24',labels:['0','1','2','3','4+']});
}
/* READY 상태: 생성 버튼을 누르기 전에는 항상 빈 초기화 화면 */
function showReady(msg){
  LAST_GEN=null;PAGE=0;
  $('#bulkRow').classList.add('hidden');$('#genBar').classList.add('hidden');
  $('#comboGrid').innerHTML=`<div class="glass combo full"><span class="rank">READY</span>
    <div class="meta"><span class="chip">${esc(msg)}</span></div></div>`;
}
/* 초기화: 입력·필터·결과를 기본값으로 (희귀패턴 4종 전부 ON) */
function resetAll(){
  $('#comboCount').value=5;$('#temperature').value='1.5';$('#seedInput').value=7;
  $('#includeNums').value='';$('#excludeNums').value='';
  $('#fRun4').checked=true;$('#fOverlap4').checked=true;$('#fParity').checked=true;$('#fSum').checked=true;
  showReady('초기화됨 — ⟳ 양자 재생성을 누르면 새 예측이 생성됩니다');
  toast('초기화됨 (플랜·학습데이터는 유지)');
}
/* 백테스트: 청크 비동기로 UI 프리징 해소 + 진행 표시 */
let backRunning=false;
async function runBacktest(){
  if(backRunning){toast('백테스트 실행 중…');return;}
  if(!ROWS.length||!MODEL){toast('데이터 없음');return;}
  backRunning=true;const btn=$('#runBackBtn');if(btn){btn.textContent='실행 중…';btn.disabled=true;}
  const t0=600,hits=[];
  for(let i=t0;i<ROWS.length-1;i++){
    const sub=buildModel(ROWS.slice(0,i+1));
    const{s}=scoreAll(sub,ROWS[i].nums,ROWS[i].b);
    const top=[...Array(45)].map((_,k)=>k+1).sort((a,b)=>s[b]-s[a]).slice(0,6);
    hits.push(top.filter(x=>ROWS[i+1].nums.includes(x)).length);
    if((i-t0)%40===0){$('#backAvg').textContent=`${i-t0}/${ROWS.length-1-t0}`;await new Promise(r=>setTimeout(r,0));}
  }
  const avg=hits.reduce((a,b)=>a+b,0)/hits.length;
  $('#backAvg').textContent=avg.toFixed(2)+'개';
  const dist=[0,0,0,0,0,0,0];hits.forEach(h=>dist[h]++);
  bar('#chartBack',dist,{labels:['0','1','2','3','4','5','6']});
  backRunning=false;if(btn){btn.textContent='재실행';btn.disabled=false;}
  toast(`백테스트 완료: ${avg.toFixed(4)}개 (기대 0.80)`);
}
/* 자가진단: 데이터·엔진·보안·렌더링 10항목 + 실패 시 해결책 */
async function runDiag(){
  const box=$('#diagList');if(!box)return;
  box.innerHTML=`<p class="cap">진단 중…</p>`;
  const rows=[];
  const put=(name,st,msg,fix)=>rows.push({name,st,msg,fix});
  put('데이터 파일 로드',ROWS.length>=1000?'pass':'fail',
    `${ROWS.length}회차`,ROWS.length>=1000?'':'npx serve . 로 실행 후 새로고침');
  let seq=true;for(let i=1;i<ROWS.length;i++)if(ROWS[i].r!==ROWS[i-1].r+1){seq=false;break;}
  put('회차 연속성',seq?'pass':'warn',seq?'1~'+(ROWS.length?ROWS[ROWS.length-1].r:'?')+'회 연속':'중간 누락 회차 존재','CSV에 누락 회차 추가');
  try{
    const last=ROWS[ROWS.length-1];
    const r=await sampleCombos(MODEL,last.nums,last.b,5,7,1.5,[],[],null);
    let ok=r.combos.length===5;
    for(const c of r.combos){if(c.length!==6||new Set(c).size!==6||!balanced(c)||maxRun(c)>=4)ok=false;}
    put('엔진 스모크 테스트',ok?'pass':'fail',ok?'5게임 전부 규격 통과':'규격 위반 조합 발생','필터 토글을 기본값으로 되돌린 뒤 재생성');
  }catch(e){put('엔진 스모크 테스트','fail',String(e).slice(0,60),'데이터 로드 상태 확인');}
  try{
    const last=ROWS[ROWS.length-1];const t0=performance.now();
    await sampleCombos(MODEL,last.nums,last.b,1000,7,1.5,[],[],null);
    const ms=performance.now()-t0;
    put('생성 속도 (1000게임)',ms<3000?'pass':'warn',`${ms.toFixed(0)}ms`,ms<3000?'':'저사양 기기 — 10,000게임은 시간이 걸릴 수 있음');
  }catch(e){put('생성 속도 (1000게임)','fail','측정 실패','데이터 로드 상태 확인');}
  const need=['comboGrid','regenBtn','resetBtn','genBar','genFill','genTxt','bulkRow','chartFreq','histTable','diagList','countdown'];
  const miss=need.filter(id=>!document.getElementById(id));
  put('필수 UI 요소',!miss.length?'pass':'fail',!miss.length?need.length+'개 전부 존재':'누락: '+miss.join(','),'index.html이 최신인지 확인 후 새로고침');
  put('CSP 메타',document.querySelector('meta[http-equiv="Content-Security-Policy"]')?'pass':'warn',
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?'활성':'없음','최신 index.html 배포 확인');
  let ls='차단됨';try{localStorage.setItem('__t','1');localStorage.removeItem('__t');ls='사용 가능';}catch(e){}
  put('브라우저 저장소',ls==='사용 가능'?'pass':'warn',ls+'(플랜 기억 기능만 영향)','시크릿모드·쿠키차단 시 플랜이 유지되지 않음');
  put('실행 프로토콜',location.protocol.startsWith('http')?'pass':'fail',location.protocol,
    location.protocol.startsWith('http')?'':'file:// 직접 실행 — npx serve . 로 실행');
  put('공유 API',navigator.share?'pass':'warn',navigator.share?'시스템공유 지원':'미지원 기기 — X·텔레그램 버튼 사용','최신 모바일 브라우저 권장');
  put('플랜 상한',JSON.stringify(PLAN_MAX)==='{"free":5,"pro":500,"ultra":10000}'?'pass':'warn',`FREE ${PLAN_MAX.free} / PRO ${PLAN_MAX.pro} / ULTRA ${PLAN_MAX.ultra}`,'app.js PLAN_MAX 확인');
  const sym={pass:'✓',fail:'✗',warn:'!'};
  const nFail=rows.filter(r=>r.st==='fail').length,nWarn=rows.filter(r=>r.st==='warn').length;
  box.innerHTML=`<div class="meta" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span class="chip ${nFail?'hot':''}">${nFail?`실패 ${nFail}건`:'전체 통과'}</span>${nWarn?`<span class="chip">주의 ${nWarn}건</span>`:''}</div>`+
    rows.map(r=>`<div class="diag-row ${r.st}"><b>${sym[r.st]} ${esc(r.name)}</b><span>${esc(r.msg)}</span>${r.fix?`<small>→ ${esc(r.fix)}</small>`:''}</div>`).join('');
}
function renderHistory(filter=''){
  const tb=$('#histTable tbody');const f=filter.trim();
  let rows=[...ROWS].reverse();
  if(f){const nums=parseNums(f);
    rows=rows.filter(r=>nums.length?nums.every(n=>r.nums.includes(n)||r.b===n):String(r.r)===f);}
  tb.innerHTML=rows.slice(0,60).map(r=>`<tr><td class="mono">${r.r}</td><td><div class="balls">${ballsHTML(r.nums)}</div></td>
    <td><span class="ball ${ballCls(r.b)} bonus" style="width:30px;height:30px;font-size:.75rem">${r.b}</span></td>
    <td class="mono">${r.nums.reduce((a,b)=>a+b,0)}</td><td class="mono">${r.nums.filter(v=>v%2).length}홀</td></tr>`).join('');
}
/* countdown: Saturday 20:35 KST */
function tick(){
  const now=new Date(),kst=new Date(now.getTime()+(9*60+now.getTimezoneOffset())*60000);
  const d=new Date(kst);let add=(6-d.getDay()+7)%7;const t=new Date(d);t.setDate(d.getDate()+add);t.setHours(20,35,0,0);
  if(t<kst)t.setDate(t.getDate()+7);
  let s=Math.floor((t-kst)/1000);const dd=Math.floor(s/86400);s%=86400;
  const h=String(Math.floor(s/3600)).padStart(2,'0'),m=String(Math.floor(s%3600/60)).padStart(2,'0'),ss=String(s%60).padStart(2,'0');
  $('#countdown').textContent=(dd?dd+'일 ':'')+`${h}:${m}:${ss}`;
}
/* stars */
function stars(){
  const c=$('#stars'),g=c.getContext('2d');let W,H,pts=[];
  const rs=()=>{W=c.width=innerWidth;H=c.height=innerHeight;pts=[...Array(Math.min(220,innerWidth/6))].map(()=>({x:Math.random()*W,y:Math.random()*H,z:Math.random()}));};
  rs();addEventListener('resize',rs);
  (function loop(){g.clearRect(0,0,W,H);pts.forEach(p=>{p.y+=p.z*.25;if(p.y>H)p.y=0;
    g.globalAlpha=.25+p.z*.6;g.fillStyle=p.z>.8?'#a5f3fc':'#fff';g.fillRect(p.x,p.y,p.z>0.7?2:1,p.z>0.7?2:1);});
    g.globalAlpha=1;requestAnimationFrame(loop);})();
}
/* plans */
function markPlanButtons(){
  document.querySelectorAll('[data-plan]').forEach(x=>{
    if(!x.dataset.label)x.dataset.label=x.textContent;
    const active=x.dataset.plan===PLAN;
    x.textContent=active?'✓ 사용중':x.dataset.label;
    x.classList.toggle('btn-neon',active&&PLAN!=='free');
    x.classList.toggle('btn-ghost',!(active&&PLAN!=='free'));
  });
}
function setPlan(p){PLAN=p;storeSet('lqu_plan',p);
  const b=$('#planBadge');b.textContent=p.toUpperCase();b.className='plan-badge '+p;
  markPlanButtons();
  toast(p==='ultra'?'ULTRA 활성화: 10,000게임·고정픽·전체표 해제':p==='pro'?'PRO 활성화: 500게임·고정픽 해제':'FREE 플랜');if(LAST_GEN)renderCombos();}
/* boot */
window.addEventListener('DOMContentLoaded',async()=>{
  stars();setInterval(tick,1000);tick();
  // UI 바인딩을 먼저 해서 데이터 실패 때도 버튼이 죽지 않게 한다
  $('#regenBtn').onclick=()=>{$('#seedInput').value=(+$('#seedInput').value||0)+1;renderCombos();};
  $('#resetBtn').onclick=resetAll;
  const dg=document.getElementById('diagBtn');if(dg)dg.onclick=runDiag;
  ['comboCount','temperature','seedInput','includeNums','excludeNums'].forEach(id=>$('#'+id).addEventListener('change',()=>{if(LAST_GEN)renderCombos();}));
  const bulk={csvBtn:bulkCSV,txtBtn:bulkTXT,copyAllBtn:copyAll,shareSysBtn:sysShare};
  for(const[id,fn]of Object.entries(bulk)){const el=document.getElementById(id);if(el)el.onclick=fn;}
  const sns={shareXBtn:'x',shareTgBtn:'tg',shareFbBtn:'fb'};
  for(const[id,net]of Object.entries(sns)){const el=document.getElementById(id);if(el)el.onclick=()=>snsShare(net);}
  const entry={addDrawBtn:addDraw,exportCsvBtn:exportMergedCSV,clearCustomBtn:clearCustom};
  for(const[id,fn]of Object.entries(entry)){const el=document.getElementById(id);if(el)el.onclick=fn;}
  const nr=document.getElementById('newNums');if(nr)nr.addEventListener('keydown',e=>{if(e.key==='Enter')addDraw();});
  ['fRun4','fOverlap4','fParity','fSum'].forEach(id=>$('#'+id)?.addEventListener('change',()=>{if(LAST_GEN)renderCombos();}));
  try{
    await loadCSV();
    ROWS=mergeRows(BASE_ROWS,loadCustomDraws());
    MODEL=buildModel(ROWS);
    const b=$('#planBadge');b.textContent=PLAN.toUpperCase();b.className='plan-badge '+PLAN;
    markPlanButtons();refreshTitles();
    renderDraw();showReady('데이터 준비 완료 — ⟳ 양자 재생성을 누르면 예측이 생성됩니다');renderLab();renderHistory();renderCustomList();
  }catch(err){
    console.error(err);
    $('#comboGrid').innerHTML=dataErrorHTML(err.message||'알 수 없음');
    toast('데이터 로드 실패 — 아래 안내대로 로컬 서버로 실행하세요');
  }
  let histT=null;
  $('#histSearch').addEventListener('input',e=>{clearTimeout(histT);histT=setTimeout(()=>renderHistory(e.target.value),200);});
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
    const k=t.dataset.tab;
    if(k==='freq'){$('#labTitle').textContent='번호별 출현 빈도 (전체)';bar('#chartFreq',[...Array(45)].map((_,i)=>ROWS.filter(r=>r.nums.includes(i+1)).length),{labels:[...Array(45)].map((_,i)=>i+1)});}
    if(k==='trans'){$('#labTitle').textContent='전이 lift 분포 — 대부분 0.5~1.6 노이즈 대역';bar('#chartFreq',MODEL.lifts.map(t=>t.l).slice(0,60),{color:'#e879f9'});}
    if(k==='balance'){$('#labTitle').textContent='홀짝 개수 분포 (0~6)';const c=[0,0,0,0,0,0,0];ROWS.forEach(r=>c[r.nums.filter(v=>v%2).length]++);bar('#chartFreq',c,{color:'#fbbf24',labels:['0','1','2','3','4','5','6']});}
    if(k==='back'){runBacktest();}
  });
  $('#runBackBtn').onclick=runBacktest;
  document.querySelectorAll('[data-plan]').forEach(x=>x.onclick=()=>setPlan(x.dataset.plan));
  $('#menuBtn').onclick=()=>$('#mobileMenu').classList.toggle('hidden');
  document.querySelectorAll('#mobileMenu a').forEach(a=>a.onclick=()=>$('#mobileMenu').classList.add('hidden'));
});
