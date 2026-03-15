/**
 * duke-types — Java models in. TypeScript interfaces out.
 *
 * Public API for programmatic usage.
 */

import * as path from 'path';
import * as fs from 'fs';
import { JavaClass, GeneratedFile } from './types';
import { DukeTypesConfig, loadConfig, DEFAULT_CONFIG } from './config';
import { scanJavaFiles, ScanResult } from './scanner';
import { buildClassIndex } from './resolver/import-resolver';
import { generateTypeScriptFile, generateIndexFile } from './converter/ts-generator';

export type { DukeTypesConfig } from './config';
export type { JavaClass, JavaField, JavaType, JavaAnnotation, GeneratedFile, TsTypeRef } from './types';
export { DEFAULT_CONFIG } from './config';
export { parseJavaFile } from './parser/java-parser';
export { mapType } from './converter/type-mapper';

// ---------------------------------------------------------------------------
// Core run function
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Working directory to search for config file. Defaults to process.cwd(). */
  cwd?: string;
  /** Explicit path to a config file. */
  configPath?: string;
  /** Config overrides applied on top of file config. */
  config?: Partial<DukeTypesConfig>;
  /** Write files to disk. Default: true. */
  write?: boolean;
  /** Progress callback. */
  onProgress?: (current: number, total: number, filePath: string) => void;
}

export interface RunResult {
  generated: GeneratedFile[];
  errors: Array<{ filePath: string; error: Error }>;
  config: DukeTypesConfig;
}

/**
 * Main entry point. Scans Java files, converts them to TypeScript, and
 * optionally writes them to disk.
 */
export async function run(options: RunOptions = {}): Promise<RunResult> {
  const cwd = options.cwd ?? process.cwd();

  // Load config
  const { config: fileConfig, configDir } = loadConfig(cwd, options.configPath);
  const config: DukeTypesConfig = { ...fileConfig, ...options.config };

  // Scan
  const { classes, errors } = await scanJavaFiles(config, options.onProgress);

  // Build cross-project index
  const classIndex = buildClassIndex(classes);

  // Generate TypeScript
  const generated: GeneratedFile[] = [];
  for (const cls of classes) {
    const file = generateTypeScriptFile(cls, classIndex, config.outDir, config);
    generated.push(file);
  }

  // Write to disk
  if (options.write !== false) {
    for (const file of generated) {
      const dir = path.dirname(file.absolutePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file.absolutePath, file.content, 'utf8');
    }

    if (config.generateIndex && generated.length > 0) {
      const indexContent = generateIndexFile(generated, config.outDir);
      const indexPath = path.join(config.outDir, 'index.ts');
      fs.mkdirSync(config.outDir, { recursive: true });
      fs.writeFileSync(indexPath, indexContent, 'utf8');
    }
  }

  return { generated, errors, config };
}

/**
 * Parse and convert a single Java source string. Useful for testing or
 * one-off conversions without touching the filesystem.
 */
export function convertJavaSource(
  javaSource: string,
  opts: {
    fileName?: string;
    config?: Partial<DukeTypesConfig>;
    allClasses?: JavaClass[];
  } = {},
): string {
  const { parseJavaFile } = require('./parser/java-parser');
  const { generateTypeScriptFile } = require('./converter/ts-generator');

  const config: DukeTypesConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const filePath = opts.fileName ?? 'Unknown.java';
  const javaClass: JavaClass | null = parseJavaFile(javaSource, filePath);

  if (!javaClass) throw new Error(`No class/interface/enum found in ${filePath}`);

  const allClasses = buildClassIndex(opts.allClasses ?? [javaClass]);
  const file = generateTypeScriptFile(javaClass, allClasses, '/tmp/duke-out', config);
  return file.content;
}
