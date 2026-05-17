import { SopDefinition } from '@sop-runtime/definition';

/**
 * Lightweight in-memory registry for SOP definitions.
 *
 * 轻量级内存中的 SOP 定义注册表。
 *
 * Allows registering definitions by (sop_id, version) and resolving them for use
 * with RuntimeHost. Useful for embedding scenarios where definitions are managed
 * inside the application rather than loaded from external storage.
 *
 * @public
 */
export class DefinitionRegistry {
  private readonly definitions = new Map<string, SopDefinition>();

  private key(sopId: string, version: string): string {
    return `${sopId}:${version}`;
  }

  /**
   * Register a SOP definition. If a definition with the same sop_id and version
   * already exists, it will be overwritten.
   *
   * 注册一个 SOP 定义。如果具有相同 sop_id 和 version 的定义已存在，将被覆盖。
   */
  register(definition: SopDefinition): void {
    this.definitions.set(this.key(definition.sop_id, definition.version), structuredClone(definition));
  }

  /**
   * Resolve a SOP definition by sop_id and optional version.
   *
   * 根据 sop_id 和可选 version 解析 SOP 定义。
   *
   * @param sopId - The SOP identifier.
   * @param version - Optional version. If omitted, returns the latest registered version.
   * @returns The definition, or null if not found.
   */
  resolve(sopId: string, version?: string): SopDefinition | null {
    if (version !== undefined) {
      const def = this.definitions.get(this.key(sopId, version));
      return def !== undefined ? structuredClone(def) : null;
    }

    // Find the latest version for the given sopId
    let latest: SopDefinition | null = null;
    let latestParts: number[] = [];

    for (const [key, def] of this.definitions) {
      if (!key.startsWith(`${sopId}:`)) continue;
      const v = def.version;
      const parts = v.split('.').map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? n : 0;
      });
      if (latest === null || compareVersionParts(parts, latestParts) > 0) {
        latest = def;
        latestParts = parts;
      }
    }

    return latest !== null ? structuredClone(latest) : null;
  }

  /**
   * List all registered definitions.
   *
   * 列出所有已注册的定义。
   */
  list(): SopDefinition[] {
    return Array.from(this.definitions.values()).map((d) => structuredClone(d));
  }

  /**
   * Remove a registered definition.
   *
   * 移除一个已注册的定义。
   *
   * @returns true if a definition was removed, false if not found.
   */
  remove(sopId: string, version?: string): boolean {
    if (version !== undefined) {
      return this.definitions.delete(this.key(sopId, version));
    }

    // Remove all versions of the given sopId
    let removed = false;
    for (const key of this.definitions.keys()) {
      if (key.startsWith(`${sopId}:`)) {
        this.definitions.delete(key);
        removed = true;
      }
    }
    return removed;
  }
}

function compareVersionParts(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
