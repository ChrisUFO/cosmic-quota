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
                <div class="stat-value" style="font-size: 24px;">${analytics.trend === 'up' ? '📈' : '📉'} ${analytics.trend.toUpperCase()}</div>
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
                    <div class="stat-label">Projected</div>
                    <div class="stat-value">${analytics.projectedRemainingAtReset ? analytics.projectedRemainingAtReset.toFixed(1) + '%' : '--'}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Reset In</div>
                    <div class="stat-value">${this.formatDuration(data.subscription.renewsAt)}</div>
                </div>
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

  private static formatDuration(iso: string): string {
    const diff = new Date(iso).getTime() - Date.now();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }
}
