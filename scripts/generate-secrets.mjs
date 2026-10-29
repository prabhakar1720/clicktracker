import {randomBytes} from 'node:crypto';
console.log('SESSION_SECRET='+randomBytes(32).toString('hex'));
console.log('ENCRYPTION_SECRET='+randomBytes(32).toString('hex'));
