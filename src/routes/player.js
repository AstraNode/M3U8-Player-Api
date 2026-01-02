const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * GET /api/player/config
 * Get player configuration
 */
router.get('/config', (req, res) => {
  res.json({
    version: '1.0.0',
    hlsVersion: '1.4.12',
    defaultConfig: {
      autoStartLoad: true,
      startLevel: -1,
      capLevelToPlayerSize: true,
      debug: false,
      enableWorker: true,
      lowLatencyMode: false,
      progressive: true,
      testBandwidth: true
    }
  });
});

/**
 * GET /api/player/embed/:jobId
 * Get embeddable player HTML
 */
router.get('/embed/:jobId', (req, res) => {
  const { jobId } = req.params;
  const { width = 854, height = 480 } = req.query;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/player/hls-player.css">
</head>
<body style="margin:0;padding:0;background:#000;">
  <div id="player-container"></div>
  <script src="/player/hls.min.js"></script>
  <script src="/player/hls-player.js"></script>
  <script>
    const player = new HLSPlayer('#player-container', {
      src: '/hls/${jobId}/master.m3u8',
      width: ${width},
      height: ${height}
    });
  </script>
</body>
</html>`;

  res.type('html').send(html);
});

module.exports = router;
