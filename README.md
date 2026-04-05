# DocsStudio - Live Documentation Context

> Bring relevant documentation right into your AI coding sessions. No more copy-pasting docs into prompts.

## What It Does

1. **Detects** your dependencies from `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.
2. **Matches** them against documentation you've indexed in DocsStudio
3. **Delivers** the right context — auth flows, endpoints, schemas, error codes — via commands in VS Code

## Setup

### 1. Install and Configure

After installing the extension:

1. Run **DocsStudio: Configure API Settings** from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Enter your DocsStudio API URL (default: `https://docsstudio.dev/api`)
3. Enter your User ID (visible in your DocsStudio dashboard)

### 2. Index Docs First

The extension works with documentation you've already indexed in DocsStudio. Make sure you've:
- Added the documentation sites for your dependencies
- Built the knowledge graph (happens automatically after indexing)

## Commands

| Command | Description |
|---------|-------------|
| `DocsStudio: Configure API Settings` | Set API URL and User ID |
| `DocsStudio: Refresh Context` | Re-detect dependencies and match projects |
| `DocsStudio: Show Matched Projects` | View which docs match your workspace |
| `DocsStudio: Search Documentation` | Search across all indexed docs |
| `DocsStudio: Get Context for Current File` | Surface relevant docs for your active file |
| `DocsStudio: Start MCP Server` | View MCP server status |

## How It Works

The extension reads your workspace manifest files (`package.json`, `requirements.txt`, etc.) to detect dependencies. These are sent to the DocsStudio API to match against your indexed documentation. When you request context for a file, the extension analyzes imports and code patterns to surface the most relevant documentation.

Context is prioritized by relevance:
- **Auth flows** — authentication details
- **Matching endpoints** — the APIs you're using
- **Schemas** — data models for request/response
- **Error codes** — what can go wrong
- **Webhooks** — event-driven flows

## Requirements

- A DocsStudio account with indexed documentation
- VS Code 1.93.0 or later

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `docsstudio.apiUrl` | `https://docsstudio.dev/api` | DocsStudio backend API URL |
| `docsstudio.userId` | (empty) | Your User ID for authentication |
| `docsstudio.maxContextTokens` | `8000` | Maximum tokens to include in context |

## Development

```bash
cd vscode-extension
npm install
npm run compile    # Build once
npm run watch      # Watch mode
```

## Building

```bash
npm install -g @vscode/vsce
cd vscode-extension
npm install
npx @vscode/vsce package
```

This produces a `.vsix` file which can be installed in VS Code.
