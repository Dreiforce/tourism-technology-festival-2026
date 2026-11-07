import {minutes,windowsOn,distanceKm,point,schedule,insertActivity,suggestSchedule,addDays,datesBetween,splitPeriod} from './planning.js';
import {accessOptions,accessStatuses,meetsAccessNeeds} from './accessibility.js';
import {guestCards,passBenefit} from './guest-cards.js';
import {localPlaces} from './region.js';

let activities=[], catalogState='loading';
let interests=new Set(), toastTimer;
const plans=new Map();
const splits=new Map();
const money=n=>n===null?'Preis beim Anbieter':new Intl.NumberFormat('de-AT',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n);
const $=id=>document.getElementById(id);
const motionButton=$('scene-motion');
const scene=motionButton.closest('.hero-scene');
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function setScenePaused(paused,manual=false){
  scene.classList.toggle('scene-paused',paused);
  scene.classList.toggle('scene-playing',manual&&!paused);
  motionButton.setAttribute('aria-pressed',String(paused));
  motionButton.title=paused?'Animation abspielen':'Animation pausieren';
  motionButton.textContent=paused?'▶':'Ⅱ';
}
setScenePaused(reducedMotion.matches);
reducedMotion.addEventListener('change',event=>setScenePaused(event.matches));
motionButton.addEventListener('click',()=>setScenePaused(!scene.classList.contains('scene-paused'),true));
const adults=()=>Number($('adults').value);
const ages=()=>Array.from(document.querySelectorAll('#family-members select'), select=>Number(select.value));
const dogs=()=>$('family-members').querySelectorAll('.dog-member').length;
const wholeFamily=()=>({adults:adults(),dogs:dogs(),ages:ages(),needs:accessNeeds()});
function regularPrice(a,party=wholeFamily()){
  if(a.priceKnown===false) return null;
  return a.adult*party.adults+a.dogPrice*party.dogs+party.ages.reduce((sum,age)=>{
    if (age<a.childFrom) return sum;
    if (age<=a.childTo) return sum+a.child;
    return sum+(a.youth!==null&&age>=a.youthFrom?a.youth:a.adult);
  },0);
}
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const looks={
  Natur:{color:'#c3d0b0',icon:'♧',art:'forest'},
  Entdecken:{color:'#e5dcc4',icon:'✧',art:'castle'},
  Kreativ:{color:'#e8c9b9',icon:'✿',art:'art'},
  Action:{color:'#cbd7e4',icon:'ϟ',art:'climb'}
};
const dayStart=()=>minutes($('day-start').value||'09:30');
const ageOptions=Array.from({length:18},(_,age)=>`<option value="${age}">${age} ${age===1?'Jahr':'Jahre'}</option>`).join('');
function familySummary(){
  const childCount=ages().length, dogCount=dogs();
  return [`${adults()} Erwachsene`, childCount && `${childCount} ${childCount===1?'Kind':'Kinder'}`, dogCount && `${dogCount} ${dogCount===1?'Hund':'Hunde'}`].filter(Boolean).join(' · ');
}
function addMember(kind, age=5){
  const row=document.createElement('div');
  row.className=`family-member ${kind==='Hund'?'dog-member':''}`;
  row.innerHTML=kind==='Kind'
    ? `<label>Kind <select aria-label="Alter des Kindes">${ageOptions}</select></label>`
    : '<span>Hund</span>';
  const select=row.querySelector('select');
  if(select){
    select.value=age;
    select.addEventListener('change',updateFilters);
  }
  const remove=document.createElement('button');
  remove.type='button';
  remove.textContent='×';
  remove.setAttribute('aria-label',`${kind} entfernen`);
  const addButton=$(kind==='Hund'?'add-dog':'add-child');
  remove.addEventListener('click',()=>{
    row.remove();
    addButton.focus();
    updateFilters();
  });
  row.append(remove);
  $('family-members').append(row);
  return select || remove;
}
$('access-filters').innerHTML=Object.entries(accessOptions).map(([key,label])=>
  `<label><input type="checkbox" value="${key}"> ${label}</label>`).join('');
const accessNeeds=()=>Array.from($('access-filters').querySelectorAll('input:checked'),input=>input.value);
$('access-filters').addEventListener('change',updateFilters);
addMember('Kind',5);
addMember('Kind',9);
$('add-child').addEventListener('click',()=>{addMember('Kind').focus();updateFilters()});
$('add-dog').addEventListener('click',()=>{addMember('Hund').focus();updateFilters()});
for(const id of ['adults','time','free-evening','max-price','trip-radius','day-start']) $(id).addEventListener('change',updateFilters);
document.querySelectorAll('#interests button').forEach(b=>b.addEventListener('click',()=>{ const i=b.dataset.interest;interests.has(i)?interests.delete(i):interests.add(i);b.classList.toggle('selected',interests.has(i));b.setAttribute('aria-pressed',interests.has(i));renderCards(); }));
const places=localPlaces;
const placeInput=$('trip-place');
placeInput.innerHTML=places.map(({name},index)=>`<option value="${index}">${name}</option>`).join('');
const origin=()=>places[Number(placeInput.value)];
const kmFormat=new Intl.NumberFormat('de-AT',{maximumFractionDigits:1});
function kmLabel(km){
  return `${kmFormat.format(km)} km Luftlinie`;
}
function distanceLabel(activity){
  return kmLabel(distanceKm(origin(),point(activity)));
}
const dateInput=$('trip-date');
const endInput=$('trip-end');
const dayPicker=$('plan-date');
const cardInput=$('guest-card');
const localCard=guestCards.sfl;
cardInput.insertAdjacentHTML('beforeend',`<option value="sfl">${localCard.name}</option>`);
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const displayDate=new Intl.DateTimeFormat('de-AT',{timeZone:'UTC',weekday:'short',day:'numeric',month:'numeric'});
const dateLabel=date=>displayDate.format(new Date(date+'T12:00:00Z'));
dateInput.min=today;
dateInput.value=today;
let days=[];
const activeDate=()=>dayPicker.value;
const forecasts=new Map();
let forecastRequest, forecastState='';
function chosen(date=activeDate()){
  return plans.get(date) || [];
}
function describeWeather(code){
  if(code===0) return 'Sonnig';
  if(code<=3) return 'Wolkig';
  if(code<=48) return 'Neblig';
  if(code>=95) return 'Gewitter';
  if((code>=71&&code<=77)||code>=85) return 'Schnee';
  return code<=57?'Nieselregen':'Regen';
}
function renderWeather(){
  const date=activeDate();
  const forecast=forecasts.get(date);
  $('weather-status').textContent=!date?'':forecast
    ? `${origin().name} · ${dateLabel(date)} · ${forecast.label}`
    : date<today?'Der Tag liegt bereits in der Vergangenheit.'
    : date>addDays(today,15)?'Für diesen Tag gibt es noch keine Wettervorhersage.'
    : forecastState || 'Für diesen Tag liegt keine Vorhersage vor.';
}
async function updateWeather(){
  forecastRequest?.abort();
  forecasts.clear();
  const forecastDates=days.filter(date=>date>=today&&date<=addDays(today,15));
  const start=forecastDates[0], end=forecastDates.at(-1);
  forecastState='';
  if(!start||!end){render();return}
  const request=new AbortController();
  forecastRequest=request;
  forecastState='Vorhersage wird geladen …';
  render();
  try{
    const {latitude,longitude}=origin();
    const params=new URLSearchParams({
      latitude,longitude,timezone:'Europe/Vienna',
      daily:'weather_code,temperature_2m_max,precipitation_probability_max',
      start_date:start,end_date:end
    });
    const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,{
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)])
    });
    if(!response.ok) throw new Error('Forecast request failed');
    const {daily}=await response.json();
    if(request.signal.aborted) return;
    for(const [i,date] of (daily?.time || []).entries()){
      const code=daily.weather_code?.[i];
      if(!Number.isInteger(code)) continue;
      const temp=daily.temperature_2m_max?.[i];
      const probability=daily.precipitation_probability_max?.[i];
      const label=[describeWeather(code),Number.isFinite(temp)&&`${Math.round(temp)} °C max.`,Number.isFinite(probability)&&`${probability} % Niederschlagsrisiko`].filter(Boolean).join(' · ');
      forecasts.set(date,{wet:code>=51||probability>=60,label});
    }
    forecastState='';
  }catch{
    if(request.signal.aborted) return;
    forecastState='Vorhersage gerade nicht verfügbar.';
  }
  render();
}

function cardRule(a,date){
  return passBenefit(a,cardInput.value,date);
}
function price(a,date,prior=[],party=wholeFamily()){
  const rule=cardRule(a,date);
  if(!rule) return regularPrice(a,party);
  const limit=guestCards[rule.card].dailyLimit;
  const uses=prior.filter(activity=>cardRule(activity,date)).length;
  return limit && uses>=limit?regularPrice(a,party):a.dogPrice*party.dogs;
}
function renderCardInfo(){
  $('card-info').innerHTML=cardInput.value
    ? `<a href="${localCard.source}" target="_blank" rel="noopener">Kartenbedingungen ↗</a>. Fahrten mit geöffneten Sommer-Bergbahnen sind enthalten. Der Beitrag der Unterkunft ist im Planpreis nicht eingerechnet.`
    : '';
}
cardInput.addEventListener('change',()=>{renderCardInfo();updateFilters()});

function refreshDates(){
  const prev=activeDate();
  const start=dateInput.value;
  endInput.min=start;
  endInput.max=start?addDays(start,13):'';
  days=dateInput.validity.valid && endInput.validity.valid?datesBetween(start,endInput.value||start):[];
  $('date-status').textContent=days.length?'':'Bitte einen gültigen Zeitraum von bis zu 14 Tagen wählen.';
  if(days.length) for(const entries of [plans,splits]){
    for(const date of entries.keys()) if(!days.includes(date)) entries.delete(date);
  }
  dayPicker.replaceChildren(...days.map(date=>new Option(dateLabel(date),date)));
  if(days.includes(prev)) dayPicker.value=prev;
  $('period-overview').hidden=days.length<2;
  updateWeather();
}
dateInput.addEventListener('change',()=>{
  if(dateInput.value>=today) dateInput.min=today;
  if(endInput.value && endInput.value<dateInput.value) endInput.value=dateInput.value;
  refreshDates();
});
endInput.addEventListener('change',refreshDates);
$('week').addEventListener('click',()=>{
  if(!dateInput.value || !dateInput.validity.valid) return;
  endInput.value=addDays(dateInput.value,6);
  refreshDates();
});
placeInput.addEventListener('change',()=>{updateFilters();updateWeather()});
dayPicker.addEventListener('change',render);
function limit(){
  const mode=$('time').value;
  const end=$('free-evening').checked?18*60:mode==='evening'?24*60:19*60+30;
  return Math.max(0,Math.min({day:1440,evening:1440,half:210,short:120}[mode],end-dayStart()));
}
const baseSettings=(date=activeDate())=>({
  date,origin:origin(),start:dayStart(),end:dayStart()+limit(),radius:Number($('trip-radius').value)
});
const slots=['morning','afternoon'];
const slotLabel={morning:'Vormittag',afternoon:'Nachmittag'};
const slotInput=$('split-slot');
const daySplits=date=>splits.get(date) || {};
function setSplit(date,slot,plan){
  const next={...daySplits(date)};
  if(plan) next[slot]=plan;
  else delete next[slot];
  if(Object.keys(next).length) splits.set(date,next);
  else splits.delete(date);
}
function settings(date=activeDate(),blocks=daySplits(date)){
  return {...baseSettings(date),blocks:slots.map(slot=>blocks[slot]).filter(Boolean)};
}
function fitsParty(a,date,party,checkWeather=true){
  const budget=$('max-price').value;
  return date && party.ages.every(age=>age>=a.min&&age<=a.max)
    && (!party.dogs||a.pets==='yes')
    && meetsAccessNeeds(a,party.needs)
    && (!checkWeather||!forecasts.get(date)?.wet||a.weather==='both')
    && (budget===''||(price(a,date,[],party)!==null&&price(a,date,[],party)<=Number(budget)));
}
function compatible(a,date,checkWeather=true){
  return fitsParty(a,date,wholeFamily(),checkWeather) && Boolean(schedule([a],settings(date)));
}
function splitActivities(date){
  return slots.flatMap(slot=>daySplits(date)[slot]?.rows.map(row=>row.activity)||[]);
}
function usedActivities(excludeDate){
  return new Set(days.flatMap(date=>date===excludeDate?splitActivities(date):[...chosen(date),...splitActivities(date)]));
}
function filtered(date=activeDate()){
  return activities.filter(a=>!splitActivities(date).includes(a)&&compatible(a,date)&&(!interests.size||interests.has(a.category)))
    .sort((a,b)=>distanceKm(origin(),point(a))-distanceKm(origin(),point(b)));
}
function applyPlan(plan,date=activeDate()){
  plans.set(date,plan.rows.map(row=>row.activity));
}
function reconcileDay(date){
  const previous=chosen(date);
  let removed=false;
  const previousSplits=daySplits(date);
  for(const slot of slots){
    const old=previousSplits[slot];
    if(!old) continue;
    const parties=partyDetails(old.config);
    const next=parties&&splitPeriod(parties,baseSettings(date),group=>
      old.rows.filter(row=>row.group.index===group.index).map(row=>row.activity).filter(a=>fitsParty(a,date,group,false)),
      {slot,accept:option=>Boolean(schedule([],settings(date,{...daySplits(date),[slot]:option})))});
    if(next) setSplit(date,slot,{...next,config:old.config});
    else {setSplit(date,slot,null);removed=true}
  }
  const daySettings=settings(date);
  let plan=schedule([],daySettings);
  for(const activity of previous){
    if (!compatible(activity,date,false)||splitActivities(date).includes(activity)) continue;
    plan=insertActivity(plan.rows.map(row=>row.activity),activity,daySettings) || plan;
  }
  if(plan) applyPlan(plan,date);
  return removed||previous.length!==(plan?.rows.length||0);
}
function updateFilters(){
  if(days.map(reconcileDay).some(Boolean)) toast('Der Plan wurde an Entfernungen, Öffnungszeiten oder eure Filter angepasst.');
  render();
}

const groupLabels={Natur:'Natur und Wandern',Entdecken:'Entdecken',Action:'Action und Baden',Kreativ:'Spielen und Kreatives'};
let lastSplitForm='';
function renderSplitForm(){
  const groupCount=Math.min(adults(),ages().length);
  $('split-panel').hidden=groupCount<2||!activeDate();
  if(groupCount<2) return;
  const key=JSON.stringify([activeDate(),slotInput.value,adults(),ages(),dogs()]);
  if(lastSplitForm===key) return;
  lastSplitForm=key;
  const blocks=daySplits(activeDate());
  const config=(blocks[slotInput.value]||blocks[slotInput.value==='morning'?'afternoon':'morning'])?.config;
  const options=Array.from({length:groupCount},(_,i)=>`<option value="${i}">Gruppe ${i+1}</option>`).join('');
  const young=ages().indexOf(Math.min(...ages()));
  $('split-form').innerHTML=`
    <div class="split-grid">${Array.from({length:groupCount},(_,i)=>`<fieldset>
      <legend>Gruppe ${i+1}${i===0&&adults()>groupCount?' · '+(1+adults()-groupCount)+' Erwachsene':''}</legend>
      <label>Begleitperson<input id="group-name-${i}" maxlength="40" placeholder="z. B. Mama, Papa oder Oma"></label>
      <label>Wunsch<select id="group-interest-${i}"><option value="">Alles Passende</option>
        ${Object.entries(groupLabels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
      <label class="group-check"><input type="checkbox" id="group-access-${i}" checked> Weitere ausgewählte Zugangshilfen gelten hier</label>
    </fieldset>`).join('')}</div>
    <div class="split-assign">${ages().map((age,i)=>`<label>Kind ${i+1} · ${age} J.<select id="group-child-${i}">${options}</select></label>`).join('')}
    <label>Kinderwagen, falls ausgewählt<select id="group-stroller">${options}</select></label>
    ${dogs()?`<label>Hund${dogs()>1?'e':''}<select id="group-dogs">${options}</select></label>`:''}</div>`;
  for(const [i] of ages().entries()) $('group-child-'+i).value=config?.assignments[i]??i%groupCount;
  $('group-stroller').value=config?.stroller??young%groupCount;
  if(dogs()) $('group-dogs').value=config?.dogGroup??0;
  if(config) for(const [i,group] of config.groups.entries()){
    $('group-name-'+i).value=group.label;
    $('group-interest-'+i).value=group.category;
    $('group-access-'+i).checked=group.access;
  }
}
slotInput.addEventListener('change',()=>{$('split-status').textContent='';renderSplitForm()});
function partyDetails(config){
  const allAges=ages();
  if(config.adults!==adults()||config.assignments.length!==allAges.length||config.dogs!==dogs()) return null;
  const needs=accessNeeds();
  return config.groups.map((group,index)=>({
    ...group,index,adults:index===0?1+adults()-config.groups.length:1,
    ages:allAges.filter((_,i)=>config.assignments[i]===index),
    dogs:config.dogGroup===index?dogs():0,
    needs:needs.filter(key=>key==='stroller'?config.stroller===index:group.access)
  }));
}
$('suggest-split').addEventListener('click',()=>{
  const date=activeDate();
  const slot=slotInput.value;
  const count=Math.min(adults(),ages().length);
  const config={adults:adults(),dogs:dogs(),
    groups:Array.from({length:count},(_,i)=>({
      label:$('group-name-'+i).value.trim()||'Begleitperson '+(i+1),
      category:$('group-interest-'+i).value,
      access:$('group-access-'+i).checked
    })),
    assignments:ages().map((_,i)=>Number($('group-child-'+i).value)),
    stroller:Number($('group-stroller').value),dogGroup:dogs()?Number($('group-dogs').value):-1};
  const status=$('split-status');
  if(new Set(config.assignments).size<count){
    status.textContent='Bitte jeder Gruppe mindestens ein Kind zuordnen.';
    return;
  }
  const groups=partyDetails(config);
  const used=usedActivities(date);
  for(const row of daySplits(date)[slot]?.rows||[]) used.delete(row.activity);
  const plan=splitPeriod(groups,baseSettings(date),group=>activities.filter(a=>
    !used.has(a)&&(!group.category||a.category===group.category)&&fitsParty(a,date,group)),
    {slot,accept:option=>Boolean(schedule([],settings(date,{...daySplits(date),[slot]:option})))});

  if(!plan){
    status.textContent='Für diese Aufteilung gibt es an diesem Tag keine passende Kombination am selben Treffpunkt. Versucht einen anderen Tag oder andere Wünsche.';
    return;
  }
  setSplit(date,slot,{...plan,config});
  const changed=reconcileDay(date);
  status.textContent=changed?`${slotLabel[slot]} geplant. Der restliche Tagesplan wurde an die neuen Zeiten angepasst.`:`Der geteilte ${slotLabel[slot]} steht im Tagesplan.`;
  render();
});

function render(){
  renderWeather();
  renderSplitForm();
  renderCards();
  renderPlan();
}
function artwork(a){const base=`<svg viewBox="0 0 330 160" aria-hidden="true"><rect width="330" height="160" fill="${a.color}"/>`;const shapes={
river:'<circle cx="270" cy="35" r="20" fill="#f2d08c"/><path d="M0 80 73 15 130 89 209 42 330 99V160H0Z" fill="#9eb9aa"/><path d="M0 116Q80 66 166 115T330 92V160H0Z" fill="#4c8062"/><path d="M240 70Q126 99 215 127T125 180" stroke="#a6d3d4" stroke-width="39" fill="none"/><path d="m24 118 19-53 20 53Z" fill="#2f5948"/><path d="m277 151 23-63 23 63Z" fill="#315c4b"/><circle cx="136" cy="113" r="6" fill="#d4a17b"/><path d="M127 125Q136 117 145 125L148 145H125Z" fill="#dfac62"/>',
castle:'<circle cx="262" cy="39" r="24" fill="#f5e9c5"/><path d="M0 153Q153 21 330 153Z" fill="#859c76"/><path d="M0 160Q175 80 330 160Z" fill="#57785c"/><path d="M126 117V68H145V52H163V68H183V117ZM176 116V43H192V29H211V43H223V116ZM105 121V84H128V121Z" fill="#f1e5ca"/><g fill="#657261"><rect x="143" y="81" width="7" height="11"/><rect x="195" y="59" width="7" height="11"/><path d="M157 117V99Q168 88 178 99V117Z"/></g><path d="M172 118Q150 147 205 160" stroke="#ddc697" stroke-width="13" fill="none"/>',
art:'<path d="M0 130H330V160H0Z" fill="#c6947b"/><rect x="81" y="28" width="149" height="100" rx="5" fill="#fcf3de"/><path d="M92 114 144 56 176 96 206 62 219 114Z" fill="#9bbaa0"/><circle cx="198" cy="49" r="13" fill="#e6b264"/><path d="m116 128-10 32m106-32 10 32" stroke="#876447" stroke-width="8"/><path d="m48 127 5-45 8 45" fill="#faf0d3"/><path d="M44 125H67V154H44Z" fill="#547e6b"/><path d="m269 80 17 60" stroke="#89694e" stroke-width="7"/><path d="m265 78 7-20 9 16-3 11" fill="#be5b40"/>',
bike:'<circle cx="265" cy="32" r="22" fill="#f1d697"/><path d="M0 108Q72 39 167 105T330 77V160H0Z" fill="#9cb790"/><path d="M0 143Q160 85 330 135V160H0Z" fill="#5c8365"/><path d="M0 145Q160 116 330 145" stroke="#dbd5b3" stroke-width="17" fill="none"/><g stroke="#304d40" stroke-width="5" fill="none"><circle cx="118" cy="112" r="24"/><circle cx="214" cy="112" r="24"/><path d="m118 112 31-45 21 45h-52m52 0 29-45 15 45m-65-45h50m-50 0-7-14m49 14 9-15h13"/></g><path d="M130 53H151" stroke="#a56a42" stroke-width="6" stroke-linecap="round"/>',
lab:'<path d="M0 135H330V160H0Z" fill="#a4b4c7"/><rect x="72" y="23" width="71" height="85" rx="36" fill="#e6e9e0"/><path d="M107 30V106M79 70H136" stroke="#cbd7e4" stroke-width="4"/><path d="M189 35V73L162 120Q158 131 170 131H237Q248 130 242 119L215 73V35" fill="#f5f3db"/><path d="M180 90H224L242 120Q248 130 237 131H170Q158 131 162 120Z" fill="#a2bb8d"/><path d="M184 35H221" stroke="#73889e" stroke-width="6"/><g fill="#f1efd7"><circle cx="191" cy="107" r="5"/><circle cx="217" cy="118" r="3"/></g><path d="M72 132V108M72 120Q43 109 50 91Q70 91 72 120M72 117Q99 105 94 86Q75 90 72 117" stroke="#607f70" stroke-width="3" fill="#799b7d"/>',
climb:'<path d="M85 0H273L251 160H60Z" fill="#e7dfcf"/><g fill="#b57c66"><path d="m116 35 12-5 4 9-14 4Z"/><path d="m206 22 12 4-4 10-16-6Z"/><path d="m102 95 10-3 6 10-15 6Z"/><path d="m215 118 17-2 1 10-13 4Z"/></g><g fill="#8fa58b"><path d="m178 58 13-3 5 11-19 2Z"/><path d="m140 126 10-5 7 12-15 2Z"/></g><circle cx="162" cy="64" r="9" fill="#d3a17d"/><path d="M150 79Q161 69 173 80L177 107H148Z" fill="#cd8659"/><path d="m153 82-30-43m48 43 33-48m-49 72-15 25m30-25 28 21" stroke="#334b43" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M163 0V53" stroke="#a28b64" stroke-width="2"/>',
forest:'<path d="M0 132Q167 75 330 136V160H0Z" fill="#729362"/><path d="m35 133 31-107 31 107Zm80 0 38-121 38 121Zm102-3 31-101 31 101Z" fill="#426e50"/><path d="m77 142 24-83 24 83Zm178 2 25-80 25 80Z" fill="#2c5942"/><path d="M174 160Q230 137 190 114" stroke="#d8c49c" stroke-width="15" fill="none"/><g fill="#edc86e"><circle cx="49" cy="143" r="3"/><circle cx="234" cy="149" r="3"/><circle cx="142" cy="145" r="3"/></g>',
story:'<rect x="52" y="25" width="225" height="135" rx="5" fill="#324b45"/><path d="M52 25H130Q134 91 52 125ZM277 25H200Q193 91 277 125Z" fill="#bd7556"/><path d="M68 25Q70 64 57 91M111 25Q109 71 65 103M262 25Q263 65 274 91M220 25Q218 71 263 103" stroke="#a9624b" stroke-width="4" fill="none"/><circle cx="165" cy="79" r="14" fill="#dab089"/><path d="M145 101Q165 86 184 101L190 140H139Z" fill="#d6bb73"/><path d="M145 64 151 43 166 56 178 42 185 66Z" fill="#d9b460"/><path d="M0 147H330V160H0Z" fill="#a67c52"/>'};return base+shapes[a.art]+'</svg>'}
function timeLabel(minutes){
  return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}

function renderCards(){
  const date=activeDate();
  const items=filtered(date);
  const resultInfo=$('result-info');
  resultInfo.textContent=catalogState==='ready'
    ? `${items.length} passende Erlebnisse · Nach Nähe zu ${origin().name} sortiert`
    : catalogState==='loading'?'Erlebnisse werden geladen …':'Erlebnisse konnten nicht geladen werden.';
  $('suggest').disabled=!items.length;
  $('suggest-period').disabled=catalogState!=='ready';
  $('recommendation').textContent=forecasts.get(date)?.wet
    ? 'Für diesen Tag zeigen wir wetterfeste Erlebnisse.'
    : 'Die Vorschläge berücksichtigen eure Familie, die Öffnungszeiten und das gewählte Zeitfenster.';
  if (!items.length) {
    $('cards').innerHTML=catalogState==='loading'?'':`<div class="empty-results">${catalogState==='error'
      ? 'Der Katalog ist gerade nicht erreichbar. Bitte ladet die Seite neu.'
      : 'Für diese Auswahl gibt es gerade kein passendes Erlebnis. Versucht es mit einem anderen Tag, Startort oder Umkreis.'}</div>`;
    return;
  }
  $('cards').innerHTML=items.map(a=>{
    const checked=chosen().includes(a);
    const rule=cardRule(a,date);
    const index=chosen().indexOf(a);
    const entry=price(a,date,index<0?chosen():chosen().slice(0,index));
    const windows=windowsOn(a,date).map(window=>
      `${window.last===window.open?'Fixer Start ':''}${timeLabel(window.open)}–${timeLabel(window.close)}${window.last>window.open&&window.last<window.close?' (Einlass bis '+timeLabel(window.last)+')':''}`).join(' · ');
    const art=a.photos?.length
      ? `<img class="experience-photo" src="${escapeHTML(a.photos[0])}" alt="${escapeHTML(a.title)}" loading="lazy">`
      : artwork(looks[a.category]);
    return `<article class="activity-card">
      <div class="card-art">${art}<span class="tag">${a.pets==='yes'?'Mit Hund':a.category}</span></div>
      <div class="card-body">
        <p class="card-source">${escapeHTML(a.operator)}</p>
        <h4>${escapeHTML(a.title)}</h4>
        <p class="card-location">${escapeHTML(a.location[0])} · ${distanceLabel(a)}</p>
        <p class="card-description">${escapeHTML(a.description)}</p>
        <p class="card-hours">${windows} Uhr</p>
        <div class="card-meta"><span>◷ ca. ${a.duration} Min.</span><span>☺ ${a.min}–${a.max} Jahre</span></div>
        <details class="card-details"><summary>Besuchshinweise & Quellen</summary>
          <p>${escapeHTML(a.address)}</p>
          <dl class="access-details">${Object.entries(accessOptions).map(([key,label])=>
            `<div><dt>${label}</dt><dd>${accessStatuses[a.accessibility?.[key]] || accessStatuses.unknown}</dd></div>`).join('')}</dl>
          ${rule?`<p><strong>${guestCards[rule.card].name}</strong> · ${escapeHTML(rule.note)}</p><p><a href="${escapeHTML(rule.source)}" target="_blank" rel="noopener">Quelle zum Kartenvorteil</a></p>`:''}
          ${a.accessNote?`<p>${escapeHTML(a.accessNote)}</p>`:''}
          ${a.accessSource?`<p><a href="${escapeHTML(a.accessSource)}" target="_blank" rel="noopener">Quelle zur Barrierefreiheit</a></p>`:''}
          ${[a.petNote,a.priceNote,a.notes].filter(Boolean).map(note=>`<p>${escapeHTML(note)}</p>`).join('')}
          ${(a.photos||[]).slice(1).map((photo,i)=>`<img class="detail-photo" src="${escapeHTML(photo)}" alt="${escapeHTML(a.title)} – Foto ${i+2}" loading="lazy">`).join('')}
          <p>Geprüft am ${escapeHTML(a.verified)}</p>
          <ul>${a.sources.map(url=>`<li><a href="${escapeHTML(url)}" target="_blank" rel="noopener">${escapeHTML(new URL(url).hostname)}</a></li>`).join('')}</ul>
        </details>
        <div class="card-bottom"><span class="price"><strong>${a.booking==='free'||a.meeting==='hoeg'?'Eintritt frei':money(entry)}</strong><small>${a.meeting==='hoeg'?(rule?'Bergbahn mit Karte enthalten':'Bergbahn separat'):a.booking==='free'?'kein Ticket nötig':rule&&entry<regularPrice(a)?'mit gültiger Gästekarte':'geschätzter Eintritt für euch'}</small></span>
          <button class="add-button ${checked?'added':''}" data-add="${escapeHTML(a.id)}">${checked?'✓ Im Tagesplan':'+ Zum Tag'}</button></div>
      </div></article>`;
  }).join('');
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>toggle(b.dataset.add)));
}

function toggle(id){
  const date=activeDate();
  const current=chosen(date);
  const activity=activities.find(a=>a.id===id);
  if (current.includes(activity)) {
    plans.set(date,current.filter(a=>a!==activity));
  } else {
    if(usedActivities(date).has(activity)){
      toast('Dieses Erlebnis ist bereits an einem anderen Tag eingeplant.');
      return;
    }
    const plan=insertActivity(current,activity,settings(date));
    if (!plan) {
      toast('Das Erlebnis liegt für diese Stopps zu weit weg oder passt mit Rückfahrt nicht ins Zeitfenster.');
      return;
    }
    applyPlan(plan,date);
  }
  render();
}

function tripPlans(){
  return days.map(date=>({date,blocks:settings(date).blocks,...schedule(chosen(date),settings(date))}));
}
function tripRows(dayPlans=tripPlans()){
  return dayPlans.flatMap(({date,rows,blocks})=>{
    const parallel=blocks.flatMap(block=>block.rows.map(row=>({...row,slot:block.slot})));
    const combined=[...parallel,...(rows||[])].sort((a,b)=>a.start-b.start);
    return combined.map((row,i)=>{
      const prior=combined.slice(0,i).map(item=>item.activity);
      const rule=cardRule(row.activity,date);
      const limit=rule&&guestCards[rule.card].dailyLimit;
      const covered=rule && (!limit || prior.filter(a=>cardRule(a,date)).length<limit);
      return {...row,date,entry:price(row.activity,date,prior,row.group||wholeFamily()),pass:covered?rule:null};
    });
  });
}

function renderPlan(){
  const date=activeDate();
  const dayPlans=tripPlans();
  const all=tripRows(dayPlans);
  const rows=all.filter(row=>row.date===date&&!row.group);
  const parallel=all.filter(row=>row.date===date&&row.group);
  const currentPlan=dayPlans.find(day=>day.date===date);
  $('plan-title').textContent=days.length>1?'Euer Urlaubsplan':'Euer Familientag';
  $('plan-subtitle').textContent=date?`${dateLabel(date)} · ${origin().name}`:'Wählt einen Tag oder Zeitraum.';
  const blocks=currentPlan?.blocks||[];
  const splitPanels=blocks.map((block,i)=>({start:block.start,html:`<div class="parallel-plan"><h4>Geteilter ${slotLabel[block.slot]}</h4>
    <p>Treffpunkt: <strong>${block.meeting.name}</strong> · ab ${timeLabel(block.start)} Uhr
    ${currentPlan.transfers?.[i]?.minutes?` · Anreise ca. ${currentPlan.transfers[i].minutes} Min.`:''}</p>
    ${parallel.filter(row=>row.slot===block.slot).map(row=>`<div><strong>${escapeHTML(row.group.label)} · ${row.group.ages.map(age=>age+' J.').join(', ')}</strong>
      <p>${timeLabel(row.start)}–${timeLabel(row.end)} Uhr · ${escapeHTML(row.activity.title)} · ${money(row.entry)}</p>
      <small>${kmLabel(row.km)} ab Treffpunkt · zurück gegen ${timeLabel(row.finish)} Uhr</small></div>`).join('')}
    <p><strong>Alle wieder zusammen gegen ${timeLabel(block.finish)} Uhr</strong></p>
    <button class="add-button" type="button" data-remove-split="${block.slot}">Aufteilung entfernen</button></div>`}));
  const regularPanels=rows.map(({activity:a,start,end,travel,km,wait,entry,pass})=>({start,html:`
    <div class="transfer">↝ Weg zum Erlebnis · ${kmLabel(km)} · ca. ${travel} Min.${point(a).mountain?' · Zugang mit Bergbahn':''}${wait?' · '+wait+' Min. freie Zeit':''}</div>
    <div class="plan-row"><span class="time-icon">${looks[a.category].icon}</span><div>
      <small>${timeLabel(start)} – ${timeLabel(end)} · ${escapeHTML(a.location[0])}</small>
      <strong>${escapeHTML(a.title)}</strong><p>${money(entry)} ${pass?'mit Gästekarte':'geschätzter Eintritt'}</p></div>
      <button class="remove" aria-label="${escapeHTML(a.title)} entfernen" data-remove="${escapeHTML(a.id)}">×</button>
    </div>`}));
  $('plan-items').innerHTML=[...splitPanels,...regularPanels].sort((a,b)=>a.start-b.start).map(item=>item.html).join('')+
    (currentPlan?.back?`<div class="transfer">↝ Rückweg · ${kmLabel(currentPlan.back.km)} · ca. ${currentPlan.back.minutes} Min. · zurück gegen ${timeLabel(currentPlan.finish)} Uhr</div>`:'') ||
    '<div class="empty-plan"><span>✳</span><strong>Für diesen Tag ist noch nichts geplant.</strong>Fügt Erlebnisse hinzu oder lasst euch einen Vorschlag machen.</div>';
  document.querySelectorAll('[data-remove-split]').forEach(button=>button.addEventListener('click',()=>{
    setSplit(date,button.dataset.removeSplit,null);
    lastSplitForm='';
    updateFilters();
  }));
  $('total').textContent=money(all.reduce((sum,row)=>sum+(row.entry??0),0));
  $('total-label').textContent=days.length>1?'Für den gesamten Zeitraum':'Für die ganze Familie';
  $('nav-count').textContent=all.length;
  const counts=days.map(day=>`${dateLabel(day)}: ${chosen(day).length+splitActivities(day).length}`);
  $('period-summary').textContent=counts.join(' · ');
  $('plan-family').textContent=familySummary()+(all.some(row=>row.entry===null)?' · Unbekannte Preise nicht eingerechnet':' · Geschätzte Eintrittskosten');
  $('plan-warning').textContent=(rows.length||parallel.length)?'Wegezeiten sind geschätzt. Prüft tatsächliche Route, Betriebszeiten und Bergbahntarife.':'';
  if(forecasts.get(date)?.wet && [...rows,...parallel].some(row=>row.activity.weather==='sun')){
    $('plan-warning').textContent='Für diesen Tag ist Niederschlag vorhergesagt. Eure Outdoor-Erlebnisse bleiben im Plan. Prüft, ob sie stattfinden.';
  }
  $('checkout').disabled=!all.length;
  $('save-local').disabled=catalogState!=='ready'||!all.length;
  document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>toggle(button.dataset.remove)));
}

$('suggest').addEventListener('click',()=>{
  const date=activeDate();
  const used=usedActivities(date);
  applyPlan(suggestSchedule(filtered(date).filter(a=>!used.has(a)),settings(date)),date);
  render();
  if(innerWidth<761) $('tagesplan').scrollIntoView({behavior:'smooth'});
});
$('suggest-period').addEventListener('click',()=>{
  const used=usedActivities();
  for(const date of days){
    if(chosen(date).length) continue;
    // With several days available, spread scarce offers out before adding a second stop.
    const remaining=days.filter(day=>day>=date&&!chosen(day).length).length;
    const candidates=filtered(date).filter(a=>!used.has(a));
    const stops=Math.max(1,Math.min(3,Math.ceil(candidates.length/remaining)));
    const plan=suggestSchedule(candidates,settings(date),stops);
    applyPlan(plan,date);
    for(const row of plan.rows) used.add(row.activity);
  }
  render();
  if(days.some(date=>!chosen(date).length)) toast('Einige Tage bleiben frei. Für diese Auswahl gibt es nicht genug unterschiedliche Erlebnisse.');
});

function toast(message){
  clearTimeout(toastTimer);
  $('toast').textContent=message;
  $('toast').classList.add('show');
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);
}

const bookingGroups=[
  ['pass','Mit Gästekarte einlösen'],
  ['online','Online beim Anbieter buchen'],
  ['office','Im Tourismusbüro buchen'],
  ['onsite','Direkt vor Ort kaufen'],
  ['free','Kein Ticket nötig']
];

function renderCheckout(){
  const items=tripRows();
  $('modal-content').innerHTML=`<p class="eyebrow">EUER FAMILIENTAG</p><h2>So kommt ihr zu euren Tickets.</h2>
    <p>Hier steht für jedes Erlebnis, wo ihr buchen oder bezahlen könnt. Die Buchung erfolgt beim jeweiligen Anbieter.</p>
    ${bookingGroups.map(([mode,label])=>{
      const group=items.filter(row=>(row.pass?'pass':row.activity.booking)===mode);
      return !group.length?'':`<section class="booking-group"><h3>${label}</h3><div class="checkout-items">
        ${group.map(({activity:a,date,entry,pass,group,ticketUrl})=>`<div><span><strong>${escapeHTML(a.title)}</strong>
          <small>${dateLabel(date)} · ${escapeHTML(a.address)}${group?' · '+escapeHTML(group.label):''}</small>
          ${pass?`<small>${escapeHTML(pass.note)} <a href="${escapeHTML(pass.source)}" target="_blank" rel="noopener">Quelle ↗</a></small>`:''}
          ${a.bookingNote&&!pass?`<small>${escapeHTML(a.bookingNote)}</small>`:''}
          ${mode==='online'?`<a class="add-button ticket-link" href="${escapeHTML(ticketUrl||a.bookingLink)}" target="_blank" rel="noopener">Jetzt buchen ↗</a>`:''}
        </span><strong>${mode==='free'?'Gratis':a.meeting==='hoeg'&&!pass?'Bergbahn separat':money(entry)}</strong></div>`).join('')}
      </div></section>`;
    }).join('')}
    <div class="modal-total"><span>${items.some(row=>row.entry===null)?'Summe der bekannten Eintrittspreise':'Geschätzter Eintritt gesamt'}</span><strong>${$('total').textContent}</strong></div>
    <button class="primary modal-action" id="download">${days.length>1?'Urlaubsplan':'Tagesplan'} herunterladen <span>↓</span></button>`;
  $('download').addEventListener('click',downloadPlan);
}

$('checkout').addEventListener('click',()=>{
  renderCheckout();
  $('booking-dialog').showModal();
});

function downloadPlan(){
  const dayPlans=tripPlans();
  const rows=tripRows(dayPlans);
  if (!rows.length) return;
  const lines=['FAMILIENZEIT · URLAUBSPLAN',days[0]+' bis '+days.at(-1)+' · '+origin().name,familySummary(),
    '','Wegezeiten und Eintrittskosten sind Schätzungen.'];
  for(const {date,back,finish,blocks} of dayPlans){
    lines.push('',dateLabel(date)+' ('+date+') · '+(forecasts.get(date)?.label||'Keine Vorhersage'));
    for(const block of blocks) lines.push(slotLabel[block.slot]+' · Treffpunkt: '+block.meeting.name+' · gemeinsam zurück gegen '+timeLabel(block.finish)+' Uhr');
    const dayRows=rows.filter(row=>row.date===date);
    if(!dayRows.length) lines.push('Freier Tag');
    for(const row of dayRows){
      const a=row.activity;
      lines.push(timeLabel(row.start)+'–'+timeLabel(row.end)+' · '+a.title,
        ...(row.group?[row.group.label+' · zurück am Treffpunkt gegen '+timeLabel(row.finish)+' Uhr']:[]),
        a.address,kmLabel(row.km)+' · ca. '+row.travel+' Min. Fahrt'+(row.wait?' · '+row.wait+' Min. freie Zeit':''),
        money(row.entry)+' geschätzter Eintritt',bookingGroups.find(([mode])=>mode===(row.pass?'pass':a.booking))[1]);
      if(row.pass) lines.push(row.pass.note,row.pass.source);
      if(a.accessNote) lines.push(a.accessNote);
      if(a.accessSource) lines.push(a.accessSource);
      if(a.bookingLink&&!row.pass) lines.push(row.ticketUrl||a.bookingLink);
      if(a.bookingNote&&!row.pass) lines.push(a.bookingNote);
      lines.push(...a.sources);
    }
    if(back) lines.push('Rückweg: '+kmLabel(back.km)+' · ca. '+back.minutes+' Min. · zurück gegen '+timeLabel(finish)+' Uhr');
  }
  lines.push('',(rows.some(row=>row.entry===null)?'Summe der bekannten Eintrittspreise: ':'Geschätzter Eintritt gesamt: ')+$('total').textContent);
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='familienzeit-'+days[0]+'.txt';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const storageKey='familienzeit-sfl-plan-v1';
const savedControls=['adults','time','trip-radius','trip-place','guest-card','max-price','day-start'];
const isoDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&addDays(value,0)===value;
function readSaved(){
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(!saved || saved.version!==1 || !isoDate(saved.start) ||
      (saved.end&&!isoDate(saved.end)) || !datesBetween(saved.start,saved.end||saved.start).length ||
      !Array.isArray(saved.ages) || !saved.ages.every(age=>Number.isInteger(age)&&age>=0&&age<=17) ||
      !Number.isInteger(saved.dogs) || saved.dogs<0 || !saved.controls ||
      !Array.isArray(saved.access) || !Array.isArray(saved.interests) || !Array.isArray(saved.days)) return null;
  return saved;
}
function refreshSaveStatus(){
  try {
    const saved=readSaved();
    $('load-local').disabled=!saved||catalogState!=='ready';
    if(saved) $('local-plan-status').textContent=`Gespeichert: ${dateLabel(saved.start)}${saved.end&&saved.end!==saved.start?' bis '+dateLabel(saved.end):''}`;
  } catch {
    $('local-plan-status').textContent='Der Browser-Speicher ist nicht verfügbar.';
  }
}
$('save-local').addEventListener('click',()=>{
  const snapshot={
    version:1,start:dateInput.value,end:endInput.value,selected:activeDate(),slot:slotInput.value,
    controls:Object.fromEntries(savedControls.map(id=>[id,$(id).value])),
    freeEvening:$('free-evening').checked,ages:ages(),dogs:dogs(),access:accessNeeds(),interests:[...interests],
    days:days.map(date=>({date,regular:chosen(date).map(a=>a.id),blocks:slots.flatMap(slot=>{
      const block=daySplits(date)[slot];
      return block?[{slot,config:block.config,ids:block.rows.map(row=>row.activity.id)}]:[];
    })}))
  };
  try{
    localStorage.setItem(storageKey,JSON.stringify(snapshot));
    refreshSaveStatus();
    toast('Der Plan ist auf diesem Gerät gespeichert.');
  }catch{
    $('local-plan-status').textContent='Der Plan konnte im Browser nicht gespeichert werden.';
  }
});

function restoreBlock(date,block,byId){
  if(!slots.includes(block?.slot)||!Array.isArray(block.ids)||!Array.isArray(block.config?.groups)||
      !Array.isArray(block.config.assignments)||block.ids.length!==block.config.groups.length||
      block.config.groups.length<2||block.config.groups.length>adults()||
      !block.config.groups.every(group=>typeof group?.label==='string'&&typeof group.category==='string')||
      !block.ids.every(id=>byId.has(id))) return false;
  const groups=partyDetails(block.config);
  if(!groups||groups.some(group=>!group.ages.length)) return false;
  const plan=splitPeriod(groups,baseSettings(date),group=>[byId.get(block.ids[group.index])]
    .filter(a=>fitsParty(a,date,group,false)),
    {slot:block.slot,accept:option=>Boolean(schedule([],settings(date,{...daySplits(date),[block.slot]:option})))});
  if(!plan) return false;
  setSplit(date,block.slot,{...plan,config:block.config});
  return true;
}
$('load-local').addEventListener('click',()=>{
  try{
    const saved=readSaved();
    if(!saved) throw new Error('Kein lesbarer Plan gespeichert.');
    const dates=datesBetween(saved.start,saved.end||saved.start);
    for(const id of savedControls){
      const input=$(id);
      if(typeof saved.controls[id]!=='string') continue;
      if(input.options && !Array.from(input.options).some(option=>option.value===saved.controls[id])) continue;
      input.value=saved.controls[id];
    }
    $('free-evening').checked=Boolean(saved.freeEvening);
    $('family-members').replaceChildren();
    saved.ages.forEach(age=>addMember('Kind',age));
    for(let i=0;i<saved.dogs;i++) addMember('Hund');
    for(const input of $('access-filters').querySelectorAll('input')) input.checked=saved.access.includes(input.value);
    interests=new Set(saved.interests);
    for(const button of document.querySelectorAll('#interests button')){
      const active=interests.has(button.dataset.interest);
      button.classList.toggle('selected',active);
      button.setAttribute('aria-pressed',active);
    }
    dateInput.min=saved.start<today?saved.start:today;
    dateInput.value=saved.start;
    endInput.value=saved.end||'';
    if(slots.includes(saved.slot)) slotInput.value=saved.slot;
    plans.clear();
    splits.clear();
    lastSplitForm='';
    const byId=new Map(activities.map(a=>[a.id,a]));
    let changed=false;
    for(const item of saved.days){
      if(!item||!dates.includes(item.date)||!Array.isArray(item.regular)||!Array.isArray(item.blocks)) continue;
      const regular=item.regular.map(id=>byId.get(id)).filter(Boolean);
      changed ||= regular.length!==item.regular.length;
      plans.set(item.date,regular);
      for(const block of item.blocks) if(!restoreBlock(item.date,block,byId)) changed=true;
    }
    refreshDates();
    const target=dates.includes(today)?today:dates.includes(saved.selected)?saved.selected:dates[0];
    dayPicker.value=target;
    if(days.map(reconcileDay).some(Boolean)) changed=true;
    renderCardInfo();
    render();
    $('local-plan-status').textContent=changed
      ? 'Plan geladen. Einige Erlebnisse sind laut aktuellem Katalog nicht mehr planbar.'
      : 'Plan geladen. Die Wettervorhersage wird neu abgerufen.';
  }catch(error){
    $('local-plan-status').textContent=error.message||'Der gespeicherte Plan konnte nicht geladen werden.';
  }
});

refreshDates();
try {
  const response=await fetch('/api/experiences');
  if(!response.ok) throw new Error('Catalog unavailable');
  activities=await response.json();
  catalogState='ready';
} catch {
  catalogState='error';
}
render();
refreshSaveStatus();
