#!/bin/bash

# =============================================================================
# HLS Multi-Audio Converter
# Converts MKV files to HLS with multiple audio tracks
# =============================================================================

set -e

# Configuration
INPUT_FILE="$1"
OUTPUT_DIR="$2"
SEGMENT_DURATION=4

# Validate inputs
if [ -z "$INPUT_FILE" ] || [ -z "$OUTPUT_DIR" ]; then
    echo "Usage: $0 <input.mkv> <output_directory>"
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "=== Analyzing input file ==="
ffprobe -v quiet -print_format json -show_streams "$INPUT_FILE" > "$OUTPUT_DIR/probe.json"

# Get audio stream count
AUDIO_COUNT=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$INPUT_FILE" | wc -l)
echo "Found $AUDIO_COUNT audio stream(s)"

# Get video codec
VIDEO_CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$INPUT_FILE")
echo "Video codec: $VIDEO_CODEC"

# Get resolution
RESOLUTION=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$INPUT_FILE" | tr ',' 'x')
echo "Resolution: $RESOLUTION"

echo ""
echo "=== Converting video stream ==="

# Determine if we need to re-encode video
if [[ "$VIDEO_CODEC" == "h264" || "$VIDEO_CODEC" == "avc1" ]]; then
    VIDEO_OPTS="-c:v copy"
    echo "Video is H.264, using stream copy"
else
    VIDEO_OPTS="-c:v libx264 -preset medium -crf 23 -profile:v high -level 4.1 -g 48 -keyint_min 48 -sc_threshold 0"
    echo "Video needs re-encoding to H.264"
fi

ffmpeg -hide_banner -i "$INPUT_FILE" \
    -map 0:v:0 \
    $VIDEO_OPTS \
    -f hls \
    -hls_time $SEGMENT_DURATION \
    -hls_playlist_type vod \
    -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_video.mp4" \
    -hls_segment_filename "$OUTPUT_DIR/video_%04d.m4s" \
    "$OUTPUT_DIR/video.m3u8"

echo "Video conversion complete"

echo ""
echo "=== Converting audio streams ==="

# Array to store audio track info
declare -a AUDIO_TRACKS

for i in $(seq 0 $((AUDIO_COUNT - 1))); do
    # Get audio stream info
    LANG=$(ffprobe -v error -select_streams a:$i -show_entries stream_tags=language -of csv=p=0 "$INPUT_FILE" | head -1)
    LANG=${LANG:-"und"}
    
    TITLE=$(ffprobe -v error -select_streams a:$i -show_entries stream_tags=title -of csv=p=0 "$INPUT_FILE" | head -1)
    TITLE=${TITLE:-"Audio $((i + 1))"}
    
    echo "Processing audio track $i: $TITLE ($LANG)"
    
    ffmpeg -hide_banner -i "$INPUT_FILE" \
        -map 0:a:$i \
        -c:a aac -b:a 192k -ac 2 \
        -f hls \
        -hls_time $SEGMENT_DURATION \
        -hls_playlist_type vod \
        -hls_segment_type fmp4 \
        -hls_fmp4_init_filename "init_audio_${i}.mp4" \
        -hls_segment_filename "$OUTPUT_DIR/audio_${i}_%04d.m4s" \
        "$OUTPUT_DIR/audio_${i}.m3u8"
    
    # Store track info
    AUDIO_TRACKS+=("$i|$LANG|$TITLE")
done

echo ""
echo "=== Generating master playlist ==="

# Create master playlist
MASTER_PLAYLIST="$OUTPUT_DIR/master.m3u8"

cat > "$MASTER_PLAYLIST" << EOF
#EXTM3U
#EXT-X-VERSION:7

EOF

# Add audio tracks
for track_info in "${AUDIO_TRACKS[@]}"; do
    IFS='|' read -r INDEX LANG NAME <<< "$track_info"
    
    if [ "$INDEX" -eq 0 ]; then
        DEFAULT="YES"
    else
        DEFAULT="NO"
    fi
    
    echo "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"$NAME\",LANGUAGE=\"$LANG\",DEFAULT=$DEFAULT,AUTOSELECT=YES,URI=\"audio_${INDEX}.m3u8\"" >> "$MASTER_PLAYLIST"
done

# Get video bitrate (estimate if not available)
BITRATE=$(ffprobe -v error -select_streams v:0 -show_entries stream=bit_rate -of csv=p=0 "$INPUT_FILE")
BITRATE=${BITRATE:-4000000}

cat >> "$MASTER_PLAYLIST" << EOF

#EXT-X-STREAM-INF:BANDWIDTH=$BITRATE,RESOLUTION=$RESOLUTION,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"
video.m3u8
EOF

echo "Master playlist created: $MASTER_PLAYLIST"
echo ""
echo "=== Conversion complete ==="
echo ""
echo "Output files:"
ls -la "$OUTPUT_DIR"
echo ""
echo "To play: Open $MASTER_PLAYLIST in the HLS player"
