const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const playlistGenerator = require('../utils/playlist.generator');

class FFmpegService {
  /**
   * Probe file to get stream information
   */
  async probeFile(inputUrl) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputUrl, (err, metadata) => {
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
            fps: eval(v.r_frame_rate),
            bitrate: v.bit_rate
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
   * Convert MKV to HLS with multiple audio tracks
   */
  async convertToHLS({ inputUrl, outputDir, audioTracks, onProgress, onComplete, onError }) {
    try {
      // Create output directory
      fs.mkdirSync(outputDir, { recursive: true });

      // Get file info
      const fileInfo = await this.probeFile(inputUrl);

      // Step 1: Convert video stream
      await this.convertVideoStream(inputUrl, outputDir, fileInfo, onProgress);

      // Step 2: Convert each audio stream
      for (const track of audioTracks) {
        await this.convertAudioStream(inputUrl, outputDir, track, onProgress);
      }

      // Step 3: Generate master playlist
      const masterPlaylist = playlistGenerator.generateMaster({
        videoPlaylist: 'video.m3u8',
        audioTracks,
        resolution: `${fileInfo.video[0]?.width || 1920}x${fileInfo.video[0]?.height || 1080}`,
        bandwidth: fileInfo.video[0]?.bitrate || 4000000
      });

      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterPlaylist);

      onComplete({
        masterPlaylist: path.join(outputDir, 'master.m3u8'),
        videoPlaylist: path.join(outputDir, 'video.m3u8'),
        audioPlaylists: audioTracks.map(t => 
          path.join(outputDir, `audio_${t.language}.m3u8`)
        )
      });
    } catch (error) {
      onError(error);
    }
  }

  /**
   * Convert video stream to HLS
   */
  convertVideoStream(inputUrl, outputDir, fileInfo, onProgress) {
    return new Promise((resolve, reject) => {
      const needsReencode = !['h264', 'avc1'].includes(
        fileInfo.video[0]?.codec?.toLowerCase()
      );

      let command = ffmpeg(inputUrl)
        .outputOptions([
          '-map 0:v:0',
          '-f hls',
          '-hls_time 4',
          '-hls_playlist_type vod',
          '-hls_segment_type fmp4',
          '-hls_fmp4_init_filename init_video.mp4',
          `-hls_segment_filename ${path.join(outputDir, 'video_%04d.m4s')}`
        ]);

      if (needsReencode) {
        command = command.outputOptions([
          '-c:v libx264',
          '-preset medium',
          '-crf 23',
          '-profile:v high',
          '-level 4.1',
          '-g 48',
          '-keyint_min 48',
          '-sc_threshold 0'
        ]);
      } else {
        command = command.outputOptions(['-c:v copy']);
      }

      command
        .output(path.join(outputDir, 'video.m3u8'))
        .on('progress', (progress) => {
          onProgress(Math.round(progress.percent * 0.5)); // Video is 50% of work
        })
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  /**
   * Convert audio stream to HLS
   */
  convertAudioStream(inputUrl, outputDir, track, onProgress) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputUrl)
        .outputOptions([
          `-map 0:a:${track.index}`,
          '-c:a aac',
          '-b:a 192k',
          '-ac 2',
          '-f hls',
          '-hls_time 4',
          '-hls_playlist_type vod',
          '-hls_segment_type fmp4',
          `-hls_fmp4_init_filename init_audio_${track.language}.mp4`,
          `-hls_segment_filename ${path.join(outputDir, `audio_${track.language}_%04d.m4s`)}`
        ])
        .output(path.join(outputDir, `audio_${track.language}.m3u8`))
        .on('progress', (progress) => {
          const baseProgress = 50 + (track.index * 20);
          onProgress(Math.min(baseProgress + (progress.percent * 0.2), 95));
        })
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }
}

module.exports = new FFmpegService();
