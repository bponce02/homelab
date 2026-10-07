const { timingSafeEqual } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const db = require('~/models');
const { GenerationJobManager } = require('@librechat/api');
const { createSyncService, guardTurn, SyncError } = require('./service.cjs');

const owner = process.env.PI_SYNC_OWNER_ID;
const key = process.env.PI_SYNC_KEY;
const enabled = /^[a-f0-9]{24}$/.test(owner ?? '') && key?.length >= 32;
const schema = new mongoose.Schema({ user: String, sessionId: String, conversationId: String, model: String, projectId: String, entries: [String], lastMessageId: String, leafId: String, disabled: Boolean });
schema.index({ user: 1, sessionId: 1 }, { unique: true });
schema.index({ user: 1, conversationId: 1 }, { unique: true });
const Link = mongoose.models.PiSyncLink ?? mongoose.model('PiSyncLink', schema);
const store = {
  getLink: (user, sessionId) => Link.findOne({ user, sessionId }).lean(),
  saveLink: ({ _id, __v, ...link }) => Link.updateOne({ user: link.user, sessionId: link.sessionId }, { $set: link }, { upsert: true }),
  getConversation: (user, conversationId) => db.getConvo(user, conversationId),
  getMessage: (user, messageId) => db.getMessage({ user, messageId }),
  async isGenerating(conversationId) {
    const job = await GenerationJobManager.getJob(conversationId);
    return job != null && !['complete', 'error', 'aborted'].includes(job.status);
  },
  async ensureProject(user, projectKey, name) {
    const description = `Pi session sync: ${projectKey}`;
    let cursor;
    do {
      const page = await db.listChatProjects(user, { limit: 100, cursor });
      const existing = page.projects.find(project => project.description === description);
      if (existing) return String(existing._id);
      cursor = page.nextCursor;
    } while (cursor);
    return String((await db.createChatProject(user, { name, description }))._id);
  },
  async saveConversation(user, value) {
    const saved = await db.saveConvo({ userId: user, isTemporary: false }, value);
    if (!saved) throw new Error('Could not save Pi conversation');
    return saved;
  },
  async saveMessage(user, value) {
    const saved = await db.saveMessage({ userId: user, isTemporary: false }, { ...value, user });
    if (!saved) throw new Error('Could not save Pi message');
    return saved;
  },
};
const sync = createSyncService(store, owner);
const router = express.Router();
router.post('/', async (req, res) => {
  if (!enabled || process.env.TENANT_ISOLATION_STRICT === 'true') return res.status(503).json({ error: 'Pi sync is not configured for this deployment' });
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (req.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Invalid sync credentials' });
  try { return res.json(await sync(req.body)); }
  catch (error) { return res.status(error instanceof SyncError ? error.status : 500).json({ error: error instanceof SyncError ? error.message : 'Pi history sync failed' }); }
});
async function guard(req, res, next) {
  try {
    if (req.method !== 'POST' || !req.body?.conversationId || !req.user?.id) return next();
    const link = await Link.findOne({ user: req.user.id, conversationId: req.body.conversationId }).lean();
    if (!link) return next();
    guardTurn(link, req.body);
    next();
  } catch (error) { res.status(error instanceof SyncError ? error.status : 500).json({ error: error instanceof SyncError ? error.message : 'Pi session binding check failed' }); }
}
async function protectHistory(req, res, next) {
  try {
    if (req.method === 'GET' || req.path.endsWith('/feedback')) return next();
    let conversationId;
    const segments = req.path.split('/').filter(Boolean);
    if (!['branch', 'artifact'].includes(segments[0])) conversationId = segments[0];
    else {
      const messageId = req.body?.messageId ?? segments[1];
      if (typeof messageId === 'string') conversationId = (await db.getMessage({ user: req.user.id, messageId }))?.conversationId;
    }
    if (typeof conversationId === 'string' && await Link.exists({ user: req.user.id, conversationId })) return res.status(409).json({ error: 'Synced Pi history is read-only; edit or branch in Pi' });
    next();
  } catch { res.status(500).json({ error: 'Pi history ownership check failed' }); }
}
module.exports = { router, guard, protectHistory };
