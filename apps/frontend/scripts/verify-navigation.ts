/**
 * Kiểm chứng cấu hình menu Sidebar — chạy bằng `npm run test:navigation`.
 * Kiểm ĐÚNG `config/navigation.ts` của app: thứ tự menu, lọc quyền, menu mặc định của Listing,
 * không trùng route, và mọi route trên menu đều có trang thật (không link chết).
 * Thoát mã 1 khi có case sai.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAVIGATION, resolveNavigation, type NavItemConfig } from '../config/navigation.ts';

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

const leaves = (items: NavItemConfig[]): NavItemConfig[] =>
  items.flatMap((item) => (item.children?.length ? leaves(item.children) : [item]));
const keys = (items: NavItemConfig[] | undefined) => (items ?? []).map((item) => item.labelKey);
const group = (items: NavItemConfig[], key: string) => items.find((item) => item.labelKey === key);
const only = (...codes: string[]) => (code: string) => codes.includes(code);

// Quyền đầy đủ của Admin tổ chức (không có platform.* của Super Admin).
const ADMIN = (code: string) => !code.startsWith('platform.');
const admin = resolveNavigation(ADMIN);

check('Thứ tự menu cấp một (Admin tổ chức)', keys(admin), [
  'dashboard',
  'employees',
  'employeeWorkStatistics',
  'podTiktokAccounts',
  'podProducts',
  'listing',
  'podTemplates',
  'podFlashSales',
  'orderGroup',
  'podPayout',
  'syncsMasterData',
  'settingFulfillment',
  'settings',
]);
check('Listing: đúng 4 menu con, đúng thứ tự', keys(group(admin, 'listing')?.children), [
  'podAutoListing',
  'podCloneProducts',
  'podDraftListings',
  'podPublishHistory',
]);
check('Listing mở thẳng menu con đầu tiên', group(admin, 'listing')?.navigateToFirstChild, true);
check('Listing ⇒ Auto Listing khi có quyền', group(admin, 'listing')?.children?.[0]?.href, '/dashboard/pod/auto-listing');
check('Syncs Master Data: đúng 5 menu con, đúng thứ tự', keys(group(admin, 'syncsMasterData')?.children), [
  'podCategories',
  'podBrands',
  'podWarehouses',
  'podMasterData',
  'podResources',
]);
check('Setting Fulfillment: chỉ Fulfillment Providers', keys(group(admin, 'settingFulfillment')?.children), [
  'podFulfillmentProviders',
]);

// POD và Product Mapping đã bỏ khỏi menu (route vẫn giữ — chỉ không còn trên Sidebar).
const allConfigured = [...NAVIGATION, ...leaves(NAVIGATION)];
check('Không còn nhóm POD', allConfigured.some((item) => item.labelKey === 'pod'), false);
check(
  'Không còn Product Mapping trên menu',
  allConfigured.some((item) => item.href.includes('product-mapping')),
  false,
);

// Thiếu quyền Auto Listing ⇒ Listing mở menu con đầu tiên ĐƯỢC PHÉP, không phải trang bị chặn.
const noSession = resolveNavigation(only('pod.product.clone', 'pod.draft.read', 'pod.listing.read'));
check(
  'Thiếu pod.session.read ⇒ Listing mở Clone Products',
  group(noSession, 'listing')?.children?.[0]?.href,
  '/dashboard/pod/clone-products',
);
check(
  'Chỉ có pod.listing.read ⇒ Listing mở Publish History',
  group(resolveNavigation(only('pod.listing.read')), 'listing')?.children?.map((child) => child.href),
  ['/dashboard/pod/publish-history'],
);
check('Không quyền Listing nào ⇒ ẩn cả nhóm Listing', group(resolveNavigation(only('pod.product.read')), 'listing'), undefined);
check(
  'Không có fulfillment.config ⇒ ẩn Setting Fulfillment',
  group(resolveNavigation(only('pod.product.read')), 'settingFulfillment'),
  undefined,
);
check(
  'Super Admin (platform.masterdata.read) vẫn thấy TikTok Master Data',
  keys(group(resolveNavigation(only('platform.masterdata.read')), 'syncsMasterData')?.children),
  ['podMasterData'],
);
check(
  'Seller (pod.product.read) thấy Products + Categories/Brands/Master Data, không thấy Warehouses/Resources',
  [
    keys(resolveNavigation(only('pod.product.read'))).includes('podProducts'),
    keys(group(resolveNavigation(only('pod.product.read')), 'syncsMasterData')?.children),
  ],
  [true, ['podCategories', 'podBrands', 'podMasterData']],
);

// Không trùng route giữa các menu lá (kể cả menu đang ẩn) và mọi route đều có trang thật.
const hrefs = leaves(NAVIGATION).map((item) => item.href);
check('Không trùng route trên menu', hrefs.filter((href, index) => hrefs.indexOf(href) !== index), []);
const appDir = fileURLToPath(new URL('../app/(dashboard)/', import.meta.url));
check(
  'Mọi route trên menu đều có page.tsx',
  hrefs.filter((href) => !existsSync(`${appDir}${href.slice(1)}/page.tsx`)),
  [],
);

console.log(`${failed === 0 ? '✔' : '✗'} navigation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
