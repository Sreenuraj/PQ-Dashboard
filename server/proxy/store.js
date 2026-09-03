/**
 * Network Request Store — In-memory circular buffer
 * Stores captured proxy requests with FIFO eviction.
 */

class NetworkStore {
  constructor(maxSize = 2000) {
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

    if (filters.agent && filters.agent !== 'all') {
      const q = filters.agent.toLowerCase();
      if (q === 'subagent' || q === 'subagents') {
        results = results.filter(r => (r.agentLabel || '').toLowerCase().includes('subagent'));
      } else if (q.startsWith('subagent-')) {
        const num = q.split('-')[1];
        results = results.filter(r => (r.agentLabel || '').toLowerCase() === `subagent ${num}` || r.subagentIndex === parseInt(num, 10));
      } else {
        results = results.filter(r => (r.agentLabel || '').toLowerCase().includes(q));
      }
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
        (r.method || '').toLowerCase().includes(q) ||
        (r.agentLabel || '').toLowerCase().includes(q)
      );
    }

    // Return newest first
    results.reverse();

    const total = results.length;
    const offset = parseInt(filters.offset) || 0;
    const limit = parseInt(filters.limit) || 100;
    const sliced = results.slice(offset, offset + limit);

    // If full detail is not explicitly requested, strip massive bodies for table listing performance
    const maxInlineBodyLen = 8192; // 8KB
    const lightweight = sliced.map(r => {
      const reqBodyTooLarge = r.requestBody && r.requestBody.length > maxInlineBodyLen;
      const resBodyTooLarge = r.responseBody && r.responseBody.length > maxInlineBodyLen;

      if (!reqBodyTooLarge && !resBodyTooLarge) return r;

      return {
        ...r,
        requestBody: reqBodyTooLarge ? r.requestBody.slice(0, 1024) + '... [click row to load full]' : r.requestBody,
        responseBody: resBodyTooLarge ? r.responseBody.slice(0, 1024) + '... [click row to load full]' : r.responseBody,
        isTruncatedSummary: true,
        fullRequestBodySize: r.requestBody ? r.requestBody.length : 0,
        fullResponseBodySize: r.responseBody ? r.responseBody.length : (r.size || 0)
      };
    });

    return { requests: lightweight, total, offset, limit, serverTotal: this.requests.length };
  }

  /**
   * Get a single request by ID.
   */
  getById(id) {
    return this.requests.find(r => r.id === parseInt(id)) || null;
  }

  /**
   * Update properties on a stored request record by ID.
   */
  update(id, partial) {
    const r = this.requests.find(req => req.id === parseInt(id));
    if (r) {
      Object.assign(r, partial);
      return r;
    }
    return null;
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
