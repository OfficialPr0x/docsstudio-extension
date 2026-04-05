/**
 * DocsStudio API Client
 * =====================
 * HTTP client for communicating with the DocsStudio FastAPI backend.
 * Used by both the VS Code extension and the MCP server.
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";

export interface ProjectSummary {
  id: string;
  name: string;
  base_url: string;
  status: string;
  document_count: number;
  graph_node_count: number;
  node_types: Record<string, number>;
  created_at: string;
}

export interface ContextSearchResult {
  type: "graph_node" | "doc_chunk";
  node_type?: string;
  label?: string;
  description?: string;
  canonical_ref?: string;
  text?: string;
  heading_path?: string[];
  confidence?: number;
  project_name: string;
  project_id: string;
  score: number;
}

export interface DependencyMatch {
  dependency: string;
  project_id: string;
  project_name: string;
  base_url: string;
  status: string;
  score: number;
}

export interface FileContextItem {
  type: string;
  node_type: string;
  label: string;
  description: string;
  canonical_ref: string;
  confidence: number;
  project_name: string;
  project_id: string;
  score: number;
}

export interface EndpointDetail {
  method: string;
  path: string;
  label: string;
  description: string;
  canonical_ref: string;
  confidence: number;
  auth: Array<{ type: string; ref: string; description: string }>;
  errors: Array<{ code: string; label: string; description: string }>;
  related: Array<{
    edge_type: string;
    label: string;
    node_type: string;
    description: string;
  }>;
  project_name: string;
  project_id: string;
}

export interface ContextPackageDict {
  project_name: string;
  base_url: string;
  stats: Record<string, unknown>;
  files: Record<string, string>;
}

export class DocsStudioClient {
  private apiUrl: string;
  private userId: string;

  constructor(apiUrl: string, userId: string) {
    // Normalize URL - remove trailing slash
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.userId = userId;
  }

  updateConfig(apiUrl: string, userId: string): void {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.userId = userId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`${this.apiUrl}${path}`);
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
          "X-User-Id": this.userId,
        } as Record<string, string>,
        timeout: 30000,
      };

      const req = transport.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          } else {
            let detail = data;
            try {
              const parsed = JSON.parse(data);
              detail = parsed.detail || data;
            } catch {
              // use raw data
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

  async getProjectsSummary(): Promise<{ projects: ProjectSummary[] }> {
    return this.request("GET", "/context/projects-summary");
  }

  async getProject(projectId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/projects/${projectId}`);
  }

  // ─── Context Search ──────────────────────────────────────────────

  async searchContext(
    query: string,
    projectId?: string,
    nodeTypes?: string[],
    limit: number = 20
  ): Promise<{ results: ContextSearchResult[]; query: string; total: number }> {
    return this.request("POST", "/context/search", {
      query,
      project_id: projectId || null,
      node_types: nodeTypes || null,
      limit,
    });
  }

  // ─── Dependency Matching ─────────────────────────────────────────

  async matchDependencies(
    dependencies: string[]
  ): Promise<{ matches: DependencyMatch[] }> {
    return this.request("POST", "/context/match-deps", {
      dependencies,
    });
  }

  // ─── File Context ────────────────────────────────────────────────

  async getContextForFile(
    fileContent: string,
    filePath: string,
    projectIds?: string[],
    limit: number = 15
  ): Promise<{
    context: FileContextItem[];
    detected_imports: string[];
    matched_projects: ProjectSummary[];
    language: string;
  }> {
    return this.request("POST", "/context/for-file", {
      file_content: fileContent,
      file_path: filePath,
      project_ids: projectIds || null,
      limit,
    });
  }

  // ─── Endpoint Lookup ─────────────────────────────────────────────

  async lookupEndpoint(
    options: {
      method?: string;
      path?: string;
      query?: string;
      projectId?: string;
    }
  ): Promise<{ endpoints: EndpointDetail[] }> {
    return this.request("POST", "/context/endpoint-lookup", {
      method: options.method || null,
      path: options.path || null,
      query: options.query || null,
      project_id: options.projectId || null,
    });
  }

  // ─── Context Package ─────────────────────────────────────────────

  async getContextPackage(
    projectId: string
  ): Promise<ContextPackageDict> {
    return this.request("POST", `/projects/${projectId}/context-package`);
  }

  // ─── Graph Data ──────────────────────────────────────────────────

  async getGraph(
    projectId: string,
    nodeTypes?: string[],
    limit: number = 500
  ): Promise<Record<string, unknown>> {
    let path = `/projects/${projectId}/graph?limit=${limit}`;
    if (nodeTypes?.length) {
      path += `&node_types=${nodeTypes.join(",")}`;
    }
    return this.request("GET", path);
  }

  // ─── Health Check ────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.getProjectsSummary();
      return true;
    } catch {
      return false;
    }
  }
}
