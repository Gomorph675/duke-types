import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface DukeTypesConfig {
  /**
   * Glob patterns for Java source directories to scan.
   * Relative to the config file location or cwd.
   * Default: ['src/main/java']
   */
  include: string[];

  /**
   * Output directory for generated TypeScript files.
   * Default: 'src/generated/types'
   */
  outDir: string;

  /**
   * Additional project roots to scan when resolving imports.
   * These can be sibling projects outside the current package.json scope.
   * Paths are resolved relative to the config file location.
   *
   * Example: ['../shared-models/src/main/java', '../core/src/main/java']
   */
  projectRoots: string[];

  /**
   * Glob pattern for Java files. Default: '**\/*.java'
   */
  filePattern: string;

  /**
   * Only process Java files that have at least one of these class-level
   * annotations. Leave empty to process all files found.
   * Default: [] (process all)
   *
   * Example: ['Entity', 'Data', 'Value', 'DTO']
   */
  modelAnnotations: string[];

  /**
   * Whether to generate `interface` or `type` aliases.
   * Default: 'interface'
   */
  outputType: 'interface' | 'type';

  /**
   * How to represent Java date/time types.
   * 'string' = ISO string (default), 'Date' = JS Date object
   */
  dateType: 'string' | 'Date';

  /**
   * Nullability strategy for fields that have no explicit null annotation.
   *   'annotated-only' - Only mark optional when @Nullable is present (default)
   *   'all-optional'   - Mark every field as optional
   *   'never'          - Never mark fields as optional
   */
  nullableStrategy: 'annotated-only' | 'all-optional' | 'never';

  /**
   * Generate a barrel index.ts file in outDir that re-exports everything.
   * Default: true
   */
  generateIndex: boolean;

  /**
   * Whether to skip static fields.
   * Default: true
   */
  skipStaticFields: boolean;

  /**
   * Whether to skip fields annotated with @JsonIgnore, @Transient, etc.
   * Default: true
   */
  skipIgnoredFields: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: DukeTypesConfig = {
  include: ['src/main/java'],
  outDir: 'src/generated/types',
  projectRoots: [],
  filePattern: '**/*.java',
  modelAnnotations: [],
  outputType: 'interface',
  dateType: 'string',
  nullableStrategy: 'annotated-only',
  generateIndex: true,
  skipStaticFields: true,
  skipIgnoredFields: true,
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = [
  'duke-types.config.js',
  'duke-types.config.cjs',
  'duke-types.config.json',
  '.duketypesrc.json',
  '.duketypesrc.js',
];

/**
 * Load configuration from disk. Searches for a config file starting at
 * `searchDir` and walking up to the filesystem root.
 *
 * Merges found config with defaults.
 */
export function loadConfig(searchDir: string, configPath?: string): { config: DukeTypesConfig; configDir: string } {
  let configDir = searchDir;
  let rawConfig: Partial<DukeTypesConfig> = {};

  if (configPath) {
    const absPath = path.resolve(searchDir, configPath);
    configDir = path.dirname(absPath);
    rawConfig = loadConfigFile(absPath);
  } else {
    const found = findConfigFile(searchDir);
    if (found) {
      configDir = path.dirname(found);
      rawConfig = loadConfigFile(found);
    }
  }

  const config = mergeConfig(rawConfig, configDir);
  return { config, configDir };
}

function findConfigFile(startDir: string): string | null {
  let dir = startDir;

  while (true) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return null;
}

function loadConfigFile(filePath: string): Partial<DukeTypesConfig> {
  const ext = path.extname(filePath);

  try {
    if (ext === '.json') {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      // .js or .cjs — require it
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(filePath);
      return mod?.default ?? mod;
    }
  } catch (e) {
    throw new Error(`Failed to load config file ${filePath}: ${(e as Error).message}`);
  }
}

/**
 * Merge a partial user config with defaults, resolving all paths relative to
 * the config file's directory.
 */
function mergeConfig(raw: Partial<DukeTypesConfig>, configDir: string): DukeTypesConfig {
  const merged: DukeTypesConfig = { ...DEFAULT_CONFIG, ...raw };

  // Resolve paths relative to config dir
  merged.include = merged.include.map(p => (path.isAbsolute(p) ? p : path.resolve(configDir, p)));
  merged.outDir = path.isAbsolute(merged.outDir) ? merged.outDir : path.resolve(configDir, merged.outDir);
  merged.projectRoots = merged.projectRoots.map(p =>
    path.isAbsolute(p) ? p : path.resolve(configDir, p),
  );

  return merged;
}
