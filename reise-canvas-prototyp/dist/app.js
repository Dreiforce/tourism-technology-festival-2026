const $=id=>document.getElementById(id);
const steps=['family','place','dates','wishes','groups','done'];
const groupStep=steps.indexOf('groups');
const finalStep=steps.length-1;
const journey=$('journey');
const state={step:0,visited:0,place:'Serfaus',start:'',end:'',family:[],general:new Set(),
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
  return {place:state.place,family:state.family,date:stamp(),general:state.general,groups,periodLabel};
}
function draw(added,move=false){
  const board=$('board');
  const old=move&&!reduced.matches?new Map([...board.querySelectorAll('[data-member]')].map(el=>[
    el.dataset.member,getComputedStyle(el).transform
  ])):null;
  const interactive=state.step===0;
  board.innerHTML=poster({...posterData(),id:'board-art',interactive});
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
  $('steps').innerHTML=steps.map((label,i)=>`<button type="button" data-go="${i}" ${i===state.step?'aria-current="step"':''} ${i>state.visited?'disabled':''}><b>0${i+1}</b>${t(label)}</button>`).join('');
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
      `<div class="options"><button class="small" type="button" data-add="adult" ${count>=10?'disabled':''}>+ ${t('adult')}</button><button class="small" type="button" data-add="child" ${count>=10?'disabled':''}>+ ${t('child')}</button><button class="small" type="button" data-add="grandparent" ${count>=10?'disabled':''}>+ ${t('grandparent')}</button><button class="small" type="button" data-add="dog" ${count>=10?'disabled':''}>+ ${t('dog')}</button></div>`;
  }else if(index===1){
    content=header(t('placeHeading'),t('placeHint'))+
      `<div class="options">${Object.keys(towns).map(town=>`<button type="button" class="place" data-place="${town}" aria-pressed="${town===state.place}"><strong>${town}</strong><small>${t('motif'+town)}</small></button>`).join('')}</div>`;
  }else if(index===2){
    content=header(t('datesHeading'),t('datesHint'))+
      `<div class="date-fields"><label>${t('dateFrom')}<input id="date-start" type="date" value="${state.start}" aria-describedby="date-error"></label><label>${t('dateTo')}<input id="date-end" type="date" value="${state.end}" aria-describedby="date-error"></label></div><p id="date-error" role="alert"></p>`;
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
      `<div class="summary-actions"><button class="small" type="button" id="export">${t('export')}</button><button class="primary" type="button" id="search">${t('find')} <span aria-hidden="true">↓</span></button></div><p id="export-status" role="status"></p>`;
  }
  const disabled=index===0&&!state.family.some(p=>p.kind==='adult');
  $('controls').innerHTML=content+`<div class="control-bottom">${index?`<button type="button" class="small" data-back>← ${t('back')}</button>`:''}${index<finalStep?`<button type="button" class="primary" data-next ${disabled?'disabled':''}>${t('next')} <span aria-hidden="true">→</span></button>`:''}</div>`;
  if(index===2){
    syncDateFields();
    if(dateError) $('date-error').textContent=t(dateError);
  }
  if(index===finalStep&&exportStatus) $('export-status').textContent=t(exportStatus);
}
function render(added,focus=false){
  draw(added);
  renderSteps();
  renderControls();
  if(focus) $('prompt').focus({preventScroll:true});
}
function start(){
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
  state.step=index;
  state.visited=Math.max(state.visited,index);
  $('experience').classList.remove('show-results');
  $('results').hidden=true;
  render(undefined,true);
}
$('steps').addEventListener('click',event=>{
  const button=event.target.closest('[data-go]');
  if(button) go(Number(button.dataset.go));
});
function dialog(kind,p){
  pending={kind,p};
  $('choice').returnValue='';
  $('choice-title').textContent=t(kind==='age'?'ageHeading':'removeHeading');
  $('choice-content').innerHTML=kind==='age'
    ? `<label>${t('age')}<select id="child-age" required><option value="">${t('chooseAge')}</option>${Array.from({length:18},(_,age)=>`<option value="${age}">${ageText({age})}</option>`).join('')}</select></label>`
    : `<p>${t('removeDescription',html(avatarName(p))+(p.kind!=='dog'&&p.age!=null?' · '+ageText(p):''))}</p>`;
  $('choice-confirm').textContent=t(kind==='age'?'addChild':'remove');
  $('choice').showModal();
  if(kind==='age') $('child-age').focus();
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
  if(action.kind==='age') return add('child',Number($('child-age').value));
  state.family=state.family.filter(p=>p!==action.p);
  const figure=$('board').querySelector(`[data-figure="${action.p.id}"]`);
  if(figure&&!reduced.matches){
    figure.classList.add('avatar-leave');
    await new Promise(resolve=>setTimeout(resolve,215));
  }
  if(!figure?.isConnected||state.step!==0) return;
  render();
  $('controls').querySelector(`[data-add="${action.p.kind}"]`)?.focus();
  $('announcement').textContent=t('avatarRemoved',avatarName(action.p));
});
function requestRemoval(event){
  if(state.step!==0) return;
  const mark=event.target.closest('[data-avatar]');
  const p=mark&&state.family.find(item=>item.id===Number(mark.dataset.avatar));
  if(!p||$('choice').open||$('editor').open) return;
  if(p.kind==='dog') dialog('remove',p);else openEditor(p);
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
  svg.append(el);
  drag={p,el,svg,start:svgPoint(svg,event),base:el.getAttribute('transform')};
  el.classList.add('dragging');
  $('board').setPointerCapture(event.pointerId);
});
$('board').addEventListener('pointermove',event=>{
  if(!drag) return;
  const pt=svgPoint(drag.svg,event);
  drag.el.setAttribute('transform',`translate(${pt.x-drag.start.x} ${pt.y-drag.start.y}) ${drag.base}`);
  const team=teamAt(drag.svg,pt.x);
  for(const g of drag.svg.querySelectorAll('[data-team]')) g.classList.toggle('drop-target',g===team);
});
$('board').addEventListener('pointerup',event=>{
  if(!drag) return;
  const {p,svg}=drag;
  drag=null;
  moveToGroup(p,teamAt(svg,svgPoint(svg,event).x)?.dataset.team);
});
$('board').addEventListener('pointercancel',()=>{if(drag){drag=null;draw()}});
$('board').addEventListener('keydown',event=>{
  if(!['Enter',' '].includes(event.key)||!event.target.closest('[data-avatar]')) return;
  event.preventDefault();requestRemoval(event);
});
$('controls').addEventListener('click',event=>{
  const target=event.target.closest('button');
  if(!target) return;
  const {add:kind,place,wish,person,period,mode}=target.dataset;
  if(kind==='child') dialog('age');
  else if(kind==='grandparent') add('adult',70,kind);
  else if(kind) add(kind);
  else if(place){
    state.place=place;draw();
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
  }else if(event.target.id==='date-end') state.end=event.target.value;
  else return;
  dateError='';
  $('date-error').textContent='';
  draw();
});
// Optional character editor, opened by tapping a figure. A birth date (if given) sets age and adult/child.
let editing=null, hairTouched=false;
const genderHair={m:2,w:3,d:1};
function pick(name,count,item,current){
  return `<div class="pick">${Array.from({length:count},(_,i)=>`<label><input type="radio" name="${name}" value="${i}" ${i===current?'checked':''} aria-label="${t(name)} ${i+1}"><span>${item(i)}</span></label>`).join('')}</div>`;
}
function openEditor(p){
  editing=p;
  hairTouched=p.hair!=null;
  const v={name:'',birth:'',gender:'',...p,...lookOf(p)};
  const field=(key,body)=>`<fieldset><legend>${t(key)}</legend>${body}</fieldset>`;
  $('editor-title').textContent=t('editorEdit');
  $('editor-fields').innerHTML=
    `<label>${t('name')}<input name="name" type="text" maxlength="20" autocomplete="off" value="${html(v.name)}"></label>
    <div class="editor-age"><label>${t('birth')}<input name="birth" type="date" min="1900-01-01" max="${todayDate()}" value="${v.birth}"></label>
    <label>${t('age')}<input name="age" type="number" min="0" max="120" inputmode="numeric" value="${v.age??''}"></label></div>`+
    field('gender',`<div class="pick">${['m','w','d'].map(g=>`<label><input type="radio" name="gender" value="${g}" ${v.gender===g?'checked':''}><span><b>${g.toUpperCase()}</b> ${t('gender'+g.toUpperCase())}</span></label>`).join('')}</div>`)+
    field('interests',`<div class="pick">${Object.keys(choices).map(key=>`<label><input type="checkbox" name="wish" value="${key}" ${v.wishes.has(key)?'checked':''}><span><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="${choices[key].path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${t(key)}</span></label>`).join('')}</div>`)+
    field('skin',pick('skin',tones.length,i=>`<i class="dot" style="--c:${tones[i]}"></i>`,v.skin))+
    field('hair',pick('hair',hairShapes.length,i=>`<svg viewBox="-25 -27 50 50" aria-hidden="true"><circle r="19" style="fill:var(--skin)"/><path d="${hairShapes[i]}" style="fill:var(--hair)"/></svg>`,v.hair))+
    field('hairColor',pick('hairColor',hairColors.length,i=>`<i class="dot" style="--c:${hairColors[i]}"></i>`,v.hairColor))+
    field('shirt',pick('shirt',palette.length,i=>`<i class="dot" style="--c:${palette[i]}"></i>`,v.shirt));
  updateEditor();
  $('editor').showModal();
  $('editor-form').elements.name.focus();
}
function readEditor(){
  const f=new FormData($('editor-form'));
  const age=f.get('age');
  return {name:f.get('name').trim(),birth:f.get('birth'),age:age===''?editing.age:Math.min(120,Math.max(0,Math.round(age))),gender:f.get('gender')||'',wishes:new Set(f.getAll('wish')),
    skin:Number(f.get('skin')),hair:Number(f.get('hair')),hairColor:Number(f.get('hairColor')),shirt:Number(f.get('shirt'))};
}
function updateEditor(){
  const p={...editing,...readEditor()};
  applyAge(p);
  p.look=editing.kind===p.kind?editing.look:freeLook(p.kind,editing);
  const figure=avatarFigure(p);
  const h=figure.height+16, w=Math.max(110,h*.8);
  $('editor-fields').style.cssText=`--skin:${tones[p.skin]};--hair:${hairColors[p.hairColor]}`;
  $('editor-preview').innerHTML=`<svg viewBox="${-w/2} ${-figure.height-10} ${w} ${h}" aria-hidden="true">${figure.svg}</svg>
    <output>${p.name?`<strong>${html(p.name)}</strong>`:''}${p.age!=null?ageText(p)+(p.birth?' '+t(validStart()?'ageOnTrip':'ageToday'):'')+' · ':''}${t(avatarStage(p))}</output>`;
}
$('editor-form').addEventListener('input',event=>{
  const {name,value}=event.target;
  const form=$('editor-form').elements;
  if(name==='hair') hairTouched=true;
  // Birth date and age stay in sync: a date fills in the age, typing an age drops the date.
  if(name==='birth'&&value){const p={birth:value};applyAge(p);form.age.value=p.age}
  if(name==='age') form.birth.value='';
  if(name==='gender'&&!hairTouched) form.hair.value=genderHair[value];
  updateEditor();
});
$('editor-cancel').addEventListener('click',()=>$('editor').close());
$('editor-remove').addEventListener('click',()=>{
  $('editor').close();
  dialog('remove',editing);
});
$('editor-form').addEventListener('submit',event=>{
  event.preventDefault();
  const fields=readEditor();
  $('editor').close();
  Object.assign(editing,fields);
  applyAge(editing);
  if(state.family.some(p=>p!==editing&&p.kind===editing.kind&&p.look===editing.look)) editing.look=freeLook(editing.kind,editing);
  render();
  $('board').querySelector(`[data-avatar="${editing.id}"]`)?.focus();
  $('announcement').textContent=t('avatarSaved',avatarName(editing));
});
function showExportStatus(key){
  exportStatus=key;
  const status=$('export-status');
  if(status) status.textContent=t(key);
}
async function exportPNG(){
  showExportStatus('exporting');
  const source=poster({...posterData(),id:'export-art'})
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
  return hint+`<div class="result-grid">${group.candidates.map(({index,activity:a,time,featured,matches})=>`<article class="result${featured?' is-featured':''}">
    ${featured?`<span class="featured-badge"><span aria-hidden="true">✦</span> ${t('featured')}</span>`:''}
    ${isMascotActivity(a)?`<span class="featured-badge mascot-badge">${t('mascotPick')}</span>`:''}
    <small>${timeRange(time.start,time.end)} · ${t(a.category)}${a.adultFocus?' · '+t('ageLimit',a.min):''}</small>
    <strong>${html(activityTitle(a))}</strong><p>${html(activityDescription(a))}</p>
    ${featured?`<p class="featured-reason">${html(featuredReason(matches))}</p>`:''}
    ${a.advanceBooking?`<p><small>${t('advanceBooking')}</small></p>`:''}
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
