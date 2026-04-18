const SIMPLE_PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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

function formatPathSegment(part: number | string, hasPrefix: boolean): string {
  if (typeof part === 'number') {
    return `${hasPrefix ? '.' : ''}${part}`;
  }

  if (SIMPLE_PATH_SEGMENT.test(part)) {
    return `${hasPrefix ? '.' : ''}${part}`;
  }

  return `[${JSON.stringify(part)}]`;
}
