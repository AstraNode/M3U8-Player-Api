/**
 * HLS Stream Player - Frontend Application
 */
class StreamApp {
  constructor() {
    // State
    this.currentJob = null;
    this.player = null;
    this.eventSource = null;
    this.history = this.loadHistory();
    
    // DOM Elements
    this.elements = {
      // Sections
      inputSection: document.getElementById('input-section'),
      processingSection: document.getElementById('processing-section'),
      playerSection: document.getElementById('player-section'),
      
      // Form
      urlForm: document.getElementById('url-form'),
      urlInput: document.getElementById('video-url'),
      submitBtn: document.getElementById('submit-btn'),
      
      // Processing
      cancelBtn: document.getElementById('cancel-btn'),
      fileInfo: document.getElementById('file-info'),
      fileName: document.getElementById('file-name'),
      fileMeta: document.getElementById('file-meta'),
      
      // Steps
      stepAnalyze: document.getElementById('step-analyze'),
      stepDownload: document.getElementById('step-download'),
      stepConvert: document.getElementById('step-convert'),
      stepReady: document.getElementById('step-ready'),
      
      // Progress
      downloadProgress: document.getElementById('download-progress'),
      downloadText: document.getElementById('download-text'),
      convertProgress: document.getElementById('convert-progress'),
      convertText: document.getElementById('convert-text'),
      
      // Player
      playerContainer: document.getElementById('player-container'),
      videoTitle: document.getElementById('video-title'),
      newVideoBtn: document.getElementById('new-video-btn'),
      copyLinkBtn: document.getElementById('copy-link-btn'),
      
      // Info
      infoDuration: document.getElementById('info-duration'),
      infoResolution: document.getElementById('info-resolution'),
      infoAudioTracks: document.getElementById('info-audio-tracks'),
      
      // History
      historyBtn: document.getElementById('history-btn'),
      historyModal: document.getElementById('history-modal'),
      historyList: document.getElementById('history-list'),
      closeHistory: document.getElementById('close-history'),
      clearHistory: document.getElementById('clear-history'),
      
      // Theme
      themeBtn: document.getElementById('theme-btn'),
      
      // Toast
      toastContainer: document.getElementById('toast-container')
    };
    
    this.init();
  }
  
  init() {
    this.bindEvents();
    this.loadTheme();
    this.checkUrlParams();
  }
  
  bindEvents() {
    // Form submission
    this.elements.urlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startStream(this.elements.urlInput.value.trim());
    });
    
    // Example links
    document.querySelectorAll('.example-link').forEach(link => {
      link.addEventListener('click', () => {
        const url = link.dataset.url;
        this.elements.urlInput.value = url;
        this.startStream(url);
      });
    });
    
    // Cancel button
    this.elements.cancelBtn.addEventListener('click', () => this.cancelJob());
    
    // New video button
    this.elements.newVideoBtn.addEventListener('click', () => this.showInputSection());
    
    // Copy link button
    this.elements.copyLinkBtn.addEventListener('click', () => this.copyStreamLink());
    
    // History
    this.elements.historyBtn.addEventListener('click', () => this.showHistory());
    this.elements.closeHistory.addEventListener('click', () => this.hideHistory());
    this.elements.clearHistory.addEventListener('click', () => this.clearAllHistory());
    this.elements.historyModal.querySelector('.modal-backdrop').addEventListener('click', () => this.hideHistory());
    
    // Theme toggle
    this.elements.themeBtn.addEventListener('click', () => this.toggleTheme());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideHistory();
      }
    });
  }
  
  // =========================================================================
  // Streaming Flow
  // =========================================================================
  
  async startStream(url) {
    if (!url) {
      this.showToast('Please enter a valid URL', 'error');
      return;
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch {
      this.showToast('Invalid URL format', 'error');
      return;
    }
    
    // Check if it's already an HLS stream
    if (url.endsWith('.m3u8')) {
      this.playDirectHLS(url);
      return;
    }
    
    // Show processing section
    this.showProcessingSection();
    this.resetProgress();
    this.setStepActive('analyze');
    
    try {
      // Start the streaming job
      const response = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start stream');
      }
      
      const data = await response.json();
      this.currentJob = data.jobId;
      
      // Connect to SSE for progress updates
      this.connectToProgress(data.jobId);
      
    } catch (error) {
      this.showToast(error.message, 'error');
      this.showInputSection();
    }
  }
  
  connectToProgress(jobId) {
    // Close existing connection
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.eventSource = new EventSource(`/api/stream/progress/${jobId}`);
    
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleProgressUpdate(data);
    };
    
    this.eventSource.onerror = () => {
      this.eventSource.close();
      // Poll for status if SSE fails
      this.pollJobStatus(jobId);
    };
  }
  
  async pollJobStatus(jobId) {
    try {
      const response = await fetch(`/api/stream/status/${jobId}`);
      const data = await response.json();
      this.handleProgressUpdate(data);
      
      if (data.status === 'processing' || data.status === 'downloading' || data.status === 'converting') {
        setTimeout(() => this.pollJobStatus(jobId), 1000);
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }
  
  handleProgressUpdate(data) {
    switch (data.status) {
      case 'analyzing':
        this.setStepActive('analyze');
        this.updateStepDesc('analyze', 'Fetching file information...');
        break;
        
      case 'analyzed':
        this.setStepCompleted('analyze');
        this.showFileInfo(data.fileInfo);
        break;
        
      case 'downloading':
        this.setStepCompleted('analyze');
        this.setStepActive('download');
        this.updateDownloadProgress(data.progress || 0, data.speed, data.eta);
        break;
        
      case 'downloaded':
        this.setStepCompleted('download');
        break;
        
      case 'converting':
        this.setStepCompleted('download');
        this.setStepActive('convert');
        this.updateConvertProgress(data.progress || 0);
        break;
        
      case 'ready':
        this.setStepCompleted('convert');
        this.setStepCompleted('ready');
        this.updateStepDesc('ready', 'Starting playback...');
        
        // Add to history
        this.addToHistory({
          url: data.originalUrl,
          name: data.fileName || 'Video',
          streamUrl: data.streamUrl,
          date: new Date().toISOString()
        });
        
        // Start playback
        setTimeout(() => {
          this.playStream(data.streamUrl, data);
        }, 500);
        break;
        
      case 'error':
        this.setStepError(data.step || 'analyze', data.message);
        this.showToast(data.message || 'An error occurred', 'error');
        break;
    }
  }
  
  playDirectHLS(url) {
    this.showPlayerSection();
    this.initPlayer(url);
    this.elements.videoTitle.textContent = this.getFileNameFromUrl(url);
  }
  
  playStream(streamUrl, info) {
    this.showPlayerSection();
    this.initPlayer(streamUrl);
    
    // Update UI
    this.elements.videoTitle.textContent = info.fileName || 'Video';
    
    if (info.fileInfo) {
      this.updateStreamInfo(info.fileInfo);
    }
  }
  
  initPlayer(src) {
    // Destroy existing player
    if (this.player) {
      this.player.destroy();
    }
    
    this.player = new HLSPlayer(this.elements.playerContainer, {
      src,
      autoplay: true,
      onReady: (data) => {
        if (data.audioTracks) {
          this.elements.infoAudioTracks.textContent = data.audioTracks.length;
        }
      },
      onTimeUpdate: ({ duration }) => {
        if (duration && !isNaN(duration)) {
          this.elements.infoDuration.textContent = this.formatDuration(duration);
        }
      },
      onError: (error) => {
        console.error('Player error:', error);
        this.showToast('Playback error occurred', 'error');
      }
    });
  }
  
  async cancelJob() {
    if (this.currentJob) {
      try {
        await fetch(`/api/stream/cancel/${this.currentJob}`, { method: 'POST' });
      } catch (e) {
        console.error('Cancel error:', e);
      }
    }
    
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.showInputSection();
  }
  
  // =========================================================================
  // UI Updates
  // =========================================================================
  
  showInputSection() {
    this.elements.inputSection.classList.remove('hidden');
    this.elements.processingSection.classList.add('hidden');
    this.elements.playerSection.classList.add('hidden');
    this.elements.urlInput.value = '';
    this.elements.urlInput.focus();
    
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }
  
  showProcessingSection() {
    this.elements.inputSection.classList.add('hidden');
    this.elements.processingSection.classList.remove('hidden');
    this.elements.playerSection.classList.add('hidden');
  }
  
  showPlayerSection() {
    this.elements.inputSection.classList.add('hidden');
    this.elements.processingSection.classList.add('hidden');
    this.elements.playerSection.classList.remove('hidden');
  }
  
  resetProgress() {
    // Reset all steps
    ['analyze', 'download', 'convert', 'ready'].forEach(step => {
      const el = document.getElementById(`step-${step}`);
      el.classList.remove('active', 'completed', 'error');
      el.querySelector('.step-spinner').classList.add('hidden');
      el.querySelector('.step-check').classList.add('hidden');
      el.querySelector('.step-icon').style.display = '';
    });
    
    // Reset progress bars
    this.elements.downloadProgress.style.width = '0%';
    this.elements.downloadText.textContent = '0%';
    this.elements.convertProgress.style.width = '0%';
    this.elements.convertText.textContent = '0%';
    
    // Hide progress sections
    document.querySelectorAll('.step-progress').forEach(el => el.classList.add('hidden'));
    
    // Hide file info
    this.elements.fileInfo.classList.add('hidden');
    
    // Reset descriptions
    this.updateStepDesc('analyze', 'Checking video source...');
    this.updateStepDesc('download', 'Waiting...');
    this.updateStepDesc('convert', 'Waiting...');
    this.updateStepDesc('ready', 'Waiting...');
  }
  
  setStepActive(step) {
    const el = document.getElementById(`step-${step}`);
    el.classList.add('active');
    el.classList.remove('completed', 'error');
  }
  
  setStepCompleted(step) {
    const el = document.getElementById(`step-${step}`);
    el.classList.remove('active');
    el.classList.add('completed');
  }
  
  setStepError(step, message) {
    const el = document.getElementById(`step-${step}`);
    el.classList.remove('active', 'completed');
    el.classList.add('error');
    this.updateStepDesc(step, message || 'Error occurred');
  }
  
  updateStepDesc(step, text) {
    const el = document.getElementById(`step-${step}`);
    el.querySelector('.step-desc').textContent = text;
  }
  
  showFileInfo(info) {
    if (!info) return;
    
    this.elements.fileName.textContent = info.name || 'Unknown';
    
    const meta = [];
    if (info.size) meta.push(this.formatBytes(info.size));
    if (info.duration) meta.push(this.formatDuration(info.duration));
    if (info.resolution) meta.push(info.resolution);
    
    this.elements.fileMeta.textContent = meta.join(' • ');
    this.elements.fileInfo.classList.remove('hidden');
  }
  
  updateDownloadProgress(percent, speed, eta) {
    const progressEl = this.elements.stepDownload.querySelector('.step-progress');
    progressEl.classList.remove('hidden');
    
    this.elements.downloadProgress.style.width = `${percent}%`;
    
    let text = `${percent.toFixed(1)}%`;
    if (speed) text += ` • ${speed}`;
    if (eta) text += ` • ${eta} remaining`;
    
    this.elements.downloadText.textContent = text;
    this.updateStepDesc('download', `Downloading... ${percent.toFixed(1)}%`);
  }
  
  updateConvertProgress(percent) {
    const progressEl = this.elements.stepConvert.querySelector('.step-progress');
    progressEl.classList.remove('hidden');
    
    this.elements.convertProgress.style.width = `${percent}%`;
    this.elements.convertText.textContent = `${percent.toFixed(1)}%`;
    this.updateStepDesc('convert', `Converting to HLS... ${percent.toFixed(1)}%`);
  }
  
  updateStreamInfo(info) {
    if (info.duration) {
      this.elements.infoDuration.textContent = this.formatDuration(info.duration);
    }
    if (info.resolution) {
      this.elements.infoResolution.textContent = info.resolution;
    }
    if (info.audioTracks) {
      this.elements.infoAudioTracks.textContent = info.audioTracks.length;
    }
  }
  
  // =========================================================================
  // History
  // =========================================================================
  
  loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('streamHistory') || '[]');
    } catch {
      return [];
    }
  }
  
  saveHistory() {
    localStorage.setItem('streamHistory', JSON.stringify(this.history));
  }
  
  addToHistory(item) {
    // Remove duplicate
    this.history = this.history.filter(h => h.url !== item.url);
    
    // Add to front
    this.history.unshift(item);
    
    // Keep only last 20
    this.history = this.history.slice(0, 20);
    
    this.saveHistory();
  }
  
  showHistory() {
    this.renderHistory();
    this.elements.historyModal.classList.remove('hidden');
  }
  
  hideHistory() {
    this.elements.historyModal.classList.add('hidden');
  }
  
  renderHistory() {
    if (this.history.length === 0) {
      this.elements.historyList.innerHTML = '<p class="empty-state">No history yet</p>';
      return;
    }
    
    this.elements.historyList.innerHTML = this.history.map((item, index) => `
      <div class="history-item" data-index="${index}">
        <div class="history-item-info">
          <div class="history-item-name">${this.escapeHtml(item.name)}</div>
          <div class="history-item-date">${this.formatDate(item.date)}</div>
        </div>
        <button class="history-item-delete" data-index="${index}" title="Remove">×</button>
      </div>
    `).join('');
    
    // Bind events
    this.elements.historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('history-item-delete')) {
          const index = parseInt(el.dataset.index);
          this.playFromHistory(index);
        }
      });
    });
    
    this.elements.historyList.querySelectorAll('.history-item-delete').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(el.dataset.index);
        this.removeFromHistory(index);
      });
    });
  }
  
  playFromHistory(index) {
    const item = this.history[index];
    if (!item) return;
    
    this.hideHistory();
    
    // Check if stream is still available
    if (item.streamUrl) {
      this.playDirectHLS(item.streamUrl);
    } else {
      this.elements.urlInput.value = item.url;
      this.startStream(item.url);
    }
  }
  
  removeFromHistory(index) {
    this.history.splice(index, 1);
    this.saveHistory();
    this.renderHistory();
  }
  
  clearAllHistory() {
    this.history = [];
    this.saveHistory();
    this.renderHistory();
  }
  
  // =========================================================================
  // Theme
  // =========================================================================
  
  loadTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }
  
  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }
  
  // =========================================================================
  // Utilities
  // =========================================================================
  
  copyStreamLink() {
    if (this.player && this.player.config.src) {
      const fullUrl = new URL(this.player.config.src, window.location.origin).href;
      navigator.clipboard.writeText(fullUrl).then(() => {
        this.showToast('Stream link copied!', 'success');
      }).catch(() => {
        this.showToast('Failed to copy link', 'error');
      });
    }
  }
  
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-message">${this.escapeHtml(message)}</span>`;
    
    this.elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  
  formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  }
  
  getFileNameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop();
      return decodeURIComponent(filename) || 'Video';
    } catch {
      return 'Video';
    }
  }
  
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    
    if (url) {
      this.elements.urlInput.value = url;
      this.startStream(url);
      
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  window.app = new StreamApp();
});
