# Build stage: full dev deps for tsc + vite
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
 && npm prune --omit=dev

# Runtime stage: production deps only (tsx is a runtime dependency in package.json)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Default environment variables — override JWT_SECRET at run time
ENV PORT=5173
ENV CONFIG_DIR=/app/server/config

EXPOSE 5173

CMD ["./node_modules/.bin/tsx", "server/index.ts"]
