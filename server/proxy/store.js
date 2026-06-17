/**
 * Network Request Store — In-memory circular buffer
 * Stores captured proxy requests with FIFO eviction.
 */

class NetworkStore {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.requests = [];
    this.idCounter = 0;
  }

  /**
   * Add a captured request record to the store.
   * Returns the assigned ID.
   */
  add(record) {
    this.idCounter++;
    record.id = this.idCounter;
    this.requests.push(record);

    // FIFO eviction
    if (this.requests.length > this.maxSize) {
      this.requests.shift();
    }
    return record.id;
  }

  /**
   * Get all requests, optionally filtered.
   * @param {Object} filters - { host, method, status, search, limit, offset }
   */
  getAll(filters = {}) {
    let results = [...this.requests];

    if (filters.host && filters.host !== 'all') {
      results = results.filter(r => (r.tag || '').toLowerCase() === filters.host.toLowerCase()
        || (r.host || '').toLowerCase().includes(filters.host.toLowerCase()));
    }

    if (filters.method) {
      const methods = filters.method.split(',').map(m => m.trim().toUpperCase());
      results = results.filter(r => methods.includes((r.method || '').toUpperCase()));
    }

    if (filters.status) {
      const statusRange = filters.status; // e.g. "2xx", "4xx", "5xx"
      if (/^\d/.test(statusRange)) {
        const prefix = statusRange.charAt(0);
        results = results.filter(r => String(r.statusCode || '').charAt(0) === prefix);
      }
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(r =>
        (r.url || '').toLowerCase().includes(q) ||
        (r.host || '').toLowerCase().includes(q) ||
        (r.method || '').toLowerCase().includes(q)
      );
    }

    // Return newest first
    results.reverse();

    const total = results.length;
    const offset = parseInt(filters.offset) || 0;
    const limit = parseInt(filters.limit) || 100;
    results = results.slice(offset, offset + limit);

    return { requests: results, total, offset, limit };
  }

  /**
   * Get a single request by ID.
   */
  getById(id) {
    return this.requests.find(r => r.id === parseInt(id)) || null;
  }

  /**
   * Clear all stored requests.
   */
  clear() {
    this.requests = [];
  }

  /**
   * Get store statistics.
   */
  stats() {
    return {
      count: this.requests.length,
      maxSize: this.maxSize,
      oldestId: this.requests[0]?.id || null,
      newestId: this.requests[this.requests.length - 1]?.id || null,
    };
  }
}

module.exports = { NetworkStore };
