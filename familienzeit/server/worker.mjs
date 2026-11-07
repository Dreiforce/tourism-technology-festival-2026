const json = (data, status=200) => Response.json(data, {
  status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});

function accountEmail(request){
  const userId=request.headers.get('oai-authenticated-user-id');
  return userId ? request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() : undefined;
}
function owner(request,env){
  return Boolean(env.CATALOG_OWNER_EMAIL && accountEmail(request)===env.CATALOG_OWNER_EMAIL);
}
async function canEdit(request,env){
  if(owner(request,env)) return true;
  const email=accountEmail(request);
  return Boolean(email && await env.DB.prepare('SELECT email FROM catalog_admins WHERE email=?').bind(email).first());
}

async function manageAdmins(request,env){
  if(!owner(request,env)) return json({error:'Freigaben verwaltet das Site-Eigentümerkonto.'},403);
  if(request.method==='GET'){
    const {results}=await env.DB.prepare('SELECT email FROM catalog_admins ORDER BY email').all();
    return json(results.map(row=>row.email));
  }
  if(!['PUT','DELETE'].includes(request.method)) return json({error:'Methode nicht erlaubt.'},405);
  if(request.headers.get('Origin')!==new URL(request.url).origin ||
      request.headers.get('Content-Type')?.split(';')[0]!=='application/json'){
    return json({error:'Ungültige Anfrage.'},403);
  }
  let email;
  try {
    const body=await request.json();
    email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
  } catch {
    return json({error:'Ungültige Formulardaten.'},400);
  }
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return json({error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  }
  if(email===env.CATALOG_OWNER_EMAIL) return json({error:'Das Eigentümerkonto hat bereits Zugriff.'},400);
  if(request.method==='PUT'){
    await env.DB.prepare('INSERT OR IGNORE INTO catalog_admins (email) VALUES (?)').bind(email).run();
  }else{
    await env.DB.prepare('DELETE FROM catalog_admins WHERE email=?').bind(email).run();
  }
  return json({email});
}

const imageTypes = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const photoPath = /^\/photos\/[a-f0-9-]{36}\.(jpg|png|webp)$/;

function validate(details) {
  const field = (value, label, max, required=true) => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
      throw new Error(label + ' fehlt oder ist zu lang.');
    }
    return value.trim();
  };
  const number = (value, label, min, max, integer=false) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(label + ' liegt außerhalb des gültigen Bereichs.');
    }
    return value;
  };
  const date = value => value === '' || (typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0,10) === value);
  const clock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const {title,description,operator,address,location,category,min,max,duration,weather,pets,petNote,adult,child,childFrom,childTo,youth,youthFrom,dogPrice,priceNote,hours,sources,notes,verified,active,booking,bookingLink,bookingNote,accessibility,accessNote,accessSource,passes=[],region='salzburg',meeting='',priceKnown=true} = details;
  if (!['Natur','Entdecken','Action','Kreativ'].includes(category) ||
      !['sun','both'].includes(weather) || !['yes','no','unknown'].includes(pets) ||
      typeof active !== 'boolean' || typeof priceKnown !== 'boolean' || !date(verified) || !verified) {
    throw new Error('Bitte Kategorie, Wettertyp, Tierregel und Prüfdatum auswählen.');
  }
  if (!['online','office','onsite','free'].includes(booking)) throw new Error('Bitte einen Buchungsweg wählen.');
  const ticketLink = field(bookingLink,'Buchungslink',1000,booking==='online');
  if (ticketLink && (!URL.canParse(ticketLink) || new URL(ticketLink).protocol!=='https:' ||
      new URL(ticketLink).username || new URL(ticketLink).password)) throw new Error('Der Buchungslink muss HTTPS verwenden.');
  if (accessibility !== undefined && (!accessibility || typeof accessibility!=='object' ||
      Object.entries(accessibility).some(([key,value])=>!Object.hasOwn(accessOptions,key)||!Object.hasOwn(accessStatuses,value)))) {
    throw new Error('Bitte die Angaben zur Barrierefreiheit prüfen.');
  }
  const accessLink = field(accessSource ?? '','Quelle zur Barrierefreiheit',1000,false);
  if (accessLink && (!URL.canParse(accessLink) || new URL(accessLink).protocol!=='https:' ||
      new URL(accessLink).username || new URL(accessLink).password)) throw new Error('Die Quelle zur Barrierefreiheit muss HTTPS verwenden.');
  if (!Array.isArray(passes) || passes.length>16 || passes.some(rule=>!rule ||
      !Object.hasOwn(guestCards,rule.card) || !date(rule.from) || !date(rule.to) ||
      (rule.from && rule.to && rule.from>rule.to) ||
      typeof rule.source!=='string' || rule.source.length>1000 || !URL.canParse(rule.source) ||
      new URL(rule.source).protocol!=='https:' || new URL(rule.source).username || new URL(rule.source).password ||
      typeof rule.note!=='string' || rule.note.length>350)) {
    throw new Error('Bitte Karte, Gültigkeit und HTTPS-Quelle für den inkludierten Eintritt prüfen.');
  }
  if (!['sfl','salzburg'].includes(region) || (meeting && !Object.hasOwn(meetingPoints,meeting))) {
    throw new Error('Bitte Region und optionalen Gruppentreffpunkt prüfen.');
  }
  if (!Array.isArray(location) || location.length !== 3) throw new Error('Bitte einen Standort eintragen.');
  if (!Array.isArray(sources) || !sources.length || sources.length > 8) throw new Error('Mindestens einen Quellenlink eintragen.');
  for (const link of sources) {
    if (typeof link !== 'string' || link.length > 1000 || !URL.canParse(link)) throw new Error('Ungültiger Quellenlink.');
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Quellenlinks müssen HTTPS verwenden.');
  }
  if (!Array.isArray(hours) || hours.length > 160 || (active && !hours.some(rule=>rule.kind!=='closed'))) {
    throw new Error('Für sichtbare Erlebnisse ist mindestens eine Öffnungszeit erforderlich.');
  }
  for (const rule of hours) {
    if (!['regular','special','closed'].includes(rule.kind) ||
        !date(rule.from) || !date(rule.to) || (rule.from && rule.to && rule.from > rule.to) ||
        (rule.kind !== 'regular' && (!rule.from || !rule.to)) ||
        (rule.ticketUrl && (typeof rule.ticketUrl!=='string' || rule.ticketUrl.length>1000 ||
          !URL.canParse(rule.ticketUrl) || new URL(rule.ticketUrl).protocol!=='https:' ||
          new URL(rule.ticketUrl).username || new URL(rule.ticketUrl).password)) ||
        !Array.isArray(rule.days) || !rule.days.length || !rule.days.every(day=>Number.isInteger(day)&&day>=0&&day<=6) ||
        (rule.kind!=='closed' && (!clock(rule.open)||!clock(rule.close)||rule.open>=rule.close||
          (rule.last && (!clock(rule.last)||rule.last<rule.open||rule.last>rule.close))))) {
      throw new Error('Bitte Öffnungszeiten, Wochentage und Datumsgrenzen prüfen.');
    }
  }
  number(min,'Mindestalter',0,17,true);
  number(max,'Höchstalter',min,17,true);
  number(childFrom,'Kindertarif ab',0,17,true);
  number(childTo,'Kindertarif bis',childFrom,17,true);
  return {
    title:field(title,'Name',120), description:field(description,'Beschreibung',1600),
    operator:field(operator,'Anbieter',120), address:field(address,'Adresse',200),
    location:[field(location[0],'Ort',120),number(location[1],'Breitengrad',-90,90),number(location[2],'Längengrad',-180,180)],
    category,region,meeting,priceKnown,min,max,duration:number(duration,'Dauer',5,600,true),weather,pets,
    petNote:field(petNote,'Tierhinweis',350,false),
    adult:number(adult,'Erwachsenenpreis',0,9999),child:number(child,'Kinderpreis',0,9999),childFrom,childTo,
    youth:youth===null?null:number(youth,'Jugendpreis',0,9999),
    youthFrom:number(youthFrom,'Jugendtarif ab',youth===null?0:childTo+1,17,true),
    dogPrice:number(dogPrice,'Hundepreis',0,9999),priceNote:field(priceNote,'Preishinweis',350,false),
    hours:hours.map(({kind,from,to,days,open,close,last,ticketUrl})=>kind==='closed'?{kind,from,to,days}:{kind,from,to,days,open,close,last:last||'',...(ticketUrl&&{ticketUrl})}),
    sources:[...new Set(sources)], booking, bookingLink:ticketLink,
    bookingNote:field(bookingNote,'Buchungshinweis oder Adresse des Tourismusbüros',350,booking==='office'),
    accessibility:accessibility ?? {}, accessSource:accessLink,
    passes:passes.map(({card,from,to,source,note})=>({card,from,to,source,note})),
    accessNote:field(accessNote ?? '','Hinweise zur Barrierefreiheit',700,false),
    notes:field(notes,'Besuchshinweise',700,false), verified, active
  };
}

async function importInitialCatalog(db) {
  const name = 'sfl-2026-11-official-offers';
  if (await db.prepare('SELECT name FROM catalog_imports WHERE name=?').bind(name).first()) return;
  const insert = db.prepare('INSERT OR IGNORE INTO experiences (id, revision, active, details) VALUES (?, ?, ?, ?)');
  const records = initialCatalog.filter(record=>record.region==='sfl').map(({id,...record})=>{
    const details = validate(record);
    return insert.bind(id, crypto.randomUUID(), Number(details.active), JSON.stringify(details));
  });
  await db.batch([...records, db.prepare('INSERT OR IGNORE INTO catalog_imports (name) VALUES (?)').bind(name)]);
}

async function addAccessibilityDetails(db) {
  const name='accessibility-2026-11';
  if (await db.prepare('SELECT name FROM catalog_imports WHERE name=?').bind(name).first()) return;
  const update = db.prepare(
    "UPDATE experiences SET details=json_set(details,'$.accessibility',json(?),'$.accessNote',?,'$.accessSource',?), revision=? WHERE id=? AND json_type(details,'$.accessibility') IS NULL"
  );
  const records = initialCatalog.filter(record=>record.accessibility).map(record=>
    update.bind(JSON.stringify(record.accessibility),record.accessNote,record.accessSource,crypto.randomUUID(),record.id));
  await db.batch([...records, db.prepare('INSERT OR IGNORE INTO catalog_imports (name) VALUES (?)').bind(name)]);
}

async function addGuestCardDetails(db) {
  const name='guest-cards-2026-11';
  if (await db.prepare('SELECT name FROM catalog_imports WHERE name=?').bind(name).first()) return;
  const update=db.prepare(
    "UPDATE experiences SET details=json_set(details,'$.passes',json(?)),revision=? WHERE id=? AND json_type(details,'$.passes') IS NULL"
  );
  const records=initialCatalog.filter(record=>record.passes?.length).map(record=>
    update.bind(JSON.stringify(record.passes),crypto.randomUUID(),record.id));
  await db.batch([...records,db.prepare('INSERT OR IGNORE INTO catalog_imports (name) VALUES (?)').bind(name)]);
}

async function catalog(request, env, admin) {
  if (admin && !await canEdit(request,env)) return json({error:'Dieses ChatGPT-Konto hat keine Freigabe für den Katalog.'},403);
  if (request.method==='GET') {
    await importInitialCatalog(env.DB);
    await addAccessibilityDetails(env.DB);
    await addGuestCardDetails(env.DB);
    const query = admin ? "SELECT * FROM experiences WHERE json_extract(details,'$.region')='sfl' ORDER BY id" : "SELECT * FROM experiences WHERE active=1 AND json_extract(details,'$.region')='sfl' ORDER BY id";
    const {results} = await env.DB.prepare(query).all();
    return json(results.map(row=>({id:row.id,...JSON.parse(row.details),...(admin&&{revision:row.revision})})));
  }
  if (!admin || request.method!=='POST') return json({error:'Methode nicht erlaubt.'},405);
  if (request.headers.get('Origin')!==new URL(request.url).origin ||
      !request.headers.get('Content-Type')?.startsWith('multipart/form-data')) return json({error:'Ungültige Anfrage.'},403);
  let body, details, files = [];
  try {
    const limit = 17*1024*1024;
    if (Number(request.headers.get('Content-Length'))>limit) throw new Error('Der Eintrag ist zu groß.');
    let total = 0;
    const bounded = request.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total>limit) throw new Error('Der Eintrag ist zu groß.');
        controller.enqueue(chunk);
      }
    }));
    const form = await new Response(bounded,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
    const raw = form.get('details');
    if (typeof raw!=='string' || raw.length>60000) throw new Error('Die Formulardaten fehlen oder sind zu groß.');
    body = JSON.parse(raw);
    details = validate(body);
    files = form.getAll('photos');
    if (!Array.isArray(body.photos) || new Set(body.photos).size!==body.photos.length ||
        body.photos.length+files.length>4) throw new Error('Pro Erlebnis sind bis zu vier Fotos möglich.');
    for (const file of files) {
      if (!(file instanceof File) || !Object.hasOwn(imageTypes,file.type) || file.size>4*1024*1024) {
        throw new Error('Fotos müssen JPG, PNG oder WebP sein und dürfen je 4 MB groß sein.');
      }
      const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
      const valid = file.type==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
        : file.type==='image/png' ? [137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value)
        : new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
      if (!valid) throw new Error('Eine Bilddatei ist beschädigt oder hat ein anderes Format.');
    }
  } catch (error) {
    return json({error:error instanceof SyntaxError?'Ungültige Formulardaten.':error.message},400);
  }
  const revision = crypto.randomUUID();
  const id = body.id || crypto.randomUUID();
  let previous = [];
  if (body.id) {
    if (typeof body.id!=='string' || typeof body.revision!=='string') return json({error:'Ungültiger Bearbeitungsstand.'},400);
    const current = await env.DB.prepare('SELECT revision, details FROM experiences WHERE id=?').bind(id).first();
    if (current?.revision!==body.revision) return json({error:'Dieser Eintrag wurde inzwischen geändert. Bitte die Seite neu laden.'},409);
    previous = JSON.parse(current.details).photos || [];
  }
  if (!body.photos.every(path=>previous.includes(path))) return json({error:'Ungültige Fotoauswahl.'},400);
  const uploaded = [];
  let saved = false;
  try {
    for (const file of files) {
      const key = crypto.randomUUID()+'.'+imageTypes[file.type];
      uploaded.push('/photos/'+key);
      await env.BUCKET.put(key, await file.arrayBuffer(), {httpMetadata:{contentType:file.type}});
    }
    details.photos = [...body.photos,...uploaded];
    const payload = JSON.stringify(details);
    if (body.id) {
      const result = await env.DB.prepare('UPDATE experiences SET revision=?, active=?, details=? WHERE id=? AND revision=?')
        .bind(revision, Number(details.active), payload, id, body.revision).run();
      if (!result.meta.changes) return json({error:'Dieser Eintrag wurde inzwischen geändert. Bitte die Seite neu laden.'},409);
    } else {
      await env.DB.prepare('INSERT INTO experiences (id, revision, active, details) VALUES (?, ?, ?, ?)')
        .bind(id, revision, Number(details.active), payload).run();
    }
    saved = true;
    return json({id, revision, ...details},body.id?200:201);
  } finally {
    const unused = saved ? previous.filter(path=>!body.photos.includes(path)) : uploaded;
    if (unused.length) {
      await env.BUCKET.delete(unused.map(path=>path.slice('/photos/'.length))).catch(error=>console.error('Photo cleanup failed',error));
    }
  }
}

// ---- Wallet export (Apple Wallet / Google Wallet) -------------------------------------------------

const walletAssetCache = new Map();
function walletAsset(key) {
  if (typeof walletAssets==='undefined' || !Object.hasOwn(walletAssets,key)) return null;
  if (!walletAssetCache.has(key)) {
    const binary = atob(walletAssets[key]);
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    walletAssetCache.set(key, bytes);
  }
  return walletAssetCache.get(key);
}
function walletImages(prefix) {
  if (typeof walletAssets==='undefined') return {};
  return Object.fromEntries(Object.keys(walletAssets).filter(key=>key.startsWith(prefix))
    .map(key=>[key.slice(prefix.length),walletAsset(key)]));
}

// PEM secrets may be stored as the PEM text itself (also with escaped "\n", as in a service-account JSON)
// or base64-encoded so that line breaks survive the hosting's secret form.
function walletPem(value) {
  if (typeof value!=='string' || !value.trim()) return '';
  const text = value.trim();
  if (text.includes('-----BEGIN')) return text.replace(/\\n/g,'\n');
  try {
    const decoded = atob(text.replace(/\s+/g,''));
    return decoded.includes('-----BEGIN') ? decoded.trim() : '';
  } catch {
    return '';
  }
}
function appleWalletConfig(env) {
  const config = {
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID?.trim(), teamIdentifier: env.APPLE_TEAM_ID?.trim(),
    certificatePem: walletPem(env.APPLE_PASS_CERT), privateKeyPem: walletPem(env.APPLE_PASS_KEY),
    wwdrPem: walletPem(env.APPLE_WWDR_CERT), images: walletImages('apple/')
  };
  return Object.values(config).every(Boolean) ? config : null;
}
function googleWalletConfig(env, origin) {
  const config = {
    issuerId: env.GOOGLE_ISSUER_ID?.trim(), serviceAccountEmail: env.GOOGLE_SA_EMAIL?.trim(),
    privateKeyPem: walletPem(env.GOOGLE_SA_KEY), origin
  };
  return Object.values(config).every(Boolean) ? config : null;
}

function walletPage(status, message) {
  const text = String(message).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  return new Response(`<!doctype html><html lang="de-AT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Wallet · Familienzeit</title></head><body class="catalog-admin"><main><h1>Plan mitnehmen</h1><p>${text}</p><p><a href="/">Zurück zum Familienplaner</a></p></main></body></html>`,{
    status, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}
  });
}

async function wallet(request, env, kind) {
  const url = new URL(request.url);
  const label = kind==='apple' ? 'Apple Wallet' : 'Google Wallet';
  if (request.method!=='GET') return walletPage(405,'Methode nicht erlaubt.');
  const build = kind==='apple'
    ? (typeof buildApplePass==='function' ? buildApplePass : null)
    : (typeof buildGoogleSaveUrl==='function' ? buildGoogleSaveUrl : null);
  const config = kind==='apple' ? appleWalletConfig(env) : googleWalletConfig(env, url.origin);
  if (!build || !config || typeof decodeTripParam!=='function') {
    return walletPage(503,`${label} ist auf diesem Server noch nicht eingerichtet.`);
  }
  let compact;
  try {
    compact = decodeTripParam(url.searchParams.get('t'));
  } catch (error) {
    return walletPage(400,error.message);
  }
  let catalogById;
  try {
    await importInitialCatalog(env.DB);
    await addAccessibilityDetails(env.DB);
    await addGuestCardDetails(env.DB);
    const {results} = await env.DB.prepare("SELECT id, details FROM experiences WHERE active=1 AND json_extract(details,'$.region')='sfl'").all();
    catalogById = new Map(results.map(row=>[row.id,{id:row.id,...JSON.parse(row.details)}]));
  } catch (error) {
    console.error('Wallet catalog lookup failed', error);
    return walletPage(503,'Der Katalog ist gerade nicht erreichbar. Bitte versucht es gleich noch einmal.');
  }
  let trip;
  try {
    trip = resolveTrip(compact,{catalog:catalogById,places:localPlaces,cards:guestCards,id:crypto.randomUUID()});
  } catch (error) {
    return walletPage(400,error.message);
  }
  try {
    if (kind==='apple') {
      const pass = await build(trip, config);
      return new Response(pass,{headers:{
        'Content-Type':'application/vnd.apple.pkpass',
        'Content-Disposition':'attachment; filename="familienzeit.pkpass"',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
      }});
    }
    const location = await build(trip, config);
    return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'no-store'}});
  } catch (error) {
    console.error(`${label} pass failed`, error);
    return walletPage(500,`Die Karte für ${label} konnte gerade nicht erstellt werden.`);
  }
}

export default {
  async fetch(request, env) {
    const {pathname,origin} = new URL(request.url);
    if (pathname==='/api/wallet/apple' || pathname==='/api/wallet/google') {
      return wallet(request, env, pathname.slice('/api/wallet/'.length));
    }
    const walletImage = /^\/wallet\/([a-z0-9-]+)\.png$/.exec(pathname);
    if (walletImage && request.method==='GET') {
      const bytes = walletAsset('google/'+walletImage[1]+'.png');
      if (!bytes) return new Response('Bild nicht gefunden.',{status:404});
      return new Response(bytes,{headers:{
        'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'
      }});
    }
    if (pathname==='/robots.txt') return new Response(
      'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: '+origin+'/sitemap.xml\n',
      {headers:{'Content-Type':'text/plain; charset=utf-8'}});
    if (pathname==='/sitemap.xml') return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+origin+'/</loc></url></urlset>',
      {headers:{'Content-Type':'application/xml; charset=utf-8'}});

    if(pathname==='/api/admin/access'){
      try { return await manageAdmins(request,env); }
      catch(error){
        console.error('Catalog access operation failed',error);
        return json({error:'Freigaben sind gerade nicht erreichbar.'},503);
      }
    }
    if (pathname==='/api/experiences' || pathname==='/api/admin/experiences') {
      try {
        return await catalog(request, env, pathname.startsWith('/api/admin/'));
      } catch (error) {
        console.error('Catalog operation failed', error);
        return json({error:'Der Katalog ist gerade nicht erreichbar.'},503);
      }
    }
    if (photoPath.test(pathname) && request.method==='GET') {
      const object = await env.BUCKET.get(pathname.slice('/photos/'.length));
      if (!object) return new Response('Foto nicht gefunden.',{status:404});
      return new Response(object.body,{headers:{
        'Content-Type':object.httpMetadata.contentType,
        'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'
      }});
    }
    const asset = Object.hasOwn(assets,pathname) && assets[pathname];
    if (!asset) return new Response('Seite nicht gefunden.',{status:404});
    if (pathname==='/admin' && !await canEdit(request,env)) {
      if (!request.headers.get('oai-authenticated-user-id')) {
        return Response.redirect(origin+'/signin-with-chatgpt?return_to=%2Fadmin',302);
      }
      return new Response(`<!doctype html><html lang="de-AT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Anmeldung · Familienzeit</title></head><body class="catalog-admin"><main><h1>Katalogverwaltung</h1><p>Dieses ChatGPT-Konto hat keinen Zugriff auf die Verwaltung. Bitte das Eigentümerkonto, die E-Mail-Adresse deines ChatGPT-Kontos freizuschalten.</p><p><a href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">Mit einem anderen ChatGPT-Konto anmelden</a></p><p><a href="/">Zum Familienplaner</a></p></main></body></html>`,{
        status:403,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}
      });
    }
    return new Response(asset.body,{headers:{
      'Content-Type':asset.type+'; charset=utf-8',
      'X-Content-Type-Options':'nosniff',
      'Cache-Control':'no-store',
      ...(pathname==='/admin'&&{'X-Robots-Tag':'noindex'})
    }});
  }
};
