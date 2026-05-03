import { JsonObject } from '@sop-runtime/definition';

/**
 * Render a command template by replacing `${path}` placeholders with values from the input object.
 *
 * 渲染命令模板，将 `${path}` 占位符替换为输入对象中的值。
 *
 * @param template - The command template string containing `${path}` placeholders.
 * @param inputs - The input object to resolve placeholder paths against.
 * @returns The rendered command string.
 * @public
 */
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

/**
 * Walk a dotted path into a JSON object and return the resolved value.
 *
 * 沿点号路径访问 JSON 对象并返回解析后的值。
 *
 * @param root - The root JSON object to start from.
 * @param dottedPath - The dotted path string (e.g. "user.name").
 * @returns The resolved value, or undefined if the path cannot be resolved.
 * @public
 */
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
