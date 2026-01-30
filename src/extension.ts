import * as vscode from 'vscode';
import * as https from 'https';

interface QuotaData {
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
    toolCalls: {
        limit: number;
        requests: number;
        renewsAt: string;
    };
}

interface QuotaDisplayConfig {
    icon: string;
    color: string;
    description: string;
}

type StatusBarDisplayMode = 'subscription' | 'toolCalls' | 'search' | 'all' | 'average';
type TimeDisplayMode = 'relative' | 'absolute' | 'both';
type CompactAnalyticsMode = 'trend' | 'depletion' | 'burn' | 'auto' | 'off';

interface SessionTracker {
    sessionStartTime: number;
    initialSubscriptionQuota: number;
    initialToolCallsQuota: number;
    initialSearchQuota: number;
    history: Array<{ timestamp: number; subscriptionUsed: number }>;
}

interface QuotaAnalytics {
    burnRatePerHour: number;
    hoursUntilDepletion: number | null;
    trend: 'up' | 'down' | 'stable';
    projectedRemainingAtReset: number | null;
}

const CONFIG_NAMESPACE = 'syntheticQuota';
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

class QuotaMonitor {
    private statusBarItem: vscode.StatusBarItem;
    private refreshTimer?: NodeJS.Timeout;
    private quotaData: QuotaData | null = null;
    private lastFetchTime: Date | null = null;
    private isFetching = false;
    private fetchError: string | null = null;
    private sessionTracker: SessionTracker | null = null;
    private lowQuotaNotified = false;
    private zeroQuotaNotified = false;

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'syntheticQuota.showDetails';
        this.context.subscriptions.push(this.statusBarItem);

        vscode.workspace.onDidChangeConfiguration(
            this.onConfigurationChanged,
            this,
            this.context.subscriptions
        );

        this.initialize();
    }

    private async initialize(): Promise<void> {
        if (!this.getApiKey()) {
            this.showSetupState();
            return;
        }

        await this.refreshQuota();
        this.startAutoRefresh();
    }

    private getApiKey(): string {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<string>('apiKey', '').trim();
    }

    private getRefreshInterval(): number {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const seconds = config.get<number>('refreshInterval', 300);
        return Math.max(60, Math.min(3600, seconds)) * 1000;
    }

    private getStatusBarDisplayMode(): StatusBarDisplayMode {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<StatusBarDisplayMode>('statusBarDisplay', 'subscription');
    }

    private getTimeDisplayMode(): TimeDisplayMode {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<TimeDisplayMode>('resetTimeDisplay', 'relative');
    }

    private getColorThresholds(): { warning: number; critical: number } {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return {
            warning: config.get<number>('warningThreshold', 70),
            critical: config.get<number>('criticalThreshold', 90)
        };
    }

    private getLowQuotaThreshold(): number {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<number>('lowQuotaNotificationThreshold', 0);
    }

    private shouldShowCountdown(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<boolean>('statusBarCountdown', true);
    }

    private shouldTrackSession(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<boolean>('trackSessionUsage', true);
    }

    private getCompactAnalyticsMode(): CompactAnalyticsMode {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<CompactAnalyticsMode>('compactAnalytics', 'auto');
    }

    private shouldShowCompactAnalytics(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<boolean>('showCompactAnalytics', true);
    }

    private onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
        if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.apiKey`)) {
            if (this.getApiKey()) {
                this.refreshQuota();
                this.startAutoRefresh();
            } else {
                this.showSetupState();
                this.stopAutoRefresh();
            }
        }
        if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.refreshInterval`)) {
            this.startAutoRefresh();
        }
        if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.statusBarDisplay`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.statusBarCountdown`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.trackSessionUsage`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.showCompactAnalytics`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.compactAnalytics`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.resetTimeDisplay`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.warningThreshold`) ||
            e.affectsConfiguration(`${CONFIG_NAMESPACE}.criticalThreshold`)) {
            this.updateStatusBar();
        }
        if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.lowQuotaNotificationThreshold`)) {
            this.lowQuotaNotified = false;
            if (this.quotaData) {
                this.checkQuotaNotifications(this.quotaData);
            }
        }
    }

    private initializeSessionTracker(data: QuotaData): void {
        if (!this.shouldTrackSession()) {
            this.sessionTracker = null;
            return;
        }

        const now = Date.now();
        const subscriptionPercent = data.subscription.requests / data.subscription.limit;
        const toolCallsPercent = data.toolCalls.requests / data.toolCalls.limit;
        const searchPercent = data.search.hourly.requests / data.search.hourly.limit;

        this.sessionTracker = {
            sessionStartTime: now,
            initialSubscriptionQuota: subscriptionPercent,
            initialToolCallsQuota: toolCallsPercent,
            initialSearchQuota: searchPercent,
            history: [{ timestamp: now, subscriptionUsed: subscriptionPercent }]
        };
    }

    private updateSessionHistory(data: QuotaData): void {
        if (!this.sessionTracker) { return; }
        
        const now = Date.now();
        const subscriptionPercent = data.subscription.requests / data.subscription.limit;
        
        this.sessionTracker.history.push({ timestamp: now, subscriptionUsed: subscriptionPercent });
        if (this.sessionTracker.history.length > 10) {
            this.sessionTracker.history.shift();
        }
    }

    private getQuotaAnalytics(data: QuotaData): QuotaAnalytics {
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
                    if (avgChange > 1) { trend = 'up'; }
                    else if (avgChange < -1) { trend = 'down'; }
                }
            }
        }
        
        // Use session burn rate if available and reliable, otherwise fall back to cycle average
        let burnRatePerHour = sessionBurnRatePerHour !== 0 ? sessionBurnRatePerHour : averageBurnRatePerHour;
        
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

    private getSessionUsage(data: QuotaData): { subscription: number; toolCalls: number; search: number } {
        if (!this.sessionTracker) {
            return { subscription: 0, toolCalls: 0, search: 0 };
        }

        const currentSubPercent = data.subscription.requests / data.subscription.limit;
        const currentToolPercent = data.toolCalls.requests / data.toolCalls.limit;
        const currentSearchPercent = data.search.hourly.requests / data.search.hourly.limit;

        return {
            subscription: Math.round((this.sessionTracker.initialSubscriptionQuota - currentSubPercent) * 100),
            toolCalls: Math.round((this.sessionTracker.initialToolCallsQuota - currentToolPercent) * 100),
            search: Math.round((this.sessionTracker.initialSearchQuota - currentSearchPercent) * 100)
        };
    }

    private getTrendIcon(trend: 'up' | 'down' | 'stable'): string {
        switch (trend) {
            case 'up': return '📈';
            case 'down': return '📉';
            case 'stable': return '➡️';
        }
    }

    private formatCompactDepletion(hours: number): string {
        if (hours < 1) {
            return `${Math.round(hours * 60)}m`;
        } else if (hours < 24) {
            return `${Math.round(hours)}h`;
        } else {
            return `${Math.round(hours / 24)}d`;
        }
    }

    private getCompactAnalyticsText(analytics: QuotaAnalytics, usedPercent: number): string {
        const mode = this.getCompactAnalyticsMode();
        
        if (mode === 'off' || !this.shouldShowCompactAnalytics()) {
            return '';
        }

        if (mode === 'auto') {
            if (usedPercent >= 90 && analytics.hoursUntilDepletion !== null && analytics.hoursUntilDepletion < 24) {
                return ` • ${this.formatCompactDepletion(analytics.hoursUntilDepletion)} left`;
            }
            if (usedPercent >= 70 && analytics.trend !== 'stable') {
                return ` ${this.getTrendIcon(analytics.trend)}`;
            }
            if (usedPercent >= 50 && Math.abs(analytics.burnRatePerHour) > 3) {
                const direction = analytics.burnRatePerHour > 0 ? '🔥' : '💚';
                return ` ${direction}`;
            }
            return '';
        }

        if (mode === 'depletion' && analytics.hoursUntilDepletion !== null) {
            return ` • ${this.formatCompactDepletion(analytics.hoursUntilDepletion)} left`;
        }

        if (mode === 'trend') {
            return ` ${this.getTrendIcon(analytics.trend)}`;
        }

        if (mode === 'burn' && Math.abs(analytics.burnRatePerHour) > 0) {
            const direction = analytics.burnRatePerHour > 0 ? '🔥' : '💚';
            return ` ${direction} ${Math.abs(analytics.burnRatePerHour).toFixed(1)}%/h`;
        }

        return '';
    }

    private showSetupState(): void {
        this.statusBarItem.text = '$(warning) Synthetic: Set API Key';
        this.statusBarItem.tooltip = 'Click to set up your Synthetic API key';
        this.statusBarItem.color = '#FFA500';
        this.statusBarItem.show();
    }

    private startAutoRefresh(): void {
        this.stopAutoRefresh();
        const interval = this.getRefreshInterval();
        this.refreshTimer = setInterval(() => this.refreshQuota(), interval);
    }

    private stopAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    public async refreshQuota(): Promise<void> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            this.showSetupState();
            return;
        }

        if (this.isFetching) {
            return;
        }

        this.isFetching = true;
        this.updateStatusBarLoading();

        try {
            const data = await this.fetchQuotaData(apiKey);
            
            if (!this.sessionTracker) {
                this.initializeSessionTracker(data);
            }
            
            this.quotaData = data;
            this.lastFetchTime = new Date();
            this.fetchError = null;
            
            this.checkQuotaNotifications(data);
            this.updateStatusBar();
        } catch (error) {
            this.fetchError = error instanceof Error ? error.message : 'Unknown error';
            this.updateStatusBarError();
        } finally {
            this.isFetching = false;
        }
    }

    private checkQuotaNotifications(data: QuotaData): void {
        const threshold = this.getLowQuotaThreshold();
        if (threshold <= 0) {
            return;
        }

        const subscription = data.subscription;
        const usedPercent = (subscription.requests / subscription.limit) * 100;
        const remainingPercent = 100 - usedPercent;

        if (remainingPercent <= 0 && !this.zeroQuotaNotified) {
            vscode.window.showWarningMessage(
                'Synthetic Quota: Your subscription quota has been depleted.',
                'Dismiss'
            );
            this.zeroQuotaNotified = true;
        } else if (remainingPercent <= threshold && !this.lowQuotaNotified && remainingPercent > 0) {
            vscode.window.showWarningMessage(
                `Synthetic Quota: Your subscription quota is below ${threshold}%.`,
                'Dismiss'
            );
            this.lowQuotaNotified = true;
        }

        if (remainingPercent > threshold) {
            this.lowQuotaNotified = false;
        }
        if (remainingPercent > 0) {
            this.zeroQuotaNotified = false;
        }
    }

    private updateStatusBarLoading(): void {
        this.statusBarItem.text = '$(sync~spin) Synthetic...';
        this.statusBarItem.tooltip = 'Fetching quota data...';
        this.statusBarItem.color = undefined;
        this.statusBarItem.show();
    }

    private updateStatusBarError(): void {
        this.statusBarItem.text = '$(error) Synthetic';
        this.statusBarItem.tooltip = `Error: ${this.fetchError}\n\nClick to retry`;
        this.statusBarItem.color = '#FF4444';
        this.statusBarItem.show();
    }

    private getSubscriptionConfig(usedPercent: number): QuotaDisplayConfig {
        const thresholds = this.getColorThresholds();
        
        if (usedPercent >= thresholds.critical) {
            return { icon: '$(error)', color: '#FF4444', description: 'Critical' };
        } else if (usedPercent >= thresholds.warning) {
            return { icon: '$(warning)', color: '#FFA500', description: 'Warning' };
        } else if (usedPercent >= 50) {
            return { icon: '$(info)', color: '#FFD700', description: 'Moderate' };
        }
        return { icon: '$(check)', color: '#4EC9B0', description: 'Healthy' };
    }

    private formatTimeUntil(isoDate: string): string {
        const date = new Date(isoDate);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();

        if (diffMs <= 0) {
            return 'Soon';
        }

        const mode = this.getTimeDisplayMode();
        const relative = this.formatRelativeTime(diffMs);

        if (mode === 'relative') {
            return relative;
        }

        const absolute = date.toLocaleTimeString(undefined, { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });

        if (mode === 'absolute') {
            return `resets at ${absolute}`;
        }

        return `${relative} (${absolute})`;
    }

    private formatRelativeTime(diffMs: number): string {
        if (diffMs <= 0) {
            return 'Soon';
        }

        const days = Math.floor(diffMs / MS_PER_DAY);
        const hours = Math.floor((diffMs % MS_PER_DAY) / MS_PER_HOUR);
        const minutes = Math.floor((diffMs % MS_PER_HOUR) / MS_PER_MINUTE);

        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    private formatCountdown(isoDate: string): string {
        const date = new Date(isoDate);
        const now = new Date();
        const diffMs = Math.max(0, date.getTime() - now.getTime());
        return this.formatRelativeTime(diffMs);
    }

    private updateStatusBar(): void {
        if (!this.quotaData) {
            return;
        }

        this.updateSessionHistory(this.quotaData);

        const displayMode = this.getStatusBarDisplayMode();
        const sessionUsage = this.getSessionUsage(this.quotaData);
        const analytics = this.getQuotaAnalytics(this.quotaData);

        switch (displayMode) {
            case 'subscription':
                this.updateStatusBarForQuota('subscription', this.quotaData.subscription, sessionUsage.subscription, analytics);
                break;
            case 'toolCalls':
                this.updateStatusBarForQuota('toolCalls', this.quotaData.toolCalls, sessionUsage.toolCalls);
                break;
            case 'search':
                this.updateStatusBarForQuota('search', this.quotaData.search.hourly, sessionUsage.search);
                break;
            case 'all':
                this.updateStatusBarAll(analytics);
                break;
            case 'average':
                this.updateStatusBarAverage(sessionUsage, analytics);
                break;
            default:
                this.updateStatusBarForQuota('subscription', this.quotaData.subscription, sessionUsage.subscription, analytics);
        }
    }

    private updateStatusBarForQuota(
        name: string,
        quota: { limit: number; requests: number; renewsAt: string },
        sessionUsed: number,
        analytics?: QuotaAnalytics
    ): void {
        const usedPercent = (quota.requests / quota.limit) * 100;
        const remaining = quota.limit - quota.requests;
        const config = this.getSubscriptionConfig(usedPercent);

        let text = `${config.icon} ${usedPercent.toFixed(0)}%`;
        
        if (sessionUsed > 0) {
            text += ` (-${sessionUsed}%)`;
        }

        if (name === 'subscription' && analytics) {
            text += this.getCompactAnalyticsText(analytics, usedPercent);
        }

        if (usedPercent >= 100 && this.shouldShowCountdown()) {
            const countdown = this.formatCountdown(quota.renewsAt);
            text = `${config.icon} ~${countdown}`;
        }

        this.statusBarItem.text = text;
        this.statusBarItem.color = config.color;
        this.statusBarItem.tooltip = this.buildTooltip(name, quota, usedPercent, remaining, config.description, analytics);
        this.statusBarItem.show();
    }

    private updateStatusBarAll(analytics?: QuotaAnalytics): void {
        const sub = this.quotaData!.subscription;
        const tool = this.quotaData!.toolCalls;
        const search = this.quotaData!.search.hourly;

        const subPercent = (sub.requests / sub.limit) * 100;
        const toolPercent = (tool.requests / tool.limit) * 100;
        const searchPercent = (search.requests / search.limit) * 100;

        const sessionUsage = this.getSessionUsage(this.quotaData!);

        let text = `$(dashboard) S:${subPercent.toFixed(0)}% T:${toolPercent.toFixed(0)}% H:${searchPercent.toFixed(0)}%`;
        
        if (analytics && this.shouldShowCompactAnalytics()) {
            const mode = this.getCompactAnalyticsMode();
            if ((mode === 'trend' || mode === 'auto') && analytics.trend !== 'stable') {
                text += ` ${this.getTrendIcon(analytics.trend)}`;
            }
        }
        
        this.statusBarItem.text = text;
        this.statusBarItem.color = undefined;
        this.statusBarItem.tooltip = this.buildFullTooltip(analytics);
        this.statusBarItem.show();
    }

    private updateStatusBarAverage(sessionUsage: { subscription: number; toolCalls: number; search: number }, analytics?: QuotaAnalytics): void {
        const sub = this.quotaData!.subscription;
        const tool = this.quotaData!.toolCalls;
        const search = this.quotaData!.search.hourly;

        const subPercent = (sub.requests / sub.limit) * 100;
        const toolPercent = (tool.requests / tool.limit) * 100;
        const searchPercent = (search.requests / search.limit) * 100;

        const avgPercent = (subPercent + toolPercent + searchPercent) / 3;
        const config = this.getSubscriptionConfig(avgPercent);

        let text = `${config.icon} ${avgPercent.toFixed(0)}% avg`;
        
        const totalSession = sessionUsage.subscription + sessionUsage.toolCalls + sessionUsage.search;
        if (totalSession > 0) {
            const avgSession = Math.round(totalSession / 3);
            text += ` (-${avgSession}%)`;
        }

        if (analytics && this.shouldShowCompactAnalytics()) {
            const mode = this.getCompactAnalyticsMode();
            if ((mode === 'trend' || mode === 'auto') && analytics.trend !== 'stable') {
                text += ` ${this.getTrendIcon(analytics.trend)}`;
            }
        }

        this.statusBarItem.text = text;
        this.statusBarItem.color = config.color;
        this.statusBarItem.tooltip = this.buildFullTooltip(analytics);
        this.statusBarItem.show();
    }

    private buildTooltip(
        name: string,
        quota: { limit: number; requests: number; renewsAt: string },
        usedPercent: number,
        remaining: number,
        status: string,
        analytics?: QuotaAnalytics
    ): vscode.MarkdownString {
        const displayName = name === 'subscription' ? 'Subscription' : 
                           name === 'toolCalls' ? 'Tool Calls' : 'Search (Hourly)';
        const renewsIn = this.formatTimeUntil(quota.renewsAt);
        
        let analyticsSection = '';
        if (name === 'subscription' && analytics) {
            const trendIcon = this.getTrendIcon(analytics.trend);
            
            analyticsSection = `
### 📊 Session Analytics
- **Trend:** ${trendIcon} ${analytics.trend}`;
            
            if (Math.abs(analytics.burnRatePerHour) > 0.01) {
                const burnEmoji = analytics.burnRatePerHour > 0 ? '🔥' : '💚';
                analyticsSection += `\n- **Burn Rate:** ${burnEmoji} ${Math.abs(analytics.burnRatePerHour).toFixed(2)}%/hour`;
            }
            
            if (analytics.hoursUntilDepletion !== null && analytics.hoursUntilDepletion < 48 && analytics.hoursUntilDepletion > 0) {
                const depletionText = analytics.hoursUntilDepletion < 1 
                    ? `${Math.round(analytics.hoursUntilDepletion * 60)} minutes`
                    : `${analytics.hoursUntilDepletion.toFixed(1)} hours`;
                const warningEmoji = analytics.hoursUntilDepletion < 6 ? '⚠️' : '⏰';
                analyticsSection += `\n- **${warningEmoji} Depletes in:** ${depletionText}`;
            }
            
            if (analytics.projectedRemainingAtReset !== null) {
                const projectedText = analytics.projectedRemainingAtReset < 10 
                    ? `${analytics.projectedRemainingAtReset.toFixed(1)}% (low!)`
                    : `${analytics.projectedRemainingAtReset.toFixed(1)}%`;
                analyticsSection += `\n- **📈 Projected remaining at reset:** ${projectedText}`;
            }
            
            analyticsSection += '\n';
        }
        
        return new vscode.MarkdownString(`
## ${displayName}

- **Used:** ${quota.requests.toFixed(1)} / ${quota.limit} (${usedPercent.toFixed(1)}%)
- **Remaining:** ${remaining.toFixed(1)}
- **Status:** ${status}
- **Resets:** ${renewsIn}${analyticsSection}

*Click for detailed view*
        `);
    }

    private buildFullTooltip(analytics?: QuotaAnalytics): vscode.MarkdownString {
        const sub = this.quotaData!.subscription;
        const tool = this.quotaData!.toolCalls;
        const search = this.quotaData!.search.hourly;

        let analyticsSection = '';
        if (analytics) {
            const trendIcon = this.getTrendIcon(analytics.trend);
            
            analyticsSection = `

### 📊 Session Analytics
- **Trend:** ${trendIcon} ${analytics.trend}`;
            
            if (Math.abs(analytics.burnRatePerHour) > 0.01) {
                const burnEmoji = analytics.burnRatePerHour > 0 ? '🔥' : '💚';
                const burnText = analytics.burnRatePerHour > 0 ? 'consuming' : 'recovering';
                analyticsSection += `\n- **Burn Rate:** ${burnEmoji} ${Math.abs(analytics.burnRatePerHour).toFixed(2)}%/hour (${burnText})`;
            }
            
            if (analytics.hoursUntilDepletion !== null && analytics.hoursUntilDepletion > 0 && analytics.hoursUntilDepletion < 48) {
                const depletionText = analytics.hoursUntilDepletion < 1 
                    ? `${Math.round(analytics.hoursUntilDepletion * 60)}m`
                    : `${analytics.hoursUntilDepletion.toFixed(1)}h`;
                const warningEmoji = analytics.hoursUntilDepletion < 6 ? '⚠️' : '⏰';
                analyticsSection += `\n- **${warningEmoji} Depletes in:** ${depletionText}`;
            }
            
            if (analytics.projectedRemainingAtReset !== null) {
                const projectedText = analytics.projectedRemainingAtReset < 10 
                    ? `${analytics.projectedRemainingAtReset.toFixed(1)}% (low!)`
                    : `${analytics.projectedRemainingAtReset.toFixed(1)}%`;
                analyticsSection += `\n- **📈 Projected at reset:** ${projectedText}`;
            }
        }

        return new vscode.MarkdownString(`
## 👽 Cosmic Quota

### 📦 Subscription
- Used: ${sub.requests.toFixed(1)} / ${sub.limit} (${((sub.requests/sub.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(sub.renewsAt)}

### 🔧 Tool Calls
- Used: ${tool.requests} / ${tool.limit} (${((tool.requests/tool.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(tool.renewsAt)}

### 🔍 Search (Hourly)
- Used: ${search.requests} / ${search.limit} (${((search.requests/search.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(search.renewsAt)}${analyticsSection}

*Click for detailed view*
        `);
    }

    private async fetchQuotaData(apiKey: string): Promise<QuotaData> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.synthetic.new',
                path: '/v2/quotas',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'VSCode-Synthetic-Quota-Extension/0.2.0'
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
                            
                            // Validate the response structure
                            if (!this.isValidQuotaData(parsed)) {
                                reject(new Error('Invalid API response structure'));
                                return;
                            }
                            
                            resolve(parsed);
                        } catch (e) {
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
        if (typeof sub.limit !== 'number' || typeof sub.requests !== 'number' || typeof sub.renewsAt !== 'string') {
            return false;
        }

        // Check toolCalls
        if (!d.toolCalls || typeof d.toolCalls !== 'object') {
            return false;
        }
        const tool = d.toolCalls as Record<string, unknown>;
        if (typeof tool.limit !== 'number' || typeof tool.requests !== 'number' || typeof tool.renewsAt !== 'string') {
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
        if (typeof hourly.limit !== 'number' || typeof hourly.requests !== 'number' || typeof hourly.renewsAt !== 'string') {
            return false;
        }

        return true;
    }

    public async showDetails(): Promise<void> {
        if (!this.getApiKey()) {
            const result = await vscode.window.showWarningMessage(
                'Synthetic API key not configured. Would you like to set it now?',
                'Set API Key',
                'Cancel'
            );
            if (result === 'Set API Key') {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'syntheticQuota.apiKey'
                );
            }
            return;
        }

        if (this.fetchError) {
            const result = await vscode.window.showErrorMessage(
                `Error fetching quota: ${this.fetchError}`,
                'Retry',
                'Open Settings',
                'Dismiss'
            );
            if (result === 'Retry') {
                await this.refreshQuota();
            } else if (result === 'Open Settings') {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'syntheticQuota.apiKey'
                );
            }
            return;
        }

        if (!this.quotaData) {
            await this.refreshQuota();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'syntheticQuotaDetails',
            'Cosmic Quota Details',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getDetailsHtml(this.quotaData);

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.refreshQuota();
                        if (this.quotaData) {
                            panel.webview.html = this.getDetailsHtml(this.quotaData);
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private getDetailsHtml(data: QuotaData): string {
        const subscription = data.subscription;
        const toolCalls = data.toolCalls;
        const search = data.search.hourly;

        const thresholds = this.getColorThresholds();

        const subPercent = (subscription.requests / subscription.limit) * 100;
        const toolPercent = (toolCalls.requests / toolCalls.limit) * 100;
        const searchPercent = (search.requests / search.limit) * 100;

        const subRemaining = subscription.limit - subscription.requests;
        const toolRemaining = toolCalls.limit - toolCalls.requests;
        const searchRemaining = search.limit - search.requests;

        const sessionUsage = this.getSessionUsage(data);
        const analytics = this.getQuotaAnalytics(data);

        const formatDate = (iso: string) => new Date(iso).toLocaleString();

        const getStatusColor = (percent: number) => {
            if (percent >= thresholds.critical) return '#FF4444';
            if (percent >= thresholds.warning) return '#FFA500';
            if (percent >= 50) return '#FFD700';
            return '#4EC9B0';
        };

        const getStatusText = (percent: number) => {
            if (percent >= thresholds.critical) return 'Critical';
            if (percent >= thresholds.warning) return 'Warning';
            if (percent >= 50) return 'Moderate';
            return 'Healthy';
        };

        const trendIcon = this.getTrendIcon(analytics.trend);
        
        let depletionHtml = '';
        if (analytics.hoursUntilDepletion !== null && analytics.hoursUntilDepletion > 0) {
            const depletionTime = analytics.hoursUntilDepletion < 1 
                ? `${Math.round(analytics.hoursUntilDepletion * 60)} minutes`
                : `${analytics.hoursUntilDepletion.toFixed(1)} hours`;
            depletionHtml = `
                <div class="analytics-row">
                    <span class="analytics-label">⏰ Depletes in:</span>
                    <span class="analytics-value ${analytics.hoursUntilDepletion < 6 ? 'warning' : ''}">${depletionTime}</span>
                </div>
            `;
        }

        let projectedHtml = '';
        if (analytics.projectedRemainingAtReset !== null) {
            const projectedClass = analytics.projectedRemainingAtReset < 10 ? 'warning' : '';
            const projectedLabel = analytics.projectedRemainingAtReset < 10 ? '(low!)' : '';
            projectedHtml = `
                <div class="analytics-row">
                    <span class="analytics-label">📈 Projected at reset:</span>
                    <span class="analytics-value ${projectedClass}">${analytics.projectedRemainingAtReset.toFixed(1)}% ${projectedLabel}</span>
                </div>
            `;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cosmic Quota Details</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        h1 {
            margin-top: 0;
            font-weight: 600;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .quota-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border: 1px solid var(--vscode-panel-border);
        }
        .analytics-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border: 2px solid var(--vscode-button-background);
        }
        .quota-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .quota-title {
            font-size: 18px;
            font-weight: 600;
        }
        .status-badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .progress-container {
            background: var(--vscode-scrollbarSlider-background);
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }
        .progress-bar {
            height: 100%;
            border-radius: 4px;
            transition: width 0.3s ease;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-top: 15px;
        }
        .stat-box {
            text-align: center;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 600;
        }
        .stat-label {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 5px;
        }
        .renewal-info {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 13px;
            opacity: 0.9;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .info-item {
            display: flex;
            justify-content: space-between;
        }
        .last-updated {
            margin-top: 30px;
            text-align: center;
            font-size: 12px;
            opacity: 0.6;
        }
        .refresh-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            margin-top: 15px;
        }
        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .session-usage {
            margin-top: 10px;
            padding: 8px 12px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            font-size: 12px;
        }
        .session-usage-label {
            opacity: 0.7;
        }
        .session-usage-value {
            font-weight: 600;
        }
        .analytics-section {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .analytics-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-button-background);
        }
        .analytics-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 13px;
        }
        .analytics-label {
            opacity: 0.8;
        }
        .analytics-value {
            font-weight: 600;
        }
        .analytics-value.warning {
            color: #FF6B6B;
        }
        .trend-indicator {
            font-size: 20px;
        }
    </style>
</head>
<body>
    <h1>👽 Cosmic Quota Monitor</h1>

    <div class="analytics-card">
        <div class="quota-header">
            <span class="quota-title">📊 Predictive Analytics</span>
            <span class="trend-indicator">${trendIcon}</span>
        </div>
        <div class="analytics-section" style="margin-top: 0; border-top: none;">
            <div class="analytics-row">
                <span class="analytics-label">Current Trend:</span>
                <span class="analytics-value">${analytics.trend}</span>
            </div>
            ${Math.abs(analytics.burnRatePerHour) > 0.01 ? `
            <div class="analytics-row">
                <span class="analytics-label">Burn Rate:</span>
                <span class="analytics-value ${Math.abs(analytics.burnRatePerHour) > 10 ? 'warning' : ''}">
                    ${analytics.burnRatePerHour > 0 ? '🔥' : '💚'} ${Math.abs(analytics.burnRatePerHour).toFixed(2)}%/hour
                </span>
            </div>
            ` : ''}
            ${depletionHtml}
            ${projectedHtml}
        </div>
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--vscode-panel-border); font-size: 11px; opacity: 0.7;">
            💡 Projections based on your current usage rate since cycle started (5h window)
        </div>
    </div>

    <div class="quota-card">
        <div class="quota-header">
            <span class="quota-title">📦 Subscription Quota</span>
            <span class="status-badge" style="background: ${getStatusColor(subPercent)}20; color: ${getStatusColor(subPercent)};">
                ${getStatusText(subPercent)}
            </span>
        </div>
        <div class="progress-container">
            <div class="progress-bar" style="width: ${Math.min(subPercent, 100)}%; background: ${getStatusColor(subPercent)};"></div>
        </div>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-value" style="color: ${getStatusColor(subPercent)};">${subPercent.toFixed(1)}%</div>
                <div class="stat-label">Used</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${subscription.requests.toFixed(1)}</div>
                <div class="stat-label">Requests</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${subRemaining.toFixed(1)}</div>
                <div class="stat-label">Remaining</div>
            </div>
        </div>
        ${sessionUsage.subscription > 0 ? `
        <div class="session-usage">
            <span class="session-usage-label">Session usage:</span>
            <span class="session-usage-value" style="color: #FF6B6B;">↓ ${sessionUsage.subscription}%</span>
        </div>
        ` : ''}
        <div class="renewal-info">
            <div class="info-grid">
                <div class="info-item">
                    <span>Limit:</span>
                    <span>${subscription.limit}</span>
                </div>
                <div class="info-item">
                    <span>Renews At:</span>
                    <span>${formatDate(subscription.renewsAt)}</span>
                </div>
            </div>
        </div>
    </div>

    <div class="quota-card">
        <div class="quota-header">
            <span class="quota-title">🔧 Tool Calls</span>
            <span class="status-badge" style="background: ${getStatusColor(toolPercent)}20; color: ${getStatusColor(toolPercent)};">
                ${getStatusText(toolPercent)}
            </span>
        </div>
        <div class="progress-container">
            <div class="progress-bar" style="width: ${Math.min(toolPercent, 100)}%; background: ${getStatusColor(toolPercent)};"></div>
        </div>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-value" style="color: ${getStatusColor(toolPercent)};">${toolPercent.toFixed(1)}%</div>
                <div class="stat-label">Used</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${toolCalls.requests}</div>
                <div class="stat-label">Calls</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${toolRemaining}</div>
                <div class="stat-label">Remaining</div>
            </div>
        </div>
        ${sessionUsage.toolCalls > 0 ? `
        <div class="session-usage">
            <span class="session-usage-label">Session usage:</span>
            <span class="session-usage-value" style="color: #FF6B6B;">↓ ${sessionUsage.toolCalls}%</span>
        </div>
        ` : ''}
        <div class="renewal-info">
            <div class="info-grid">
                <div class="info-item">
                    <span>Limit:</span>
                    <span>${toolCalls.limit}</span>
                </div>
                <div class="info-item">
                    <span>Renews At:</span>
                    <span>${formatDate(toolCalls.renewsAt)}</span>
                </div>
            </div>
        </div>
    </div>

    <div class="quota-card">
        <div class="quota-header">
            <span class="quota-title">🔍 Search (Hourly)</span>
            <span class="status-badge" style="background: ${getStatusColor(searchPercent)}20; color: ${getStatusColor(searchPercent)};">
                ${getStatusText(searchPercent)}
            </span>
        </div>
        <div class="progress-container">
            <div class="progress-bar" style="width: ${Math.min(searchPercent, 100)}%; background: ${getStatusColor(searchPercent)};"></div>
        </div>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-value" style="color: ${getStatusColor(searchPercent)};">${searchPercent.toFixed(1)}%</div>
                <div class="stat-label">Used</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${search.requests}</div>
                <div class="stat-label">Searches</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${searchRemaining}</div>
                <div class="stat-label">Remaining</div>
            </div>
        </div>
        ${sessionUsage.search > 0 ? `
        <div class="session-usage">
            <span class="session-usage-label">Session usage:</span>
            <span class="session-usage-value" style="color: #FF6B6B;">↓ ${sessionUsage.search}%</span>
        </div>
        ` : ''}
        <div class="renewal-info">
            <div class="info-grid">
                <div class="info-item">
                    <span>Limit:</span>
                    <span>${search.limit}</span>
                </div>
                <div class="info-item">
                    <span>Renews At:</span>
                    <span>${formatDate(search.renewsAt)}</span>
                </div>
            </div>
        </div>
    </div>

    <div class="last-updated">
        Last updated: ${this.lastFetchTime ? this.lastFetchTime.toLocaleString() : 'Never'}
        <br>
        <button class="refresh-btn" onclick="refresh()">🔄 Refresh Now</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.stopAutoRefresh();
        this.statusBarItem.dispose();
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const monitor = new QuotaMonitor(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('syntheticQuota.refresh', () => {
            monitor.refreshQuota();
        }),
        vscode.commands.registerCommand('syntheticQuota.showDetails', () => {
            monitor.showDetails();
        })
    );
}

export function deactivate(): void {
    // Cleanup is handled by the monitor's dispose method
}
