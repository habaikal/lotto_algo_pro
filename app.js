/* LOTTO QUANTUM ULTRA — EB-Markov engine (JS port of lotto_markov_predictor.py) */
'use strict';
const CFG = { aBase:10, aPair:20, aBonus:10, lPrev:0.6, lBonus:0.3, lTrend:0.01, balSum:[98,177], balOdd:[2,4], balLow:[2,4] };
const storeGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const storeSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
let ROWS=[], MODEL=null, PLAN=storeGet('lqu_plan')||'free';
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
  ROWS=lines.map(l=>{const p=l.split(',').map(Number);return{r:p[0],nums:[p[1],p[2],p[3],p[4],p[5],p[6]].sort((a,b)=>a-b),b:p[7]}}).filter(x=>x.nums.length===6).sort((a,b)=>a.r-b.r);
  if(!ROWS.length)throw new Error('CSV 파싱 결과 0건');
}
function dataErrorHTML(msg){
  return`<div class="glass combo full"><span class="rank">DATA ERROR</span>
    <div class="meta"><span class="chip hot">데이터 로드 실패: ${msg}</span></div>
    <p class="cap">가장 흔한 원인: <b>index.html을 더블클릭(file://)으로 열었기 때문</b>입니다. 브라우저 보안 정책상 데이터 파일을 읽지 못해 예측 버튼이 동작하지 않습니다.<br>
    해결 ① 폴더에서 <span class="mono">npx serve .</span> 실행 → 표시된 주소로 접속 ② 또는 <span class="mono">python -m http.server 8000</span> 후 http://localhost:8000 접속<br>
    그래도 안 되면 lotto_results.csv 파일이 index.html과 같은 폴더에 있는지 확인하세요.</p>
    <div class="row-btns"><button class="btn btn-neon sm" onclick="location.reload()">⟳ 다시 시도</button></div></div>`;
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
const balanced=c=>{const s=c.reduce((a,b)=>a+b,0),o=c.filter(v=>v%2).length,l=c.filter(v=>v<=22).length;
  return s>=CFG.balSum[0]&&s<=CFG.balSum[1]&&o>=CFG.balOdd[0]&&o<=CFG.balOdd[1]&&l>=CFG.balLow[0]&&l<=CFG.balLow[1];};
function parseNums(str){return(str||'').split(/[, ]+/).map(Number).filter(n=>n>=1&&n<=45)}
/* 희귀패턴 제거: 이론+실측이 모두 희귀한 영역만 차단. 어떤 조합의 확률도 1/8,145,060으로 동일하므로
   이 필터는 기대값 향상이 아니라 슬롯 정리 기능이다. */
const maxRun=c=>{let m=1,cur=1;for(let i=1;i<c.length;i++){if(c[i]===c[i-1]+1){cur++;m=Math.max(m,cur);}else cur=1;}return m;};
const rareOpts=()=>({run4:$('#fRun4')?.checked??true, overlap4:$('#fOverlap4')?.checked??true,
  parity:$('#fParity')?.checked??false, sum:$('#fSum')?.checked??false});
function rareReject(c,prevS,o){
  if(o.run4&&maxRun(c)>=4)return'연속4+';
  if(o.overlap4&&c.filter(x=>prevS.has(x)).length>=4)return'직전중복4+';
  if(o.parity){const n=c.filter(v=>v%2).length;if(n===0||n===6)return'전홀/전짝';}
  if(o.sum){const s=c.reduce((a,b)=>a+b,0);if(s<70||s>210)return'극단합';}
  return null;
}
function sampleCombos(model,prev,bonus,n,seed,temp,inc,exc){
  const{s}=scoreAll(model,prev,bonus),mx=Math.max(...Object.values(s));
  const w={};for(let x=1;x<=45;x++)w[x]=Math.exp((s[x]-mx)/temp);
  const rng=mulberry32(seed),prevS=new Set(prev),excS=new Set(exc),cands=[],seen=new Set();
  const o=rareOpts(),rej={};
  const pool=[...Array(45)].map((_,i)=>i+1).filter(x=>!excS.has(x));
  const must=[...new Set(inc)].filter(x=>!excS.has(x)).slice(0,5);
  for(let t=0;t<30000&&cands.length<n*30;t++){
    let c=[];
    if(must.length&&rng()<0.7){c=[...must];while(c.length<6){c.push(pool[Math.floor(rng()*pool.length)]);}}
    else{const tot=pool.reduce((a,x)=>a+w[x],0);while(c.length<6){let r=rng()*tot,pk=pool[0];for(const x of pool){r-=w[x];if(r<=0){pk=x;break;}}c.push(pk);} }
    c=[...new Set(c)].sort((a,b)=>a-b);if(c.length!==6)continue;
    if(must.length&&!must.every(m=>c.includes(m)))continue;
    const k=c.join(',');if(seen.has(k))continue;seen.add(k);
    if(!balanced(c))continue;
    const rr=rareReject(c,prevS,o);if(rr){rej[rr]=(rej[rr]||0)+1;continue;}
    cands.push(c);
  }
  cands.sort((a,b)=>scoreSum(s,b)-scoreSum(s,a));
  const out=[];for(const c of cands){if(out.length>=n)break;
    if(out.every(o2=>o2.filter(x=>c.includes(x)).length<=3))out.push(c);}
  while(out.length<n){const c=[...Array(45)].map((_,i)=>i+1).filter(x=>!excS.has(x)).sort(()=>Math.random()-.5).slice(0,6).sort((a,b)=>a-b);
    if(!balanced(c)||rareReject(c,prevS,o)||!must.every(m=>c.includes(m)))continue;out.push(c);}
  return{combos:out.slice(0,n),scores:s,rej};
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
function planLimit(n){return PLAN==='ultra'?n:PLAN==='pro'?Math.min(n,10):Math.min(n,5);}
function renderCombos(){
  if(!ROWS.length||!MODEL){$('#comboGrid').innerHTML=dataErrorHTML('학습 데이터 없음');return;}
  const last=ROWS[ROWS.length-1];
  let n=planLimit(+$('#comboCount').value);
  const temp=+$('#temperature').value, seed=+$('#seedInput').value||7;
  const inc=parseNums($('#includeNums').value), exc=parseNums($('#excludeNums').value);
  if(PLAN==='free'&&(inc.length>0||exc.length>0)){toast('포함/제외 고정은 PRO 이상 — 입력은 무시됩니다');}
  const{combos,scores,rej}=sampleCombos(MODEL,last.nums,last.b,n,seed,temp,PLAN==='free'?[]:inc,PLAN==='free'?[]:exc);
  const rejTxt=Object.entries(rej).map(([k,v])=>`${k} ${v}건`).join(' · ');
  const onList=[ $('#fRun4')?.checked&&'연속4+제거', $('#fOverlap4')?.checked&&'직전중복4+제거', $('#fParity')?.checked&&'전홀/전짝제거', $('#fSum')?.checked&&'극단합제거'].filter(Boolean).join(' · ')||'필터 OFF';
  $('#comboGrid').innerHTML=`<div class="glass combo full"><span class="rank">FILTER LOG</span>
    <div class="meta"><span class="chip hot">적용중: ${onList}</span>${rejTxt?`<span class="chip">이번 생성에서 차단: ${rejTxt}</span>`:`<span class="chip">차단 건 없음</span>`}
    <span class="chip">직전 3개 중복은 허용 (이론 2.2%, 희귀 아님)</span></div></div>`+combos.map((c,i)=>{const rep=c.filter(x=>last.nums.includes(x));
    return`<div class="glass combo"><span class="rank">COMBO ${String(i+1).padStart(2,'0')}</span>
    <div class="balls">${ballsHTML(c)}</div>
    <div class="meta"><span class="chip">합 ${c.reduce((a,b)=>a+b,0)}</span><span class="chip">홀 ${c.filter(v=>v%2).length}</span>
    <span class="chip ${rep.length?'hot':''}">직전중복 ${rep.length}${rep.length?' ('+rep.join(',')+')':''}</span>
    <span class="chip">Σscore ${scoreSum(scores,c).toFixed(2)}</span></div>
    <div class="row-btns"><button class="btn btn-ghost sm" data-copy="${c.join(',')}">복사</button></div></div>`;}).join('');
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{
    try{await navigator.clipboard.writeText(b.dataset.copy);}
    catch(e){const ta=document.createElement('textarea');ta.value=b.dataset.copy;document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){} ta.remove();}
    toast('복사됨: '+b.dataset.copy);});
}
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
function runBacktest(){
  const t0=600,hits=[];
  // subset models for speed: reuse full-model pair counts via incremental? simple loop with cached MODEL on full data would leak; do honest loop on slices (fast enough: 643 * small)
  for(let i=t0;i<ROWS.length-1;i++){
    const sub=buildModel(ROWS.slice(0,i+1));
    const{s}=scoreAll(sub,ROWS[i].nums,ROWS[i].b);
    const top=[...Array(45)].map((_,k)=>k+1).sort((a,b)=>s[b]-s[a]).slice(0,6);
    hits.push(top.filter(x=>ROWS[i+1].nums.includes(x)).length);
  }
  const avg=hits.reduce((a,b)=>a+b,0)/hits.length;
  $('#backAvg').textContent=avg.toFixed(2)+'개';
  const dist=[0,0,0,0,0,0,0];hits.forEach(h=>dist[h]++);
  bar('#chartBack',dist,{labels:['0','1','2','3','4','5','6']});
  toast(`백테스트 완료: ${avg.toFixed(4)}개 (기대 0.80)`);
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
function setPlan(p){PLAN=p;storeSet('lqu_plan',p);
  const b=$('#planBadge');b.textContent=p.toUpperCase();b.className='plan-badge '+p;
  document.querySelectorAll('[data-plan]').forEach(x=>x.textContent='현재 플랜'===x.textContent?'':x.textContent);
  toast(p==='ultra'?'ULTRA 활성화: 20조합·고정픽·전체표 해제':p==='pro'?'PRO 활성화':'FREE 플랜');renderCombos();}
/* boot */
window.addEventListener('DOMContentLoaded',async()=>{
  stars();setInterval(tick,1000);tick();
  // UI 바인딩을 먼저 해서 데이터 실패 때도 버튼이 죽지 않게 한다
  $('#regenBtn').onclick=()=>{$('#seedInput').value=(+$('#seedInput').value||0)+1;renderCombos();};
  ['comboCount','temperature','seedInput','includeNums','excludeNums'].forEach(id=>$('#'+id).addEventListener('change',renderCombos));
  ['fRun4','fOverlap4','fParity','fSum'].forEach(id=>$('#'+id)?.addEventListener('change',renderCombos));
  try{
    await loadCSV();MODEL=buildModel(ROWS);
    const b=$('#planBadge');b.textContent=PLAN.toUpperCase();b.className='plan-badge '+PLAN;
    renderDraw();renderCombos();renderLab();renderHistory();
  }catch(err){
    console.error(err);
    $('#comboGrid').innerHTML=dataErrorHTML(err.message||'알 수 없음');
    toast('데이터 로드 실패 — 아래 안내대로 로컬 서버로 실행하세요');
  }
  $('#histSearch').addEventListener('input',e=>renderHistory(e.target.value));
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
