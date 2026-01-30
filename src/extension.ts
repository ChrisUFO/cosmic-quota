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

interface SessionTracker {
    sessionStartTime: number;
    initialSubscriptionQuota: number;
    initialToolCallsQuota: number;
    initialSearchQuota: number;
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
            initialSearchQuota: searchPercent
        };
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

        const displayMode = this.getStatusBarDisplayMode();
        const sessionUsage = this.getSessionUsage(this.quotaData);

        switch (displayMode) {
            case 'subscription':
                this.updateStatusBarForQuota('subscription', this.quotaData.subscription, sessionUsage.subscription);
                break;
            case 'toolCalls':
                this.updateStatusBarForQuota('toolCalls', this.quotaData.toolCalls, sessionUsage.toolCalls);
                break;
            case 'search':
                this.updateStatusBarForQuota('search', this.quotaData.search.hourly, sessionUsage.search);
                break;
            case 'all':
                this.updateStatusBarAll();
                break;
            case 'average':
                this.updateStatusBarAverage(sessionUsage);
                break;
            default:
                this.updateStatusBarForQuota('subscription', this.quotaData.subscription, sessionUsage.subscription);
        }
    }

    private updateStatusBarForQuota(
        name: string,
        quota: { limit: number; requests: number; renewsAt: string },
        sessionUsed: number
    ): void {
        const usedPercent = (quota.requests / quota.limit) * 100;
        const remaining = quota.limit - quota.requests;
        const config = this.getSubscriptionConfig(usedPercent);

        let text = `${config.icon} ${usedPercent.toFixed(0)}%`;
        
        if (sessionUsed > 0) {
            text += ` (-${sessionUsed}%)`;
        }

        if (usedPercent >= 100 && this.shouldShowCountdown()) {
            const countdown = this.formatCountdown(quota.renewsAt);
            text = `${config.icon} ~${countdown}`;
        }

        this.statusBarItem.text = text;
        this.statusBarItem.color = config.color;
        this.statusBarItem.tooltip = this.buildTooltip(name, quota, usedPercent, remaining, config.description);
        this.statusBarItem.show();
    }

    private updateStatusBarAll(): void {
        const sub = this.quotaData!.subscription;
        const tool = this.quotaData!.toolCalls;
        const search = this.quotaData!.search.hourly;

        const subPercent = (sub.requests / sub.limit) * 100;
        const toolPercent = (tool.requests / tool.limit) * 100;
        const searchPercent = (search.requests / search.limit) * 100;

        const sessionUsage = this.getSessionUsage(this.quotaData!);

        let text = `$(dashboard) S:${subPercent.toFixed(0)}% T:${toolPercent.toFixed(0)}% H:${searchPercent.toFixed(0)}%`;
        
        this.statusBarItem.text = text;
        this.statusBarItem.color = undefined;
        this.statusBarItem.tooltip = this.buildFullTooltip();
        this.statusBarItem.show();
    }

    private updateStatusBarAverage(sessionUsage: { subscription: number; toolCalls: number; search: number }): void {
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

        this.statusBarItem.text = text;
        this.statusBarItem.color = config.color;
        this.statusBarItem.tooltip = this.buildFullTooltip();
        this.statusBarItem.show();
    }

    private buildTooltip(
        name: string,
        quota: { limit: number; requests: number; renewsAt: string },
        usedPercent: number,
        remaining: number,
        status: string
    ): vscode.MarkdownString {
        const displayName = name === 'subscription' ? 'Subscription' : 
                           name === 'toolCalls' ? 'Tool Calls' : 'Search (Hourly)';
        const renewsIn = this.formatTimeUntil(quota.renewsAt);
        
        return new vscode.MarkdownString(`
## ${displayName}

- **Used:** ${quota.requests.toFixed(1)} / ${quota.limit} (${usedPercent.toFixed(1)}%)
- **Remaining:** ${remaining.toFixed(1)}
- **Status:** ${status}
- **Resets:** ${renewsIn}

*Click for detailed view*
        `);
    }

    private buildFullTooltip(): vscode.MarkdownString {
        const sub = this.quotaData!.subscription;
        const tool = this.quotaData!.toolCalls;
        const search = this.quotaData!.search.hourly;

        return new vscode.MarkdownString(`
## Synthetic API Quota

### Subscription
- Used: ${sub.requests.toFixed(1)} / ${sub.limit} (${((sub.requests/sub.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(sub.renewsAt)}

### Tool Calls
- Used: ${tool.requests} / ${tool.limit} (${((tool.requests/tool.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(tool.renewsAt)}

### Search (Hourly)
- Used: ${search.requests} / ${search.limit} (${((search.requests/search.limit)*100).toFixed(1)}%)
- Resets: ${this.formatTimeUntil(search.renewsAt)}

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
                    'User-Agent': 'VSCode-Synthetic-Quota-Extension/1.0.0'
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
            'Synthetic Quota Details',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getDetailsHtml(this.quotaData);

        // FIX: Add message handler for refresh button
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Synthetic Quota Details</title>
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
    </style>
</head>
<body>
    <h1>Synthetic API Quota Monitor</h1>

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
        <button class="refresh-btn" onclick="refresh()">Refresh Now</button>
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
