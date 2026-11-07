import {meetingPoints} from './region.js';

export const minutes = time => {
  const [hour,minute]=time.split(':').map(Number);
  return hour*60+minute;
};

export function windowsOn(activity,date){
  if (!date) return [];
  const weekday = new Date(date+'T00:00:00Z').getUTCDay();
  const matching = activity.hours.filter(rule=>rule.days.includes(weekday) &&
    (!rule.from||rule.from<=date) && (!rule.to||date<=rule.to));
  if (matching.some(rule=>rule.kind==='closed')) return [];
  const special = matching.filter(rule=>rule.kind==='special');
  return (special.length?special:matching).map(rule=>({
    open:minutes(rule.open), close:minutes(rule.close),
    last:minutes(rule.last||rule.close), ticketUrl:rule.ticketUrl
  })).sort((a,b)=>a.open-b.open);
}

export function distanceKm(a,b){
  const rad = n => n*Math.PI/180;
  const x = Math.sin(rad(b.latitude-a.latitude)/2)**2 +
    Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 2*6371*Math.asin(Math.sqrt(Math.min(1,x)));
}

export const point = ({location:[,latitude,longitude],meeting}) => ({latitude,longitude,mountain:Boolean(meetingPoints[meeting]?.mountain)});
export const maxBetweenStopsKm = 15;

export function travelLeg(from,to){
  const km=distanceKm(from,to);
  const lift=Boolean(from.mountain)!==Boolean(to.mountain);
  const minutes=km<0.05?0:Math.max(10,Math.ceil((5+km*2.5)/5)*5);
  return {km,minutes:minutes+(lift?20:0),lift};
}

function scheduleLegs(activities,{date,origin,start,end,radius=30,departure=origin,returnTo=origin}){
  let time=start, from=departure, overhead=0, totalKm=0;
  const rows=[];
  for (const activity of activities) {
    const destination=point(activity);
    if(distanceKm(origin,destination)>radius) return null;
    const leg=travelLeg(from,destination);
    if((rows.length || departure!==origin) && leg.km>maxBetweenStopsKm) return null;
    if(from.mountain && leg.lift && time>16*60+40) return null;
    const arrival=time+leg.minutes;
    const available=windowsOn(activity,date).map(window=>({...window,start:Math.max(window.open,arrival),
        duration:window.last===window.open?window.close-window.open:activity.duration}))
      .filter(window=>window.start<=window.last && window.start+window.duration<=Math.min(window.close,end))
      .sort((a,b)=>a.start-b.start)[0];
    if (!available) return null;
    const wait=available.start-arrival;
    const finish=available.start+available.duration;
    rows.push({activity,start:available.start,end:finish,travel:leg.minutes,km:leg.km,lift:leg.lift,ticketUrl:available.ticketUrl,wait});
    time=finish;
    from=destination;
    overhead+=leg.minutes+wait;
    totalKm+=leg.km;
  }
  const back=rows.length||departure!==returnTo?travelLeg(from,returnTo):null;
  if(returnTo!==origin && (rows.length||departure!==origin) && back?.km>maxBetweenStopsKm) return null;
  if(from.mountain && back?.lift && time>16*60+40) return null;
  const finish=time+(back?.minutes||0);
  if(finish>end) return null;
  return {rows,back,finish,score:overhead+(back?.minutes||0),totalKm:totalKm+(back?.km||0)};
}

export function schedule(activities,settings){
  const {blocks=[]}=settings;
  if(!blocks.length) return scheduleLegs(activities,settings);
  let best=null;
  function arrange(index,offset,start,departure,rows,transfers,score,totalKm){
    if(index===blocks.length){
      const tail=scheduleLegs(activities.slice(offset),{...settings,start,departure});
      if(!tail) return;
      const option={...tail,rows:[...rows,...tail.rows],transfers,
        score:score+tail.score,totalKm:totalKm+tail.totalKm};
      if(!best||comparePlans(option,best)<0) best=option;
      return;
    }
    const block=blocks[index];
    for(let count=offset;count<=activities.length;count++){
      const part=scheduleLegs(activities.slice(offset,count),{
        ...settings,start,departure,end:block.start,returnTo:block.meeting
      });
      if(!part) continue;
      arrange(index+1,count,block.finish,block.meeting,[...rows,...part.rows],
        [...transfers,{...part.back,arrival:part.finish}],score+part.score,totalKm+part.totalKm);
    }
  }
  arrange(0,0,settings.start,settings.origin,[],[],0,0);
  return best;
}

function comparePlans(a,b){
  return a.score-b.score || a.totalKm-b.totalKm || a.finish-b.finish;
}

export function insertActivity(current,activity,settings){
  let best=null;
  for (let i=0;i<=current.length;i++) {
    const order=[...current.slice(0,i),activity,...current.slice(i)];
    const option=schedule(order,settings);
    if (option && (!best||comparePlans(option,best)<0)) best=option;
  }
  return best;
}

export function suggestSchedule(candidates,settings,maxStops=3){
  // A small search beam keeps the planner responsive even as the catalog grows.
  let plans=[schedule([],settings)];
  for (let count=0;count<maxStops;count++) {
    const next=[];
    for (const plan of plans) {
      const chosen=plan.rows.map(row=>row.activity);
      for (const activity of candidates) {
        if (chosen.includes(activity)) continue;
        const option=schedule([...chosen,activity],settings);
        if (option) next.push(option);
      }
    }
    if (!next.length) break;
    plans=next.sort(comparePlans).slice(0,12);
  }
  return plans[0];
}

export function addDays(date,days){
  return new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
}

export function datesBetween(start,end,maxDays=14){
  const count=(Date.parse(end)-Date.parse(start))/86400000+1;
  if (!Number.isInteger(count) || count<1 || count>maxDays) return [];
  return Array.from({length:count},(_,i)=>addDays(start,i));
}

export function splitPeriod(groups,settings,candidates,{slot='morning',accept=()=>true}={}){
  let best=null;
  for(const [key,meeting] of Object.entries(meetingPoints)){
    const arrival=travelLeg(settings.origin,meeting);
    const home=travelLeg(meeting,settings.origin);
    if(arrival.km>settings.radius) continue;
    const afternoon=slot==='afternoon';
    const start=Math.max(settings.start,afternoon?13*60:0)+arrival.minutes;
    const end=Math.min(afternoon?(meeting.mountain?16*60+40:settings.end):13*60,settings.end-home.minutes);
    if(start>=end) continue;
    const options=groups.map(group=>candidates(group).filter(a=>a.meeting===key &&
      distanceKm(meeting,point(a))<=2 && distanceKm(settings.origin,point(a))<=settings.radius)
      .map(activity=>{
        const plan=schedule([activity],{...settings,origin:meeting,start,end,radius:2});
        return plan&&{...plan.rows[0],back:plan.back,finish:plan.finish,group};
      }).filter(Boolean));
    if(options.some(rows=>!rows.length)) continue;
    function pick(index,rows,used){
      if(index===options.length){
        const finish=Math.max(...rows.map(row=>row.finish));
        const overlap=Math.min(...rows.map(row=>row.end))-Math.max(...rows.map(row=>row.start));
        if(overlap<10) return;
        const score=arrival.minutes+home.minutes+rows.reduce((sum,row)=>sum+row.travel+row.back.minutes+row.wait,0);
        const span=finish-start;
        const option={slot,meeting,arrival,start,finish,rows:[...rows],score,span};
        if((!best||score<best.score||(score===best.score&&span>best.span))&&accept(option)) best=option;
        return;
      }
      for(const row of options[index]){
        if(used.has(row.activity.id)) continue;
        used.add(row.activity.id);
        rows.push(row);
        pick(index+1,rows,used);
        rows.pop();
        used.delete(row.activity.id);
      }
    }
    pick(0,[],new Set());
  }
  return best;
}
