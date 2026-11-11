/**
 * Kiểm chứng website public (/home, /docs, /pricing) — chạy bằng `npm run test:public-site`.
 * Kiểm dữ liệu tập trung (bảng giá, cấu hình site, tài liệu) và tính toàn vẹn: route đăng ký là màn hiện có,
 * mọi bài tài liệu thuộc đúng một nhóm và mô tả một màn hình có thật, ảnh minh hoạ không mồ côi,
 * nội dung không chứa bí mật / URL nội bộ. Thoát mã 1 khi có case sai.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOC_GROUPS, DOC_SECTIONS, type DocArticle } from '../features/public-site/docs/groups.ts';
import { normalizeSearchText } from '../features/public-site/docs/search-text.ts';
import { formatUsd, PRICING_PLANS } from '../features/public-site/pricing.ts';
import {
  APP_ROUTES,
  isPublicSitePath,
  PUBLIC_NAV,
  PUBLIC_ROUTES,
  SITE,
} from '../features/public-site/site-config.ts';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`✗ ${label}\n   expected ${e}\n   actual   ${a}`);
}

const appDir = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(appDir(rel), 'utf8');

// ---------- Bảng giá (đúng đặc tả: 6 gói, giá & số shop) ----------
check(
  'Bảng giá: tên / giá USD / số shop',
  PRICING_PLANS.map((p) => [p.name, p.priceUsd, p.shops]),
  [
    ['Basic', 15, 10],
    ['Starter', 30, 20],
    ['Team', 70, 50],
    ['Pro', 120, 100],
    ['Business', 350, 300],
    ['Enterprise', 550, 500],
  ],
);
check(
  'Bảng giá: chỉ gói Team được làm nổi bật',
  PRICING_PLANS.filter((p) => p.highlight).map((p) => p.id),
  ['team'],
);
check('Bảng giá: id duy nhất', new Set(PRICING_PLANS.map((p) => p.id)).size, PRICING_PLANS.length);
check('formatUsd', [formatUsd(15), formatUsd(1550)], ['$15', '$1,550']);

// ---------- Route & cấu hình site ----------
check('CTA đăng ký trỏ tới màn đăng ký hiện có', APP_ROUTES.register, '/register');
check(
  'Màn /register và /login có trang thật',
  [
    existsSync(appDir('app/(auth)/register/page.tsx')),
    existsSync(appDir('app/(auth)/login/page.tsx')),
  ],
  [true, true],
);
check(
  'Trang public có file page',
  Object.values(PUBLIC_ROUTES).map((r) => existsSync(appDir(`app/(public)${r}/page.tsx`))),
  [true, true, true],
);
check(
  'Menu public: Trang chủ | Tài liệu | Bảng giá',
  PUBLIC_NAV.map((n) => [n.label, n.href]),
  [
    ['Trang chủ', '/home'],
    ['Tài liệu', '/docs'],
    ['Bảng giá', '/pricing'],
  ],
);
check(
  'isPublicSitePath',
  [
    '/home',
    '/docs',
    '/docs/dang-nhap',
    '/pricing',
    '/homepage',
    '/docsx',
    '/dashboard',
    '/login',
    null,
  ].map((p) => isPublicSitePath(p)),
  [true, true, true, true, false, false, false, false, false],
);
check(
  'Liên hệ: email & địa điểm',
  [SITE.contact.email, SITE.contact.location],
  ['nguyenminhchinh000@gmail.com', 'Liên Chiểu, Đà Nẵng'],
);
check('Liên hệ: không có số điện thoại / mạng xã hội', Object.keys(SITE.contact).sort(), [
  'email',
  'location',
]);
check(
  'Domain canonical mặc định',
  SITE.url,
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ?? 'https://startly-ecom.us',
);

// ---------- Tài liệu ----------
const contentDir = 'features/public-site/docs/content';
const articles: DocArticle[] = readdirSync(appDir(contentDir))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(read(`${contentDir}/${f}`)) as DocArticle[]);
const slugs = articles.map((a) => a.slug);
const grouped = DOC_GROUPS.flatMap((g) => g.slugs);

check('Docs: slug duy nhất', new Set(slugs).size, slugs.length);
check(
  'Docs: slug dạng kebab-case',
  slugs.filter((s) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)),
  [],
);
check('Docs: mọi bài thuộc đúng một nhóm', [...grouped].sort(), [...slugs].sort());
check('Docs: nhóm không trùng bài', new Set(grouped).size, grouped.length);

const incomplete = articles
  .filter(
    (a) =>
      !a.title?.trim() ||
      !a.summary?.trim() ||
      !a.overview?.trim() ||
      a.steps.length < 3 ||
      a.steps.some((s) => !s.title?.trim() || !s.detail?.trim()) ||
      a.troubleshooting.some((t) => !t.problem?.trim() || !t.solution?.trim()) ||
      !Array.isArray(a.whenToUse) ||
      !Array.isArray(a.prerequisites) ||
      !Array.isArray(a.notes),
  )
  .map((a) => a.slug);
check('Docs: bài đủ tiêu đề, tóm tắt, tổng quan, ≥3 bước, lỗi có cách xử lý', incomplete, []);
check(
  'Docs: không có trường lạ (vd `sources` nội bộ)',
  [...new Set(articles.flatMap((a) => Object.keys(a)))].sort(),
  [
    'notes',
    'overview',
    'permission',
    'prerequisites',
    'screenshotRoute',
    'slug',
    'steps',
    'summary',
    'title',
    'troubleshooting',
    'whenToUse',
  ].sort(),
);

const pageExists = (route: string) =>
  existsSync(appDir(`app/(auth)${route}/page.tsx`)) ||
  existsSync(appDir(`app/(dashboard)${route}/page.tsx`));
check(
  'Docs: mỗi bài mô tả một màn hình có thật',
  articles
    .filter((a) => !pageExists(a.screenshotRoute))
    .map((a) => `${a.slug} → ${a.screenshotRoute}`),
  [],
);
// Màn bị ẩn khỏi menu (Accounts / Orders thủ công / Reports) không được quảng cáo trong tài liệu.
const HIDDEN = [
  '/dashboard/accounts',
  '/dashboard/orders',
  '/dashboard/order',
  '/dashboard/reports',
];
check(
  'Docs: không mô tả màn đang ẩn',
  articles
    .filter((a) =>
      HIDDEN.some((h) => a.screenshotRoute === h || a.screenshotRoute.startsWith(`${h}/`)),
    )
    .map((a) => a.slug),
  [],
);
check(
  'Docs: id mục lục duy nhất',
  new Set(DOC_SECTIONS.map((s) => s.id)).size,
  DOC_SECTIONS.length,
);
check('Tìm kiếm: bỏ dấu tiếng Việt', normalizeSearchText('Đơn hoàn TRẢ'), 'don hoan tra');

// ---------- Ảnh minh hoạ ----------
const screensDir = 'public/docs-screens';
const fileFor = (route: string) => `${route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-')}.webp`;
const screenFiles = existsSync(appDir(screensDir)) ? readdirSync(appDir(screensDir)) : [];
const landing = read('features/public-site/landing-content.ts');
const landingImages = [...landing.matchAll(/image: '\/docs-screens\/([^']+)'/g)].map((m) => m[1]);
check('Landing: có ảnh preview', landingImages.length > 0, true);
check(
  'Landing: ảnh preview tồn tại',
  landingImages.filter((f) => !screenFiles.includes(f)),
  [],
);
const referenced = new Set([...articles.map((a) => fileFor(a.screenshotRoute)), ...landingImages]);
check(
  'Ảnh: không có file mồ côi',
  screenFiles.filter((f) => !referenced.has(f)),
  [],
);

// ---------- Không lộ bí mật / thông tin nội bộ ----------
const scanned = [
  ...readdirSync(appDir(contentDir)).map((f) => `${contentDir}/${f}`),
  'features/public-site/landing-content.ts',
  'features/public-site/pricing.ts',
  'features/public-site/site-config.ts',
];
const FORBIDDEN: [string, RegExp][] = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['connection string', /\b(postgres(ql)?|redis|mysql):\/\//i],
  ['biến môi trường', /\b(DATABASE_URL|JWT_SECRET|REDIS_PASSWORD|API_KEY=|_SECRET\b)/],
  ['localhost / IP', /\blocalhost\b|\b\d{1,3}(\.\d{1,3}){3}\b/],
  ['email nội bộ demo', /ncmedia\.local|superadmin@/i],
  ['khoá API dạng sk_/pk_', /\b[sp]k_(live|test)_[A-Za-z0-9]{8,}/],
];
const leaks = scanned.flatMap((file) => {
  const text = read(file);
  return FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => `${file}: ${name}`);
});
check('Nội dung public không chứa bí mật / URL nội bộ', leaks, []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
