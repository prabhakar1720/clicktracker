import http from 'node:http';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import app from './src/app.js';

export class DiskStore {
  constructor(directory){this.directory=resolve(directory)}
  file(key){if(typeof key!=='string'||!/^[a-zA-Z0-9_./-]+$/.test(key)||key.startsWith('/')||key.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid storage key');return join(this.directory,key+'.json')}
  async get(key){try{const text=await readFile(this.file(key),'utf8');return {json:async()=>JSON.parse(text)}}catch(e){if(e.code==='ENOENT')return null;throw e}}
  async put(key,value){const filename=this.file(key);await mkdir(dirname(filename),{recursive:true,mode:0o700});const temporary=filename+'.'+randomBytes(8).toString('hex')+'.tmp';await writeFile(temporary,String(value),{mode:0o600});await rename(temporary,filename)}
  async read(key,fallback=null){const item=await this.get(key);return item?item.json():fallback}
  async reportRows(){const rows=[];let files;try{files=await readdir(join(this.directory,'reports'))}catch(e){if(e.code==='ENOENT')return rows;throw e}for(const file of files.sort()){if(/^\d{4}-\d{2}-\d{2}\.json$/.test(file))rows.push(...await this.read('reports/'+file.slice(0,-5),[]))}return rows}
  async pruneCache(){for(const category of ['af-cache','af-throttle']){const walk=async directory=>{let files;try{files=await readdir(directory,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}for(const file of files){const path=join(directory,file.name);if(file.isDirectory())await walk(path);else if(file.name.endsWith('.json')&&(Date.now()-(await stat(path)).mtimeMs)>7*86400000)await unlink(path)}};await walk(join(this.directory,category))}}
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function loginPage(error=''){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adsphire · Login</title><style>body{font:15px system-ui;background:#f7f8fa;color:#263246;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;border:1px solid #e3e7ed;padding:36px;border-radius:14px;width:min(350px,80vw)}h1{font-size:25px;margin:0 0 8px}p{color:#778397;line-height:1.6}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:7px;margin-top:12px}input{border:1px solid #dce1e7}button{background:#ec681f;border:0;color:white;font-weight:650;cursor:pointer}.error{color:#b63e36}</style><div class="card"><h1>adsphire<span style="color:#ec681f">.</span></h1><p>Click reconciliation<br>Sign in to your dashboard.</p>${error?'<p class="error">'+escape(error)+'</p>':''}<form method="post" action="/login"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button>Sign in</button></form></div></html>`}
const constantEqual=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
export function createDashboardServer(options={}){
 const configuration={...process.env,...options};
 const password=configuration.DASHBOARD_PASSWORD||'',sessionSecret=configuration.SESSION_SECRET||'',encryptionSecret=configuration.ENCRYPTION_SECRET||'';
 if(password.length<12||password.startsWith('replace-'))throw Error('Set DASHBOARD_PASSWORD to a private password of at least 12 characters');
 if(sessionSecret.length<32||encryptionSecret.length<32||sessionSecret.startsWith('replace-')||encryptionSecret.startsWith('replace-'))throw Error('Set SESSION_SECRET and ENCRYPTION_SECRET to distinct random values of at least 32 characters');
 if(sessionSecret===encryptionSecret)throw Error('SESSION_SECRET and ENCRYPTION_SECRET must be different');
 const production=configuration.NODE_ENV==='production',store=new DiskStore(configuration.DATA_DIR||'./data');
 const env={BUCKET:store,CREDENTIAL_OWNER_EMAIL:'render-owner@local.invalid',CREDENTIAL_ENCRYPTION_KEY:createHash('sha256').update(encryptionSecret).digest('hex')};
 const passwordVersion=createHash('sha256').update(password).digest('hex').slice(0,16);
 const sign=text=>createHmac('sha256',sessionSecret).update(text).digest('base64url');
 const makeSession=()=>{const payload=Buffer.from(JSON.stringify({expires:Date.now()+12*3600000,version:passwordVersion,nonce:randomBytes(16).toString('hex')})).toString('base64url');return payload+'.'+sign(payload)};
 function authenticated(req){try{const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('adsphire_session='))?.slice(17);if(!cookie)return false;const [payload,signature,...rest]=cookie.split('.');if(rest.length||!signature||!constantEqual(signature,sign(payload)))return false;const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.expires>Date.now()&&data.version===passwordVersion}catch{return false}}
 const cookie=value=>'adsphire_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(value?'43200':'0')+(production?'; Secure':'');
 const attempts=new Map();let queue=Promise.resolve();
 async function body(req,limit=5_000_000){let length=0;const parts=[];for await(const chunk of req){length+=chunk.length;if(length>limit){const error=Error('Request too large');error.status=413;throw error}parts.push(chunk)}return Buffer.concat(parts)}
 function requestOrigin(req){const configured=configuration.PUBLIC_URL||configuration.RENDER_EXTERNAL_URL;if(configured){const origin=new URL(configured);if(production&&origin.protocol!=='https:')throw Error('PUBLIC_URL must use HTTPS in production');return origin.origin}return (production?'https://':'http://')+req.headers.host}
 function send(res,response){const headers={'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",...Object.fromEntries(response.headers)};res.writeHead(response.status,headers);return response.arrayBuffer().then(bytes=>res.end(Buffer.from(bytes)))}
 function enqueue(operation){const promise=queue.then(operation);queue=promise.catch(()=>{});return promise}
 const server=http.createServer(async(req,res)=>{try{
  const origin=requestOrigin(req),url=new URL(req.url,origin);if(url.origin!==origin)return send(res,json({error:'Invalid origin'},400));
  if(url.pathname==='/healthz')return send(res,json({ok:true}));
  if(url.pathname==='/login'){
   if(req.method==='GET'){if(authenticated(req))return send(res,new Response(null,{status:303,headers:{location:'/'}}));return send(res,new Response(loginPage(),{headers:{'content-type':'text/html; charset=utf-8'}}))}
   if(req.method!=='POST')return send(res,json({error:'Method not allowed'},405));
   if(req.headers.origin!==origin)return send(res,json({error:'Origin denied'},403));
   const address=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim();const previous=attempts.get(address);if(previous&&Date.now()-previous.since<15*60000&&previous.count>=10)return send(res,new Response(loginPage('Too many attempts. Try again in 15 minutes.'),{status:429,headers:{'content-type':'text/html; charset=utf-8','retry-after':'900'}}));
   const value=new URLSearchParams((await body(req,8192)).toString()).get('password');if(!constantEqual(value||'',password)){const current=previous&&Date.now()-previous.since<15*60000?previous:{since:Date.now(),count:0};current.count++;attempts.set(address,current);if(attempts.size>1000)attempts.delete(attempts.keys().next().value);return send(res,new Response(loginPage('Incorrect password.'),{status:401,headers:{'content-type':'text/html; charset=utf-8'}}))}
   attempts.delete(address);return send(res,new Response(null,{status:303,headers:{location:'/', 'set-cookie':cookie(makeSession())}}));
  }
  if(!authenticated(req))return send(res,url.pathname.startsWith('/api/')?json({error:'Sign in to the dashboard'},401):new Response(null,{status:303,headers:{location:'/login'}}));
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==origin)return send(res,json({error:'Origin denied'},403));
  if(url.pathname==='/logout')return send(res,req.method==='POST'?new Response(null,{status:303,headers:{location:'/login','set-cookie':cookie('')}}):json({error:'Use POST'},405));
  const bytes=req.method==='GET'||req.method==='HEAD'?null:await body(req,url.pathname==='/api/restore-backup'?20_000_000:5_000_000);
  const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','render-owner');headers.set('oai-authenticated-user-email',env.CREDENTIAL_OWNER_EMAIL);headers.delete('host');
  const request=new Request(url,{method:req.method,headers,...(bytes?{body:bytes}:{})});
  if(url.pathname==='/api/backup'&&req.method==='GET')return send(res,await enqueue(async()=>new Response(JSON.stringify({format:'adsphire-click-backup-v1',createdAt:new Date().toISOString(),settings:await store.read('settings',{base:'',agencies:[],maps:[]}),reports:await store.reportRows()},null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename="adsphire-backup.json"'}})));
  if(url.pathname==='/api/restore-backup'&&req.method==='POST')return send(res,await enqueue(async()=>{
   const data=JSON.parse(bytes.toString());if(!data.settings||!Array.isArray(data.reports)||data.reports.length>50000)return json({error:'Invalid backup: settings and reports are required'},400);
   const grouped=new Map();for(const row of data.reports){if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||typeof row.mapping!=='string'||typeof row.fingerprint!=='string')return json({error:'Invalid report row in backup'},400);if(!grouped.has(row.date))grouped.set(row.date,[]);grouped.get(row.date).push(row)}
   const settingsResponse=await app.fetch(new Request(origin+'/api/settings',{method:'POST',headers,body:JSON.stringify(data.settings)}),env);if(!settingsResponse.ok)return settingsResponse;
   for(const [date,rows] of grouped){const existing=await store.read('reports/'+date,[]);const merged=new Map(existing.map(r=>[r.mapping,r]));for(const row of rows)merged.set(row.mapping,row);await store.put('reports/'+date,JSON.stringify([...merged.values()]))}return json({ok:true,reportCount:data.reports.length})
  }));
  return send(res,req.method==='GET'||req.method==='HEAD'?await app.fetch(request,env):await enqueue(()=>app.fetch(request,env)));
 }catch(e){console.error('Request failed:',e.name);if(!res.headersSent)return send(res,json({error:e.status===413?'Request too large':'Request failed; check server configuration'},e.status||500));res.end()}});
 server.requestTimeout=10*60000;server.headersTimeout=30000;return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const {server,store}=createDashboardServer();await mkdir(store.directory,{recursive:true,mode:0o700});await store.pruneCache();server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Adsphire click dashboard listening on configured PORT'));const cleanup=setInterval(()=>store.pruneCache().catch(()=>console.error('Cache cleanup failed')),86400000);cleanup.unref();process.on('SIGTERM',()=>{clearInterval(cleanup);server.close(()=>process.exit(0))})}catch(e){console.error(e.message);process.exit(1)}
}
