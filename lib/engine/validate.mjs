// Dependency-free validator for the JSON Schema 2020-12 SUBSET used by contracts/schemas/*.schema.json.
// Supported keywords are listed in SUPPORTED; anything else in a schema is reported by unsupportedKeywords()
// (and fails test/engine.test.mjs) rather than being silently ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contracts/schemas');

const ANNOTATIONS = new Set(['$schema', '$id', '$defs', 'title', 'description']);
export const SUPPORTED = new Set(['$ref', 'type', 'enum', 'const', 'not', 'oneOf', 'anyOf', 'allOf', 'required', 'properties',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'format']);

// name ('token-ref') -> schema object; also keyed by $id ('token-ref.schema.json').
export const registry = new Map();
for (const f of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
  const s = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'));
  registry.set(f.replace('.schema.json', ''), s);
  registry.set(s.$id || f, s);
}
export const schemaNames = () => [...registry.keys()].filter((k) => !k.endsWith('.json'));
export const getSchema = (name) => registry.get(name) || registry.get(`${name}.schema.json`) || null;

function resolveRef(ref, root) {
  const [file, frag = ''] = ref.split('#');
  let target = file ? registry.get(file) : root;
  if (!target) throw new Error(`Unresolvable $ref ${ref}`);
  const docRoot = target;
  for (const part of frag.split('/').filter(Boolean)) {
    target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (target === undefined) throw new Error(`Unresolvable $ref ${ref}`);
  }
  return { schema: target, root: docRoot };
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function isType(v, t) {
  switch (t) {
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    default: return typeOf(v) === t;
  }
}
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FORMATS = {
  'date-time': (s) => DATE_TIME.test(s) && !Number.isNaN(Date.parse(s)),
  uri: (s) => { try { return Boolean(new URL(s).protocol); } catch { return false; } },
};

function check(schema, value, at, root, errs) {
  if (schema === true) return;
  if (schema === false) { errs.push({ path: at, message: 'not allowed' }); return; }
  const err = (message) => errs.push({ path: at, message });
  if (schema.$ref) { const r = resolveRef(schema.$ref, root); check(r.schema, value, at, r.root, errs); }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) { err(`expected ${types.join('|')}, got ${typeOf(value)}`); return; }
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) err(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if ('const' in schema && !deepEqual(schema.const, value)) err(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.not) { const e = []; check(schema.not, value, at, root, e); if (!e.length) err('must not match the "not" schema'); }
  if (schema.allOf) for (const s of schema.allOf) check(s, value, at, root, errs);
  if (schema.anyOf && !schema.anyOf.some((s) => { const e = []; check(s, value, at, root, e); return !e.length; })) err('must match at least one anyOf branch');
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => { const e = []; check(s, value, at, root, e); return e; });
    const n = results.filter((e) => !e.length).length;
    if (n !== 1) {
      err(n ? `must match exactly one oneOf branch (matched ${n})` : 'must match exactly one oneOf branch (matched 0)');
      if (!n) { const best = results.reduce((a, b) => (b.length < a.length ? b : a)); errs.push(...best); }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) err(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) err(`must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) err(`must be < ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) err(`length must be >= ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) err(`length must be <= ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) err(`must match ${schema.pattern}`);
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) err(`must be a valid ${schema.format}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`must have >= ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`must have <= ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => check(schema.items, v, `${at}/${i}`, root, errs));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) err(`missing required property "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) check(props[k], v, `${at}/${k}`, root, errs);
      else if (schema.additionalProperties === false) errs.push({ path: `${at}/${k}`, message: 'unexpected property' });
      else if (typeOf(schema.additionalProperties) === 'object') check(schema.additionalProperties, v, `${at}/${k}`, root, errs);
    }
  }
}

// validate('token-ref' | schemaObject, value) -> { valid, errors: [{ path, message }] }
export function validate(schemaOrName, value, { maxErrors = 20 } = {}) {
  const schema = typeof schemaOrName === 'string' ? getSchema(schemaOrName) : schemaOrName;
  if (!schema) return { valid: false, errors: [{ path: '', message: `Unknown schema ${schemaOrName}` }] };
  const errors = [];
  check(schema, value, '', schema, errors);
  return { valid: errors.length === 0, errors: errors.slice(0, maxErrors) };
}

export function assertValid(name, value, what = name) {
  const r = validate(name, value);
  if (!r.valid) throw Object.assign(new Error(`${what} failed ${name} schema: ${r.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`), { code: 'SCHEMA', errors: r.errors });
  return value;
}

// Keywords used in a schema that this validator does not implement (should always be empty).
export function unsupportedKeywords(schema, at = '') {
  const out = [];
  const walk = (s, p) => {
    if (!s || typeof s !== 'object') return;
    for (const [k, v] of Object.entries(s)) {
      if (!SUPPORTED.has(k) && !ANNOTATIONS.has(k)) out.push(`${p}/${k}`);
      if (k === 'properties' || k === '$defs') for (const [pk, pv] of Object.entries(v)) walk(pv, `${p}/${k}/${pk}`);
      else if (['items', 'not', 'additionalProperties'].includes(k)) walk(v, `${p}/${k}`);
      else if (['oneOf', 'anyOf', 'allOf'].includes(k)) v.forEach((x, i) => walk(x, `${p}/${k}/${i}`));
    }
  };
  walk(schema, at);
  return out;
}
