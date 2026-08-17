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
# SDK TikTok là dependency `file:vendor/tiktok-shop-sdk` ⇒ phải có mặt TRƯỚC `npm ci`,
# nếu không npm không resolve được đường dẫn cục bộ.
COPY vendor ./vendor
RUN npm ci

# ---- Stage 2: build (generate client + nest build) ----
# GIỮ nguyên devDependencies (ts-node, typescript, prisma) — stage này cũng là image "tools"
# cho `prisma db seed` (compose seed service dùng target: build). KHÔNG prune ở đây, nếu không
# `ts-node` bị xoá → `prisma db seed` lỗi `spawn ts-node ENOENT`. Prune chuyển sang stage runtime.
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npm run build

# ---- Stage 3: runtime (chỉ file cần thiết, non-root) ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    PORT=3000

# Copy artefact + prune dev NGAY TẠI runtime (image chạy app vẫn nhỏ; ts-node chỉ còn ở stage build/tools).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
# `node_modules/@tiktok-shop/nodejs-sdk` là SYMLINK trỏ vào `vendor/tiktok-shop-sdk`.
# Không copy thì symlink treo và app không khởi động được. Chỉ lấy `dist` + `package.json`
# (mã nguồn .ts của SDK không cần cho runtime).
COPY --from=build /app/vendor/tiktok-shop-sdk/package.json ./vendor/tiktok-shop-sdk/package.json
COPY --from=build /app/vendor/tiktok-shop-sdk/dist ./vendor/tiktok-shop-sdk/dist

# Prisma CLI (khớp version @prisma/client) để chạy `prisma migrate deploy` (deploy.sh),
# offline — không fetch npm lúc deploy. build-deps chỉ tồn tại trong layer này rồi gỡ đi.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm prune --omit=dev \
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
