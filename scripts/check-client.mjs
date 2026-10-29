import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const html=await readFile(new URL('../src/dashboard.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];if(!scripts.length)throw Error('No dashboard client script found');for(const [,code] of scripts)new Script(code);console.log('Dashboard client JavaScript parses successfully');
