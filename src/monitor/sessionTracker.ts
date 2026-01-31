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
    const toolCallsPercent = data.toolCallDiscounts.requests / data.toolCallDiscounts.limit;
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

  public getAnalytics(data: QuotaData): QuotaAnalytics {
    const now = Date.now();
    const subscription = data.subscription;
    const usedPercent = (subscription.requests / subscription.limit) * 100;
    const remainingPercent = 100 - usedPercent;

    const resetTime = new Date(subscription.renewsAt).getTime();
    const timeUntilReset = Math.max(0, resetTime - now);
    const hoursUntilReset = timeUntilReset / MS_PER_HOUR;

    // Synthetic API has a 5-hour reset cycle
    const cycleHours = 5;
    const hoursElapsedInCycle = Math.max(0, cycleHours - hoursUntilReset);

    // Calculate average burn rate since cycle start
    let averageBurnRatePerHour = 0;
    if (hoursElapsedInCycle > 0.1) {
      averageBurnRatePerHour = usedPercent / hoursElapsedInCycle;
    }

    // Calculate session burn rate for trend analysis
    let sessionBurnRatePerHour = 0;
    let trend: 'up' | 'down' | 'stable' = 'stable';

    if (this.sessionTracker && this.sessionTracker.history.length >= 2) {
      const history = this.sessionTracker.history;
      const first = history[0];
      const last = history[history.length - 1];
      const sessionHoursElapsed = (last.timestamp - first.timestamp) / MS_PER_HOUR;

      if (sessionHoursElapsed > 0) {
        const usageChange = (last.subscriptionUsed - first.subscriptionUsed) * 100;
        sessionBurnRatePerHour = usageChange / sessionHoursElapsed;

        if (history.length >= 3) {
          const recent = history.slice(-3);
          const avgChange = ((recent[2].subscriptionUsed - recent[0].subscriptionUsed) * 100) / 2;
          if (avgChange > 1) {
            trend = 'up';
          } else if (avgChange < -1) {
            trend = 'down';
          }
        }
      }
    }

    // Use session burn rate if available and reliable, otherwise fall back to cycle average
    const burnRatePerHour =
      sessionBurnRatePerHour !== 0 ? sessionBurnRatePerHour : averageBurnRatePerHour;

    // Calculate hours until depletion (only if it happens before reset)
    let hoursUntilDepletion: number | null = null;
    if (burnRatePerHour > 0 && remainingPercent > 0 && hoursUntilReset > 0) {
      const calculatedDepletion = remainingPercent / burnRatePerHour;
      // Only show depletion if it happens before the quota resets
      if (calculatedDepletion < hoursUntilReset) {
        hoursUntilDepletion = calculatedDepletion;
      }
    }

    // Project remaining at reset using cycle average rate
    let projectedRemainingAtReset: number | null = null;
    if (hoursUntilReset > 0 && averageBurnRatePerHour > 0) {
      const projectedTotalUsage = averageBurnRatePerHour * cycleHours;
      projectedRemainingAtReset = Math.max(0, 100 - projectedTotalUsage);
    }

    return { burnRatePerHour, hoursUntilDepletion, trend, projectedRemainingAtReset };
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
    const currentToolPercent = data.toolCallDiscounts.requests / data.toolCallDiscounts.limit;
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
