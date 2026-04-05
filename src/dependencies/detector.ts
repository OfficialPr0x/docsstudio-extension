/**
 * Dependency Detector
 * ===================
 * Parses source files, package manifests, and lock files to detect
 * which libraries/APIs are in use. Supports Python, JS/TS, Go, Rust,
 * Ruby, Java, Kotlin, PHP, and C#.
 */

import * as fs from "fs";
import * as path from "path";

export interface DetectedDependency {
  name: string;
  source: "import" | "manifest" | "lockfile";
  sourceFile: string;
  version?: string;
}

// ─── Import Parsers ──────────────────────────────────────────────────

const IMPORT_PATTERNS: Record<
  string,
  { patterns: RegExp[]; extractor: (match: RegExpExecArray) => string | null }
> = {
  python: {
    patterns: [
      /^from\s+([\w.]+)\s+import/gm,
      /^import\s+([\w.]+)/gm,
    ],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      // Get top-level package (e.g., "flask" from "flask.blueprints")
      return raw.split(".")[0];
    },
  },
  javascript: {
    patterns: [
      /import\s+(?:[\w{}\s*,]+\s+from\s+)?['"]([^'"]+)['"]/gm,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
      /from\s+['"]([^'"]+)['"]/gm,
    ],
    extractor: (m) => {
      const raw = m[1];
      if (!raw || raw.startsWith(".") || raw.startsWith("/")) return null;
      // Scoped packages: @scope/package
      if (raw.startsWith("@")) {
        const parts = raw.split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
      }
      return raw.split("/")[0];
    },
  },
  typescript: {
    patterns: [
      /import\s+(?:[\w{}\s*,]+\s+from\s+)?['"]([^'"]+)['"]/gm,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
      /from\s+['"]([^'"]+)['"]/gm,
    ],
    extractor: (m) => {
      const raw = m[1];
      if (!raw || raw.startsWith(".") || raw.startsWith("/")) return null;
      if (raw.startsWith("@")) {
        const parts = raw.split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
      }
      return raw.split("/")[0];
    },
  },
  go: {
    patterns: [/import\s+(?:\(\s*)?(?:[\w.]+\s+)?"([^"]+)"/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      // Go packages: github.com/user/repo → repo
      const parts = raw.split("/");
      // Standard library
      if (!raw.includes(".")) return null;
      return parts.length >= 3 ? parts[2] : parts[parts.length - 1];
    },
  },
  rust: {
    patterns: [/^use\s+([\w:]+)/gm, /^extern\s+crate\s+(\w+)/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      return raw.split("::")[0];
    },
  },
  ruby: {
    patterns: [
      /^require\s+['"]([^'"]+)['"]/gm,
      /^gem\s+['"]([^'"]+)['"]/gm,
    ],
    extractor: (m) => m[1] || null,
  },
  java: {
    patterns: [/^import\s+([\w.]+)/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      // e.g., com.stripe.Stripe → stripe
      const parts = raw.split(".");
      // Usually: com.company.package
      return parts.length >= 3 ? parts[1] : parts[0];
    },
  },
  kotlin: {
    patterns: [/^import\s+([\w.]+)/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      const parts = raw.split(".");
      return parts.length >= 3 ? parts[1] : parts[0];
    },
  },
  php: {
    patterns: [/^use\s+([\w\\]+)/gm, /^require(?:_once)?\s+['"]([^'"]+)['"]/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      return raw.split("\\")[0].split("/")[0];
    },
  },
  csharp: {
    patterns: [/^using\s+([\w.]+)/gm],
    extractor: (m) => {
      const raw = m[1];
      if (!raw) return null;
      // Microsoft.AspNetCore.* → skip framework
      if (raw.startsWith("System") || raw.startsWith("Microsoft")) return null;
      return raw.split(".")[0];
    },
  },
};

// Language detection from file extension
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".php": "php",
  ".cs": "csharp",
};

// ─── Manifest Parsers ────────────────────────────────────────────────

function parsePackageJson(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const pkg = JSON.parse(content);
    const deps: DetectedDependency[] = [];

    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const sectionDeps = pkg[section] || {};
      for (const [name, version] of Object.entries(sectionDeps)) {
        deps.push({
          name,
          source: "manifest",
          sourceFile: filePath,
          version: String(version),
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parseRequirementsTxt(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps: DetectedDependency[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;

      // Handle: package==1.0, package>=1.0, package~=1.0, package[extras]==1.0
      const match = trimmed.match(/^([a-zA-Z0-9_-]+(?:\[[^\]]+\])?)\s*(?:[><=~!]+\s*(.+))?$/);
      if (match) {
        const name = match[1].replace(/\[.+\]/, ""); // Remove extras
        deps.push({
          name,
          source: "manifest",
          sourceFile: filePath,
          version: match[2],
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parsePyprojectToml(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps: DetectedDependency[] = [];

    // Simple TOML parser for dependencies section
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
            sourceFile: filePath,
          });
        }
      }
    }

    // Also check dependencies listed as array
    const arrayMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      const matches = arrayMatch[1].matchAll(/"([a-zA-Z0-9_-]+)(?:\[.+?\])?(?:\s*[><=~!].+)?"/g);
      for (const m of matches) {
        deps.push({
          name: m[1],
          source: "manifest",
          sourceFile: filePath,
        });
      }
    }

    return deps;
  } catch {
    return [];
  }
}

function parseGoMod(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps: DetectedDependency[] = [];

    // require block
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
            version: match[2],
          });
        }
      }
    }

    // Single require lines
    for (const m of content.matchAll(/^require\s+([\w./-]+)\s+(.+)$/gm)) {
      const parts = m[1].split("/");
      deps.push({
        name: parts.length >= 3 ? parts[2] : parts[parts.length - 1],
        source: "manifest",
        sourceFile: filePath,
        version: m[2],
      });
    }

    return deps;
  } catch {
    return [];
  }
}

function parseCargoToml(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps: DetectedDependency[] = [];

    // [dependencies] section
    const depsSection = content.match(/\[dependencies\]\s*\n((?:(?!^\[).+\n?)*)/m);
    if (depsSection) {
      for (const line of depsSection[1].split("\n")) {
        const match = line.match(/^(\w[\w-]*)\s*=/);
        if (match) {
          deps.push({
            name: match[1],
            source: "manifest",
            sourceFile: filePath,
          });
        }
      }
    }

    return deps;
  } catch {
    return [];
  }
}

function parseGemfile(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const deps: DetectedDependency[] = [];

    for (const m of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) {
      deps.push({
        name: m[1],
        source: "manifest",
        sourceFile: filePath,
      });
    }

    return deps;
  } catch {
    return [];
  }
}

function parseComposerJson(filePath: string): DetectedDependency[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const pkg = JSON.parse(content);
    const deps: DetectedDependency[] = [];

    for (const section of ["require", "require-dev"]) {
      const sectionDeps = pkg[section] || {};
      for (const [name, version] of Object.entries(sectionDeps)) {
        if (name === "php" || name.startsWith("ext-")) continue;
        deps.push({
          name: name.split("/").pop() || name,
          source: "manifest",
          sourceFile: filePath,
          version: String(version),
        });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

// ─── Main Detector ───────────────────────────────────────────────────

const MANIFEST_PARSERS: Record<string, (path: string) => DetectedDependency[]> = {
  "package.json": parsePackageJson,
  "requirements.txt": parseRequirementsTxt,
  "pyproject.toml": parsePyprojectToml,
  "Pipfile": parseRequirementsTxt,  // Similar enough format
  "go.mod": parseGoMod,
  "Cargo.toml": parseCargoToml,
  "Gemfile": parseGemfile,
  "composer.json": parseComposerJson,
};

/**
 * Parse imports from a source code string.
 */
export function parseImports(
  content: string,
  filePath: string
): DetectedDependency[] {
  const ext = path.extname(filePath).toLowerCase();
  const language = EXT_TO_LANGUAGE[ext];
  if (!language) return [];

  const config = IMPORT_PATTERNS[language];
  if (!config) return [];

  const deps: DetectedDependency[] = [];
  const seen = new Set<string>();

  for (const pattern of config.patterns) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const name = config.extractor(match);
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        deps.push({
          name,
          source: "import",
          sourceFile: filePath,
        });
      }
    }
  }

  return deps;
}

/**
 * Detect dependencies from manifest files in a workspace.
 */
export function detectManifestDependencies(
  workspaceRoot: string
): DetectedDependency[] {
  const deps: DetectedDependency[] = [];

  for (const [filename, parser] of Object.entries(MANIFEST_PARSERS)) {
    const filePath = path.join(workspaceRoot, filename);
    if (fs.existsSync(filePath)) {
      deps.push(...parser(filePath));
    }

    // Also check one level deep (e.g., backend/requirements.txt)
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
      // Ignore directory read errors
    }
  }

  return deps;
}

/**
 * Get all unique dependency names from a set of detected dependencies.
 */
export function getUniqueDependencyNames(deps: DetectedDependency[]): string[] {
  const seen = new Set<string>();
  return deps
    .map((d) => d.name.toLowerCase())
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

/**
 * Detect language from a file path.
 */
export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] || null;
}
