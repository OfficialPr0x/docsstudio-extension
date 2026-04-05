/**
 * Context Selector
 * ================
 * Picks the right subset of the context tree based on:
 * - Which file is open
 * - Which imports are detected
 * - What the user is asking about
 *
 * Formats context for delivery to LLM sessions.
 */

import {
  DocsStudioClient,
  ContextSearchResult,
  FileContextItem,
  EndpointDetail,
  ProjectSummary,
} from "../api/client";

export interface SelectedContext {
  /** Formatted context string ready for LLM delivery */
  text: string;
  /** Token estimate for the context */
  estimatedTokens: number;
  /** Projects that contributed to this context */
  projects: Array<{ id: string; name: string }>;
  /** Number of items included */
  itemCount: number;
}

interface ContextSection {
  title: string;
  priority: number; // Lower = higher priority (included first)
  content: string;
  tokens: number;
}

/**
 * Rough token estimation (4 chars ~ 1 token for English text)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextSelector {
  private client: DocsStudioClient;
  private maxTokens: number;

  constructor(client: DocsStudioClient, maxTokens: number = 8000) {
    this.client = client;
    this.maxTokens = maxTokens;
  }

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens;
  }

  /**
   * Get context for the currently open file.
   * This is the primary context delivery method.
   */
  async getContextForFile(
    fileContent: string,
    filePath: string,
    projectIds?: string[]
  ): Promise<SelectedContext> {
    const response = await this.client.getContextForFile(
      fileContent,
      filePath,
      projectIds,
      30
    );

    const sections: ContextSection[] = [];
    const projects = new Map<string, string>();

    // Track matched projects
    for (const proj of response.matched_projects || []) {
      projects.set(proj.id, proj.name);
    }

    // Group context items by type and project
    const byProject = new Map<
      string,
      Map<string, FileContextItem[]>
    >();

    for (const item of response.context) {
      if (!byProject.has(item.project_id)) {
        byProject.set(item.project_id, new Map());
        projects.set(item.project_id, item.project_name);
      }
      const projMap = byProject.get(item.project_id)!;
      if (!projMap.has(item.node_type)) {
        projMap.set(item.node_type, []);
      }
      projMap.get(item.node_type)!.push(item);
    }

    // Build sections with priorities
    for (const [projectId, typeMap] of byProject) {
      const projectName = projects.get(projectId) || "Unknown";

      // Auth flows (highest priority)
      const authItems = typeMap.get("auth_flow") || [];
      if (authItems.length > 0) {
        const lines = [`## Authentication — ${projectName}`];
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
          tokens: estimateTokens(content),
        });
      }

      // Endpoints (second priority)
      const endpointItems = typeMap.get("endpoint") || [];
      if (endpointItems.length > 0) {
        const lines = [`## API Endpoints — ${projectName}`];
        for (const item of endpointItems.slice(0, 15)) {
          const ref = item.canonical_ref || item.label;
          lines.push(`- \`${ref}\`: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `endpoints_${projectId}`,
          priority: 2,
          content,
          tokens: estimateTokens(content),
        });
      }

      // Schemas
      const schemaItems = typeMap.get("schema") || [];
      if (schemaItems.length > 0) {
        const lines = [`## Data Models — ${projectName}`];
        for (const item of schemaItems.slice(0, 10)) {
          lines.push(`- **${item.label}**: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `schemas_${projectId}`,
          priority: 3,
          content,
          tokens: estimateTokens(content),
        });
      }

      // Errors
      const errorItems = typeMap.get("error") || [];
      if (errorItems.length > 0) {
        const lines = [`## Error Codes — ${projectName}`];
        for (const item of errorItems.slice(0, 10)) {
          lines.push(`- **${item.label}**: ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `errors_${projectId}`,
          priority: 4,
          content,
          tokens: estimateTokens(content),
        });
      }

      // Webhooks
      const webhookItems = typeMap.get("webhook") || [];
      if (webhookItems.length > 0) {
        const lines = [`## Webhooks — ${projectName}`];
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
          tokens: estimateTokens(content),
        });
      }

      // Concepts and other types
      const otherTypes = ["concept", "guide", "rate_limit_rule", "sdk_method", "flow"];
      const otherItems: FileContextItem[] = [];
      for (const t of otherTypes) {
        otherItems.push(...(typeMap.get(t) || []));
      }

      if (otherItems.length > 0) {
        const lines = [`## Additional Context — ${projectName}`];
        for (const item of otherItems.slice(0, 10)) {
          lines.push(`- **${item.label}** (${item.node_type}): ${item.description || ""}`);
        }
        const content = lines.join("\n");
        sections.push({
          title: `other_${projectId}`,
          priority: 6,
          content,
          tokens: estimateTokens(content),
        });
      }
    }

    return this.assembleSections(sections, projects);
  }

  /**
   * Get context from a search query.
   */
  async getContextForQuery(
    query: string,
    projectId?: string
  ): Promise<SelectedContext> {
    const response = await this.client.searchContext(
      query,
      projectId,
      undefined,
      30
    );

    const sections: ContextSection[] = [];
    const projects = new Map<string, string>();

    // Group results by type
    const graphNodes = response.results.filter(
      (r) => r.type === "graph_node"
    );
    const docChunks = response.results.filter(
      (r) => r.type === "doc_chunk"
    );

    // Graph nodes section
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
        tokens: estimateTokens(content),
      });
    }

    // Doc chunks section
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
        tokens: estimateTokens(content),
      });
    }

    return this.assembleSections(sections, projects);
  }

  /**
   * Get context for a specific endpoint.
   */
  async getEndpointContext(
    method: string,
    apiPath: string,
    projectId?: string
  ): Promise<SelectedContext> {
    const response = await this.client.lookupEndpoint({
      method,
      path: apiPath,
      projectId,
    });

    const sections: ContextSection[] = [];
    const projects = new Map<string, string>();

    for (const ep of response.endpoints) {
      projects.set(ep.project_id, ep.project_name);

      // Endpoint overview
      const overviewLines = [
        `## \`${ep.method} ${ep.path}\` — ${ep.label}`,
        "",
        ep.description,
      ];
      const overviewContent = overviewLines.join("\n");
      sections.push({
        title: `ep_overview_${ep.canonical_ref}`,
        priority: 1,
        content: overviewContent,
        tokens: estimateTokens(overviewContent),
      });

      // Auth
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
          tokens: estimateTokens(authContent),
        });
      }

      // Errors
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
          tokens: estimateTokens(errContent),
        });
      }

      // Related
      if (ep.related.length > 0) {
        const relLines = ["### Related"];
        for (const r of ep.related) {
          relLines.push(
            `- ${r.label} (${r.node_type}) — ${r.edge_type}: ${r.description}`
          );
        }
        const relContent = relLines.join("\n");
        sections.push({
          title: `ep_related_${ep.canonical_ref}`,
          priority: 4,
          content: relContent,
          tokens: estimateTokens(relContent),
        });
      }
    }

    return this.assembleSections(sections, projects);
  }

  /**
   * Assemble context sections into a single context block,
   * respecting the token budget.
   */
  private assembleSections(
    sections: ContextSection[],
    projects: Map<string, string>
  ): SelectedContext {
    // Sort by priority
    sections.sort((a, b) => a.priority - b.priority);

    const included: string[] = [];
    let totalTokens = 0;
    let itemCount = 0;

    // Header
    const header = `<docs_context source="DocsStudio">`;
    const footer = `</docs_context>`;
    const headerTokens = estimateTokens(header) + estimateTokens(footer);
    totalTokens += headerTokens;

    for (const section of sections) {
      if (totalTokens + section.tokens > this.maxTokens) {
        // Try to include a truncated version
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
      name,
    }));

    if (included.length === 0) {
      return {
        text: "",
        estimatedTokens: 0,
        projects: projectList,
        itemCount: 0,
      };
    }

    const text = [header, ...included, footer].join("\n\n");

    return {
      text,
      estimatedTokens: totalTokens,
      projects: projectList,
      itemCount,
    };
  }
}
