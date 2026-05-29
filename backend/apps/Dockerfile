# FheForge Backend — Dockerfile
# Multi-stage build that preserves dist/ output

# ---- Build Stage ----
FROM node:22-slim AS builder
WORKDIR /app

# Install bun
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Install dependencies
COPY package.json ./
RUN bun install

# Copy source
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

# Build
RUN bun run build

# ---- Production Stage ----
FROM node:22-slim AS runner
WORKDIR /app

# Install bun for production dependencies
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Railway provides PORT env
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "dist/main"]
