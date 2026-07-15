# ============================================================================
# NCMedia Management Platform — Backend Dockerfile (multi-stage, production)
# Base: Node 22 LTS (Alpine)
# ============================================================================

# ---- Stage 1: dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
# openssl: Prisma engine; python3/make/g++: build native module (bcrypt) trên musl/alpine.
# Các build tools này chỉ nằm ở stage deps, KHÔNG có trong image runtime cuối.
RUN apk add --no-cache openssl python3 make g++
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# ---- Stage 2: build ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
# Cắt bỏ devDependencies để giảm image
RUN npm prune --omit=dev

# ---- Stage 3: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# chạy dưới user không phải root
USER node
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/main.js"]
