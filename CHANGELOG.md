# Changelog

## [2.0.0] - 2026-04-05

### Changed
- Extension thoroughly rebuilt for clean Marketplace compliance
- Removed bundled MCP server (use the standalone Python MCP server from the DocsStudio backend repo instead)
- Removed unused sidebar chat webview
- Removed `@modelcontextprotocol/sdk` and `zod` dependencies
- Added URL validation for API configuration
- Added `.vscodeignore` for clean VSIX packaging
- Added `context-inject/for-file` API support for server-side formatted context
- Cleaned up extension metadata and repository links
- Single build entry point (extension only)
