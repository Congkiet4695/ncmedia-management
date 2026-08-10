#!/usr/bin/env node
/**
 * Kiểm tra sức khoẻ hệ thống đa ngôn ngữ. Chạy: `npm run check:i18n`.
 *
 * Ba việc, đều là lỗi chỉ lộ ra lúc chạy nếu không kiểm tra tự động:
 *  1. Các ngôn ngữ phải có ĐỦ và ĐÚNG cùng bộ khoá (thiếu khoá ⇒ hiện khoá thô).
 *  2. Mọi khoá `t('...')` tĩnh trong mã nguồn phải tồn tại.
 *  3. Khoá đó phải trỏ tới một CHUỖI, không phải một nhánh con.
 *
 * Chỉ soi khoá tĩnh; khoá dựng động (`t(\`status.${x}\`)`) được bỏ qua có chủ ý —
 * phần đó do bộ khoá enum ở bước 1 bảo đảm.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOCALES_DIR = join(ROOT, 'i18n/locales');
const SOURCE_DIRS = ['app', 'components', 'features', 'hooks', 'config', 'providers'];
const REFERENCE_LOCALE = 'vi';

const problems = [];

/** Duyệt cây thư mục, trả về mọi file .ts/.tsx (bỏ node_modules và chính thư mục i18n). */
function collectSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'i18n') continue;
      out.push(...collectSources(path));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

function flatten(node, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const nested of flatten(value, full)) keys.add(nested);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

// --- 1. Đối chiếu bộ khoá giữa các ngôn ngữ -------------------------------------
const locales = readdirSync(LOCALES_DIR);
const bundles = {};
for (const locale of locales) {
  bundles[locale] = {};
  for (const file of readdirSync(join(LOCALES_DIR, locale))) {
    bundles[locale][file.replace(/\.json$/, '')] = JSON.parse(
      readFileSync(join(LOCALES_DIR, locale, file), 'utf8'),
    );
  }
}

const reference = bundles[REFERENCE_LOCALE];
if (!reference) {
  problems.push(`Thiếu ngôn ngữ tham chiếu "${REFERENCE_LOCALE}"`);
}

for (const locale of locales) {
  if (locale === REFERENCE_LOCALE) continue;
  for (const namespace of Object.keys(reference ?? {})) {
    const expected = flatten(reference[namespace]);
    const actual = bundles[locale][namespace] ? flatten(bundles[locale][namespace]) : new Set();
    for (const key of expected) {
      if (!actual.has(key)) problems.push(`[${locale}] thiếu khoá ${namespace}:${key}`);
    }
    for (const key of actual) {
      if (!expected.has(key)) problems.push(`[${locale}] thừa khoá ${namespace}:${key}`);
    }
  }
}

// --- 2 & 3. Đối chiếu khoá dùng trong mã nguồn ----------------------------------
const CALL = /\bt\(\s*['"`]([^'"`$]+)['"`]/g;
const USE_TRANSLATION = /useTranslation\(\s*(?:\[([^\]]*)\]|['"]([^'"]+)['"])/g;
const TFUNCTION = /TFunction<'([^']+)'>/g;

function lookup(namespace, path) {
  let node = reference?.[namespace];
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

for (const dir of SOURCE_DIRS) {
  for (const file of collectSources(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');

    // Namespace khả dĩ của file: từ useTranslation(...) và từ kiểu TFunction<'ns'>.
    const namespaces = new Set(['common']);
    for (const [, grouped, single] of src.matchAll(USE_TRANSLATION)) {
      if (single) namespaces.add(single);
      for (const [, piece] of (grouped ?? '').matchAll(/['"]([^'"]+)['"]/g)) namespaces.add(piece);
    }
    for (const [, ns] of src.matchAll(TFUNCTION)) namespaces.add(ns);

    for (const [, key] of src.matchAll(CALL)) {
      const candidates = key.includes(':')
        ? [[key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]]
        : [...namespaces].map((ns) => [ns, key]);

      let value;
      for (const [ns, sub] of candidates) {
        const found = lookup(ns, sub);
        if (found !== undefined) {
          value = found;
          break;
        }
      }
      if (value === undefined) problems.push(`${rel}: không tìm thấy khoá "${key}"`);
      else if (typeof value === 'object') problems.push(`${rel}: khoá "${key}" trỏ vào một nhánh`);
    }
  }
}

const unique = [...new Set(problems)].sort();
for (const problem of unique) console.error(problem);

if (unique.length > 0) {
  console.error(`\n✖ ${unique.length} vấn đề i18n`);
  process.exit(1);
}
console.log(`✔ i18n hợp lệ — ${locales.length} ngôn ngữ, ${flatten(reference).size} khoá`);
