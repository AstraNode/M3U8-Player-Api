class PlaylistGenerator {
  /**
   * Generate HLS master playlist with multiple audio tracks
   */
  generateMaster({ videoPlaylist, audioTracks, resolution, bandwidth, codecs = 'avc1.640028,mp4a.40.2' }) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      ''
    ];

    console.log('Generating master playlist for', audioTracks.length, 'audio tracks');

    // Add audio tracks as EXT-X-MEDIA
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      const isDefault = track.default ? 'YES' : 'NO';
      const autoSelect = 'YES'; // All tracks auto-selectable
      
      // Sanitize language code to match filename (same as FFmpeg service)
      const safeLanguage = track.language.replace(/[^a-z0-9]/gi, '_');
      
      console.log(`Audio track ${i}: ${track.language} -> ${safeLanguage} (${track.name})`);
      
      lines.push(
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${track.name}",` +
        `LANGUAGE="${track.language}",DEFAULT=${isDefault},AUTOSELECT=${autoSelect},` +
        `URI="audio_${safeLanguage}.m3u8"`
      );
    }

    lines.push('');

    // Add video stream with audio group reference
    console.log(`Video: ${resolution} @ ${bandwidth} bps`);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},` +
      `CODECS="${codecs}",AUDIO="audio"`
    );
    lines.push(videoPlaylist);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate variant playlist for a single stream
   * (Not used - FFmpeg generates these automatically)
   */
  generateVariant({ segments, initFile, targetDuration = 4, playlistType = 'VOD' }) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      `#EXT-X-TARGETDURATION:${Math.ceil(targetDuration)}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      `#EXT-X-PLAYLIST-TYPE:${playlistType}`,
      `#EXT-X-MAP:URI="${initFile}"`,
      ''
    ];

    for (const segment of segments) {
      lines.push(`#EXTINF:${segment.duration.toFixed(6)},`);
      lines.push(segment.filename);
    }

    lines.push('#EXT-X-ENDLIST');
    lines.push('');

    return lines.join('\n');
  }
}

module.exports = new PlaylistGenerator();
