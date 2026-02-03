# ═══════════════════════════════════════════════════════════════════
# GPS Mock Location Backend - Docker Image
# Multi-stage build for optimized production image
# ═══════════════════════════════════════════════════════════════════

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for prisma)
RUN npm ci

# ═══════════════════════════════════════════════════════════════════
# Stage 2: Builder (generate Prisma client)
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code and prisma schema
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Remove dev dependencies for smaller image
RUN npm prune --production

# ═══════════════════════════════════════════════════════════════════
# Stage 3: Runner (production image)
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine AS runner
WORKDIR /app

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl libc6-compat

# Set production environment
ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 gpsapp && \
    chown -R gpsapp:nodejs /app

USER gpsapp

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start command (migrations run in docker-compose)
CMD ["node", "src/server.js"]
