/**
 * Utilities for turning nested field positions into user-facing paths.
 *
 * 用于把嵌套字段位置格式化为面向用户的路径字符串。
 */
const SIMPLE_PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Join path fragments into the canonical diagnostic path format.
 *
 * 把路径片段拼接成诊断输出使用的标准路径格式。
 *
 * @param parts - Path fragments that may include keys, indices, or `undefined`.
 * 路径片段，可以包含对象键、数组下标或 `undefined`。
 * @returns A normalized diagnostic path string.
 * 规范化后的诊断路径字符串。
 */
export function joinPath(...parts: Array<number | string | undefined>): string {
  const definedParts = parts.filter((part) => part !== undefined);
  if (definedParts.length === 0) {
    return '';
  }

  const [firstPart, ...remainingParts] = definedParts;
  let path = String(firstPart);

  remainingParts.forEach((part) => {
    path += formatPathSegment(part, path.length > 0);
  });

  return path;
}

/**
 * Format a single path segment, escaping unusual keys when necessary.
 *
 * 格式化单个路径片段，并在键名特殊时自动转义。
 *
 * @param part - Path fragment to format.
 * 需要格式化的路径片段。
 * @param hasPrefix - Whether the resulting segment should include a separator prefix.
 * 结果片段前面是否需要带分隔符。
 * @returns Formatted path segment.
 * 已格式化的路径片段。
 */
function formatPathSegment(part: number | string, hasPrefix: boolean): string {
  if (typeof part === 'number') {
    return `${hasPrefix ? '.' : ''}${part}`;
  }

  if (SIMPLE_PATH_SEGMENT.test(part)) {
    return `${hasPrefix ? '.' : ''}${part}`;
  }

  return `[${JSON.stringify(part)}]`;
}
