const express = require('express');
const router = express.Router();
const downloadService = require('../services/download.service');
const ffmpegService = require('../services/ffmpeg.service');
const jobManager = require('../services/job.manager');
const path = require('path');
const fs = require('fs');

/**
 * POST /api/stream/start
 * Start streaming a video from URL
 */
router.post('/start', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Create job
    const job = jobManager.createJob(url);

    // Start processing in background
    processVideo(job.id, url).catch(error => {
      jobManager.updateJob(job.id, {
        status: 'error',
        message: error.message,
        step: 'analyze'
      });
    });

    res.json({ jobId: job.id, status: 'started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stream/progress/:jobId
 * SSE endpoint for progress updates
 */
router.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial status
  const job = jobManager.getJob(jobId);
  if (job) {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
  }

  // Subscribe to updates
  const unsubscribe = jobManager.subscribe(jobId, (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Close connection when done
    if (data.status === 'ready' || data.status === 'error') {
      setTimeout(() => {
        res.end();
      }, 1000);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe();
  });
});

/**
 * GET /api/stream/status/:jobId
 * Get current job status (for polling fallback)
 */
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

/**
 * POST /api/stream/cancel/:jobId
 * Cancel a streaming job
 */
router.post('/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;

  const cancelled = jobManager.cancelJob(jobId);

  if (!cancelled) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ success: true });
});

/**
 * Process video: download, analyze, convert
 */
async function processVideo(jobId, url) {
  const outputDir = path.join(__dirname, '../../output', jobId);

  try {
    // Step 1: Analyze
    jobManager.updateJob(jobId, { status: 'analyzing' });

    const fileInfo = await downloadService.analyze(url);

    jobManager.updateJob(jobId, {
      status: 'analyzed',
      fileInfo: {
        name: fileInfo.name,
        size: fileInfo.size,
        contentType: fileInfo.contentType
      }
    });

    // Check if cancelled
    if (jobManager.isCancelled(jobId)) {
      throw new Error('Job cancelled');
    }

    // Step 2: Download
    const inputPath = path.join(outputDir, 'input' + path.extname(fileInfo.name || '.mkv'));
    fs.mkdirSync(outputDir, { recursive: true });

    await downloadService.download(url, inputPath, (progress) => {
      jobManager.updateJob(jobId, {
        status: 'downloading',
        progress: progress.percent,
        speed: progress.speed,
        eta: progress.eta
      });
    });

    if (jobManager.isCancelled(jobId)) {
      throw new Error('Job cancelled');
    }

    jobManager.updateJob(jobId, { status: 'downloaded' });

    // Step 3: Probe file for audio tracks
    const probeInfo = await ffmpegService.probeFile(inputPath);

    jobManager.updateJob(jobId, {
      fileInfo: {
        name: fileInfo.name,
        size: fileInfo.size,
        duration: probeInfo.duration,
        resolution: probeInfo.video[0] ? 
          `${probeInfo.video[0].width}x${probeInfo.video[0].height}` : null,
        audioTracks: probeInfo.audio
      }
    });

    // Step 4: Convert to HLS
    const audioTracks = probeInfo.audio.map((a, i) => ({
      index: i,
      language: a.language || 'und',
      name: a.title || `Audio ${i + 1}`,
      default: i === 0
    }));

    await ffmpegService.convertToHLS({
      inputPath,
      outputDir,
      audioTracks,
      onProgress: (progress) => {
        if (!jobManager.isCancelled(jobId)) {
          jobManager.updateJob(jobId, {
            status: 'converting',
            progress
          });
        }
      }
    });

    if (jobManager.isCancelled(jobId)) {
      throw new Error('Job cancelled');
    }

    // Step 5: Ready
    const streamUrl = `/hls/${jobId}/master.m3u8`;

    jobManager.updateJob(jobId, {
      status: 'ready',
      streamUrl,
      originalUrl: url,
      fileName: fileInfo.name
    });

    // Clean up input file (optional - keep if you want to allow re-processing)
    // fs.unlinkSync(inputPath);

  } catch (error) {
    // Clean up on error
    try {
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    } catch {}

    throw error;
  }
}

module.exports = router;
