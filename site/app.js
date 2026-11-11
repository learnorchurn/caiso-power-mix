'use strict';
// Power renderer extracted from Richard Couch's Live Data Lab.
// Directed by Richard. Built with Codex. See docs/ORIGIN.md.
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString('en-US') : '—';
const signed = value => `${value > 0 ? '+' : ''}${num(value)}`;
const pct = value => value == null ? 'No prior baseline' : `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}% vs previous 7 days`;
const safeUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } };
const link = (url, label) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const stamp = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value || 'Unavailable') : d.toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' PT'; };
const dateLabel = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

const fuels = [{key:'solar',name:'Solar',color:'#f4bd65'},{key:'wind',name:'Wind',color:'#b8e7c3'},{key:'hydro',name:'Hydro',color:'#81b6d9'},{key:'nuclear',name:'Nuclear',color:'#c1a9dd'},{key:'other',name:'Other',color:'#93aaa8'},{key:'imports',name:'Imports',color:'#b5bfd0'},{key:'natural_gas',name:'Natural gas',color:'#f59b83'},{key:'batteries',name:'Batteries',color:'#c3b2ef'}];

const state={power:null,powerLatest:false,powerIndex:0,powerGeometry:null,playing:null,urlSyncTimer:null};
function findPowerTimeIndex(rows,time){
  const parts=time.split(':').map(Number),target=parts[0]*60+parts[1];
  let closest=0,distance=Infinity;
  rows.forEach((row,i)=>{const [h,m]=row.time.split(':').map(Number),delta=Math.abs(h*60+m-target);if(delta<distance){distance=delta;closest=i;}});
  return closest;
}
function restorePowerUrl(){
  if(!state.power)return;
  const p=new URL(location.href).searchParams;
  state.powerLatest=p.get('power_dataset')==='latest'&&Boolean(state.power.latest?.series?.length);
  const rows=powerDataset().series, requested=p.get('power_time');
  const time=requested&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(requested)?requested:(state.powerLatest?rows[rows.length-1].time:'16:00');
  state.powerIndex=findPowerTimeIndex(rows,time);
  renderPower();
}
function syncLabUrl(mode='replace'){
  if(!state.power)return;
  const url=new URL(location.href);
  url.searchParams.set('power_dataset',state.powerLatest?'latest':'replay');
  url.searchParams.set('power_time',powerDataset().series[state.powerIndex].time);
  if(url.href!==location.href)history[mode==='push'?'pushState':'replaceState'](null,'',url);
}
function scheduleLabUrl(){clearTimeout(state.urlSyncTimer);state.urlSyncTimer=setTimeout(()=>syncLabUrl(),180);}
window.addEventListener('popstate',()=>{stopPlay();restorePowerUrl();});

function powerDataset(){return state.powerLatest&&state.power.latest?state.power.latest:state.power;}
function powerTimeline(d) {
  const first=d.series[0], [hour,minute]=first.time.split(':').map(Number);
  const firstTimestamp=Date.parse(first.timestamp), start=firstTimestamp-(hour*60+minute)*60000;
  const intervals=d.coverage?.expected_intervals||288, duration=intervals*5;
  const minutes=row=>Number.isFinite(start)&&Number.isFinite(Date.parse(row.timestamp))?(Date.parse(row.timestamp)-start)/60000:row.time.split(':').reduce((h,m)=>Number(h)*60+Number(m));
  return {start,intervals,duration,minutes};
}
// Match SVG units to screen pixels so the axis stays readable on a narrow chart.
function powerChartLayout(renderedWidth){
  const width=Number.isFinite(renderedWidth)&&renderedWidth>0?Math.max(160,Math.round(renderedWidth)):900;
  const height=width<560?240:300,left=42,right=8,top=34,bottom=14;
  return {width,height,left,right,top,bottom,range:width-left-right,plotHeight:height-top-bottom,cursorWidth:58,cursorY:16};
}
function powerAxisTicks(ymin,ymax,plotHeight){
  if(ymax<=ymin)return [0];
  const range=ymax-ymin,rawStep=range/Math.max(2,Math.floor(plotHeight/36)),magnitude=10**Math.floor(Math.log10(rawStep));
  const step=([1,2,5,10].find(n=>n*magnitude>=rawStep)||10)*magnitude;
  const ticks=[0],add=value=>{if(!ticks.some(tick=>Math.abs(tick-value)/range*plotHeight<24))ticks.push(value);};
  for(let tick=Math.ceil(ymin/step)*step;tick<=ymax;tick+=step)if(tick!==0)add(tick);
  add(ymin);add(ymax);
  return ticks.sort((a,b)=>a-b);
}
function powerPointerMinute(clientX,boxLeft,boxWidth,duration,geometry){
  if(!(boxWidth>0))return 0;
  return Math.max(0,Math.min(duration,((clientX-boxLeft)/boxWidth*geometry.width-geometry.left)/geometry.range*duration));
}
function refreshPowerChartSize(){
  if(!state.power)return;
  const width=$('power-chart').getBoundingClientRect?.().width||0;
  if(width>0&&Math.round(width)!==state.powerGeometry?.width)renderPowerChart();
}
function renderPower() {
  const p=state.power;
  if(!Array.isArray(p.series)||!p.series.length)throw Error('No power observations');
  if(!p.latest?.series?.length)state.powerLatest=false;
  $('power-teaser').textContent=`${num(p.series.length)} readings · ${dateLabel(p.data_date)}`;
  $('latest-day').disabled=!p.latest?.series?.length;
  $('power-legend').innerHTML=fuels.map(f=>`<span><i style="background:${f.color}"></i>${f.name}</span>`).join('');
  const current=p.latest;
  $('power-method').innerHTML=`<p>${link(p.source.page_url,p.source.name||'CAISO Today’s Outlook')} · ${link(p.source.download_url,'Replay CSV')}${current?' · '+link(current.source.download_url,'Current-feed CSV'):''} · <a href="data/power.json">Download this snapshot</a></p><p>Completed day: ${esc(p.data_date)}. ${num(p.coverage.rows)} of ${num(p.coverage.expected_intervals||288)} intervals. ${p.coverage.complete?'Complete reported coverage.':'Coverage is incomplete; missing readings are not filled.'}</p>${current?`<p>Current-feed snapshot: ${esc(current.data_date)} through ${esc(current.coverage.last_time)} PT. ${num(current.coverage.rows)} of ${num(current.coverage.expected_intervals)} intervals. ${current.coverage.complete?'Complete reported day.':'The day is partial; later readings are not included.'}</p>`:''}${(p.warnings||[]).map(t=>`<p>${esc(t)}</p>`).join('')}<ul>${(p.methodology||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p>Five-minute power readings are MW, displayed here as GW. The chart shows observed supply and storage behavior, not causation, billing data or an operating forecast.</p>`;
  renderPowerChart();
}
function renderPowerChart() {
  const d=powerDataset(), rows=d.series, timeline=powerTimeline(d);
  state.powerIndex=Math.max(0,Math.min(state.powerIndex,rows.length-1));
  $('power-slider').max=String(timeline.intervals-1);
  $('power-date').textContent=dateLabel(d.data_date);
  const last=rows[rows.length-1], fetched=d.source?.fetched_at||state.power.generated_at;
  const observationAge=Date.now()-Date.parse(last.timestamp);
  const stale=state.powerLatest?(!Number.isFinite(observationAge)||observationAge>2*3600000):(!fetched||Date.now()-Date.parse(fetched)>36*3600000);
  const coverage=`${rows.length}/${timeline.intervals} intervals${d.coverage?.complete?'':' · partial day'}`;
  $('power-fresh').innerHTML=`<strong>${state.powerLatest?'Saved current-feed snapshot':'Completed-day replay'} · ${esc(d.data_date)}</strong><span class="${stale?'stale':''}">${stale?'Older snapshot · ':''}${state.powerLatest?'Observed through '+esc(last.time)+' PT · ':''}${esc(coverage)}<br>Fetched ${esc(stamp(fetched))}</span>`;
  $('replay-day').classList.toggle('selected',!state.powerLatest);
  $('latest-day').classList.toggle('selected',state.powerLatest);
  $('replay-day').setAttribute('aria-pressed',String(!state.powerLatest));
  $('latest-day').setAttribute('aria-pressed',String(state.powerLatest));
  document.querySelectorAll('#power-panel .time-labels span').forEach((label,i)=>{
    label.textContent=i===4?'24:00':Number.isFinite(timeline.start)?new Date(timeline.start+i/4*timeline.duration*60000).toLocaleTimeString('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):['00:00','06:00','12:00','18:00'][i];
  });
  const chart=$('power-chart'),geometry=powerChartLayout(chart.getBoundingClientRect?.().width);
  state.powerGeometry=geometry;
  const {width:w,height:h,left,right,top,bottom}=geometry;
  chart.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const xx=r=>left+timeline.minutes(r)/timeline.duration*(w-left-right);
  const valid=rows.map(r=>fuels.every(f=>Number.isFinite(r[f.key])));
  let ymax=0,ymin=0;
  rows.forEach((r,i)=>{if(!valid[i])return;ymax=Math.max(ymax,fuels.reduce((s,f)=>s+Math.max(0,r[f.key]),0));ymin=Math.min(ymin,fuels.reduce((s,f)=>s+Math.min(0,r[f.key]),0));});
  ymax=Math.ceil(ymax/10000)*10000;ymin=Math.floor(ymin/5000)*5000;
  const yy=v=>h-bottom-(v-ymin)/(ymax-ymin||1)*(h-top-bottom);
  let svg='<title>Reported power by source throughout the selected Pacific day</title><desc>Positive supply is stacked above zero. Negative readings remain below zero. Missing observations create gaps.</desc><defs>';
  for(const f of fuels)for(const direction of ['up','down'])svg+=`<linearGradient id="power-fill-${f.key}-${direction}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${f.color}" stop-opacity="${direction==='up'?'.94':'.36'}"/><stop offset="100%" stop-color="${f.color}" stop-opacity="${direction==='up'?'.62':'.74'}"/></linearGradient>`;
  svg+=`</defs><rect x="${left}" y="${top}" width="${w-left-right}" height="${h-top-bottom}" rx="4" fill="#102431" fill-opacity=".5"/>`;
  for(let i=0;i<=4;i++){const x=left+i/4*(w-left-right);svg+=`<line x1="${x}" x2="${x}" y1="${top}" y2="${h-bottom}" stroke="#c4d5db" stroke-opacity=".065" stroke-width=".7"/>`;}
  for(const tick of powerAxisTicks(ymin,ymax,geometry.plotHeight))svg+=`<line x1="${left}" x2="${w-right}" y1="${yy(tick)}" y2="${yy(tick)}" stroke="#c4d5db" stroke-opacity=".1" stroke-width=".7"/><text class="power-axis-tick" x="${left-9}" y="${yy(tick)+4}" text-anchor="end">${tick/1000}</text>`;
  svg+=`<text class="power-axis-unit" x="${left-9}" y="21" text-anchor="end">GW</text>`;
  const positive=rows.map(()=>0),negative=rows.map(()=>0);
  for(const f of fuels)for(const sign of [1,-1]){
    const base=sign===1?positive:negative;let chunk=[];
    const flush=()=>{if(chunk.length>1)svg+=`<path d="M${chunk.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')} L${chunk.slice().reverse().map(p=>`${p.x.toFixed(2)},${p.b.toFixed(2)}`).join(' L')} Z" fill="url(#power-fill-${f.key}-${sign===1?'up':'down'})" stroke="${f.color}" stroke-opacity=".25" stroke-width=".45" stroke-linejoin="round"/>`;chunk=[];};
    rows.forEach((r,i)=>{
      if(!valid[i]){flush();return;}
      if(i&&timeline.minutes(r)-timeline.minutes(rows[i-1])!==5)flush();
      const value=sign===1?Math.max(0,r[f.key]):Math.min(0,r[f.key]);
      chunk.push({x:xx(r),y:yy(base[i]+value),b:yy(base[i])});base[i]+=value;
    });flush();
  }
  svg+=`<line x1="${left}" x2="${w-right}" y1="${yy(0)}" y2="${yy(0)}" stroke="#e3e8dd" stroke-opacity=".6" stroke-width="1"/><rect id="power-cursor-band" y="${top}" width="12" height="${h-top-bottom}" fill="#fff2cc" fill-opacity=".045" pointer-events="none"/><line id="power-cursor" y1="${top}" y2="${h-bottom}" stroke="#ffe5b2" stroke-width="1.2" pointer-events="none"/><circle id="power-cursor-dot" cy="${h-bottom}" r="3.5" fill="#ffe5b2" stroke="#102431" stroke-width="1.5" pointer-events="none"/><g id="power-cursor-label" aria-hidden="true" pointer-events="none"><rect x="${-geometry.cursorWidth/2}" y="-12.5" width="${geometry.cursorWidth}" height="25" rx="12.5" fill="#f3c679"/><text id="power-cursor-text" text-anchor="middle" y="4" fill="#142734" font-weight="700" style="font-variant-numeric:tabular-nums"></text></g>`;
  $('power-chart').innerHTML=svg;
  $('power-chart').dataset.left=left;$('power-chart').dataset.range=w-left-right;
  renderPowerMoment();powerInsight();
}
function renderPowerMoment() {
  const d=powerDataset(),r=d.series[state.powerIndex];if(!r)return;
  const timeline=powerTimeline(d);
  $('power-time').textContent=r.time;
  const hour=Number(r.time.split(':')[0]),phase=hour<5||hour>=22?'Overnight':hour<11?'Morning':hour<14?'Midday':hour<18?'Afternoon':'Evening';
  if($('power-phase')){$('power-phase').textContent=phase;$('power-phase').dataset.phase=phase.toLowerCase();}
  $('power-slider').value=String(Math.round(timeline.minutes(r)/5));
  $('power-slider').setAttribute('aria-valuetext',`${d.data_date}, ${r.time} Pacific time`);
  const total=fuels.every(f=>Number.isFinite(r[f.key]))?fuels.reduce((s,f)=>s+r[f.key],0):null;
  $('power-total').textContent=total==null?'—':(total/1000).toFixed(1);
  const geometry=state.powerGeometry||powerChartLayout(),x=geometry.left+timeline.minutes(r)/timeline.duration*geometry.range,cursor=$('power-cursor');
  if(cursor){cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}
  if($('power-cursor-band'))$('power-cursor-band').setAttribute('x',x-6);
  if($('power-cursor-dot'))$('power-cursor-dot').setAttribute('cx',x);
  if($('power-cursor-label'))$('power-cursor-label').setAttribute('transform',`translate(${Math.max(geometry.left+geometry.cursorWidth/2,Math.min(geometry.width-geometry.right-geometry.cursorWidth/2,x))},${geometry.cursorY})`);
  if($('power-cursor-text'))$('power-cursor-text').textContent=r.time;
  const max=Math.max(...fuels.map(f=>Number.isFinite(r[f.key])?Math.abs(r[f.key]):0),1);
  $('power-mix').innerHTML=fuels.map(f=>{
    const value=r[f.key],known=Number.isFinite(value);
    const direction=known&&f.key==='batteries'?(value<0?' · charging':value>0?' · discharging':''):known&&f.key==='imports'&&value<0?' · net exports':'';
    return `<div class="mix-row"><div class="mix-label"><span>${f.name}${direction}</span><span>${known?(value/1000).toFixed(2)+' GW':'No reading'}</span></div><div class="mix-track"><span style="background:linear-gradient(90deg,${f.color}88,${f.color});width:${known?Math.abs(value)/max*100:0}%"></span></div></div>`;
  }).join('');
}
function powerInsight() {
  const d=powerDataset(),rows=d.series,a=rows.find(r=>r.time==='15:00'),b=rows.find(r=>r.time==='20:00');
  if(!a||!b||!Number.isFinite(a.solar)||!Number.isFinite(b.solar)){
    $('power-insight').textContent=`CAISO’s ${dateLabel(d.data_date)} snapshot ends at ${rows[rows.length-1].time} PT. The 15:00–20:00 solar comparison needs both readings. Choose Completed day for the full replay.`;return;
  }
  const rises=fuels.filter(f=>f.key!=='solar'&&Number.isFinite(a[f.key])&&Number.isFinite(b[f.key])).map(f=>({...f,delta:b[f.key]-a[f.key]})).filter(f=>f.delta>0).sort((x,y)=>y.delta-x.delta).slice(0,2);
  const labels={batteries:'net battery power',imports:'net imports',other:'other sources'};
  const solarChange=b.solar-a.solar;
  $('power-insight').innerHTML=`In CAISO’s ${esc(dateLabel(d.data_date))} readings, solar ${solarChange===0?'was unchanged at':solarChange<0?'fell':'rose'} <b>${((solarChange===0?a.solar:Math.abs(solarChange))/1000).toFixed(1)} GW</b> from 15:00 to 20:00.${rises.length?' Largest net increases: '+rises.map(f=>`<b>${labels[f.key]||f.name.toLowerCase()} (+${(f.delta/1000).toFixed(1)} GW)</b>`).join(' and ')+'.':''}`;
}
function stopPlay(){if(state.playing)clearInterval(state.playing);state.playing=null;$('play').textContent='▶ Replay afternoon';}
$('play').addEventListener('click',()=>{if(!state.power)return;if(state.playing){stopPlay();syncLabUrl();return;}state.powerLatest=false;state.powerIndex=Math.max(0,state.power.series.findIndex(r=>r.time==='14:00'));renderPowerChart();syncLabUrl('push');$('play').textContent='Ⅱ Pause replay';state.playing=setInterval(()=>{state.powerIndex+=2;if(state.powerIndex>=state.power.series.length){state.powerIndex=state.power.series.length-1;stopPlay();}renderPowerMoment();scheduleLabUrl();},150);});
$('power-slider').addEventListener('input',e=>{
  if(!state.power)return;stopPlay();const d=powerDataset(),timeline=powerTimeline(d),minute=Number(e.target.value)*5;
  let closest=0,distance=Infinity;d.series.forEach((row,i)=>{const delta=Math.abs(timeline.minutes(row)-minute);if(delta<distance){distance=delta;closest=i;}});
  state.powerIndex=closest;renderPowerMoment();scheduleLabUrl();
});
for(const [id,latest] of [['replay-day',false],['latest-day',true]])$(id).addEventListener('click',()=>{if(!state.power||(latest&&!state.power.latest?.series?.length))return;stopPlay();state.powerLatest=latest;state.powerIndex=latest?powerDataset().series.length-1:Math.max(0,state.power.series.findIndex(r=>r.time==='16:00'));renderPowerChart();syncLabUrl('push');});
$('power-chart').addEventListener('pointermove',e=>{
  if(!state.power||e.pointerType==='touch'||state.playing)return;
  const d=powerDataset(),timeline=powerTimeline(d),box=e.currentTarget.getBoundingClientRect(),minute=powerPointerMinute(e.clientX,box.left,box.width,timeline.duration,state.powerGeometry||powerChartLayout(box.width));
  let closest=0,distance=Infinity;d.series.forEach((row,i)=>{const delta=Math.abs(timeline.minutes(row)-minute);if(delta<distance){distance=delta;closest=i;}});
  state.powerIndex=closest;renderPowerMoment();scheduleLabUrl();
});
if(typeof ResizeObserver==='function')new ResizeObserver(refreshPowerChartSize).observe($('power-chart'));
else window.addEventListener('resize',refreshPowerChartSize);



async function loadPower(){
  $('power-error').hidden=true;
  $('power-panel').setAttribute('aria-busy','true');
  $('lab-status').textContent='Loading the saved CAISO snapshot.';
  try{
    const response=await fetch('data/power.json');
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(!data?.series?.length||!data.coverage||!data.source)throw new Error('Snapshot format is incomplete');
    state.power=data;
    restorePowerUrl();
    syncLabUrl();
    $('lab-status').textContent='Saved CAISO snapshot loaded. Use the time slider or replay button.';
  }catch(error){
    state.power=null;
    $('power-error-message').textContent='The saved snapshot could not be loaded. Serve the site over HTTP, then try again.';
    $('power-error').hidden=false;
    $('power-fresh').textContent='Snapshot unavailable';
    $('power-teaser').textContent='Snapshot unavailable';
    $('lab-status').textContent='The saved snapshot could not be loaded.';
    console.error('Power snapshot:',error);
  }finally{$('power-panel').setAttribute('aria-busy','false');}
}
$('power-retry').addEventListener('click',()=>{$('power-title').focus({preventScroll:true});void loadPower();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlay();});
void loadPower();
