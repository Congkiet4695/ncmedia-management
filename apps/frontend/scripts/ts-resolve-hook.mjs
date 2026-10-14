import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx'];

/** Gốc frontend — đích của alias `@/*` (khớp `paths` trong tsconfig.json). */
const ROOT_URL = new URL('../', import.meta.url);

/**
 * Import tương đối / alias `@/` không đuôi ⇒ thử `.ts` rồi `.tsx`; có file thì dùng, không thì để Node xử lý.
 */
export async function resolve(specifier, context, nextResolve) {
  const alias = specifier.startsWith('@/');
  const relative = alias || specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (relative && !hasExtension && context.parentURL) {
    const base = alias ? new URL(specifier.slice(2), ROOT_URL) : new URL(specifier, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(`${base.href}${extension}`);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
}
