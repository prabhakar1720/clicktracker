import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const src=await readFile('src/app.js','utf8');const {default:worker,aggregateAF,days,normalizeSettings}=await import('../src/app.js');
const agencies=[{id:'a',prt:'agency_a'},{id:'b',prt:'agency_b'}];const map={id:'one',name:'Test App',advertiser:'adv1',app:'test.app',pids:['mine_int'],offers:['101'],timezone:'UTC',mode:'ua',agencyIds:['a','b']};
assert.deepEqual(aggregateAF('Date,Media Source (pid),Campaign,Clicks\n2026-10-28,mine_int,"A, B",120\n2026-10-28,mine_int,C,30\n2026-10-28,other_int,D,900',map,['2026-10-28']),{'2026-10-28':150});
assert.deepEqual(aggregateAF('Date,Media Source (pid),Agency (af_prt),Clicks\n2026-10-28,mine_int,agency_a,100\n2026-10-28,mine_int,agency_b,70',{...map,agencyPrt:'agency_a'},['2026-10-28']),{'2026-10-28':100});
const unavailable=aggregateAF('Date,Media Source (pid),Clicks\n2026-10-28,mine_int,N/A',map,['2026-10-28']);assert.equal(unavailable['2026-10-28'],undefined);assert.equal(unavailable.diagnostics.unavailableRows,1);
assert.throws(()=>days('2026-02-30','2026-03-01'),/valid/);
assert.deepEqual(normalizeSettings({agency:'old_prt',maps:[]}).agencies,[{id:'legacy',prt:'old_prt'}]);

for(const [csv,pattern] of [
 ['Date,Media Source (pid),Clicks\n',/header-only/],
 ['{"status":"error"}',/not a valid/],
 ['Date,Media Source (pid),Clicks\n2026-10-28,other_int,900',/selected PIDs/],
 ['Date,Media Source (pid),Clicks\n2026-10-27,mine_int,20',/different report dates/],
 ['Date,Media Source (pid),Agency/PMD (af_prt),Clicks\n2026-10-28,mine_int,wrong_agency,20',/match agency/]
]){assert.throws(()=>aggregateAF(csv,{...map,agencyPrt:'agency_a'},['2026-10-28']),pattern)}
const actualZero=aggregateAF('Date,Media Source (pid),Agency/PMD (af_prt),Clicks\n2026-10-28,mine_int,agency_a,0',{...map,agencyPrt:'agency_a'},['2026-10-28']);assert.equal(actualZero['2026-10-28'],0);assert.equal(actualZero.diagnostics.matchedRows,1);
try{aggregateAF('Date,Media Source (pid),Clicks\n2026-10-28,returned_pid,30',map,['2026-10-28'])}catch(e){assert.equal(e.diagnostics.rowsReceived,1);assert.deepEqual(e.diagnostics.returnedPids,['returned_pid']);assert.equal(e.diagnostics.skipped.pid,1)}
console.log('PASS: no false zeros for empty, JSON, unmatched PID/agency/date reports; PMD header support; explicit zero retained; safe dimension diagnostics.');
const objects=new Map();const env={CREDENTIAL_OWNER_EMAIL:'owner@example.test',CREDENTIAL_ENCRYPTION_KEY:'11'.repeat(32),BUCKET:{get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null,put:async(k,v)=>objects.set(k,v)}};
const post=async(path,b,origin='https://test.site')=>{const r=await worker.fetch(new Request('https://test.site/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':'qa-owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify(b)}),env);return [r.status,await r.json()]};
const config={maps:[map],agencies,base:'https://api-test.affise.com'};
assert.equal((await post('settings',config))[0],200);
assert.equal((await post('settings',config,'https://evil.site'))[0],403);
assert.equal((await post('settings',{...config,agencies:[agencies[0],{id:'c',prt:'agency_a'}]}))[0],400);
assert.equal((await post('settings',{...config,maps:[{...map,agencyIds:['missing']}]}))[0],400);
assert.equal((await post('settings',{...config,maps:[map,{...map,id:'two'}]}))[0],400);
const originalNow=Date.now;let fakeNow=originalNow();Date.now=()=>fakeNow;const original=globalThis.fetch;let calls=[];let failB=false;
globalThis.fetch=async(url,options)=>{calls.push({url:String(url),token:options.headers.Authorization});if(String(url).includes('affise.com'))return new Response(JSON.stringify({status:1,stats:[{slice:{year:2026,month:10,day:28},traffic:{raw:'300'}}],pagination:{total_count:1}}));if(options.headers.Authorization==='Bearer token-b'&&failB)return new Response('denied',{status:403});const n=options.headers.Authorization==='Bearer token-a'?150:80;return new Response('Date,Media Source (pid),Clicks\n2026-10-28,mine_int,'+n+'\n2026-10-28,other_int,900')};
const request={from:'2026-10-28',to:'2026-10-28',affiseToken:'key',agencyTokens:{a:'token-a',b:'token-b'}};
let [status,result]=await post('sync',request);assert.equal(status,200);assert(result.logs.every(l=>l.ok));assert.equal(calls.length,3);let rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec[0].affise.value,300);assert.equal(rec[0].af.value,230);assert.deepEqual(rec[0].af.agencies.map(a=>a.value),[150,80]);
await post('sync',request);rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec.length,1);assert.equal(rec[0].af.value,230);
assert.equal((await post('sync',{...request,agencyTokens:{a:'same',b:'same'}}))[0],400);
fakeNow+=66000;failB=true;await post('sync',request);rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec[0].af.value,null);assert.equal(rec[0].af.agencies[1].value,80);assert.match(rec[0].af.error,/agency_b.*403/);
await post('sync',{...request,agencyTokens:{a:'token-a'}});rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec[0].af.value,null);assert.match(rec[0].af.error,/agency_b/);
await post('import',{from:request.from,to:request.to,mapping:map.id,agencyId:'b',csv:'Date,Media Source (pid),Clicks\n2026-10-28,mine_int,90',confirmTimezone:true});rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec[0].af.value,240);assert.equal(rec[0].af.agencies[1].via,'CSV');
assert(!JSON.stringify([...objects]).includes('token-a'));assert(!JSON.stringify([...objects]).includes('token-b'));
// Save the credentials, then simulate a refreshed client sending no token inputs.
assert.equal((await post('credentials',{affiseToken:'key',agencyTokens:{a:'token-a',b:'token-b'}}))[0],200);
const sealed=objects.get('credentials/v1');assert(!sealed.includes('token-a'));assert(!sealed.includes('token-b'));assert(!sealed.includes('key'));
const getState=async(headers={})=>{const r=await worker.fetch(new Request('https://test.site/api/state',{headers}),env);return r.json()};
const anon=await getState();assert.equal(anon.isOwner,false);assert.equal(anon.credentialStatus,null);
const state=await getState({'oai-authenticated-user-id':'qa-owner','oai-authenticated-user-email':'owner@example.test'});assert.equal(state.credentialStatus.affise,true);assert.equal(state.credentialStatus.agencies.a,true);assert(!JSON.stringify(state).includes('token-a'));
let denied=await worker.fetch(new Request('https://test.site/api/credentials',{method:'POST',headers:{origin:'https://test.site'},body:JSON.stringify({affiseToken:'evil'})}),env);assert.equal(denied.status,403);
denied=await worker.fetch(new Request('https://test.site/api/sync',{method:'POST',headers:{origin:'https://test.site','oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.test'},body:JSON.stringify(request)}),env);assert.equal(denied.status,403);
fakeNow+=66000;failB=false;calls=[];await post('sync',{from:request.from,to:request.to});assert.equal(calls.length,3);rec=JSON.parse(objects.get('reports/2026-10-28'));assert.equal(rec[0].af.value,230);
assert.equal((await post('credentials',{agencyTokens:{b:'token-a'}}))[0],400);
await post('credentials',{agencyTokens:{b:'replacement-b'}});assert.notEqual(objects.get('credentials/v1'),sealed);assert(!objects.get('credentials/v1').includes('replacement-b'));
await post('credentials',{remove:['b']});const afterDelete=await getState({'oai-authenticated-user-id':'qa-owner','oai-authenticated-user-email':'owner@example.test'});assert.equal(afterDelete.credentialStatus.agencies.b,false);assert.equal(afterDelete.credentialStatus.agencies.a,true);
assert.equal((await post('credentials',{}))[0],200); // Blank input preserves saved values.
// A changed account identity must not reuse a token saved for the previous PRT.
assert.equal((await post('settings',{...config,maps:[],agencies:[agencies[0],{id:'b',prt:'different_agency'}]}))[0],200);
const changed=await getState({'oai-authenticated-user-id':'qa-owner','oai-authenticated-user-email':'owner@example.test'});assert.equal(changed.credentialStatus.agencies.b,false);
globalThis.fetch=original;Date.now=originalNow;
console.log('PASS: encrypted credential persistence, masked statuses, owner-only writes/fetch, refresh without token inputs, replace/delete, blank preservation, and duplicate-token prevention.');

console.log('PASS: agency migration and validation; owned PID/PRT filters; two independent API tokens; combined and per-agency totals; one Affise fetch; repeated fetch replacement; duplicate-token rejection; missing/failed agency handling; CSV repair; no persisted tokens.');
