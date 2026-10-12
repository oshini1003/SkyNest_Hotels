FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY backend/server.js ./
COPY backend/config ./config
COPY backend/controllers ./controllers
COPY backend/middleware ./middleware
COPY backend/routes ./routes
COPY backend/utils ./utils
COPY backend/Database ./Database
COPY backend/docker ./docker

USER node
EXPOSE 5000
CMD ["node", "server.js"]
