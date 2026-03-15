/**
 * Internal representation of a Java annotation
 */
export interface JavaAnnotation {
  name: string;
  /** Raw parameter string, e.g. '(nullable = true)' */
  params?: string;
}

/**
 * Represents a Java type reference, including generics and arrays
 */
export interface JavaType {
  /** Base type name, e.g. 'String', 'List', 'Map' */
  name: string;
  /** Generic type arguments */
  typeArgs?: JavaType[];
  /** True if this is an array type, e.g. String[] */
  isArray: boolean;
  /** Array dimensions, e.g. 2 for String[][] */
  arrayDimensions: number;
  /** True if this is a varargs parameter */
  isVarargs: boolean;
}

/**
 * Represents a field in a Java class
 */
export interface JavaField {
  name: string;
  type: JavaType;
  annotations: JavaAnnotation[];
  /** true if private/protected/public */
  modifiers: string[];
  isStatic: boolean;
  isFinal: boolean;
  isTransient: boolean;
  /** True if annotated with @Nullable or wrapped in Optional<> */
  isNullable: boolean;
}

/**
 * Represents a parsed Java class, interface, or enum
 */
export interface JavaClass {
  kind: 'class' | 'interface' | 'enum' | 'abstract';
  name: string;
  packageName: string;
  /** All annotations on the class declaration */
  annotations: JavaAnnotation[];
  /** Generic type parameter names, e.g. ['T', 'K', 'V'] */
  typeParams: string[];
  /** Superclass name (unqualified), if any */
  superClass?: string;
  /** Implemented interface names (unqualified) */
  interfaces: string[];
  /** Fields for class/interface kinds */
  fields: JavaField[];
  /** Constant names for enum kind */
  enumConstants: string[];
  /** Raw import statements, e.g. 'java.util.List' */
  imports: string[];
  /** Absolute path to the source file */
  filePath: string;
}

/**
 * A resolved TypeScript type reference
 */
export interface TsTypeRef {
  /** TypeScript type string, e.g. 'string', 'number', 'User[]' */
  type: string;
  /** If this type requires an import, the name to import */
  importName?: string;
  /** Whether the type was resolved from a known Java type or kept as-is */

  isKnown: boolean;
}

/**
 * Result of generating a single TypeScript file
 */
export interface GeneratedFile {
  /** Output file path (relative to outDir) */
  relativePath: string;
  /** Absolute output path */
  absolutePath: string;
  /** Generated TypeScript source */
  content: string;
  /** The Java class this was generated from */
  sourceClass: JavaClass;
}
