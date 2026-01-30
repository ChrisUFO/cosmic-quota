# Synthetic Quota Monitor Extension - AI Coding Guidelines

## Project Overview
This is a VS Code extension that monitors Synthetic API quota usage, displaying real-time subscription, tool calls, and search limits in the status bar. The extension fetches quota data from `https://api.synthetic.new/v2/quotas` using Bearer token authentication.

## Architecture
- **Main Component**: `QuotaMonitor` class in `src/extension.ts` manages all functionality
- **Data Structure**: `QuotaData` interface with nested `subscription`, `search.hourly`, and `toolCalls` quotas
- **Display**: Status bar item shows subscription usage with color-coded icons; detailed view uses VS Code webview
- **Configuration**: User settings for API key (`syntheticQuota.apiKey`) and refresh interval (`syntheticQuota.refreshInterval`)

## Key Patterns
- **API Integration**: Use Node.js `https` module for authenticated GET requests to Synthetic API
- **Status Bar Display**: Format as `$(icon) requests/limit (percentage%)` with color coding (green <50%, yellow 50-70%, orange 70-90%, red >90%)
- **Error Handling**: Display user-friendly messages for 401 (invalid key), 429 (rate limited), network errors
- **Time Formatting**: Calculate and display time until renewal using `formatTimeUntil()` method
- **Webview HTML**: Generate responsive HTML with VS Code theme variables (`--vscode-*`) and progress bars

## Development Workflow
- **Build**: `npm run compile` compiles TypeScript to `out/extension.js`
- **Watch Mode**: `npm run watch` for continuous compilation during development
- **Testing**: No automated tests; manually test status bar updates, command execution, and webview rendering

## Code Style
- **TypeScript**: Strict mode enabled, target ES2020, CommonJS modules
- **Imports**: Use `import * as vscode from 'vscode'` for VS Code APIs
- **Async/Await**: Prefer async methods for API calls and user interactions
- **Configuration Access**: Always use `vscode.workspace.getConfiguration('syntheticQuota')`
- **Status Bar**: Create items with `vscode.StatusBarAlignment.Right` and appropriate priority

## Common Tasks
- **Adding New Quota Types**: Extend `QuotaData` interface and update `updateStatusBar()` and `getDetailsHtml()` methods
- **Modifying Display**: Update color thresholds in `getSubscriptionConfig()` and status badge logic
- **API Changes**: Modify request options in `fetchQuotaData()` method, handle new response fields
- **User Settings**: Add new properties to `package.json` contributes.configuration and access via `getConfiguration()`

## Integration Points
- **VS Code APIs**: Status bar, commands, configuration, webview panels, message passing
- **External API**: Synthetic quota endpoint with Bearer authentication
- **User Interaction**: Command palette, settings UI, status bar clicks, webview buttons