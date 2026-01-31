import * as vscode from 'vscode';
import { QuotaData, QuotaAnalytics } from '../../api/types';

export class QuotaWebview {
  public static readonly viewType = 'syntheticQuotaDetails';

  public static createOrShow(
    context: vscode.ExtensionContext,
    data: QuotaData,
    analytics: QuotaAnalytics,
    onRefresh: () => void
  ) {
    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      '👽 Cosmic Quota Details',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );

    panel.webview.html = this.getHtml(panel.webview, context.extensionUri, data, analytics);

    panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'refresh') {
          onRefresh();
        }
      },
      undefined,
      context.subscriptions
    );

    return panel;
  }

  private static getHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    data: QuotaData,
    analytics: QuotaAnalytics
  ): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'cosmic.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'scripts', 'main.js')
    );

    const getStatusColor = (percent: number) => {
      if (percent >= 90) {
        return '#ff4d4d';
      }
      if (percent >= 70) {
        return '#ff9f43';
      }
      if (percent >= 50) {
        return '#ffd32b';
      }
      return '#00d2d3';
    };

    const subPercent = (data.subscription.requests / data.subscription.limit) * 100;
    const toolPercent = (data.toolCallDiscounts.requests / data.toolCallDiscounts.limit) * 100;
    const searchPercent = (data.search.hourly.requests / data.search.hourly.limit) * 100;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Cosmic Quota</title>
</head>
<body>
    <h1>👽 Cosmic Quota Monitor <div class="live-indicator"></div></h1>

    <div class="dashboard">
        <div class="card analytics-panel">
            <div class="card-header">
                <div class="card-title">📊 Predictive Analytics</div>
                <div class="stat-value" style="font-size: 24px;">
                    ${analytics.trend === 'up' ? '📈' : analytics.trend === 'down' ? '📉' : '➡️'} ${analytics.trend.toUpperCase()}
                </div>
            </div>
            <div class="analytics-grid">
                <div class="stat-item">
                    <div class="stat-label">Burn Rate</div>
                    <div class="stat-value ${Math.abs(analytics.burnRatePerHour) > 10 ? 'trend-up' : ''}">
                        ${analytics.burnRatePerHour > 0 ? '🔥' : '💚'} ${Math.abs(analytics.burnRatePerHour).toFixed(1)}%/h
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Depletion</div>
                    <div class="stat-value">${analytics.hoursUntilDepletion ? analytics.hoursUntilDepletion.toFixed(1) + 'h' : 'Stable'}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Forecasted Usage</div>
                    <div class="stat-value" style="color: ${(analytics.projectedUsageAtReset || 0) >= 100 ? '#ff4d4d' : (analytics.projectedUsageAtReset || 0) >= 80 ? '#ff9f43' : '#4ec9b0'}">
                        ${analytics.projectedUsageAtReset ? analytics.projectedUsageAtReset + '%' : '--'}
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Reset In</div>
                    <div class="stat-value">${this.formatDuration(data.subscription.renewsAt)}</div>
                </div>
            </div>
            <div class="graph-container" style="margin-top: 20px; height: 60px; pointer-events: none;">
                ${this.generateSparkline(analytics.sessionHistory)}
                <div style="font-size: 10px; color: #888; text-align: center; margin-top: 4px;">Session Usage Pulse</div>
            </div>
        </div>

        <div class="card" style="--status-color: ${getStatusColor(subPercent)}">
            <div class="card-header">
                <div class="card-title">Subscription Quota</div>
            </div>
            <div class="usage-value">
                <span class="animate-number" data-target="${subPercent}" data-decimals="1">0</span><span>%</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" data-width="${Math.min(subPercent, 100)}"></div>
            </div>
            <div class="stats-row">
                <span>${data.subscription.requests}/${data.subscription.limit}</span>
                <span>${(data.subscription.limit - data.subscription.requests).toFixed(1)} remaining</span>
            </div>
        </div>

        <div class="card" style="--status-color: ${getStatusColor(toolPercent)}">
            <div class="card-header">
                <div class="card-title">Tool Calls</div>
            </div>
            <div class="usage-value">
                <span class="animate-number" data-target="${toolPercent}" data-decimals="1">0</span><span>%</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" data-width="${Math.min(toolPercent, 100)}"></div>
            </div>
            <div class="stats-row">
                <span>${data.toolCallDiscounts.requests}/${data.toolCallDiscounts.limit}</span>
                <span>${data.toolCallDiscounts.limit - data.toolCallDiscounts.requests} remaining</span>
            </div>
        </div>

        <div class="card" style="--status-color: ${getStatusColor(searchPercent)}">
            <div class="card-header">
                <div class="card-title">Search (Hourly)</div>
            </div>
            <div class="usage-value">
                <span class="animate-number" data-target="${searchPercent}" data-decimals="1">0</span><span>%</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" data-width="${Math.min(searchPercent, 100)}"></div>
            </div>
            <div class="stats-row">
                <span>${data.search.hourly.requests}/${data.search.hourly.limit}</span>
                <span>${data.search.hourly.limit - data.search.hourly.requests} remaining</span>
            </div>
        </div>
    </div>

    <div class="refresh-container">
        <button class="btn-refresh" onclick="refresh()">
            <span>🔄</span> Refresh Pulse
        </button>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private static generateSparkline(history: Array<{ timestamp: number; usage: number }>): string {
    if (history.length < 2) {
      return `<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="width: 100%; height: 100%; opacity: 0.3;">
                <line x1="0" y1="10" x2="100" y2="10" stroke="#4ec9b0" stroke-width="1" stroke-dasharray="2,2" />
              </svg>`;
    }

    const minUsage = Math.min(...history.map((h) => h.usage));
    const maxUsage = Math.max(...history.map((h) => h.usage));
    const range = Math.max(1, maxUsage - minUsage);

    const points = history
      .map((h, i) => {
        const x = (i / (history.length - 1)) * 100;
        const y = 20 - ((h.usage - minUsage) / range) * 15 - 2; // Leave some padding
        return `${x},${y}`;
      })
      .join(' ');

    return `<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(78, 201, 176, 0.2));">
              <defs>
                <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#4ec9b0" stop-opacity="0.5" />
                  <stop offset="100%" stop-color="#4ec9b0" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M 0 20 L ${points} L 100 20 Z" fill="url(#sparkGradient)" />
              <polyline points="${points}" fill="none" stroke="#4ec9b0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>`;
  }

  private static formatDuration(iso: string): string {
    const diff = new Date(iso).getTime() - Date.now();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }
}
