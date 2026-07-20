# ============================================================================
# NCMedia Management Platform — Frontend Dockerfile (Next.js 15 standalone)
# Base: Node 22 LTS (Alpine) · non-root · HEALTHCHECK · image nhỏ
# NEXT_PUBLIC_* được nhúng lúc BUILD → truyền qua build ARG.
# ============================================================================

# ---- Stage 1: deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- Stage 2: build (Next standalone) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* inline lúc build. Mặc định gọi API same-origin qua Nginx (/api/v1).
ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ARG NEXT_PUBLIC_APP_NAME="NCMedia Management Platform"
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_TELEMETRY_DISABLED=1

# Đảm bảo có thư mục public (Next standalone copy /public). Repo chưa có → tạo rỗng (chỉ trong image).
RUN mkdir -p public && npm run build

# ---- Stage 3: runtime (chỉ standalone server) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# .next/standalone đã tự chứa server.js + node_modules tối thiểu.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# Liveness: server Next phản hồi HTTP (< 500 = sống). Redirect (3xx) vẫn coi là healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
