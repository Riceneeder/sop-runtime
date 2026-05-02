import { JsonObject } from '@sop-runtime/definition';

export function renderCommandTemplate(template: string, inputs: JsonObject): string {
  return template.replaceAll(/\$\{([^}]+)\}/g, (_match, capture: string) => {
    const value = resolvePath(inputs, capture.trim());
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

export function resolvePath(root: JsonObject, dottedPath: string): unknown {
  if (dottedPath.length === 0) {
    return undefined;
  }
  const segments = dottedPath.split('.').filter((segment) => segment.length > 0);
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    const asRecord = current as Record<string, unknown>;
    current = asRecord[segment];
    if (current === undefined || current === null) {
      return current;
    }
  }
  return current;
}
