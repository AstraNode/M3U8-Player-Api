const express = require('express');
const router = express.Router();
const ffmpegService = require('../services/ffmpeg.service');
const { v4: uuidv4 } = require('uuid');

// Track conversion jobs
const jobs = new Map();

/**
 * POST /api/convert
 * Start a new conversion job
 */
router.post('/', async (req, res) => {
  try {
    const { inputUrl, audioTracks, outputName } = req.body;

    if (!inputUrl) {
      return res.status(400).json({ error: 'inputUrl is required' });
    }

    const jobId = uuidv4();
    const outputDir = `./output/${jobId}`;

    // Start conversion in background
    jobs.set(jobId, { status: 'processing', progress: 0 });

    ffmpegService.convertToHLS({
      inputUrl,
      outputDir,
      audioTracks: audioTracks || [
        { index: 0, language: 'ja', name: 'Japanese', default: true },
        { index: 1, language: 'en', name: 'English', default: false }
      ],
      onProgress: (progress) => {
        jobs.set(jobId, { status: 'processing', progress });
      },
      onComplete: (result) => {
        jobs.set(jobId, { status: 'complete', ...result });
      },
      onError: (error) => {
        jobs.set(jobId, { status: 'error', error: error.message });
      }
    });

    res.json({ jobId, status: 'started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/convert/:jobId
 * Get conversion job status
 */
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ jobId, ...job });
});

/**
 * POST /api/convert/probe
 * Probe a video file to get stream info
 */
router.post('/probe', async (req, res) => {
  try {
    const { inputUrl } = req.body;

    if (!inputUrl) {
      return res.status(400).json({ error: 'inputUrl is required' });
    }

    const info = await ffmpegService.probeFile(inputUrl);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
