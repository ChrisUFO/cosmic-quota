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
        // Mock timestamps by manually manipulating history if needed, 
        // but let's try a small delay first.
        engine.updateHistory({ ...mockData, subscription: { ...mockData.subscription, requests: 520 } });
        await new Promise(r => setTimeout(r, 10)); // Ensure different timestamp
        engine.updateHistory({ ...mockData, subscription: { ...mockData.subscription, requests: 550 } });
        await new Promise(r => setTimeout(r, 10));
        engine.updateHistory({ ...mockData, subscription: { ...mockData.subscription, requests: 600 } });

        const analytics = engine.getAnalytics({ ...mockData, subscription: { ...mockData.subscription, requests: 600 } });
        expect(analytics.trend).toBe('up');
    });
});
