import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { codexModels } from './codex.ts';

const directory = resolve(process.env.PI_CONNECTOR_STATE ?? './state');
const models = codexModels(directory);
const terminal = createInterface({ input: stdin, output: stdout });
const signal = new AbortController();
process.once('SIGINT', () => signal.abort());
try {
  await models.login('openai-codex', 'oauth', {
    signal: signal.signal,
    prompt: async prompt => {
      if (prompt.type === 'select' || prompt.type === 'secret') throw new Error('Unexpected OAuth prompt type');
      return terminal.question(`${prompt.message}\n> `, { signal: prompt.signal ?? signal.signal });
    },
    notify: event => {
      if (event.type === 'auth_url') console.log(`Open this URL in your browser:\n${event.url}\n${event.instructions ?? ''}`);
      else if (event.type === 'device_code') console.log(`${event.verificationUri}\nCode: ${event.userCode}`);
      else console.log(event.message);
    },
  });
  console.log(`Codex OAuth saved privately in ${directory}. No credentials were copied from Pi or CLIProxyAPI.`);
} finally { terminal.close(); }
