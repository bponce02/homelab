const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[2] || '/app';
function patch(path, before, after) {
  const file = join(root, path);
  const source = readFileSync(file, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`Unsupported LibreChat source: ${path}`);
  writeFileSync(file, source.replace(before, after));
}
patch('api/server/index.js', "  app.use('/api/projects', routes.projects);", "  app.use('/api/pi-sync', require('./pi-sync/index.cjs').router);\n  app.use('/api/projects', routes.projects);");
patch('api/server/index.js', "  app.use('/api/messages', routes.messages);", "  app.use('/api/messages', require('./middleware/requireJwtAuth'), require('./pi-sync/index.cjs').protectHistory, routes.messages);");
patch('api/server/routes/agents/chat.js', 'router.use(restoreResumeContext);', "router.use(require('../../pi-sync/index.cjs').guard);\nrouter.use(restoreResumeContext);");
patch('api/server/controllers/agents/request.js', '    const result = await initializeClient({', `    if (req.body.endpoint === 'Local Pi') {
      req.body.piTurn = Buffer.from(JSON.stringify({
        conversationId: effectiveConversationId,
        userMessageId: preallocatedUserMessageId,
        responseMessageId: preallocatedResponseMessageId,
        ...(req.body.piExpectedLeaf !== undefined && { expectedLeaf: req.body.piExpectedLeaf }),
      })).toString('base64url');
      req.config = {
        ...req.config,
        endpoints: {
          ...req.config.endpoints,
          custom: req.config.endpoints.custom.map(endpoint => endpoint.name === 'Local Pi'
            ? { ...endpoint, headers: { ...endpoint.headers, 'X-Pi-Turn': req.body.piTurn } }
            : endpoint),
        },
      };
    }
    const result = await initializeClient({`);
