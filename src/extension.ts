/**
 * DocsStudio VS Code Extension
 * ============================
 * Detects dependencies in your workspace, matches them to indexed
 * documentation, and delivers relevant context via commands.
 *
 * Features:
 * - Reads workspace manifests to detect dependencies
 * - Matches dependencies to DocsStudio projects
 * - Manual commands for searching docs, refreshing context
 * - Status bar showing connection status and matched projects
 */

import * as vscode from "vscode";
import { DocsStudioClient } from "./api/client";
import { ContextSelector, SelectedContext } from "./context/selector";
import {
  detectManifestDependencies,
  getUniqueDependencyNames,
  DetectedDependency,
} from "./dependencies/detector";

// ─── State ───────────────────────────────────────────────────────────

let client: DocsStudioClient;
let contextSelector: ContextSelector;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

// Cached state
let matchedProjects: Map<string, { id: string; name: string; base_url: string }> =
  new Map();
let detectedDeps: string[] = [];
let isConnected = false;
let lastContextInjection: SelectedContext | null = null;

// Debounce timers
let fileChangeTimer: ReturnType<typeof setTimeout> | undefined;
let contextRefreshTimer: ReturnType<typeof setTimeout> | undefined;

// ─── Activation ──────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("DocsStudio");
  log("DocsStudio extension activating...");

  // Initialize client
  const config = vscode.workspace.getConfiguration("docsstudio");
  const apiUrl = config.get<string>("apiUrl", "https://docsstudio.dev/api");
  const userId = config.get<string>("userId", "");

  client = new DocsStudioClient(apiUrl, userId);
  const maxTokens = config.get<number>("maxContextTokens", 8000);
  contextSelector = new ContextSelector(client, maxTokens);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "docsstudio.showProjects";
  context.subscriptions.push(statusBarItem);
  updateStatusBar(userId ? "disconnected" : "unconfigured");

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "docsstudio.refreshContext",
      cmdRefreshContext
    ),
    vscode.commands.registerCommand(
      "docsstudio.showProjects",
      cmdShowProjects
    ),
    vscode.commands.registerCommand(
      "docsstudio.searchDocs",
      cmdSearchDocs
    ),
    vscode.commands.registerCommand(
      "docsstudio.getFileContext",
      cmdInjectContext
    ),
    vscode.commands.registerCommand("docsstudio.startMcp", cmdStartMcp),
    vscode.commands.registerCommand("docsstudio.configure", cmdConfigure)
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("docsstudio")) {
        onConfigChange();
      }
    })
  );

  log("DocsStudio extension activated. Run a command to connect.");
}

export function deactivate() {
  if (fileChangeTimer) {
    clearTimeout(fileChangeTimer);
  }
  if (contextRefreshTimer) {
    clearTimeout(contextRefreshTimer);
  }
}

async function checkConnection(): Promise<boolean> {
  try {
    const healthy = await client.healthCheck();
    isConnected = healthy;
    if (healthy) {
      updateStatusBar("connected");
      log("Connected to DocsStudio backend.");
    } else {
      updateStatusBar("disconnected");
      log("Cannot connect to DocsStudio backend.");
    }
    return healthy;
  } catch (error) {
    isConnected = false;
    updateStatusBar("disconnected");
    log(
      `Connection check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

// ─── Dependency Detection ────────────────────────────────────────────

async function detectWorkspaceDependencies() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  const allDeps: DetectedDependency[] = [];

  for (const folder of workspaceFolders) {
    const manifestDeps = detectManifestDependencies(folder.uri.fsPath);
    allDeps.push(...manifestDeps);
  }

  detectedDeps = getUniqueDependencyNames(allDeps);
  log(`Detected ${detectedDeps.length} dependencies from manifests`);

  if (detectedDeps.length > 0 && isConnected) {
    await matchDependenciesToProjects();
  }
}

async function matchDependenciesToProjects() {
  if (detectedDeps.length === 0) return;

  try {
    const response = await client.matchDependencies(detectedDeps);
    matchedProjects.clear();

    for (const match of response.matches) {
      if (!matchedProjects.has(match.project_id)) {
        matchedProjects.set(match.project_id, {
          id: match.project_id,
          name: match.project_name,
          base_url: match.base_url,
        });
      }
    }

    log(
      `Matched ${matchedProjects.size} projects: ${Array.from(
        matchedProjects.values()
      )
        .map((p) => p.name)
        .join(", ")}`
    );

    updateStatusBar(
      matchedProjects.size > 0 ? "matched" : "connected"
    );
  } catch (error) {
    log(
      `Dependency matching failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── File Watchers ───────────────────────────────────────────────────

// ─── Commands ────────────────────────────────────────────────────────

async function cmdRefreshContext() {
  if (!isConnected) {
    const connected = await checkConnection();
    if (!connected) {
      vscode.window.showWarningMessage(
        "Cannot connect to DocsStudio backend. Check your API URL and ensure the server is running."
      );
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DocsStudio: Refreshing context...",
    },
    async () => {
      await detectWorkspaceDependencies();
      vscode.window.showInformationMessage(
        `DocsStudio: Found ${detectedDeps.length} deps, matched ${matchedProjects.size} projects.`
      );
    }
  );
}

async function cmdShowProjects() {
  if (!isConnected) {
    const action = await vscode.window.showWarningMessage(
      "DocsStudio is not connected. Configure your settings?",
      "Configure",
      "Cancel"
    );
    if (action === "Configure") {
      await cmdConfigure();
    }
    return;
  }

  try {
    const summary = await client.getProjectsSummary();

    if (summary.projects.length === 0) {
      vscode.window.showInformationMessage(
        "No documentation projects found. Index docs at your DocsStudio dashboard."
      );
      return;
    }

    const items: vscode.QuickPickItem[] = summary.projects.map((p) => ({
      label: `$(book) ${p.name}`,
      description: p.base_url,
      detail: `${p.document_count} docs, ${p.graph_node_count} graph nodes — ${p.status}`,
    }));

    // Show which projects are matched
    for (const item of items) {
      const name = item.label.replace("$(book) ", "");
      const isMatched = Array.from(matchedProjects.values()).some(
        (p) => p.name === name
      );
      if (isMatched) {
        item.label = `$(check) ${name}`;
        item.description += " (matched to workspace)";
      }
    }

    await vscode.window.showQuickPick(items, {
      title: "DocsStudio Projects",
      placeHolder: "Your indexed documentation projects",
    });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to load projects: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function cmdSearchDocs() {
  if (!isConnected) {
    vscode.window.showWarningMessage("DocsStudio is not connected.");
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: "Search documentation",
    placeHolder: "e.g., 'create customer', 'webhook verification', 'auth flow'",
  });

  if (!query) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DocsStudio: Searching...",
    },
    async () => {
      try {
        const response = await client.searchContext(query);

        if (response.results.length === 0) {
          vscode.window.showInformationMessage(
            `No results for "${query}".`
          );
          return;
        }

        // Show results in quick pick
        const items: vscode.QuickPickItem[] = response.results
          .slice(0, 20)
          .map((r) => {
            if (r.type === "graph_node") {
              return {
                label: `$(symbol-${getNodeIcon(r.node_type || "")}) ${r.label}`,
                description: r.canonical_ref || "",
                detail: `[${r.node_type}] ${r.project_name}: ${(r.description || "").slice(0, 120)}`,
              };
            } else {
              const heading = (r.heading_path || []).join(" > ");
              return {
                label: `$(file) ${heading || "Documentation"}`,
                description: r.project_name,
                detail: (r.text || "").slice(0, 120),
              };
            }
          });

        const selected = await vscode.window.showQuickPick(items, {
          title: `Search Results for "${query}"`,
          placeHolder: `${response.total} results found`,
        });

        if (selected) {
          // Show detail in output channel
          const idx = items.indexOf(selected);
          const result = response.results[idx];
          outputChannel.clear();
          outputChannel.appendLine(`Search Result: ${query}`);
          outputChannel.appendLine("─".repeat(50));
          if (result.type === "graph_node") {
            outputChannel.appendLine(`Type: ${result.node_type}`);
            outputChannel.appendLine(`Label: ${result.label}`);
            if (result.canonical_ref)
              outputChannel.appendLine(`Ref: ${result.canonical_ref}`);
            outputChannel.appendLine(`Project: ${result.project_name}`);
            outputChannel.appendLine(`\n${result.description || ""}`);
          } else {
            outputChannel.appendLine(
              `Heading: ${(result.heading_path || []).join(" > ")}`
            );
            outputChannel.appendLine(`Project: ${result.project_name}`);
            outputChannel.appendLine(`\n${result.text || ""}`);
          }
          outputChannel.show();
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Search failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

async function cmdInjectContext() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }

  if (!isConnected) {
    vscode.window.showWarningMessage("DocsStudio is not connected.");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DocsStudio: Getting context...",
    },
    async () => {
      try {
        const content = editor.document.getText();
        const filePath = editor.document.uri.fsPath;
        const projectIds = Array.from(matchedProjects.keys());

        const ctx = await contextSelector.getContextForFile(
          content,
          filePath,
          projectIds.length > 0 ? projectIds : undefined
        );

        lastContextInjection = ctx;

        if (!ctx.text || ctx.itemCount === 0) {
          vscode.window.showInformationMessage(
            "No relevant documentation context found for this file."
          );
          return;
        }

        // Show in output channel
        outputChannel.clear();
        outputChannel.appendLine("DocsStudio — Documentation Context");
        outputChannel.appendLine("═".repeat(50));
        outputChannel.appendLine(
          `Projects: ${ctx.projects.map((p) => p.name).join(", ")}`
        );
        outputChannel.appendLine(`Items: ${ctx.itemCount}`);
        outputChannel.appendLine(
          `Estimated tokens: ~${ctx.estimatedTokens}`
        );
        outputChannel.appendLine("─".repeat(50));
        outputChannel.appendLine(ctx.text);
        outputChannel.show();

        // Copy to clipboard
        await vscode.env.clipboard.writeText(ctx.text);

        vscode.window.showInformationMessage(
          `DocsStudio: Context copied to clipboard (${ctx.itemCount} items, ~${ctx.estimatedTokens} tokens from ${ctx.projects.map((p) => p.name).join(", ")})`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Context retrieval failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

async function cmdStartMcp() {
  const config = vscode.workspace.getConfiguration("docsstudio");
  const userId = config.get<string>("userId", "");
  const apiUrl = config.get<string>("apiUrl", "https://docsstudio.dev/api");

  if (!userId) {
    vscode.window.showWarningMessage(
      "Please configure your DocsStudio User ID first."
    );
    await cmdConfigure();
    return;
  }

  // The MCP server is auto-started via package.json mcpServers contribution.
  // This command provides info and manual restart capabilities.
  const action = await vscode.window.showInformationMessage(
    `DocsStudio MCP server is configured.\n\nAPI: ${apiUrl}\nUser: ${userId ? "Set" : "Not set"}\n\nThe server auto-starts when your AI client requests it via MCP.`,
    "View Config",
    "Open Output"
  );

  if (action === "View Config") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "docsstudio"
    );
  } else if (action === "Open Output") {
    outputChannel.show();
  }
}

async function cmdConfigure() {
  const config = vscode.workspace.getConfiguration("docsstudio");
  const currentUrl = config.get<string>("apiUrl", "https://docsstudio.dev/api");
  const currentUserId = config.get<string>("userId", "");

  // API URL
  const apiUrl = await vscode.window.showInputBox({
    prompt: "DocsStudio API URL",
    value: currentUrl,
    placeHolder: "https://docsstudio.dev/api",
  });

  if (apiUrl === undefined) return; // Cancelled

  // User ID
  const userId = await vscode.window.showInputBox({
    prompt: "Your Clerk User ID (from DocsStudio dashboard)",
    value: currentUserId,
    placeHolder: "user_xxxxxxxxxxxxxxxxxxxxxxxxxx",
  });

  if (userId === undefined) return; // Cancelled

  // Save configuration
  await config.update("apiUrl", apiUrl, vscode.ConfigurationTarget.Global);
  await config.update("userId", userId, vscode.ConfigurationTarget.Global);

  // Reinitialize
  onConfigChange();

  vscode.window.showInformationMessage(
    "DocsStudio configuration saved. Testing connection..."
  );
}

// ─── Config Change Handler ───────────────────────────────────────────

function onConfigChange() {
  const config = vscode.workspace.getConfiguration("docsstudio");
  const apiUrl = config.get<string>("apiUrl", "https://docsstudio.dev/api");
  const userId = config.get<string>("userId", "");
  const maxTokens = config.get<number>("maxContextTokens", 8000);

  client.updateConfig(apiUrl, userId);
  contextSelector.setMaxTokens(maxTokens);

  log(`Configuration updated: API=${apiUrl}, User=${userId ? "set" : "not set"}`);

  // Reset connection state so next command re-checks
  isConnected = false;
  updateStatusBar(userId ? "disconnected" : "unconfigured");
}

// ─── Status Bar ──────────────────────────────────────────────────────

function updateStatusBar(
  state:
    | "initializing"
    | "connected"
    | "disconnected"
    | "unconfigured"
    | "matched"
) {
  switch (state) {
    case "initializing":
      statusBarItem.text = "$(loading~spin) DocsStudio";
      statusBarItem.tooltip = "DocsStudio: Initializing...";
      statusBarItem.backgroundColor = undefined;
      break;
    case "connected":
      statusBarItem.text = "$(plug) DocsStudio";
      statusBarItem.tooltip =
        "DocsStudio: Connected. Click to view projects.";
      statusBarItem.backgroundColor = undefined;
      break;
    case "disconnected":
      statusBarItem.text = "$(debug-disconnect) DocsStudio";
      statusBarItem.tooltip =
        "DocsStudio: Disconnected. Click to reconnect.";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      break;
    case "unconfigured":
      statusBarItem.text = "$(gear) DocsStudio";
      statusBarItem.tooltip =
        "DocsStudio: Not configured. Click to set up.";
      statusBarItem.command = "docsstudio.configure";
      statusBarItem.backgroundColor = undefined;
      break;
    case "matched":
      const count = matchedProjects.size;
      statusBarItem.text = `$(book) DocsStudio (${count})`;
      statusBarItem.tooltip = `DocsStudio: ${count} matched project${count !== 1 ? "s" : ""}. Click to view.`;
      statusBarItem.backgroundColor = undefined;
      break;
  }

  statusBarItem.show();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

function getNodeIcon(nodeType: string): string {
  const icons: Record<string, string> = {
    endpoint: "method",
    concept: "symbol-class",
    schema: "symbol-structure",
    auth_flow: "shield",
    error: "error",
    webhook: "bell",
    rate_limit_rule: "dashboard",
    guide: "book",
    flow: "git-merge",
    sdk_method: "symbol-function",
    event: "zap",
    field: "symbol-field",
    resource: "symbol-namespace",
    example: "code",
    tooling: "tools",
    environment: "server",
  };
  return icons[nodeType] || "symbol-misc";
}
