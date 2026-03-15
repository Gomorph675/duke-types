import { JavaAnnotation, JavaClass, JavaField, JavaType } from '../types';

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

/**
 * Remove all Java comments from source while preserving line numbers
 * (block comments become spaces, line comments become newlines).
 */
function stripComments(source: string): string {
  let result = '';
  let i = 0;

  while (i < source.length) {
    // Block comment
    if (source[i] === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i - 1] === '*' && source[i] === '/')) {
        i++;
      }
      i++; // consume closing /
      // Replace with spaces, preserving newlines for line tracking
      for (let j = start; j < i; j++) {
        result += source[j] === '\n' ? '\n' : ' ';
      }
      continue;
    }

    // Line comment
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // String literal – skip its contents so we don't confuse // inside strings
    if (source[i] === '"') {
      result += source[i++];
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') { result += source[i++]; } // escape
        result += source[i++];
      }
      if (i < source.length) result += source[i++]; // closing "
      continue;
    }

    // Char literal
    if (source[i] === "'") {
      result += source[i++];
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\') { result += source[i++]; }
        result += source[i++];
      }
      if (i < source.length) result += source[i++];
      continue;
    }

    result += source[i++];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Package / imports
// ---------------------------------------------------------------------------

function extractPackage(source: string): string {
  const m = source.match(/\bpackage\s+([\w.]+)\s*;/);
  return m ? m[1] : '';
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  const re = /\bimport\s+(?:static\s+)?([\w.*]+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Java type expression from a string, returning a JavaType and the
 * number of characters consumed.
 */
function parseType(src: string, offset: number): { type: JavaType; end: number } {
  let i = offset;

  // Skip leading whitespace
  while (i < src.length && /\s/.test(src[i])) i++;

  // Skip annotations on the type itself (e.g. @NonNull String)
  while (src[i] === '@') {
    i++; // skip @
    while (i < src.length && /[\w.]/.test(src[i])) i++;
    // skip annotation params
    if (src[i] === '(') {
      let depth = 1; i++;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
    }
    while (i < src.length && /\s/.test(src[i])) i++;
  }

  // Read the base type name (may include dots for fully-qualified names)
  const nameStart = i;
  while (i < src.length && /[\w.]/.test(src[i])) i++;
  const name = src.slice(nameStart, i).split('.').pop() ?? src.slice(nameStart, i);

  // Skip whitespace before potential <
  while (i < src.length && /\s/.test(src[i])) i++;

  // Generic type arguments
  let typeArgs: JavaType[] | undefined;
  if (src[i] === '<') {
    typeArgs = [];
    i++; // consume <
    let depth = 1;

    while (i < src.length && depth > 0) {
      // Skip whitespace
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '>') { depth--; i++; break; }
      if (src[i] === ',') { i++; continue; }

      // Wildcard ? or ? extends / ? super
      if (src[i] === '?') {
        i++;
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src.slice(i, i + 7) === 'extends' || src.slice(i, i + 5) === 'super') {
          while (i < src.length && !/[,>]/.test(src[i])) {
            if (src[i] === '<') depth++;
            else if (src[i] === '>') { depth--; if (depth === 0) break; }
            i++;
          }
        }
        typeArgs.push({ name: 'any', isArray: false, arrayDimensions: 0, isVarargs: false });
        continue;
      }

      const nested = parseType(src, i);
      typeArgs.push(nested.type);
      i = nested.end;

      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === ',') i++;
      else if (src[i] === '>') { depth--; i++; if (depth === 0) break; }
    }
  }

  // Array dimensions [] or ...
  let isArray = false;
  let arrayDimensions = 0;
  let isVarargs = false;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '[') {
      isArray = true;
      arrayDimensions++;
      i++;
      while (i < src.length && src[i] !== ']') i++;
      i++; // consume ]
    } else if (src.slice(i, i + 3) === '...') {
      isArray = true;
      isVarargs = true;
      arrayDimensions = 1;
      i += 3;
      break;
    } else {
      break;
    }
  }

  return {
    type: { name, typeArgs, isArray, arrayDimensions, isVarargs },
    end: i,
  };
}

// ---------------------------------------------------------------------------
// Annotation parsing
// ---------------------------------------------------------------------------

/**
 * Parse a run of annotations starting at `offset`.
 * Returns the annotations and the position after them.
 */
function parseAnnotations(src: string, offset: number): { annotations: JavaAnnotation[]; end: number } {
  const annotations: JavaAnnotation[] = [];
  let i = offset;

  while (true) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '@') break;

    i++; // consume @
    const nameStart = i;
    while (i < src.length && /[\w.]/.test(src[i])) i++;
    const name = src.slice(nameStart, i);

    // Skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;

    let params: string | undefined;
    if (src[i] === '(') {
      const paramStart = i;
      let depth = 1; i++;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      params = src.slice(paramStart, i);
    }

    // Skip @interface keyword (annotation type declarations) — treat as unknown
    if (name === 'interface') continue;

    annotations.push({ name, params });
  }

  return { annotations, end: i };
}

// ---------------------------------------------------------------------------
// Class-level declaration parsing
// ---------------------------------------------------------------------------

interface ClassDeclaration {
  kind: 'class' | 'interface' | 'enum' | 'abstract';
  name: string;
  annotations: JavaAnnotation[];
  typeParams: string[];
  superClass?: string;
  interfaces: string[];
  /** Index of opening '{' in the stripped source */
  bodyStart: number;
}

const JAVA_KEYWORDS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract',
  'native', 'synchronized', 'transient', 'volatile', 'strictfp',
  'class', 'interface', 'enum', 'extends', 'implements',
  'return', 'new', 'import', 'package', 'throws', 'throw',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'default', 'try', 'catch', 'finally',
]);

function findClassDeclaration(source: string): ClassDeclaration | null {
  // Find the top-level class/interface/enum keyword
  const declRe = /\b(class|interface|enum)\b/g;
  let m: RegExpExecArray | null;

  while ((m = declRe.exec(source)) !== null) {
    const keyword = m[1] as 'class' | 'interface' | 'enum';
    const keywordPos = m.index;

    // Look backwards from keyword to find annotations and modifiers
    const prefix = source.slice(0, keywordPos);
    // Extract last "block" of tokens before the keyword (everything after last ; or })
    const blockStart = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('}')) + 1;
    const prefixBlock = source.slice(blockStart, keywordPos);

    const { annotations } = parseAnnotations(prefixBlock, 0);

    // Determine kind
    let kind: ClassDeclaration['kind'] = keyword === 'enum' ? 'enum' : keyword === 'interface' ? 'interface' : 'class';
    if (keyword === 'class' && /\babstract\b/.test(prefixBlock)) kind = 'abstract';

    // Parse class name
    let i = keywordPos + keyword.length;
    while (i < source.length && /\s/.test(source[i])) i++;
    const nameStart = i;
    while (i < source.length && /\w/.test(source[i])) i++;
    const name = source.slice(nameStart, i);

    if (!name || JAVA_KEYWORDS.has(name)) continue;

    // Parse generic type params <T, K extends V>
    const typeParams: string[] = [];
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === '<') {
      i++;
      let depth = 1;
      let paramBuf = '';
      while (i < source.length && depth > 0) {
        const ch = source[i++];
        if (ch === '<') { depth++; paramBuf += ch; }
        else if (ch === '>') { depth--; if (depth > 0) paramBuf += ch; }
        else paramBuf += ch;
      }
      // Extract type param names (before any extends/super bound)
      for (const part of paramBuf.split(',')) {
        const tname = part.trim().split(/\s+/)[0];
        if (tname) typeParams.push(tname);
      }
    }

    // Parse extends / implements
    let superClass: string | undefined;
    const interfaces: string[] = [];

    while (i < source.length && source[i] !== '{') {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] === '{') break;

      const kwStart = i;
      while (i < source.length && /\w/.test(source[i])) i++;
      const kw = source.slice(kwStart, i);

      if (kw === 'extends') {
        while (i < source.length && /\s/.test(source[i])) i++;
        const tResult = parseType(source, i);
        superClass = tResult.type.name;
        i = tResult.end;
        // Skip any generic portion already consumed; handle comma-separated for interfaces
      } else if (kw === 'implements') {
        // Parse comma-separated list until {
        while (i < source.length && source[i] !== '{') {
          while (i < source.length && /[\s,]/.test(source[i])) i++;
          if (source[i] === '{') break;
          const tResult = parseType(source, i);
          interfaces.push(tResult.type.name);
          i = tResult.end;
          while (i < source.length && /\s/.test(source[i])) i++;
        }
      } else {
        // Skip unknown token
        i++;
      }
    }

    const bodyStart = i; // points at '{'

    return { kind, name, annotations, typeParams, superClass, interfaces, bodyStart };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Body extraction (top-level brace matching)
// ---------------------------------------------------------------------------

/**
 * Extract the content between the outer { } of the class body.
 * Returns the source between the braces (exclusive) and the end position.
 */
function extractBody(source: string, openBracePos: number): { body: string; end: number } {
  let i = openBracePos;
  if (source[i] !== '{') {
    // Scan forward to find it
    while (i < source.length && source[i] !== '{') i++;
  }
  const start = i + 1;
  let depth = 1;
  i++;

  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  return { body: source.slice(start, i - 1), end: i };
}

// ---------------------------------------------------------------------------
// Enum constant parsing
// ---------------------------------------------------------------------------

function parseEnumConstants(body: string): string[] {
  // Enum constants appear before the first method/field/; section
  // Split at the first ; that's not inside parens or braces
  let i = 0;
  let depth = 0;
  let constantSection = '';
  while (i < body.length) {
    const ch = body[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      constantSection = body.slice(0, i);
      break;
    }
    i++;
  }
  if (!constantSection) constantSection = body; // enums without methods/fields

  // Extract constant names: words before ( or , or end-of-section, skipping annotations
  const constants: string[] = [];
  const re = /@[\w.]+(?:\s*\([^)]*\))?\s*|(\b[A-Z_][A-Z0-9_]*\b)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(constantSection)) !== null) {
    if (match[1]) constants.push(match[1]);
  }
  return constants;
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

const FIELD_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final',
  'transient', 'volatile', 'synchronized', 'native', 'abstract',
]);

/**
 * Parse fields from a class body. Skips methods, constructors, inner classes,
 * and static initializer blocks.
 */
function parseFields(body: string, classTypeParams: string[]): JavaField[] {
  const fields: JavaField[] = [];
  let i = 0;

  while (i < body.length) {
    // Skip whitespace
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;

    // Skip inner class / interface / enum declarations
    if (/\b(class|interface|enum)\b/.test(body.slice(i, i + 12))) {
      // Skip to the matching closing brace
      while (i < body.length && body[i] !== '{') i++;
      const { end } = extractBody(body, i);
      i = end;
      // consume optional semicolon
      while (i < body.length && /[\s;]/.test(body[i])) i++;
      continue;
    }

    // Skip static initializers and instance initializers: { ... }
    if (body[i] === '{') {
      const { end } = extractBody(body, i);
      i = end;
      continue;
    }

    // Collect annotations
    const annotationStart = i;
    const { annotations, end: afterAnnotations } = parseAnnotations(body, i);
    i = afterAnnotations;
    while (i < body.length && /\s/.test(body[i])) i++;

    // Collect modifiers
    const modifiers: string[] = [];
    let isStatic = false;
    let isFinal = false;
    let isTransient = false;

    while (i < body.length) {
      const wordStart = i;
      while (i < body.length && /\w/.test(body[i])) i++;
      const word = body.slice(wordStart, i);

      if (FIELD_MODIFIERS.has(word)) {
        modifiers.push(word);
        if (word === 'static') isStatic = true;
        if (word === 'final') isFinal = true;
        if (word === 'transient') isTransient = true;
        while (i < body.length && /\s/.test(body[i])) i++;
        continue;
      }

      // Not a modifier — back up, this is the start of the type
      i = wordStart;
      break;
    }

    if (i >= body.length) break;

    // Skip semicolons from previous incomplete parses
    if (body[i] === ';') { i++; continue; }

    // Parse the type
    const typeResult = parseType(body, i);
    i = typeResult.end;
    while (i < body.length && /\s/.test(body[i])) i++;

    // Parse the field name
    const nameStart = i;
    while (i < body.length && /\w/.test(body[i])) i++;
    const fieldName = body.slice(nameStart, i);

    while (i < body.length && /\s/.test(body[i])) i++;

    // Determine if this is a field (ends with ; or =) or a method/constructor (followed by ()
    if (!fieldName || JAVA_KEYWORDS.has(fieldName) || !fieldName.match(/^[a-zA-Z_$][\w$]*$/)) {
      // Skip to end of statement or block
      skipToNextMember(body, i);
      const skip = skipToNextMember(body, annotationStart);
      i = skip;
      continue;
    }

    if (body[i] === '(') {
      // It's a method or constructor — skip its body
      // Skip parameter list
      let depth = 1; i++;
      while (i < body.length && depth > 0) {
        if (body[i] === '(') depth++;
        else if (body[i] === ')') depth--;
        i++;
      }
      while (i < body.length && /\s/.test(body[i])) i++;
      // Skip throws clause
      if (body.slice(i, i + 6) === 'throws') {
        while (i < body.length && body[i] !== '{' && body[i] !== ';') i++;
      }
      // Skip method body or abstract ;
      if (body[i] === '{') {
        const { end } = extractBody(body, i);
        i = end;
      } else if (body[i] === ';') {
        i++;
      }
      continue;
    }

    // It's a field. Handle multi-variable declarations: Type a, b, c;
    // Determine nullability from annotations
    const isNullable = annotations.some(a =>
      a.name === 'Nullable' || a.name === 'JsonInclude' || a.name === 'null'
    ) || typeResult.type.name === 'Optional';

    // Skip default value if present
    if (body[i] === '=' || body[i] === ',') {
      // Skip to ;
      let depth = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (ch === ';' && depth === 0) { i++; break; }
        i++;
      }
    } else if (body[i] === ';') {
      i++;
    }

    // Skip static fields and constants (optional — keep final non-static)
    if (isStatic) continue;

    fields.push({
      name: fieldName,
      type: typeResult.type,
      annotations,
      modifiers,
      isStatic,
      isFinal,
      isTransient,
      isNullable,
    });
  }

  return fields;
}

/** Skip forward to what looks like the start of the next class member */
function skipToNextMember(body: string, pos: number): number {
  let i = pos;
  let depth = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === ';' && depth === 0) { i++; break; }
    i++;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Java source file into a structured JavaClass representation.
 * Returns null if no class/interface/enum declaration is found.
 */
export function parseJavaFile(content: string, filePath: string): JavaClass | null {
  const source = stripComments(content);

  const packageName = extractPackage(source);
  const imports = extractImports(source);

  const decl = findClassDeclaration(source);
  if (!decl) return null;

  const { body } = extractBody(source, decl.bodyStart);

  let fields: JavaField[] = [];
  let enumConstants: string[] = [];

  if (decl.kind === 'enum') {
    enumConstants = parseEnumConstants(body);
  } else {
    fields = parseFields(body, decl.typeParams);
  }

  return {
    kind: decl.kind,
    name: decl.name,
    packageName,
    annotations: decl.annotations,
    typeParams: decl.typeParams,
    superClass: decl.superClass,
    interfaces: decl.interfaces,
    fields,
    enumConstants,
    imports,
    filePath,
  };
}
