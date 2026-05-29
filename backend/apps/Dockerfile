# FheForge Backend — Dockerfile
FROM node:22-slim
WORKDIR /app

# Copy everything
COPY . .

# Install bun
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Install deps and build
RUN bun install && bun run build

# Verify dist/ exists
RUN ls -la dist/ || echo "dist/ NOT FOUND"

# Start
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/main"]
