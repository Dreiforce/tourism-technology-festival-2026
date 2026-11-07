// Wallet export for the Reise-Canvas: on the last step, next to the PNG export, families can add their postcard
// with family, village, dates and day plan to Apple Wallet or Google Wallet. Nothing is sent until a button is
// tapped. Then the front of the postcard is rendered in the sizes the wallets need, uploaded to the worker
// (api/wallet/postcard) and the pass is opened. The buttons show whenever the Reise-Canvas worker answers;
// a wallet without credentials on the server says so on tap.
// The static GitHub Pages copy has no worker. scripts/build-pages.mjs publishes the pass modules next to it and
// marks the page with <meta name="wallet-direct">; then the browser builds the pass content itself, sends it to
// WalletWallet and opens the pass (Apple devices), WalletWallet's install page (Apple button elsewhere) or Google's
// save page. Without a worker and without
// that marker (e.g. dist/ served as plain files) no buttons appear.
let walletStatusRequest, walletStatusValue=null, walletBusy=false, walletModules;
const walletDirect=document.querySelector('meta[name="wallet-direct"]');
function walletStatus(){
  walletStatusRequest ||= (walletDirect
    ? Promise.resolve({mode:'direct',apple:true,google:true})
    : fetch('api/wallet/status',{headers:{Accept:'application/json'}})
      .then(response=>response.ok?response.json():null)
      .then(status=>status&&Array.isArray(status.strip)&&Array.isArray(status.hero)?{...status,mode:'server'}:null))
    .catch(()=>null)
    .then(status=>(walletStatusValue=status));
  return walletStatusRequest;
}
// iPhone, iPad and Safari on the Mac get Apple Wallet, Android gets Google Wallet, everything else both.
function walletAppleDevice(){
  const ua=navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)||
    (/Macintosh/.test(ua)&&/Version\/[\d.]+.*Safari\//.test(ua)&&!/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua));
}
function walletTargets(status){
  const appleDevice=walletAppleDevice();
  const android=/Android/.test(navigator.userAgent);
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
// The same buttons in the booking confirmation (booking.js), next to the calendar file. The pass then shows the
// booked times and the booking number.
function walletBookingButtons(){
  const targets=walletTargets(walletStatusValue);
  return targets.length?`<div class="wallet-actions wallet-booking">${targets.map(kind=>
    `<button type="button" class="small wallet-button" data-wallet="${kind}">${t(kind==='apple'?'walletApple':'walletGoogle')}</button>`).join('')}</div>
    <p class="wallet-booking-status" role="status"></p>`:'';
}
$('book-form')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-wallet]');
  if(button) walletExport(button.dataset.wallet);
});
function walletNote(key){
  showExportStatus(key);
  for(const status of document.querySelectorAll('.wallet-booking-status')) status.textContent=t(key);
}
// iOS adds the pass and stays in Safari; it never switches to the Wallet app by itself, and the page is not told
// whether "Hinzufügen" was tapped. So shortly after the Apple button a small popup opens underneath Apple's sheet;
// once the sheet is gone it offers the Wallet app (shoebox:// – undocumented, but it has opened Apple's Wallet app for
// years). The tap on that link counts as the user's own, so iOS opens Wallet right away. The status line keeps the link.
const walletIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
function walletOfferOpen(){
  for(const status of [$('export-status'),...document.querySelectorAll('.wallet-booking-status')]){
    if(!status) continue;
    status.textContent=t('walletAdded')+' ';
    const link=document.createElement('a');
    link.href='shoebox://';link.className='wallet-open';link.textContent=t('walletOpenApp');
    status.append(link);
  }
  let dialog=$('wallet-open-dialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='wallet-open-dialog';dialog.className='wallet-open-dialog';
    dialog.setAttribute('aria-labelledby','wallet-open-title');
    document.body.append(dialog);
  }
  dialog.innerHTML=`<h2 id="wallet-open-title">${t('walletAddedTitle')}</h2><p>${t('walletAddedText')}</p>
    <div class="dialog-actions"><button type="button" class="small" data-wallet-close>${t('walletClose')}</button>
      <a class="primary" href="shoebox://" data-wallet-open>${t('walletOpenApp')}</a></div>`;
  dialog.querySelector('[data-wallet-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-wallet-open]').addEventListener('click',()=>setTimeout(()=>dialog.close(),400));
  if(!dialog.open) dialog.showModal();
}

function walletBase64(text){
  let binary='';
  for(const byte of new TextEncoder().encode(text)) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
// Compact plan for ?t= (format documented in server/wallet-trip.mjs). The server looks every activity up in its
// own catalog by index, so only ids, times and group labels travel. Activities booked in the canvas' demo booking
// (booking.js) travel with their booked time and a booked flag, plus the trip's booking number.
function walletPayload(){
  const kinds={adult:'a',child:'c',dog:'d'};
  const family=state.family.map(p=>[kinds[p.kind],p.kind==='dog'||!Number.isInteger(p.age)?null:p.age,String(p.name||'').trim().slice(0,24)]);
  const wishes=[...new Set([...state.general,...state.family.flatMap(p=>[...p.wishes])])].filter(key=>key in choices).slice(0,8);
  const entries=[];
  // The trip plan (planner.js) has an extra evening slot; the pass format knows am/pm, so evening travels as pm.
  if(catalog) for(const day of currentTrip().days) for(const slot of day.slots) for(const entry of slot.entries){
    if(!entry.chosen) continue;
    const booking=typeof bookingFor==='function'?bookingFor(entry):null;
    entries.push([day.date,slot.period==='am'?'am':'pm',entry.group.id==='all'?'':entry.group.label,
      booking?booking.start:entry.chosen.time.start,booking?booking.end:entry.chosen.time.end,entry.chosen.index,booking?1:0]);
  }
  const ref=/^FZ-[A-Z0-9]{4,12}$/.test(state.tripRef||'')&&entries.some(entry=>entry[6])?state.tripRef:'';
  return walletBase64(JSON.stringify({v:1,l:language,p:state.place,s:state.start,e:state.end||'',f:family,w:wishes,r:entries.slice(0,60),...(ref&&{b:ref})}));
}
// Renders the whole 1920×1080 postcard into width×height, never cropped. Wider formats (the Apple strip) show the
// card centred on the pass's dark green, like a framed postcard; taller formats (Google's hero) show it on the
// canvas paper colour.
function walletCrop(img,width,height){
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  context.imageSmoothingQuality='high';
  if(width/height>=1920/1080){
    const pad=Math.round(height*.07);
    const scale=(height-2*pad)/1080, cardWidth=1920*scale, cardHeight=1080*scale;
    context.fillStyle='#294e41';
    context.fillRect(0,0,width,height);
    context.shadowColor='rgba(0,0,0,.28)';context.shadowBlur=Math.round(height*.05);context.shadowOffsetY=Math.round(height*.015);
    context.drawImage(img,(width-cardWidth)/2,(height-cardHeight)/2,cardWidth,cardHeight);
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
  return walletRender({strip:status.strip[0],'strip@2x':status.strip[1],'strip@3x':status.strip[2],hero:status.hero});
}
async function walletRender(sizes){
  const source=poster({...posterData(),id:'export-art'})
    .replace('viewBox="0 0 960 540"','width="1920" height="1080" viewBox="0 0 960 540"');
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    const images={};
    for(const [name,[width,height]] of Object.entries(sizes)) images[name]=await walletCrop(img,width,height);
    return images;
  }finally{URL.revokeObjectURL(url)}
}
async function walletExport(kind){
  if(walletBusy||state.step!==finalStep) return;
  if(!walletStatusValue?.[kind]){
    walletNote(kind==='apple'?'walletAppleMissing':'walletGoogleMissing');
    return;
  }
  walletBusy=true;
  const buttons=[...document.querySelectorAll('[data-wallet]')];
  buttons.forEach(button=>{button.disabled=true});
  // Google (and on the static copy WalletWallet's install page for other devices) opens in a new tab so the canvas
  // stays as it is. The tab has to be opened right away, inside the tap. On Apple devices the .pkpass opens Apple's
  // "Add to Wallet" sheet on top of the canvas, so no tab is needed.
  const direct=walletStatusValue.mode==='direct';
  const tab=kind==='google'||(direct&&!walletAppleDevice())?window.open('','_blank'):null;
  if(tab) tab.document.write(`<title>Google Wallet</title><p style="font:16px system-ui;padding:24px">${html(t('walletPreparing'))}</p>`);
  walletNote('walletPreparing');
  try{
    if(direct){
      const target=await walletDirectTarget(kind);
      walletNote('walletOpening');
      if(tab) tab.location.href=target;else location.href=target;
      if(kind==='apple'&&walletIOS()) setTimeout(walletOfferOpen,1500);
      return;
    }
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
    walletNote('walletOpening');
    if(tab) tab.location.href=target;else location.href=target;
    if(kind==='apple'&&walletIOS()) setTimeout(walletOfferOpen,1500);
  }catch(error){
    console.error('Wallet export failed',error);
    tab?.close();
    walletNote('walletFailed');
  }finally{
    walletBusy=false;
    setTimeout(()=>buttons.forEach(button=>{button.disabled=false}),1200);
  }
}

// Static copy: build the pass in the browser and let WalletWallet sign it. Returns the page to open.
function walletDirectModules(){
  const base=new URL(walletDirect.content,document.baseURI);
  const version=walletDirect.dataset.version?'?v='+encodeURIComponent(walletDirect.dataset.version):'';
  walletModules ||= Promise.all(['wallet-trip','wallet-apple','wallet-walletwallet'].map(name=>import(new URL(name+'.js'+version,base).href)))
    .then(([trip,apple,walletwallet])=>({trip,apple,walletwallet,base}));
  return walletModules;
}
async function walletDirectTarget(kind){
  const {trip:plans,apple,walletwallet,base}=await walletDirectModules();
  const trip=plans.resolveTrip(plans.decodeTripParam(walletPayload(),language),{catalog:catalog||[],id:crypto.randomUUID()});
  const bytes=async blob=>blob?new Uint8Array(await blob.arrayBuffer()):null;
  const asset=name=>fetch(new URL(name,base)).then(response=>response.ok?response.arrayBuffer():null)
    .then(buffer=>buffer&&new Uint8Array(buffer)).catch(()=>null);
  const [strip,logo,icon]=await Promise.all([
    walletRender({strip:walletwallet.WALLETWALLET_STRIP_SIZES[2]}).then(images=>bytes(images.strip)),asset('logo.png'),asset('icon.png')]);
  // QR code on the pass: the home page of this Reise-Canvas (for the pitch).
  const home=location.origin+location.pathname;
  const passJson=apple.buildApplePassJson(trip,{images:{'strip.png':strip},barcodeUrl:home});
  const result=await walletwallet.createWalletWalletPass(trip,passJson,{apiKey:walletwallet.WALLETWALLET_API_KEY,
    images:{strip3x:strip,logo,icon},barcodeUrl:home});
  // iPhone, iPad and Mac Safari: straight to the pass file, so Apple's "Add to Wallet" sheet opens without the install
  // page in between. Other devices get the install page (with a QR code for the phone).
  const target=kind==='google'?result.googleSaveUrl:(walletAppleDevice()&&result.appleUrl)||result.shareUrl;
  if(!target) throw Error('WalletWallet returned no link');
  return target;
}
