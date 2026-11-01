import { randomInt } from 'node:crypto';
import { checksum } from '../src/license/license.ts';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const body = 'LL1-' + Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')).join('-');
console.log(`${body}-${checksum(body)}`);
