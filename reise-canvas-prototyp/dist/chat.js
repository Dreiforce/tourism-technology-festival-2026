// Murmli & Berta as a guided chat: they ask, you tap or type, and the canvas form fills itself step by step.
// Rule-based on purpose: runs in the browser, works on the static GitHub Pages copy, needs no AI service or key.
const chat={handler:null,replies:[],person:0,need:'',pendingKids:0,draft:null};
const towns3=['Serfaus','Fiss','Ladis'];
const interestWords={water:/wasser|schwimm|baden|swim|water|lake|\bsee\b/,play:/spiel|play/,adventure:/abenteuer|adventure|action|rodel|kletter|climb|sledg/,
  discover:/entdeck|explor|discover|schatz|treasure/,calm:/ruhe|relax|entspann|calm|quiet|gemütlich/,sport:/sport|wander|hik|bike|\brad|ski|langlauf/,
  wellness:/wellness|spa\b|sauna|massage/,food:/essen|kulinar|food|fondue|restaurant|dinner|buffet|\beat/};
const needWords={wheelchair:/rollstuhl|wheelchair/,stroller:/kinderwagen|buggy|pushchair|stroller|pram/,walker:/rollator|gehhilfe|walker|walking/,
  vision:/seh|blind|vision|sight/,hearing:/hör|hoer|hear|deaf/};
const yes=text=>/^\s*(ja|yes|jo|klar|sure|yep|y|j)\b/i.test(text);
const no=text=>/^\s*(nein|no|nö|nope|n|keine?|nothing)\b/i.test(text);
const mascotFace=who=>`<svg viewBox="-24 -88 48 48" aria-hidden="true">${who==='berta'?bertaArt():murmliArt()}</svg>`;

// ---------- UI ----------
function chatSay(who,text){
  const row=document.createElement('div');
  row.className='chat-row '+(who==='you'?'you':'bot');
  row.innerHTML=who==='you'?`<p>${html(text)}</p>`:`${mascotFace(who)}<p><strong>${who==='berta'?'Berta':'Murmli'}</strong>${text}</p>`;
  $('chat-log').append(row);
  requestAnimationFrame(()=>row.scrollIntoView({block:'end',behavior:reduced.matches?'instant':'smooth'}));
}
function chatReplies(){
  $('chat-replies').innerHTML=chat.replies.map((reply,i)=>
    `<button type="button" class="chat-chip" data-reply="${i}" ${reply.pressed!==undefined?`aria-pressed="${reply.pressed}"`:''}>${html(reply.label)}</button>`).join('');
}
// Ask a question: a mascot bubble, answer chips, and what to do with the answer (chip value or typed text).
function ask(who,text,replies,handler){
  chat.handler=handler;
  chat.replies=replies;
  $('chat-replies').innerHTML='';
  const delay=reduced.matches?0:380;
  $('chat-log').classList.add('typing');
  setTimeout(()=>{
    $('chat-log').classList.remove('typing');
    chatSay(who,text);
    chatReplies();
  },delay);
}
function answer(value,label){
  if(!chat.handler) return;
  chatSay('you',label);
  chat.handler(value);
}
function openChat(){
  if($('experience').hidden) start();
  $('chat').hidden=false;
  $('chat-toggle').setAttribute('aria-expanded','true');
  if(!$('chat-log').children.length) greet();
  setTimeout(()=>$('chat-input').focus(),50);
}
function closeChat(){
  $('chat').hidden=true;
  $('chat-toggle').setAttribute('aria-expanded','false');
  $('chat-toggle').focus();
}

// ---------- Understanding typed answers ----------
const numberWords={ein:1,eine:1,einer:1,einem:1,one:1,a:1,an:1,zwei:2,two:2,drei:3,three:3,vier:4,four:4,fünf:5,five:5};
const toNumber=word=>Number(word)||numberWords[word]||0;
function parseFamily(text){
  const s=text.toLowerCase();
  const count=re=>{const m=s.match(re);return m?toNumber(m[1]):0};
  let adults=count(/(\d+|ein|eine|zwei|drei|vier|fünf|one|two|three|four|five)\s*(erwachsene|erw\b|eltern|adults?|grown)/);
  const mum=/\b(mama|mutter|mum|mom|mother)\b/.test(s), dad=/\b(papa|vater|dad|father)\b/.test(s);
  adults=Math.max(adults,mum+dad,/eltern|parents|paar|couple|zu zweit|wir zwei|we two|two of us/.test(s)?2:0,/\b(ich|me|myself)\b/.test(s)?1:0);
  const grand=/großeltern|grosseltern|grandparents/.test(s)?2:(/\b(oma|grandma|granny)\b/.test(s)?1:0)+(/\b(opa|grandpa)\b/.test(s)?1:0);
  const dogs=/hunde|dogs/.test(s)?Math.max(2,count(/(\d+|zwei|two|drei|three)\s*(hunde|dogs)/)):/\b(hund|dog)\b/.test(s)?1:0;
  const kidWord=/(kinder|kind|kids?|children|child|sohn|söhne|tochter|töchter|son|daughter|enkel|grandchild|grandkid|baby|babys|babies)/;
  // Ages: every number up to 17 that isn't a head count ("2 Erwachsene", "3 Kinder", "2 Hunde").
  const counts=/(\d+|ein|eine|einem|zwei|drei|vier|fünf|one|two|three|four|five|a|an)\s*(erwachsene|erw\b|eltern|adults?|kinder|kind\b|kids?|children|child|enkel\w*|grandchild\w*|hunde?|dogs?)/g;
  const ages=[...s.replace(counts,'').matchAll(/\b(\d{1,2})\b/g)].map(m=>Number(m[1])).filter(age=>age<=17);
  const babies=(s.match(/\bbaby\b/g)||[]).length;
  for(let i=0;i<babies;i++) ages.push(0);
  const kids=Math.max(count(/(\d+|ein|eine|zwei|drei|vier|fünf|one|two|three|four|five)\s*(kinder|kids|children|enkel)/),ages.length,kidWord.test(s)?1:0);
  // Names right before an age ("Lena 6", "Max (9)") become the child's name.
  const names={};
  for(const m of text.matchAll(/([A-ZÄÖÜ][a-zäöüß]+)\s*\(?(\d{1,2})\)?/g)){
    if(/^(Kinder?|Kids?|Children|Child|Erwachsene|Adults?|Oma|Opa|Mama|Papa|Hunde?|Dogs?|Und|And|Baby|Enkel|Wir|We)$/.test(m[1])) continue;
    (names[m[2]]||=[]).push(m[1]);
  }
  return {adults,grand,dogs,ages,names,missing:Math.max(0,kids-ages.length),mum,dad};
}
function parseDates(text){
  const s=text.toLowerCase();
  const day=new Date(todayDate()+'T00:00:00Z');
  const iso=d=>d.toISOString().slice(0,10), plus=(d,n)=>new Date(d.getTime()+n*864e5);
  if(/heute|today/.test(s)) return [iso(day),''];
  if(/übermorgen|day after tomorrow/.test(s)) return [iso(plus(day,2)),''];
  if(/morgen|tomorrow/.test(s)) return [iso(plus(day,1)),''];
  if(/wochenende|weekend/.test(s)){const sat=plus(day,(6-day.getUTCDay()+7)%7);return [iso(sat),iso(plus(sat,1))]}
  if(/nächste woche|naechste woche|next week/.test(s)){const mon=plus(day,((8-day.getUTCDay())%7)||7);return [iso(mon),iso(plus(mon,6))]}
  const found=[...s.matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g)].map(m=>{
    if(m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
    const year=m[6]?Number(m[6].length===2?'20'+m[6]:m[6]):day.getUTCFullYear();
    let date=new Date(Date.UTC(year,Number(m[5])-1,Number(m[4])));
    if(!m[6]&&date<day) date=new Date(Date.UTC(year+1,Number(m[5])-1,Number(m[4])));
    return isNaN(date)?null:iso(date);
  }).filter(Boolean);
  return found.length?[found[0],found[1]>found[0]?found[1]:'']:null;
}
const pickWords=(text,words)=>Object.keys(words).filter(key=>words[key].test(text.toLowerCase()));

// ---------- Conversation ----------
const chatPeople=()=>state.family.filter(p=>p.kind!=='dog');
const personLabel=p=>p.name||memberLabel(p).replace(/<[^>]+>/g,'');
function greet(){
  chatSay('murmli',t('chatHello'));
  if(state.family.length) ask('berta',t('chatHasFamily',state.family.length),[{label:t('chatYesNew'),value:'new'},{label:t('chatKeep'),value:'keep'}],
    value=>value==='keep'||no(value)?askPlace():askFamily());
  else askFamily();
}
function askFamily(){
  ask('murmli',t('chatAskFamily'),[1,2,3,4].map(n=>({label:t('chatFamilyPreset'+n),value:t('chatFamilyPreset'+n)})),answerFamily);
}
function answerFamily(text){
  const found=parseFamily(text);
  if(!found.adults&&!found.grand) return ask('murmli',t('chatNeedAdult'),chat.replies,answerFamily);
  chat.draft=found;
  if(found.missing){
    chat.pendingKids=found.missing;
    return ask('murmli',found.missing>1?t('chatAskAgesMany',found.missing):t('chatAskAgesOne'),
      found.missing===1?[2,5,8,12].map(age=>({label:ageText({age}),value:String(age)})):[],answerAges);
  }
  applyFamily();
}
function answerAges(text){
  const ages=[...String(text).matchAll(/\d{1,2}/g)].map(m=>Number(m[0])).filter(age=>age<=17).slice(0,chat.pendingKids);
  if(!ages.length) return ask('murmli',chat.pendingKids>1?t('chatAskAgesMany',chat.pendingKids):t('chatAskAgesOne'),chat.replies,answerAges);
  chat.draft.ages.push(...ages);
  applyFamily();
}
function applyFamily(){
  const {adults,grand,dogs,ages,mum,dad,names:childNames={}}=chat.draft;
  state.family=[];
  state.picks.clear();
  for(const group of Object.values(state.groups)){group.split=false;group.assignments.clear()}
  const names=[mum&&t('chatMum'),dad&&t('chatDad')].filter(Boolean);
  for(let i=0;i<adults;i++) state.family.push(newPerson('adult',{name:names[i]||''}));
  for(const age of ages) state.family.push(newPerson('child',{age,name:childNames[age]?.shift()||''}));
  for(let i=0;i<grand;i++) state.family.push(newPerson('adult',{age:70,name:grand===2?[t('chatGrandma'),t('chatGrandpa')][i]:''}));
  for(let i=0;i<Math.min(dogs,2);i++) state.family.push(newPerson('dog'));
  state.family=state.family.slice(0,10);
  go(1);
  cheer();
  chatSay('berta',t('chatFamilyDone',state.family.map(p=>p.kind==='dog'?t('dog'):personLabel(p)).join(', ')));
  askPlace();
}
function askPlace(){
  ask('berta',t('chatAskPlace'),[...towns3.map(town=>({label:town,value:town})),{label:t('chatNoMatter'),value:'any'}],text=>{
    state.place=towns3.find(town=>text.toLowerCase().includes(town.toLowerCase()))||state.place;
    requestWeather();
    go(2);
    chatSay('berta',t('chatPlaceDone',state.place));
    askDates();
  });
}
function askDates(){
  ask('murmli',t('chatAskDates'),['chatToday','chatTomorrow','chatWeekend','chatNextWeek'].map(key=>({label:t(key),value:t(key)})),text=>{
    const dates=parseDates(text);
    if(!dates) return ask('murmli',t('chatDatesUnknown'),chat.replies,chat.handler);
    const before=[state.start,state.end];
    [state.start,state.end]=dates;
    const issue=dateIssue();
    if(issue){[state.start,state.end]=before;return ask('murmli',t(issue),chat.replies,chat.handler)}
    state.family.filter(p=>p.birth).forEach(applyAge);
    requestWeather();
    go(3);
    chatSay('murmli',t('chatDatesDone',stamp()));
    chat.person=0;
    askWishes();
  });
}
function wishReplies(p){
  return [...Object.keys(choices).map(key=>({label:t(key),value:key,pressed:p.wishes.has(key)})),{label:t('chatNext')+' →',value:'__next'}];
}
function askWishes(){
  const p=chatPeople()[chat.person];
  if(!p) return askNeeds(true);
  ask('berta',t('chatAskWishes',html(personLabel(p))),wishReplies(p),value=>{
    const keys=value==='__next'?[]:choices[value]?[value]:pickWords(value,interestWords);
    if(value!=='__next'&&choices[value]){
      if(p.wishes.has(value)) p.wishes.delete(value);else p.wishes.add(value);
      draw();
      chat.replies=wishReplies(p);
      chatReplies();
      return;
    }
    keys.forEach(key=>p.wishes.add(key));
    draw();
    chat.person++;
    askWishes();
  });
}
// Chips toggle silently (no echo bubble); typed text or "Next" moves on.
function askNeeds(first){
  go(4);
  const replies=[{label:t(first?'chatNoNeeds':'chatNoMore'),value:'none'},...['wheelchair','stroller','walker','vision','hearing'].map(key=>({label:t('need_'+key),value:key}))];
  ask('murmli',t(first?'chatAskNeeds':'chatAnyMore'),replies,value=>{
    const need=needWords[value]?value:pickWords(value,needWords)[0];
    if(value==='none'||!need) return askCard();
    const who=chatPeople().filter(p=>need!=='stroller'||(p.kind==='child'&&p.age<=5));
    if(!who.length) return askNeeds(false);
    ask('murmli',t('chatAskWho',t('need_'+need)),who.map(p=>({label:personLabel(p),value:String(p.id)})),id=>{
      const p=state.family.find(item=>String(item.id)===String(id))||who.find(item=>String(id).toLowerCase().includes(personLabel(item).toLowerCase()));
      if(p){(p.needs||=new Set()).add(need);draw();chatSay('murmli',t('chatNeedDone',html(personLabel(p))+' · '+t('need_'+need)))}
      askNeeds(false);
    });
  });
}
function askCard(){
  const summer=visitDates().some(date=>date.slice(5)>=superSommerCard.start&&date.slice(5)<=superSommerCard.end);
  if(!summer) return finish();
  ask('berta',t('chatAskCard'),[{label:t('chatYes'),value:'yes'},{label:t('chatNo'),value:'no'}],value=>{
    state.guestCard=value==='yes'||yes(value);
    finish();
  });
}
function finish(){
  go(finalStep);
  ask('berta',t('chatDone'),[{label:t('chatSeePlan'),value:'plan'},{label:t('chatBookNow'),value:'book'},{label:t('chatRestart'),value:'restart'}],async value=>{
    if(value==='restart'){$('chat-log').innerHTML='';chat.handler=null;return askFamily()}
    await updateTrip();
    if(value==='book'&&typeof openBooking==='function') openBooking();
    else $('results').scrollIntoView({behavior:reduced.matches?'instant':'smooth'});
  });
}

// ---------- Wiring ----------
$('chat-toggle').addEventListener('click',()=>$('chat').hidden?openChat():closeChat());
$('chat-start').addEventListener('click',openChat);
$('chat-close').addEventListener('click',closeChat);
$('chat-replies').addEventListener('click',event=>{
  const chip=event.target.closest('[data-reply]');
  if(!chip) return;
  const reply=chat.replies[Number(chip.dataset.reply)];
  if(reply.pressed!==undefined) return chat.handler(reply.value);   // toggles: no echo
  answer(reply.value,reply.label);
});
$('chat-form').addEventListener('submit',event=>{
  event.preventDefault();
  const text=$('chat-input').value.trim();
  if(!text) return;
  $('chat-input').value='';
  answer(text,text);
});
$('chat').addEventListener('keydown',event=>{if(event.key==='Escape') closeChat()});
$('chat-toggle').innerHTML=`<span class="chat-faces">${mascotFace('berta')}${mascotFace('murmli')}</span><span class="chat-toggle-label" data-text="chatStart">${t('chatStart')}</span>`;
$('chat-head-faces').innerHTML=mascotFace('berta')+mascotFace('murmli');
