const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.subscribers = new Map();
    this.cleanupInterval = null;

    // Start cleanup timer
    this.startCleanup();
  }

  /**
   * Create a new job
   */
  createJob(url) {
    const id = uuidv4();
    const job = {
      id,
      url,
      status: 'created',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Get job by ID
   */
  getJob(id) {
    return this.jobs.get(id) || null;
  }

  /**
   * Update job status
   */
  updateJob(id, updates) {
    const job = this.jobs.get(id);
    if (!job) return null;

    Object.assign(job, updates, { updatedAt: new Date() });
    this.jobs.set(id, job);

    // Notify subscribers
    this.notifySubscribers(id, job);

    return job;
  }

  /**
   * Cancel a job
   */
  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job) return false;

    job.status = 'cancelled';
    job.updatedAt = new Date();
    this.notifySubscribers(id, job);

    return true;
  }

  /**
   * Check if job is cancelled
   */
  isCancelled(id) {
    const job = this.jobs.get(id);
    return job?.status === 'cancelled';
  }

  /**
   * Subscribe to job updates
   */
  subscribe(id, callback) {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id).add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(id);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(id);
        }
      }
    };
  }

  /**
   * Notify all subscribers of a job
   */
  notifySubscribers(id, data) {
    const subs = this.subscribers.get(id);
    if (subs) {
      subs.forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error('Subscriber error:', e);
        }
      });
    }
  }

  /**
   * Get all jobs (for admin/debugging)
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old jobs
   */
  startCleanup() {
    // Clean up every hour
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const [id, job] of this.jobs) {
        const age = now - new Date(job.createdAt);
        if (age > maxAge) {
          this.jobs.delete(id);
          this.subscribers.delete(id);
        }
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = new JobManager();
