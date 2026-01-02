/**
 * HLSPlayer - Multi-Audio HLS Video Player
 * Compatible with Safari (native), Chrome/Firefox (hls.js)
 */
class HLSPlayer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    if (!this.container) {
      throw new Error('Container element not found');
    }

    // Configuration
    this.config = {
      src: options.src || null,
      width: options.width || 854,
      height: options.height || 480,
      autoplay: options.autoplay || false,
      muted: options.muted || false,
      poster: options.poster || null,
      hlsConfig: options.hlsConfig || {},
      onReady: options.onReady || (() => {}),
      onError: options.onError || ((e) => console.error(e)),
      onAudioTrackChange: options.onAudioTrackChange || (() => {}),
      onTimeUpdate: options.onTimeUpdate || (() => {})
    };

    // State
    this.hls = null;
    this.video = null;
    this.audioTracks = [];
    this.currentAudioTrack = 0;
    this.isHlsSupported = false;
    this.isNativeHlsSupported = false;

    this._init();
  }

  /**
   * Initialize the player
   */
  _init() {
    this._checkSupport();
    this._createElements();
    this._attachEventListeners();
    
    if (this.config.src) {
      this.load(this.config.src);
    }
  }

  /**
   * Check HLS support
   */
  _checkSupport() {
    this.isHlsSupported = typeof Hls !== 'undefined' && Hls.isSupported();
    
    const video = document.createElement('video');
    this.isNativeHlsSupported = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    
    if (!this.isHlsSupported && !this.isNativeHlsSupported) {
      throw new Error('HLS playback is not supported in this browser');
    }
  }

  /**
   * Create DOM elements
   */
  _createElements() {
    // Clear container
    this.container.innerHTML = '';
    this.container.classList.add('hls-player');

    // Create wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'hls-player-wrapper';
    this.wrapper.style.width = `${this.config.width}px`;
    this.wrapper.style.maxWidth = '100%';

    // Create video element
    this.video = document.createElement('video');
    this.video.className = 'hls-player-video';
    this.video.controls = true;
    this.video.playsInline = true;
    this.video.muted = this.config.muted;
    if (this.config.poster) {
      this.video.poster = this.config.poster;
    }

    // Create controls container
    this.controls = document.createElement('div');
    this.controls.className = 'hls-player-controls';

    // Create audio track selector
    this.audioSelector = this._createAudioSelector();

    // Assemble elements
    this.controls.appendChild(this.audioSelector);
    this.wrapper.appendChild(this.video);
    this.wrapper.appendChild(this.controls);
    this.container.appendChild(this.wrapper);
  }

  /**
   * Create audio track selector dropdown
   */
  _createAudioSelector() {
    const container = document.createElement('div');
    container.className = 'hls-audio-selector';

    const label = document.createElement('span');
    label.textContent = 'Audio: ';
    label.className = 'hls-audio-label';

    const select = document.createElement('select');
    select.className = 'hls-audio-select';
    select.id = 'audio-track-select';

    container.appendChild(label);
    container.appendChild(select);

    return container;
  }

  /**
   * Update audio track options
   */
  _updateAudioTrackOptions() {
    const select = this.audioSelector.querySelector('select');
    select.innerHTML = '';

    this.audioTracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = track.name || track.lang || `Track ${index + 1}`;
      if (index === this.currentAudioTrack) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    // Show/hide selector based on track count
    this.audioSelector.style.display = this.audioTracks.length > 1 ? 'flex' : 'none';
  }

  /**
   * Attach event listeners
   */
  _attachEventListeners() {
    // Audio track change
    const select = this.audioSelector.querySelector('select');
    select.addEventListener('change', (e) => {
      this.setAudioTrack(parseInt(e.target.value, 10));
    });

    // Video events
    this.video.addEventListener('timeupdate', () => {
      this.config.onTimeUpdate({
        currentTime: this.video.currentTime,
        duration: this.video.duration
      });
    });

    this.video.addEventListener('error', (e) => {
      this.config.onError(e);
    });
  }

  /**
   * Load HLS source
   */
  load(src) {
    this.config.src = src;

    // Destroy existing instance
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Use hls.js for Chrome/Firefox
    if (this.isHlsSupported && !this.isNativeHlsSupported) {
      this._loadWithHlsJs(src);
    } 
    // Use native HLS for Safari
    else if (this.isNativeHlsSupported) {
      this._loadNative(src);
    }
  }

  /**
   * Load using hls.js (Chrome, Firefox)
   */
  _loadWithHlsJs(src) {
    this.hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: false,
      ...this.config.hlsConfig
    });

    this.hls.loadSource(src);
    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      // Extract audio tracks
      this.audioTracks = this.hls.audioTracks.map((track, index) => ({
        index,
        id: track.id,
        name: track.name,
        lang: track.lang,
        default: track.default
      }));
      
      this.currentAudioTrack = this.hls.audioTrack;
      this._updateAudioTrackOptions();
      
      this.config.onReady({
        audioTracks: this.audioTracks,
        levels: data.levels
      });

      if (this.config.autoplay) {
        this.play();
      }
    });

    this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (event, data) => {
      this.currentAudioTrack = data.id;
      this.config.onAudioTrackChange(this.audioTracks[data.id]);
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            this.hls.recoverMediaError();
            break;
          default:
            this.destroy();
            this.config.onError(data);
            break;
        }
      }
    });
  }

  /**
   * Load using native HLS (Safari)
   */
  _loadNative(src) {
    this.video.src = src;

    this.video.addEventListener('loadedmetadata', () => {
      // Safari exposes audio tracks via audioTracks API
      if (this.video.audioTracks) {
        this.audioTracks = Array.from(this.video.audioTracks).map((track, index) => ({
          index,
          id: track.id,
          name: track.label || track.language,
          lang: track.language,
          enabled: track.enabled
        }));

        // Find current enabled track
        this.currentAudioTrack = this.audioTracks.findIndex(t => t.enabled);
        this._updateAudioTrackOptions();

        // Listen for track changes
        this.video.audioTracks.addEventListener('change', () => {
          const enabledTrack = Array.from(this.video.audioTracks).findIndex(t => t.enabled);
          this.currentAudioTrack = enabledTrack;
          this._updateAudioTrackOptions();
          this.config.onAudioTrackChange(this.audioTracks[enabledTrack]);
        });
      }

      this.config.onReady({
        audioTracks: this.audioTracks
      });

      if (this.config.autoplay) {
        this.play();
      }
    }, { once: true });
  }

  /**
   * Set audio track
   */
  setAudioTrack(index) {
    if (index < 0 || index >= this.audioTracks.length) {
      console.warn(`Invalid audio track index: ${index}`);
      return;
    }

    // hls.js
    if (this.hls) {
      this.hls.audioTrack = index;
    }
    // Native (Safari)
    else if (this.video.audioTracks) {
      for (let i = 0; i < this.video.audioTracks.length; i++) {
        this.video.audioTracks[i].enabled = (i === index);
      }
    }

    this.currentAudioTrack = index;
    this._updateAudioTrackOptions();
  }

  /**
   * Get current audio track
   */
  getAudioTrack() {
    return this.audioTracks[this.currentAudioTrack] || null;
  }

  /**
   * Get all audio tracks
   */
  getAudioTracks() {
    return [...this.audioTracks];
  }

  /**
   * Play video
   */
  async play() {
    try {
      await this.video.play();
    } catch (error) {
      // Autoplay was prevented
      console.warn('Autoplay prevented:', error);
    }
  }

  /**
   * Pause video
   */
  pause() {
    this.video.pause();
  }

  /**
   * Seek to time
   */
  seek(time) {
    this.video.currentTime = time;
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume) {
    this.video.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Get volume
   */
  getVolume() {
    return this.video.volume;
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    this.video.muted = !this.video.muted;
    return this.video.muted;
  }

  /**
   * Get current time
   */
  getCurrentTime() {
    return this.video.currentTime;
  }

  /**
   * Get duration
   */
  getDuration() {
    return this.video.duration;
  }

  /**
   * Get video element
   */
  getVideoElement() {
    return this.video;
  }

  /**
   * Get hls.js instance
   */
  getHlsInstance() {
    return this.hls;
  }

  /**
   * Destroy player
   */
  destroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
    }

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HLSPlayer;
}

if (typeof window !== 'undefined') {
  window.HLSPlayer = HLSPlayer;
}
