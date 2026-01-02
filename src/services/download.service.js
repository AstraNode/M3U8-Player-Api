const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

class DownloadService {
  constructor() {
    this.activeDownloads = new Map();
  }

  /**
   * Analyze URL to get file info without downloading
   */
  async analyze(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        method: 'HEAD',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const req = protocol.request(url, options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.analyze(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: Failed to access file`));
          return;
        }

        const contentLength = parseInt(res.headers['content-length'], 10);
        const contentType = res.headers['content-type'];
        const contentDisposition = res.headers['content-disposition'];

        let fileName = path.basename(parsedUrl.pathname) || 'video';

        // Try to get filename from content-disposition
        if (contentDisposition) {
          const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (match && match[1]) {
            fileName = match[1].replace(/['"]/g, '');
          }
        }

        resolve({
          name: fileName,
          size: contentLength || null,
          contentType: contentType || null,
          url: url
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Failed to analyze URL: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Download file from URL
   */
  async download(url, outputPath, onProgress) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      // Ensure directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const options = {
        timeout: 0, // No timeout for downloads
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const req = protocol.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.download(res.headers.location, outputPath, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: Download failed`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedSize = 0;
        let startTime = Date.now();
        let lastProgressTime = Date.now();
        let lastDownloadedSize = 0;

        const file = fs.createWriteStream(outputPath);

        res.on('data', (chunk) => {
          downloadedSize += chunk.length;

          const now = Date.now();
          const timeDiff = now - lastProgressTime;

          // Update progress every 500ms
          if (timeDiff >= 500) {
            const bytesPerSecond = ((downloadedSize - lastDownloadedSize) / timeDiff) * 1000;
            const remainingBytes = totalSize - downloadedSize;
            const etaSeconds = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;

            onProgress({
              percent: totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0,
              downloaded: downloadedSize,
              total: totalSize,
              speed: this.formatSpeed(bytesPerSecond),
              eta: this.formatEta(etaSeconds)
            });

            lastProgressTime = now;
            lastDownloadedSize = downloadedSize;
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close();

          // Final progress update
          onProgress({
            percent: 100,
            downloaded: downloadedSize,
            total: totalSize,
            speed: '0 B/s',
            eta: 'Complete'
          });

          resolve({
            path: outputPath,
            size: downloadedSize
          });
        });

        file.on('error', (err) => {
          fs.unlink(outputPath, () => {});
          reject(err);
        });
      });

      req.on('error', (error) => {
        fs.unlink(outputPath, () => {});
        reject(new Error(`Download failed: ${error.message}`));
      });

      // Store reference to cancel if needed
      this.activeDownloads.set(outputPath, req);
    });
  }

  /**
   * Cancel active download
   */
  cancel(outputPath) {
    const req = this.activeDownloads.get(outputPath);
    if (req) {
      req.destroy();
      this.activeDownloads.delete(outputPath);
      fs.unlink(outputPath, () => {});
      return true;
    }
    return false;
  }

  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatEta(seconds) {
    if (!seconds || seconds === Infinity) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  }
}

module.exports = new DownloadService();
