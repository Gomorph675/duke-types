import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { JavaClass } from './types';
import { DukeTypesConfig } from './config';
import { parseJavaFile } from './parser/java-parser';

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Find all Java files matching the configured patterns within the include
 * directories. Also searches any extra projectRoots.
 */
export async function findJavaFiles(config: DukeTypesConfig): Promise<string[]> {
  const allDirs = [...config.include, ...config.projectRoots];
  const filePaths = new Set<string>();

  for (const dir of allDirs) {
    if (!fs.existsSync(dir)) {
      continue; // silently skip missing directories
    }

    const pattern = config.filePattern.startsWith('**/') ? config.filePattern : `**/${config.filePattern}`;
    const matches = await glob(pattern, {
      cwd: dir,
      absolute: true,
      nodir: true,
    });

    for (const m of matches) {
      filePaths.add(path.normalize(m));
    }
  }

  return [...filePaths].sort();
}

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

export interface ScanResult {
  classes: JavaClass[];
  errors: Array<{ filePath: string; error: Error }>;
}

/**
 * Parse a single Java file. Returns null if it doesn't contain a parseable
 * class/interface/enum.
 */
export function parseFile(filePath: string): { result: JavaClass | null; error?: Error } {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = parseJavaFile(content, filePath);
    return { result };
  } catch (error) {
    return { result: null, error: error as Error };
  }
}

/**
 * Scan all Java files and return parsed JavaClass objects.
 *
 * @param config         Duke types configuration
 * @param onProgress     Optional callback invoked for each file processed
 */
export async function scanJavaFiles(
  config: DukeTypesConfig,
  onProgress?: (current: number, total: number, filePath: string) => void,
): Promise<ScanResult> {
  const filePaths = await findJavaFiles(config);
  const classes: JavaClass[] = [];
  const errors: ScanResult['errors'] = [];

  let i = 0;
  for (const filePath of filePaths) {
    i++;
    onProgress?.(i, filePaths.length, filePath);

    const { result, error } = parseFile(filePath);

    if (error) {
      errors.push({ filePath, error });
      continue;
    }

    if (!result) continue;

    // Filter by model annotations if specified
    if (config.modelAnnotations.length > 0) {
      const classAnnotationNames = new Set(result.annotations.map(a => a.name));
      const hasRequiredAnnotation = config.modelAnnotations.some(a => classAnnotationNames.has(a));
      if (!hasRequiredAnnotation) continue;
    }

    // Apply field filters
    if (config.skipStaticFields) {
      result.fields = result.fields.filter(f => !f.isStatic);
    }

    if (config.skipIgnoredFields) {
      const IGNORED_ANNOTATIONS = new Set([
        'JsonIgnore', 'Transient', 'Ignore', 'XmlTransient',
      ]);
      result.fields = result.fields.filter(f =>
        !f.annotations.some(a => IGNORED_ANNOTATIONS.has(a.name)),
      );
    }

    classes.push(result);
  }

  return { classes, errors };
}
