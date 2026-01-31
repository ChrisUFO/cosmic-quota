import { QuotaClient } from '../api/client';
import { AnalyticsEngine } from '../monitor/sessionTracker';
import { QuotaData, QuotaAnalytics } from '../api/types';

export class QuotaService {
  private client: QuotaClient | null = null;
  private analytics: AnalyticsEngine;

  constructor() {
    this.analytics = new AnalyticsEngine();
  }

  public setApiKey(apiKey: string) {
    this.client = new QuotaClient(apiKey);
  }

  public async refreshQuota(): Promise<QuotaData> {
    if (!this.client) {
      throw new Error('API Key not set');
    }
    const data = await this.client.fetchQuotaData();
    this.analytics.updateHistory(data);
    return data;
  }

  public initializeSession(data: QuotaData, trackSession: boolean) {
    this.analytics.initialize(data, trackSession);
  }

  public getAnalytics(data: QuotaData): QuotaAnalytics {
    return this.analytics.getAnalytics(data);
  }

  public getSessionUsage(data: QuotaData) {
    return this.analytics.getSessionUsage(data);
  }
}
