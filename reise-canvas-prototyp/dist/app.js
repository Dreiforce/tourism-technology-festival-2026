const $=id=>document.getElementById(id);
const steps=['family','place','dates','wishes','groups','done'];
const groupStep=steps.indexOf('groups');
const finalStep=steps.length-1;
const journey=$('journey');
const state={step:0,visited:0,flipped:false,weather:null,place:'Serfaus',start:'',end:'',family:[],general:new Set(),
  period:'am',groups:{am:{split:false,assignments:new Map()},pm:{split:false,assignments:new Map()}},
  plan:new Map(),care:new Map(),resultDate:''};
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
      `<div class="summary-actions"><button class="small" type="button" id="flip" aria-pressed="${state.flipped}"><span aria-hidden="true">↻</span> ${t('flipCard')}</button><button class="small" type="button" id="export">${t('export')}</button><button class="primary" type="button" id="search">${t('find')} <span aria-hidden="true">↓</span></button></div><p id="export-status" role="status"></p>`;
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
  const mark=event.target.closest('[data-avatar]');
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
async function exportPNG(){
  showExportStatus('exporting');
  const data={...posterData(),id:'export-art'};
  const source=(state.flipped?postcardBack(data):poster(data))
    .replace('viewBox="0 0 960 540"','width="1920" height="1080" viewBox="0 0 960 540"');
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    const canvas=document.createElement('canvas');
    canvas.width=1920;canvas.height=1080;
    canvas.getContext('2d').drawImage(img,0,0);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!png) throw Error('PNG unavailable');
    const pngURL=URL.createObjectURL(png);
    const link=document.createElement('a');
    link.download='familienzeit-'+state.place.toLowerCase()+'.png';
    link.href=pngURL;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(pngURL),60000);
    showExportStatus('exported');
  }catch{
    showExportStatus('exportFailed');
  }finally{URL.revokeObjectURL(url)}
}
function visitDates(){
  const end=state.end||state.start;
  const dates=[];
  for(let t=dateTime(state.start);t<=dateTime(end);t+=dayMs) dates.push(new Date(t).toISOString().slice(0,10));
  return dates;
}
function planKey(date,period,group){
  return [state.place,date,period,...group.members.map(p=>p.id)].join('/');
}
function resultGroups(date,period){
  const groups=groupSet(state.family,state.groups[period]);
  const care=groups.find(group=>group.id==='care');
  const careKey=care&&planKey(date,period,care);
  const hours=state.care.get(careKey);
  return groups.map(group=>{
    if(group.id==='care') return {...group,key:careKey,hours};
    const pendingCare=group.usesCare&&!hours?.window;
    const slot=group.usesCare&&hours?.window?hours.window:periods[period];
    const candidates=rankedActivities(catalog,{date,period:slot,place:state.place,group,general:state.general});
    const key=planKey(date,period,group);
    return {...group,candidates,key,pendingCare,chosen:!pendingCare&&candidates.find(item=>item.index===state.plan.get(key))};
  });
}
function groupName(group){
  return `<span class="group-chip" style="--team-color:${group.color??'#d7e6d8'}">${group.label}</span>`;
}
function careForm(group){
  const hours=group.hours;
  const links=Object.entries(childcareLinks).map(([key,urls])=>
    `<a href="${urls[language]}" target="_blank" rel="noopener">${t(key)} ↗</a>`).join('');
  return `<p>${t('careHoursHint')}</p><form id="care-form">
    <div class="date-fields">
      <label>${t('careFrom')}<input id="care-from" name="from" type="time" value="${hours?.draft?.from??hours?.from??''}" required></label>
      <label>${t('careTo')}<input name="to" type="time" value="${hours?.draft?.to??hours?.to??''}" required></label>
    </div>
    <div class="result-actions"><button type="submit" class="small">${t('careSave')}</button>
      ${hours?.window?`<button type="button" class="small" data-clear-care>${t('careClear')}</button>`:''}</div>
    <p id="care-error" role="alert"></p>
  </form><div class="care-links">${links}</div>`;
}
function planEntry(group){
  if(group.id==='care') return group.hours?.window
    ?`<strong>${group.hours.from}–${group.hours.to}</strong>`:t('careUnconfirmed');
  return group.chosen
    ?`<strong>${timeRange(group.chosen.time.start,group.chosen.time.end)}</strong> · ${html(activityTitle(group.chosen.activity))}`
    :t('openSlot');
}
function featuredReason(matches){
  if(!matches.length) return t('featuredFilters');
  const interests=new Intl.ListFormat(locale(),{style:'short'}).format(matches.map(key=>t(key)));
  return t('featuredInterests',interests);
}
function resultCards(group){
  if(group.id==='care') return careForm(group);
  const hint=group.pendingCare?`<p>${t('careNeeded')}</p>`:'';
  if(!group.candidates.length) return hint+`<p>${t('noMatches')}</p>`;
  return hint+(groupAccess(group).length?`<p class="access-intro">${t('accessFiltered')}</p>`:'')+`<div class="result-grid">${group.candidates.map(({index,activity:a,time,featured,matches,access})=>`<article class="result${featured?' is-featured':''}">
    ${featured?`<span class="featured-badge"><span aria-hidden="true">✦</span> ${t('featured')}</span>`:''}
    ${isMascotActivity(a)?`<span class="featured-badge mascot-badge">${t('mascotPick')}</span>`:''}
    <small>${timeRange(time.start,time.end)} · ${t(a.category)}${a.adultFocus?' · '+t('ageLimit',a.min):''}</small>
    <strong>${html(activityTitle(a))}</strong><p>${html(activityDescription(a))}</p>
    ${featured?`<p class="featured-reason">${html(featuredReason(matches))}</p>`:''}
    ${a.advanceBooking?`<p><small>${t('advanceBooking')}</small></p>`:''}
    ${access.length?`<p class="access-line">${access.map(({key,status})=>`<span class="access-chip ${status}">${status==='yes'?'✓':status==='limited'?'≈':'?'} ${t('access_'+key)}: ${t('accessStatus_'+status)}</span>`).join('')}</p>
      ${a.accessNote?`<p><small>${html(a.accessNote)}</small></p>`:''}${access.some(item=>item.status!=='yes')?`<p><small>${t('accessAsk')}</small></p>`:''}`:''}
    <div class="result-actions"><a href="${html(a.sources[0])}" target="_blank" rel="noopener">${t('provider')} ↗</a>
    <button type="button" class="small" data-pick="${index}" data-team-pick="${group.id}" aria-pressed="${group.chosen?.index===index}" ${group.pendingCare?'disabled':''}>${group.chosen?.index===index?t('removePlan'):t('addPlan')}</button></div>
  </article>`).join('')}</div>`;
}
function renderResults(focus){
  resultStatus='';
  const target=$('results');
  const dates=visitDates();
  if(!dates.includes(state.resultDate)) state.resultDate=dates[0];
  const date=state.resultDate;
  const groups={am:resultGroups(date,'am'),pm:resultGroups(date,'pm')};
  const slots=Object.entries(periods).map(([key,period])=>`<section class="plan-slot">
    <h4>${t(key)} <small>${timeRange(period.start,period.end)}</small></h4>
    ${groups[key].map(g=>`<div class="plan-entry">${groupName(g)}<span>${planEntry(g)}</span></div>`).join('')}
    </section>`).join('');
  const current=groups[state.period];
  const ordered=[...current.filter(g=>g.id==='care'),...current.filter(g=>g.id!=='care')];
  const cards=ordered.map(g=>`<section class="result-group">
    <h4>${groupName(g)}</h4>
    <p>${g.members.map(memberLabel).join(' · ')}</p>
    ${resultCards(g)}
    </section>`).join('');
  target.innerHTML=`<h2 id="results-title" tabindex="-1">${t('results')}</h2>
    <p>${state.place} · ${html(dayText(date))} · ${t('catalogNote')}</p>
    ${dates.length>1?`<label class="plan-date">${t('chooseDay')} <select id="plan-date">${dates.map(d=>`<option value="${d}" ${date===d?'selected':''}>${html(dayText(d))}</option>`).join('')}</select></label>`:''}
    <aside class="mascot-tip mascot-world"><svg viewBox="-56 -90 112 96" aria-hidden="true"><g transform="translate(-22 0)">${bertaArt()}</g><g transform="translate(24 0)">${murmliArt()}</g></svg>
      <p><strong>${t(isWinter(date)?'mascotWinter':'mascotSummer')}</strong> ${t('mascotWorldHint')}
      <a href="${isWinter(date)?'https://www.serfaus-fiss-ladis.at/de/winterurlaub/familienwinter/murmlis-und-bertas-winterwelt':'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/familiensommer/murmlis-und-bertas-bergabenteuer'}" target="_blank" rel="noopener">${t('mascotWorldLink')} ↗</a></p></aside>
    <section class="day-plan" aria-labelledby="day-plan-title">
      <h3 id="day-plan-title">${t('dayPlan')}</h3><p>${t('dayPlanHint')}</p>
      <div class="plan-slots">${slots}</div>
    </section>
    <div class="suggestions"><h3>${t('suggestions')}</h3>${periodPicker()}${cards}</div>`;
  if(focus) target.querySelector(focus)?.focus({preventScroll:true});
}
$('results').addEventListener('change',event=>{
  if(event.target.id!=='plan-date') return;
  state.resultDate=event.target.value;
  renderResults('#plan-date');
});
$('results').addEventListener('input',event=>{
  const form=event.target.form;
  if(form?.id!=='care-form') return;
  const care=resultGroups(state.resultDate,state.period).find(group=>group.id==='care');
  state.care.set(care.key,{...care.hours,draft:{from:form.elements.from.value,to:form.elements.to.value}});
  $('care-error').textContent='';
});
$('results').addEventListener('submit',event=>{
  if(event.target.id!=='care-form') return;
  event.preventDefault();
  const care=resultGroups(state.resultDate,state.period).find(group=>group.id==='care');
  const form=new FormData(event.target);
  const from=form.get('from');
  const to=form.get('to');
  const period=periods[state.period];
  const window={start:Math.max(period.start,toMinutes(from)),end:Math.min(period.end,toMinutes(to))};
  if(window.start>=window.end){
    $('care-error').textContent=t('careInvalid');
    return;
  }
  state.care.set(care.key,{from,to,window});
  renderResults('#care-from');
});
$('results').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  const {period,pick,teamPick}=button.dataset;
  if(period) return changePeriod(period,button);
  if(button.hasAttribute('data-clear-care')){
    const care=resultGroups(state.resultDate,state.period).find(group=>group.id==='care');
    state.care.delete(care.key);
    renderResults('#care-from');
    return;
  }
  if(pick===undefined) return;
  const group=resultGroups(state.resultDate,state.period).find(g=>String(g.id)===teamPick);
  if(!group||group.pendingCare||!group.candidates.some(item=>item.index===Number(pick))) return;
  if(group.chosen?.index===Number(pick)) state.plan.delete(group.key);
  else state.plan.set(group.key,Number(pick));
  renderResults(`[data-team-pick="${teamPick}"][data-pick="${pick}"]`);
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
renderLanguage();
