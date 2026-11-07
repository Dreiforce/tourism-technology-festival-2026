// Face parts for the Mii-style editor. Head space: face circle r=19 at 0,0; callers scale it.
// Every part is optional: faceOf() fills in defaults that reproduce the original look.
const eyeColors=['#28353a','#5a4031','#3f6fa0','#4f8a5b','#8a7340','#6b5b95'];
const lipColors=['#c4554d','#d77b74','#a8434f','#b8746a'];
const glassColors=['#3b4350','#8a5a3c','#c8553d','#2f6f7e','#c9a227'];
const pantsColors=['#293f4b','#365e68','#5b4636','#6d6f73','#7b2f3a','#2f5d8a'];
const faceShapes=[
  {d:'M-19 0a19 19 0 1 0 38 0a19 19 0 1 0-38 0Z',ear:17},
  {d:'M-17 0a17 20 0 1 0 34 0a17 20 0 1 0-34 0Z',ear:15.5},
  {d:'M-18-10Q-18-19-9-19H9Q18-19 18-10V8Q18 19 6 19H-6Q-18 19-18 8Z',ear:17},
  {d:'M-19-3Q-19-20 0-20 19-20 19-3Q18 12 0 20-18 12-19-3Z',ear:17}
];
const hairStyles=[
  ...hairShapes.map(front=>({front})),
  {front:''},
  {front:'M-18-4Q-18-21 0-21 18-21 18-4Q12-14 0-14-12-14-18-4Z'},
  {front:hairShapes[2],back:'M13-14Q31-10 27 10Q25 21 18 27Q21 10 11-6Z'},
  {front:hairShapes[2],back:'M-8-25a8 8 0 1 0 16 0a8 8 0 1 0-16 0Z'},
  {front:'M-18-3Q-19-19 0-19 19-19 18-3Q12-11 0-10-12-11-18-3Z',back:'M-27-5a27 26 0 1 0 54 0a27 26 0 1 0-54 0Z'},
  {front:'M-19 0Q-20-21 2-22 20-21 19-2L16-8Q6-14-6-10-13-7-19 0Z',back:'M-21 0Q-23-21 0-23 23-21 21 0L22 27H-22Z'},
  {front:'M-19-1L-17-14-21-17-12-19-13-26-4-21 0-29 4-21 13-26 12-19 21-17 17-14 19-1 14-8Q0-11-14-8Z'}
];
// Brows and eyes are drawn for the right side (+x = outward) and mirrored for the left.
const browStyles=[null,
  {d:'M-4 .5Q0-2 4 .5',w:1.6},{d:'M-4.2 0H4.2',w:2.6},{d:'M-4 1.2 4-1',w:2.2},
  {d:'M-4.5 1Q0-2.5 4.5 1',w:3.4},{d:'M-4-1Q0 0 4 1.6',w:2}];
const ink='#28353a';
const eyeStyles=[
  ()=>`<circle r="1.7" fill="${ink}"/>`,
  c=>`<ellipse rx="3" ry="3.5" fill="#fff" stroke="${ink}" stroke-width=".8"/><circle cx=".3" cy=".4" r="2" fill="${c}"/><circle cx=".3" cy=".4" r="1" fill="#1c2427"/><circle cx="1" cy="-.6" r=".6" fill="#fff"/>`,
  ()=>`<path d="M-3 1Q0-2.6 3 1" stroke="${ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  c=>`<ellipse rx="2.8" ry="3.2" fill="#fff" stroke="${ink}" stroke-width=".8"/><circle cy=".5" r="1.8" fill="${c}"/><circle cy=".5" r=".9" fill="#1c2427"/><path d="M2.4-1.6 4-3M1-2.8 1.8-4.5M-.8-3.2-.8-5" stroke="${ink}" stroke-width=".8" stroke-linecap="round"/>`,
  c=>`<path d="M-3 0Q0 2.6 3 0Z" fill="#fff" stroke="${ink}" stroke-width=".9"/><circle cy=".7" r="1.3" fill="${c}"/><path d="M-3.4-.2H3.4" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`,
  c=>`<ellipse rx="3.4" ry="4.3" fill="#fff" stroke="${ink}" stroke-width=".8"/><ellipse cy=".5" rx="2.6" ry="3.2" fill="${c}"/><circle cy=".6" r="1.3" fill="#1c2427"/><circle cx="-1" cy="-1" r="1" fill="#fff"/><circle cx="1.2" cy="1.8" r=".5" fill="#fff"/>`,
  c=>`<path d="M-3.2 0Q0-1.6 3.2 0Q0 1.6-3.2 0Z" fill="#fff" stroke="${ink}" stroke-width=".9"/><circle r="1.1" fill="${c}"/>`,
  c=>`<circle r="2.6" fill="#fff" stroke="${ink}" stroke-width="1.1"/><circle r="1.4" fill="${c}"/>`
];
const noseInk='#7a4a38';
const noseStyles=[null,
  `<circle r="1.3" fill="${noseInk}" opacity=".45"/>`,
  `<path d="M-2 0Q0 2.4 2 0" stroke="${noseInk}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".7"/>`,
  `<path d="M.5-5Q-2.5 0 0 1.5 1.2 1.8 2 1" stroke="${noseInk}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>`,
  `<path d="M-3.2.5Q0 2.6 3.2.5" stroke="${noseInk}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7"/><circle cx="-1.4" cy=".4" r=".5" fill="${noseInk}"/><circle cx="1.4" cy=".4" r=".5" fill="${noseInk}"/>`,
  `<path d="M0-3.5-2.4 1.5H2.4Z" fill="${noseInk}" opacity=".35"/>`];
const mouthStyles=[
  (c,stage)=>`<path d="M-4-1q4 ${stage==='little'?7:4} 8 0" stroke="${ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  ()=>`<path d="M-5-1.5Q0 6 5-1.5Z" fill="#5a2a2a"/><path d="M-4.2-1.2H4.2V.3H-4.2Z" fill="#fff"/>`,
  ()=>`<path d="M-3.5 0H3.5" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`,
  ()=>`<ellipse rx="1.7" ry="2.1" fill="#5a2a2a"/>`,
  ()=>`<path d="M-4 .5Q1 2.5 4.2-1.8" stroke="${ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  c=>`<path d="M-4.5 0Q-2-2.2 0-1 2-2.2 4.5 0 2 3 0 3-2 3-4.5 0Z" fill="${c}"/><path d="M-4.3 0H4.3" stroke="#00000040" stroke-width=".6"/>`,
  c=>`<path d="M-5-1.5Q0 6 5-1.5Z" fill="#5a2a2a"/><ellipse cy="2" rx="2.4" ry="1.6" fill="${c}"/>`
];
// Glasses sit on the eyes: x = eye distance from the centre, y = eye height.
const glassStyles=[null,
  (c,x,y)=>`<g fill="none" stroke="${c}" stroke-width="1.5"><circle cx="${-x}" cy="${y}" r="4.6"/><circle cx="${x}" cy="${y}" r="4.6"/><path d="M${4.6-x} ${y-.5}Q0 ${y-1.8} ${x-4.6} ${y-.5}"/></g>`,
  (c,x,y)=>`<g fill="none" stroke="${c}" stroke-width="1.6"><rect x="${-x-5.25}" y="${y-4}" width="10.5" height="7.5" rx="3"/><rect x="${x-5.25}" y="${y-4}" width="10.5" height="7.5" rx="3"/><path d="M${5.25-x} ${y-1}Q0 ${y-3} ${x-5.25} ${y-1}"/></g>`,
  (c,x,y)=>`<g stroke="${c}" stroke-width="1.4"><rect x="${-x-5.5}" y="${y-4}" width="11" height="7" rx="3" fill="#1f2a30" fill-opacity=".85"/><rect x="${x-5.5}" y="${y-4}" width="11" height="7" rx="3" fill="#1f2a30" fill-opacity=".85"/><path d="M${5.5-x} ${y-2}H${x-5.5}" fill="none"/></g>`,
  (c,x,y)=>`<g fill="none" stroke="${c}" stroke-linecap="round"><path d="M${-x-5} ${y-2.5}Q${-x} ${y-5} ${-x+5} ${y-2.5}M${x-5} ${y-2.5}Q${x} ${y-5} ${x+5} ${y-2.5}" stroke-width="2.4"/><path d="M${-x-5} ${y-2.5}Q${-x} ${y+4} ${-x+5} ${y-2.5}M${x-5} ${y-2.5}Q${x} ${y+4} ${x+5} ${y-2.5}M${5-x} ${y-2}H${x-5}" stroke-width=".9"/></g>`
];
const beardStyles=[null,
  (c,my)=>`<path d="M-5.5 ${8+my}Q-3 ${5.2+my} 0 ${7+my} 3 ${5.2+my} 5.5 ${8+my} 3 ${9.3+my} 0 ${8+my}-3 ${9.3+my}-5.5 ${8+my}Z" fill="${c}"/>`,
  c=>`<path d="M-17 2Q-16 20 0 21 16 20 17 2Q13 13 6 13Q3 16 0 16-3 16-6 13-13 13-17 2Z" fill="${c}"/>`,
  c=>`<path d="M-3 14Q0 13 3 14 2 19 0 19-2 19-3 14Z" fill="${c}"/>`,
  c=>`<path d="M-17 2Q-16 20 0 21 16 20 17 2Q13 13 6 13Q3 16 0 16-3 16-6 13-13 13-17 2Z" fill="${c}" opacity=".28"/>`
];
function faceOf(p,stage=avatarStage(p),look=p.look??0){
  const f=p.face||{};
  const part=(key,base)=>({...base,...f[key]});
  return {
    shape:f.shape??0,
    brows:part('brows',{style:0,color:null,y:0,size:0,rot:0,space:0}),
    eyes:part('eyes',{style:0,color:0,y:0,size:0,rot:0,space:0}),
    nose:part('nose',{style:0,y:0,size:0}),
    mouth:part('mouth',{style:0,color:0,y:0,size:0}),
    glasses:part('glasses',{style:stage==='senior'||stage==='adult'&&look%4===1?2:0,color:0}),
    beard:f.beard??0, mole:f.mole??false, freckles:f.freckles??false,
    blush:f.blush??(stage==='little'||stage==='school')
  };
}
const scaleOf=size=>1+size*.08;
function pair(part,y,svg){
  return [-1,1].map(s=>`<g transform="translate(${s*(6.5+part.space)} ${y+part.y}) scale(${s} 1) rotate(${-part.rot*6}) scale(${scaleOf(part.size)})">${svg}</g>`).join('');
}
function faceArt(head,r,skin,hair,hairColor,look,stage,p={}){
  const f=faceOf(p,stage,look);
  const style=hairStyles[hair]??hairStyles[0];
  const flip=p.hairFlip?' transform="scale(-1 1)"':'';
  const shape=faceShapes[f.shape]??faceShapes[0];
  const brow=browStyles[f.brows.style];
  const browColor=f.brows.color==null?hairColor:hairColors[f.brows.color];
  const nose=noseStyles[f.nose.style];
  const glasses=glassStyles[f.glasses.style];
  const beard=beardStyles[f.beard];
  return `<g transform="translate(0 ${head}) scale(${r/19})">
    ${style.back?`<path d="${style.back}" fill="${hairColor}"${flip}/>`:''}
    <circle cx="${-shape.ear}" cy="3" r="4" fill="${skin}"/><circle cx="${shape.ear}" cy="3" r="4" fill="${skin}"/>
    <path d="${shape.d}" fill="${skin}"/>
    ${p.needs?.has?.('hearing')?`<path d="M${shape.ear+1.5}-1q3 3 1 7" stroke="#e7d2a6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`:''}
    ${style.front?`<path d="${style.front}" fill="${hairColor}"${flip}/>`:''}
    ${f.blush?'<path d="M-12 7h3m18 0h3" stroke="#a45243" stroke-width="2.2" opacity=".56" stroke-linecap="round"/>':''}
    ${f.freckles?'<g fill="#9a5c42" opacity=".55"><circle cx="-10" cy="7" r=".7"/><circle cx="-8" cy="8.6" r=".7"/><circle cx="-11.5" cy="9" r=".6"/><circle cx="10" cy="7" r=".7"/><circle cx="8" cy="8.6" r=".7"/><circle cx="11.5" cy="9" r=".6"/></g>':''}
    ${nose?`<g transform="translate(0 ${6.5+f.nose.y}) scale(${scaleOf(f.nose.size)})">${nose}</g>`:''}
    <g transform="translate(0 ${10+f.mouth.y}) scale(${scaleOf(f.mouth.size)})">${mouthStyles[f.mouth.style](lipColors[f.mouth.color],stage)}</g>
    ${beard?beard(hairColor,f.mouth.y):''}
    <g class="blink" style="animation-delay:-${((Number(p.id)||0)*1.7)%6}s">${pair(f.eyes,3,eyeStyles[f.eyes.style](eyeColors[f.eyes.color]))}</g>
    ${brow?pair(f.brows,-4,`<path d="${brow.d}" stroke="${browColor}" stroke-width="${brow.w}" fill="none" stroke-linecap="round"/>`):''}
    ${sceneSeason==='winter'?beanie(['#c8553d','#2f6f7e','#e0a43a','#6c9b84','#a08cb7'][(Number(p.id)||0)%5]):''}
    ${glasses?glasses(glassColors[f.glasses.color],6.5+f.eyes.space,3+f.eyes.y):''}
    ${f.mole?'<circle cx="9" cy="11" r=".9" fill="#5a3d32"/>':''}
  </g>`;
}
const beanie=c=>`<path d="M-19.5-6Q-20-27 0-27 20-27 19.5-6Z" fill="${c}"/><path d="M-13-20h26M-17-14h34" stroke="#fff6e6" stroke-width="2" opacity=".5"/><rect x="-21" y="-10" width="42" height="7" rx="3.5" fill="${c}" stroke="#0000001f"/><circle cy="-29" r="5.5" fill="#fff8ec"/>`;
// A lone head for option grids in the editor.
function headSvg(p){
  const v=lookOf(p);
  return `<svg viewBox="-28 -30 56 56" aria-hidden="true">${faceArt(0,19,tones[v.skin],v.hair,hairColors[v.hairColor],p.look??0,avatarStage(p),p)}</svg>`;
}
