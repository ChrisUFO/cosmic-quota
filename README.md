# 👽 Cosmic Quota

**Transmitting quota data from the far reaches of the Synthetic galaxy...**

An otherworldly VS Code: extension that monitors your Synthetic API quota directly from the cosmic void. Stay informed about your interstellar resource levels before your energy cells deplete.

## 🛸 Alien Features

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

## Installation

1. Install from the VS Code: Marketplace (coming soon)
2. Or install from VSIX: Download the latest release and run `code --install-extension synthetic-quota-1.1.0.vsix`

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
| `syntheticQuota.resetTimeDisplay` | `'relative'` | Time format: relative, absolute, or both |
| `syntheticQuota.warningThreshold` | `70` | Usage % for warning (yellow) status |
| `syntheticQuota.criticalThreshold` | `90` | Usage % for critical (red) status |
| `syntheticQuota.lowQuotaNotificationThreshold` | `0` | Notify when remaining % drops below this (0 to disable) |

## Commands

- **Refresh Synthetic Quota** (`syntheticQuota.refresh`) - Manually refresh quota data
- **Show Quota Details** (`syntheticQuota.showDetails`) - Open detailed webview panel

Click the status bar item at any time to open the detailed quota view.

## Status Bar Examples

| Display | Description |
|---------|-------------|
| `$(check) 45%` | Healthy subscription usage |
| `$(warning) 75% (-5%)` | Warning level with 5% session consumption |
| `$(error) ~45m` | Depleted quota, 45 minutes until reset |
| `$(dashboard) S:45% T:30% H:80%` | All quotas displayed |

## Requirements

- VS Code: 1.74.0 or higher
- A valid Synthetic API key

## Extension Settings Reference

### Display Modes

- **subscription**: Shows subscription quota with icon and percentage
- **toolCalls**: Shows tool calls quota usage
- **search**: Shows hourly search quota usage
- **all**: Abbreviated view showing all three quotas
- **average**: Average percentage across all quota types

### Time Display Modes

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

## Release Notes

### 1.1.0

- Added configurable status bar display modes (subscription, toolCalls, search, all, average)
- Added notification alerts for low quota thresholds
- Added configurable time display formats (relative, absolute, both)
- Added configurable color thresholds for status indicators
- Added session usage tracking with visual indicators
- Added countdown display when quota reaches 0%
- Fixed webview refresh button functionality
- Added comprehensive documentation

### 1.0.0

- Initial release
- Basic quota monitoring in status bar
- Detailed webview with all quotas
- Auto-refresh with configurable interval

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

MIT License - see LICENSE file for details

---

**Enjoy monitoring your Synthetic API quota with ease!**
