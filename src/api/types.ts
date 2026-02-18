export interface QuotaData {
  subscription: {
    limit: number;
    requests: number;
    renewsAt: string;
  };
  search: {
    hourly: {
      limit: number;
      requests: number;
      renewsAt: string;
    };
  };
  freeToolCalls: {
    limit: number;
    requests: number;
    renewsAt: string;
  };
}

export interface QuotaDisplayConfig {
  icon: string;
  color: string;
  description: string;
}

export type StatusBarDisplayMode = 'subscription' | 'toolCalls' | 'search' | 'all' | 'average';
export type TimeDisplayMode = 'relative' | 'absolute' | 'both';
export type CompactAnalyticsMode = 'trend' | 'depletion' | 'burn' | 'auto' | 'off';

export interface SessionTracker {
  sessionStartTime: number;
  initialSubscriptionQuota: number;
  initialToolCallsQuota: number;
  initialSearchQuota: number;
  history: Array<{ timestamp: number; subscriptionUsed: number }>;
}

export interface QuotaAnalytics {
  burnRatePerHour: number;
  hoursUntilDepletion: number | null;
  trend: 'up' | 'down' | 'stable';
  projectedUsageAtReset: number | null;
  sessionHistory: Array<{ timestamp: number; usage: number }>;
}
