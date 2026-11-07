// In-site booking (DEMO): one booking for the whole itinerary — a time slot per activity, tickets, contact
// (prefilled from an imaginary linked account), payment choice, one booking number and a calendar file.
// Nothing is reserved or paid anywhere; the provider links stay available.
// Also the OpenStreetMap day maps of the trip plan.

// ---------- OpenStreetMap day map (no library: OSM tiles + an SVG overlay) ----------
function mercator(lat,lon,zoom){
  const size=256*2**zoom, sin=Math.sin(lat*Math.PI/180);
  return [(lon+180)/360*size,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size];
}
function dayMap(day){
  const stops=day.slots.flatMap(slot=>slot.entries.filter(entry=>entry.chosen?.activity.coords).map(entry=>entry.chosen))
    .sort((a,b)=>a.time.start-b.time.start);
  if(!stops.length) return '';
  const W=720,H=250;
  let zoom=16, points;
  for(;zoom>=10;zoom--){
    points=stops.map(stop=>mercator(...stop.activity.coords,zoom));
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    if(Math.max(...xs)-Math.min(...xs)<=W-120&&Math.max(...ys)-Math.min(...ys)<=H-90) break;
  }
  if(stops.length===1) zoom=15, points=[mercator(...stops[0].activity.coords,zoom)];
  const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
  const left=(Math.min(...xs)+Math.max(...xs))/2-W/2, top=(Math.min(...ys)+Math.max(...ys))/2-H/2;
  const tiles=[];
  for(let x=Math.floor(left/256);x<=Math.floor((left+W)/256);x++) for(let y=Math.floor(top/256);y<=Math.floor((top+H)/256);y++)
    tiles.push(`<img src="https://tile.openstreetmap.org/${zoom}/${x}/${y}.png" alt="" loading="lazy" style="left:${((x*256-left)/W*100).toFixed(3)}%;top:${((y*256-top)/H*100).toFixed(3)}%;width:${(256/W*100).toFixed(3)}%">`);
  // Stops at the same place (e.g. two activities at one mountain station) are fanned out so every number shows.
  const local=[];
  for(const [x,y] of points){
    let p=[x-left,y-top];
    while(local.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<24)) p=[p[0]+26,p[1]];
    local.push(p);
  }
  return `<figure class="day-map" style="aspect-ratio:${W}/${H}"><div class="map-tiles" aria-hidden="true">${tiles.join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${html(t('mapLabel',stops.map(s=>activityTitle(s.activity)).join(', ')))}">
      ${local.length>1?`<polyline points="${local.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#245748" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round"/>`:''}
      ${local.map(([x,y],i)=>`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="13" fill="#245748" stroke="#fff" stroke-width="3"/><text y="4.5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">${i+1}</text></g>`).join('')}
    </svg>
    <figcaption>${stops.map((s,i)=>`<span><b>${i+1}</b> ${html(activityTitle(s.activity))}</span>`).join('')}</figcaption>
    <a class="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></figure>`;
}

// ---------- Booking state ----------
const bookingFor=entry=>{
  const booking=state.bookings.get(entry.key);
  return booking&&entry.chosen&&booking.index===entry.chosen.index?booking:null;
};
const people=members=>({adults:members.filter(p=>p.kind==='adult').length,children:members.filter(p=>p.kind==='child'),
  dogs:members.filter(p=>p.kind==='dog').length});
// Booking status of one plan item; booking itself happens once for the whole trip (bookingOverview).
function bookButton(entry){
  const booking=bookingFor(entry);
  return booking?`<span class="chip-booked">✓ ${t('bookedAt',timeText(booking.start))}</span>`:'';
}
// The imaginary account the family is signed in with (demo data, editable in the dialog).
const mockAccount={name:'Familie Huber',email:'familie.huber@example.com',phone:'+43 660 1234567'};
// Time slots from the opening hours of that day (every 30 min until the last start); dated events have
// their fixed start. Free places are invented but stable (demo).
function timeSlots(activity,date,planned,size){
  if(activity.hours.some(rule=>rule.from===date&&rule.to===date)) return [{start:planned.start,free:12}];
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const rule=activity.hours.find(r=>r.kind!=='closed'&&r.days.includes(weekday)&&(!r.from||r.from<=date)&&(!r.to||date<=r.to));
  if(!rule) return [{start:planned.start,free:size}];
  const open=toMinutes(rule.open), last=rule.last?toMinutes(rule.last):toMinutes(rule.close)-activity.duration;
  const slots=[];
  for(let start=open;start<=last;start+=30) slots.push({start,free:start===planned.start?Math.max(size,6):stableHash(activity.title+date+start)%9});
  if(!slots.some(slot=>slot.start===planned.start)) slots.push({start:planned.start,free:Math.max(size,6)});
  return slots.sort((a,b)=>a.start-b.start);
}
function bookingItems(){
  return currentTrip().days.flatMap(day=>day.slots.flatMap(slot=>slot.entries
    .filter(entry=>entry.chosen&&!bookingFor(entry))
    .map(entry=>{
      const a=entry.chosen.activity, rule=cardRule(a,day.date,state.guestCard);
      const size=entry.group.members.filter(p=>p.kind!=='dog').length;
      return {entry,day,a,rule,size,mode:bookingMode(a,rule),cost:groupPrice(a,entry.group.members,rule),
        slots:timeSlots(a,day.date,entry.chosen.time,size)};
    })));
}

// ---------- Dialog ----------
let bookingDraft=[];
function openBooking(){
  bookingDraft=bookingItems();
  if(!bookingDraft.length) return;
  const total=bookingDraft.reduce((sum,item)=>sum+(item.cost||0),0);
  const contact=(()=>{try{return JSON.parse(localStorage.getItem('familienzeit-contact'))||mockAccount}catch{return mockAccount}})();
  $('book-content').innerHTML=`<h2 id="book-title">${t(state.tripRef?'bookMoreTitle':'bookAllTitle')}</h2>
    ${state.tripRef?`<p>${t('bookMoreIntro',html(state.tripRef))}</p>`:''}
    <p class="demo-banner">${t('demoBanner')}</p>
    ${bookingDraft.map((item,i)=>{
      const {adults,children,dogs}=people(item.entry.group.members);
      return `<fieldset class="book-item"><legend><strong>${html(activityTitle(item.a))}</strong>
        <small>${html(dayText(item.day.date))} · ${html(item.a.address||item.a.location[0])}</small></legend>
        <p class="book-who">${t('bookWho',adults,children.length)}${dogs?' · 🐕 '+dogs:''}${children.length?` <small>(${children.map(c=>ageText(c)).join(', ')})</small>`:''}
          · <span class="chip-book ${item.mode}">${t(item.mode==='free'||item.mode==='pass'?'slotNeeded':'book_'+item.mode)}</span> · <strong>${priceText(item.cost,item.mode,item.a)}</strong></p>
        <div class="slot-grid" role="radiogroup" aria-label="${t('chooseSlot')}">${item.slots.map(slot=>
          `<label class="slot${slot.free<item.size?' full':''}"><input type="radio" name="slot-${i}" value="${slot.start}" ${slot.start===item.entry.chosen.time.start&&slot.free>=item.size?'checked':''} ${slot.free<item.size?'disabled':''} required>
          <span>${timeText(slot.start)}<small>${slot.free<item.size?t('slotFull'):t('slotFree',slot.free)}</small></span></label>`).join('')}</div>
      </fieldset>`;
    }).join('')}
    <fieldset class="book-contact"><legend>${t('contactTitle')}</legend>
      <p class="account-card"><span aria-hidden="true">👤</span> ${t('accountLinked')}</p>
      <label>${t('contactName')}<input name="name" autocomplete="name" required value="${html(contact.name||'')}"></label>
      <label>${t('contactEmail')}<input name="email" type="email" autocomplete="email" required value="${html(contact.email||'')}"></label>
      <label>${t('contactPhone')}<input name="phone" type="tel" autocomplete="tel" value="${html(contact.phone||'')}"></label>
    </fieldset>
    ${total>0?`<fieldset class="book-pay"><legend>${t('payTitle')}</legend>${['onsite','accommodation','online'].map((key,i)=>
      `<label><input type="radio" name="payment" value="${key}" ${i?'':'checked'}> ${t('pay_'+key)}</label>`).join('')}</fieldset>`:''}
    <div class="book-total"><span>${t('bookTotal')}</span><strong>${money(total)}</strong></div>
    <div class="dialog-actions"><button type="button" class="small" data-book-close>${t('cancel')}</button>
      <button type="submit" class="primary">${t('confirmBooking')}</button></div>`;
  $('book-dialog').showModal();
  $('book-content').querySelector('input[type=radio]:checked, input')?.focus();
}
function confirmBooking(form){
  const data=new FormData(form);
  const contact={name:data.get('name').trim(),email:data.get('email').trim(),phone:data.get('phone').trim()};
  try{localStorage.setItem('familienzeit-contact',JSON.stringify(contact))}catch{}
  // One booking number for the whole itinerary; activities added later join the same booking.
  state.tripRef||='FZ-'+Math.random().toString(36).slice(2,8).toUpperCase();
  const done=bookingDraft.map((item,i)=>{
    const start=Number(data.get('slot-'+i));
    const booking={index:item.entry.chosen.index,start,end:start+(item.entry.chosen.time.end-item.entry.chosen.time.start),
      ref:state.tripRef,payment:data.get('payment')||'',name:contact.name,date:item.day.date};
    state.bookings.set(item.entry.key,booking);
    state.picks.set(item.entry.key,item.entry.chosen.index);   // booked activities stay put when the plan is shuffled
    return {...item,booking};
  });
  saveState();
  renderResults();
  $('book-content').innerHTML=`<h2 id="book-title">${t('bookedTitle')}</h2>
    <p class="demo-banner">${t('demoBanner')}</p>
    <p>${t('bookedIntro',html(contact.email))}</p>
    <p class="trip-ref">${t('bookingNumber')} <code>${html(state.tripRef)}</code></p>
    <ul class="booked-list">${done.map(({a,day,booking})=>`<li><strong>${html(activityTitle(a))}</strong>
      <span>${html(dayText(day.date))} · ${timeText(booking.start)} · ${html(a.address||a.location[0])}</span></li>`).join('')}</ul>
    ${typeof walletBookingButtons==='function'?walletBookingButtons():''}
    <div class="dialog-actions"><button type="button" class="small" data-ics>📅 ${t('calendarFile')}</button>
      <button type="button" class="primary" data-book-close>${t('done')}</button></div>`;
  bookingDraft=done;
  $('book-content').insertAdjacentHTML('afterbegin',`<svg class="booked-mascots" viewBox="-60 -92 120 98" aria-hidden="true"><g transform="translate(-24 0)"><g class="hop-a">${bertaArt()}</g></g><g transform="translate(26 0)"><g class="hop-b">${murmliArt()}</g></g></svg>`);
  $('book-content').querySelector('[data-ics]').focus();
}
// Calendar file (.ics) with every booked activity of the trip.
function downloadCalendar(){
  const stamp=d=>d.replace(/-/g,'');
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00';
  const esc=s=>String(s).replace(/[\\;,]/g,c=>'\\'+c).replace(/\n/g,'\\n');
  const events=currentTrip().days.flatMap(day=>day.slots.flatMap(slot=>slot.entries.map(entry=>({entry,day,booking:bookingFor(entry)}))))
    .filter(row=>row.booking).map(({entry,day,booking})=>{
      const a=entry.chosen.activity;
      return ['BEGIN:VEVENT',`UID:${booking.ref}@familienzeit`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').slice(0,15)}Z`,
        `DTSTART:${stamp(day.date)}T${time(booking.start)}`,`DTEND:${stamp(day.date)}T${time(booking.end)}`,
        `SUMMARY:${esc(activityTitle(a))}`,`LOCATION:${esc(a.address||a.location[0])}`,
        `DESCRIPTION:${esc(`${t('demoBanner')} ${booking.ref}`)}`,'END:VEVENT'].join('\r\n');
    });
  const file=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Familienzeit//Reise-Canvas//DE',...events,'END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([file],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=`familienzeit-${state.place.toLowerCase()}.ics`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('book-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.querySelector('[data-ics]')) return;
  if(!event.target.reportValidity()) return;
  confirmBooking(event.target);
});
$('book-form').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(button?.hasAttribute('data-book-close')) $('book-dialog').close();
  else if(button?.hasAttribute('data-ics')) downloadCalendar();
});
$('results').addEventListener('click',event=>{
  const button=event.target.closest('[data-book-all],[data-cancel-trip]');
  if(!button) return;
  if(button.hasAttribute('data-book-all')) openBooking();
  else{
    state.bookings.clear();
    state.tripRef='';
    saveState();
    renderResults();
    $('announcement').textContent=t('bookingCancelled');
  }
});
