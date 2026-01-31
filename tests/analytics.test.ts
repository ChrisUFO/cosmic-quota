import { AnalyticsEngine } from '../src/monitor/sessionTracker';
import { QuotaData } from '../src/api/types';

describe('AnalyticsEngine', () => {
    let engine: AnalyticsEngine;
    const mockData: QuotaData = {
        subscription: { limit: 1000, requests: 500, renewsAt: new Date(Date.now() + 3600000).toISOString() },
        search: { hourly: { limit: 100, requests: 20, renewsAt: new Date().toISOString() } },
        toolCallDiscounts: { limit: 500, requests: 100, renewsAt: new Date().toISOString() }
    };

    beforeEach(() => {
        engine = new AnalyticsEngine();
        engine.initialize(mockData, true);
    });

    test('should calculate correct session usage', () => {
        const newData: QuotaData = {
            ...mockData,
            subscription: { ...mockData.subscription, requests: 600 } // Used 10% more of the 1000 limit
        };

        const usage = engine.getSessionUsage(newData);
        expect(usage.subscription).toBe(10);
    });

    test('should determine trend correctly', async () => {
        const t0 = 1000000;
        // Anchor the session tracker
        engine['sessionTracker']! = {
            sessionStartTime: t0,
            initialSubscriptionQuota: 0.5,
            initialToolCallsQuota: 0.2,
            initialSearchQuota: 0.2,
            history: [
                { timestamp: t0, subscriptionUsed: 0.50 },
                { timestamp: t0 + 300000, subscriptionUsed: 0.52 },
                { timestamp: t0 + 600000, subscriptionUsed: 0.55 },
                { timestamp: t0 + 900000, subscriptionUsed: 0.60 }
            ]
        };

        const analytics = engine.getAnalytics(mockData, t0 + 900000);
        expect(analytics.trend).toBe('up');
    });

    test('should calculate forecasted usage at reset', () => {
        const now = 1000 * 60 * 60 * 4; // 4 hours since epoch
        const resetAt = new Date(1000 * 60 * 60 * 5).toISOString(); // 5 hours since epoch

        const data: QuotaData = {
            ...mockData,
            subscription: { ...mockData.subscription, requests: 500, limit: 1000, renewsAt: resetAt }
        };

        const analytics = engine.getAnalytics(data, now);
        // Used 50% in 4 hours = 12.5%/hr. 
        // 1 hour left. Forecast = 50 + 12.5 = 62.5 -> 63
        expect(analytics.projectedUsageAtReset).toBe(63);
    });
});
