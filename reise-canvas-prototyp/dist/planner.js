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
// What each accessibility need asks of an activity (keys as in the Familienzeit catalogue).
const needAccess={wheelchair:['stepFree'],walker:['stepFree'],stroller:['stroller'],vision:['vision'],hearing:['hearing']};
const groupAccess=group=>[...new Set(group.members.flatMap(p=>[...(p.needs||[])]).flatMap(need=>needAccess[need]||[]))];

// ---------- Trip planner ----------
// Fills every day (morning, afternoon and evening events) for every group. Hard rules: open that day,
// fits all ages, the dog, accessibility needs and the weather. Score: who in the group likes it,
// weighted by fairness (people whose wishes came up short so far count more), plus bonuses for
// one-day events, weatherproof activities on bad days, confirmed access and short distances.
const eveningPeriod={start:17*60+30,end:22*60+30};
const badWeather=new Set(['rain','storm']);
function personLikes(person,activity){
  return [...person.wishes].filter(key=>activity.interests?.includes(key)||
    (key==='water'?/bad|schwimm|wasser|see/i.test(activity.title):wishCategories[key]?.includes(activity.category))||
    key==='wellness'&&activity.category==='Wellness');
}
const datedEvent=(activity,date)=>activity.hours.some(rule=>rule.from===date&&rule.to===date);
function openingOn(activity,date){
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const rule=activity.hours.find(r=>r.kind!=='closed'&&r.days.includes(weekday)&&(!r.from||r.from<=date)&&(!r.to||date<=r.to));
  return rule?`${rule.open}–${rule.close}`:'';
}
const distanceKm=([a,b],[c,d])=>Math.hypot((a-c)*111,(b-d)*76);
function slotOptions(catalog,{date,period,group,place,general,weather,used,day,fairness,seed}){
  const access=groupAccess(group);
  const ages=group.members.filter(p=>p.kind==='child').map(p=>p.age);
  const dog=group.members.some(p=>p.kind==='dog');
  const people=group.members.filter(p=>p.kind!=='dog');
  const window=period==='evening'?eveningPeriod:periods[period];
  const options=[];
  for(const [index,activity] of catalog.entries()){
    if(used.has(index)||activity.region!=='sfl'||!ages.every(age=>age>=activity.min&&age<=activity.max)||
      dog&&activity.pets==='no'||access.some(key=>activity.accessibility?.[key]==='no')) continue;
    const time=suggestedTime(activity,date,window);
    if(!time||period==='evening'&&time.start<17*60) continue;
    // Only a forecast thunderstorm rules out fair-weather activities; forecast rain costs a lot,
    // last year's rain (no forecast yet) only a little.
    const outdoorOnly=activity.weather==='sun', bad=badWeather.has(weather?.kind), forecast=weather?.source==='forecast';
    if(outdoorOnly&&bad&&forecast&&weather.kind==='storm') continue;
    const likes=people.map(person=>({person,keys:personLikes(person,activity)})).filter(item=>item.keys.length);
    const today=datedEvent(activity,date);
    if(period==='evening'&&!today&&!likes.length) continue;
    let score=likes.reduce((sum,item)=>sum+1.5*fairness(item.person),0);
    score+=.7*personLikes({wishes:general},activity).length;
    score+=access.filter(key=>activity.accessibility?.[key]==='yes').length;
    if(today) score+=1.5;
    if(outdoorOnly&&bad) score-=forecast?2.5:.5;
    // Dogs: almost no activity says yet whether dogs may come. Only a confirmed 'no' excludes it;
    // unknown stays in (labelled "ask the provider"), outdoor activities first, since trails usually allow dogs.
    if(dog) score+=activity.pets==='yes'?1:outdoorOnly?-.3:-1.2;
    if(bad&&activity.weather==='both') score+=forecast?1:.3;
    if(weather?.kind==='sun'&&outdoorOnly) score+=.5;
    if(outdoorOnly&&weather&&weather.tmax<=2) score-=1.5;
    if(ages.length&&/murmli|berta/i.test(activity.title)) score+=.5;
    if(activity.location[0].startsWith(place)) score+=.6;
    if(day.categories.has(activity.category)) score-=1;
    if(day.coords&&activity.coords) score-=.12*distanceKm(day.coords,activity.coords);
    score+=(stableHash(seed+activity.title+date+period)%100)/250;
    options.push({index,activity,time,score,likes,today,dogCheck:dog&&activity.pets!=='yes',dogWelcome:dog&&activity.pets==='yes',
      access:access.map(key=>({key,status:activity.accessibility?.[key]||'unknown'}))});
  }
  return options.sort((a,b)=>b.score-a.score);
}
// picks: the user's choices per slot key (activity index, or -1 for "keep this slot free").
function planTrip(catalog,{dates,place,family,groupsFor,general,weatherByDate,picks,seed}){
  const used=new Set(), happy=new Map(family.filter(p=>p.kind!=='dog').map(p=>[p.id,0]));
  // Whoever has had the most favourite moments counts least; everyone else counts more the further behind they are.
  const fairness=person=>{
    const most=Math.max(...happy.values()), own=happy.get(person.id);
    return own===most&&most>0?.4:1+(most-own);
  };
  const days=dates.map(date=>{
    const weather=weatherByDate[date]||null;
    const day={categories:new Set(),coords:null};
    const slots=['am','pm','evening'].map(period=>{
      const groups=period==='evening'?[{id:'all',label:t('allTogether'),members:family}]:groupsFor(period);
      const entries=groups.map(group=>{
        if(group.id==='care') return {group,care:true};
        const key=[date,period,...group.members.map(p=>p.id)].join('/');
        const options=slotOptions(catalog,{date,period,group,place,general,weather,used,day,fairness,seed});
        const chosen=picks.has(key)?options.find(o=>o.index===picks.get(key))||null:options[0]||null;
        if(chosen){
          used.add(chosen.index);
          for(const item of chosen.likes) happy.set(item.person.id,happy.get(item.person.id)+1);
          day.categories.add(chosen.activity.category);
          if(chosen.activity.coords) day.coords=chosen.activity.coords;
        }
        return {group,key,chosen,alternatives:options.filter(o=>o!==chosen).slice(0,4)};
      });
      return {period,entries};
    }).filter(slot=>slot.period!=='evening'||slot.entries.some(entry=>entry.chosen||entry.alternatives?.length&&picks.has(entry.key)));
    return {date,weather,slots};
  });
  return {days,happy};
}

// ---------- Booking (rules taken over from the Familienzeit planner) ----------
const superSommerCard={name:'Super. Sommer. Card.',start:'06-12',end:'10-17',
  source:'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/super-sommer-card'};
function cardRule(activity,date,hasCard){
  if(!hasCard||date.slice(5)<superSommerCard.start||date.slice(5)>superSommerCard.end) return null;
  return activity.passes?.find(rule=>rule.card==='sfl'&&(!rule.from||rule.from<=date)&&(!rule.to||date<=rule.to))||null;
}
const bookingMode=(activity,rule)=>rule?'pass':activity.booking||'provider';
// Estimated entry for exactly these people; null when the price depends on date and tariff.
function groupPrice(activity,members,rule){
  const dogs=members.filter(p=>p.kind==='dog').length;
  if(rule) return (activity.dogPrice||0)*dogs;
  if(activity.priceKnown===false||activity.adult==null) return null;
  return members.reduce((sum,p)=>{
    if(p.kind==='dog') return sum+(activity.dogPrice||0);
    if(p.kind==='adult'||p.age==null) return sum+activity.adult;
    if(p.age<activity.childFrom) return sum;
    if(p.age<=activity.childTo) return sum+activity.child;
    return sum+(activity.youth!=null&&p.age>=activity.youthFrom?activity.youth:activity.adult);
  },0);
}
function ticketLink(activity,date){
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const rule=activity.hours.find(r=>r.ticketUrl&&r.days.includes(weekday)&&(!r.from||r.from<=date)&&(!r.to||date<=r.to));
  return rule?.ticketUrl||activity.bookingLink||'';
}
const mapLink=activity=>activity.coords?`https://www.openstreetmap.org/?mlat=${activity.coords[0]}&mlon=${activity.coords[1]}#map=16/${activity.coords[0]}/${activity.coords[1]}`:'';
