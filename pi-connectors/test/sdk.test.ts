import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fauxProvider, fauxAssistantMessage, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentSession, discoverAndLoadExtensions, ModelRuntime, SessionManager, SettingsManager, type ResourceLoader } from '@earendil-works/pi-coding-agent';
import { localRequest, lines } from '../src/session-protocol.ts';

test('extension loads through Pi jiti and completes a real isolated SDK session with a fake provider', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sdk-test-'));
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'test-pane', HERDR_SOCKET_PATH: '/unused-test-socket', PI_SESSION_BRIDGE_DIR: join(root, 'run') };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  });
  const loaded = await discoverAndLoadExtensions([resolve('extension/index.ts')], root, join(root, 'agent'));
  assert.deepEqual(loaded.errors, []);
  const loader: ResourceLoader = {
    getExtensions: () => loaded,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => 'A test assistant with no tools.',
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, 'models-cache.json'), refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage('SDK reply')]);
  runtime.registerNativeProvider(faux.provider);
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, 'agent'), modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader, tools: [], noTools: 'all', sessionManager: manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
  t.after(async () => { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); });
  await session.bindExtensions({});
  const id = manager.getSessionId();
  const meta = JSON.parse(await readFile(join(root, 'run', `${id}.json`), 'utf8'));
  const reply = await localRequest(join(root, 'run', `${id}.sock`), '/prompt', { id: 'a'.repeat(64), sessionId: id, nonce: meta.nonce, prompt: 'Test only' }, AbortSignal.timeout(5000));
  assert.equal(reply.statusCode, 200);
  const events = []; for await (const event of lines(reply)) events.push(event);
  assert.deepEqual(events.at(-1), { type: 'done', text: 'SDK reply' });
  assert.equal(session.getLastAssistantText(), 'SDK reply');
  assert.equal(faux.state.callCount, 1);
});
