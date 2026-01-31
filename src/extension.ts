import * as vscode from 'vscode';
import { QuotaService } from './services/quotaService';
import { StatusBarManager } from './ui/statusBar';
import { QuotaWebview } from './ui/webview/QuotaWebview';
import {
  QuotaData,
  StatusBarDisplayMode,
  TimeDisplayMode,
  CompactAnalyticsMode
} from './api/types';

const CONFIG_NAMESPACE = 'syntheticQuota';

class QuotaMonitor {
  private service: QuotaService;
  private statusBar: StatusBarManager;
  private refreshTimer?: NodeJS.Timeout;
  private currentData: QuotaData | null = null;
  private isFetching = false;
  private fetchError: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.service = new QuotaService();
    this.statusBar = new StatusBarManager('syntheticQuota.showDetails');

    this.context.subscriptions.push(
      this.statusBar.item,
      vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged, this)
    );

    this.initialize();
  }

  private async initialize(): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.statusBar.showSetup();
      return;
    }

    this.service.setApiKey(apiKey);
    await this.refreshQuota();
    this.startAutoRefresh();
  }

  private getApiKey(): string {
    return vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string>('apiKey', '').trim();
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return {
      warningThreshold: config.get<number>('warningThreshold', 70),
      criticalThreshold: config.get<number>('criticalThreshold', 90),
      showCountdown: config.get<boolean>('statusBarCountdown', true),
      timeMode: config.get<TimeDisplayMode>('resetTimeDisplay', 'relative') as TimeDisplayMode,
      showAnalytics: config.get<boolean>('showCompactAnalytics', true),
      analyticsMode: config.get<CompactAnalyticsMode>(
        'compactAnalytics',
        'auto'
      ) as CompactAnalyticsMode,
      trackSession: config.get<boolean>('trackSessionUsage', true),
      refreshInterval: config.get<number>('refreshInterval', 300)
    };
  }

  private onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
    if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.apiKey`)) {
      this.initialize();
    } else if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.refreshInterval`)) {
      this.startAutoRefresh();
    } else {
      this.updateUI();
    }
  }

  private startAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    const interval = this.getConfig().refreshInterval * 1000;
    this.refreshTimer = setInterval(() => this.refreshQuota(), Math.max(60000, interval));
  }

  public async refreshQuota(): Promise<void> {
    if (this.isFetching) {
      return;
    }

    this.isFetching = true;
    this.statusBar.showLoading();

    try {
      const data = await this.service.refreshQuota();
      if (!this.currentData) {
        this.service.initializeSession(data, this.getConfig().trackSession);
      }
      this.currentData = data;
      this.fetchError = null;
      this.updateUI();
    } catch (error) {
      this.fetchError = error instanceof Error ? error.message : String(error);
      this.statusBar.showError(this.fetchError || 'Unknown Error');
    } finally {
      this.isFetching = false;
    }
  }

  private updateUI() {
    if (!this.currentData) {
      return;
    }

    const config = this.getConfig();
    const analytics = this.service.getAnalytics(this.currentData);
    const sessionUsage = this.service.getSessionUsage(this.currentData);
    const displayMode = vscode.workspace
      .getConfiguration(CONFIG_NAMESPACE)
      .get<StatusBarDisplayMode>('statusBarDisplay', 'subscription') as StatusBarDisplayMode;

    this.statusBar.update(this.currentData, displayMode, sessionUsage, analytics, config);
  }

  public showDetails() {
    if (!this.currentData) {
      this.refreshQuota();
      return;
    }
    const analytics = this.service.getAnalytics(this.currentData);

    QuotaWebview.createOrShow(this.context, this.currentData, analytics, () => this.refreshQuota());
  }

  public dispose() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.statusBar.dispose();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const monitor = new QuotaMonitor(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('syntheticQuota.refresh', () => monitor.refreshQuota()),
    vscode.commands.registerCommand('syntheticQuota.showDetails', () => monitor.showDetails())
  );
}

export function deactivate() {}
