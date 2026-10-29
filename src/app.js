import { readFileSync } from 'node:fs';
const HTML=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');

export function parseCSV(text,strict=false){
 const rows=[];let row=[],cell='',q=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){cell+='"';i++}else q=!q}else if(c===','&&!q){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell=''}else cell+=c}
 if(q)throw Error('Unclosed CSV quote');row.push(cell);if(row.some(x=>x!==''))rows.push(row);if(!rows.length)throw Error('Empty CSV');const head=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]/g,''));if(strict&&rows.some(r=>r.length!==head.length))throw Error('CSV column count mismatch. Use semicolons inside list fields, or quote fields containing commas');const result=rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]?.trim()??''])));Object.defineProperty(result,'headers',{value:head});return result;
}
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const dateOK=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const list=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
export function days(from,to){if(!dateOK(from)||!dateOK(to)||from>to||(Date.parse(to)-Date.parse(from))/864e5>30)throw Error('Select a valid date range of up to 31 days');return Array.from({length:1+(Date.parse(to)-Date.parse(from))/864e5},(_,i)=>new Date(Date.parse(from)+i*864e5).toISOString().slice(0,10))}
function validateMaps(maps){if(!Array.isArray(maps)||maps.length>100)throw Error('Maximum 100 mappings');const used=new Set(),offers=new Set(),advs=new Map();for(const m of maps){if(!m.id||!m.name||!m.advertiser||!m.app||!m.pids?.length)throw Error('Complete advertiser, app and PID details');if(!['ua','rt'].includes(m.mode))throw Error('Choose UA or RT');for(const pid of m.pids){if(!/^[\w.-]+$/.test(pid))throw Error('Invalid PID');const k=[m.app,pid,m.mode,m.timezone].join('|');if(used.has(k))throw Error('An app/PID/mode can only belong to one comparison');used.add(k)}for(const o of m.offers||[]){if(!/^\d+$/.test(o)||offers.has(o))throw Error('Offer IDs must be numeric and assigned to one mapping only');offers.add(o)}if(advs.has(m.advertiser)&&(!m.offers?.length||!advs.get(m.advertiser)))throw Error('Multiple mappings for an advertiser require distinct offer IDs on every mapping');advs.set(m.advertiser,!!m.offers?.length);try{new Intl.DateTimeFormat('en',{timeZone:m.timezone})}catch{throw Error('Invalid timezone')}}return maps}

export function normalizeSettings(c){return {...c,agencies:Array.isArray(c.agencies)?c.agencies:(c.agency?[{id:'legacy',prt:c.agency}]:[]),maps:c.maps||[]}}
export function selectedAgencies(m,c){const ids=m.agencyIds??c.agencies.slice(0,1).map(a=>a.id);return ids.map(id=>{const a=c.agencies.find(a=>a.id===id);if(!a)throw Error('Mapping references a removed agency');return a})}
export function scopeFingerprint(m,c){return m.agencyIds?JSON.stringify({map:m,agencies:selectedAgencies(m,c).map(a=>({id:a.id,prt:a.prt}))}):JSON.stringify(m)}
function validateSettings(b){const c=normalizeSettings(b);if(c.agencies.length>10)throw Error('Maximum 10 agencies');const ids=new Set(),prts=new Set();for(const a of c.agencies){if(!a.id||!/^[a-zA-Z0-9_.-]+$/.test(a.prt))throw Error('Enter a valid agency PRT for every connection');if(ids.has(a.id)||prts.has(a.prt.toLowerCase()))throw Error('Each agency PRT must be unique');ids.add(a.id);prts.add(a.prt.toLowerCase())}validateMaps(c.maps);for(const m of c.maps){if(m.agencyIds&&(!m.agencyIds.length||new Set(m.agencyIds).size!==m.agencyIds.length))throw Error('Select at least one unique agency per mapping');selectedAgencies(m,c)}return {base:String(c.base||''),agencies:c.agencies.map(a=>({id:String(a.id),prt:String(a.prt)})),maps:c.maps}}
// Bulk import adds mappings only; existing mappings and credentials are preserved.
export function previewMappingCSV(text,settings){
 if(typeof text!=='string'||text.length>1_000_000)throw Error('Choose a CSV file under 1 MB');
 const rows=parseCSV(text,true),headers=rows.headers,required=['name','advertiserid','appid','pids','agencyprts'];
 if(new Set(headers).size!==headers.length)throw Error('CSV has duplicate column headers');
 for(const key of required)if(!headers.includes(key))throw Error('Missing CSV column: '+key);
 if(!rows.length||rows.length>100)throw Error('CSV must contain 1–100 mappings');
 const cfg=normalizeSettings(settings),maps=[...cfg.maps],preview=[];
 const split=v=>[...new Set(String(v||'').split(/[,;|]/).map(x=>x.trim()).filter(Boolean))];
 for(const [i,r] of rows.entries()){
 const item={row:i+2,name:r.name,app:r.appid,error:null};
 try{
 const prts=split(r.agencyprts);if(!prts.length)throw Error('Agency PRTs are required');
 const agencyIds=prts.map(prt=>{const agency=cfg.agencies.find(a=>a.prt.toLowerCase()===prt.toLowerCase());if(!agency)throw Error('Unknown agency PRT: '+prt+'. Save it in Connections first');return agency.id});
 const mode=(r.mode||'ua').toLowerCase();
 const m={id:crypto.randomUUID(),name:r.name,advertiser:r.advertiserid,app:r.appid,pids:split(r.pids),offers:split(r.offerids),mode,timezone:r.timezone||'UTC',agencyIds};
 validateSettings({...cfg,maps:[...maps,m]});maps.push(m);item.mapping=m;
 }catch(e){item.error=e.message}
 preview.push(item);
 }
 return {rows:preview,valid:preview.every(r=>!r.error),count:rows.length,maps};
}

export function combineAgencies(parts){const error=parts.filter(a=>a.error||!Number.isFinite(a.value)).map(a=>a.prt+': '+(a.error||'Not fetched')).join('; ');const usable=parts.filter(a=>Number.isFinite(a.value)&&(!a.error||a.incomplete));return {value:error?null:parts.reduce((s,a)=>s+a.value,0),availableSubtotal:error&&usable.length?usable.reduce((s,a)=>s+a.value,0):null,incomplete:!!error&&usable.length>0,agencies:parts,error:error||null,at:new Date().toISOString(),via:[...new Set(parts.map(a=>a.via).filter(Boolean))].join('+')}}

async function load(env,key,fallback){if(!env.BUCKET)throw Error('Persistent storage unavailable');const o=await env.BUCKET.get(key);return o?o.json():fallback}
async function save(env,key,value){await env.BUCKET.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}})}

export async function remote(url,headers){
 const authHosts=new Set(['hq1.appsflyer.com','hq.appsflyer.com']);const secretValues=Object.values(headers).filter(v=>typeof v==='string').flatMap(v=>[v,v.replace(/^Bearer\s+/i,'')]);const redirectHosts=[];
 const sanitize=value=>{let t=String(value||'');for(const v of secretValues)if(v)t=t.split(v).join('[redacted]');return t.replace(/https?:\/\/[^\s"<>]+/gi,'[URL omitted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/\beyJ[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,500)};
 let r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(25000)});
 for(let hop=0;r.status>=300&&r.status<400&&hop<4;hop++){
 const next=new URL(r.headers.get('location'),url),previous=new URL(url);
 if(next.protocol!=='https:'||next.username||next.password||next.port||!(/(^|\.)appsflyer\.com$/.test(next.hostname)||/(^|\.)amazonaws\.com$/.test(next.hostname)||/(^|\.)storage\.googleapis\.com$/.test(next.hostname)))throw Error('Unsupported report redirect');
 // Keep a bearer only between the two documented AF API hosts. Never forward it to report storage.
 if(next.origin!==previous.origin){headers=authHosts.has(previous.hostname)&&authHosts.has(next.hostname)&&headers.Authorization?{Authorization:headers.Authorization,Accept:headers.Accept||'text/csv'}:{}}
 url=next.href;redirectHosts.push(next.hostname);r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(25000)})}
 if(!r.ok){const responseType=(r.headers.get('content-type')||'unknown').split(';')[0];let detail='';const body=(await r.text()).slice(0,32000);try{const j=JSON.parse(body);const error=j.message||j.error_description||j.error||j.errors;detail=typeof error==='string'?error:typeof error?.message==='string'?error.message:''}catch{if(/xml/i.test(responseType)||body.startsWith('<?xml')){detail=[body.match(/<Code>([^<]*)<\/Code>/)?.[1],body.match(/<Message>([^<]*)<\/Message>/)?.[1]].filter(Boolean).join(': ')}else if(/text\/plain/i.test(responseType))detail=body.slice(0,500)}
 detail=sanitize(detail);const host=new URL(url).hostname;const e=Error('HTTP '+r.status+' from '+host+(detail?' — '+detail:r.status===401||r.status===403?' — request denied; inspect AF response diagnostics':r.status===429?' — rate limit reached; retry later':''));e.diagnostics={httpStatus:r.status,responseHost:host,responseType,redirectHosts,upstreamMessage:detail||'No structured error message returned'};throw e}
 const text=await r.text();if(text.length>16e6)throw Error('Report too large; choose fewer days');return text;
}
async function affise(base,token,m,from,to){const u=new URL(base);if(u.protocol!=='https:'||!/^api[-.][a-z0-9.-]+\.affise\.com$/i.test(u.hostname)||u.username||u.password||u.port)throw Error('Enter your HTTPS api-<company>.affise.com API domain');u.pathname='/3.0/stats/custom';u.search='';const p=u.searchParams;['year','month','day'].forEach(v=>p.append('slice[]',v));p.set('filter[date_from]',from);p.set('filter[date_to]',to);p.set('filter[advertiser]',m.advertiser);(m.offers||[]).forEach(v=>p.append('filter[offer][]',v));p.set('timezone',m.timezone);p.set('limit','500');const out={};let count=0;for(let page=1;page<=20;page++){p.set('page',page);const data=JSON.parse(await remote(u.href,{'API-Key':token}));if(data.status!==1||!Array.isArray(data.stats))throw Error('Unexpected Affise stats response');for(const s of data.stats){const sl=s.slice||{};const d=String(sl.year)+'-'+String(sl.month).padStart(2,'0')+'-'+String(sl.day).padStart(2,'0');const n=Number(s.traffic?.raw);if(!dateOK(d)||!Number.isSafeInteger(n)||n<0)throw Error('Invalid date/clicks in Affise response');out[d]=(out[d]||0)+n}count+=data.stats.length;if(!data.pagination||count>=Number(data.pagination.total_count)||data.stats.length===0)return out}throw Error('Affise pagination limit exceeded')}

export function aggregateAF(text,m,ds){
 const rows=parseCSV(text),out={},keys=rows.headers||[];
 const diag={rowsReceived:rows.length,matchedRows:0,numericRows:0,unavailableRows:0,unavailableByDate:{},numericByPid:{},unavailableByPid:{},unavailableSamples:[],skipped:{agency:0,app:0,pid:0,date:0},returnedPids:[],returnedAgencies:[],returnedDates:[],selectedPids:m.pids,selectedAgency:m.agencyPrt||null,headers:keys.slice(0,30).map(k=>k.slice(0,60)),matchedByDate:{}};
 const fail=message=>{const e=Error(message);e.diagnostics=diag;throw e};
 if(!keys.includes('date')||!keys.includes('clicks')||!keys.some(k=>['mediasourcepid','mediasource','pid'].includes(k)))fail('AF response is not a valid daily clicks CSV (expected Date, Media Source (pid), Clicks). No zero was recorded');
 if(rows.length>=200000)fail('AF report may be truncated; choose a smaller date range');
 const add=(arr,value)=>{if(value&&!arr.includes(value)&&arr.length<20)arr.push(String(value).slice(0,120))};
 for(const r of rows){const agency=r.agencypmdafprt||r.agencyafprt||r.agency||r.afprt,pid=r.mediasourcepid||r.mediasource||r.pid,app=r.appid||r.app,d=r.date?.slice(0,10);add(diag.returnedPids,pid);add(diag.returnedAgencies,agency);add(diag.returnedDates,d);
 if(m.agencyPrt&&agency&&agency!==m.agencyPrt){diag.skipped.agency++;continue}
 if(app&&app!==m.app){diag.skipped.app++;continue}
 if(!m.pids.includes(pid)){diag.skipped.pid++;continue}
 if(!ds.includes(d)){diag.skipped.date++;continue}
 diag.matchedRows++;diag.matchedByDate[d]=(diag.matchedByDate[d]||0)+1;if(r.clicks===''||r.clicks.toUpperCase()==='N/A'||r.clicks==='-'){diag.unavailableRows++;diag.unavailableByDate[d]=(diag.unavailableByDate[d]||0)+1;diag.unavailableByPid[pid]=(diag.unavailableByPid[pid]||0)+1;if(diag.unavailableSamples.length<8)diag.unavailableSamples.push({date:d,pid,clicks:r.clicks||'(blank)'});continue}
 const n=Number(r.clicks.replace(/,/g,''));if(!Number.isSafeInteger(n)||n<0)fail('Invalid click count in AF CSV');out[d]=(out[d]||0)+n;diag.numericRows++;diag.numericByPid[pid]=(diag.numericByPid[pid]||0)+n;
 }
 if(!diag.matchedRows){let message=!rows.length?'AF returned a header-only report with no data rows':diag.skipped.agency===rows.length?'No rows match agency '+m.agencyPrt:diag.skipped.pid?'No report rows match the selected PIDs':diag.skipped.date?'Selected-PID rows have different report dates':'No rows match this app/agency/PID scope';fail(message+'. Check the AF diagnostics; no zero was recorded')}
 Object.defineProperty(out,'diagnostics',{value:diag});return out;
}

const afInFlight=new Map();
const hashText=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
function fromCachedAF(saved,cached){const diagnostics={...(saved.diagnostics||{}),fetchedAt:saved.fetchedAt,fromCache:cached,cacheAgeSeconds:Math.max(0,Math.floor((Date.now()-saved.fetchedAt)/1000))};if(saved.error){const e=Error(saved.error);e.diagnostics=diagnostics;throw e}const values={...saved.values};Object.defineProperty(values,'diagnostics',{value:diagnostics});return values}
async function af(token,m,from,to,ds,cache,agency,env){
 const u=new URL('https://hq1.appsflyer.com/api/agg-data/export/app/'+encodeURIComponent(m.app)+'/partners_by_date_report/v5');u.searchParams.set('from',from);u.searchParams.set('to',to);u.searchParams.set('timezone',m.timezone);if(m.mode==='rt')u.searchParams.set('reattr','true');
 const tokenHash=await hashText(token),key=agency.id+'|'+u.href+'|'+tokenHash,scope=await hashText(key+'|'+[...m.pids].sort().join(',')),cachePath='af-cache/v2/'+scope;
 const ttl=ds.length<=2?65000:3600000,saved=await load(env,cachePath,null);if(saved&&Date.now()-saved.fetchedAt<(saved.error?65000:ttl))return fromCachedAF(saved,true);
 let fetchedAt=Date.now();try{
 if(!cache.has(key)){
 const guardKey='af-throttle/v1/'+await hashText(agency.prt+'|'+m.app+'|partners-daily-report');
 if(!afInFlight.has(key)){
 const promise=(async()=>{const last=await load(env,guardKey,null);if(last&&Date.now()-last.at<65000){const wait=Math.ceil((65000-(Date.now()-last.at))/1000);const e=Error('AF request cooldown: wait '+wait+' seconds. No new API request was sent');e.diagnostics={cooldownSeconds:wait,requestSent:false,app:m.app,mode:m.mode,timezone:m.timezone};throw e}await save(env,guardKey,{at:Date.now()});const at=Date.now();const text=await remote(u.href,{Authorization:'Bearer '+token,Accept:'text/csv'});return {text,fetchedAt:at}})();afInFlight.set(key,promise);promise.finally(()=>afInFlight.delete(key)).catch(()=>{})}
 cache.set(key,afInFlight.get(key))}
 const response=await cache.get(key);fetchedAt=response.fetchedAt;const values=aggregateAF(response.text,{...m,agencyPrt:agency.prt},ds);const record={fetchedAt,values,diagnostics:{...values.diagnostics,app:m.app,mode:m.mode,timezone:m.timezone}};await save(env,cachePath,record);return fromCachedAF(record,false)
 }catch(e){e.diagnostics={...(e.diagnostics||{}),fetchedAt,app:m.app,mode:m.mode,timezone:m.timezone,selectedAgency:agency.prt};if(e.diagnostics.requestSent!==false)await save(env,cachePath,{fetchedAt,error:e.message,diagnostics:e.diagnostics});throw e}
}
function isOwner(req,env){return !!env.CREDENTIAL_OWNER_EMAIL&&!!req.headers.get('oai-authenticated-user-id')&&req.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.CREDENTIAL_OWNER_EMAIL.toLowerCase()}
async function encryptionKey(env){if(!/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_ENCRYPTION_KEY||''))throw Error('Secure credential storage is not configured');return crypto.subtle.importKey('raw',Uint8Array.from(env.CREDENTIAL_ENCRYPTION_KEY.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
const encode64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const decode64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function readVault(env){const sealed=await load(env,'credentials/v1',null);if(!sealed)return {agencies:{}};try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(sealed.iv),additionalData:new TextEncoder().encode('adsphire-click-reconcile:v1')},await encryptionKey(env),decode64(sealed.ciphertext));return JSON.parse(new TextDecoder().decode(plain))}catch{throw Error('Saved credentials could not be decrypted; existing storage was not changed')}}
async function writeVault(env,data){const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('adsphire-click-reconcile:v1')},await encryptionKey(env),new TextEncoder().encode(JSON.stringify(data)));await save(env,'credentials/v1',{version:1,iv:encode64(iv),ciphertext:encode64(new Uint8Array(ciphertext))})}
function vaultStatus(v,c){return {affise:!!v.affise?.token&&v.affise.base===c.base,agencies:Object.fromEntries(c.agencies.map(a=>[a.id,!!v.agencies?.[a.id]?.token&&v.agencies[a.id].prt===a.prt]))}}
function checkedToken(value){if(typeof value!=='string'||value.trim().length>8192||/[\r\n]/.test(value))throw Error('Invalid API token');return value.trim()}

export default {async fetch(req,env){const u=new URL(req.url);try{
 if(!u.pathname.startsWith('/api/'))return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
 if(req.method!=='GET'&&req.headers.get('origin')!==u.origin)return json({error:'Origin denied'},403);
 const owner=isOwner(req,env);if(req.method!=='GET'&&!owner)return json({error:'Sign in with the dashboard password to manage connections or fetch reports'},403);

 if(req.method==='GET'&&u.pathname==='/api/state'){const settings=normalizeSettings(await load(env,'settings',{base:'',maps:[]}));return json({settings,updated:await load(env,'updated',null),isOwner:owner,credentialStatus:owner?vaultStatus(await readVault(env),settings):null})}
 if(req.method==='GET'&&u.pathname==='/api/reports'){const ds=days(u.searchParams.get('from'),u.searchParams.get('to'));const all=[];for(const d of ds)all.push(...await load(env,'reports/'+d,[]));for(const r of all){if(r.af?.agencies){for(const a of r.af.agencies)if(a.value===0&&!a.diagnostics&&!a.error)a.error='Unverified zero from an earlier fetch. Fetch again for AF diagnostics';r.af={...combineAgencies(r.af.agencies),at:r.af.at}}else if(r.af?.value===0&&!r.af.error)r.af.error='Unverified zero from an earlier fetch. Fetch again for AF diagnostics'}return json(all)}
 const raw=await req.text();if(raw.length>5e6)return json({error:'Request too large'},413);const b=JSON.parse(raw);

 if(u.pathname==='/api/credentials'){
 const cfg=normalizeSettings(await load(env,'settings',{base:'',maps:[]})),vault=await readVault(env);vault.agencies??={};
 if(b.affiseToken){if(!cfg.base)throw Error('Save your Affise API domain first');vault.affise={base:cfg.base,token:checkedToken(b.affiseToken)}}
 const incoming=b.agencyTokens||{};if(Object.keys(incoming).length>10)throw Error('Maximum 10 agency tokens');for(const [id,value] of Object.entries(incoming)){if(!value)continue;const a=cfg.agencies.find(a=>a.id===id);if(!a)throw Error('Save the agency connection before its token');vault.agencies[id]={prt:a.prt,token:checkedToken(value)}}
 if(b.remove&&!Array.isArray(b.remove))throw Error('Invalid credential removal');for(const id of b.remove||[]){if(id==='affise')delete vault.affise;else delete vault.agencies[id]}
 const seen=new Map();for(const a of cfg.agencies){const entry=vault.agencies[a.id];if(entry?.prt===a.prt&&entry.token){if(seen.has(entry.token))throw Error('Use a different V2 token for each agency to avoid double counting');seen.set(entry.token,a.id)}}
 await writeVault(env,vault);return json({ok:true,credentialStatus:vaultStatus(vault,cfg)})}
 if(u.pathname==='/api/mappings-csv'){
 const cfg=normalizeSettings(await load(env,'settings',{base:'',agencies:[],maps:[]}));
 const result=previewMappingCSV(b.csv,cfg);
 if(b.commit===true){if(!result.valid)return json({...result,maps:undefined,error:'Fix every CSV row before importing. Nothing was saved'},400);await save(env,'settings',validateSettings({...cfg,maps:result.maps}))}
 return json({rows:result.rows,valid:result.valid,count:result.count,imported:b.commit===true?result.count:0})
 }
 if(u.pathname==='/api/settings'){const c=validateSettings(b);const old=normalizeSettings(await load(env,'settings',{maps:[]}));for(const a of old.agencies){const next=c.agencies.find(x=>x.id===a.id);if(next&&next.prt!==a.prt&&c.maps.some(m=>(m.agencyIds??old.agencies.slice(0,1).map(x=>x.id)).includes(a.id)))throw Error('Remove agency '+a.prt+' from its mappings before changing its PRT')}await save(env,'settings',c);return json({ok:true})}
 if(u.pathname==='/api/sync'||u.pathname==='/api/import'){
 const ds=days(b.from,b.to),cfg=normalizeSettings(await load(env,'settings',{maps:[]}));const maps=validateMaps(cfg.maps).filter(m=>!b.mapping||m.id===b.mapping);if(!maps.length)throw Error('Add a mapping first');if(maps.length>15)throw Error('Select one mapping, or fetch at most 15 mappings at once');const logs=[],cache=new Map();const vault=await readVault(env);if(!b.affiseToken&&vault.affise?.base===cfg.base)b.affiseToken=vault.affise.token;b.agencyTokens={...(b.agencyTokens||{})};for(const a of cfg.agencies){const entry=vault.agencies?.[a.id];if(!b.agencyTokens[a.id]&&entry?.prt===a.prt)b.agencyTokens[a.id]=entry.token}
 const usedTokens=new Map();for(const m of maps)for(const a of selectedAgencies(m,cfg)){const token=b.agencyTokens?.[a.id];if(token){if(usedTokens.has(token)&&usedTokens.get(token)!==a.id)throw Error('The same token is entered for multiple agencies. Use each agency’s own V2 token to avoid double counting');usedTokens.set(token,a.id)}}
 async function update(m,source,fn){for(const d of ds){let records=await load(env,'reports/'+d,[]);let rec=records.find(r=>r.mapping===m.id);const fingerprint=scopeFingerprint(m,cfg);if(!rec||rec.fingerprint!==fingerprint){records=records.filter(r=>r.mapping!==m.id);rec={date:d,mapping:m.id,fingerprint,name:m.name,app:m.app,pids:m.pids,mode:m.mode,timezone:m.timezone};records.push(rec)}rec[source]=fn(rec[source],d);await save(env,'reports/'+d,records)}}
 for(const m of maps){for(const source of (u.pathname==='/api/import'?['af']:(b.source==='affise'?['affise']:b.source==='af'?['af']:['affise','af']))){
 if(source==='affise'){try{if(!b.affiseToken)throw Error('Enter the Affise API key in Connections');const result=await affise(cfg.base,b.affiseToken,m,b.from,b.to);await update(m,'affise',(_,d)=>({value:result[d]??0,at:new Date().toISOString(),via:'API',error:null}));logs.push({name:m.name,source,ok:true})}catch(e){await update(m,'affise',old=>({...old,error:e.message}));logs.push({name:m.name,source,ok:false,error:e.message})}continue}
 const agencies=selectedAgencies(m,cfg);if(!agencies.length){logs.push({name:m.name,source,ok:false,error:'Add an agency connection and select it in the mapping'});continue}
 const outcomes=[];for(const a of agencies){if(u.pathname==='/api/import'&&b.agencyId!==a.id)continue;try{let result;if(u.pathname==='/api/import'){if(!b.confirmTimezone)throw Error('Confirm imported report timezone and scope');result=aggregateAF(b.csv,{...m,agencyPrt:a.prt},ds)}else{const token=b.agencyTokens?.[a.id];if(!token)throw Error('Enter this agency’s V2 token in Connections');result=await af(token,m,b.from,b.to,ds,cache,a,env)}outcomes.push({agency:a,result});logs.push({name:m.name,source:a.prt,ok:true,partial:!!result.diagnostics?.unavailableRows,cached:!!result.diagnostics?.fromCache})}catch(e){outcomes.push({agency:a,error:e.message,diagnostics:e.diagnostics||null});logs.push({name:m.name,source:a.prt,ok:false,error:e.message,cached:!!e.diagnostics?.fromCache})}}
 if(u.pathname==='/api/import'&&!outcomes.length)throw Error('Choose an agency selected in this mapping');
 await update(m,'af',(old,d)=>{const parts=agencies.map(a=>{const prev=old?.agencies?.find(x=>x.id===a.id&&x.prt===a.prt)||(agencies.length===1&&old&&!old.agencies?{...old,id:a.id,prt:a.prt}:null);const outcome=outcomes.find(o=>o.agency.id===a.id);if(!outcome)return prev||{id:a.id,prt:a.prt,value:null,error:'Not fetched'};if(!outcome.error&&outcome.result?.diagnostics?.unavailableByDate?.[d]){const count=outcome.result.diagnostics.unavailableByDate[d];return {id:a.id,prt:a.prt,value:Object.hasOwn(outcome.result,d)?outcome.result[d]:null,incomplete:true,at:new Date(outcome.result.diagnostics.fetchedAt||Date.now()).toISOString(),via:u.pathname==='/api/import'?'CSV':outcome.result.diagnostics.fromCache?'API (cached)':'API',error:count+' AF row(s) have blank/N/A clicks; '+(Object.hasOwn(outcome.result,d)?'numeric subtotal shown, total incomplete':'no numeric clicks available'),diagnostics:outcome.result.diagnostics}}const error=outcome.error||(Object.hasOwn(outcome.result||{},d)?null:'AF has no matching row for '+d+'; this is not a confirmed zero');return error?{...prev,id:a.id,prt:a.prt,incomplete:false,error,diagnostics:outcome.diagnostics||outcome.result?.diagnostics||null}:{id:a.id,prt:a.prt,value:outcome.result[d],at:new Date(outcome.result.diagnostics?.fetchedAt||Date.now()).toISOString(),via:u.pathname==='/api/import'?'CSV':outcome.result.diagnostics?.fromCache?'API (cached)':'API',error:null,diagnostics:outcome.result.diagnostics}});return combineAgencies(parts)})
 }}await save(env,'updated',new Date().toISOString());return json({logs})}
 return json({error:'Not found'},404)
 }catch(e){return json({error:e.message||'Request failed'},400)}}};
