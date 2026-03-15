import * as path from 'path';
import { JavaClass, JavaField, GeneratedFile } from '../types';
import { DukeTypesConfig } from '../config';
import { mapType } from './type-mapper';
import { resolveImportPath, isResolvable } from '../resolver/import-resolver';

// ---------------------------------------------------------------------------
// Nullability helpers
// ---------------------------------------------------------------------------

/** Annotations that explicitly mark a field as nullable */
const NULLABLE_ANNOTATIONS = new Set([
  'Nullable',
  'Null',
  'CheckForNull',
  'CanBeNull',
  'MayBeNull',
  'JsonInclude', // @JsonInclude(Include.NON_NULL) doesn't actually mean nullable, but common pattern
]);

/** Annotations that explicitly mark a field as non-null */
const NONNULL_ANNOTATIONS = new Set([
  'NotNull',
  'NonNull',
  'Nonnull',
  'NotBlank',
  'NotEmpty',
]);

function isFieldOptional(field: JavaField, config: DukeTypesConfig): boolean {
  const annotationNames = new Set(field.annotations.map(a => a.name));

  if (NONNULL_ANNOTATIONS.has([...annotationNames].find(n => NONNULL_ANNOTATIONS.has(n)) ?? '')) {
    return false;
  }

  if (annotationNames.has([...NULLABLE_ANNOTATIONS].find(n => annotationNames.has(n)) ?? '')) {
    return true;
  }

  if (field.type.name === 'Optional') return true;

  // Fall back to config strategy
  switch (config.nullableStrategy) {
    case 'all-optional': return true;
    case 'never': return false;
    default: return false; // 'annotated-only'
  }
}

// ---------------------------------------------------------------------------
// Import resolution helpers
// ---------------------------------------------------------------------------

interface ImportEntry {
  name: string;
  path: string;
}

/**
 * Build the set of TS import statements needed for a generated file.
 * `typeImportNames` is the set of user-defined type names referenced.
 * `javaImports` is the raw Java import list from the parsed class.
 * `allClasses` is the index of all parsed Java classes for path resolution.
 */
function buildImports(
  typeImportNames: Set<string>,
  javaClass: JavaClass,
  allClasses: Map<string, JavaClass>,
  outDir: string,
  outputFilePath: string,
  config: DukeTypesConfig,
): string[] {
  const entries: ImportEntry[] = [];
  const seen = new Set<string>();

  for (const name of typeImportNames) {
    if (seen.has(name)) continue;
    seen.add(name);

    const importPath = resolveImportPath(
      name,
      javaClass,
      allClasses,
      outDir,
      outputFilePath,
      config,
    );

    if (importPath) {
      entries.push({ name, path: importPath });
    }
  }

  // Sort: relative paths first, then others
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return entries.map(e => `import type { ${e.name} } from '${e.path}';`);
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateTypeParams(params: string[]): string {
  return params.length > 0 ? `<${params.join(', ')}>` : '';
}

function generateEnum(javaClass: JavaClass): string {
  const lines: string[] = [];
  lines.push(`export enum ${javaClass.name} {`);
  for (const constant of javaClass.enumConstants) {
    lines.push(`  ${constant} = '${constant}',`);
  }
  lines.push('}');
  return lines.join('\n');
}

function generateInterface(
  javaClass: JavaClass,
  allClasses: Map<string, JavaClass>,
  outDir: string,
  outputFilePath: string,
  config: DukeTypesConfig,
): string {
  const typeImportNames = new Set<string>();
  const fieldLines: string[] = [];

  for (const field of javaClass.fields) {
    const tsType = mapType(field.type, config);
    if (tsType.importName) typeImportNames.add(tsType.importName);

    const optional = isFieldOptional(field, config) ? '?' : '';
    fieldLines.push(`  ${field.name}${optional}: ${tsType.type};`);
  }

  // Collect imports from superclass and interfaces
  if (javaClass.superClass) typeImportNames.add(javaClass.superClass);
  for (const iface of javaClass.interfaces) typeImportNames.add(iface);

  // Remove self-references
  typeImportNames.delete(javaClass.name);

  const importLines = buildImports(
    typeImportNames,
    javaClass,
    allClasses,
    outDir,
    outputFilePath,
    config,
  );

  const lines: string[] = [];

  if (importLines.length > 0) {
    lines.push(...importLines);
    lines.push('');
  }

  // Build extends clause
  const extendsClause = buildExtendsClause(javaClass, config);
  const typeParams = generateTypeParams(javaClass.typeParams);
  const keyword = config.outputType === 'type' ? 'type' : 'interface';

  if (config.outputType === 'type') {
    const body = fieldLines.join('\n').trim();
    const baseTypes = buildExtendsTypes(javaClass);
    if (baseTypes.length > 0) {
      lines.push(`export type ${javaClass.name}${typeParams} = ${baseTypes.join(' & ')} & {`);
    } else {
      lines.push(`export type ${javaClass.name}${typeParams} = {`);
    }
    lines.push(...fieldLines);
    lines.push('};');
  } else {
    lines.push(`export interface ${javaClass.name}${typeParams}${extendsClause} {`);
    lines.push(...fieldLines);
    lines.push('}');
  }

  return lines.join('\n');
}

/** Filter out Java stdlib types that don't have corresponding TS output */
function filterTsInheritance(names: string[], javaClass: JavaClass): string[] {
  return names.filter(n => isResolvable(n, javaClass.imports));
}

function buildExtendsClause(javaClass: JavaClass, config: DukeTypesConfig): string {
  const candidates: string[] = [];
  if (javaClass.superClass) candidates.push(javaClass.superClass);
  candidates.push(...javaClass.interfaces);
  const parts = filterTsInheritance(candidates, javaClass);
  return parts.length > 0 ? ` extends ${parts.join(', ')}` : '';
}

function buildExtendsTypes(javaClass: JavaClass): string[] {
  const candidates: string[] = [];
  if (javaClass.superClass) candidates.push(javaClass.superClass);
  candidates.push(...javaClass.interfaces);
  return filterTsInheritance(candidates, javaClass);
}

// ---------------------------------------------------------------------------
// Output path computation
// ---------------------------------------------------------------------------

/**
 * Compute the output file path for a given Java class.
 * Mirrors the Java package structure under outDir.
 */
export function computeOutputPath(javaClass: JavaClass, outDir: string): string {
  const packagePath = javaClass.packageName.replace(/\./g, path.sep);
  return path.join(outDir, packagePath, `${javaClass.name}.ts`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a TypeScript file from a parsed Java class.
 */
export function generateTypeScriptFile(
  javaClass: JavaClass,
  allClasses: Map<string, JavaClass>,
  outDir: string,
  config: DukeTypesConfig,
): GeneratedFile {
  const absolutePath = computeOutputPath(javaClass, outDir);
  const relativePath = path.relative(outDir, absolutePath);

  let content: string;

  if (javaClass.kind === 'enum') {
    content = generateEnum(javaClass);
  } else {
    content = generateInterface(javaClass, allClasses, outDir, absolutePath, config);
  }

  // Add header comment
  const header = `// Generated by duke-types from ${path.basename(javaClass.filePath)}\n// Do not edit manually.\n\n`;
  content = header + content + '\n';

  return { relativePath, absolutePath, content, sourceClass: javaClass };
}

/**
 * Generate a barrel index file that re-exports all generated types.
 * Enums use a value export so they can be used at runtime.
 * Interfaces/abstract classes use `export type`.
 */
export function generateIndexFile(files: GeneratedFile[], outDir: string): string {
  const lines = files
    .map(f => {
      const rel = path.relative(outDir, f.absolutePath)
        .replace(/\\/g, '/')
        .replace(/\.ts$/, '');
      const isEnum = f.sourceClass.kind === 'enum';
      // Enums export both the value and the type; interfaces export type-only
      return isEnum
        ? `export { ${f.sourceClass.name} } from './${rel}';`
        : `export type { ${f.sourceClass.name} } from './${rel}';`;
    })
    .sort();

  return `// Generated by duke-types\n// Do not edit manually.\n\n${lines.join('\n')}\n`;
}
