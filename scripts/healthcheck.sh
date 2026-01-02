#!/bin/sh

# Health check script for Docker
curl -sf http://localhost:${PORT:-3000}/health || exit 1
