const { createHash } = require('node:crypto');
const { basename } = require('node:path');

const NO_PARENT = '00000000-0000-0000-0000-000000000000';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (value) => {
  const hex = digest(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
class SyncError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function validate(snapshot) {
  if (!snapshot || typeof snapshot.sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(snapshot.sessionId) || typeof snapshot.cwd !== 'string' || !snapshot.cwd.startsWith('/') || snapshot.cwd.length > 4096 || !Array.isArray(snapshot.messages) || snapshot.messages.length > 2000 || (snapshot.title !== undefined && typeof snapshot.title !== 'string') || (snapshot.leafId !== null && (typeof snapshot.leafId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(snapshot.leafId)))) throw new SyncError(400, 'Invalid Pi snapshot');
  const ids = new Set();
  for (const message of snapshot.messages) {
    if (!message || typeof message.entryId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(message.entryId) || ids.has(message.entryId) || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 256 * 1024 || !Number.isFinite(Date.parse(message.timestamp))) throw new SyncError(400, 'Invalid Pi message');
    if (message.remote && !['conversationId', 'userMessageId', 'responseMessageId'].every(k => typeof message.remote[k] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(message.remote[k]))) throw new SyncError(400, 'Invalid remote identity');
    ids.add(message.entryId);
  }
}
function createSyncService(store, owner) {
  let queue = Promise.resolve();
  async function apply(snapshot) {
    validate(snapshot);
    const sessionId = snapshot.sessionId;
    const conversationId = uuid(`${owner}:pi:${sessionId}`);
    const model = `pi/session-${sessionId}`;
    let link = await store.getLink(owner, sessionId);
    if (link?.disabled) throw new SyncError(409, 'Pi sync disabled for this conversation');
    if (await store.isGenerating(conversationId)) throw new SyncError(409, 'LibreChat is still saving a reply');
    const previous = link?.entries ?? [];
    const entries = snapshot.messages.map(m => digest(JSON.stringify([m.entryId, m.role, m.text, m.remote])));
    if (previous.some((entry, i) => entries[i] !== entry)) throw new SyncError(409, 'Pi branch changed; fork a new Pi session to sync this branch');
    if (link && !(await store.getConversation(owner, conversationId))) {
      await store.saveLink({ ...link, disabled: true });
      throw new SyncError(409, 'Linked chat was deleted; automatic recreation is disabled');
    }
    if (!link) {
      const projectKey = digest(snapshot.cwd);
      const projectId = await store.ensureProject(owner, projectKey, basename(snapshot.cwd) || 'Pi');
      const title = (snapshot.title || snapshot.messages.find(m => m.role === 'user')?.text || `Pi ${sessionId.slice(-8)}`).replace(/\s+/g, ' ').slice(0, 120);
      await store.saveConversation(owner, { conversationId, title, endpoint: 'Local Pi', endpointType: 'custom', model, chatProjectId: projectId });
      link = { user: owner, sessionId, conversationId, model, projectId, entries: [], lastMessageId: NO_PARENT, leafId: null };
      await store.saveLink(link);
    }
    let parentMessageId = NO_PARENT;
    for (let i = 0; i < snapshot.messages.length; i++) {
      const message = snapshot.messages[i];
      const remote = message.remote?.conversationId === conversationId ? message.remote : undefined;
      const messageId = remote ? (message.role === 'user' ? remote.userMessageId : remote.responseMessageId) : uuid(`${conversationId}:${message.entryId}`);
      if (i >= previous.length) {
        const existing = await store.getMessage(owner, messageId);
        if (existing && (existing.conversationId !== conversationId || existing.isCreatedByUser !== (message.role === 'user') || existing.parentMessageId !== parentMessageId)) throw new SyncError(409, 'Message identity conflict');
        if (!existing || !remote) {
          await store.saveMessage(owner, { messageId, conversationId, parentMessageId, text: message.text, content: [{ type: 'text', text: message.text }], isCreatedByUser: message.role === 'user', sender: message.role === 'user' ? 'User' : 'Local Pi', endpoint: 'Local Pi', model, error: false, unfinished: false, createdAt: new Date(message.timestamp) });
        } else if (existing.unfinished || existing.error) {
          throw new SyncError(409, 'Remote reply is incomplete; inspect it before syncing');
        }
      }
      parentMessageId = messageId;
    }
    await store.saveConversation(owner, { conversationId, endpoint: 'Local Pi', endpointType: 'custom', model });
    await store.saveLink({ ...link, entries, lastMessageId: parentMessageId, leafId: snapshot.leafId });
    return { conversationId, projectId: link.projectId, messages: entries.length };
  }
  return snapshot => {
    const operation = queue.then(() => apply(snapshot));
    queue = operation.catch(() => {});
    return operation;
  };
}
function guardTurn(link, body) {
  if (link.disabled) throw new SyncError(409, 'Pi sync is disabled for this chat');
  if (body.endpoint !== 'Local Pi' || body.model !== link.model) throw new SyncError(409, 'This chat is bound to its original Pi session');
  if (body.isRegenerate || body.isContinued || body.editedContent || body.responseMessageId || body.overrideConvoId || body.overrideUserMessageId || body.overrideParentMessageId || body.compact || body.agent_id || body.files?.length || body.tools?.length) throw new SyncError(400, 'Pi chats accept new text messages only; edit or branch in Pi');
  if (body.parentMessageId !== link.lastMessageId) throw new SyncError(409, 'Chat history changed; refresh before sending');
  body.piExpectedLeaf = link.leafId;
}
module.exports = { createSyncService, guardTurn, SyncError, uuid, NO_PARENT };
