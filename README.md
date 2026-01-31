# 👽 Cosmic Quota

**Transmitting quota data from the far reaches of the Synthetic galaxy...**

An otherworldly VS Code: extension that monitors your Synthetic API quota directly from the cosmic void. Stay informed about your interstellar resource levels before your energy cells deplete.

## 🛸 Features

### Core Monitoring
- **Real-time Status Bar Display** - Monitor quota usage directly in VS Code:
- **Multiple Display Modes** - Choose what to show in the status bar:
  - Subscription quota (default)
  - Tool calls quota
  - Hourly search quota
  - All quotas abbreviated (S:/T:/H:)
  - Average across all quotas
- **Visual Indicators** - Color-coded status based on usage levels:
  - 🟢 Green (< 50%) - Healthy
  - 🟡 Yellow (50-70%) - Moderate
  - 🟠 Orange (70-90%) - Warning
  - 🔴 Red (> 90%) - Critical
- **Session Tracking** - Track quota consumption during your current VS Code: session
- **Smart Notifications** - Get notified when quota drops below your configured threshold
- **Countdown Display** - When quota hits 0%, see countdown to next reset
- **Flexible Time Formats** - Display reset times as relative, absolute, or both
- **Detailed Webview** - Click the status bar for a comprehensive breakdown of all quotas

### 🔮 Predictive Analytics (v0.2.0)
Cosmic Quota now predicts your future quota usage based on your current session patterns:

- **Trend Analysis** - Visual indicators show if your usage is 📈 increasing, 📉 decreasing, or ➡️ stable
- **Depletion Forecasting** - Predicts when you'll run out of quota based on current burn rate ("2h left")
- **Efficiency Score** - Compares your usage vs. time elapsed in the billing cycle
- **Projected Remaining** - Shows how much quota you'll have left at reset time
- **Burn Rate** - Real-time consumption rate in %/hour

**How it works:** The extension maintains a rolling window of up to 10 data points from your current session. It calculates:
- **Burn Rate**: `(currentUsage - initialUsage) / hoursElapsed`
- **Trend**: Based on recent 3 data points
- **Depletion**: `remainingQuota / burnRate`
- **Efficiency**: `actualUsage% / expectedUsage%` (based on time in cycle)

## Installation

1. Install from the VS Code: Marketplace (coming soon)
2. Or install from VSIX: Download the latest release and run `code --install-extension cosmic-quota-0.2.0.vsix`

## Setup

1. Open VS Code: Settings (Ctrl/Cmd + ,)
2. Search for "Synthetic Quota"
3. Enter your Synthetic API key in the `syntheticQuota.apiKey` field
4. The extension will automatically start monitoring your quota

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `syntheticQuota.apiKey` | `''` | Your Synthetic API key |
| `syntheticQuota.refreshInterval` | `300` | Refresh interval in seconds (60-3600) |
| `syntheticQuota.statusBarDisplay` | `'subscription'` | What to display in status bar |
| `syntheticQuota.statusBarCountdown` | `true` | Show countdown when quota is 0% |
| `syntheticQuota.trackSessionUsage` | `true` | Track usage since VS Code: opened |
| `syntheticQuota.showCompactAnalytics` | `true` | Show predictive analytics in status bar |
| `syntheticQuota.compactAnalytics` | `'auto'` | Analytics mode: auto, trend, depletion, burn, off |
| `syntheticQuota.resetTimeDisplay` | `'relative'` | Time format: relative, absolute, or both |
| `syntheticQuota.warningThreshold` | `70` | Usage % for warning (yellow) status |
| `syntheticQuota.criticalThreshold` | `90` | Usage % for critical (red) status |
| `syntheticQuota.lowQuotaNotificationThreshold` | `0` | Notify when remaining % drops below this (0 to disable) |

### Analytics Modes

- **auto** (default): Intelligently switches based on quota state:
  - Critical (90%+): Shows depletion time
  - Warning (70%+): Shows trend arrows
  - Moderate (50%+): Shows burn indicators
- **trend**: Always shows trend indicator (📈📉➡️)
- **depletion**: Always shows time until depletion ("2h left")
- **burn**: Always shows burn rate ("5.2%/h")
- **off**: Disables compact analytics in status bar

## Commands

- **Refresh Quota** (`syntheticQuota.refresh`) - Manually refresh quota data
- **Show Quota Details** (`syntheticQuota.showDetails`) - Open detailed webview panel

Click the status bar item at any time to open the detailed quota view.

## Status Bar Examples

| Display | Description |
|---------|-------------|
| `$(check) 45%` | Healthy subscription usage |
| `$(warning) 75% (-5%)` | Warning level with 5% session consumption |
| `$(warning) 92% • 2h left` | Critical with depletion forecast |
| `$(info) 65% 📈` | Moderate with increasing trend |
| `$(error) ~45m` | Depleted quota, 45 minutes until reset |
| `$(dashboard) S:45% T:30% H:80% 📈` | All quotas with trend indicator |

## Requirements

- VS Code: 1.74.0 or higher
- A valid Synthetic API key

## Display Modes

- **subscription**: Shows subscription quota with icon and percentage
- **toolCalls**: Shows tool calls quota usage
- **search**: Shows hourly search quota usage
- **all**: Abbreviated view showing all three quotas
- **average**: Average percentage across all quota types

## Time Display Modes

- **relative**: "in 2h 13m"
- **absolute**: "resets at 14:07"
- **both**: "in 2h 13m (14:07)"

## Troubleshooting

**Extension shows "Set API Key"**
- Your API key is not configured. Open settings and add your Synthetic API key.

**"Invalid API key" error**
- Verify your API key is correct and active in your Synthetic dashboard.

**"Rate limited" error**
- You're making too many requests. The extension will automatically retry with exponential backoff.

**Quota not updating**
- Check your internet connection
- Verify the API endpoint is accessible
- Try manually refreshing with the command palette

## Known Issues

- Session tracking resets when VS Code: window reloads
- Notifications appear once per threshold crossing until quota recovers
- Predictive analytics require at least 2 data points (a few minutes of session time)

## Release Notes

### 0.3.1

- **New Icon**: Updated extension icon with a high-fidelity "Cosmic Eye" design.
- **Polish**: Minor visual improvements.

### 0.3.0 (The Cosmic Overhaul)

- **Complete UI/UX Overhaul**: New dashboard with glassmorphism, neon accents, and smooth transitions.
- **Micro-animations**: Percentage counters and springy progress bars for a premium feel.
- **Modular Architecture**: Complete codebase refactor for better stability and performance.
- **Enhanced Predictive Analytics**: Improved accuracy for depletion and burn rate modeling.
- **Rich Markdown Tooltips**: Beautifully formatted status bar summaries with tables and projections.
- **Developer Experience**: Added unit testing (Jest), ESLint automation, and pre-commit hooks.

### 0.2.0

- **Predictive Analytics**: Added trend analysis, depletion forecasting, burn rate calculation, and efficiency scoring
- **Smart Status Bar**: Auto mode intelligently shows relevant analytics based on quota state
- **Projected Remaining**: Shows how much quota you'll have left at reset time
- **Visual Improvements**: Added emojis and better formatting to tooltips and webview
- **New Settings**: `showCompactAnalytics` and `compactAnalytics` for controlling analytics display
- **Branding**: Officially renamed to "Cosmic Quota" with 👽 emoji

### 0.1.0

- Initial release
- Basic quota monitoring in status bar
- Detailed webview with all quotas
- Auto-refresh with configurable interval
- Session usage tracking
- Notification alerts for low quota thresholds
- Configurable color thresholds and time display formats

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

MIT License - see LICENSE file for details

---

**Enjoy monitoring your Synthetic API quota with cosmic precision!** 👽🚀
