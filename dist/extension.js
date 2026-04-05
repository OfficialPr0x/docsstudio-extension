"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));

// src/api/client.ts
var https = __toESM(require("https"));
var http = __toESM(require("http"));
var import_url = require("url");
var DocsStudioClient = class _DocsStudioClient {
  static {
    __name(this, "DocsStudioClient");
  }
  apiUrl;
  userId;
  constructor(apiUrl, userId) {
    this.apiUrl = _DocsStudioClient.validateUrl(apiUrl);
    this.userId = userId;
  }
  updateConfig(apiUrl, userId) {
    this.apiUrl = _DocsStudioClient.validateUrl(apiUrl);
    this.userId = userId;
  }
  static validateUrl(raw) {
    const trimmed = raw.replace(/\/+$/, "");
    try {
      const parsed = new import_url.URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("API URL must use http or https");
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch (e) {
      if (e instanceof Error && e.message.includes("http")) throw e;
      throw new Error(`Invalid API URL: ${trimmed}`);
    }
  }
  async request(method, path2, body) {
    const url = new import_url.URL(`${this.apiUrl}${path2}`);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": this.userId
        },
        timeout: 3e4
      };
      const req = transport.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          } else {
            let detail = data;
            try {
              const parsed = JSON.parse(data);
              detail = parsed.detail || data;
            } catch {
            }
            reject(
              new Error(`API error ${res.statusCode}: ${detail}`)
            );
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  // ─── Project APIs ────────────────────────────────────────────────
  async getProjectsSummary() {
    return this.request("GET", "/context/projects-summary");
  }
  async getProject(projectId) {
    return this.request("GET", `/projects/${projectId}`);
  }
  // ─── Context Search ──────────────────────────────────────────────
  async searchContext(query, projectId, nodeTypes, limit = 20) {
    return this.request("POST", "/context/search", {
      query,
      project_id: projectId || null,
      node_types: nodeTypes || null,
      limit
    });
  }
  // ─── Dependency Matching ─────────────────────────────────────────
  async matchDependencies(dependencies) {
    return this.request("POST", "/context/match-deps", {
      dependencies
    });
  }
  // ─── File Context ────────────────────────────────────────────────
  async getContextForFile(fileContent, filePath, projectIds, limit = 15) {
    return this.request("POST", "/context/for-file", {
      file_content: fileContent,
      file_path: filePath,
      project_ids: projectIds || null,
      limit
    });
  }
  // ─── Endpoint Lookup ─────────────────────────────────────────────
  async lookupEndpoint(options) {
    return this.request("POST", "/context/endpoint-lookup", {
      method: options.method || null,
      path: options.path || null,
      query: options.query || null,
      project_id: options.projectId || null
    });
  }
  // ─── Context Package ─────────────────────────────────────────────
  async getContextPackage(projectId) {
    return this.request("POST", `/projects/${projectId}/context-package`);
  }
  // ─── Graph Data ──────────────────────────────────────────────────
  async getGraph(projectId, nodeTypes, limit = 500) {
    let path2 = `/projects/${projectId}/graph?limit=${limit}`;
    if (nodeTypes?.length) {
      path2 += `&node_types=${nodeTypes.join(",")}`;
    }
    return this.request("GET", path2);
  }
  // ─── Context Injection (server-formatted) ───────────────────────
  async injectContextForFile(filePath, fileContent, options) {
    return this.request("POST", "/context-inject/for-file", {
      file_path: filePath,
      file_content: fileContent,
      query: options?.query || "",
      max_tokens: options?.maxTokens || 4e3,
      format: options?.format || "markdown",
      project_ids: options?.projectIds || null
    });
  }
  // ─── Health Check ────────────────────────────────────────────────
  async healthCheck() {
    try {
      await this.getProjectsSummary();
      return true;
    } catch {
      return false;
    }
  }
};

// src/context/selector.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
__name(estimateTokens, "estimateTokens");
var ContextSelector = class {
  static {
    __name(this, "ContextSelector");
  }
  client;
  maxTokens;
  constructor(client2, maxTokens = 8e3) {
    this.client = client2;
    this.maxTokens = maxTokens;
  }
  setMaxTokens(tokens) {
    this.maxTokens = tokens;
  }
  /**
   * Get context for the currently open file.
   * This is the primary context delivery method.
   */
  async getContextForFile(fileContent, filePath, projectIds) {
    const response = await this.client.getContextForFile(
      fileContent,
      filePath,
      projectIds,
      30
    );
    const sections = [];
    const projects = /* @__PURE__ */ new Map();
    for (const proj of response.matched_projects || []) {
      projects.set(proj.id, proj.name);
    }
    const byProject = /* @__PURE__ */ new Map();
    for (const item of response.context) {
      if (!byProject.has(item.project_id)) {
        byProject.set(item.project_id, /* @__PURE__ */ new Map());
        projects.set(item.project_id, item.project_name);
      }
      const projMap = byProject.get(item.project_id);
      if (!projMap.has(item.node_type)) {
        projMap.set(item.node_type, []);
      }
      projMap.get(item.node_type).push(item);
    }
    for (const [projectId, typeMap] of byProject) {
      const projectName = projects.get(projectId) || "Unknown";
      const authItems = typeMap.get("auth_flow") || [];
      if (authItems.length > 0) {
        const lines = [`## Authentication \u2014 ${projectName}`];
        for (const item of authItems) {
          lines.push(
            `- **${item.label}**${item.canonical_ref ? ` (\`${item.canonical_ref}\`)` : ""}: ${item.description || ""}`
          );
        }
        const content = lines.join("\n");
        sections.push({
          title: `auth_${projectId}`,
          priority: 1,
          content,
          tokens: estimateTokens(content)
        });
      }
      const endpointItems = typeMap.get("endpoint") || [];
      if (endpointItems.length > 0) {
        const lines = [`## API Endpoints \u2014 ${projectName}`];
        for (const item of endpointItems.slice(0, 15)) {
          const ref = item.canonical_ref || item.label;
          lines.push(`- \`${ref}\`: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `endpoints_${projectId}`,
          priority: 2,
          content,
          tokens: estimateTokens(content)
        });
      }
      const schemaItems = typeMap.get("schema") || [];
      if (schemaItems.length > 0) {
        const lines = [`## Data Models \u2014 ${projectName}`];
        for (const item of schemaItems.slice(0, 10)) {
          lines.push(`- **${item.label}**: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `schemas_${projectId}`,
          priority: 3,
          content,
          tokens: estimateTokens(content)
        });
      }
      const errorItems = typeMap.get("error") || [];
      if (errorItems.length > 0) {
        const lines = [`## Error Codes \u2014 ${projectName}`];
        for (const item of errorItems.slice(0, 10)) {
          lines.push(`- **${item.label}**: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `errors_${projectId}`,
          priority: 4,
          content,
          tokens: estimateTokens(content)
        });
      }
      const webhookItems = typeMap.get("webhook") || [];
      if (webhookItems.length > 0) {
        const lines = [`## Webhooks \u2014 ${projectName}`];
        for (const item of webhookItems.slice(0, 10)) {
          lines.push(
            `- \`${item.canonical_ref || item.label}\`: ${item.description || ""}`
          );
        }
        const content = lines.join("\n");
        sections.push({
          title: `webhooks_${projectId}`,
          priority: 5,
          content,
          tokens: estimateTokens(content)
        });
      }
      const otherTypes = ["concept", "guide", "rate_limit_rule", "sdk_method", "flow"];
      const otherItems = [];
      for (const t of otherTypes) {
        otherItems.push(...typeMap.get(t) || []);
      }
      if (otherItems.length > 0) {
        const lines = [`## Additional Context \u2014 ${projectName}`];
        for (const item of otherItems.slice(0, 10)) {
          lines.push(`- **${item.label}** (${item.node_type}): ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `other_${projectId}`,
          priority: 6,
          content,
          tokens: estimateTokens(content)
        });
      }
    }
    return this.assembleSections(sections, projects);
  }
  /**
   * Get context from a search query.
   */
  async getContextForQuery(query, projectId) {
    const response = await this.client.searchContext(
      query,
      projectId,
      void 0,
      30
    );
    const sections = [];
    const projects = /* @__PURE__ */ new Map();
    const graphNodes = response.results.filter(
      (r) => r.type === "graph_node"
    );
    const docChunks = response.results.filter(
      (r) => r.type === "doc_chunk"
    );
    if (graphNodes.length > 0) {
      const lines = ["## Relevant API Documentation"];
      for (const node of graphNodes.slice(0, 20)) {
        projects.set(node.project_id, node.project_name);
        const ref = node.canonical_ref ? ` (\`${node.canonical_ref}\`)` : "";
        lines.push(
          `- **${node.label}**${ref} [${node.node_type}]: ${node.description || ""}`
        );
      }
      const content = lines.join("\n");
      sections.push({
        title: "graph_results",
        priority: 1,
        content,
        tokens: estimateTokens(content)
      });
    }
    if (docChunks.length > 0) {
      const lines = ["## Documentation Excerpts"];
      for (const chunk of docChunks.slice(0, 10)) {
        projects.set(chunk.project_id, chunk.project_name);
        const heading = (chunk.heading_path || []).join(" > ");
        lines.push(`### ${heading || "Section"} (${chunk.project_name})`);
        lines.push(chunk.text || "");
        lines.push("");
      }
      const content = lines.join("\n");
      sections.push({
        title: "doc_chunks",
        priority: 2,
        content,
        tokens: estimateTokens(content)
      });
    }
    return this.assembleSections(sections, projects);
  }
  /**
   * Get context for a specific endpoint.
   */
  async getEndpointContext(method, apiPath, projectId) {
    const response = await this.client.lookupEndpoint({
      method,
      path: apiPath,
      projectId
    });
    const sections = [];
    const projects = /* @__PURE__ */ new Map();
    for (const ep of response.endpoints) {
      projects.set(ep.project_id, ep.project_name);
      const overviewLines = [
        `## \`${ep.method} ${ep.path}\` \u2014 ${ep.label}`,
        "",
        ep.description
      ];
      const overviewContent = overviewLines.join("\n");
      sections.push({
        title: `ep_overview_${ep.canonical_ref}`,
        priority: 1,
        content: overviewContent,
        tokens: estimateTokens(overviewContent)
      });
      if (ep.auth.length > 0) {
        const authLines = ["### Authentication Required"];
        for (const a of ep.auth) {
          authLines.push(`- **${a.type}**: ${a.description}`);
        }
        const authContent = authLines.join("\n");
        sections.push({
          title: `ep_auth_${ep.canonical_ref}`,
          priority: 2,
          content: authContent,
          tokens: estimateTokens(authContent)
        });
      }
      if (ep.errors.length > 0) {
        const errLines = ["### Error Responses"];
        for (const e of ep.errors) {
          errLines.push(`- **${e.code || e.label}**: ${e.description}`);
        }
        const errContent = errLines.join("\n");
        sections.push({
          title: `ep_errors_${ep.canonical_ref}`,
          priority: 3,
          content: errContent,
          tokens: estimateTokens(errContent)
        });
      }
      if (ep.related.length > 0) {
        const relLines = ["### Related"];
        for (const r of ep.related) {
          relLines.push(
            `- ${r.label} (${r.node_type}) \u2014 ${r.edge_type}: ${r.description}`
          );
        }
        const relContent = relLines.join("\n");
        sections.push({
          title: `ep_related_${ep.canonical_ref}`,
          priority: 4,
          content: relContent,
          tokens: estimateTokens(relContent)
        });
      }
    }
    return this.assembleSections(sections, projects);
  }
  /**
   * Assemble context sections into a single context block,
   * respecting the token budget.
   */
  assembleSections(sections, projects) {
    sections.sort((a, b) => a.priority - b.priority);
    const included = [];
    let totalTokens = 0;
    let itemCount = 0;
    const header = `<docs_context source="DocsStudio">`;
    const footer = `</docs_context>`;
    const headerTokens = estimateTokens(header) + estimateTokens(footer);
    totalTokens += headerTokens;
    for (const section of sections) {
      if (totalTokens + section.tokens > this.maxTokens) {
        const remaining = this.maxTokens - totalTokens;
        if (remaining > 100) {
          const truncated = section.content.slice(0, remaining * 4);
          included.push(truncated + "\n[...truncated]");
          totalTokens += estimateTokens(truncated);
          itemCount++;
        }
        break;
      }
      included.push(section.content);
      totalTokens += section.tokens;
      itemCount++;
    }
    const projectList = Array.from(projects.entries()).map(([id, name]) => ({
      id,
      name
    }));
    if (included.length === 0) {
      return {
        text: "",
        estimatedTokens: 0,
        projects: projectList,
        itemCount: 0
      };
    }
    const text = [header, ...included, footer].join("\n\n");
    return {
      text,
      estimatedTokens: totalTokens,
      projects: projectList,
      itemCount
    };
  }
};

// src/dependencies/detector.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function parsePackageJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const pkg = JSON.parse(content);
    const deps = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const sectionDeps = pkg[section] || {};
      for (const [name, version] of Object.entries(sectionDeps)) {
        deps.push({
          name,
          source: "manifest",
          sourceFile: filePath,
          version: String(version)
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parsePackageJson, "parsePackageJson");
function parseRequirementsTxt(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      const match = trimmed.match(/^([a-zA-Z0-9_-]+(?:\[[^\]]+\])?)\s*(?:[><=~!]+\s*(.+))?$/);
      if (match) {
        const name = match[1].replace(/\[.+\]/, "");
        deps.push({
          name,
          source: "manifest",
          sourceFile: filePath,
          version: match[2]
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parseRequirementsTxt, "parseRequirementsTxt");
function parsePyprojectToml(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps = [];
    const depsMatch = content.match(/\[(?:project\.)?dependencies\]\s*\n((?:(?!^\[).+\n?)*)/m);
    if (depsMatch) {
      for (const line of depsMatch[1].split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^"?([a-zA-Z0-9_-]+)/);
        if (match) {
          deps.push({
            name: match[1],
            source: "manifest",
            sourceFile: filePath
          });
        }
      }
    }
    const arrayMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      const matches = arrayMatch[1].matchAll(/"([a-zA-Z0-9_-]+)(?:\[.+?\])?(?:\s*[><=~!].+)?"/g);
      for (const m of matches) {
        deps.push({
          name: m[1],
          source: "manifest",
          sourceFile: filePath
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parsePyprojectToml, "parsePyprojectToml");
function parseGoMod(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps = [];
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      for (const line of requireBlock[1].split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//")) continue;
        const match = trimmed.match(/^([\w./-]+)\s+(.+)/);
        if (match) {
          const parts = match[1].split("/");
          const name = parts.length >= 3 ? parts[2] : parts[parts.length - 1];
          deps.push({
            name,
            source: "manifest",
            sourceFile: filePath,
            version: match[2]
          });
        }
      }
    }
    for (const m of content.matchAll(/^require\s+([\w./-]+)\s+(.+)$/gm)) {
      const parts = m[1].split("/");
      deps.push({
        name: parts.length >= 3 ? parts[2] : parts[parts.length - 1],
        source: "manifest",
        sourceFile: filePath,
        version: m[2]
      });
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parseGoMod, "parseGoMod");
function parseCargoToml(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps = [];
    const depsSection = content.match(/\[dependencies\]\s*\n((?:(?!^\[).+\n?)*)/m);
    if (depsSection) {
      for (const line of depsSection[1].split("\n")) {
        const match = line.match(/^(\w[\w-]*)\s*=/);
        if (match) {
          deps.push({
            name: match[1],
            source: "manifest",
            sourceFile: filePath
          });
        }
      }
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parseCargoToml, "parseCargoToml");
function parseGemfile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps = [];
    for (const m of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) {
      deps.push({
        name: m[1],
        source: "manifest",
        sourceFile: filePath
      });
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parseGemfile, "parseGemfile");
function parseComposerJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const pkg = JSON.parse(content);
    const deps = [];
    for (const section of ["require", "require-dev"]) {
      const sectionDeps = pkg[section] || {};
      for (const [name, version] of Object.entries(sectionDeps)) {
        if (name === "php" || name.startsWith("ext-")) continue;
        deps.push({
          name: name.split("/").pop() || name,
          source: "manifest",
          sourceFile: filePath,
          version: String(version)
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}
__name(parseComposerJson, "parseComposerJson");
var MANIFEST_PARSERS = {
  "package.json": parsePackageJson,
  "requirements.txt": parseRequirementsTxt,
  "pyproject.toml": parsePyprojectToml,
  "Pipfile": parseRequirementsTxt,
  // Similar enough format
  "go.mod": parseGoMod,
  "Cargo.toml": parseCargoToml,
  "Gemfile": parseGemfile,
  "composer.json": parseComposerJson
};
function detectManifestDependencies(workspaceRoot) {
  const deps = [];
  for (const [filename, parser] of Object.entries(MANIFEST_PARSERS)) {
    const filePath = path.join(workspaceRoot, filename);
    if (fs.existsSync(filePath)) {
      deps.push(...parser(filePath));
    }
    try {
      const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          const subPath = path.join(workspaceRoot, entry.name, filename);
          if (fs.existsSync(subPath)) {
            deps.push(...parser(subPath));
          }
        }
      }
    } catch {
    }
  }
  return deps;
}
__name(detectManifestDependencies, "detectManifestDependencies");
function getUniqueDependencyNames(deps) {
  const seen = /* @__PURE__ */ new Set();
  return deps.map((d) => d.name.toLowerCase()).filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
__name(getUniqueDependencyNames, "getUniqueDependencyNames");

// src/extension.ts
var client;
var contextSelector;
var statusBarItem;
var outputChannel;
var matchedProjects = /* @__PURE__ */ new Map();
var detectedDeps = [];
var isConnected = false;
var fileChangeTimer;
var contextRefreshTimer;
function activate(context) {
  outputChannel = vscode.window.createOutputChannel("DocsStudio");
  log("DocsStudio extension activating...");
  const config = vscode.workspace.getConfiguration("docsstudio");
  const apiUrl = config.get("apiUrl", "https://docsstudio.dev/api");
  const userId = config.get("userId", "");
  client = new DocsStudioClient(apiUrl, userId);
  const maxTokens = config.get("maxContextTokens", 8e3);
  contextSelector = new ContextSelector(client, maxTokens);
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "docsstudio.showProjects";
  context.subscriptions.push(statusBarItem);
  updateStatusBar(userId ? "disconnected" : "unconfigured");
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
    vscode.commands.registerCommand("docsstudio.configure", cmdConfigure)
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("docsstudio")) {
        onConfigChange();
      }
    })
  );
  log("DocsStudio extension activated. Run a command to connect.");
}
__name(activate, "activate");
function deactivate() {
  if (fileChangeTimer) {
    clearTimeout(fileChangeTimer);
  }
  if (contextRefreshTimer) {
    clearTimeout(contextRefreshTimer);
  }
}
__name(deactivate, "deactivate");
async function checkConnection() {
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
__name(checkConnection, "checkConnection");
async function detectWorkspaceDependencies() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;
  const allDeps = [];
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
__name(detectWorkspaceDependencies, "detectWorkspaceDependencies");
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
          base_url: match.base_url
        });
      }
    }
    log(
      `Matched ${matchedProjects.size} projects: ${Array.from(
        matchedProjects.values()
      ).map((p) => p.name).join(", ")}`
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
__name(matchDependenciesToProjects, "matchDependenciesToProjects");
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
      title: "DocsStudio: Refreshing context..."
    },
    async () => {
      await detectWorkspaceDependencies();
      vscode.window.showInformationMessage(
        `DocsStudio: Found ${detectedDeps.length} deps, matched ${matchedProjects.size} projects.`
      );
    }
  );
}
__name(cmdRefreshContext, "cmdRefreshContext");
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
    const items = summary.projects.map((p) => ({
      label: `$(book) ${p.name}`,
      description: p.base_url,
      detail: `${p.document_count} docs, ${p.graph_node_count} graph nodes \u2014 ${p.status}`
    }));
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
      placeHolder: "Your indexed documentation projects"
    });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to load projects: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
__name(cmdShowProjects, "cmdShowProjects");
async function cmdSearchDocs() {
  if (!isConnected) {
    vscode.window.showWarningMessage("DocsStudio is not connected.");
    return;
  }
  const query = await vscode.window.showInputBox({
    prompt: "Search documentation",
    placeHolder: "e.g., 'create customer', 'webhook verification', 'auth flow'"
  });
  if (!query) return;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DocsStudio: Searching..."
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
        const items = response.results.slice(0, 20).map((r) => {
          if (r.type === "graph_node") {
            return {
              label: `$(symbol-${getNodeIcon(r.node_type || "")}) ${r.label}`,
              description: r.canonical_ref || "",
              detail: `[${r.node_type}] ${r.project_name}: ${(r.description || "").slice(0, 120)}`
            };
          } else {
            const heading = (r.heading_path || []).join(" > ");
            return {
              label: `$(file) ${heading || "Documentation"}`,
              description: r.project_name,
              detail: (r.text || "").slice(0, 120)
            };
          }
        });
        const selected = await vscode.window.showQuickPick(items, {
          title: `Search Results for "${query}"`,
          placeHolder: `${response.total} results found`
        });
        if (selected) {
          const idx = items.indexOf(selected);
          const result = response.results[idx];
          outputChannel.clear();
          outputChannel.appendLine(`Search Result: ${query}`);
          outputChannel.appendLine("\u2500".repeat(50));
          if (result.type === "graph_node") {
            outputChannel.appendLine(`Type: ${result.node_type}`);
            outputChannel.appendLine(`Label: ${result.label}`);
            if (result.canonical_ref)
              outputChannel.appendLine(`Ref: ${result.canonical_ref}`);
            outputChannel.appendLine(`Project: ${result.project_name}`);
            outputChannel.appendLine(`
${result.description || ""}`);
          } else {
            outputChannel.appendLine(
              `Heading: ${(result.heading_path || []).join(" > ")}`
            );
            outputChannel.appendLine(`Project: ${result.project_name}`);
            outputChannel.appendLine(`
${result.text || ""}`);
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
__name(cmdSearchDocs, "cmdSearchDocs");
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
      title: "DocsStudio: Getting context..."
    },
    async () => {
      try {
        const content = editor.document.getText();
        const filePath = editor.document.uri.fsPath;
        const projectIds = Array.from(matchedProjects.keys());
        const ctx = await contextSelector.getContextForFile(
          content,
          filePath,
          projectIds.length > 0 ? projectIds : void 0
        );
        if (!ctx.text || ctx.itemCount === 0) {
          vscode.window.showInformationMessage(
            "No relevant documentation context found for this file."
          );
          return;
        }
        outputChannel.clear();
        outputChannel.appendLine("DocsStudio \u2014 Documentation Context");
        outputChannel.appendLine("\u2550".repeat(50));
        outputChannel.appendLine(
          `Projects: ${ctx.projects.map((p) => p.name).join(", ")}`
        );
        outputChannel.appendLine(`Items: ${ctx.itemCount}`);
        outputChannel.appendLine(
          `Estimated tokens: ~${ctx.estimatedTokens}`
        );
        outputChannel.appendLine("\u2500".repeat(50));
        outputChannel.appendLine(ctx.text);
        outputChannel.show();
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
__name(cmdInjectContext, "cmdInjectContext");
async function cmdConfigure() {
  const config = vscode.workspace.getConfiguration("docsstudio");
  const currentUrl = config.get("apiUrl", "https://docsstudio.dev/api");
  const currentUserId = config.get("userId", "");
  const apiUrl = await vscode.window.showInputBox({
    prompt: "DocsStudio API URL",
    value: currentUrl,
    placeHolder: "https://docsstudio.dev/api"
  });
  if (apiUrl === void 0) return;
  const userId = await vscode.window.showInputBox({
    prompt: "Your Clerk User ID (from DocsStudio dashboard)",
    value: currentUserId,
    placeHolder: "user_xxxxxxxxxxxxxxxxxxxxxxxxxx"
  });
  if (userId === void 0) return;
  await config.update("apiUrl", apiUrl, vscode.ConfigurationTarget.Global);
  await config.update("userId", userId, vscode.ConfigurationTarget.Global);
  onConfigChange();
  vscode.window.showInformationMessage(
    "DocsStudio configuration saved. Testing connection..."
  );
}
__name(cmdConfigure, "cmdConfigure");
function onConfigChange() {
  const config = vscode.workspace.getConfiguration("docsstudio");
  const apiUrl = config.get("apiUrl", "https://docsstudio.dev/api");
  const userId = config.get("userId", "");
  const maxTokens = config.get("maxContextTokens", 8e3);
  client.updateConfig(apiUrl, userId);
  contextSelector.setMaxTokens(maxTokens);
  log(`Configuration updated: API=${apiUrl}, User=${userId ? "set" : "not set"}`);
  isConnected = false;
  updateStatusBar(userId ? "disconnected" : "unconfigured");
}
__name(onConfigChange, "onConfigChange");
function updateStatusBar(state) {
  switch (state) {
    case "initializing":
      statusBarItem.text = "$(loading~spin) DocsStudio";
      statusBarItem.tooltip = "DocsStudio: Initializing...";
      statusBarItem.backgroundColor = void 0;
      break;
    case "connected":
      statusBarItem.text = "$(plug) DocsStudio";
      statusBarItem.tooltip = "DocsStudio: Connected. Click to view projects.";
      statusBarItem.backgroundColor = void 0;
      break;
    case "disconnected":
      statusBarItem.text = "$(debug-disconnect) DocsStudio";
      statusBarItem.tooltip = "DocsStudio: Disconnected. Click to reconnect.";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      break;
    case "unconfigured":
      statusBarItem.text = "$(gear) DocsStudio";
      statusBarItem.tooltip = "DocsStudio: Not configured. Click to set up.";
      statusBarItem.command = "docsstudio.configure";
      statusBarItem.backgroundColor = void 0;
      break;
    case "matched":
      const count = matchedProjects.size;
      statusBarItem.text = `$(book) DocsStudio (${count})`;
      statusBarItem.tooltip = `DocsStudio: ${count} matched project${count !== 1 ? "s" : ""}. Click to view.`;
      statusBarItem.backgroundColor = void 0;
      break;
  }
  statusBarItem.show();
}
__name(updateStatusBar, "updateStatusBar");
function log(message) {
  const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}
__name(log, "log");
function getNodeIcon(nodeType) {
  const icons = {
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
    environment: "server"
  };
  return icons[nodeType] || "symbol-misc";
}
__name(getNodeIcon, "getNodeIcon");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
