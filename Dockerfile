# =============================================================================
# HLS Multi-Audio Player API - Production Dockerfile
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --only=production && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Production Stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Labels
LABEL maintainer="your-email@example.com"
LABEL description="HLS Multi-Audio Video Player API with FFmpeg"
LABEL version="1.0.0"

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Install FFmpeg and runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    tini \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S hlsgroup && \
    adduser -u 1001 -S hlsuser -G hlsgroup

# Set working directory
WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY --chown=hlsuser:hlsgroup package*.json ./
COPY --chown=hlsuser:hlsgroup src ./src
COPY --chown=hlsuser:hlsgroup public ./public
COPY --chown=hlsuser:hlsgroup scripts ./scripts

# Create output directory with proper permissions
RUN mkdir -p /app/output && \
    chown -R hlsuser:hlsgroup /app/output

# Make scripts executable
RUN chmod +x /app/scripts/*.sh

# Create volume mount points
VOLUME ["/app/output", "/app/input"]

# Switch to non-root user
USER hlsuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/app/scripts/healthcheck.sh"]

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "src/server.js"]
