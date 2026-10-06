FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
ENV NODE_ENV=production PI_CONNECTOR_MODE=codex PI_CONNECTOR_HOST=0.0.0.0 PI_CONNECTOR_PORT=8788 PI_CONNECTOR_STATE=/data PI_CONNECTOR_KEY_FILE=/run/secrets/client.key
USER node
EXPOSE 8788
CMD ["npm", "start"]
