import {accessOptions,accessStatuses} from './accessibility.js';
import {guestCards} from './guest-cards.js';
import {meetingPoints} from './region.js';

const $ = id => document.getElementById(id);
const form = $('editor');
const fields = form.elements;
const endpoint = '/api/admin/experiences';
const numeric = ['min','max','duration','adult','child','childFrom','childTo','youthFrom','dogPrice'];
const strings = ['title','operator','address','category','weather','pets','petNote','description','notes','priceNote','booking','bookingLink','bookingNote','verified','accessNote','accessSource','meeting'];
const weekdays = ['So','Mo','Di','Mi','Do','Fr','Sa'];
fields.meeting.insertAdjacentHTML('beforeend',Object.entries(meetingPoints).map(([key,point])=>`<option value="${key}">${point.name}</option>`).join(''));
const defaults = {category:'Natur',weather:'both',pets:'unknown',booking:'onsite',min:0,max:17,duration:60,adult:0,child:0,childFrom:0,childTo:17,youthFrom:0,dogPrice:0};
let records = [], photos = [], editing = null;
$('access-fields').innerHTML=Object.entries(accessOptions).map(([key,label])=>
  `<label>${label}<select name="access-${key}">${Object.entries(accessStatuses).map(([value,status])=>
    `<option value="${value}">${status}</option>`).join('')}</select></label>`).join('');

function addHours(rule={kind:'regular',days:[0,1,2,3,4,5,6],open:'09:00',close:'17:00'}) {
  const row = document.createElement('div');
  row.className = 'hours-row admin-grid';
  row.innerHTML = `<label>Regel<select data-field="kind"><option value="regular">Regulär / Saison</option><option value="special">Sonderöffnung</option><option value="closed">Geschlossen</option></select></label>
    <label>Gültig ab<input data-field="from" type="date"></label>
    <label>Gültig bis<input data-field="to" type="date"></label>
    <div class="weekdays span-all">${[1,2,3,4,5,6,0].map(day=>`<label><input type="checkbox" value="${day}">${weekdays[day]}</label>`).join('')}</div>
    <label>Öffnet<input data-field="open" type="time"></label><label>Schließt<input data-field="close" type="time"></label>
    <label>Letzter Einlass<input data-field="last" type="time"></label><label class="span-all">Buchungslink für diesen Termin<input data-field="ticketUrl" type="url" maxlength="1000"></label><button type="button" class="add-button">Regel entfernen</button>`;
  const controls = Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el]));
  for (const [key,input] of Object.entries(controls)) input.value = rule[key] || '';
  for (const input of row.querySelectorAll('[type=checkbox]')) input.checked = rule.days.includes(Number(input.value));
  const sync = ()=>{
    for (const key of ['open','close','last','ticketUrl']) controls[key].disabled = controls.kind.value==='closed';
    controls.open.required = controls.close.required = controls.kind.value!=='closed';
    controls.from.required = controls.to.required = controls.kind.value!=='regular';
  };
  controls.kind.addEventListener('change',sync);
  row.querySelector('button').addEventListener('click',()=>row.remove());
  sync();
  $('hours').append(row);
}

function addPass(rule={}){
  const row=document.createElement('div');
  row.className='hours-row admin-grid';
  row.innerHTML=`<label>Gästekarte<select data-pass="card">${Object.entries(guestCards).map(([id,card])=>
    `<option value="${id}">${card.name}</option>`).join('')}</select></label>
    <label>Gültig ab<input data-pass="from" type="date"></label>
    <label>Gültig bis<input data-pass="to" type="date"></label>
    <label class="span-all">Quelle<input data-pass="source" type="url" required maxlength="1000"></label>
    <label class="span-all">Einlösehinweis<input data-pass="note" maxlength="350"></label>
    <button type="button" class="add-button">Regel entfernen</button>`;
  for (const control of row.querySelectorAll('[data-pass]')){
    if (rule[control.dataset.pass]!==undefined) control.value=rule[control.dataset.pass];
  }
  row.querySelector('button').addEventListener('click',()=>row.remove());
  $('pass-rules').append(row);
}
$('add-pass').addEventListener('click',()=>addPass());

function renderPhotos(){
  $('photos').replaceChildren();
  for (const path of photos) {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    img.src = path;
    img.alt = 'Erlebnisfoto';
    const remove = document.createElement('button');
    remove.type='button';
    remove.className='add-button';
    remove.textContent='Foto entfernen';
    remove.addEventListener('click',()=>{photos=photos.filter(photo=>photo!==path);renderPhotos()});
    figure.append(img,remove);
    $('photos').append(figure);
  }
}

function loadEditor(record){
  form.reset();
  for (const key of [...strings,...numeric,'youth']) fields[key].value = record?.[key] ?? defaults[key] ?? '';
  for (const key of Object.keys(accessOptions)) fields['access-'+key].value=record?.accessibility?.[key] || 'unknown';
  const [town,latitude,longitude] = record?.location || ['','',''];
  fields.town.value=town;
  fields.latitude.value=latitude;
  fields.longitude.value=longitude;
  fields.sources.value=record?.sources.join('\n') || '';
  fields.verified.value=record?.verified || new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'}).format(new Date());
  fields.active.checked=record?.active ?? false;
  fields.priceKnown.checked=record?.priceKnown ?? true;
  photos=[...(record?.photos || [])];
  renderPhotos();
  $('hours').replaceChildren();
  $('pass-rules').replaceChildren();
  record?.passes?.forEach(addPass);
  if (record) record.hours.forEach(addHours); else addHours();
  syncBooking();
}

function syncBooking(){
  fields.bookingLink.required = fields.booking.value==='online';
  fields.bookingNote.required = fields.booking.value==='office';
}
fields.booking.addEventListener('change',syncBooking);
$('add-hours').addEventListener('click',()=>addHours());

function searchText(value){
  return value.toLocaleLowerCase('de').normalize('NFD').replace(/\p{Diacritic}/gu,'');
}
function renderOverview(){
  const query=searchText($('catalog-search').value.trim());
  const status=$('catalog-status').value;
  const live=records.filter(record=>record.active).length;
  $('catalog-summary').textContent=`${records.length} Erlebnisse · ${live} veröffentlicht · ${records.length-live} Entwürfe`;
  const matches=records.filter(record=>{
    if(status!=='all' && record.active!==(status==='live')) return false;
    const text=searchText([record.title,record.location[0],record.operator,record.category].join(' '));
    return query.split(/\s+/).every(word=>text.includes(word));
  }).sort((a,b)=>a.title.localeCompare(b.title,'de'));
  $('catalog-matches').textContent=matches.length===0?'Keine passenden Erlebnisse.':matches.length===records.length?'':`${matches.length} passende Erlebnisse`;
  $('catalog-list').replaceChildren(...matches.map(record=>{
    const item=document.createElement('li');
    const detail=document.createElement('div');
    const title=document.createElement('strong');
    title.textContent=record.title;
    const meta=document.createElement('p');
    meta.textContent=[record.location[0],record.category,record.priceKnown===false?'Preis offen':''].filter(Boolean).join(' · ');
    const status=document.createElement('span');
    status.className='admin-badge'+(record.active?' live':'');
    status.textContent=record.active?'Veröffentlicht':'Entwurf';
    const edit=document.createElement('button');
    edit.type='button';
    edit.className='add-button';
    edit.textContent='Bearbeiten';
    edit.setAttribute('aria-label',record.title+' bearbeiten');
    edit.addEventListener('click',()=>openEditor(record));
    detail.append(title,meta);
    item.append(detail,status,edit);
    return item;
  }));
}
function openEditor(record){
  editing=record;
  loadEditor(record);
  $('catalog-overview').hidden=true;
  $('catalog-editor').hidden=false;
  form.hidden=false;
  $('editor-title').textContent=record?.title||'Neues Erlebnis';
  $('status').textContent='';
  $('editor-title').focus();
}
$('new-record').addEventListener('click',()=>openEditor());
$('back-overview').addEventListener('click',()=>{
  $('catalog-editor').hidden=true;
  $('catalog-overview').hidden=false;
  $('status').textContent='';
  renderOverview();
  $('overview-title').focus();
});
$('catalog-search').addEventListener('input',renderOverview);
$('catalog-status').addEventListener('change',renderOverview);

async function api(options){
  const response=await fetch(endpoint,options);
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || 'Der Katalog ist nicht erreichbar.');
  return data;
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  const record=editing;
  const details={
    id:record?.id,revision:record?.revision,photos,
    ...Object.fromEntries(strings.map(key=>[key,fields[key].value])),
    ...Object.fromEntries(numeric.map(key=>[key,Number(fields[key].value)])),
    youth:fields.youth.value===''?null:Number(fields.youth.value),
    location:[fields.town.value,Number(fields.latitude.value),Number(fields.longitude.value)],
    active:fields.active.checked,region:'sfl',priceKnown:fields.priceKnown.checked,
    accessibility:Object.fromEntries(Object.keys(accessOptions).map(key=>[key,fields['access-'+key].value])),
    sources:fields.sources.value.split(/\r?\n/).map(link=>link.trim()).filter(Boolean),
    passes:[...$('pass-rules').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-pass]')].map(el=>[el.dataset.pass,el.value]))),
    hours:[...$('hours').children].map(row=>({
      ...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value])),
      days:[...row.querySelectorAll('[type=checkbox]:checked')].map(el=>Number(el.value))
    }))
  };
  const payload=new FormData();
  payload.append('details',JSON.stringify(details));
  for (const file of $('upload').files) payload.append('photos',file);
  $('save').disabled=$('back-overview').disabled=true;
  $('status').textContent='Wird gespeichert …';
  try {
    const saved=await api({method:'POST',body:payload});
    records=[...records.filter(item=>item.id!==saved.id),saved];
    editing=saved;
    $('editor-title').textContent=saved.title;
    loadEditor(saved);
    $('status').textContent='Erlebnis gespeichert.';
  } catch(error) {
    $('status').textContent=error.message;
  } finally {
    $('save').disabled=$('back-overview').disabled=false;
  }
});

try {
  records=await api();
  renderOverview();
  $('new-record').disabled=false;
} catch(error) {
  $('catalog-summary').textContent=error.message;
}

const accessEndpoint='/api/admin/access';
const accessForm=$('access-form');
let adminEmails=[];

function renderAdmins(){
  $('admin-list').replaceChildren(...adminEmails.map(email=>{
    const item=document.createElement('li');
    const label=document.createElement('strong');
    label.textContent=email;
    const remove=document.createElement('button');
    remove.type='button';
    remove.className='add-button';
    remove.textContent='Freigabe entziehen';
    remove.setAttribute('aria-label','Freigabe für '+email+' entziehen');
    remove.addEventListener('click',()=>changeAccess('DELETE',email));
    item.append(label,remove);
    return item;
  }));
}

async function changeAccess(method,email){
  const status=$('access-status');
  const controls=[...accessForm.elements,...$('admin-list').querySelectorAll('button')];
  controls.forEach(control=>control.disabled=true);
  status.textContent='Freigaben werden aktualisiert …';
  try {
    const response=await fetch(accessEndpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error);
    adminEmails=adminEmails.filter(item=>item!==data.email);
    if(method==='PUT') adminEmails.push(data.email);
    adminEmails.sort();
    renderAdmins();
    accessForm.reset();
    status.textContent=method==='PUT'?'ChatGPT-Konto freigeschaltet.':'Freigabe entzogen.';
  } catch(error) {
    status.textContent=error.message;
  } finally {
    controls.forEach(control=>control.disabled=false);
  }
}
accessForm.addEventListener('submit',event=>{
  event.preventDefault();
  changeAccess('PUT',$('admin-email').value);
});
try {
  const response=await fetch(accessEndpoint);
  if(response.ok){
    adminEmails=await response.json();
    renderAdmins();
    $('catalog-access').hidden=false;
  }
} catch {
  // Catalog editing remains available when the access list cannot be loaded.
}
