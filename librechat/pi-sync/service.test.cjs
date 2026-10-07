const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncService, guardTurn, NO_PARENT } = require('./service.cjs');

function fixture() {
  const links = new Map(), conversations = new Map(), messages = new Map(), projects = new Map();
  let busy = false, fail = false;
  const store = {
    getLink: async (user, session) => links.get(`${user}:${session}`),
    saveLink: async link => links.set(`${link.user}:${link.sessionId}`, structuredClone(link)),
    getConversation: async (user, id) => conversations.get(`${user}:${id}`),
    getMessage: async (user, id) => messages.get(`${user}:${id}`),
    ensureProject: async (user, key, name) => { projects.set(`${user}:${key}`, name); return key.slice(0, 24); },
    isGenerating: async () => busy,
    saveConversation: async (user, value) => conversations.set(`${user}:${value.conversationId}`, { ...conversations.get(`${user}:${value.conversationId}`), ...value }),
    saveMessage: async (user, value) => { if (fail) { fail = false; throw new Error('interrupted'); } messages.set(`${user}:${value.messageId}`, value); },
  };
  return { links, conversations, messages, projects, store, sync: createSyncService(store, 'owner'), busy: value => busy = value, fail: () => fail = true };
}
const snapshot = () => ({ sessionId: 'session-one', cwd: '/projects/homelab', title: 'Fix deployment', leafId: 'entry-two', messages: [
  { entryId: 'entry-one', role: 'user', text: 'Hello 🌍', timestamp: '2026-10-01T00:00:00Z' },
  { entryId: 'entry-two', role: 'assistant', text: 'Hi!', timestamp: '2026-10-01T00:00:01Z' },
] });

test('creates a project and bound chat, preserving IDs across concurrent retries and restart', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.sync(snapshot()), f.sync(snapshot())]);
  assert.deepEqual(a, b);
  assert.equal(f.projects.size, 1); assert.equal(f.conversations.size, 1); assert.equal(f.messages.size, 2);
  assert.deepEqual(await createSyncService(f.store, 'owner')(snapshot()), a);
  assert.equal([...f.conversations.values()][0].model, 'pi/session-session-one');
  assert.equal([...f.conversations.values()][0].endpoint, 'Local Pi');
  assert.equal([...f.messages.values()][0].parentMessageId, NO_PARENT);
  assert.equal([...f.messages.values()][1].parentMessageId, [...f.messages.values()][0].messageId);
});

test('remote IDs reconcile streamed replies instead of duplicating them', async () => {
  const f = fixture(), s = snapshot();
  const linked = await f.sync(s);
  const remote = { conversationId: linked.conversationId, userMessageId: 'remote-user', responseMessageId: 'remote-answer' };
  const parent = [...f.messages.values()][1].messageId;
  await f.store.saveMessage('owner', { conversationId: linked.conversationId, messageId: 'remote-user', parentMessageId: parent, isCreatedByUser: true, text: 'Question' });
  await f.store.saveMessage('owner', { conversationId: linked.conversationId, messageId: 'remote-answer', parentMessageId: 'remote-user', isCreatedByUser: false, text: 'Answer' });
  s.messages.push({ entryId: 'third', role: 'user', text: 'Question', timestamp: s.messages[0].timestamp, remote }, { entryId: 'fourth', role: 'assistant', text: 'Answer', timestamp: s.messages[1].timestamp, remote });
  s.leafId = 'fourth';
  await f.sync(s); await f.sync(s);
  assert.equal(f.messages.size, 4);
  assert.equal(f.links.get('owner:session-one').lastMessageId, 'remote-answer');
});

test('branch changes and unfinished replies fail closed without rewriting history', async () => {
  const f = fixture(); await f.sync(snapshot());
  const changed = snapshot(); changed.messages[0].text = 'Other branch';
  await assert.rejects(f.sync(changed), { status: 409 });
  f.busy(true); await assert.rejects(f.sync(snapshot()), { status: 409 });
  assert.equal(f.messages.size, 2);
});

test('deleted chats are not silently recreated', async () => {
  const f = fixture(); await f.sync(snapshot()); f.conversations.clear();
  await assert.rejects(f.sync(snapshot()), { status: 409 });
  assert.equal(f.conversations.size, 0); assert.equal(f.links.get('owner:session-one').disabled, true);
});

test('partial writes recover idempotently and owners never share conversations', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.sync(snapshot()), /interrupted/);
  await f.sync(snapshot()); assert.equal(f.messages.size, 2);
  await createSyncService(f.store, 'other-owner')(snapshot());
  assert.equal(f.conversations.size, 2); assert.equal(f.messages.size, 4);
});

test('binding rejects model changes, stale parents, edits, tools and attachments', async () => {
  const f = fixture(); await f.sync(snapshot());
  const link = f.links.get('owner:session-one');
  const body = { endpoint: 'Local Pi', model: link.model, parentMessageId: link.lastMessageId };
  guardTurn(link, body); assert.equal(body.piExpectedLeaf, 'entry-two');
  for (const update of [{ model: 'other' }, { parentMessageId: NO_PARENT }, { isRegenerate: true }, { files: [{}] }, { tools: [{}] }]) assert.throws(() => guardTurn(link, { ...body, ...update }), /bound|history|text/);
});

test('invalid snapshots are rejected before persistence', async () => {
  const f = fixture();
  for (const update of [{ sessionId: '../escape' }, { cwd: {} }, { messages: [{}] }, { messages: [snapshot().messages[0], snapshot().messages[0]] }]) await assert.rejects(f.sync({ ...snapshot(), ...update }), { status: 400 });
  assert.equal(f.conversations.size, 0);
});
