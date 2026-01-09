const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const playlistGenerator = require('../utils/playlist.generator');

class FFmpegService {
  constructor() {
    this.cpuCount = os.cpus().length;
    this.useRamDisk = false;
    this.ramDiskPath = '/dev/shm'; // Linux shared memory
    
    console.log(`Detected ${this.cpuCount} CPU cores`);
    
    // Check for hardware acceleration
    this.hwAccel = this.detectHardwareAcceleration();
    console.log('Hardware acceleration:', this.hwAccel || 'none (using CPU)');
  }

  /**
   * Detect available hardware acceleration
   */
  detectHardwareAcceleration() {
    try {
      const output = execSync('ffmpeg -hwaccels 2>/dev/null', { encoding: 'utf8' });
      
      if (output.includes('cuda') || output.includes('nvenc')) {
        return 'nvidia';
      }
      if (output.includes('vaapi')) {
        return 'vaapi';
      }
      if (output.includes('qsv')) {
        return 'qsv';
      }
    } catch (e) {
      // Ignore errors
    }
    return null;
  }

  /**
   * Get optimal thread count based on task
   */
  getOptimalThreads(task = 'video') {
    const available = this.cpuCount;
    
    switch (task) {
      case 'video':
        // libx264 scales well up to ~16-24 threads, diminishing returns after
        return Math.min(available, 24);
      case 'audio':
        // Audio encoding is light, 2-4 threads is enough
        return Math.min(available, 4);
      case 'decode':
        // Decoding can use more threads
        return Math.min(available, 32);
      default:
        return Math.min(available, 16);
    }
  }

  /**
   * Probe file to get stream information
   */
  async probeFile(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStreams = metadata.streams.filter(s => s.codec_type === 'video');
        const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
        const subtitleStreams = metadata.streams.filter(s => s.codec_type === 'subtitle');

        // Safely evaluate frame rate
        const evalFps = (fpsStr) => {
          if (!fpsStr) return null;
          const parts = fpsStr.split('/');
          if (parts.length === 2) {
            return parseFloat(parts[0]) / parseFloat(parts[1]);
          }
          return parseFloat(fpsStr);
        };

        resolve({
          format: metadata.format,
          duration: metadata.format.duration,
          video: videoStreams.map((v, i) => ({
            index: i,
            codec: v.codec_name,
            width: v.width,
            height: v.height,
            fps: evalFps(v.r_frame_rate),
            bitrate: v.bit_rate,
            pix_fmt: v.pix_fmt
          })),
          audio: audioStreams.map((a, i) => ({
            index: i,
            codec: a.codec_name,
            language: a.tags?.language || 'und',
            title: a.tags?.title || `Audio ${i + 1}`,
            channels: a.channels,
            bitrate: a.bit_rate
          })),
          subtitles: subtitleStreams.map((s, i) => ({
            index: i,
            codec: s.codec_name,
            language: s.tags?.language || 'und',
            title: s.tags?.title || `Subtitle ${i + 1}`
          }))
        });
      });
    });
  }

  /**
   * Convert to HLS with multiple audio tracks - OPTIMIZED
   */
  async convertToHLS({ inputPath, outputDir, audioTracks, onProgress }) {
    const startTime = Date.now();
    
    try {
      // Use RAM disk for temp files if available (HUGE speed boost)
      let workDir = outputDir;
      const useRamDisk = fs.existsSync(this.ramDiskPath) && this.useRamDisk;
      
      if (useRamDisk) {
        workDir = path.join(this.ramDiskPath, `hls_${Date.now()}`);
        console.log('Using RAM disk for processing:', workDir);
      }
      
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      const fileInfo = await this.probeFile(inputPath);
      const totalDuration = fileInfo.duration || 0;

      console.log('\n========== HLS Conversion Start ==========');
      console.log('CPU Cores:', this.cpuCount);
      console.log('Hardware Accel:', this.hwAccel || 'CPU only');
      console.log('File duration:', totalDuration, 'seconds');
      console.log('Video codec:', fileInfo.video[0]?.codec);
      console.log('Audio tracks:', audioTracks.length);
      console.log('Work directory:', workDir);
      console.log('==========================================\n');

      let lastReportedProgress = 0;
      const reportProgress = (progress) => {
        const clamped = Math.min(Math.max(progress, 0), 100);
        if (clamped > lastReportedProgress + 0.5) { // Report every 0.5%
          lastReportedProgress = clamped;
          onProgress(clamped);
        }
      };

      // PARALLEL PROCESSING: Video + All Audio at the same time!
      console.log('Starting PARALLEL video + audio conversion...');
      
      const audioProgressMap = new Map();
      let videoProgress = 0;

      const calculateTotalProgress = () => {
        // Video = 60%, Audio = 30%, Finalize = 10%
        const audioCount = audioTracks.length || 1;
        let audioTotal = 0;
        for (const [, progress] of audioProgressMap) {
          audioTotal += progress;
        }
        const avgAudioProgress = audioCount > 0 ? audioTotal / audioCount : 0;
        
        return (videoProgress * 0.6) + (avgAudioProgress * 0.3);
      };

      // Start all conversions in parallel
      const videoPromise = this.convertVideoStreamOptimized(
        inputPath, workDir, fileInfo, totalDuration, 
        (progress) => {
          videoProgress = progress;
          reportProgress(calculateTotalProgress());
        }
      );

      const audioPromises = audioTracks.map((track, i) => {
        audioProgressMap.set(i, 0);
        return this.convertAudioStreamOptimized(
          inputPath, workDir, track, totalDuration,
          (progress) => {
            audioProgressMap.set(i, progress);
            reportProgress(calculateTotalProgress());
          }
        );
      });

      // Wait for all to complete
      await Promise.all([videoPromise, ...audioPromises]);
      
      console.log('\nAll streams converted successfully!');
      reportProgress(90);

      // Generate master playlist
      console.log('Generating master playlist...');
      
      const masterPlaylist = playlistGenerator.generateMaster({
        videoPlaylist: 'video.m3u8',
        audioTracks,
        resolution: fileInfo.video[0] 
          ? `${fileInfo.video[0].width}x${fileInfo.video[0].height}` 
          : '1920x1080',
        bandwidth: fileInfo.video[0]?.bitrate || 4000000
      });

      fs.writeFileSync(path.join(workDir, 'master.m3u8'), masterPlaylist);

      // Copy from RAM disk to final output if needed
      if (useRamDisk && workDir !== outputDir) {
        console.log('Copying from RAM disk to output directory...');
        const files = fs.readdirSync(workDir);
        for (const file of files) {
          fs.copyFileSync(
            path.join(workDir, file),
            path.join(outputDir, file)
          );
        }
        // Cleanup RAM disk
        fs.rmSync(workDir, { recursive: true, force: true });
      }

      reportProgress(100);
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n========== Conversion Complete ==========`);
      console.log(`Total time: ${elapsed} seconds`);
      console.log(`Speed: ${(totalDuration / parseFloat(elapsed)).toFixed(2)}x realtime`);
      console.log('==========================================\n');

      return {
        masterPlaylist: path.join(outputDir, 'master.m3u8'),
        elapsedSeconds: parseFloat(elapsed)
      };
    } catch (error) {
      console.error('HLS conversion error:', error);
      throw error;
    }
  }

  /**
   * Convert video stream - OPTIMIZED
   */
  convertVideoStreamOptimized(inputPath, outputDir, fileInfo, totalDuration, onProgress) {
    return new Promise((resolve, reject) => {
      const videoCodec = fileInfo.video[0]?.codec?.toLowerCase() || '';
      const pixFmt = fileInfo.video[0]?.pix_fmt || '';
      
      const canCopy = ['h264', 'avc1', 'avc'].includes(videoCodec) && 
                      !pixFmt.includes('10') &&
                      pixFmt.includes('yuv420p');

      console.log('\n--- Video Stream Configuration ---');
      console.log('Source codec:', videoCodec);
      console.log('Pixel format:', pixFmt);
      console.log('Stream copy:', canCopy ? 'YES' : 'NO (re-encoding)');

      const videoThreads = this.getOptimalThreads('video');
      const decodeThreads = this.getOptimalThreads('decode');
      
      console.log('Decode threads:', decodeThreads);
      console.log('Encode threads:', videoThreads);
      console.log('----------------------------------\n');

      let lastPercent = 0;

      const outputOptions = [
        '-map 0:v:0',
        '-an', // No audio in video stream
        '-sn', // No subtitles
        '-f hls',
        '-hls_time 6', // Larger segments = fewer files = faster I/O
        '-hls_playlist_type vod',
        '-hls_segment_type fmp4',
        '-hls_fmp4_init_filename init_video.mp4',
        `-hls_segment_filename ${path.join(outputDir, 'video_%03d.m4s')}`
      ];

      if (canCopy) {
        outputOptions.push('-c:v copy');
      } else {
        // Optimized encoding settings
        const encodeOptions = this.getVideoEncodeOptions(fileInfo, videoThreads);
        outputOptions.push(...encodeOptions);
      }

      // Add input options for faster decoding
      const command = ffmpeg(inputPath)
        .inputOptions([
          `-threads ${decodeThreads}`,
          '-analyzeduration 100M',
          '-probesize 100M'
        ])
        .outputOptions(outputOptions)
        .output(path.join(outputDir, 'video.m3u8'));

      command
        .on('start', (cmd) => {
          console.log('Video FFmpeg command (truncated):');
          console.log(cmd.substring(0, 200) + '...\n');
        })
        .on('progress', (progress) => {
          let percent = this.calculateProgress(progress, totalDuration);
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        })
        .on('stderr', (line) => {
          // Only log important lines
          if (line.includes('frame=') || line.includes('speed=')) {
            process.stdout.write(`\rVideo: ${line.trim()}`);
          }
        })
        .on('end', () => {
          console.log('\n✓ Video stream complete');
          onProgress(100);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error('\n✗ Video conversion error:', err.message);
          reject(new Error(`Video conversion failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Get optimized video encoding options
   */
  getVideoEncodeOptions(fileInfo, threads) {
    const width = fileInfo.video[0]?.width || 1920;
    const height = fileInfo.video[0]?.height || 1080;
    
    // Calculate optimal bitrate based on resolution
    let targetBitrate = '4M';
    if (width >= 3840) targetBitrate = '15M';
    else if (width >= 2560) targetBitrate = '8M';
    else if (width >= 1920) targetBitrate = '5M';
    else if (width >= 1280) targetBitrate = '3M';
    else targetBitrate = '1.5M';

    const options = [
      '-c:v libx264',
      '-preset ultrafast', // FASTEST preset - huge speed gain
      '-tune fastdecode', // Optimize for fast playback
      '-profile:v high',
      '-level 4.1',
      '-pix_fmt yuv420p',
      `-b:v ${targetBitrate}`,
      '-maxrate ' + targetBitrate.replace('M', '.5M'),
      '-bufsize ' + targetBitrate.replace('M', '0M'),
      '-g 48', // GOP size
      '-keyint_min 48',
      '-sc_threshold 0',
      '-bf 0', // Disable B-frames for faster encoding
      `-threads ${threads}`,
      '-row-mt 1', // Enable row-based multithreading
      '-fast-pskip 1',
      '-me_method dia', // Fastest motion estimation
      '-subq 0', // Fastest subpel quality
      '-refs 1', // Minimum reference frames
      '-movflags +faststart'
    ];

    return options;
  }

  /**
   * Convert audio stream - OPTIMIZED
   */
  convertAudioStreamOptimized(inputPath, outputDir, track, totalDuration, onProgress) {
    return new Promise((resolve, reject) => {
      let lastPercent = 0;
      const audioThreads = this.getOptimalThreads('audio');

      const safeLanguage = track.language.replace(/[^a-z0-9]/gi, '_');

      ffmpeg(inputPath)
        .inputOptions([
          '-threads 4'
        ])
        .outputOptions([
          `-map 0:a:${track.index}`,
          '-vn', // No video
          '-sn', // No subtitles
          '-c:a aac',
          '-b:a 128k', // Slightly lower bitrate for speed
          '-ac 2',
          '-ar 48000',
          `-threads ${audioThreads}`,
          '-f hls',
          '-hls_time 6',
          '-hls_playlist_type vod',
          '-hls_segment_type fmp4',
          `-hls_fmp4_init_filename init_audio_${safeLanguage}.mp4`,
          `-hls_segment_filename ${path.join(outputDir, `audio_${safeLanguage}_%03d.m4s`)}`
        ])
        .output(path.join(outputDir, `audio_${safeLanguage}.m3u8`))
        .on('start', () => {
          console.log(`Starting audio: ${track.language}`);
        })
        .on('progress', (progress) => {
          let percent = this.calculateProgress(progress, totalDuration);
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        })
        .on('end', () => {
          console.log(`✓ Audio ${track.language} complete`);
          onProgress(100);
          resolve();
        })
        .on('error', (err) => {
          console.error(`✗ Audio ${track.language} error:`, err.message);
          reject(new Error(`Audio ${track.language} failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Calculate progress percentage
   */
  calculateProgress(progress, totalDuration) {
    if (progress.timemark && totalDuration > 0) {
      const parts = progress.timemark.split(':');
      const seconds = parseInt(parts[0]) * 3600 + 
                      parseInt(parts[1]) * 60 + 
                      parseFloat(parts[2]);
      return Math.min((seconds / totalDuration) * 100, 100);
    }
    return progress.percent ? Math.min(progress.percent, 100) : 0;
  }
}

module.exports = new FFmpegService();
