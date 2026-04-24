FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package*.json ./

# Install tsx globally or locally to run the TS server
RUN npm install -g tsx

# Set default environment variables
ENV PORT=5173
ENV JWT_SECRET=change_me_in_production
ENV CONFIG_PATH=/app/server/config/config.json
ENV USERS_PATH=/app/server/config/users.json

EXPOSE 5173

CMD ["tsx", "server/index.ts"]
