const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const playlistGenerator = require('../utils/playlist.generator');

class FFmpegService {
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

        resolve({
          format: metadata.format,
          duration: metadata.format.duration,
          video: videoStreams.map((v, i) => ({
            index: i,
            codec: v.codec_name,
            width: v.width,
            height: v.height,
            fps: v.r_frame_rate ? eval(v.r_frame_rate) : null,
            bitrate: v.bit_rate,
            pix_fmt: v.pix_fmt // Add pixel format
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
   * Convert to HLS with multiple audio tracks
   */
  async convertToHLS({ inputPath, outputDir, audioTracks, onProgress }) {
    try {
      // Ensure output directory exists
      fs.mkdirSync(outputDir, { recursive: true });

      // Get file info for video codec check
      const fileInfo = await this.probeFile(inputPath);
      const totalDuration = fileInfo.duration || 0;

      console.log('Starting HLS conversion...');
      console.log('File duration:', totalDuration);
      console.log('Audio tracks:', audioTracks.length);

      let lastReportedProgress = 0;

      // Helper to report progress only if it increased
      const reportProgress = (progress) => {
        const clamped = Math.min(Math.max(progress, 0), 100);
        if (clamped > lastReportedProgress) {
          lastReportedProgress = clamped;
          onProgress(clamped);
        }
      };

      // Step 1: Convert video stream (50% of progress)
      console.log('Converting video stream...');
      await this.convertVideoStream(inputPath, outputDir, fileInfo, totalDuration, (progress) => {
        const videoProgress = (progress / 100) * 50; // Video is 50% of work
        console.log('Video progress:', videoProgress.toFixed(2) + '%');
        reportProgress(videoProgress);
      });

      console.log('Video conversion complete');
      reportProgress(50); // Ensure we're at 50%

      // Step 2: Convert audio streams in parallel (40% of progress)
      console.log('Converting audio streams in parallel...');
      const audioCount = audioTracks.length;
      
      // Convert all audio tracks in parallel to utilize all CPUs
      const audioPromises = audioTracks.map((track, i) => {
        console.log(`Starting audio track ${i + 1}/${audioCount}: ${track.language}`);
        
        return this.convertAudioStream(inputPath, outputDir, track, totalDuration, (progress) => {
          const baseProgress = 50; // Video is done
          const audioProgressPerTrack = 40 / audioCount;
          const trackProgress = (progress / 100) * audioProgressPerTrack;
          const totalProgress = baseProgress + (i * audioProgressPerTrack) + trackProgress;
          console.log(`Audio ${i + 1} progress:`, totalProgress.toFixed(2) + '%');
          reportProgress(totalProgress);
        });
      });

      // Wait for all audio tracks to complete
      await Promise.all(audioPromises);
      
      console.log('All audio tracks complete');
      reportProgress(90);

      // Step 3: Generate master playlist (remaining 10%)
      console.log('Generating master playlist...');
      reportProgress(90);

      const masterPlaylist = playlistGenerator.generateMaster({
        videoPlaylist: 'video.m3u8',
        audioTracks,
        resolution: fileInfo.video[0] 
          ? `${fileInfo.video[0].width}x${fileInfo.video[0].height}` 
          : '1920x1080',
        bandwidth: fileInfo.video[0]?.bitrate || 4000000
      });

      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterPlaylist);

      reportProgress(100);
      console.log('HLS conversion complete!');

      return {
        masterPlaylist: path.join(outputDir, 'master.m3u8')
      };
    } catch (error) {
      console.error('HLS conversion error:', error);
      throw error;
    }
  }

  /**
   * Convert video stream to HLS
   */
  convertVideoStream(inputPath, outputDir, fileInfo, totalDuration, onProgress) {
    return new Promise((resolve, reject) => {
      // Check if video needs re-encoding
      const videoCodec = fileInfo.video[0]?.codec?.toLowerCase() || '';
      const pixFmt = fileInfo.video[0]?.pix_fmt || '';
      
      // Can copy if it's already H.264 and 8-bit
      const canCopy = ['h264', 'avc1', 'avc'].includes(videoCodec) && 
                      !pixFmt.includes('10'); // Not 10-bit
      
      const needsReencode = !canCopy;

      console.log('Video codec:', videoCodec);
      console.log('Pixel format:', pixFmt);
      console.log('Video needs re-encoding:', needsReencode);

      let lastPercent = 0;

      let command = ffmpeg(inputPath)
        .outputOptions([
          '-map 0:v:0',
          '-threads 40', // Use all 40 vCPUs for decoding/filtering
          '-f hls',
          '-hls_time 4',
          '-hls_playlist_type vod',
          '-hls_segment_type fmp4',
          '-hls_fmp4_init_filename init_video.mp4',
          `-hls_segment_filename ${path.join(outputDir, 'video_%04d.m4s')}`
        ]);

      if (needsReencode) {
        // Always convert to 8-bit yuv420p for maximum HLS compatibility
        command = command.outputOptions([
          '-c:v libx264',
          '-preset veryfast', // Good balance of speed vs quality
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-pix_fmt yuv420p', // Force 8-bit for compatibility
          '-g 48',
          '-keyint_min 48',
          '-sc_threshold 0',
          '-movflags +faststart',
          '-x264-params threads=40' // Force x264 to use all 40 cores
        ]);
      } else {
        command = command.outputOptions([
          '-c:v copy'
        ]);
      }

      command
        .output(path.join(outputDir, 'video.m3u8'))
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          // Calculate percentage based on timemark and duration
          let percent = 0;
          
          if (progress.timemark && totalDuration > 0) {
            const timeParts = progress.timemark.split(':');
            const seconds = parseInt(timeParts[0]) * 3600 + 
                          parseInt(timeParts[1]) * 60 + 
                          parseFloat(timeParts[2]);
            percent = Math.min((seconds / totalDuration) * 100, 100);
          } else if (progress.percent) {
            percent = Math.min(progress.percent, 100);
          }

          // Only report if progress increased
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        })
        .on('stderr', (stderrLine) => {
          // Log stderr for debugging (but less verbose)
          if (stderrLine.includes('time=')) {
            console.log('FFmpeg:', stderrLine.substring(0, 100));
          }
        })
        .on('end', () => {
          console.log('Video stream conversion finished');
          onProgress(100);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error('Video conversion error:', err.message);
          console.error('FFmpeg stderr:', stderr);
          reject(new Error(`Video conversion failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Convert audio stream to HLS
   */
  convertAudioStream(inputPath, outputDir, track, totalDuration, onProgress) {
    return new Promise((resolve, reject) => {
      let lastPercent = 0;

      ffmpeg(inputPath)
        .outputOptions([
          `-map 0:a:${track.index}`,
          '-c:a aac',
          '-b:a 192k',
          '-ac 2',
          '-threads 4', // Audio encoding doesn't need many threads
          '-f hls',
          '-hls_time 4',
          '-hls_playlist_type vod',
          '-hls_segment_type fmp4',
          `-hls_fmp4_init_filename init_audio_${track.language}.mp4`,
          `-hls_segment_filename ${path.join(outputDir, `audio_${track.language}_%04d.m4s`)}`
        ])
        .output(path.join(outputDir, `audio_${track.language}.m3u8`))
        .on('start', (commandLine) => {
          console.log('Audio FFmpeg command:', commandLine.substring(0, 150) + '...');
        })
        .on('progress', (progress) => {
          // Calculate percentage based on timemark and duration
          let percent = 0;
          
          if (progress.timemark && totalDuration > 0) {
            const timeParts = progress.timemark.split(':');
            const seconds = parseInt(timeParts[0]) * 3600 + 
                          parseInt(timeParts[1]) * 60 + 
                          parseFloat(timeParts[2]);
            percent = Math.min((seconds / totalDuration) * 100, 100);
          } else if (progress.percent) {
            percent = Math.min(progress.percent, 100);
          }

          // Only report if progress increased
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        })
        .on('stderr', (stderrLine) => {
          // Less verbose logging
          if (stderrLine.includes('time=')) {
            console.log('Audio FFmpeg:', stderrLine.substring(0, 100));
          }
        })
        .on('end', () => {
          console.log(`Audio track ${track.language} conversion finished`);
          onProgress(100);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`Audio track ${track.language} conversion error:`, err.message);
          console.error('FFmpeg stderr:', stderr);
          reject(new Error(`Audio conversion failed: ${err.message}`));
        })
        .run();
    });
  }
}

module.exports = new FFmpegService();
