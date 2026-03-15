import { JavaType, TsTypeRef } from '../types';
import { DukeTypesConfig } from '../config';

// ---------------------------------------------------------------------------
// Known Java → TypeScript type mappings
// ---------------------------------------------------------------------------

/** Java primitive and common types that map to TypeScript built-ins */
const PRIMITIVE_MAP: Record<string, string> = {
  // Numeric primitives
  byte: 'number',
  short: 'number',
  int: 'number',
  long: 'number',
  float: 'number',
  double: 'number',
  // Boxed numerics
  Byte: 'number',
  Short: 'number',
  Integer: 'number',
  Long: 'number',
  Float: 'number',
  Double: 'number',
  Number: 'number',
  BigDecimal: 'number',
  BigInteger: 'number',
  // Boolean
  boolean: 'boolean',
  Boolean: 'boolean',
  // String-like
  String: 'string',
  char: 'string',
  Character: 'string',
  CharSequence: 'string',
  StringBuilder: 'string',
  StringBuffer: 'string',
  // ID / UUID
  UUID: 'string',
  // Void
  void: 'void',
  Void: 'void',
  // Object / Any
  Object: 'any',
  Serializable: 'unknown',
  Cloneable: 'unknown',
  // Common java types
  Class: 'string',
  Enum: 'string',
  // URI / URL / filesystem
  URI: 'string',
  URL: 'string',
  Path: 'string',
  File: 'string',
  // Locale / currency / timezone
  Locale: 'string',
  Currency: 'string',
  TimeZone: 'string',
  ZoneId: 'string',
  ZoneOffset: 'string',
  // Regex
  Pattern: 'string',
  // Atomic numerics / boolean
  AtomicInteger: 'number',
  AtomicLong: 'number',
  AtomicDouble: 'number',
  AtomicBoolean: 'boolean',
  // Jackson JSON node types
  JsonNode: 'any',
  ObjectNode: 'Record<string, any>',
  ArrayNode: 'any[]',
};

/** Collection types that map to Array */
const ARRAY_LIKE: Set<string> = new Set([
  'List',
  'ArrayList',
  'LinkedList',
  'Set',
  'HashSet',
  'LinkedHashSet',
  'TreeSet',
  'Collection',
  'Iterable',
  'Queue',
  'Deque',
  'ArrayDeque',
  'Stack',
  'Vector',
  'SortedSet',
  'NavigableSet',
  'EnumSet',
  // java.util.concurrent
  'PriorityQueue',
  'CopyOnWriteArrayList',
  'CopyOnWriteArraySet',
  'ConcurrentLinkedQueue',
  'ConcurrentLinkedDeque',
  'BlockingQueue',
  'LinkedBlockingQueue',
  'ArrayBlockingQueue',
  'PriorityBlockingQueue',
  'TransferQueue',
  'LinkedTransferQueue',
  'ConcurrentSkipListSet',
  // Guava immutable collections
  'ImmutableList',
  'ImmutableSet',
  'ImmutableSortedSet',
  'ImmutableCollection',
]);

/** Map types that map to Record */
const MAP_LIKE: Set<string> = new Set([
  'Map',
  'HashMap',
  'LinkedHashMap',
  'TreeMap',
  'Hashtable',
  'ConcurrentHashMap',
  'SortedMap',
  'NavigableMap',
  'EnumMap',
  'IdentityHashMap',
  'WeakHashMap',
  // java.util.concurrent
  'ConcurrentSkipListMap',
  // Guava immutable maps
  'ImmutableMap',
  'ImmutableSortedMap',
  'ImmutableBiMap',
]);

/** Guava/Apache Multimap types → Record<string, V[]> */
const MULTIMAP_LIKE: Set<string> = new Set([
  'Multimap',
  'ListMultimap',
  'SetMultimap',
  'ArrayListMultimap',
  'HashMultimap',
  'LinkedListMultimap',
  'LinkedHashMultimap',
  'TreeMultimap',
  'ImmutableMultimap',
  'ImmutableListMultimap',
  'ImmutableSetMultimap',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a parsed JavaType into a TypeScript type string and optionally
 * the name of a user-defined type that needs to be imported.
 */
export function mapType(javaType: JavaType, config: DukeTypesConfig): TsTypeRef {
  // byte[] → string (base64 over the wire)
  if (javaType.name === 'byte' && javaType.isArray) {
    return { type: 'string', isKnown: true };
  }

  const result = resolveType(javaType, config);

  // Apply array wrapping
  if (javaType.isArray && !ARRAY_LIKE.has(javaType.name)) {
    const dims = '[]'.repeat(javaType.arrayDimensions);
    return { ...result, type: result.type + dims };
  }

  return result;
}

function resolveType(javaType: JavaType, config: DukeTypesConfig): TsTypeRef {
  const name = javaType.name;
  const args = javaType.typeArgs ?? [];

  // ---------------------------------------------------------------------------
  // Primitives and well-known types
  // ---------------------------------------------------------------------------
  if (name in PRIMITIVE_MAP) {
    return { type: PRIMITIVE_MAP[name], isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Date / time types
  // ---------------------------------------------------------------------------
  if (
    name === 'LocalDate' || name === 'LocalDateTime' || name === 'ZonedDateTime' ||
    name === 'OffsetDateTime' || name === 'LocalTime' || name === 'OffsetTime' ||
    name === 'Instant' || name === 'Date' || name === 'Calendar' ||
    name === 'GregorianCalendar' || name === 'Timestamp' || name === 'Time' ||
    name === 'Year' || name === 'YearMonth' || name === 'MonthDay' ||
    name === 'Duration' || name === 'Period'
  ) {
    const dateType = config.dateType === 'Date' ? 'Date' : 'string';
    return { type: dateType, isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Optional<T> → T | undefined (or T | null depending on config)
  // ---------------------------------------------------------------------------
  if (name === 'Optional') {
    if (args.length === 1) {
      const inner = resolveType(args[0], config);
      const suffix = ' | undefined';
      return { ...inner, type: `${inner.type}${suffix}` };
    }
    return { type: 'unknown', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Collection types → T[]
  // ---------------------------------------------------------------------------
  if (ARRAY_LIKE.has(name)) {
    if (args.length === 1) {
      const inner = resolveType(args[0], config);
      return { ...inner, type: `${inner.type}[]` };
    }
    return { type: 'any[]', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Map types → Record<K, V>
  // ---------------------------------------------------------------------------
  if (MAP_LIKE.has(name)) {
    if (args.length === 2) {
      const keyRef = resolveType(args[0], config);
      const valRef = resolveType(args[1], config);
      // Key must be string | number for Record
      const keyType = keyRef.type === 'number' ? 'number' : 'string';
      // If value has an import, surface it; key imports are usually primitives
      return {
        type: `Record<${keyType}, ${valRef.type}>`,
        importName: valRef.importName,
        isKnown: true,
      };
    }
    return { type: 'Record<string, any>', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Multimap types → Record<string, V[]>
  // ---------------------------------------------------------------------------
  if (MULTIMAP_LIKE.has(name)) {
    if (args.length === 2) {
      const valRef = resolveType(args[1], config);
      return {
        type: `Record<string, ${valRef.type}[]>`,
        importName: valRef.importName,
        isKnown: true,
      };
    }
    return { type: 'Record<string, any[]>', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // AtomicReference<T> → T
  // ---------------------------------------------------------------------------
  if (name === 'AtomicReference') {
    if (args.length === 1) {
      return resolveType(args[0], config);
    }
    return { type: 'unknown', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Pair / Triple / Entry / Tuple-like
  // ---------------------------------------------------------------------------
  if (
    name === 'Entry' || name === 'SimpleEntry' || name === 'SimpleImmutableEntry' ||
    name === 'Pair' || name === 'MutablePair' || name === 'ImmutablePair'
  ) {
    if (args.length === 2) {
      const k = resolveType(args[0], config);
      const v = resolveType(args[1], config);
      return { type: `[${k.type}, ${v.type}]`, isKnown: true };
    }
    return { type: '[any, any]', isKnown: true };
  }

  if (name === 'Triple' || name === 'MutableTriple' || name === 'ImmutableTriple') {
    if (args.length === 3) {
      const a = resolveType(args[0], config);
      const b = resolveType(args[1], config);
      const c = resolveType(args[2], config);
      return { type: `[${a.type}, ${b.type}, ${c.type}]`, isKnown: true };
    }
    return { type: '[any, any, any]', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Generic type variables (T, K, V, E, etc.) — pass through
  // ---------------------------------------------------------------------------
  if (/^[A-Z]$/.test(name)) {
    return { type: name, isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Wildcard / any
  // ---------------------------------------------------------------------------
  if (name === 'any' || name === '?' || name === 'wildcard') {
    return { type: 'any', isKnown: true };
  }

  // ---------------------------------------------------------------------------
  // Unknown / user-defined type — treat as a reference to a generated TS type
  // ---------------------------------------------------------------------------
  if (args.length > 0) {
    // Generic user-defined type, e.g. PagedResult<User>
    const resolvedArgs = args.map(a => resolveType(a, config).type);
    return {
      type: `${name}<${resolvedArgs.join(', ')}>`,
      importName: name,
      isKnown: false,
    };
  }

  return { type: name, importName: name, isKnown: false };
}
