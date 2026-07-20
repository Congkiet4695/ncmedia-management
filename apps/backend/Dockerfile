# ============================================================================
# NCMedia Management Platform — Backend Dockerfile (multi-stage, production)
# Base: Node 22 LTS (Alpine) · non-root · HEALTHCHECK /api/v1/health
# KHÔNG chạy `prisma migrate` trong image — migrate deploy chạy ở deploy/deploy.sh.
# ============================================================================

# ---- Stage 1: deps (full install để build) ----
FROM node:22-alpine AS deps
WORKDIR /app
# openssl: Prisma engine; python3/make/g++: build native module (bcrypt) trên musl/alpine.
# Các build tools này chỉ ở stage deps — KHÔNG có trong image runtime cuối.
RUN apk add --no-cache openssl python3 make g++
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# ---- Stage 2: build (generate client + nest build + prune dev) ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev

# ---- Stage 3: runtime (chỉ file cần thiết, non-root) ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    PORT=3000

# Copy artefact cần thiết: node_modules (đã prune) + dist + prisma + package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# Prisma CLI (khớp version @prisma/client) để chạy `prisma migrate deploy` (deploy.sh),
# offline — không fetch npm lúc deploy. build-deps chỉ tồn tại trong layer này rồi gỡ đi.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && PRISMA_VERSION="$(node -p "require('@prisma/client/package.json').version")" \
 && npm install --no-save --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && npm cache clean --force \
 && apk del .build-deps \
 && mkdir -p /app/uploads /app/logs \
 && chown -R node:node /app

# Thư mục upload (bind mount /opt/ncmedia/uploads ở compose). Không lưu file trong container.
VOLUME ["/app/uploads"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
