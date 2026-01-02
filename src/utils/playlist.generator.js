class PlaylistGenerator {
  /**
   * Generate HLS master playlist with multiple audio tracks
   */
  generateMaster({ videoPlaylist, audioTracks, resolution, bandwidth }) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      ''
    ];

    // Add audio tracks as EXT-X-MEDIA
    for (const track of audioTracks) {
      const isDefault = track.default ? 'YES' : 'NO';
      lines.push(
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${track.name}",` +
        `LANGUAGE="${track.language}",DEFAULT=${isDefault},AUTOSELECT=YES,` +
        `URI="audio_${track.language}.m3u8"`
      );
    }

    lines.push('');

    // Add video stream with audio group reference
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},` +
      `CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"`
    );
    lines.push(videoPlaylist);

    return lines.join('\n');
  }

  /**
   * Generate variant playlist for a single stream
   */
  generateVariant({ segments, initFile, targetDuration = 4, playlistType = 'VOD' }) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
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

    return lines.join('\n');
  }
}

module.exports = new PlaylistGenerator();
