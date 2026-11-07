const $=id=>document.getElementById(id);
const steps=['family','place','dates','wishes','groups','done'];
const groupStep=steps.indexOf('groups');
const finalStep=steps.length-1;
const journey=$('journey');
const state={step:0,visited:0,flipped:false,weather:null,place:'Serfaus',start:todayDate(),end:'',family:[],general:new Set(),
  period:'am',groups:{am:{split:false,assignments:new Map()},pm:{split:false,assignments:new Map()}},
  picks:new Map(),seed:0,openAlternatives:'',tripWeather:{}};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let nextId=1, pending=null, catalogRequest, catalog;
let dateError='', exportStatus='', resultStatus='';
function freeLook(kind,except){
  const used=new Set(state.family.filter(person=>person.kind===kind&&person!==except).map(person=>person.look));
  let look=0;
  while(used.has(look)) look++;
  return look;
}
function newPerson(kind,fields={}){
  const p={id:nextId++,kind,wishes:new Set(),...fields};
  if(p.birth) applyAge(p);
  p.look=freeLook(p.kind);
  return p;
}
// Age on the first trip day (or today before dates are chosen); 18+ counts as adult for planning.
function ageOn(birth,date){
  const [by,bm,bd]=birth.split('-').map(Number), [y,m,d]=date.split('-').map(Number);
  return Math.max(0,y-by-(m<bm||m===bm&&d<bd?1:0));
}
function applyAge(p){
  if(p.birth) p.age=ageOn(p.birth,validStart()?state.start:todayDate());
  if(p.age!=null) p.kind=p.age>=18?'adult':'child';
}
const ageText=p=>p.age===0?t('underOne'):p.age===1?t('oneYear'):t('ageYears',p.age);
const dayText=date=>new Intl.DateTimeFormat(locale(),{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
function todayDate(){
  const now=new Date();
  return [now.getFullYear(),now.getMonth()+1,now.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
}
const dateTime=date=>Date.parse(date+'T00:00:00Z');
const dayMs=86400000;
function validStart(){
  const start=dateTime(state.start);
  return Number.isFinite(start)&&start>=dateTime(todayDate());
}
function dateIssue(){
  if(!state.start) return 'startMissing';
  if(!validStart()) return 'startPast';
  if(!state.end) return '';
  const days=(dateTime(state.end)-dateTime(state.start))/dayMs;
  if(!Number.isFinite(days)||days<1) return 'endTooEarly';
  return days>=14?'rangeTooLong':'';
}
function syncDateFields(){
  const start=$('date-start');
  const end=$('date-end');
  start.min=todayDate();
  end.disabled=!validStart();
  if(end.disabled) end.removeAttribute('min');
  else end.min=new Date(dateTime(state.start)+dayMs).toISOString().slice(0,10);
}
function stamp(){
  if(dateIssue()) return '';
  if(!state.end) return dayText(state.start);
  const first=new Intl.DateTimeFormat(locale(),{day:'numeric',month:'numeric',timeZone:'UTC'}).format(new Date(state.start+'T00:00:00Z'));
  const last=new Intl.DateTimeFormat(locale(),{day:'numeric',month:'numeric',year:'2-digit',timeZone:'UTC'}).format(new Date(state.end+'T00:00:00Z'));
  return first+' – '+last;
}
function posterData(){
  const groups=state.step>=groupStep?groupSet(state.family,state.groups[state.period]):[];
  const periodLabel=groups.length&&hasSplit()?t(state.period)+' · '+t(groups.length>1?'splitStatus':'togetherStatus'):'';
  const season=isWinter(validStart()?state.start:todayDate())?'winter':'summer';
  return {place:state.place,family:state.family,date:stamp(),general:state.general,groups,periodLabel,season,weather:state.weather};
}
// Weather for the first trip day (today until dates are picked); the postcard redraws when it arrives.
const weatherCache=new Map();
const weatherDate=()=>validStart()?state.start:todayDate();
function requestWeather(){
  const key=state.place+'|'+weatherDate();
  state.weather=weatherCache.get(key)||null;
  if(weatherCache.has(key)) return;
  weatherCache.set(key,null);
  fetchWeather(state.place,weatherDate()).then(weather=>{
    weatherCache.set(key,weather);
    if(key!==state.place+'|'+weatherDate()) return;
    state.weather=weather;
    draw();
    updateWeatherNote();
  }).catch(()=>weatherCache.delete(key));
}
function updateWeatherNote(){
  const note=$('weather-note');
  if(!note) return;
  const weather=state.weather;
  note.textContent=weather&&validStart()
    ?`${weatherIcons[weather.kind]} ${t('weatherNote',dayText(state.start),t('weather_'+weather.kind),weather.tmin,weather.tmax)} ${weather.source==='forecast'?t('weatherForecast'):t('weatherLastYear',weather.year)}`
    :'';
}
function draw(added,move=false){
  const board=$('board');
  const old=move&&!reduced.matches?new Map([...board.querySelectorAll('[data-member]')].map(el=>[
    el.dataset.member,getComputedStyle(el).transform
  ])):null;
  const interactive=true;
  const data={...posterData(),id:'board-art',interactive};
  const final=state.step===finalStep;
  board.innerHTML=`<div class="flip${final&&state.flipped?' flipped':''}"><div class="face front">${poster(data)}</div>${final?`<div class="face back">${postcardBack(data)}</div>`:''}</div>`;
  board.classList.toggle('drag-enabled',canDrag());
  saveState();
  if(added) board.querySelector(`[data-figure="${added}"]`)?.classList.add('avatar-enter');
  if(!old) return;
  for(const el of board.querySelectorAll('[data-member]')){
    const previous=old.get(el.dataset.member);
    const to=getComputedStyle(el).transform;
    if(!previous&&el.dataset.member==='care') el.querySelector('[data-figure]').classList.add('avatar-enter');
    if(previous&&previous!=='none'&&previous!==to){
      el.animate([{transform:previous},{transform:to}],{duration:420,easing:'cubic-bezier(.22,.74,.28,1)'});
    }
  }
}
function renderSteps(){
  $('steps').innerHTML=steps.map((label,i)=>`<button type="button" data-go="${i}" ${i===state.step?'aria-current="step"':''} ${i<state.step?'class="done"':''} ${i>state.visited?'disabled':''}><b aria-hidden="true">${i<state.step?'✓':i+1}</b>${t(label)}</button>`).join('');
}
function wishButtons(selected,id,keys=Object.keys(choices)){
  return keys.map(key=>`<button type="button" class="choice-button" data-wish="${key}" data-person="${id}" aria-pressed="${selected.has(key)}">${t(key)}</button>`).join('');
}
const hasSplit=()=>Object.values(state.groups).some(settings=>groupSet(state.family,settings).length>1);
function periodPicker(){
  return `<div class="segmented" role="group" aria-label="${t('timeOfDay')}">${Object.keys(periods).map(key=>
    `<button class="small" type="button" data-period="${key}" aria-pressed="${key===state.period}">${t(key)}</button>`).join('')}</div>`;
}
function memberLabel(person){
  if(person.name) return html(person.name)+(person.age!=null?' · '+ageText(person):'');
  const order=state.family.filter(p=>p.kind===person.kind).indexOf(person)+1;
  const label=t('member',t(avatarStage(person)==='senior'?'senior':person.kind),order);
  return person.kind!=='dog'&&person.age!=null?label+' · '+ageText(person):label;
}
function groupControls(){
  if(!canSplit(state.family)) return `<p>${t('oneAdultHint')}</p>`;
  const settings=state.groups[state.period];
  const groups=adultGroups(state.family,settings);
  const leaders=groups.map(g=>g.members[0]);
  const movable=state.family.filter(p=>p.kind!=='adult'||state.family.filter(a=>a.kind==='adult').length>1);
  return periodPicker()+`<div class="segmented split-mode" role="group" aria-label="${t('grouping')}">
    <button class="small" type="button" data-mode="together" aria-pressed="${!settings.split}">${t('allTogether')}</button>
    <button class="small" type="button" data-mode="split" aria-pressed="${settings.split}">${t('split')}</button>
  </div>`+(settings.split&&movable.length?`<p class="drag-hint">${t('groupsDragHint')}</p><div class="assignments">${movable.map(p=>
    `<label>${memberLabel(p)}<select data-assignment="${p.id}">
      ${p.kind==='adult'?`<option value="own" ${leaders.includes(p)?'selected':''}>${t('ownGroup')}</option>`:''}
      ${groups.filter(g=>g.members[0]!==p).map(g=>
      `<option value="${g.id}" ${g.members.includes(p)?'selected':''}>${g.label} · ${memberLabel(g.members[0])}</option>`).join('')}
      ${p.kind==='child'?`<option value="care" ${inCare(p,settings)?'selected':''}>${t('care')}</option>`:''}</select></label>`
    ).join('')}</div>${movable.some(p=>inCare(p,settings))?`<p class="care-hint">${t('careAssignmentHint')}</p>`:''}`:'');
}
// Murmli and Berta take turns giving a tip on each step.
function mascotTip(index){
  const mascot=mascots[index%2?'berta':'murmli'];
  return `<div class="mascot-tip"><svg viewBox="-28 -90 56 96" aria-hidden="true">${mascot.art()}</svg><p><strong>${mascot.name}:</strong> ${t('tip'+steps[index])}</p></div>`;
}
const isWinter=date=>[11,12,1,2,3,4].includes(Number(date.slice(5,7)));
const isMascotActivity=activity=>/murmli|berta/i.test(activity.title);
function renderControls(){
  const index=state.step;
  const children=state.family.filter(p=>p.kind==='child');
  const header=(title,description)=>`<div class="control-heading"><h2 id="prompt" tabindex="-1">${title}</h2><p class="kicker">0${index+1} / 0${steps.length}</p></div><p>${description}</p>`+mascotTip(index);
  let content='';
  if(index===0){
    const count=state.family.length;
    content=header(t('familyHeading'),count?t(count===1?'figureOne':'figureMany',count):t('familyHint'))+
      `<div class="add-tiles">${[['adult',{id:2,kind:'adult',look:0}],['child',{id:3,kind:'child',age:7,look:0}],['grandparent',{id:1,kind:'adult',age:72,look:2}],['dog',{id:1,kind:'dog',look:0}]].map(([kind,sample])=>{
        const figure=avatarFigure({...sample,wishes:new Set()});
        return `<button class="add-tile" type="button" data-add="${kind}" ${kind==='child'?`aria-expanded="${state.agePicker}" aria-controls="age-picker"`:''} ${count>=10?'disabled':''}><svg viewBox="-44 ${-figure.height-8} 88 ${figure.height+14}" aria-hidden="true">${figure.svg}</svg><span>+ ${t(kind)}</span></button>`;
      }).join('')}</div>`+(state.agePicker?`<div class="age-picker" id="age-picker" role="group" aria-labelledby="age-pick-title"><p id="age-pick-title"><strong>${t('agePick')}</strong></p>
        ${[['baby',0,1],['little',2,5],['school',6,11],['teen',12,17]].map(([stage,from,to])=>`<div class="age-band"><span>${t(stage)} <small>${from}–${to}</small></span><div class="age-buttons">${
          Array.from({length:to-from+1},(_,i)=>from+i).map(age=>`<button type="button" class="age-chip" data-age="${age}" aria-label="${ageText({age})}">${age===0?'&lt;1':age}</button>`).join('')}</div></div>`).join('')}</div>`:'');
  }else if(index===1){
    content=header(t('placeHeading'),t('placeHint'))+
      `<div class="options">${Object.keys(towns).map(town=>`<button type="button" class="place" data-place="${town}" aria-pressed="${town===state.place}"><strong>${town}</strong><small>${t('motif'+town)}</small></button>`).join('')}</div>`;
  }else if(index===2){
    content=header(t('datesHeading'),t('datesHint'))+
      `<div class="date-fields"><label>${t('dateFrom')}<input id="date-start" type="date" value="${state.start}" aria-describedby="date-error"></label><label>${t('dateTo')}<input id="date-end" type="date" value="${state.end}" aria-describedby="date-error"></label></div><p id="date-error" role="alert"></p><p id="weather-note" class="weather-note" role="status"></p>`;
  }else if(index===3){
    content=header(t('wishesHeading'),t('wishesHint'))+
      (children.length?children.map(p=>`<fieldset class="wish-group"><legend>${memberLabel(p)}</legend><div class="options">${wishButtons(p.wishes,p.id)}</div></fieldset>`).join('')
        :`<div class="options">${wishButtons(state.general,'family')}</div>`)+
      state.family.filter(p=>p.kind==='adult').map(p=>`<fieldset class="wish-group"><legend>${memberLabel(p)}</legend>
        <div class="options">${wishButtons(p.wishes,p.id)}</div></fieldset>`).join('');
  }else if(index===groupStep){
    content=header(t('groupsHeading'),t('groupsHint'))+groupControls();
  }else{
    content=header(t('doneHeading'),t('doneHint'))+
      (hasSplit()?periodPicker():'')+
      `<div class="summary-actions"><button class="small" type="button" id="flip" aria-pressed="${state.flipped}"><span aria-hidden="true">↻</span> ${t('flipCard')}</button><button class="small" type="button" id="share" aria-expanded="false" aria-controls="share-panel"><span aria-hidden="true">↗</span> ${t('share')}</button><button class="small" type="button" id="print-card"><span aria-hidden="true">⎙</span> ${t('printPdf')}</button><button class="small" type="button" id="export">${t('export')}</button><button class="primary" type="button" id="search">${t('find')} <span aria-hidden="true">↓</span></button></div><div id="share-panel" class="share-panel" hidden></div><p id="export-status" role="status"></p>`;
  }
  const disabled=index===0&&!state.family.some(p=>p.kind==='adult');
  $('controls').innerHTML=content+`<div class="control-bottom">${index?`<button type="button" class="small" data-back>← ${t('back')}</button>`:''}${index<finalStep?`<button type="button" class="primary" data-next ${disabled?'disabled':''}>${t('next')} <span aria-hidden="true">→</span></button>`:''}</div>`;
  if(index===2){
    syncDateFields();
    updateWeatherNote();
    if(dateError) $('date-error').textContent=t(dateError);
  }
  if(index===finalStep&&exportStatus) $('export-status').textContent=t(exportStatus);
  if(index===finalStep&&typeof renderWallet==='function') renderWallet();
}
function render(added,focus=false){
  draw(added);
  renderSteps();
  renderControls();
  if(focus) $('prompt').focus({preventScroll:true});
}
function start(){
  requestWeather();
  $('welcome').hidden=true;
  $('experience').hidden=false;
  $('exit').hidden=false;
  journey.classList.add('canvas-open');
  render(undefined,true);
}
$('start').addEventListener('click',start);
$('exit').addEventListener('click',()=>{
  journey.classList.remove('canvas-open');
  $('exit').hidden=true;
  $('prompt').focus({preventScroll:true});
});
function go(index){
  if(index>0&&!state.family.some(p=>p.kind==='adult')) return;
  const issue=index>2?dateIssue():'';
  if(issue){
    if(state.step!==2) go(2);
    dateError=issue;
    $('date-error').textContent=t(issue);
    $(validStart()?'date-end':'date-start').focus();
    return;
  }
  const arriving=index===finalStep&&state.step!==finalStep;
  if(index!==finalStep) state.flipped=false;
  state.step=index;
  state.visited=Math.max(state.visited,index);
  $('experience').classList.remove('show-results');
  $('results').hidden=true;
  render(undefined,true);
  // The finale: arriving at the last step turns the postcard over to its stamped back.
  if(arriving) setTimeout(()=>flipCard(true),reduced.matches?0:650);
}
function flipCard(on){
  if(state.step!==finalStep) return;
  state.flipped=on;
  $('board').querySelector('.flip')?.classList.toggle('flipped',on);
  $('flip')?.setAttribute('aria-pressed',String(on));
  $('announcement').textContent=t(on?'backShown':'frontShown');
  if(on&&!reduced.matches) setTimeout(celebrate,1250);
}
function celebrate(){
  const board=$('board');
  if(!state.flipped||!board.querySelector('.flipped')) return;
  const {width,height}=board.getBoundingClientRect();
  const colours=['#dfaa46','#d1745a','#7a9cae','#a08cb7','#6c9b84','#efc66d','#ffffff'];
  for(let i=0;i<40;i++){
    const bit=document.createElement('i');
    bit.className='confetti';
    bit.style.cssText=`left:${width*.77}px;top:${height*.31}px;background:${colours[i%colours.length]};${i%3?'':'border-radius:50%;'}`;
    board.append(bit);
    const angle=Math.random()*Math.PI*2, distance=70+Math.random()*230;
    const dx=Math.cos(angle)*distance, dy=Math.sin(angle)*distance*.7;
    bit.animate([
      {transform:'translate(0,0) rotate(0)',opacity:1},
      {transform:`translate(${dx}px,${dy}px) rotate(${Math.random()*540}deg)`,opacity:1,offset:.55},
      {transform:`translate(${dx*1.15}px,${dy+160}px) rotate(${Math.random()*900}deg)`,opacity:0}
    ],{duration:1500+Math.random()*800,easing:'cubic-bezier(.15,.7,.3,1)'}).onfinish=()=>bit.remove();
  }
}
$('steps').addEventListener('click',event=>{
  const button=event.target.closest('[data-go]');
  if(button) go(Number(button.dataset.go));
});
function dialog(kind,p){
  pending={kind,p};
  $('choice').returnValue='';
  $('choice-title').textContent=t('removeHeading');
  $('choice-content').innerHTML=`<p>${t('removeDescription',html(avatarName(p))+(p.kind!=='dog'&&p.age!=null?' · '+ageText(p):''))}</p>`;
  $('choice-confirm').textContent=t('remove');
  $('choice').showModal();
}
function add(kind,age,button=kind){
  if(state.family.length>=10) return;
  const p=newPerson(kind,{age});
  state.family.push(p);
  render(p.id);
  $('controls').querySelector(`[data-add="${button}"]`)?.focus();
  $('announcement').textContent=t('avatarAdded',avatarName(p));
}
$('choice-cancel').addEventListener('click',()=>$('choice').close('cancel'));
$('choice-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const action=pending;
  pending=null;
  $('choice').close('confirm');
  if(!action) return;
  state.family=state.family.filter(p=>p!==action.p);
  const figure=$('board').querySelector(`[data-figure="${action.p.id}"]`);
  if(figure&&!reduced.matches){
    figure.classList.add('avatar-leave');
    await new Promise(resolve=>setTimeout(resolve,215));
  }
  if(!figure?.isConnected) return;
  if(state.step&&!state.family.some(p=>p.kind==='adult')) return go(0);
  render();
  if(!$('results').hidden&&catalog) renderResults();
  $('controls').querySelector(`[data-add="${action.p.kind}"]`)?.focus();
  $('announcement').textContent=t('avatarRemoved',avatarName(action.p));
});
// Tapping a figure on any step opens the editor (dogs: the remove prompt).
function openPerson(p){
  if(!p||$('choice').open||$('editor').open) return;
  if(p.kind==='dog') dialog('remove',p);else openEditor(p);
}
let suppressClick=false;
function requestRemoval(event){
  if(suppressClick) return;
  const mark=state.flipped?null:event.target.closest('[data-avatar]');
  // Last step: tapping the card itself (not a person on it) turns it over.
  if(!mark&&state.step===finalStep&&event.target.closest('.flip')) return flipCard(!state.flipped);
  openPerson(mark&&state.family.find(item=>item.id===Number(mark.dataset.avatar)));
}
function changePeriod(period,target){
  if(state.period===period) return;
  state.period=period;
  draw(undefined,true);
  if(state.step===groupStep){
    renderControls();
    $('controls').querySelector(`[data-period="${period}"]`).focus({preventScroll:true});
  }else{
    for(const option of $('controls').querySelectorAll('[data-period]')) option.setAttribute('aria-pressed',String(option.dataset.period===period));
    if(!$('results').hidden&&catalog) renderResults(target.closest('#results')?`[data-period="${period}"]`:undefined);
  }
}
$('board').addEventListener('click',requestRemoval);
// Groups step: drag figures on the postcard into another group (the selects below do the same by keyboard).
function canDrag(){
  return state.step===groupStep&&state.groups[state.period].split&&canSplit(state.family);
}
function moveToGroup(p,team){
  const settings=state.groups[state.period];
  const assignments=settings.assignments;
  // Pin everyone to their current group first, so only the moved figure changes place.
  for(const group of adultGroups(state.family,settings)) for(const m of group.members.slice(1)) assignments.set(m.id,group.id);
  const leader=team==='free'
    ?groupSet(state.family,settings).find(g=>g.id==='free')?.members[0]
    :state.family.find(m=>String(m.id)===team&&m.kind==='adult');
  if(p.kind==='adult'){
    if(!leader) assignments.delete(p.id);
    else if(leader!==p){
      for(const [id,owner] of assignments) if(owner===p.id) assignments.set(id,leader.id);
      assignments.set(p.id,leader.id);
    }
  }else if(team==='care'&&p.kind==='child') assignments.set(p.id,'care');
  else if(leader) assignments.set(p.id,leader.id);
  draw(undefined,true);
  renderControls();
  $('announcement').textContent=t('groupsUpdated');
}
let drag=null;
const svgPoint=(svg,event)=>new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
const teamAt=(svg,x)=>[...svg.querySelectorAll('[data-team]')].find(g=>x>=Number(g.dataset.x0)-12&&x<=Number(g.dataset.x1)+12);
$('board').addEventListener('pointerdown',event=>{
  if(!canDrag()) return;
  const el=event.target.closest('[data-member]');
  const p=el&&state.family.find(item=>String(item.id)===el.dataset.member);
  if(!p) return;
  event.preventDefault();
  const svg=el.ownerSVGElement;
  drag={p,el,svg,start:svgPoint(svg,event),base:el.getAttribute('transform'),moved:false};
  $('board').setPointerCapture(event.pointerId);
});
$('board').addEventListener('pointermove',event=>{
  if(!drag) return;
  const pt=svgPoint(drag.svg,event);
  if(!drag.moved){
    if(Math.hypot(pt.x-drag.start.x,pt.y-drag.start.y)<6) return;
    drag.moved=true;
    drag.svg.append(drag.el);
    drag.el.classList.add('dragging');
  }
  drag.el.setAttribute('transform',`translate(${pt.x-drag.start.x} ${pt.y-drag.start.y}) ${drag.base}`);
  const team=teamAt(drag.svg,pt.x);
  for(const g of drag.svg.querySelectorAll('[data-team]')) g.classList.toggle('drop-target',g===team);
});
$('board').addEventListener('pointerup',event=>{
  if(!drag) return;
  const {p,svg,moved}=drag;
  drag=null;
  suppressClick=true;
  setTimeout(()=>{suppressClick=false});
  if(moved) moveToGroup(p,teamAt(svg,svgPoint(svg,event).x)?.dataset.team);
  else openPerson(p);
});
$('board').addEventListener('pointercancel',()=>{if(drag){drag=null;draw()}});
$('board').addEventListener('keydown',event=>{
  if(!['Enter',' '].includes(event.key)||!event.target.closest('[data-avatar]')) return;
  event.preventDefault();requestRemoval(event);
});
$('controls').addEventListener('click',event=>{
  const target=event.target.closest('button');
  if(!target) return;
  const {add:kind,place,wish,person,period,mode,age}=target.dataset;
  if(age!==undefined){
    state.agePicker=false;
    add('child',Number(age));
  }else if(kind==='child'){
    state.agePicker=!state.agePicker;
    renderControls();
    $('controls').querySelector(state.agePicker?'[data-age]':'[data-add="child"]')?.focus();
  }
  else if(kind==='grandparent') add('adult',70,kind);
  else if(kind) add(kind);
  else if(place){
    state.place=place;requestWeather();draw();
    for(const option of $('controls').querySelectorAll('[data-place]')) option.setAttribute('aria-pressed',String(option===target));
  }else if(wish){
    const picked=person==='family'?state.general:state.family.find(p=>p.id===Number(person)).wishes;
    if(picked.has(wish)) picked.delete(wish);else picked.add(wish);
    target.setAttribute('aria-pressed',String(picked.has(wish)));draw();
  }else if(period) changePeriod(period,target);
  else if(mode){
    state.groups[state.period].split=mode==='split';
    draw(undefined,true);renderControls();
    $('controls').querySelector(`[data-mode="${mode}"]`).focus({preventScroll:true});
  }else if(target.hasAttribute('data-next')) go(state.step+1);
  else if(target.hasAttribute('data-back')) go(state.step-1);
  else if(target.id==='export') exportPNG();
  else if(target.id==='flip') flipCard(!state.flipped);
  else if(target.id==='share') sharePostcard(target);
  else if(target.id==='print-card') printSheet();
  else if(target.id==='share-copy') navigator.clipboard?.writeText(shareURL()).then(()=>showExportStatus('shareCopied'),()=>{});
  else if(target.id==='search') search();
});
$('controls').addEventListener('change',event=>{
  if(event.target.dataset.assignment){
    const id=Number(event.target.dataset.assignment);
    moveToGroup(state.family.find(p=>p.id===id),event.target.value);
    $('controls').querySelector(`[data-assignment="${id}"]`).focus({preventScroll:true});
    return;
  }
  if(event.target.id==='date-start'){
    state.start=event.target.value;
    syncDateFields();
    if(state.end&&(!validStart()||state.end<=state.start)){state.end='';$('date-end').value=''}
    state.family.filter(p=>p.birth).forEach(applyAge);
    requestWeather();
  }else if(event.target.id==='date-end') state.end=event.target.value;
  else return;
  dateError='';
  $('date-error').textContent='';
  draw();
});
function showExportStatus(key){
  exportStatus=key;
  const status=$('export-status');
  if(status) status.textContent=t(key);
}
// An SVG drawn as an image cannot load web fonts, so the export inlines ours as data URLs.
let exportFontCSS;
function exportFonts(){
  return exportFontCSS ||= fetch('fonts/fonts.css').then(response=>response.text()).then(async css=>{
    for(const file of new Set(css.match(/[\w-]+\.woff2/g))){
      const blob=await fetch('fonts/'+file).then(response=>response.blob());
      const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});
      css=css.split(`url(${file})`).join(`url(${data})`);
    }
    return css.replace(/\/\*[^]*?\*\//g,'');
  }).catch(()=>{exportFontCSS=null;return ''});
}
// A4 portrait print sheet (units: 0.1 mm): the front on the top A5 half, the back on the bottom half
// turned 180°, so the sheet folded along the middle line is a postcard whose back reads the right way up.
function sheetSVG(styles=''){
  const data={...posterData(),id:'export-art'};
  const place=svg=>svg.replace('viewBox="0 0 960 540"','x="100" y="208" width="1900" height="1069" viewBox="0 0 960 540"');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 2970" width="2100" height="2970" role="img" aria-label="${html(t('sheetLabel'))}">
    ${styles?`<defs><style>${styles}</style></defs>`:''}<rect width="2100" height="2970" fill="#fff"/>
    ${place(poster(data))}
    <g transform="rotate(180 1050 2227.5) translate(0 1485)">${place(postcardBack(data))}</g>
    <path d="M30 1485H2070" stroke="#9aa59c" stroke-width="3" stroke-dasharray="18 14"/>
    <text x="1050" y="1460" text-anchor="middle" font-size="28" fill="#7f8b82" font-family="system-ui, sans-serif">${html(t('foldHere'))}</text>
  </svg>`;
}
// Renders the A4 sheet (both sides) as a PNG blob at 200 dpi.
async function renderPNG(){
  const fonts=await exportFonts();
  const source=sheetSVG(fonts).replace('width="2100" height="2970"','width="1654" height="2339"');
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    await img.decode?.().catch(()=>{});
    const canvas=document.createElement('canvas');
    canvas.width=1654;canvas.height=2339;
    canvas.getContext('2d').drawImage(img,0,0);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!png) throw Error('PNG unavailable');
    return png;
  }finally{URL.revokeObjectURL(url)}
}
const pngName=()=>'familienzeit-'+state.place.toLowerCase()+'-a4.png';
// Print / save as PDF: the same A4 sheet as vector graphics through the browser's print dialog.
function printSheet(){
  $('print-sheet')?.remove();
  const sheet=document.createElement('div');
  sheet.id='print-sheet';
  sheet.innerHTML=sheetSVG();
  document.body.append(sheet);
  addEventListener('afterprint',()=>sheet.remove(),{once:true});
  print();
}
async function exportPNG(){
  showExportStatus('exporting');
  try{
    const pngURL=URL.createObjectURL(await renderPNG());
    const link=document.createElement('a');
    link.download=pngName();
    link.href=pngURL;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(pngURL),60000);
    showExportStatus('exported');
  }catch{
    showExportStatus('exportFailed');
  }
}
// Share: the device's share sheet with the postcard image (phones: WhatsApp, Instagram, Signal …);
// where that is not available, a panel with social links and "copy link".
const shareURL=()=>location.origin+location.pathname;
async function sharePostcard(button){
  const text=t('shareText',state.place);
  try{
    const file=new File([await renderPNG()],pngName(),{type:'image/png'});
    if(navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:t('shareTitle'),text:`${text} ${shareURL()}`});
      return;
    }
  }catch(error){
    if(error?.name==='AbortError') return;
  }
  const panel=$('share-panel');
  const open=panel.hidden;
  panel.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
  if(!open) return;
  const url=encodeURIComponent(shareURL()), message=encodeURIComponent(text);
  const links={whatsapp:`https://wa.me/?text=${message}%20${url}`,facebook:`https://www.facebook.com/sharer/sharer.php?u=${url}`,
    x:`https://x.com/intent/post?text=${message}&url=${url}`,pinterest:`https://www.pinterest.com/pin/create/button/?url=${url}&description=${message}`,
    email:`mailto:?subject=${encodeURIComponent(t('shareTitle'))}&body=${message}%20${url}`};
  panel.innerHTML=`<p>${t('shareHint')}</p><div class="share-links">${Object.entries(links).map(([key,href])=>
    `<a class="share-link ${key}" href="${html(href)}" ${key==='email'?'':'target="_blank" rel="noopener"'}>${t('share_'+key)}</a>`).join('')}
    <button type="button" class="share-link" id="share-copy">${t('shareCopy')}</button></div>`;
  panel.querySelector('a').focus();
}
function visitDates(){
  const end=state.end||state.start;
  const dates=[];
  for(let t=dateTime(state.start);t<=dateTime(end);t+=dayMs) dates.push(new Date(t).toISOString().slice(0,10));
  return dates;
}
function groupName(group){
  return `<span class="group-chip" style="--team-color:${group.color??'#d7e6d8'}">${group.label}</span>`;
}
const shortName=p=>p.name?html(p.name):memberLabel(p).split(' · ')[0];
function currentTrip(){
  return planTrip(catalog,{dates:visitDates(),place:state.place,family:state.family,general:state.general,
    groupsFor:period=>groupSet(state.family,state.groups[period]),weatherByDate:state.tripWeather,picks:state.picks,seed:state.seed});
}
function tripItem(entry,day){
  if(entry.care){
    const links=Object.entries(childcareLinks).map(([key,urls])=>`<a href="${urls[language]}" target="_blank" rel="noopener">${t(key)} ↗</a>`).join(' · ');
    return `<article class="trip-item care">${groupName(entry.group)}<p><strong>${t('care')}</strong> · ${links}</p></article>`;
  }
  const {chosen:o,group,key,alternatives}=entry;
  const open=state.openAlternatives===key;
  const who=group.id==='all'?'':`<p class="trip-who">${groupName(group)} ${group.members.map(shortName).join(' · ')}</p>`;
  const alternativesList=open&&alternatives.length?`<div class="trip-alternatives" id="alt-${CSS.escape(key)}"><p>${t('alternatives')}</p>${alternatives.map(alt=>
    `<button type="button" class="alt" data-key="${html(key)}" data-choose="${alt.index}"><strong>${html(activityTitle(alt.activity))}</strong>
      <small>${timeRange(alt.time.start,alt.time.end)} · ${html(alt.activity.location[0])}${alt.likes.length?` · ♥ ${alt.likes.map(l=>shortName(l.person)).join(', ')}`:''}</small></button>`).join('')}</div>`:'';
  if(!o) return `<article class="trip-item empty">${who}<p>${t('freeTime')}</p>
    ${alternatives.length?`<button type="button" class="small" data-alt="${html(key)}" aria-expanded="${open}">${t('pickSomething')}</button>`:''}${alternativesList}</article>`;
  const a=o.activity;
  const bad=badWeather.has(day.weather?.kind);
  const chips=[
    o.today?`<span class="chip-live today">● ${t('liveToday')}</span>`:`<span class="chip-live">● ${t('liveOpen',openingOn(a,day.date))}</span>`,
    a.weather==='both'&&bad?`<span class="chip-soft">☂ ${t('weatherProof')}</span>`:a.weather==='sun'?`<span class="chip-soft">☀ ${t('outdoors')}</span>`:'',
    a.advanceBooking?`<span class="chip-soft warn">${t('advanceBooking')}</span>`:'',
    o.dogCheck?`<span class="chip-soft warn">${t('dogAsk')}</span>`:o.dogWelcome?`<span class="chip-live">${t('dogWelcome')}</span>`:'',
    isMascotActivity(a)?`<span class="chip-soft mascot">${t('mascotPick')}</span>`:''
  ].join('');
  return `<article class="trip-item">${who}
    <div class="trip-head"><span class="trip-time">${timeRange(o.time.start,o.time.end)}</span><strong>${html(activityTitle(a))}</strong></div>
    <p class="trip-meta">${html(a.location[0])} · ${t('minutes',a.duration)} · ${t(a.category)}</p>
    <p class="trip-chips">${chips}</p>
    ${o.likes.length?`<p class="trip-likes">${o.likes.map(l=>`<span>♥ ${shortName(l.person)} <small>${l.keys.map(k=>t(k)).join(', ')}</small></span>`).join('')}</p>`:`<p class="trip-likes none">${t('noLikes')}</p>`}
    ${o.access.length?`<p class="access-line">${o.access.map(({key:k,status})=>`<span class="access-chip ${status}">${status==='yes'?'✓':status==='limited'?'≈':'?'} ${t('access_'+k)}: ${t('accessStatus_'+status)}</span>`).join('')}</p>${o.access.some(item=>item.status!=='yes')?`<p class="trip-note">${t('accessAsk')}</p>`:''}`:''}
    <div class="trip-actions"><a href="${html(a.sources[0])}" target="_blank" rel="noopener">${t('provider')} ↗</a>
      ${a.checked?`<small>${t('checkedOn',dayText(a.checked))}</small>`:''}
      ${alternatives.length?`<button type="button" class="small" data-alt="${html(key)}" aria-expanded="${open}">⇄ ${t('swap')}</button>`:''}
      <button type="button" class="small" data-drop="${html(key)}">${t('removeItem')}</button></div>
    ${alternativesList}
  </article>`;
}
function renderResults(focus){
  resultStatus='';
  const target=$('results');
  const dates=visitDates();
  const {days,happy}=currentTrip();
  const people=state.family.filter(p=>p.kind!=='dog');
  const most=Math.max(1,...happy.values());
  const fairness=`<section class="fairness" aria-labelledby="fairness-title"><h3 id="fairness-title">${t('fairness')}</h3>
    <div class="fairness-rows">${people.map(p=>`<div class="fair-row"><span>${shortName(p)}</span><span class="fair-bar"><i style="width:${Math.round(100*(happy.get(p.id)||0)/most)}%"></i></span><b>${happy.get(p.id)||0}</b></div>`).join('')}</div>
    ${people.some(p=>!p.wishes.size)?`<p class="trip-note">${t('fairnessHint')}</p>`:''}</section>`;
  const dayCards=days.map((day,i)=>{
    const w=day.weather;
    return `<section class="trip-day" aria-labelledby="day-${i}"><header><h3 id="day-${i}"><span>${t('dayN',i+1)}</span> ${html(new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(day.date+'T00:00:00Z')))}</h3>
      ${w?`<span class="day-weather" title="${t(w.source==='forecast'?'weatherForecast':'weatherLastYear',w.year)}">${weatherIcons[w.kind]} ${t('weather_'+w.kind)} · ${w.tmin}°/${w.tmax}°<small>${t(w.source==='forecast'?'forecastShort':'lastYearShort')}</small></span>`:''}</header>
      ${day.slots.map(slot=>`<div class="trip-slot"><div class="slot-label">${t(slot.period==='evening'?'evening':slot.period)}</div><div class="slot-entries">${slot.entries.map(entry=>tripItem(entry,day)).join('')}</div></div>`).join('')}
    </section>`;
  }).join('');
  target.innerHTML=`<div class="trip-top"><div><h2 id="results-title" tabindex="-1">${t('tripTitle')}</h2>
    <p>${state.place} · ${html(stamp())} · ${t('tripIntro')}</p></div>
    <button type="button" class="primary" id="replan">✨ ${t('replan')}</button></div>
    <aside class="mascot-tip mascot-world"><svg viewBox="-56 -90 112 96" aria-hidden="true"><g transform="translate(-22 0)">${bertaArt()}</g><g transform="translate(24 0)">${murmliArt()}</g></svg>
      <p><strong>${t(isWinter(dates[0])?'mascotWinter':'mascotSummer')}</strong> ${t('mascotWorldHint')}
      <a href="${isWinter(dates[0])?'https://www.serfaus-fiss-ladis.at/de/winterurlaub/familienwinter/murmlis-und-bertas-winterwelt':'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/familiensommer/murmlis-und-bertas-bergabenteuer'}" target="_blank" rel="noopener">${t('mascotWorldLink')} ↗</a></p></aside>
    ${fairness}
    <div class="trip-days">${dayCards}</div>
    <p class="trip-note">${t('tripSources')}</p>`;
  if(focus) target.querySelector(focus)?.focus({preventScroll:true});
  saveState();
}
$('results').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  const {alt,choose,key,drop}=button.dataset;
  let focus;
  if(button.id==='replan'){
    state.seed++;
    state.openAlternatives='';
    focus='#replan';
  }else if(alt!==undefined){
    state.openAlternatives=state.openAlternatives===alt?'':alt;
    focus=`[data-alt="${CSS.escape(alt)}"]`;
  }else if(choose!==undefined){
    state.picks.set(key,Number(choose));
    state.openAlternatives='';
    focus=`[data-alt="${CSS.escape(key)}"]`;
  }else if(drop!==undefined){
    state.picks.set(drop,-1);
    focus=`[data-alt="${CSS.escape(drop)}"]`;
  }else return;
  renderResults(focus);
  $('announcement').textContent=t('planUpdated');
});
function showResultStatus(key){
  resultStatus=key;
  $('results').innerHTML=`<h2 id="results-title" tabindex="-1">${t('results')}</h2><p>${t(key)}</p>`;
}
async function search(){
  const target=$('results');
  $('experience').classList.add('show-results');
  target.hidden=false;
  showResultStatus('loading');
  try{
    catalogRequest ||= fetch('catalog.json').then(response=>{if(!response.ok) throw Error();return response.json()});
    catalog=await catalogRequest;
    state.tripWeather=await fetchWeatherDays(state.place,visitDates()).catch(()=>({}));
    if(state.step!==finalStep||target.hidden) return;
    renderResults('#results-title');
    target.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
  }catch{
    catalogRequest=null;
    showResultStatus('catalogFailed');
  }
}
function renderLanguage(){
  document.documentElement.lang=locale();
  document.title=t('pageTitle');
  document.querySelector('meta[name="description"]').content=t('pageDescription');
  document.querySelectorAll('[data-text]').forEach(el=>{el.textContent=t(el.dataset.text)});
  document.querySelectorAll('[data-label]').forEach(el=>{el.setAttribute('aria-label',t(el.dataset.label))});
  $('language').value=language;
  $('cover').innerHTML=poster({place:'Ladis',family:[{id:1,kind:'adult',wishes:new Set()},{id:2,kind:'child',age:6,wishes:new Set(['play'])},{id:3,kind:'child',age:0,wishes:new Set()},{id:4,kind:'dog',wishes:new Set()}],date:t('postcardSample'),id:'cover-art'});
  if(!$('experience').hidden) render();
  if(!$('results').hidden){
    if(resultStatus) showResultStatus(resultStatus);
    else if(catalog) renderResults();
  }
}
$('language').addEventListener('change',event=>{
  setLanguage(event.target.value);
  renderLanguage();
});
// The whole setup (people, place, dates, interests, groups, plan choices) is kept in this browser's
// localStorage and comes back after a reload. Nothing leaves the device.
const storeKey='familienzeit-canvas-state';
function saveState(){
  try{
    localStorage.setItem(storeKey,JSON.stringify({v:1,nextId,step:state.step,visited:state.visited,place:state.place,
      start:state.start,end:state.end,period:state.period,seed:state.seed,general:[...state.general],picks:[...state.picks],
      family:state.family.map(p=>({...p,wishes:[...p.wishes],needs:p.needs&&[...p.needs]})),
      groups:Object.fromEntries(Object.entries(state.groups).map(([key,group])=>[key,{split:group.split,assignments:[...group.assignments]}]))}));
  }catch{}
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(storeKey));
    if(saved?.v!==1||!saved.family.length) return false;
    Object.assign(state,{step:saved.step,visited:saved.visited,place:saved.place,start:saved.start,end:saved.end,period:saved.period,
      seed:saved.seed,general:new Set(saved.general),picks:new Map(saved.picks),
      family:saved.family.map(p=>({...p,wishes:new Set(p.wishes),needs:p.needs?new Set(p.needs):undefined})),
      groups:Object.fromEntries(Object.entries(saved.groups).map(([key,group])=>[key,{split:group.split,assignments:new Map(group.assignments)}]))});
    nextId=saved.nextId;
    if(!validStart()){state.start=todayDate();state.end='';}
    state.family.filter(p=>p.birth).forEach(applyAge);
    return true;
  }catch{return false}
}
if(loadState()){
  document.querySelector('.start-label').dataset.text='continueCanvas';
  $('reset').hidden=false;
}
$('reset').addEventListener('click',()=>{
  try{localStorage.removeItem(storeKey)}catch{}
  location.reload();
});
renderLanguage();
