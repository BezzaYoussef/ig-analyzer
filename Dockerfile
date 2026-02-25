# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build the Next.js app
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure public dir exists even if the project doesn't have one
RUN mkdir -p /app/public
RUN npm run build

# Stage 3: Production runner (lean final image)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# GEMINI_API_KEY is injected at runtime by Render (no need to bake into image)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "start"]
