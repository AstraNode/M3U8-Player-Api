# =============================================================================
# HLS Multi-Audio Player API - Production Dockerfile for Render
# =============================================================================

# Use Node.js 20 on Debian (better FFmpeg support than Alpine)
FROM node:20-bookworm-slim

# Labels
LABEL maintainer="your-email@example.com"
LABEL description="HLS Multi-Audio Video Player API with FFmpeg"
LABEL version="1.0.0"

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Install FFmpeg and all required dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Verify FFmpeg installation
RUN ffmpeg -version && ffprobe -version

# Create app user for security (don't run as root)
RUN groupadd -r hlsapp && useradd -r -g hlsapp hlsapp

# Set working directory
WORKDIR /app

# Copy package files first (for better Docker layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts \
    && npm cache clean --force

# Copy application source code
COPY src ./src
COPY public ./public

# Create output directory with proper permissions
RUN mkdir -p /app/output /app/input /app/logs \
    && chown -R hlsapp:hlsapp /app

# Switch to non-root user
USER hlsapp

# Expose port (Render will use PORT env variable)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the application
CMD ["node", "src/server.js"]
