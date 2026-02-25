# Stage 1: Install dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build the Next.js app
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure public dir exists even if the project doesn't have one
RUN mkdir -p /app/public
RUN npm run build

# Stage 3: Production runner
# node:20-slim is Debian-based — required for Playwright Chromium support
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy node_modules first so npx playwright can find the package
COPY --from=builder /app/node_modules ./node_modules

# Install Playwright Chromium browser + all required OS-level dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "start"]
