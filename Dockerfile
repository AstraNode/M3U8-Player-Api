# =============================================================================
# HLS Multi-Audio Player API - Production Dockerfile for Render
# =============================================================================

FROM node:20-bookworm-slim

LABEL maintainer="your-email@example.com"
LABEL description="HLS Multi-Audio Video Player API with FFmpeg"
LABEL version="1.0.0"

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV NPM_CONFIG_LOGLEVEL=warn

# Install FFmpeg and required dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Verify FFmpeg installation
RUN echo "FFmpeg version:" && ffmpeg -version | head -n 1
RUN echo "FFprobe version:" && ffprobe -version | head -n 1

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install dependencies
# Use npm install as fallback if package-lock.json doesn't exist
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --omit=dev; \
    fi && \
    npm cache clean --force

# Copy application source code
COPY src ./src
COPY public ./public

# Create necessary directories
RUN mkdir -p /app/output /app/input /app/logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the application
CMD ["node", "src/server.js"]
