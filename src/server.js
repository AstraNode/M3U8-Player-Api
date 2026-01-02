const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// Routes
const convertRoutes = require('./routes/convert');
const playerRoutes = require('./routes/player');
const streamRoutes = require('./routes/stream');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Body parsing
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// HLS output files
app.use('/hls', express.static(path.join(__dirname, '../output'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.m4s') || filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes
app.use('/api/convert', convertRoutes);
app.use('/api/player', playerRoutes);
app.use('/api/stream', streamRoutes);

// Serve index.html for SPA
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           HLS Multi-Audio Stream Player                   ║
╠═══════════════════════════════════════════════════════════╣
║  🌐 Web UI:    http://localhost:${PORT}                      ║
║  📡 API:       http://localhost:${PORT}/api                  ║
║  🎬 HLS:       http://localhost:${PORT}/hls                  ║
║  💚 Health:    http://localhost:${PORT}/health               ║
╠═══════════════════════════════════════════════════════════╣
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(40)}║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
