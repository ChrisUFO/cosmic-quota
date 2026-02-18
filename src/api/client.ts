import * as https from 'https';
import { QuotaData } from './types';

export class QuotaClient {
  constructor(private apiKey: string) {}

  public async fetchQuotaData(): Promise<QuotaData> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.synthetic.new',
        path: '/v2/quotas',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'VSCode-Synthetic-Quota-Extension/0.2.5'
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              if (!this.isValidQuotaData(parsed)) {
                reject(new Error('Invalid API response structure'));
                return;
              }
              resolve(parsed);
            } catch {
              reject(new Error('Failed to parse API response'));
            }
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid API key'));
          } else if (res.statusCode === 429) {
            reject(new Error('Rate limited. Please try again later'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  private isValidQuotaData(data: unknown): data is QuotaData {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const d = data as Record<string, unknown>;

    // Check subscription
    if (!d.subscription || typeof d.subscription !== 'object') {
      return false;
    }
    const sub = d.subscription as Record<string, unknown>;
    if (
      typeof sub.limit !== 'number' ||
      typeof sub.requests !== 'number' ||
      typeof sub.renewsAt !== 'string'
    ) {
      return false;
    }

    // Check freeToolCalls
    if (!d.freeToolCalls || typeof d.freeToolCalls !== 'object') {
      return false;
    }
    const tool = d.freeToolCalls as Record<string, unknown>;
    if (
      typeof tool.limit !== 'number' ||
      typeof tool.requests !== 'number' ||
      typeof tool.renewsAt !== 'string'
    ) {
      return false;
    }

    // Check search
    if (!d.search || typeof d.search !== 'object') {
      return false;
    }
    const search = d.search as Record<string, unknown>;
    if (!search.hourly || typeof search.hourly !== 'object') {
      return false;
    }
    const hourly = search.hourly as Record<string, unknown>;
    if (
      typeof hourly.limit !== 'number' ||
      typeof hourly.requests !== 'number' ||
      typeof hourly.renewsAt !== 'string'
    ) {
      return false;
    }

    return true;
  }
}
