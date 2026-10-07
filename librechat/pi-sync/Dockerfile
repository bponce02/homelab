FROM registry.librechat.ai/librechat-ai/librechat:v0.8.8
USER root
COPY --chown=node:node . /app/api/server/pi-sync/
RUN node /app/api/server/pi-sync/patch.cjs /app
USER node
