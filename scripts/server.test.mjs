import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDashboardServer,DiskStore} from '../server.js';

test('Render server: password access, header isolation, encrypted save, restart persistence, backup and restore',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'adsphire-render-'));
 const options={NODE_ENV:'development',PUBLIC_URL:'',RENDER_EXTERNAL_URL:'',DATA_DIR:directory,DASHBOARD_PASSWORD:'test-password-very-long',SESSION_SECRET:'session-test-secret-'.repeat(3),ENCRYPTION_SECRET:'encryption-test-secret-'.repeat(3)};
 let current;const start=async()=>{current=createDashboardServer(options);await new Promise(resolve=>current.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+current.server.address().port};const stop=()=>new Promise(resolve=>{current.server.closeAllConnections();current.server.close(resolve)});
 try{
  let origin=await start();let response=await fetch(origin+'/healthz');assert.equal(response.status,200);
  response=await fetch(origin+'/api/state',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'render-owner@local.invalid'}});assert.equal(response.status,401);
  response=await fetch(origin+'/',{redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/login');
  response=await fetch(origin+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:'incorrect'}),redirect:'manual'});assert.equal(response.status,401);
  response=await fetch(origin+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:options.DASHBOARD_PASSWORD}),redirect:'manual'});assert.equal(response.status,303);const setCookie=response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);const cookie=setCookie.split(';')[0];
  const post=async(path,body)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual'});
  const settings={base:'https://api-test.affise.com',agencies:[{id:'a',prt:'test_agency'}],maps:[{id:'m',name:'Test',advertiser:'adv',app:'test.app',pids:['mine_int'],offers:[],mode:'ua',timezone:'UTC',agencyIds:['a']}]};
  response=await post('/api/settings',settings);assert.equal(response.status,200);
  response=await post('/api/credentials',{affiseToken:'private-affise-token',agencyTokens:{a:'private-af-token'}});assert.equal(response.status,200);
  const saved=await readFile(join(directory,'credentials/v1.json'),'utf8');assert(!saved.includes('private-affise-token'));assert(!saved.includes('private-af-token'));
  response=await fetch(origin+'/api/settings',{method:'POST',headers:{origin:'https://evil.example',cookie,'content-type':'application/json'},body:JSON.stringify(settings)});assert.equal(response.status,403);
  await stop();origin=await start();response=await fetch(origin+'/api/state',{headers:{cookie}});const state=await response.json();assert.equal(state.isOwner,true);assert.equal(state.credentialStatus.affise,true);assert.equal(state.credentialStatus.agencies.a,true);assert.equal(state.settings.maps[0].name,'Test');assert(!JSON.stringify(state).includes('private-af-token'));
  response=await fetch(origin+'/api/backup',{headers:{cookie}});const backup=await response.json();assert.equal(backup.settings.maps[0].name,'Test');assert.deepEqual(backup.reports,[]);assert(!JSON.stringify(backup).includes('private-affise-token'));
  response=await post('/api/restore-backup',backup);assert.equal(response.status,200);
  assert.throws(()=>new DiskStore(directory).file('../escape'),/Invalid storage/);
  response=await post('/logout',{});assert.equal(response.status,303);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
 }finally{if(current?.server.listening)await stop();await rm(directory,{recursive:true,force:true})}
});
