/**
 * DocsStudio MCP Server
 * =====================
 * Standalone Model Context Protocol server that exposes DocsStudio's
 * documentation intelligence as tools any MCP-compatible client can use.
 *
 * Tools:
 *   - search_documentation: Search across all indexed documentation
 *   - get_context_for_code: Get relevant docs for code being written
 *   - get_endpoint_docs: Look up specific API endpoint documentation
 *   - list_projects: List available documentation projects
 *   - get_project_context: Get full context package for a project
 *
 * Run standalone: DOCSSTUDIO_API_URL=https://docsstudio.dev/api DOCSSTUDIO_USER_ID=... node dist/mcp-server.js
 * Or via VS Code extension (auto-configured).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DocsStudioClient } from "./api/client";

// ─── Configuration ───────────────────────────────────────────────────

const API_URL =
  process.env.DOCSSTUDIO_API_URL || "https://docsstudio.dev/api";
const USER_ID = process.env.DOCSSTUDIO_USER_ID || "";

if (!USER_ID) {
  console.error(
    "[DocsStudio MCP] Warning: DOCSSTUDIO_USER_ID not set. Set it in your environment or VS Code settings."
  );
}

const client = new DocsStudioClient(API_URL, USER_ID);

// ─── MCP Server Setup ───────────────────────────────────────────────

const server = new McpServer({
  name: "docsstudio",
  version: "1.0.0",
});

// ─── Tool: search_documentation ─────────────────────────────────────

server.tool(
  "search_documentation",
  "Search across all indexed API documentation in DocsStudio. Finds relevant endpoints, concepts, auth flows, schemas, and documentation excerpts. Use this when you need to find specific API information, understand how an API works, or look up documentation for a library.",
  {
    query: z
      .string()
      .describe(
        "Search query — can be a concept, endpoint name, error code, or natural language question"
      ),
    project_name: z
      .string()
      .optional()
      .describe(
        "Filter to a specific project name (e.g., 'stripe', 'supabase')"
      ),
    types: z
      .array(z.string())
      .optional()
      .describe(
        "Filter by node types: endpoint, concept, schema, auth_flow, error, webhook, rate_limit_rule"
      ),
  },
  async ({ query, project_name, types }) => {
    try {
      // If project_name given, find its ID first
      let projectId: string | undefined;
      if (project_name) {
        const summary = await client.getProjectsSummary();
        const match = summary.projects.find(
          (p) =>
            p.name.toLowerCase().includes(project_name.toLowerCase()) ||
            project_name.toLowerCase().includes(p.name.toLowerCase())
        );
        if (match) projectId = match.id;
      }

      const response = await client.searchContext(
        query,
        projectId,
        types,
        25
      );

      if (response.results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documentation found for "${query}". Make sure you have indexed the relevant documentation in DocsStudio.`,
            },
          ],
        };
      }

      const lines: string[] = [
        `# Documentation Search Results for "${query}"`,
        `Found ${response.total} results.\n`,
      ];

      for (const result of response.results) {
        if (result.type === "graph_node") {
          const ref = result.canonical_ref
            ? ` (\`${result.canonical_ref}\`)`
            : "";
          lines.push(
            `### ${result.label}${ref}`
          );
          lines.push(`**Type:** ${result.node_type} | **Project:** ${result.project_name} | **Confidence:** ${result.confidence}`);
          if (result.description) {
            lines.push(result.description);
          }
          lines.push("");
        } else {
          const heading = (result.heading_path || []).join(" > ");
          lines.push(`### ${heading || "Documentation"} (${result.project_name})`);
          lines.push(result.text || "");
          lines.push("");
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching documentation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_context_for_code ─────────────────────────────────────

server.tool(
  "get_context_for_code",
  "Analyze code to find relevant API documentation. Detects imports, API endpoints, and library usage, then returns matching documentation context including auth flows, endpoint details, schemas, and common pitfalls. Use this when writing code that uses an API or library you have docs for in DocsStudio.",
  {
    code: z
      .string()
      .describe("The code content to analyze for documentation context"),
    file_path: z
      .string()
      .describe(
        "Path to the file (used for language detection, e.g., 'src/api/stripe.ts')"
      ),
  },
  async ({ code, file_path }) => {
    try {
      const response = await client.getContextForFile(code, file_path);

      const lines: string[] = [];

      if (response.language !== "unknown") {
        lines.push(`**Language detected:** ${response.language}`);
      }

      if (response.detected_imports.length > 0) {
        lines.push(
          `**Detected imports:** ${response.detected_imports.join(", ")}`
        );
      }

      if (response.matched_projects.length > 0) {
        lines.push(
          `**Matched projects:** ${response.matched_projects.map((p: any) => p.name).join(", ")}`
        );
      }

      lines.push("");

      if (response.context.length === 0) {
        lines.push(
          "No matching documentation found. Make sure relevant docs are indexed in DocsStudio."
        );
      } else {
        // Group by node type
        const byType = new Map<string, typeof response.context>();
        for (const item of response.context) {
          if (!byType.has(item.node_type)) {
            byType.set(item.node_type, []);
          }
          byType.get(item.node_type)!.push(item);
        }

        // Auth first
        const authItems = byType.get("auth_flow") || [];
        if (authItems.length > 0) {
          lines.push("## Authentication");
          for (const item of authItems) {
            lines.push(
              `- **${item.label}**${item.canonical_ref ? ` (\`${item.canonical_ref}\`)` : ""}: ${item.description || ""}`
            );
          }
          lines.push("");
        }

        // Endpoints
        const endpoints = byType.get("endpoint") || [];
        if (endpoints.length > 0) {
          lines.push("## Relevant Endpoints");
          for (const item of endpoints) {
            lines.push(
              `- \`${item.canonical_ref || item.label}\`: ${item.description || ""}`
            );
          }
          lines.push("");
        }

        // Schemas
        const schemas = byType.get("schema") || [];
        if (schemas.length > 0) {
          lines.push("## Data Models");
          for (const item of schemas) {
            lines.push(`- **${item.label}**: ${item.description || ""}`);
          }
          lines.push("");
        }

        // Errors
        const errors = byType.get("error") || [];
        if (errors.length > 0) {
          lines.push("## Known Error Codes");
          for (const item of errors) {
            lines.push(`- **${item.label}**: ${item.description || ""}`);
          }
          lines.push("");
        }

        // Webhooks
        const webhooks = byType.get("webhook") || [];
        if (webhooks.length > 0) {
          lines.push("## Webhooks");
          for (const item of webhooks) {
            lines.push(
              `- \`${item.canonical_ref || item.label}\`: ${item.description || ""}`
            );
          }
          lines.push("");
        }

        // Everything else
        for (const [nodeType, items] of byType) {
          if (
            ["auth_flow", "endpoint", "schema", "error", "webhook"].includes(
              nodeType
            )
          )
            continue;
          lines.push(`## ${nodeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`);
          for (const item of items) {
            lines.push(`- **${item.label}**: ${item.description || ""}`);
          }
          lines.push("");
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting context: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_endpoint_docs ────────────────────────────────────────

server.tool(
  "get_endpoint_docs",
  "Get detailed documentation for a specific API endpoint including authentication requirements, request/response schemas, error codes, and related endpoints. Use this when you need to implement a specific API call.",
  {
    method: z
      .string()
      .optional()
      .describe("HTTP method: GET, POST, PUT, PATCH, DELETE"),
    path: z
      .string()
      .optional()
      .describe("API path, e.g., '/v1/customers' or '/api/users/{id}'"),
    query: z
      .string()
      .optional()
      .describe(
        "Search query if you don't know the exact method/path (e.g., 'create customer')"
      ),
    project_name: z.string().optional().describe("Filter to a specific project"),
  },
  async ({ method, path, query, project_name }) => {
    try {
      let projectId: string | undefined;
      if (project_name) {
        const summary = await client.getProjectsSummary();
        const match = summary.projects.find(
          (p) =>
            p.name.toLowerCase().includes(project_name.toLowerCase()) ||
            project_name.toLowerCase().includes(p.name.toLowerCase())
        );
        if (match) projectId = match.id;
      }

      const response = await client.lookupEndpoint({
        method,
        path,
        query,
        projectId,
      });

      if (response.endpoints.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No endpoint found matching ${method ? method + " " : ""}${path || query || "(no criteria)"}. Try a broader search or check that the docs are indexed.`,
            },
          ],
        };
      }

      const lines: string[] = [];

      for (const ep of response.endpoints) {
        lines.push(`# \`${ep.method} ${ep.path}\``);
        lines.push(`**${ep.label}** — ${ep.project_name}\n`);
        lines.push(ep.description);
        lines.push("");

        if (ep.auth.length > 0) {
          lines.push("## Authentication");
          for (const a of ep.auth) {
            lines.push(`- **${a.type}**${a.ref ? ` (\`${a.ref}\`)` : ""}: ${a.description}`);
          }
          lines.push("");
        }

        if (ep.errors.length > 0) {
          lines.push("## Error Responses");
          for (const e of ep.errors) {
            lines.push(`- **${e.code || e.label}**: ${e.description}`);
          }
          lines.push("");
        }

        if (ep.related.length > 0) {
          lines.push("## Related");
          for (const r of ep.related) {
            lines.push(
              `- ${r.label} (${r.node_type}) — *${r.edge_type}*: ${r.description}`
            );
          }
          lines.push("");
        }

        lines.push("---\n");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error looking up endpoint: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: list_projects ────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all documentation projects indexed in DocsStudio. Shows project names, URLs, document counts, and knowledge graph statistics. Use this to see what documentation is available.",
  {},
  async () => {
    try {
      const response = await client.getProjectsSummary();

      if (response.projects.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No projects found. Index documentation at your DocsStudio dashboard first.",
            },
          ],
        };
      }

      const lines = ["# Available Documentation Projects\n"];

      for (const proj of response.projects) {
        const status =
          proj.status === "graph_ready"
            ? "Ready"
            : proj.status === "completed"
              ? "Indexed"
              : proj.status;

        lines.push(`## ${proj.name}`);
        lines.push(`- **URL:** ${proj.base_url}`);
        lines.push(`- **Status:** ${status}`);
        lines.push(`- **Documents:** ${proj.document_count}`);
        lines.push(`- **Graph nodes:** ${proj.graph_node_count}`);

        if (Object.keys(proj.node_types).length > 0) {
          const types = Object.entries(proj.node_types)
            .map(([t, c]) => `${t}: ${c}`)
            .join(", ");
          lines.push(`- **Node types:** ${types}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_project_context ──────────────────────────────────────

server.tool(
  "get_project_context",
  "Get the full structured context package for a documentation project. Returns auth flows, API endpoints, schemas, integration guides, common patterns, and more. Use this when you need comprehensive documentation for an entire API or library.",
  {
    project_name: z
      .string()
      .describe("Name of the project (e.g., 'stripe', 'supabase')"),
    sections: z
      .array(z.string())
      .optional()
      .describe(
        "Specific sections to include: auth/flows.md, auth/edge_cases.md, api/endpoints.json, api/inferred_schema.json, playbooks/integration_guide.md, playbooks/common_patterns.md, context/concepts.md, prompts/cursor_rules.md, prompts/claude_context.md, prompts/agent_tools.json"
      ),
  },
  async ({ project_name, sections }) => {
    try {
      const summary = await client.getProjectsSummary();
      const match = summary.projects.find(
        (p) =>
          p.name.toLowerCase().includes(project_name.toLowerCase()) ||
          project_name.toLowerCase().includes(p.name.toLowerCase())
      );

      if (!match) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Project "${project_name}" not found. Available: ${summary.projects.map((p) => p.name).join(", ")}`,
            },
          ],
        };
      }

      const pkg = await client.getContextPackage(match.id);

      const lines: string[] = [
        `# ${pkg.project_name} — Context Package`,
        `Source: ${pkg.base_url}\n`,
      ];

      const files = pkg.files;
      const requestedSections = sections || Object.keys(files);

      for (const section of requestedSections) {
        const content = files[section];
        if (content && content.trim()) {
          lines.push(`---\n## 📄 ${section}\n`);
          // Truncate very large sections
          if (content.length > 5000) {
            lines.push(content.slice(0, 5000));
            lines.push("\n[...section truncated for context window management]");
          } else {
            lines.push(content);
          }
          lines.push("");
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting project context: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: match_dependencies ───────────────────────────────────────

server.tool(
  "match_dependencies",
  "Match package/library names from your project against indexed documentation in DocsStudio. Use this to find which of your project's dependencies have documentation available.",
  {
    dependencies: z
      .array(z.string())
      .describe(
        "List of package/library names to match (e.g., ['stripe', 'supabase-js', 'next-auth'])"
      ),
  },
  async ({ dependencies }) => {
    try {
      const response = await client.matchDependencies(dependencies);

      if (response.matches.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documentation found for: ${dependencies.join(", ")}. Index these docs in DocsStudio first.`,
            },
          ],
        };
      }

      const lines = ["# Matched Documentation\n"];

      // Group by project
      const byProject = new Map<
        string,
        { project: (typeof response.matches)[0]; deps: string[] }
      >();
      for (const m of response.matches) {
        if (!byProject.has(m.project_id)) {
          byProject.set(m.project_id, { project: m, deps: [] });
        }
        byProject.get(m.project_id)!.deps.push(m.dependency);
      }

      for (const { project, deps } of byProject.values()) {
        lines.push(`## ${project.project_name}`);
        lines.push(`- **URL:** ${project.base_url}`);
        lines.push(`- **Status:** ${project.status}`);
        lines.push(`- **Matched dependencies:** ${deps.join(", ")}`);
        lines.push("");
      }

      const unmatched = dependencies.filter(
        (d) => !response.matches.some((m) => m.dependency === d.toLowerCase())
      );
      if (unmatched.length > 0) {
        lines.push(
          `## Not Found\nNo docs for: ${unmatched.join(", ")}`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error matching dependencies: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Start Server ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[DocsStudio MCP] Server started on stdio");
  console.error(`[DocsStudio MCP] API URL: ${API_URL}`);
  console.error(`[DocsStudio MCP] User ID: ${USER_ID ? "configured" : "NOT SET"}`);
}

main().catch((error) => {
  console.error("[DocsStudio MCP] Fatal error:", error);
  process.exit(1);
});
