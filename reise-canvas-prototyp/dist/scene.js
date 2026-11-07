const towns={
  Serfaus:{sky:['#bbdce4','#f1e5b9'],far:'#91b3bd',hill:'#739c86',lawn:'#688c67'},
  Fiss:{sky:['#b9dce6','#e7edcb'],far:'#88a9bd',hill:'#7b9c74',lawn:'#577d66'},
  Ladis:{sky:['#d0dcec','#f3debd'],far:'#a3aabd',hill:'#829172',lawn:'#587967'}
};
const choices={
  adventure:{path:'M-10 7 0-9 10 7ZM-3-4 0 0 3-4'},
  water:{path:'M0-10C-2-6-7-1-7 3a7 7 0 0 0 14 0C7-1 2-6 0-10Z'},
  play:{path:'M0-10 3-3 11-3 5 2 7 10 0 5-7 10-5 2-11-3-3-3Z'},
  discover:{path:'M4-2a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM2 3 9 10'},
  calm:{path:'M-7 7Q-9-8 8-9 9 6-7 7ZM-10 10 4-4'},
  sport:{path:'M-9 0H9M-6-5V5M6-5V5M-9-3V3M9-3V3'},
  wellness:{path:'M0 8Q-12 3-9-4-3-3 0 3 3-3 9-4 12 3 0 8ZM-4-1 0-8 4-1'},
  food:{path:'M-8-8V-2Q-4 2 0-2V-8M-4-8V9M7-8Q2-3 3 1H7V9Z'}
};
// The season of the trip drives the scene: winter (Nov–Apr) brings snow, beanies and falling flakes.
// poster() sets it while it draws, so editor previews stay hat-free.
let sceneSeason='summer';
const snowColors={'#bbdce4':'#c5d8e6','#f1e5b9':'#f1f3f5','#b9dce6':'#c5d8e6','#e7edcb':'#f1f3f5','#d0dcec':'#cbd6e6','#f3debd':'#f2f0ee',
  '#739c86':'#dfe9ef','#7b9c74':'#dfe9ef','#829172':'#dfe9ef','#688c67':'#eef4f7','#577d66':'#eef4f7','#587967':'#eef4f7',
  '#8eab73':'#d3e0e9','#a5b47b':'#d3e0e9','#91a270':'#d3e0e9','#708c6e':'#c6d5df','#deca9a':'#c7d3dc',
  '#78acb3':'#b3cfdc','#7aaab3':'#b3cfdc','#c1d9cb':'#e6f0f5','#d0dfd0':'#e6f0f5','#f6d278':'#ffffff'};
const winterize=svg=>svg.replace(/#[0-9a-f]{6}\b/gi,c=>snowColors[c.toLowerCase()]||c);
function snowfall(animated){
  let flakes='';
  for(let i=0;i<56;i++){
    const x=Math.round((i*137.508)%960), r=(1.1+(i%4)*.6).toFixed(1);
    flakes+=animated
      ?`<circle class="flake" cx="${x}" cy="-12" r="${r}" style="animation-duration:${7+i%6}s;animation-delay:-${((i*1.37)%13).toFixed(2)}s"/>`
      :`<circle cx="${x}" cy="${Math.round((i*71.3)%540)}" r="${r}"/>`;
  }
  return `<g fill="#fff" opacity=".9" aria-hidden="true">${flakes}</g>`;
}
function rainfall(animated,heavy){
  let drops='';
  for(let i=0;i<(heavy?72:50);i++){
    const x=Math.round((i*97.3)%990-10), len=14+(i%3)*5;
    drops+=animated
      ?`<path class="drop" d="M${x}-24l-5 ${len}" style="animation-duration:${(.7+(i%5)*.12).toFixed(2)}s;animation-delay:-${((i*.37)%1.3).toFixed(2)}s"/>`
      :`<path d="M${x} ${Math.round((i*53.7)%540)}l-5 ${len}"/>`;
  }
  return `<g stroke="#eef4f9" stroke-width="1.6" stroke-linecap="round" opacity=".75" aria-hidden="true">${drops}</g>`;
}
// Weather on the postcard: a darker sky and cloud cover, fog bands, rain, snow or lightning.
// Puffy cloud: overlapping puffs over a slightly lower, darker copy (the shaded underside) and a highlight.
function cloud(x,y,scale,{light='#ffffff',shade='#dbe4ec',delay=0}={}){
  const puffs=(dy,grow)=>`<circle cx="-38" cy="${-8+dy}" r="${18+grow}"/><circle cx="-10" cy="${-24+dy}" r="${25+grow}"/><circle cx="22" cy="${-18+dy}" r="${21+grow}"/><circle cx="46" cy="${-6+dy}" r="${14+grow}"/><rect x="-56" y="${-12+dy}" width="116" height="${12+grow}" rx="6"/>`;
  return `<g class="drift" style="animation-delay:-${delay}s"><g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="4" cy="6" rx="68" ry="10" fill="${shade}" opacity=".45"/>
    <g fill="${shade}">${puffs(3,2)}</g><g fill="${light}">${puffs(0,0)}</g>
    <ellipse cx="-14" cy="-36" rx="12" ry="5" fill="#ffffff" opacity=".75"/></g></g>`;
}
function skyWeather(kind,id){
  if(kind==='sun') return '';
  if(kind==='partly') return `<g aria-hidden="true">${cloud(650,160,.95,{delay:4})}${cloud(330,104,.75,{delay:9})}</g>`;
  const shade={cloud:.14,fog:.06,rain:.28,snow:.16,storm:.42}[kind];
  // Overcast, rain and storm: a layered bank of puffy clouds (grey for rain, dark for storm).
  const tone=kind==='storm'?{light:'#9aa3ad',shade:'#6f7884'}:kind==='rain'?{light:'#e1e6eb',shade:'#b7c0c9'}:{light:'#f4f6f8',shade:'#d3dbe2'};
  const bank=kind==='fog'?'':[[60,80,1.45],[235,64,1.65],[410,88,1.4],[570,60,1.7],[745,86,1.45],[905,66,1.55],[150,128,1.05],[660,130,1.1]]
    .map(([x,y,s],i)=>cloud(x,y,s,{...tone,delay:i*3})).join('');
  // Fog: a soft vertical mist gradient plus drifting haze, no hard-edged bands.
  const fog=kind==='fog'?`<defs><linearGradient id="${id}-mist" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f7" stop-opacity="0"/><stop offset=".45" stop-color="#f4f6f7" stop-opacity=".62"/><stop offset="1" stop-color="#f4f6f7" stop-opacity=".2"/></linearGradient></defs>
    <rect y="140" width="960" height="400" fill="url(#${id}-mist)"/><g fill="#f7f9fa" opacity=".5"><ellipse class="drift" cx="300" cy="300" rx="280" ry="24"/><ellipse class="drift" style="animation-delay:-10s" cx="690" cy="352" rx="320" ry="28"/></g>`:'';
  const bolt=kind==='storm'?'<path class="flash" d="M600 120 572 196h24l-30 86 66-112h-26l24-50Z" fill="#fff4b8"/>':'';
  return `<g aria-hidden="true"><rect width="960" height="540" fill="#4d5a68" opacity="${shade}"/>${bank}${fog}${bolt}</g>`;
}
const precipitation=(kind,animated)=>kind==='snow'?snowfall(animated):kind==='rain'||kind==='storm'?rainfall(animated,kind==='storm'):'';
const palette=['#dfaa46','#d1745a','#7a9cae','#a08cb7','#6c9b84'];
const tones=['#e7b482','#b77859','#f2c299','#925f46','#fbdcbd','#6b4433'];
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function avatarStage(p){
  if(p.kind==='adult') return p.age>=65?'senior':'adult';
  return p.kind!=='child'?p.kind:p.age<=1?'baby':p.age<=5?'little':p.age<=11?'school':'teen';
}
const avatarName=p=>p.name||t(avatarStage(p));
function cabin(x,y,scale){
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M3 17h50v31H3z" fill="#f4e5c4"/><path d="m-4 20 30-20 34 20z" fill="#955841"/>${sceneSeason==='winter'?'<path d="M-4 20 26 0 60 20" stroke="#f4f8fa" stroke-width="6" fill="none" stroke-linejoin="round"/>':''}<path d="M10 25h9v9h-9zm28 0h9v9h-9z" fill="#526a62"/><path d="M24 34h10v14H24z" fill="#a18063"/></g>`;
}
function fir(x,y,scale){
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0-16 30h8l-14 19h44L8 30h8Z" fill="#375d55"/>${sceneSeason==='winter'?'<path d="M0 0-11 21Q-5 17 0 20 5 16 11 21Z" fill="#f4f8fa"/>':''}<path d="M-2 49h4v11h-4z" fill="#74594b"/></g>`;
}
function landscape(place,id){
  const p=towns[place];
  const base=`<defs><linearGradient id="${id}-sky" x2="0" y2="1"><stop stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient></defs>
    <rect width="960" height="540" fill="url(#${id}-sky)"/>
    <circle cx="${place==='Fiss'?750:690}" cy="121" r="45" fill="#f2cb70" opacity=".87"/>
    ${cloud(175,122,.85)}${cloud(560,90,.6,{delay:7})}${cloud(820,168,.48,{delay:13})}
    <path d="M-30 328 153 182 210 220 320 133 440 259 526 198 621 255 726 150 803 218 872 192 991 309V540H-30Z" fill="${p.far}"/>
    <path d="m274 172 46-39 49 52-37-16-13 12-12-20zm416 19 36-41 46 45-31-12-14-12-13 13z" fill="#f7f3df"/>
    <path d="M0 322Q164 233 351 304T628 294Q808 231 960 299V540H0Z" fill="${p.hill}"/> `;
  const scene=place==='Serfaus'
    ? `<path d="M0 380Q149 300 338 342T656 329Q835 300 960 350V540H0Z" fill="#8eab73"/>
      ${cabin(690,273,1.15)}${cabin(756,287,.95)}${cabin(620,286,.91)}${cabin(827,286,.85)}
      <g transform="translate(735 225)"><rect x="8" y="27" width="20" height="79" fill="#eee5ce"/><path d="M4 28 18 0l14 28z" fill="#796759"/><circle cx="18" cy="47" r="4" fill="#566e64"/><path d="M14 76h8v22h-8z" fill="#a8977c"/></g>`
    : place==='Fiss'
    ? `<path d="M0 392Q221 280 430 326T960 309V540H0Z" fill="#a5b47b"/>
      <path d="M445 364q88-52 221-34 105 14 219 3-15 53-173 56-111 24-267-25Z" fill="#78acb3"/>
      <path d="M497 360q143-31 291-9m-219 22 130 3" stroke="#c1d9cb" stroke-width="4" opacity=".85" fill="none"/>${cabin(782,292,.75)}`
    : `<path d="M0 385Q193 320 418 361 618 329 685 290q107-58 275 11V540H0Z" fill="#91a270"/>
       <path d="M651 319q57-73 120-69 55 0 80 57z" fill="#708c6e"/>
       <path d="M719 282v-68h35v27h23v-15h20v53z" fill="#d9c9ac" stroke="#a58e76" stroke-width="2"/>
       <path d="M719 214v-9h8v9m6 0v-9h8v9m6 0v-9h7v9m15 65h10" fill="none" stroke="#d9c9ac" stroke-width="5"/>
       <path d="M731 228h5v12h-5zm51 12h5v11h-5z" fill="#665f58"/>
       <path d="M526 375q111-31 173-23 72 8 130 11-31 39-185 39-85-6-118-27z" fill="#7aaab3"/>
       <path d="M587 379q107-13 176-2" fill="none" stroke="#d0dfd0" stroke-width="4"/>${cabin(845,293,.78)}`;
  const art=base+scene+`<path d="M0 401Q130 361 261 404 402 440 550 407 778 363 960 394V540H0Z" fill="${p.lawn}"/>
    <path d="M234 540q108-69 274-101 111-23 286-17-146 20-243 45-97 25-153 73Z" fill="#deca9a"/>
    ${fir(96,337,1.2)}${fir(61,362,.88)}${fir(902,325,1.28)}${fir(928,354,.9)}
    <g fill="#f6d278"><circle cx="107" cy="469" r="3"/><circle cx="136" cy="486" r="3"/><circle cx="804" cy="470" r="3"/><circle cx="823" cy="482" r="3"/></g>
    <rect x="14" y="14" width="932" height="512" rx="3" fill="none" stroke="#fff9e7" stroke-width="2" opacity=".72"/>`;
  return sceneSeason==='winter'?winterize(art):art;
}
const hairShapes=[
  'M-19 1C-25-16-13-24 2-23 18-23 24-12 19 2L12-5C4 1-8-5-11-10L-19 1Z',
  'M-19 3Q-23 0-21-6Q-26-10-20-15Q-21-22-13-21Q-10-28-3-24Q3-29 8-24Q17-27 19-20Q26-19 22-12Q26-6 20 1L15-6Q11-4 8-9Q3-4-2-9Q-8-5-13-8Z',
  'M-19 1Q-23-13-12-20Q-1-25 11-20Q22-16 20-1L15-4 14-12Q0-7-14-12L-15-3Z',
  'M-22 15Q-25-4-18-16Q-10-26 3-22Q16-25 21-12Q25-2 22 15L15 13 16-5Q8-8 1-15Q-5-8-15-5L-15 13Z',
  'M-20 4Q-25-12-12-20Q-3-26 6-22Q24-20 20-4L15-7Q11-4 7-5L8-14Q-3-6-15-6L-16 3Z'
];
const hairColors=['#4a352e','#2f2d34','#a76b42','#56423b','#72635e','#d6b46c','#b4482f','#cdc8bf'];
const greyHair=7;
const adultFits=[
  {head:-124,shoulder:-98,width:22,hem:-48,r:18,clothes:'jacket'},
  {head:-118,shoulder:-91,width:25,hem:-42,r:19,clothes:'stripe'},
  {head:-127,shoulder:-102,width:18,hem:-54,r:17,clothes:'vest'},
  {head:-116,shoulder:-90,width:21,hem:-47,r:19,clothes:'hoodie'},
  {head:-121,shoulder:-95,width:24,hem:-49,r:18,clothes:'sweater'}
];
const childFits={
  little:{head:-56,shoulder:-38,width:13,hem:-16,r:18,clothes:'overalls'},
  school:{head:-78,shoulder:-58,width:16,hem:-29,r:18,clothes:'pack'},
  teen:{head:-103,shoulder:-79,width:17,hem:-42,r:17,clothes:'hoodie'}
};
function clothingDetail(clothes,width,shoulder,hem){
  const chest=shoulder+17;
  const thread='#fff1d5';
  if(clothes==='overalls') return `<path d="M-10 ${shoulder+4}v13m20-13v13" stroke="#365e68" stroke-width="4"/><rect x="-11" y="${shoulder+11}" width="22" height="${hem-shoulder-8}" rx="4" fill="#365e68"/><circle cx="-6" cy="${shoulder+16}" r="1.5" fill="${thread}"/><circle cx="6" cy="${shoulder+16}" r="1.5" fill="${thread}"/>`;
  if(clothes==='pack') return `<path d="M-12 ${shoulder+4}l4 15m20-15-4 15" fill="none" stroke="#3c6460" stroke-width="4" stroke-linecap="round"/><path d="M-9 ${hem-7}H9" stroke="${thread}" stroke-width="2" opacity=".65"/>`;
  if(clothes==='jacket') return `<path d="M0 ${shoulder+4}V${hem+1}m-7-10-7 3m21-3 7 3" stroke="${thread}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  if(clothes==='stripe') return `<path d="M${-width+2} ${chest}H${width-2}m${-2*width+2} 8h${2*width-2}" stroke="${thread}" stroke-width="3" opacity=".72"/>`;
  if(clothes==='vest') return `<path d="M-11 ${shoulder+3}l3 15H8l3-15M0 ${chest}V${hem}" stroke="#365e68" stroke-width="2.5" fill="none"/><rect x="-7" y="${hem-13}" width="14" height="6" rx="2" fill="#365e68"/>`;
  if(clothes==='hoodie') return `<path d="M-10 ${shoulder+1}Q0 ${chest} 10 ${shoulder+1}M-5 ${shoulder+7}v7m10-7v7" stroke="${thread}" stroke-width="1.9" fill="none" stroke-linecap="round"/><path d="M-9 ${hem-5}l3-5H6l3 5Z" fill="#344c4e" opacity=".34"/>`;
  return `<path d="M-6 ${shoulder+1}q6 7 12 0" stroke="${thread}" stroke-width="2.5" fill="none"/><path d="M${-width+2} ${hem-3}H${width-2}" stroke="${thread}" stroke-width="2" opacity=".55"/>`;
}
function dogArt(look,shadow){
  const coats=[['#bb8961','#7e5341','#e4ba8b'],['#e3c8a3','#855b46','#f5deb4'],['#777c80','#444d55','#c5c4b5'],['#9b6450','#684033','#d6a076']];
  const [coat,dark,muzzle]=coats[look%coats.length];
  const short=look%2===1;
  const y=short?4:0;
  return {height:short?43:49,svg:shadow+`<g transform="translate(0 ${y})">
    <path d="${short?'M-23-22Q-39-25-33-36':'M-24-22Q-36-18-40-30'}" stroke="${dark}" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M-16 -15L-20 ${-2-y} M13 -15L14 ${-2-y}" stroke="${dark}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <ellipse cy="-21" rx="26" ry="13" fill="${coat}"/><path d="M-22-24q6-13 15-6 5 6-2 13-10 3-13-7Z" fill="${dark}" opacity=".72"/>
    <circle cx="20" cy="-34" r="13" fill="${coat}"/>
    <path d="${short?'M11-40 8-51 21-44 18-37Z':'M13-45q-12 1-9 14 2 5 8 2l7-11Z'}" fill="${dark}"/>
    <ellipse cx="30" cy="-29" rx="11" ry="7" fill="${muzzle}"/>
    <circle cx="24" cy="-36" r="1.9" fill="#263439"/><ellipse cx="39" cy="-31" rx="4" ry="3" fill="#263439"/>
  </g>`};
}
function humanArt(p,stage,look,shadow){
  const grown=stage==='adult'||stage==='senior';
  const fit=grown?adultFits[look%adultFits.length]:childFits[stage];
  // Editor sliders: height stretches the body below the head, build widens the torso.
  const hf=1+(p.body?.height||0)*.04, wf=1+(p.body?.weight||0)*.07;
  const {r,clothes}=fit, head=Math.round(fit.head*hf), shoulder=fit.shoulder*hf, hem=fit.hem*hf, width=fit.width*wf;
  const v=lookOf(p);
  const hair=v.hair, hairColor=hairColors[v.hairColor], skin=tones[v.skin], shirt=palette[v.shirt];
  const little=stage==='little';
  const child=stage==='school';
  const legs=little?8:child?8:10;
  const handY=little?-29:shoulder+Math.round((hem-shoulder)*.74);
  const pants=p.pants!=null?pantsColors[p.pants]:little?'#365e68':'#293f4b';
  const needs=p.needs||new Set();
  // Accessibility needs are drawn: wheelchair (seated, front view), rollator, white cane.
  const seated=needs.has('wheelchair'), walker=needs.has('walker')&&!seated;
  const seat=Math.min(-20,Math.round(hem*.6)), dy=seated?seat-hem:0;
  const frame='#4f5f66';
  const wheel=Math.round(-seat*.85)+3, wx=width+12;
  const legsArt=seated
    ?`<rect x="${-width-6}" y="${seat-36}" width="${2*width+12}" height="38" rx="5" fill="${frame}"/>
      <g fill="none" stroke-width="4"><ellipse cx="${-wx}" cy="${-wheel}" rx="5" ry="${wheel}" stroke="#2f3b40"/><ellipse cx="${wx}" cy="${-wheel}" rx="5" ry="${wheel}" stroke="#2f3b40"/></g>
      <path d="M-7 ${seat+3}V-7M8 ${seat+3}V-7" stroke="${pants}" stroke-width="${legs}" stroke-linecap="round"/>
      <path d="M-13-3h28" stroke="${frame}" stroke-width="4" stroke-linecap="round"/><path d="M-11-6h-3m25 0h3" stroke="#34444b" stroke-width="6" stroke-linecap="round"/>
      <rect x="${-width-8}" y="${seat-1}" width="${2*width+16}" height="6" rx="3" fill="${frame}"/>`
    :`<path d="M-8 ${hem}l-3 ${-hem-5}m19 ${hem+5} 3 ${-hem-5}" stroke="${pants}" stroke-width="${legs}" stroke-linecap="round" fill="none"/>
      <path d="M-10-4h-5m26 0h5" stroke="#34444b" stroke-width="${little?6:7}" stroke-linecap="round"/>`;
  const handX=width+8;
  const aids=(walker?`<g stroke="#c8553d" stroke-width="3" stroke-linecap="round" fill="none"><path d="M${-handX} ${handY}V-6M${handX} ${handY}V-6M${-handX} ${Math.round(handY/2)}H${handX}"/></g><circle cx="${-handX}" cy="-4" r="4" fill="#2f3b40"/><circle cx="${handX}" cy="-4" r="4" fill="#2f3b40"/>`:'')+
    (needs.has('vision')?`<path d="M${-handX} ${handY+dy}L${-handX-18} -1" stroke="#f4f4f0" stroke-width="3" stroke-linecap="round"/><path d="M${-handX-15} -6.5 ${-handX-18} -1" stroke="#c8553d" stroke-width="3.4" stroke-linecap="round"/>`:'');
  return {height:-head-dy+r+7,headY:head+dy,headR:r,svg:shadow+`
    ${legsArt}
    <g transform="translate(0 ${dy})">
    <path d="M${-width+3} ${shoulder+8}L${-width-8} ${handY}M${width-3} ${shoulder+8}L${width+8} ${handY-(little?7:0)}" stroke="${shirt}" stroke-width="${little?9:10}" stroke-linecap="round" fill="none"/>
    <circle cx="${-width-8}" cy="${handY}" r="4" fill="${skin}"/><circle cx="${width+8}" cy="${handY-(little?7:0)}" r="4" fill="${skin}"/>
    <path d="M${-width} ${shoulder+5}Q0 ${shoulder-7} ${width} ${shoulder+5}L${width+2} ${hem}Q0 ${hem+4} ${-width-2} ${hem}Z" fill="${shirt}"/>
    ${clothingDetail(clothes,width,shoulder,hem)}
    ${stage==='senior'&&!seated&&!walker?`<path d="M${width+8} ${handY}V0m0 ${handY}q0-7 7-7" stroke="#7a5a43" stroke-width="3.5" stroke-linecap="round" fill="none"/>`:''}
    ${faceArt(head,r,skin,hair,hairColor,look,stage,p)}</g>
    ${aids}`};
}
// Appearance as palette indexes: chosen in the editor, otherwise derived from id/look like before.
function lookOf(p){
  const stage=avatarStage(p), look=p.look??0;
  const autoHair=(look+Math.floor(look/adultFits.length)*2+(stage==='little'?1:0))%hairShapes.length;
  return {skin:p.skin??p.id%tones.length,shirt:p.shirt??p.id%palette.length,hair:p.hair??autoHair,
    hairColor:p.hairColor??(stage==='senior'?greyHair:(autoHair+look)%5)};
}
function avatarFigure(p){
  const ink='#233b4a', skin=tones[p.skin??p.id%tones.length], shirt=palette[p.shirt??p.id%palette.length];
  const stage=avatarStage(p);
  const look=p.look??0;
  const shadow='<ellipse cx="0" cy="2" rx="26" ry="4" fill="#213e40" opacity=".23"/>';
  if(stage==='care') return {height:119,svg:shadow+`<path d="M-32-24v-53a32 32 0 0 1 64 0v53q0 10-9 6l-8-4-9 6-9-6-9 6-9-6-5 3q-6 2-6-5Z" fill="#f6f0ff" fill-opacity=".88" stroke="#746295" stroke-width="3" stroke-dasharray="6 4"/><g fill="#4c3f67"><circle cx="-9" cy="-75" r="3"/><circle cx="9" cy="-75" r="3"/></g><path d="M-5-63q5 6 10 0" stroke="#4c3f67" stroke-width="2" stroke-linecap="round" fill="none"/>`};
  if(stage==='dog') return dogArt(look,shadow);
  if((stage==='baby'||stage==='little')&&p.needs?.has('stroller')) return {height:80,headY:-52,headR:12,svg:shadow+`
    <path d="M30-46 40-70h9" stroke="#3b4a50" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M-18-9 0-26 20-9" stroke="#3b4a50" stroke-width="2.5" fill="none"/>
    <circle cx="-18" cy="-9" r="9" fill="#2f3b40"/><circle cx="-18" cy="-9" r="3.5" fill="#c9d3d6"/><circle cx="20" cy="-9" r="9" fill="#2f3b40"/><circle cx="20" cy="-9" r="3.5" fill="#c9d3d6"/>
    <circle cx="14" cy="-52" r="12" fill="${skin}"/><path d="M8-61q-1-6 6-5" stroke="#573d35" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M9-52q2 2.5 4 0m4 0q2 2.5 4 0" stroke="${ink}" stroke-width="1.5" fill="none"/>
    <path d="M-32-46H32Q30-20 0-18-30-20-32-46Z" fill="${shirt}"/><path d="M-32-46Q-34-80 2-78V-46Z" fill="${shirt}" opacity=".8"/>
    <path d="M-28-40H28" stroke="#fff3dd" stroke-width="2" opacity=".6"/>`};
  if(stage==='baby') return {height:70,headY:-49,headR:18,svg:shadow+`<ellipse cy="-21" rx="25" ry="23" fill="${shirt}"/><path d="m-20-29 35 25m6-25L-14-7" stroke="#ffefd0" stroke-width="3" opacity=".6"/><circle cy="-49" r="18" fill="${skin}"/><path d="M-5-65q-2-8 7-6 5 2 1 6" fill="none" stroke="#573d35" stroke-width="3" stroke-linecap="round"/><path d="M-9-48q3 4 6 0m6 0q3 4 6 0" fill="none" stroke="${ink}" stroke-width="1.8"/><circle cy="-42" r="2.6" fill="#efbc60"/>`};
  return humanArt(p,stage,look,shadow);
}
// Region mascots (own simplified drawings): Murmli the marmot and Berta the cow. Origin = feet.
const mascotShadow=rx=>`<ellipse cy="2" rx="${rx}" ry="4" fill="#213e40" opacity=".23"/>`;
function murmliArt(){
  return mascotShadow(20)+`<path d="M-10 0h-6M10 0h6" stroke="#6d4a33" stroke-width="5" stroke-linecap="round"/>
    <path d="M-19 0Q-25-30-13-44Q0-54 13-44Q25-30 19 0Z" fill="#9a6a45"/>
    <ellipse cy="-19" rx="11" ry="15" fill="#e2c39a"/>
    <path d="M-12-27q-6 3-4 9M12-27q6 3 4 9" stroke="#7d5536" stroke-width="5" stroke-linecap="round" fill="none"/>
    <circle cx="-11" cy="-60" r="5" fill="#9a6a45"/><circle cx="11" cy="-60" r="5" fill="#9a6a45"/>
    <circle cx="-11" cy="-60" r="2.4" fill="#6d4a33"/><circle cx="11" cy="-60" r="2.4" fill="#6d4a33"/>
    <circle cy="-49" r="15" fill="#9a6a45"/>
    <path d="M-11-36q11 7 22 0l-2 5q-9 4-18 0Z" fill="#c8553d"/>
    <ellipse cy="-43" rx="8" ry="6" fill="#e2c39a"/>
    <circle cx="-6" cy="-52" r="2" fill="#263439"/><circle cx="6" cy="-52" r="2" fill="#263439"/>
    <ellipse cy="-46" rx="2.6" ry="1.8" fill="#3b2a22"/><path d="M-2-42.5h4v4h-4z" fill="#fffdf5"/>`;
}
function bertaArt(){
  return mascotShadow(22)+`<path d="M-9-14V0M9-14V0" stroke="#f7f3ea" stroke-width="8" stroke-linecap="round"/>
    <path d="M-9 0v0M9 0v0" stroke="#4a3a33" stroke-width="8" stroke-linecap="round"/>
    <path d="M-17-36q-8 6-6 14M17-36q8 6 6 14" stroke="#f7f3ea" stroke-width="7" stroke-linecap="round" fill="none"/>
    <ellipse cy="-29" rx="18" ry="21" fill="#f7f3ea" stroke="#d8cfc0"/>
    <path d="M-14-38q6-8 12-2-2 9-11 8ZM5-20q8-4 11 4-5 7-11 2Z" fill="#8a5a3c"/>
    <path d="M-12-51q12 5 24 0" stroke="#c8553d" stroke-width="3" fill="none"/><path d="M-5-49h10l2 9h-14Z" fill="#e7b545"/>
    <path d="M-11-75q-8-3-6-11M11-75q8-3 6-11" stroke="#efe2c0" stroke-width="4" stroke-linecap="round" fill="none"/>
    <ellipse cx="-19" cy="-69" rx="7" ry="4" fill="#8a5a3c" transform="rotate(-20 -19 -69)"/><ellipse cx="19" cy="-69" rx="7" ry="4" fill="#8a5a3c" transform="rotate(20 19 -69)"/>
    <ellipse cy="-67" rx="15" ry="14" fill="#f7f3ea"/><path d="M2-80q10-1 12 9-7 2-12-3Z" fill="#8a5a3c"/>
    <circle cx="-6" cy="-69" r="2" fill="#263439"/><circle cx="6" cy="-69" r="2" fill="#263439"/>
    <ellipse cy="-58" rx="11" ry="7" fill="#f2b5a4"/><circle cx="-4" cy="-58" r="1.5" fill="#9b5a4d"/><circle cx="4" cy="-58" r="1.5" fill="#9b5a4d"/>`;
}
const mascots={murmli:{name:'Murmli',art:murmliArt},berta:{name:'Berta',art:bertaArt}};
// Mascots keep the bottom-left corner (x < 170); the family is laid out in x 180–920 so it never covers them.
const mascotScene=()=>`<g aria-hidden="true"><g transform="translate(76 474) scale(.8)"><g class="mascot-wave">${bertaArt()}</g></g><g transform="translate(130 480) scale(.7)"><g class="mascot-wave" style="animation-delay:-2s">${murmliArt()}</g></g></g>`;
const peopleArea={x:180,width:740};
function badge(key,x,y){
  return `<g transform="translate(${x} ${y})"><circle r="11.5" fill="#fff5d9" stroke="#59796a" stroke-width="1.2"/><path d="${choices[key].path}" transform="scale(.63)" fill="none" stroke="#245748" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
function personArt(p,x,y,scale,interactive,tag=''){
  const figure=avatarFigure(p);
  const selected=[...p.wishes];
  const badges=selected.map((key,i)=>badge(key,(i-(selected.length-1)/2)*24,-figure.height-19-(i%2)*5)).join('');
  const label=avatarName(p)+(p.kind!=='dog'&&p.age!=null?', '+ageText(p):'');
  return `<g transform="translate(${x} ${y}) scale(${scale})" data-member="${p.id}" ${interactive?`class="avatar-mark" role="button" tabindex="0" data-avatar="${p.id}" aria-label="${html(t(p.kind==='dog'?'avatarRemove':'avatarEdit',label))}"`:''}>
    <g data-figure="${p.id}"><rect x="-41" y="${-figure.height-4}" width="82" height="${figure.height+12}" rx="12" fill="#fff" fill-opacity=".001"/>
    ${interactive?`<ellipse class="avatar-ring" cy="2" rx="33" ry="7" fill="none" stroke="#fff4cf" stroke-width="2" opacity="0"/>`:''}
    <g class="idle" style="animation-delay:-${(typeof p.id==='number'?p.id*.61:0)%3.4}s">${figure.svg}</g>${badges}
    ${p.name?`<text y="${-figure.height-(selected.length?45:12)}" text-anchor="middle" font-size="15" font-weight="800" fill="#fff5d9" stroke="#254a42" stroke-width="3" paint-order="stroke">${html(p.name)}</text>`:''}</g>
    ${tag?`<text y="26" text-anchor="middle" font-size="17" font-weight="800" fill="#fff5d9" stroke="#254a42" stroke-width="3" paint-order="stroke">${tag}</text>`:''}</g>`;
}
function groupedArt(family,groups,interactive=false){
  const teams=groups.map(group=>group.id==='care'
    ?{...group,members:[{id:'care',kind:'care',wishes:new Set()},...group.members]}
    :group);
  const gap=25;
  const count=teams.reduce((sum,group)=>sum+group.members.length,0);
  const unit=Math.min(102,(peopleArea.width-(teams.length-1)*gap)/count);
  const scale=Math.min(1,unit/91);
  let x=peopleArea.x+(peopleArea.width-(unit*count+gap*(teams.length-1)))/2;
  const children=family.filter(p=>p.kind==='child');
  const dogs=family.filter(p=>p.kind==='dog');
  return teams.map(group=>{
    const width=group.members.length*unit;
    const markWidth=Math.min(width,92);
    const center=x+width/2;
    const figures=group.members.map((p,index)=>{
      const tag=p.kind==='child'?t('childTag',children.indexOf(p)+1):p.kind==='dog'?t('dogTag',dogs.indexOf(p)+1):'';
      return personArt(p,x+(index+.5)*unit,445,scale,interactive,tag);
    }).join('');
    const label=`<path d="M${x} 483h${width}" stroke="${group.color}" stroke-width="2.5" stroke-linecap="round"/><rect x="${center-markWidth/2}" y="489" width="${markWidth}" height="24" rx="7" fill="${group.color}"/><text x="${center}" y="505" text-anchor="middle" font-size="13" font-weight="800" fill="#173443">${group.label}</text>`;
    const team=`<g data-team="${group.id}" data-x0="${x}" data-x1="${x+width}">${label}${figures}</g>`;
    x+=width+gap;
    return team;
  }).join('');
}
function poster({place,family,date,general=new Set(),id='card',interactive=false,groups=[],periodLabel='',season='summer',weather=null}){
  sceneSeason=season;
  const winter=season==='winter';
  const sky=weather?.kind||(winter?'snow':'sun');
  const count=family.length;
  const spacing=count>7?72:Math.min(107,550/Math.max(count,1));
  const scale=count>7?.76:1;
  const split=groups.length>1;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" ${interactive?'':'role="img"'} aria-label="${t(interactive?'interactivePostcard':'illustratedPostcard')}" font-family="system-ui, sans-serif">
    ${landscape(place,id)}
    ${skyWeather(sky,id)}
    <text x="41" y="51" font-size="15" font-weight="800" fill="#21483e" letter-spacing="4">${t('postcardTitle')}</text>
    <text x="38" y="108" font-size="56" font-weight="700" font-family="Fraunces, Georgia, serif" fill="#173c3c">${place}</text>
    <text x="42" y="138" font-size="15" font-weight="650" fill="#234a45">${t('motif'+place)}</text>
    ${date?`<g transform="translate(694 34)"><rect width="223" height="63" rx="9" fill="#fff6db" stroke="#9f9a77" stroke-dasharray="4 3"/><text x="13" y="21" fill="#86602e" font-size="10" font-weight="800" letter-spacing="2">${t('postcardDate')}</text><text x="210" y="21" text-anchor="end" fill="#86602e" font-size="11" font-weight="800">${weather?`${weatherIcons[weather.kind]} ${weather.tmax}°`:t(winter?'seasonWinter':'seasonSummer')}</text><text x="13" y="45" font-size="18" font-weight="750" fill="#21483e">${html(date)}</text></g>`:''}
    ${periodLabel?`<g transform="translate(694 105)"><rect width="223" height="25" rx="6" fill="#21483e"/><text x="111.5" y="17" text-anchor="middle" font-size="13" font-weight="750" fill="#fff5d9">${html(periodLabel)}</text></g>`:''}
    ${split?groupedArt(family,groups,interactive):family.map((p,i)=>personArt(p,peopleArea.x+peopleArea.width/2+(i-(count-1)/2)*spacing,463,scale,interactive)).join('')}
    ${mascotScene()}
    ${precipitation(sky,id!=='export-art')}
    ${general.size?`<g><text x="918" y="${split?166:467}" text-anchor="end" font-size="12" font-weight="800" fill="${split||winter?'#21483e':'#fff5d9'}" letter-spacing="1.4">${t('postcardInterests')}</text>${[...general].map((key,i)=>badge(key,906-(general.size-1-i)*27,split?185:496)).join('')}</g>`:''}
    ${split?'':`<text x="44" y="505" font-size="14" letter-spacing="2.4" font-weight="750" fill="${winter?'#21483e':'#fff5d9'}">SERFAUS · FISS · LADIS</text>`}
    ${interactive&&!count?`<g class="mascot-bubble"><path d="M150 360H610Q622 360 622 372V410Q622 422 610 422H190L150 446 162 422H150Q138 422 138 410V372Q138 360 150 360Z" fill="#fffdf5" stroke="#c9b47a" stroke-width="1.5"/>
      <text x="154" y="386" font-size="15" font-weight="800" fill="#245748">Murmli:</text><text x="154" y="407" font-size="14" font-weight="650" fill="#173443">${html(t('emptyCardBubble'))}</text></g>`:''}
  </svg>`;
  sceneSeason='summer';
  return svg;
}
// The back of the postcard: the WOW finale. Handwritten note, stamp with the mascots, postmark, address.
function wrapText(text,max){
  const lines=[''];
  for(const word of text.split(' ')){
    const next=(lines[lines.length-1]+' '+word).trim();
    if(next.length>max&&lines[lines.length-1]) lines.push(word);else lines[lines.length-1]=next;
  }
  return lines;
}
function postcardBack({place,family,date,general=new Set(),season='summer',weather=null}){
  const names=family.filter(p=>p.kind!=='dog').map(p=>p.name||avatarName(p));
  const dogs=family.filter(p=>p.kind==='dog').length;
  const who=new Intl.ListFormat(locale(),{type:'conjunction'}).format(dogs?[...names,dogs>1?t('backDogs',dogs):t('backDog')]:names);
  const wishes=[...new Set([...general,...family.flatMap(p=>[...p.wishes])])].slice(0,8);
  const forecast=weather&&t(weather.source==='forecast'?'backWeather':'backWeatherLastYear',t('weather_'+weather.kind),weather.tmax,weather.year);
  const lines=wrapText([t('backWho',who),date?t('backWhen',date):'',forecast||'',t(season==='winter'?'backWinter':'backSummer')].filter(Boolean).join(' '),36).slice(0,7);
  const hand='font-family="Caveat, \'Segoe Print\', \'Comic Sans MS\', cursive"';
  const ink='#3d4f7a';
  const wishY=176+lines.length*40+14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" role="img" aria-label="${html(t('backLabel'))}" font-family="system-ui, sans-serif">
    <rect width="960" height="540" fill="#fbf6e8"/>
    <rect x="14" y="14" width="932" height="512" rx="3" fill="none" stroke="#e6d9b8" stroke-width="2"/>
    <path d="M548 64V476" stroke="#dccfae" stroke-width="2"/>
    <g class="hand" style="animation-delay:.95s"><text x="56" y="116" ${hand} font-size="56" font-weight="700" fill="#245748">${html(t('backGreeting',place))}</text></g>
    ${lines.map((line,i)=>`<g class="hand" style="animation-delay:${(1.15+i*.22).toFixed(2)}s"><text x="60" y="${176+i*40}" ${hand} font-size="33" fill="#2c3e44">${html(line)}</text></g>`).join('')}
    ${wishes.length?`<g class="hand" style="animation-delay:${(1.2+lines.length*.22).toFixed(2)}s"><g transform="translate(72 ${wishY})">${wishes.map((key,i)=>badge(key,i*30,0)).join('')}</g></g>`:''}
    <g class="hand" style="animation-delay:${(1.4+lines.length*.22).toFixed(2)}s"><text x="60" y="462" ${hand} font-size="34" fill="#245748">${html(t('backSignoff'))}</text></g>
    <g transform="translate(470 486) scale(.62)"><g class="mascot-wave">${bertaArt()}</g></g><g transform="translate(514 490) scale(.55)"><g class="mascot-wave" style="animation-delay:-2s">${murmliArt()}</g></g>
    <g transform="translate(790 50) rotate(3)"><g class="stamp">
      <rect width="120" height="150" fill="#fff"/>
      <rect width="120" height="150" fill="none" stroke="#fbf6e8" stroke-width="9" stroke-dasharray=".1 10.9" stroke-linecap="round"/>
      <rect x="11" y="11" width="98" height="128" fill="${season==='winter'?'#cfe0ea':'#d7e8d6'}"/>
      <path d="M11 112 38 74 54 92 76 62 109 106V139H11Z" fill="${season==='winter'?'#eef4f7':'#8fb0a2'}"/>
      <path d="M68 73 76 62 84 73 79 70 76 74Z" fill="#fff"/>
      <g transform="translate(44 132) scale(.5)">${bertaArt()}</g><g transform="translate(76 134) scale(.45)">${murmliArt()}</g>
      <text x="60" y="32" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="2" fill="#245748">TIROL</text>
      <text x="60" y="47" text-anchor="middle" font-size="8" font-weight="800" letter-spacing="1.2" fill="#245748">FAMILIENZEIT</text>
    </g></g>
    <g transform="translate(742 170) rotate(-14)"><g class="postmark">
      <circle r="56" fill="none" stroke="${ink}" stroke-width="3" opacity=".8"/><circle r="45" fill="none" stroke="${ink}" stroke-width="1.5" opacity=".8"/>
      <text y="-20" text-anchor="middle" font-size="13" font-weight="800" letter-spacing="2" fill="${ink}" opacity=".85">${html(place.toUpperCase())}</text>
      <text y="6" text-anchor="middle" font-size="${date&&date.length>12?10:12}" font-weight="800" fill="${ink}" opacity=".85">${html(date||'')}</text>
      <text y="29" text-anchor="middle" font-size="10" font-weight="800" letter-spacing="1.5" fill="${ink}" opacity=".85">TIROL · AT</text>
      <path d="M60-18q12-8 24 0t24 0 24 0 24 0M62-4q12-8 24 0t24 0 24 0 24 0M60 10q12-8 24 0t24 0 24 0 24 0" stroke="${ink}" stroke-width="2.6" opacity=".7" fill="none"/>
    </g></g>
    <g stroke="#cdbf9e" stroke-width="2"><path d="M592 318H908M592 378H908M592 438H908"/></g>
    <g class="hand" style="animation-delay:${(1.6+lines.length*.22).toFixed(2)}s" ${hand} fill="#2c3e44">
      <text x="598" y="308" font-size="30">${html(t('backTo'))}</text>
      <text x="598" y="368" font-size="30">${html(place)} · Tirol</text>
      <text x="598" y="428" font-size="30">${html(t('backCountry'))}</text>
    </g>
    <text x="592" y="496" font-size="11" letter-spacing="3" font-weight="800" fill="#a8997a">${html(t('postcardTitle'))}</text>
  </svg>`;
}
