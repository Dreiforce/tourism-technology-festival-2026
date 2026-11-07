// Mii-style character editor, opened by tapping a figure on the postcard.
// Tabs on top, live preview on the left (zooms to the face for face tabs), part grids and adjust pads on the right.
const miiTabs=['profile','body','face','hair','brows','eyes','nose','mouth','extras'];
const faceTabs=new Set(miiTabs.slice(2));
const tabIcons={
  profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/>',
  body:'<circle cx="12" cy="4" r="2.5"/><path d="M12 7v8M7 10h10M12 15l-3 7M12 15l3 7"/>',
  face:'<ellipse cx="12" cy="12" rx="8" ry="9"/><path d="M9 15q3 2 6 0"/>',
  hair:'<path d="M4 15C3 6 8 3 12 3s9 3 8 12c-2-5-5-6-8-6s-6 1-8 6Z"/>',
  brows:'<path d="M3 12q4-4 8-1M13 11q4-3 8 1"/>',
  eyes:'<ellipse cx="7" cy="12" rx="3" ry="3.5"/><ellipse cx="17" cy="12" rx="3" ry="3.5"/>',
  nose:'<path d="M13 4q-5 9-2 12 2 1 4 0"/>',
  mouth:'<path d="M5 10q7 9 14 0Z"/>',
  extras:'<circle cx="7" cy="13" r="4"/><circle cx="17" cy="13" r="4"/><path d="M11 13h2"/>'
};
const adjustSteps={y:['moveUp','moveDown','↑','↓',-1,1,[-5,5]],size:['smaller','bigger','−','+',-1,1,[-4,4]],
  rot:['rotateLeft','rotateRight','↺','↻',-1,1,[-4,4]],space:['closer','wider','→←','←→',-1,1,[-3,4]]};
const genderHair={m:2,w:3,d:1};
const needKeys=['wheelchair','stroller','walker','vision','hearing'];
const needIcons={
  wheelchair:'<circle cx="11" cy="16" r="5"/><circle cx="9" cy="4" r="2"/><path d="M9 7v6h6l3 5M9 10h5"/>',
  stroller:'<path d="M4 7h13a6.5 6.5 0 0 1-13 0Z"/><path d="M4 7a7 7 0 0 1 7-5v5M17 7l2-3h2"/><circle cx="7" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>',
  walker:'<path d="M7 4v16M17 4v16M7 11h10M5 4h4M15 4h4"/>',
  vision:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><path d="M4 20 20 4"/>',
  hearing:'<path d="M8 10a5 5 0 0 1 10 0c0 4-4 5-4 8a3 3 0 0 1-6 0"/><path d="M4 4l16 16"/>'
};
let editing=null, draft=null, miiTab='profile', hairTouched=false, stageBox=null, stageAnim=0;

const getPath=path=>path.split('.').reduce((o,k)=>o?.[k],draft);
function setPath(path,value){
  const keys=path.split('.'), last=keys.pop();
  keys.reduce((o,k)=>o[k],draft)[last]=value;
}
function draftPerson(){
  const p={...draft};
  applyAge(p);
  p.look=editing.kind===p.kind?editing.look:freeLook(p.kind,editing);
  return p;
}
function openEditor(p){
  editing=p;
  hairTouched=p.hair!=null;
  draft=structuredClone({name:'',birth:'',gender:'',pants:null,hairFlip:false,...p,...lookOf(p)});
  draft.face=faceOf(p);
  draft.needs=new Set(p.needs||[]);
  draft.body={height:0,weight:0,...p.body};
  miiTab='profile';
  stageBox=null;
  $('editor-title').textContent=t('editorEdit');
  $('editor-preview').innerHTML='<svg id="mii-svg" aria-hidden="true"></svg><output id="mii-label"></output>';
  renderTabs();
  renderPanel();
  updatePreview();
  $('editor').showModal();
  $('editor-form').elements.name.focus();
}
function renderTabs(){
  $('mii-tabs').innerHTML=miiTabs.map(tab=>`<button type="button" role="tab" data-tab="${tab}" aria-selected="${tab===miiTab}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${tabIcons[tab]}</svg><span>${t('tab'+tab)}</span></button>`).join('');
}
// Option grids show the whole head with that option applied, so you see the result before choosing.
function variant(path,value){
  const copy=structuredClone(draft);
  const keys=path.split('.'), last=keys.pop();
  keys.reduce((o,k)=>o[k],copy)[last]=value;
  applyAge(copy);
  copy.look=draftPerson().look;
  return copy;
}
function renderPanel(){
  const pressed=(path,value)=>`aria-pressed="${getPath(path)===value}"`;
  const grid=(path,count)=>`<div class="part-grid">${Array.from({length:count},(_,i)=>
    `<button type="button" class="part" data-set="${path}" data-value="${i}" ${pressed(path,i)} aria-label="${t('option',i+1)}">${headSvg(variant(path,i))}</button>`).join('')}</div>`;
  const swatches=(path,colors)=>`<div class="swatches">${colors.map((c,i)=>
    `<button type="button" class="swatch" data-set="${path}" data-value="${i}" ${pressed(path,i)} aria-label="${t('colourN',i+1)}" style="--c:${c}"></button>`).join('')}</div>`;
  const toggle=(path,key)=>`<button type="button" class="chip" data-toggle="${path}" aria-pressed="${Boolean(getPath(path))}">${t(key)}</button>`;
  const pad=(path,keys)=>`<div class="adjust">${keys.map(k=>{
    const [less,more,iconLess,iconMore]=adjustSteps[k];
    return `<button type="button" class="adj" data-adjust="${path}.${k}" data-step="-1" aria-label="${t(less)}" title="${t(less)}">${iconLess}</button><button type="button" class="adj" data-adjust="${path}.${k}" data-step="1" aria-label="${t(more)}" title="${t(more)}">${iconMore}</button>`;
  }).join('')}</div>`;
  const section=(key,body)=>`<section class="mii-section"><h3>${t(key)}</h3>${body}</section>`;
  const slider=(path,key,lowIcon,highIcon)=>`<label class="mii-slider"><span>${t(key)}</span><span class="slider-row"><b aria-hidden="true">${lowIcon}</b><input type="range" min="-5" max="5" step="1" data-field="${path}" value="${getPath(path)}"><b aria-hidden="true">${highIcon}</b></span></label>`;
  const panels={
    profile:()=>`<label>${t('name')}<input name="name" data-field="name" type="text" maxlength="20" autocomplete="off" value="${html(draft.name)}"></label>
      <div class="editor-age"><label>${t('birth')}<input name="birth" data-field="birth" type="date" min="1900-01-01" max="${todayDate()}" value="${draft.birth||''}"></label>
      <label>${t('age')}<input name="age" data-field="age" type="number" min="0" max="120" inputmode="numeric" value="${draft.age??''}"></label></div>`+
      section('gender',`<div class="chips">${['m','w','d'].map(g=>`<button type="button" class="chip" data-set="gender" data-value="${g}" ${pressed('gender',g)}><b>${g.toUpperCase()}</b> ${t('gender'+g.toUpperCase())}</button>`).join('')}</div>`)+
      section('needs',`<div class="chips">${(draftPerson().kind==='child'?needKeys:needKeys.filter(k=>k!=='stroller')).map(k=>
        `<button type="button" class="chip" data-need="${k}" aria-pressed="${draft.needs.has(k)}"><svg viewBox="0 0 24 24" aria-hidden="true" class="need-icon">${needIcons[k]}</svg>${t('need_'+k)}</button>`).join('')}</div>`)+
      section('interests',`<div class="chips">${Object.keys(choices).map(key=>`<button type="button" class="chip" data-wish="${key}" aria-pressed="${draft.wishes.has(key)}"><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="${choices[key].path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${t(key)}</button>`).join('')}</div>`),
    body:()=>section('height',slider('body.height','height','▁','█'))+section('build',slider('body.weight','build','❙','█'))+
      section('shirt',swatches('shirt',palette))+section('pants',swatches('pants',pantsColors)),
    face:()=>section('faceShape',grid('face.shape',faceShapes.length))+section('skin',swatches('skin',tones))+
      section('details',`<div class="chips">${toggle('face.blush','blush')}${toggle('face.freckles','freckles')}${toggle('face.mole','mole')}</div>`),
    hair:()=>section('hair',grid('hair',hairStyles.length))+section('hairColor',swatches('hairColor',hairColors))+
      `<div class="chips">${toggle('hairFlip','flipHair')}</div>`,
    brows:()=>section('style',grid('face.brows.style',browStyles.length))+section('colour',swatches('face.brows.color',hairColors))+section('position',pad('face.brows',['y','size','rot','space'])),
    eyes:()=>section('style',grid('face.eyes.style',eyeStyles.length))+section('colour',swatches('face.eyes.color',eyeColors))+section('position',pad('face.eyes',['y','size','rot','space'])),
    nose:()=>section('style',grid('face.nose.style',noseStyles.length))+section('position',pad('face.nose',['y','size'])),
    mouth:()=>section('style',grid('face.mouth.style',mouthStyles.length))+section('colour',swatches('face.mouth.color',lipColors))+section('position',pad('face.mouth',['y','size'])),
    extras:()=>section('glasses',grid('face.glasses.style',glassStyles.length))+section('colour',swatches('face.glasses.color',glassColors))+section('beard',grid('face.beard',beardStyles.length))
  };
  const panel=$('editor-fields');
  const focus=signature(document.activeElement);
  panel.innerHTML=panels[miiTab]();
  if(focus) [...panel.querySelectorAll('button,input')].find(el=>signature(el)===focus)?.focus({preventScroll:true});
}
const signature=el=>el?.closest?.('#editor-fields')&&['set','value','toggle','adjust','step','wish','field'].map(k=>el.dataset[k]??'').join('|');
function updatePreview(pop=false){
  const p=draftPerson();
  const figure=avatarFigure(p);
  const r=figure.headR;
  const zoom=faceTabs.has(miiTab)&&r;
  const h=figure.height+18, w=Math.max(120,h*.8);
  const box=zoom?[-2.1*r,figure.headY-2.2*r,4.2*r,4.4*r]:[-w/2,-figure.height-12,w,h];
  const svg=$('mii-svg');
  svg.innerHTML=`<ellipse cx="0" cy="3" rx="48" ry="8" fill="#173443" opacity=".12"/><g class="mii-idle${pop?' mii-pop':''}">${figure.svg}</g>`;
  animateBox(svg,box);
  $('mii-label').innerHTML=`${p.name?`<strong>${html(p.name)}</strong>`:''}${p.age!=null?ageText(p)+' · ':''}${t(avatarStage(p))}`;
}
function animateBox(svg,to){
  const from=stageBox||to;
  stageBox=to;
  cancelAnimationFrame(stageAnim);
  const set=box=>svg.setAttribute('viewBox',box.map(n=>n.toFixed(1)).join(' '));
  if(reduced.matches||from.every((n,i)=>n===to[i])) return set(to);
  const start=performance.now();
  const step=now=>{
    const k=Math.min(1,(now-start)/320), e=1-Math.pow(1-k,3);
    set(from.map((n,i)=>n+(to[i]-n)*e));
    if(k<1) stageAnim=requestAnimationFrame(step);
  };
  stageAnim=requestAnimationFrame(step);
}
function randomize(){
  const r=n=>Math.floor(Math.random()*n), chance=n=>Math.random()<n;
  const adjust=()=>({y:r(5)-2,size:r(5)-2,rot:r(3)-1,space:r(3)-1});
  Object.assign(draft,{skin:r(tones.length),hair:r(hairStyles.length),hairColor:r(hairColors.length),shirt:r(palette.length),
    pants:r(pantsColors.length),hairFlip:chance(.5),body:{height:r(7)-3,weight:r(7)-3}});
  draft.face={shape:r(faceShapes.length),brows:{style:1+r(browStyles.length-1),color:null,...adjust()},
    eyes:{style:r(eyeStyles.length),color:r(eyeColors.length),...adjust()},nose:{style:r(noseStyles.length),y:r(3)-1,size:r(3)-1},
    mouth:{style:r(mouthStyles.length),color:r(lipColors.length),y:r(3)-1,size:r(3)-1},
    glasses:{style:chance(.3)?1+r(glassStyles.length-1):0,color:r(glassColors.length)},
    beard:draftPerson().kind==='adult'&&chance(.3)?1+r(beardStyles.length-1):0,mole:chance(.15),blush:chance(.4),freckles:chance(.2)};
  hairTouched=true;
}
function changed(){
  renderPanel();
  updatePreview(true);
}
$('mii-tabs').addEventListener('click',event=>{
  const tab=event.target.closest('[data-tab]');
  if(!tab) return;
  miiTab=tab.dataset.tab;
  renderTabs();
  renderPanel();
  updatePreview();
  $('mii-tabs').querySelector(`[data-tab="${miiTab}"]`).focus();
});
$('mii-tabs').addEventListener('keydown',event=>{
  const move={ArrowRight:1,ArrowLeft:-1}[event.key];
  if(!move) return;
  const next=miiTabs[(miiTabs.indexOf(miiTab)+move+miiTabs.length)%miiTabs.length];
  $('mii-tabs').querySelector(`[data-tab="${next}"]`).click();
});
$('editor-fields').addEventListener('click',event=>{
  const el=event.target.closest('button');
  if(!el) return;
  const {set,value,toggle,adjust,step,wish,need}=el.dataset;
  if(set){
    const v=set==='gender'?value:Number(value);
    setPath(set,v);
    if(set==='hair') hairTouched=true;
    if(set==='gender'&&!hairTouched) draft.hair=genderHair[v];
  }else if(toggle) setPath(toggle,!getPath(toggle));
  else if(adjust){
    const [,,,,,, [min,max]]=adjustSteps[adjust.split('.').pop()];
    setPath(adjust,Math.min(max,Math.max(min,getPath(adjust)+Number(step))));
  }else if(need){
    if(draft.needs.has(need)) draft.needs.delete(need);else draft.needs.add(need);
  }else if(wish){
    if(draft.wishes.has(wish)) draft.wishes.delete(wish);else draft.wishes.add(wish);
  }else return;
  changed();
});
$('editor-fields').addEventListener('input',event=>{
  const {field}=event.target.dataset;
  const {value}=event.target;
  if(!field) return;
  if(field==='name') draft.name=value;
  // Birth date and age stay in sync: a date fills in the age, typing an age drops the date.
  else if(field==='birth'){
    draft.birth=value;
    if(value){applyAge(draft);$('editor-form').elements.age.value=draft.age}
  }else if(field==='age'){
    draft.age=value===''?editing.age:Math.min(120,Math.max(0,Math.round(value)));
    draft.birth='';
    $('editor-form').elements.birth.value='';
  }else setPath(field,Number(value));
  updatePreview();
});
$('editor-random').addEventListener('click',()=>{randomize();changed()});
$('editor-cancel').addEventListener('click',()=>$('editor').close());
$('editor-remove').addEventListener('click',()=>{
  $('editor').close();
  dialog('remove',editing);
});
$('editor-form').addEventListener('submit',event=>{
  event.preventDefault();
  $('editor').close();
  const {name,birth,age,gender,wishes,needs,skin,hair,hairColor,shirt,pants,hairFlip,face,body}=draft;
  Object.assign(editing,{name:name.trim(),birth,age,gender,wishes,needs,skin,hair,hairColor,shirt,pants,hairFlip,face,body});
  applyAge(editing);
  if(state.family.some(p=>p!==editing&&p.kind===editing.kind&&p.look===editing.look)) editing.look=freeLook(editing.kind,editing);
  render();
  if(!$('results').hidden&&catalog) renderResults();
  $('board').querySelector(`[data-avatar="${editing.id}"]`)?.focus();
  $('announcement').textContent=t('avatarSaved',avatarName(editing));
});
