const periods={
  am:{start:9*60,end:12*60},
  pm:{start:13*60,end:18*60}
};
const groupColors=['#f4d487','#baded9','#efd0bf','#e0d6f4','#d5e5b7'];

function canSplit(family){
  return family.filter(p=>p.kind==='adult').length>1||family.some(p=>p.kind==='child');
}

// Each adult leads a group unless they were moved into another adult's group.
function groupLeaders(family,settings){
  const adults=family.filter(p=>p.kind==='adult');
  return adults.filter(a=>!adults.some(p=>p!==a&&p.id===settings.assignments.get(a.id)));
}
function adultGroups(family,settings){
  const leaders=groupLeaders(family,settings);
  const dependents=family.filter(p=>!leaders.includes(p)&&!inCare(p,settings));
  return leaders.map((adult,index)=>({
    id:adult.id,
    label:t('groupNumber',index+1),
    color:groupColors[index%groupColors.length],
    members:[adult,...dependents.filter((person,order)=>{
      const assigned=settings.assignments.get(person.id);
      const owner=leaders.some(p=>p.id===assigned)?assigned:leaders[order%leaders.length].id;
      return owner===adult.id;
    })]
  }));
}

const inCare=(person,settings)=>person.kind==='child'&&settings.assignments.get(person.id)==='care';
function groupSet(family,settings){
  if(!settings.split||!canSplit(family)) return [{id:'all',label:t('allTogether'),members:family}];
  const children=family.filter(p=>inCare(p,settings));
  const groups=adultGroups(family,settings);
  if(!children.length) return groups.length>1?groups:[{id:'all',label:t('allTogether'),members:family}];
  const free=groups.filter(group=>!group.members.some(p=>p.kind==='child'));
  return [
    ...groups.filter(group=>!free.includes(group)),
    ...(free.length?[{id:'free',label:t('freeAdults'),color:'#f5cda3',members:free.flatMap(group=>group.members),usesCare:true}]:[]),
    {id:'care',label:t('careBadge'),color:'#dfd9ef',members:children}
  ];
}

const childcareLinks={
  summerCare:{de:'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/familiensommer/kinderbetreuung',
    en:'https://www.serfaus-fiss-ladis.at/en/summer-holiday/family-summer/child-care'},
  winterCare:{de:'https://www.serfaus-fiss-ladis.at/de/winterurlaub/familienwinter/kinderbetreuung',
    en:'https://www.serfaus-fiss-ladis.at/en/winter-holiday/family-winter/child-care'}
};

const toMinutes=time=>{
  const [hour,minute]=time.split(':').map(Number);
  return hour*60+minute;
};
const timeText=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
const timeRange=(start,end)=>timeText(start)+'–'+timeText(end);
function suggestedTime(activity,date,period){
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const matching=activity.hours.filter(rule=>rule.days.includes(weekday)&&(!rule.from||rule.from<=date)&&(!rule.to||date<=rule.to));
  if(matching.some(rule=>rule.kind==='closed')) return null;
  const special=matching.filter(rule=>rule.kind==='special');
  let best=null;
  for(const rule of special.length?special:matching){
    if(!rule.open||!rule.close) continue;
    const open=toMinutes(rule.open);
    const close=toMinutes(rule.close);
    const last=rule.last?toMinutes(rule.last):close;
    const start=Math.max(open,period.start);
    const end=start+(last===open?close-open:activity.duration);
    if(start>last||end>Math.min(close,period.end)||end<=start) continue;
    if(!best||start<best.start) best={start,end};
  }
  return best;
}

const wishCategories={adventure:['Action','Natur'],water:['Action'],play:['Kreativ'],discover:['Entdecken'],calm:['Natur','Kreativ']};
function stableHash(text){
  let hash=2166136261;
  for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return hash>>>0;
}
function featuredIndexes(candidates,seed){
  if(candidates.length<2) return new Set();
  const best=Math.max(...candidates.map(item=>item.score));
  const count=candidates.length>=9?2:1;
  const picked=candidates.filter(item=>item.score>=best-1)
    .map(item=>({index:item.index,priority:stableHash(JSON.stringify([seed,item.activity.title]))}))
    .sort((a,b)=>a.priority-b.priority||a.index-b.index)
    .slice(0,count);
  return new Set(picked.map(item=>item.index));
}
// What each accessibility need asks of an activity (keys as in the Familienzeit catalogue).
const needAccess={wheelchair:['stepFree'],walker:['stepFree'],stroller:['stroller'],vision:['vision'],hearing:['hearing']};
const groupAccess=group=>[...new Set(group.members.flatMap(p=>[...(p.needs||[])]).flatMap(need=>needAccess[need]||[]))];
function rankedActivities(catalog,{date,period,place,group,general}){
  const access=groupAccess(group);
  const ages=group.members.filter(p=>p.kind==='child').map(p=>p.age);
  const dog=group.members.some(p=>p.kind==='dog');
  const wishes=[...general,...group.members.flatMap(p=>[...p.wishes])];
  const result=[];
  for(const [index,activity] of catalog.entries()){
    if(activity.region!=='sfl'||!activity.location[0].startsWith(place)||
      !ages.every(age=>age>=activity.min&&age<=activity.max)||(dog&&activity.pets!=='yes')) continue;
    // Confirmed unsuitable for a need: leave it out. Confirmed suitable: rank it higher.
    if(access.some(key=>activity.accessibility?.[key]==='no')) continue;
    const time=suggestedTime(activity,date,period);
    if(!time) continue;
    const matches=new Set();
    let score=Number(Boolean(group.usesCare&&activity.adultFocus));
    for(const key of wishes){
      const categoryMatch=wishCategories[key]?.includes(activity.category);
      const waterMatch=key==='water'&&/bad|schwimm|wasser|see/i.test(activity.title);
      const explicitMatch=activity.interests?.includes(key);
      score+=Number(Boolean(categoryMatch))+Number(waterMatch)+2*Number(Boolean(explicitMatch));
      if(explicitMatch||waterMatch||(categoryMatch&&key!=='water')) matches.add(key);
    }
    score+=2*access.filter(key=>activity.accessibility?.[key]==='yes').length;
    result.push({index,activity,time,score,matches:[...matches].sort(),
      access:access.map(key=>({key,status:activity.accessibility?.[key]||'unknown'}))});
  }
  const seed=JSON.stringify([place,date,period.start,period.end,ages.sort((a,b)=>a-b),dog,wishes.sort(),Boolean(group.usesCare)]);
  const featured=featuredIndexes(result,seed);
  for(const item of result) item.featured=featured.has(item.index);
  return result.sort((a,b)=>Number(b.featured)-Number(a.featured)||b.score-a.score||
    activityTitle(a.activity).localeCompare(activityTitle(b.activity),locale()));
}
