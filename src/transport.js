import http from 'node:http';
import https from 'node:https';
import { Fault } from './fault.js';

// One attempt, no proxy environment, redirects, implicit credentials or retries.
// The deadline covers the entire request, including a slow/dripping response.
export function requestJson({ url, method = 'GET', headers = {}, body, timeoutMs = 3000, maxRequestBytes = 4096, maxResponseBytes = 65536, allowEmpty = false }) {
  return new Promise((resolve, reject) => {
    let request; let timer; let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) { request?.destroy(); reject(new Fault('device_request_failed')); }
      else resolve(value);
    };
    try {
      const endpoint = new URL(url);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash ||
          !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return finish(true);
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      if (![maxRequestBytes, maxResponseBytes].every(v => Number.isInteger(v) && v > 0 && v <= 2097152)) return finish(true);
      if (data && data.length > maxRequestBytes) return finish(true);
      request = (endpoint.protocol === 'https:' ? https : http).request(endpoint, {
        method, agent: false, maxHeaderSize: 8192,
        headers: { ...headers, Accept: 'application/json', Connection: 'close',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
      }, response => {
        if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); return finish(true); }
        const chunks = []; let size = 0;
        response.on('error', () => finish(true));
        response.on('aborted', () => finish(true));
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxResponseBytes) { response.destroy(); return finish(true); }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (allowEmpty && response.statusCode === 204 && size === 0) return finish(false, null);
          try { finish(false, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(true); }
        });
      });
      request.on('error', () => finish(true));
      timer = setTimeout(() => finish(true), timeoutMs);
      request.end(data);
    } catch { finish(true); }
  });
}
