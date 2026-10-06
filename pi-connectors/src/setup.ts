import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const codex = process.argv[2] === 'codex';
if (process.argv[2] && !codex) throw new Error('Usage: npm run setup [-- codex]');
const state = codex ? fileURLToPath(new URL('../../config/volumes/pi-connectors/codex/', import.meta.url)) : resolve(process.env.PI_CONNECTOR_STATE ?? './state');
const key = codex ? fileURLToPath(new URL('../../config/env/pi-connectors/codex.key', import.meta.url)) : resolve(process.env.PI_CONNECTOR_KEY_FILE ?? join(state, 'client.key'));
for (const directory of [state, dirname(key)]) { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
try { await writeFile(key, randomBytes(48).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' }); }
catch (error: any) { if (error.code !== 'EEXIST') throw error; }
console.log(`State: ${state}\nClient key: ${key}\nExisting keys and OAuth credentials are never overwritten.`);
