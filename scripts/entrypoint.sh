#!/bin/sh
set -e

echo "=============================================="
echo "  HLS Multi-Audio Player API"
echo "=============================================="
echo ""

# Check FFmpeg
echo "Checking FFmpeg installation..."
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n1)
    echo "✓ FFmpeg: $FFMPEG_VERSION"
else
    echo "✗ FFmpeg not found!"
    exit 1
fi

# Check FFprobe
if command -v ffprobe &> /dev/null; then
    echo "✓ FFprobe: Available"
else
    echo "✗ FFprobe not found!"
    exit 1
fi

# Check directories
echo ""
echo "Checking directories..."
if [ -d "/app/output" ]; then
    echo "✓ Output directory: /app/output"
else
    mkdir -p /app/output
    echo "✓ Created output directory: /app/output"
fi

if [ -d "/app/input" ]; then
    echo "✓ Input directory: /app/input"
fi

# Check Node.js
echo ""
echo "Node.js version: $(node -v)"
echo "NPM version: $(npm -v)"

echo ""
echo "Starting application..."
echo "=============================================="
echo ""

# Execute the main command
exec "$@"
