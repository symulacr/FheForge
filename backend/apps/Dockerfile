# FheForge Backend — Dockerfile
FROM node:22-slim
WORKDIR /app

# Copy source
COPY . .

# Install deps and build
RUN npm install && npm run build

# Expose port
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/main"]
