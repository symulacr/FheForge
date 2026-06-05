FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps 2>&1 | tee /npm-install.log || true
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build 2>&1 | tee /build.log || true

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV PORT=3000
EXPOSE 3000
CMD node dist/main.js
# cache-bust 1780634073
