import * as path from 'path';
import * as fs from 'fs';
import { JavaClass } from '../types';
import { DukeTypesConfig } from '../config';

// ---------------------------------------------------------------------------
// Import resolution strategy
// ---------------------------------------------------------------------------
//
// When a generated TypeScript file references a type (e.g. `User` in a field),
// we need to figure out the relative import path to the generated `.ts` file
// for that type.
//
// Resolution order:
//   1. Look up the type name in `allClasses` (the in-memory index of everything
//      we parsed in this run).
//   2. Search the Java import list of the source class to find the fully-qualified
//      name, then map it to a generated output path.
//   3. Walk extra `projectRoots` to find the Java source file and derive the path.
//   4. If none of the above work, omit the import (type will be unresolved).
// ---------------------------------------------------------------------------

/** Java standard library package prefixes that have no TS equivalent */
const JAVA_STDLIB_PREFIXES = [
  'java.', 'javax.', 'sun.', 'com.sun.', 'jdk.',
  'org.springframework.', 'org.hibernate.', 'jakarta.',
  'io.swagger.', 'com.fasterxml.',
];

/** Well-known Java types that exist purely on the Java side and have no TS output */
const JAVA_STDLIB_SIMPLE_NAMES = new Set([
  'Serializable', 'Cloneable', 'Comparable', 'Runnable', 'AutoCloseable',
  'Closeable', 'Iterable', 'CharSequence', 'Appendable',
]);

/**
 * Returns true if a type is part of the Java standard library (no TS output).
 */
export function isJavaStdlib(typeName: string, imports: string[]): boolean {
  if (JAVA_STDLIB_SIMPLE_NAMES.has(typeName)) return true;
  const fqn = findFqnForType(typeName, imports);
  if (fqn && JAVA_STDLIB_PREFIXES.some(p => fqn.startsWith(p))) return true;
  return false;
}

/**
 * Resolve the TypeScript import path for `typeName` as seen from
 * `fromFilePath` (absolute path of the TS file being generated).
 *
 * Returns a relative path string suitable for use in an `import` statement,
 * or `null` if the type cannot be resolved.
 */
export function resolveImportPath(
  typeName: string,
  javaClass: JavaClass,
  allClasses: Map<string, JavaClass>,
  outDir: string,
  fromFilePath: string,
  config: DukeTypesConfig,
): string | null {
  // Skip Java standard library types — they have no TS output
  if (isJavaStdlib(typeName, javaClass.imports)) return null;

  // 1. Exact match in class index (by simple name)
  const resolved = allClasses.get(typeName);
  if (resolved) {
    return relativeImport(fromFilePath, classToOutputPath(resolved, outDir));
  }

  // 2. Walk the Java imports of the source class to find a FQN for this type
  const fqn = findFqnForType(typeName, javaClass.imports);
  if (fqn) {
    // If FQN maps to a stdlib package, skip it
    if (JAVA_STDLIB_PREFIXES.some(p => fqn.startsWith(p))) return null;

    // Try to find a parsed class with that FQN
    const byFqn = findClassByFqn(fqn, allClasses);
    if (byFqn) {
      return relativeImport(fromFilePath, classToOutputPath(byFqn, outDir));
    }

    // Derive output path from the FQN directly (package → directory structure)
    const fqnPath = fqnToOutputPath(fqn, outDir);
    if (fqnPath) {
      return relativeImport(fromFilePath, fqnPath);
    }
  }

  // 3. Search extra project roots for the Java source file
  if (config.projectRoots.length > 0) {
    const foundPath = searchProjectRoots(typeName, config.projectRoots);
    if (foundPath) {
      // Derive the package from the Java file path
      const derivedFqn = derivePackageFromPath(foundPath, config.projectRoots);
      if (derivedFqn) {
        const fqnPath = fqnToOutputPath(`${derivedFqn}.${typeName}`, outDir);
        if (fqnPath) return relativeImport(fromFilePath, fqnPath);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the expected output path for a JavaClass (mirrors package structure).
 */
export function classToOutputPath(cls: JavaClass, outDir: string): string {
  const packagePath = cls.packageName.replace(/\./g, path.sep);
  return path.join(outDir, packagePath, `${cls.name}.ts`);
}

/**
 * Convert a fully-qualified Java class name to an output TS file path.
 * e.g. 'com.example.model.User' → '<outDir>/com/example/model/User.ts'
 */
function fqnToOutputPath(fqn: string, outDir: string): string {
  const parts = fqn.split('.');
  if (parts.length < 2) return '';
  const fileName = parts[parts.length - 1];
  const packageParts = parts.slice(0, -1);
  return path.join(outDir, ...packageParts, `${fileName}.ts`);
}

/**
 * Compute a relative import specifier from one TS file to another.
 * Strips the `.ts` extension and ensures leading `./`.
 */
function relativeImport(fromFile: string, toFile: string): string {
  const fromDir = path.dirname(fromFile);
  let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
  // Remove .ts extension
  rel = rel.replace(/\.ts$/, '');
  // Ensure leading ./
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/**
 * Given a simple type name and a list of Java import strings, return the FQN
 * that matches the type name.
 *
 * e.g. typeName = 'User', imports = ['com.example.model.User', 'java.util.List']
 *   → 'com.example.model.User'
 */
function findFqnForType(typeName: string, imports: string[]): string | null {
  for (const imp of imports) {
    // Wildcard import: com.example.model.*  — we can derive the FQN but can't
    // be sure the class exists there; include it anyway.
    if (imp.endsWith('.*')) {
      const pkg = imp.slice(0, -2);
      return `${pkg}.${typeName}`;
    }
    // Exact match: last segment equals typeName
    const lastDot = imp.lastIndexOf('.');
    const simpleName = lastDot >= 0 ? imp.slice(lastDot + 1) : imp;
    if (simpleName === typeName) return imp;
  }
  return null;
}

/**
 * Find a JavaClass in the index by its fully-qualified name.
 */
function findClassByFqn(fqn: string, allClasses: Map<string, JavaClass>): JavaClass | undefined {
  const parts = fqn.split('.');
  const simpleName = parts[parts.length - 1];
  const pkg = parts.slice(0, -1).join('.');

  const candidate = allClasses.get(simpleName);
  if (candidate && candidate.packageName === pkg) return candidate;

  // Also search by full iteration in case of name collisions
  for (const cls of allClasses.values()) {
    if (cls.name === simpleName && cls.packageName === pkg) return cls;
  }
  return undefined;
}

/**
 * Search the given project roots for a Java file named `<typeName>.java`.
 * Returns the absolute file path if found, or null.
 */
function searchProjectRoots(typeName: string, projectRoots: string[]): string | null {
  const fileName = `${typeName}.java`;

  for (const root of projectRoots) {
    const found = findFileInDirectory(root, fileName);
    if (found) return found;
  }
  return null;
}

/**
 * Recursively search for a file by name within a directory.
 * Skips node_modules, .git, target, build directories.
 */
function findFileInDirectory(dir: string, fileName: string): string | null {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'out', '.gradle']);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const found = findFileInDirectory(fullPath, fileName);
      if (found) return found;
    } else if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Derive the Java package name from a file path by looking for a `src` or
 * `java` directory ancestor, then treating subsequent directories as the
 * package.
 *
 * e.g. /repos/my-service/src/main/java/com/example/model/User.java
 *   → 'com.example.model'
 */
function derivePackageFromPath(filePath: string, projectRoots: string[]): string | null {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const srcMarkers = ['java', 'kotlin', 'groovy'];

  let srcIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (srcMarkers.includes(parts[i])) {
      srcIndex = i;
      break;
    }
  }

  if (srcIndex === -1) {
    // Fall back: find the deepest project root that is a prefix
    for (const root of projectRoots) {
      const normalRoot = root.replace(/\\/g, '/');
      const normalFile = filePath.replace(/\\/g, '/');
      if (normalFile.startsWith(normalRoot)) {
        const relative = normalFile.slice(normalRoot.length).replace(/^\//, '');
        const packageParts = relative.split('/').slice(0, -1); // drop filename
        return packageParts.join('.');
      }
    }
    return null;
  }

  // Package is everything between srcIndex+1 and the file (excluding filename)
  const packageParts = parts.slice(srcIndex + 1, -1);
  return packageParts.join('.');
}

/**
 * Returns true if `typeName` is resolvable as a user-defined type
 * (i.e. not a Java stdlib type and potentially found in a project).
 */
export function isResolvable(typeName: string, imports: string[]): boolean {
  return !isJavaStdlib(typeName, imports);
}

// ---------------------------------------------------------------------------
// Cross-project class index building
// ---------------------------------------------------------------------------

/**
 * Build a map from simple class name → JavaClass for fast lookup.
 * When two classes share the same simple name, the one with the package that
 * appears in the primary includes list wins.
 */
export function buildClassIndex(classes: JavaClass[]): Map<string, JavaClass> {
  const index = new Map<string, JavaClass>();

  for (const cls of classes) {
    // Use FQN as the key if we already have that simple name
    if (index.has(cls.name)) {
      // Keep both by storing fqn too
      index.set(`${cls.packageName}.${cls.name}`, cls);
    } else {
      index.set(cls.name, cls);
    }
  }

  return index;
}
