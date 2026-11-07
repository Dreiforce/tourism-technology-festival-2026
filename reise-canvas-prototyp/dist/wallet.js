// Wallet export for the Reise-Canvas: on the last step, next to the PNG export, families can add their postcard
// with family, village, dates and day plan to Apple Wallet or Google Wallet. Nothing is sent until a button is
// tapped. Then the front of the postcard is rendered in the sizes the wallets need, uploaded to the worker
// (api/wallet/postcard) and the pass is opened. The buttons show whenever the Reise-Canvas worker answers;
// a wallet without credentials on the server says so on tap. Without a worker (e.g. the GitHub Pages copy)
// the status request fails and no buttons appear.
let walletStatusRequest, walletStatusValue=null, walletBusy=false;
function walletStatus(){
  walletStatusRequest ||= fetch('api/wallet/status',{headers:{Accept:'application/json'}})
    .then(response=>response.ok?response.json():null)
    .then(status=>status&&Array.isArray(status.strip)&&Array.isArray(status.hero)?status:null)
    .catch(()=>null)
    .then(status=>(walletStatusValue=status));
  return walletStatusRequest;
}
// iPhone, iPad and Safari on the Mac get Apple Wallet, Android gets Google Wallet, everything else both.
function walletTargets(status){
  const ua=navigator.userAgent;
  const appleDevice=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)||
    (/Macintosh/.test(ua)&&/Version\/[\d.]+.*Safari\//.test(ua)&&!/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua));
  const android=/Android/.test(ua);
  if(!status) return [];
  return ['apple','google'].filter(kind=>appleDevice?kind==='apple':android?kind==='google':true);
}
async function renderWallet(){
  if(state.step!==finalStep) return;
  const targets=walletTargets(await walletStatus());
  const anchor=$('controls').querySelector('.summary-actions');
  if(!targets.length||state.step!==finalStep||!anchor||$('wallet-export')) return;
  // TODO: replace the text buttons with the official "Add to Apple Wallet" / "Add to Google Wallet" badges
  // (brand guidelines) once the artwork is downloaded from Apple and Google.
  anchor.insertAdjacentHTML('afterend',`<div class="wallet-export" id="wallet-export">
    <p class="wallet-hint"><strong>${t('walletHeading')}</strong> ${t('walletHint')}</p>
    <div class="wallet-actions">${targets.map(kind=>
      `<button type="button" class="small wallet-button" data-wallet="${kind}">${t(kind==='apple'?'walletApple':'walletGoogle')}</button>`).join('')}</div>
  </div>`);
}
$('controls').addEventListener('click',event=>{
  const button=event.target.closest('[data-wallet]');
  if(button) walletExport(button.dataset.wallet);
});

function walletBase64(text){
  let binary='';
  for(const byte of new TextEncoder().encode(text)) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
// Compact plan for ?t= (format documented in server/wallet-trip.mjs). The server looks every activity up in its
// own catalog by index, so only ids, times and group labels travel.
function walletPayload(){
  const kinds={adult:'a',child:'c',dog:'d'};
  const family=state.family.map(p=>[kinds[p.kind],p.kind==='dog'||!Number.isInteger(p.age)?null:p.age,String(p.name||'').trim().slice(0,24)]);
  const wishes=[...new Set([...state.general,...state.family.flatMap(p=>[...p.wishes])])].filter(key=>key in choices).slice(0,8);
  const entries=[];
  // The trip plan (planner.js) has an extra evening slot; the pass format knows am/pm, so evening travels as pm.
  if(catalog) for(const day of currentTrip().days) for(const slot of day.slots) for(const entry of slot.entries){
    if(entry.chosen) entries.push([day.date,slot.period==='am'?'am':'pm',entry.group.id==='all'?'':entry.group.label,
      entry.chosen.time.start,entry.chosen.time.end,entry.chosen.index]);
  }
  return walletBase64(JSON.stringify({v:1,l:language,p:state.place,s:state.start,e:state.end||'',f:family,w:wishes,r:entries.slice(0,60)}));
}
// Renders the 1920×1080 postcard at width×height. Wider formats (the Apple strip) are cover-cropped around the
// family figures in the lower part; taller formats (Google's hero) show the whole card on the canvas paper
// colour, so the place name and date stamp are not cut in half.
function walletCrop(img,width,height,focusY=.7){
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  context.imageSmoothingQuality='high';
  if(width/height>=1920/1080){
    const scale=width/1920, cropHeight=height/scale;
    const y=Math.min(Math.max(focusY*1080-cropHeight/2,0),1080-cropHeight);
    context.drawImage(img,0,y,1920,cropHeight,0,0,width,height);
  }else{
    const margin=Math.round(width*.04);
    const scale=Math.min((width-2*margin)/1920,(height-2*margin)/1080);
    const cardWidth=1920*scale, cardHeight=1080*scale;
    context.fillStyle='#f4f2e7';
    context.fillRect(0,0,width,height);
    context.shadowColor='rgba(23,52,67,.22)';context.shadowBlur=Math.round(width*.02);context.shadowOffsetY=Math.round(width*.006);
    context.drawImage(img,(width-cardWidth)/2,(height-cardHeight)/2,cardWidth,cardHeight);
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG unavailable')),'image/png'));
}
async function walletImages(status){
  const source=poster({...posterData(),id:'export-art'})
    .replace('viewBox="0 0 960 540"','width="1920" height="1080" viewBox="0 0 960 540"');
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    const sizes={strip:status.strip[0],'strip@2x':status.strip[1],'strip@3x':status.strip[2],hero:status.hero};
    const images={};
    for(const [name,[width,height]] of Object.entries(sizes)) images[name]=await walletCrop(img,width,height);
    return images;
  }finally{URL.revokeObjectURL(url)}
}
async function walletExport(kind){
  if(walletBusy||state.step!==finalStep) return;
  if(!walletStatusValue?.[kind]){
    showExportStatus(kind==='apple'?'walletAppleMissing':'walletGoogleMissing');
    return;
  }
  walletBusy=true;
  const buttons=[...document.querySelectorAll('[data-wallet]')];
  buttons.forEach(button=>{button.disabled=true});
  // Google opens in a new tab so the canvas stays as it is. The tab has to be opened right away, inside the tap.
  const tab=kind==='google'?window.open('','_blank'):null;
  if(tab) tab.document.write(`<title>Google Wallet</title><p style="font:16px system-ui;padding:24px">${html(t('walletPreparing'))}</p>`);
  showExportStatus('walletPreparing');
  try{
    const status=await walletStatus();
    if(!status?.[kind]) throw Error('wallet not configured');
    const plan=walletPayload();
    const form=new FormData();
    for(const [name,blob] of Object.entries(await walletImages(status))) form.append(name,blob,name+'.png');
    form.append('end',state.end||state.start);
    const response=await fetch('api/wallet/postcard',{method:'POST',body:form});
    if(!response.ok) throw Error('upload failed: '+response.status);
    const {id}=await response.json();
    const target=new URL(`api/wallet/${kind}?l=${language}&p=${encodeURIComponent(id)}&t=${plan}`,location.href).href;
    showExportStatus('walletOpening');
    if(tab) tab.location.href=target;else location.href=target;
  }catch(error){
    console.error('Wallet export failed',error);
    tab?.close();
    showExportStatus('walletFailed');
  }finally{
    walletBusy=false;
    setTimeout(()=>buttons.forEach(button=>{button.disabled=false}),1200);
  }
}
