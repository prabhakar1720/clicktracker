import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return i<0?[s,'']:[s.slice(0,i),s.slice(i+1)]}));
const site=new URL(args['--site']||'https://adsphire-click-reconcile.prabhakar172.chatgpt.site');
if(site.protocol!=='https:'||site.username||site.password||site.search||!site.hostname.endsWith('.chatgpt.site'))throw Error('Use the HTTPS origin of your original ChatGPT Site');
const from=args['--from'],to=args['--to'],output=resolve(args['--output']||'backups/sites-migration.json');
if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||Date.parse(from)>Date.parse(to))throw Error('Usage: node scripts/migrate-from-sites.mjs --from=2026-10-01 --to=2026-10-29');
async function read(path){const r=await fetch(new URL(path,site.origin),{signal:AbortSignal.timeout(30000)});if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error('The original Site did not return public JSON. Export settings manually or sign in to the original Site; this script does not bypass authentication.');return r.json()}
const state=await read('/api/state'),reports=[];
for(let current=Date.parse(from);current<=Date.parse(to);current+=31*86400000){const first=new Date(current).toISOString().slice(0,10),last=new Date(Math.min(Date.parse(to),current+30*86400000)).toISOString().slice(0,10);reports.push(...await read('/api/reports?from='+first+'&to='+last))}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({format:'adsphire-click-backup-v1',createdAt:new Date().toISOString(),settings:state.settings,reports},null,2),{mode:0o600});console.log('Saved settings and '+reports.length+' report rows to '+output+'. API credentials are excluded.');
