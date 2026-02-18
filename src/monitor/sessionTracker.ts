import { QuotaData, SessionTracker, QuotaAnalytics } from '../api/types';

const MS_PER_HOUR = 3600000;

export class AnalyticsEngine {
  private sessionTracker: SessionTracker | null = null;

  public initialize(data: QuotaData, trackSession: boolean) {
    if (!trackSession) {
      this.sessionTracker = null;
      return;
    }

    const now = Date.now();
    const subscriptionPercent = data.subscription.requests / data.subscription.limit;
    const toolCallsPercent = data.freeToolCalls.requests / data.freeToolCalls.limit;
    const searchPercent = data.search.hourly.requests / data.search.hourly.limit;

    this.sessionTracker = {
      sessionStartTime: now,
      initialSubscriptionQuota: subscriptionPercent,
      initialToolCallsQuota: toolCallsPercent,
      initialSearchQuota: searchPercent,
      history: [{ timestamp: now, subscriptionUsed: subscriptionPercent }]
    };
  }

  public updateHistory(data: QuotaData) {
    if (!this.sessionTracker) {
      return;
    }

    const now = Date.now();
    const subscriptionPercent = data.subscription.requests / data.subscription.limit;

    this.sessionTracker.history.push({ timestamp: now, subscriptionUsed: subscriptionPercent });
    if (this.sessionTracker.history.length > 10) {
      this.sessionTracker.history.shift();
    }
  }

  public getAnalytics(data: QuotaData, nowOverride?: number): QuotaAnalytics {
    const now = nowOverride || Date.now();
    const subscription = data.subscription;
    const usedPercent = (subscription.requests / subscription.limit) * 100;
    const remainingPercent = 100 - usedPercent;

    const resetTime = new Date(subscription.renewsAt).getTime();
    const timeUntilReset = Math.max(0, resetTime - now);
    const hoursUntilReset = timeUntilReset / MS_PER_HOUR;

    // Synthetic API has a 5-hour reset cycle
    const cycleHours = 5;
    const hoursElapsedInCycle = Math.max(0, cycleHours - hoursUntilReset);

    // Calculate global burn rate (historical daily average baseline)
    let globalBurnRatePerHour = 0;
    if (hoursElapsedInCycle > 0.1) {
      globalBurnRatePerHour = usedPercent / hoursElapsedInCycle;
    }

    // Calculate session burn rate for trend analysis and hybrid prediction
    let sessionBurnRatePerHour = 0;
    let trend: 'up' | 'down' | 'stable' = 'stable';
    let isSessionReliable = false;

    if (this.sessionTracker && this.sessionTracker.history.length >= 2) {
      const history = this.sessionTracker.history;
      const first = history[0];
      const last = history[history.length - 1];
      const sessionHoursElapsed = (last.timestamp - first.timestamp) / MS_PER_HOUR;

      if (sessionHoursElapsed > 0.05) {
        // Minimum 3 minutes to be considered reliable
        isSessionReliable = true;
        const usageChange = (last.subscriptionUsed - first.subscriptionUsed) * 100;
        sessionBurnRatePerHour = Math.max(0, usageChange / sessionHoursElapsed);

        if (history.length >= 3) {
          const recent = history.slice(-3);
          const recentChange = (recent[2].subscriptionUsed - recent[0].subscriptionUsed) * 100;
          // Only show up/down if change is significant (>0.1%)
          if (recentChange > 0.1) {
            trend = 'up';
          } else if (recentChange < -0.1) {
            trend = 'down';
          } else {
            trend = 'stable';
          }
        }
      }
    }

    // Hybrid Prediction Logic:
    // We blend the Global Rate (long-term baseline) with the Session Rate (immediate impact).
    // If the session is active and reliable, we weigh it into the prediction.
    let effectiveBurnRate = globalBurnRatePerHour;

    if (isSessionReliable) {
      // Weighted Average: 70% Global (Stability), 30% Session (Responsiveness)
      // This prevents wild swings from short bursts while still reacting to high-usage sessions.
      effectiveBurnRate = globalBurnRatePerHour * 0.7 + sessionBurnRatePerHour * 0.3;
    }

    const burnRatePerHour = effectiveBurnRate;

    // Calculate hours until depletion (only if it happens before reset)
    let hoursUntilDepletion: number | null = null;
    if (burnRatePerHour > 1 && remainingPercent > 0 && hoursUntilReset > 0) {
      const calculatedDepletion = remainingPercent / burnRatePerHour;
      // Only show depletion if it happens before the quota resets
      if (calculatedDepletion < hoursUntilReset) {
        hoursUntilDepletion = calculatedDepletion;
      }
    }
    // FORECAST: Predicted Total Usage at Reset
    let projectedUsageAtReset: number | null = null;
    if (hoursUntilReset > 0) {
      const remainingUsageForecast = burnRatePerHour * hoursUntilReset;
      projectedUsageAtReset = Math.min(100, Math.round(usedPercent + remainingUsageForecast));
    }

    // Map history to simple objects for the graph
    const sessionHistory = this.sessionTracker
      ? this.sessionTracker.history.map((h) => ({
          timestamp: h.timestamp,
          usage: Math.round(h.subscriptionUsed * 100)
        }))
      : [];

    return {
      burnRatePerHour,
      hoursUntilDepletion,
      trend,
      projectedUsageAtReset,
      sessionHistory
    };
  }

  public getSessionUsage(data: QuotaData): {
    subscription: number;
    toolCalls: number;
    search: number;
  } {
    if (!this.sessionTracker) {
      return { subscription: 0, toolCalls: 0, search: 0 };
    }

    const currentSubPercent = data.subscription.requests / data.subscription.limit;
    const currentToolPercent = data.freeToolCalls.requests / data.freeToolCalls.limit;
    const currentSearchPercent = data.search.hourly.requests / data.search.hourly.limit;

    return {
      subscription: Math.round(
        (currentSubPercent - this.sessionTracker.initialSubscriptionQuota) * 100
      ),
      toolCalls: Math.round((currentToolPercent - this.sessionTracker.initialToolCallsQuota) * 100),
      search: Math.round((currentSearchPercent - this.sessionTracker.initialSearchQuota) * 100)
    };
  }
}
