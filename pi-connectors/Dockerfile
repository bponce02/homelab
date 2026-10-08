FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY --chmod=0644 package.json package-lock.json CODEX-SEARCH-LICENSE ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
ENV NODE_ENV=production NPM_CONFIG_CACHE=/tmp/npm PI_CONNECTOR_MODE=codex PI_CONNECTOR_HOST=0.0.0.0 PI_CONNECTOR_PORT=8788 PI_CONNECTOR_STATE=/data PI_CONNECTOR_KEY_FILE=/run/secrets/client.key
USER node
EXPOSE 8788
CMD ["node", "--import", "tsx", "src/main.ts"]
