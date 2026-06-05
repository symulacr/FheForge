FROM node:22-slim AS builder
WORKDIR /app
COPY backend/apps/package.json ./
RUN npm install --legacy-peer-deps 2>&1 | tee /npm-install.log || true
COPY backend/apps/tsconfig.json backend/apps/tsconfig.build.json backend/apps/nest-cli.json ./
COPY backend/apps/src/ ./src/
RUN npm run build 2>&1 | tee /build.log || true

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV PORT=3000
EXPOSE 3000
CMD node dist/main.js
# cache-bust 2026-06-05-railway-root-build
