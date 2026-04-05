/**
 * DocsStudio Chat Sidebar
 * =======================
 * Webview-based sidebar with a branded chat interface.
 * Users can ask questions about their indexed documentation
 * and get context-aware answers.
 */

import * as vscode from "vscode";
import { DocsStudioClient, ContextSearchResult } from "../api/client";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "docsstudio.chatView";

  private _view?: vscode.WebviewView;
  private client: DocsStudioClient;

  constructor(
    private readonly extensionUri: vscode.Uri,
    client: DocsStudioClient
  ) {
    this.client = client;
  }

  updateClient(client: DocsStudioClient) {
    this.client = client;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "search":
          await this._handleSearch(message.query);
          break;
        case "getContext":
          await this._handleGetContext();
          break;
        case "listProjects":
          await this._handleListProjects();
          break;
        case "configure":
          vscode.commands.executeCommand("docsstudio.configure");
          break;
      }
    });
  }

  private async _handleSearch(query: string) {
    if (!this._view) return;

    this._postMessage({ type: "loading", loading: true });

    try {
      const result = await this.client.searchContext(query, undefined, undefined, 10);

      const formatted = result.results.map((r: ContextSearchResult) => ({
        type: r.type,
        nodeType: r.node_type || r.type,
        label: r.label || r.heading_path?.join(" > ") || "Result",
        description: r.description || r.text || "",
        ref: r.canonical_ref || "",
        project: r.project_name,
        score: r.score,
      }));

      this._postMessage({
        type: "searchResults",
        query,
        results: formatted,
        total: result.total,
      });
    } catch (error) {
      this._postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Search failed",
      });
    }
  }

  private async _handleGetContext() {
    if (!this._view) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._postMessage({
        type: "error",
        message: "No active file open",
      });
      return;
    }

    this._postMessage({ type: "loading", loading: true });

    try {
      const content = editor.document.getText();
      const filePath = editor.document.uri.fsPath;
      const result = await this.client.getContextForFile(content, filePath, undefined, 15);

      const items = result.context.map((item) => ({
        type: item.type,
        nodeType: item.node_type,
        label: item.label,
        description: item.description,
        ref: item.canonical_ref,
        project: item.project_name,
        score: item.score,
      }));

      this._postMessage({
        type: "contextResults",
        filePath: editor.document.fileName,
        language: result.language,
        imports: result.detected_imports,
        items,
      });
    } catch (error) {
      this._postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Context fetch failed",
      });
    }
  }

  private async _handleListProjects() {
    if (!this._view) return;

    this._postMessage({ type: "loading", loading: true });

    try {
      const summary = await this.client.getProjectsSummary();
      this._postMessage({
        type: "projectList",
        projects: summary.projects.map((p) => ({
          id: p.id,
          name: p.name,
          url: p.base_url,
          docs: p.document_count,
          nodes: p.graph_node_count,
          status: p.status,
        })),
      });
    } catch (error) {
      this._postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load projects",
      });
    }
  }

  private _postMessage(message: Record<string, unknown>) {
    this._view?.webview.postMessage(message);
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      --ds-purple: #7c3aed;
      --ds-purple-light: #a78bfa;
      --ds-purple-dark: #5b21b6;
      --ds-purple-glow: rgba(124, 58, 237, 0.3);
      --ds-bg: var(--vscode-sideBar-background, #1e1e1e);
      --ds-fg: var(--vscode-sideBar-foreground, #cccccc);
      --ds-input-bg: var(--vscode-input-background, #3c3c3c);
      --ds-input-fg: var(--vscode-input-foreground, #cccccc);
      --ds-input-border: var(--vscode-input-border, #3c3c3c);
      --ds-badge: var(--vscode-badge-background, #4d4d4d);
      --ds-badge-fg: var(--vscode-badge-foreground, #ffffff);
      --ds-border: var(--vscode-panel-border, #2d2d2d);
      --ds-link: var(--vscode-textLink-foreground, #7c3aed);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, system-ui);
      font-size: var(--vscode-font-size, 13px);
      color: var(--ds-fg);
      background: var(--ds-bg);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ─────────────────────────── */
    .header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--ds-border);
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .header .logo {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, var(--ds-purple), var(--ds-purple-light));
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .header .title {
      font-size: 13px;
      font-weight: 600;
      color: var(--ds-fg);
    }
    .header .subtitle {
      font-size: 10px;
      opacity: 0.6;
    }
    .header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }
    .icon-btn {
      background: none;
      border: none;
      color: var(--ds-fg);
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 14px;
      opacity: 0.7;
    }
    .icon-btn:hover { opacity: 1; background: var(--ds-input-bg); }

    /* ── Quick Actions ──────────────────── */
    .quick-actions {
      padding: 8px 14px;
      display: flex;
      gap: 6px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .action-chip {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      border: 1px solid var(--ds-border);
      background: transparent;
      color: var(--ds-fg);
      cursor: pointer;
      transition: all 0.15s;
    }
    .action-chip:hover {
      border-color: var(--ds-purple);
      color: var(--ds-purple-light);
      background: var(--ds-purple-glow);
    }

    /* ── Chat Area ──────────────────────── */
    .chat-area {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chat-area::-webkit-scrollbar { width: 4px; }
    .chat-area::-webkit-scrollbar-thumb {
      background: var(--ds-border);
      border-radius: 4px;
    }

    .message {
      max-width: 100%;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .message.user {
      align-self: flex-end;
    }
    .message.user .bubble {
      background: var(--ds-purple-dark);
      color: #fff;
      border-radius: 12px 12px 4px 12px;
      padding: 8px 12px;
      font-size: 12px;
    }
    .message.bot .bubble {
      background: var(--ds-input-bg);
      border-radius: 12px 12px 12px 4px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
    }

    .result-card {
      border: 1px solid var(--ds-border);
      border-radius: 8px;
      padding: 8px 10px;
      margin-top: 6px;
      transition: border-color 0.15s;
    }
    .result-card:hover {
      border-color: var(--ds-purple);
    }
    .result-card .rc-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .result-card .rc-badge {
      background: var(--ds-purple-dark);
      color: #fff;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .result-card .rc-label {
      font-weight: 600;
      font-size: 12px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .result-card .rc-project {
      font-size: 10px;
      opacity: 0.6;
    }
    .result-card .rc-desc {
      font-size: 11px;
      opacity: 0.8;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .result-card .rc-ref {
      font-size: 10px;
      color: var(--ds-purple-light);
      margin-top: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .project-card {
      border: 1px solid var(--ds-border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 6px;
    }
    .project-card .pc-name {
      font-weight: 600;
      font-size: 12px;
      color: var(--ds-purple-light);
    }
    .project-card .pc-url {
      font-size: 10px;
      opacity: 0.5;
      margin-bottom: 4px;
    }
    .project-card .pc-stats {
      display: flex;
      gap: 12px;
      font-size: 11px;
      opacity: 0.7;
    }
    .project-card .pc-stats span { font-weight: 600; color: var(--ds-fg); }

    .welcome {
      text-align: center;
      padding: 30px 20px;
      opacity: 0.7;
    }
    .welcome .bolt { font-size: 36px; margin-bottom: 10px; }
    .welcome h3 { font-size: 14px; margin-bottom: 6px; }
    .welcome p { font-size: 11px; line-height: 1.5; }

    .loading-dots {
      display: inline-flex;
      gap: 4px;
      padding: 8px 0;
    }
    .loading-dots span {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--ds-purple-light);
      animation: bounce 1.2s infinite;
    }
    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .context-section {
      margin-top: 6px;
    }
    .context-section .cs-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.5;
      margin-bottom: 4px;
    }
    .import-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .import-tag {
      padding: 2px 8px;
      background: var(--ds-purple-glow);
      border: 1px solid var(--ds-purple);
      border-radius: 10px;
      font-size: 10px;
      color: var(--ds-purple-light);
      font-family: var(--vscode-editor-font-family, monospace);
    }

    /* ── Input ──────────────────────────── */
    .input-area {
      padding: 10px 14px;
      border-top: 1px solid var(--ds-border);
      flex-shrink: 0;
    }
    .input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    .input-row textarea {
      flex: 1;
      background: var(--ds-input-bg);
      border: 1px solid var(--ds-input-border);
      border-radius: 8px;
      padding: 8px 10px;
      color: var(--ds-input-fg);
      font-family: inherit;
      font-size: 12px;
      resize: none;
      min-height: 36px;
      max-height: 100px;
      line-height: 1.4;
      outline: none;
    }
    .input-row textarea:focus {
      border-color: var(--ds-purple);
    }
    .input-row textarea::placeholder { opacity: 0.4; }
    .send-btn {
      background: var(--ds-purple);
      border: none;
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .send-btn:hover { background: var(--ds-purple-dark); }
    .send-btn:disabled { opacity: 0.4; cursor: default; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">⚡</div>
    <div>
      <div class="title">Docs Studio</div>
      <div class="subtitle">AI Documentation Engine</div>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="btnSettings" title="Settings">⚙</button>
    </div>
  </div>

  <div class="quick-actions">
    <button class="action-chip" data-action="context">📄 File Context</button>
    <button class="action-chip" data-action="projects">📚 Projects</button>
  </div>

  <div class="chat-area" id="chatArea">
    <div class="welcome">
      <div class="bolt">⚡</div>
      <h3>Docs Studio</h3>
      <p>Search your indexed documentation,<br>get context for your current file,<br>or browse your projects.</p>
    </div>
  </div>

  <div class="input-area">
    <div class="input-row">
      <textarea id="input" placeholder="Search documentation..." rows="1"></textarea>
      <button class="send-btn" id="sendBtn" title="Search">↑</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chatArea = document.getElementById('chatArea');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');

    let isLoading = false;

    // ── Send message ──
    function sendMessage() {
      const query = input.value.trim();
      if (!query || isLoading) return;

      addMessage('user', query);
      input.value = '';
      input.style.height = '36px';
      vscode.postMessage({ type: 'search', query });
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = '36px';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    // ── Quick actions ──
    document.querySelectorAll('.action-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'context') {
          addMessage('user', '📄 Get context for current file');
          vscode.postMessage({ type: 'getContext' });
        } else if (action === 'projects') {
          addMessage('user', '📚 List projects');
          vscode.postMessage({ type: 'listProjects' });
        }
      });
    });

    // Settings button
    document.getElementById('btnSettings').addEventListener('click', () => {
      vscode.postMessage({ type: 'configure' });
    });

    // ── Add message to chat ──
    function addMessage(role, content) {
      // Remove welcome
      const welcome = chatArea.querySelector('.welcome');
      if (welcome) welcome.remove();

      const msg = document.createElement('div');
      msg.className = 'message ' + role;
      msg.innerHTML = '<div class="bubble">' + escapeHtml(content) + '</div>';
      chatArea.appendChild(msg);
      scrollBottom();
    }

    function addBotHtml(html) {
      const welcome = chatArea.querySelector('.welcome');
      if (welcome) welcome.remove();

      const msg = document.createElement('div');
      msg.className = 'message bot';
      msg.innerHTML = '<div class="bubble">' + html + '</div>';
      chatArea.appendChild(msg);
      scrollBottom();
    }

    function showLoading() {
      removeLoading();
      const el = document.createElement('div');
      el.className = 'message bot loading-msg';
      el.innerHTML = '<div class="bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div>';
      chatArea.appendChild(el);
      scrollBottom();
      isLoading = true;
      sendBtn.disabled = true;
    }

    function removeLoading() {
      const el = chatArea.querySelector('.loading-msg');
      if (el) el.remove();
      isLoading = false;
      sendBtn.disabled = false;
    }

    function scrollBottom() {
      chatArea.scrollTop = chatArea.scrollHeight;
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ── Handle messages from extension ──
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'loading') {
        if (msg.loading) showLoading();
        else removeLoading();
        return;
      }

      removeLoading();

      switch (msg.type) {
        case 'searchResults':
          renderSearchResults(msg);
          break;
        case 'contextResults':
          renderContextResults(msg);
          break;
        case 'projectList':
          renderProjects(msg);
          break;
        case 'error':
          addBotHtml('<span style="color: #f87171;">⚠ ' + escapeHtml(msg.message) + '</span>');
          break;
      }
    });

    // ── Renderers ──
    function renderSearchResults(msg) {
      if (msg.results.length === 0) {
        addBotHtml('No results found for <strong>' + escapeHtml(msg.query) + '</strong>. Try a different query or make sure you\\'ve indexed the relevant docs.');
        return;
      }

      let html = '<div style="margin-bottom:6px;opacity:0.6;font-size:11px;">' + msg.total + ' results for <strong>' + escapeHtml(msg.query) + '</strong></div>';

      for (const r of msg.results) {
        html += renderResultCard(r);
      }

      addBotHtml(html);
    }

    function renderResultCard(r) {
      let html = '<div class="result-card">';
      html += '<div class="rc-header">';
      html += '<span class="rc-badge">' + escapeHtml(r.nodeType) + '</span>';
      html += '<span class="rc-label">' + escapeHtml(r.label) + '</span>';
      html += '</div>';
      html += '<div class="rc-project">' + escapeHtml(r.project) + '</div>';
      if (r.description) {
        html += '<div class="rc-desc">' + escapeHtml(r.description) + '</div>';
      }
      if (r.ref) {
        html += '<div class="rc-ref">' + escapeHtml(r.ref) + '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderContextResults(msg) {
      let html = '<div style="margin-bottom:6px"><strong>Context for</strong> <code>' + escapeHtml(msg.filePath.split('/').pop() || msg.filePath) + '</code></div>';

      if (msg.imports && msg.imports.length > 0) {
        html += '<div class="context-section"><div class="cs-title">Detected Imports</div><div class="import-tags">';
        for (const imp of msg.imports) {
          html += '<span class="import-tag">' + escapeHtml(imp) + '</span>';
        }
        html += '</div></div>';
      }

      if (msg.items.length === 0) {
        html += '<div style="opacity:0.6;font-size:11px;margin-top:8px;">No matching documentation found for this file.</div>';
      } else {
        html += '<div class="context-section"><div class="cs-title">' + msg.items.length + ' Context Items</div>';
        for (const item of msg.items) {
          html += renderResultCard(item);
        }
        html += '</div>';
      }

      addBotHtml(html);
    }

    function renderProjects(msg) {
      if (msg.projects.length === 0) {
        addBotHtml('No projects found. Index some documentation at your DocsStudio dashboard first!');
        return;
      }

      let html = '<div style="margin-bottom:6px;font-size:11px;opacity:0.6;">' + msg.projects.length + ' projects</div>';

      for (const p of msg.projects) {
        html += '<div class="project-card">';
        html += '<div class="pc-name">⚡ ' + escapeHtml(p.name) + '</div>';
        html += '<div class="pc-url">' + escapeHtml(p.url) + '</div>';
        html += '<div class="pc-stats">';
        html += '<div><span>' + p.docs + '</span> docs</div>';
        html += '<div><span>' + p.nodes + '</span> nodes</div>';
        html += '<div>' + escapeHtml(p.status) + '</div>';
        html += '</div></div>';
      }

      addBotHtml(html);
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
