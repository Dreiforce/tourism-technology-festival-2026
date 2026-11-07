const $=id=>document.getElementById(id);
const names=['Familie','Ort & Zeit','Wünsche','Überblick'];
const wishes=['Abenteuer','Wasser','Spielen','Entdecken','Ruhig angehen'];
const support=['Kinderwagen','Stufenloser Zugang','Rollstuhlgerechtes WC'];
const towns=['Serfaus','Fiss','Ladis'];
const colors=['#f0b83d','#78a9b9','#d9775c','#83a888','#a38bb6'];
const skin=['#d79e72','#9e644a','#efba8d','#bd8262'];
let id=0, step=0, visited=0;
const person=(kind,age=0)=>({id:++id,kind,age,wishes:new Set()});
let family=[person('adult'),person('adult'),person('child',5),person('child',12)];
const trip={town:'Serfaus',start:'',end:'',support:new Set()};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const avatars=new Map();
function lifeStage(p){
  if(p.kind!=='child') return p.kind;
  if(p.age<=2) return 'baby';
  if(p.age<=6) return 'little';
  if(p.age<=11) return 'kid';
  return 'teen';
}
const stageNames={baby:'Baby',little:'Kleinkind',kid:'Schulkind',teen:'Teenager',adult:'Erwachsen',dog:'Hund'};
function personName(p){
  const n=family.filter(item=>item.kind===p.kind).indexOf(p)+1;
  return p.kind==='child'?'Kind '+n:p.kind==='adult'?'Begleitperson '+n:'Hund '+n;
}
function familyCount(){
  return [['adult','Erwachsene','Erwachsene'],['child','Kind','Kinder'],['dog','Hund','Hunde']]
    .flatMap(([kind,one,many])=>{
      const count=family.filter(p=>p.kind===kind).length;
      return count?[`${count} ${count===1?one:many}`]:[];
    }).join(' · ');
}
function svg(p){
  const stage=lifeStage(p);
  const shirt=colors[p.id%colors.length];
  const face=skin[p.id%skin.length];
  const ink='#173757';
  const base='<svg viewBox="0 0 70 105" xmlns="http://www.w3.org/2000/svg">';
  const shadow='<ellipse cx="35" cy="101" rx="21" ry="3" fill="#476b7c" opacity=".17"/>';
  if(stage==='dog') return base+shadow+`<path d="M19 86q-11 3-10-9" fill="none" stroke="#79543d" stroke-width="4" stroke-linecap="round"/><rect x="17" y="77" width="37" height="19" rx="9" fill="#bc8257"/><rect x="20" y="91" width="7" height="10" rx="3" fill="#79543d"/><rect x="45" y="91" width="7" height="10" rx="3" fill="#79543d"/><circle cx="51" cy="77" r="12" fill="#cf996b"/><path d="M43 68q-8 3-5 16l7-2z" fill="#79543d"/><circle cx="56" cy="76" r="1.7" fill="${ink}"/><ellipse cx="61" cy="81" rx="4" ry="2" fill="${ink}"/><path d="M42 87h12" stroke="#174782" stroke-width="3"/></svg>`;
  if(stage==='baby') return base+shadow+`<ellipse cx="35" cy="84" rx="19" ry="17" fill="${shirt}"/><path d="m21 80 24 16m4-16-23 14" stroke="#fff8df" stroke-width="2.5" opacity=".55"/><circle cx="35" cy="70" r="13" fill="${face}"/><path d="M31 60q-1-6 6-5 4 2 1 5" fill="none" stroke="#543c31" stroke-width="2" stroke-linecap="round"/><path d="M29 70q2 2 4 0m4 0q2 2 4 0" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/><circle cx="35" cy="75" r="2" fill="#f7cc54"/></svg>`;
  const [head,body,half,r]=({adult:[24,41,15,13],teen:[33,48,13,12],kid:[44,58,12,11],little:[53,65,10,11]})[stage];
  const hem=body+Math.round((99-body)*.61);
  return base+shadow+`
    <path d="M${35-half+5} ${hem-2}L${35-half+4} 96 M${35+half-5} ${hem-2}L${35+half-4} 96" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>
    <path d="M${35-half} ${body+8}l-6 ${Math.round((99-body)*.34)} M${35+half} ${body+8}l6 ${Math.round((99-body)*.34)}" stroke="${face}" stroke-width="6" stroke-linecap="round"/>
    <path d="M${35-half} ${body+5}Q35 ${body-8} ${35+half} ${body+5}l2 ${hem-body-5}h-${2*half+4}z" fill="${shirt}"/>
    <path d="M32 ${body-1}q3 4 6 0" stroke="#fff8df" stroke-width="2" fill="none"/>
    <circle cx="35" cy="${head}" r="${r}" fill="${face}"/>
    <path d="M${34-r} ${head+1}q-3-${r+5} ${r+2}-${r+5}q${r+4} 0 ${r-2} ${r+4}q-3-2-5-7q-5 4-11 3z" fill="#4e3a33"/>
    <circle cx="31" cy="${head+1}" r="1.25" fill="${ink}"/><circle cx="39" cy="${head+1}" r="1.25" fill="${ink}"/>
    <path d="M33 ${head+6}q2 2 4 0" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}
function paintAvatar(p,node){
  const stage=lifeStage(p);
  const previous=node.dataset.stage;
  if(stage!==previous){
    node.dataset.stage=stage;
    node.innerHTML=svg(p)+'<small></small>';
    if(previous&&!reduced.matches) node.animate([{transform:'scale(.72)',opacity:.55},{transform:'scale(1)',opacity:1}],{duration:240,easing:'ease-out'});
  }
  node.querySelector('small').textContent=p.kind==='child'?p.age+' J.':stageNames[stage];
}
function syncAvatars(){
  for(const [key,node] of avatars){
    if(family.some(p=>p.id===key)) continue;
    avatars.delete(key);
    if(reduced.matches){node.remove();continue}
    node.classList.add('removing');
    node.addEventListener('animationend',()=>node.remove(),{once:true});
    setTimeout(()=>node.remove(),280);
  }
  for(const p of family){
    let node=avatars.get(p.id);
    if(!node){
      node=document.createElement('div');
      node.className='avatar';
      avatars.set(p.id,node);
      $('avatars').append(node);
    }
    paintAvatar(p,node);
  }
  $('window-count').textContent=familyCount();
}
function heading(title,desc){
  return `<p class="step-number">Schritt ${step+1} von 4</p><h1 id="screen-title" tabindex="-1">${title}</h1><p class="description">${desc}</p>`;
}
function familyScreen(){
  const list=family.map(p=>{
    const name=personName(p);
    const select=p.kind==='child'?`<select data-age="${p.id}" aria-label="Alter von ${name}">${Array.from({length:18},(_,age)=>
      `<option value="${age}" ${age===p.age?'selected':''}>${age} ${age===1?'Jahr':'Jahre'}</option>`).join('')}</select>`:'<span></span>';
    const onlyAdult=p.kind==='adult'&&family.filter(person=>person.kind==='adult').length===1;
    return `<div class="person-row"><div><strong>${name}</strong><span data-stage="${p.id}">${stageNames[lifeStage(p)]}</span></div>${select}<button class="remove" type="button" data-remove="${p.id}" aria-label="${name} entfernen" ${onlyAdult?'disabled':''}>×</button></div>`;
  }).join('');
  $('screen').innerHTML=heading('Wer kommt mit?','Stellt eure Gruppe zusammen. Eure Figuren erscheinen im Familienfenster.')+
    `<div class="person-list">${list}</div><div class="add-actions">
    <button type="button" class="secondary" data-add="adult">+ Erwachsene Person</button>
    <button type="button" class="secondary" data-add="child">+ Kind</button>
    <button type="button" class="secondary" data-add="dog">+ Hund</button></div>`;
}
function timeScreen(){
  $('screen').innerHTML=heading('Wann und wohin?','Wählt den Ort, von dem ihr losgeht. Den Zeitraum könnt ihr auch später ergänzen.')+`
    <div class="fields"><label>Startort<select id="town">${towns.map(town=>`<option ${town===trip.town?'selected':''}>${town}</option>`).join('')}</select></label>
    <div class="date-row"><label>Von<input id="from" type="date" value="${trip.start}"></label><label>Bis<input id="to" type="date" value="${trip.end}" ${trip.start?'min="'+trip.start+'"':''}></label></div></div>
    <p class="hint">Für einen Tagesausflug reicht das Startdatum.</p><p role="alert" id="date-error" class="hint"></p>`;
}
function choices(items,selected,attribute){
  return `<div class="chips">${items.map(label=>`<label><input type="checkbox" ${attribute} value="${label}" ${selected.has(label)?'checked':''}> ${label}</label>`).join('')}</div>`;
}
function wishesScreen(){
  const children=family.filter(p=>p.kind==='child');
  $('screen').innerHTML=heading('Was macht euch Spaß?','Die Wünsche lassen sich für jedes Kind einzeln auswählen. Alles hier ist optional.')+
    children.map(p=>`<fieldset class="choice-group"><legend>${personName(p)} · ${p.age} J.</legend>${choices(wishes,p.wishes,`data-wish="${p.id}"`)}</fieldset>`).join('')+
    `<fieldset class="choice-group"><legend>Was braucht ihr unterwegs?</legend>${choices(support,trip.support,'data-support')}</fieldset>`;
}
function reviewScreen(){
  const childWishes=family.filter(p=>p.kind==='child'&&p.wishes.size).map(p=>`${personName(p)}: ${[...p.wishes].join(', ')}`);
  const pretty=date=>new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  const date=trip.start?pretty(trip.start)+(trip.end&&trip.end!==trip.start?' bis '+pretty(trip.end):''):'Datum offen';
  $('screen').innerHTML=heading('Eure Auswahl', 'So könnte der Einstieg in den Familienplaner aussehen.')+
    `<dl class="review"><div><dt>Familie</dt><dd>${familyCount()}</dd></div>
    <div><dt>Ort und Zeit</dt><dd>${trip.town} · ${date}</dd></div>
    <div><dt>Wünsche</dt><dd>${childWishes.join(' · ')||'Offen'}</dd></div>
    <div><dt>Unterwegs</dt><dd>${[...trip.support].join(', ')||'Keine Angabe'}</dd></div></dl>
    <p class="hint">Der Prototyp endet hier mit der Zusammenfassung.</p>`;
}
function render(focus=false){
  [familyScreen,timeScreen,wishesScreen,reviewScreen][step]();
  $('steps').innerHTML=names.map((name,i)=>`<li><button type="button" data-step="${i}" ${i===step?'aria-current="step"':i<step?'class="done"':''} ${i>visited?'disabled':''}><span>${i+1}</span>${name}</button></li>`).join('');
  $('back').hidden=step===0;
  $('next').hidden=step===3;
  $('next').innerHTML=step===2?'Zur Übersicht <span aria-hidden="true">→</span>':'Weiter <span aria-hidden="true">→</span>';
  syncAvatars();
  if(focus) $('screen-title').focus();
}
function go(next){
  if(next>step&&step===1&&trip.end&&(!trip.start||trip.end<trip.start)){
    $('date-error').textContent='Bitte wählt ein Startdatum und ein Enddatum, das danach liegt.';
    $('from').focus();
    return;
  }
  step=next;visited=Math.max(step,visited);render(true);
}
$('next').addEventListener('click',()=>go(Math.min(3,step+1)));
$('back').addEventListener('click',()=>go(Math.max(0,step-1)));
$('steps').addEventListener('click',event=>{
  const button=event.target.closest('[data-step]');
  if(button) go(Number(button.dataset.step));
});
$('screen').addEventListener('click',event=>{
  const add=event.target.closest('[data-add]');
  const remove=event.target.closest('[data-remove]');
  if(add){
    const p=person(add.dataset.add);
    family.push(p);
    render();
    const target=p.kind==='child'?document.querySelector(`[data-age="${p.id}"]`):document.querySelector(`[data-add="${p.kind}"]`);
    target?.focus();
    $('announcement').textContent=stageNames[lifeStage(p)]+' hinzugefügt. '+familyCount();
  }
  if(remove){
    const p=family.find(item=>item.id===Number(remove.dataset.remove));
    if(!p||remove.disabled) return;
    family=family.filter(item=>item!==p);
    render();
    document.querySelector(`[data-add="${p.kind}"]`)?.focus();
    $('announcement').textContent='Person oder Hund entfernt. '+familyCount();
  }
});
$('screen').addEventListener('change',event=>{
  const input=event.target;
  if(input.dataset.age){
    const p=family.find(item=>item.id===Number(input.dataset.age));
    p.age=Number(input.value);
    document.querySelector(`[data-stage="${p.id}"]`).textContent=stageNames[lifeStage(p)];
    syncAvatars();
  }
  if(input.id==='town') trip.town=input.value;
  if(input.id==='from'){trip.start=input.value;$('to').min=trip.start}
  if(input.id==='to') trip.end=input.value;
  if(input.dataset.wish){
    const p=family.find(item=>item.id===Number(input.dataset.wish));
    if(input.checked) p.wishes.add(input.value);else p.wishes.delete(input.value);
  }
  if(input.hasAttribute('data-support')){
    if(input.checked) trip.support.add(input.value);else trip.support.delete(input.value);
  }
});
render();
