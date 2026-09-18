/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI **Custom Listing** (tạo · validate · sửa tại chỗ · phân quyền shop), trên
 * DATABASE THẬT + HTTP THẬT.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-custom-listing.manual.ts
 * Cần backend đang chạy ở :3000.
 *
 * Kịch bản bám đúng lỗi đã gặp trên màn hình:
 *
 *   1. Chọn danh mục "Poster" + dựng SKU tay, KHÔNG chọn template nào ⇒ Validate KHÔNG được
 *      báo "Chưa chọn Category Template / SKU Template".
 *   2. Lưu nháp ⇒ DB giữ ĐỦ dữ liệu (danh mục, brand, thuộc tính, mô tả HTML kèm ảnh, từ khoá,
 *      highlights, kho, đóng gói, video, biến thể, SKU, ảnh đúng thứ tự, bảng size, shop, mẫu).
 *   3. Sửa ⇒ PATCH /:id/custom cập nhật TẠI CHỖ, số lượt đăng KHÔNG tăng.
 *   4. Thiếu danh mục thật sự ⇒ "Category là bắt buộc." — không nhắc tới template.
 *   5. Employee chỉ đăng được vào shop được gán; shop ngoài phạm vi ⇒ 403 ở CẢ tạo lẫn sửa.
 *   6. Hồi quy lô Excel: session IMPORT không template vẫn bị chặn đúng hai lỗi template cũ.
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối.
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
const STAMP = Date.now();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500));
  }
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body: json, data: json?.data };
}

async function main() {
  const prisma = new PrismaClient();

  const org = await prisma.organization.findFirst({
    where: { isPlatform: false, deletedAt: null, slug: 'demo' },
    select: { id: true },
  });
  if (!org) throw new Error('Chưa có Organization demo — chạy `prisma db seed`');
  const orgId = org.id;

  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, code: { in: ['ADMIN', 'EMPLOYEE'] }, deletedAt: null },
    select: { id: true, code: true },
  });
  const employeeRole = roles.find((r) => r.code === 'EMPLOYEE')!;
  const adminRole = roles.find((r) => r.code === 'ADMIN')!;

  const poster = await prisma.podProductCategory.findFirst({
    where: { deletedAt: null, isLeaf: true, localName: { contains: 'Poster', mode: 'insensitive' } },
    select: { tiktokCategoryId: true, localName: true, path: true },
  });
  if (!poster) throw new Error('Kho danh mục chưa có danh mục "Poster" — đồng bộ master data trước');

  const token = (userId: string, roleCode: string) =>
    jwt.sign(
      { sub: userId, organizationId: orgId, role: roleCode, jti: randomUUID() },
      process.env.JWT_ACCESS_SECRET as string,
      { algorithm: 'HS256', expiresIn: 900 },
    );

  const created = {
    userIds: [] as string[],
    employeeIds: [] as string[],
    accountIds: [] as string[],
    shopIds: [] as string[],
    sessionIds: [] as string[],
    categoryTemplateIds: [] as string[],
    skuTemplateIds: [] as string[],
    descriptionTemplateIds: [] as string[],
  };

  try {
    console.log('\n▶ 0. Dựng dữ liệu: Admin + Employee (1 account, 1 shop) + 1 shop của người khác');
    async function makeUser(tag: string, roleId: string) {
      const user = await prisma.user.create({
        data: {
          organizationId: orgId,
          roleId,
          email: `custom.${tag}.${STAMP}@e2e-test.local`,
          passwordHash: '$2b$10$e2eTestOnlyHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          fullName: `Custom ${tag}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      created.userIds.push(user.id);
      const employee = await prisma.employee.create({
        data: { organizationId: orgId, userId: user.id },
        select: { id: true },
      });
      created.employeeIds.push(employee.id);
      return { userId: user.id, employeeId: employee.id };
    }
    async function makeShop(tag: string, sellerEmployeeId: string) {
      const account = await prisma.podTiktokAccount.create({
        data: {
          organizationId: orgId,
          accountName: `E2E Account ${tag}`,
          openId: `e2e-open-${tag}-${STAMP}`,
          userType: 0,
          accessTokenEnc: 'e2e',
          accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
          refreshTokenEnc: 'e2e',
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
          status: 'ACTIVE',
          sellerId: sellerEmployeeId,
        },
        select: { id: true },
      });
      created.accountIds.push(account.id);
      const shop = await prisma.podTiktokShop.create({
        data: {
          organizationId: orgId,
          accountId: account.id,
          tiktokShopId: `e2e-${tag}-${STAMP}`,
          shopCipherEnc: 'e2e',
          name: `E2E Shop ${tag}`,
          region: 'US',
          sellerType: 'CROSS_BORDER',
        },
        select: { id: true },
      });
      created.shopIds.push(shop.id);
      return shop.id;
    }

    const admin = await makeUser('admin', adminRole.id);
    const seller = await makeUser('seller', employeeRole.id);
    const other = await makeUser('other', employeeRole.id);
    const shopMine = await makeShop('mine', seller.employeeId);
    const shopOther = await makeShop('other', other.employeeId);
    const adminToken = token(admin.userId, 'ADMIN');
    const sellerToken = token(seller.userId, 'EMPLOYEE');
    check('dựng xong 3 user, 2 shop', created.shopIds.length === 2);

    const manualData = {
      description: '<p>Poster in mờ <img src="https://cdn.example/desc.jpg" alt="mô tả"></p>',
      searchTerms: ['poster', 'wall art'],
      highlights: ['Giấy mờ 250gsm', 'In theo đơn'],
      category: { tiktokCategoryId: poster.tiktokCategoryId, name: poster.localName, path: poster.path },
      brand: { tiktokBrandId: null, name: null },
      attributes: [
        { tiktokAttributeId: '100001', name: 'Material', type: 'PRODUCT_PROPERTY', isRequired: false, values: [{ id: 'v1', name: 'Paper' }], customValues: [] },
      ],
      package: { weight: '300', weightUnit: 'GRAM', length: '30', width: '20', height: '2', dimensionUnit: 'CENTIMETER' },
      variations: [{ name: 'Size', values: ['S', 'M', 'L'] }],
      skus: [
        { sellerSku: 'POSTER-S', optionValues: [{ name: 'Size', value: 'S' }], salePrice: '9.99', retailPrice: '14.99', quantity: 5 },
        { sellerSku: 'POSTER-M', optionValues: [{ name: 'Size', value: 'M' }], salePrice: '12.99', quantity: 5 },
        { sellerSku: 'POSTER-L', optionValues: [{ name: 'Size', value: 'L' }], salePrice: '15.99', quantity: 5 },
      ],
    };
    const images = [
      { imageUrl: 'https://cdn.example/main.jpg', imageType: 'MAIN', sortOrder: 0 },
      { imageUrl: 'https://cdn.example/second.jpg', imageType: 'MAIN', sortOrder: 1 },
      { imageUrl: 'https://cdn.example/size.jpg', imageType: 'SIZE_CHART', sortOrder: 2 },
    ];

    // -------------------------------------------------------------------------
    console.log('\n▶ 1. Admin: FULL MANUAL (Poster + SKU tay), KHÔNG template');
    const before = await call(adminToken, 'GET', '/pod/listing-sessions?limit=1');
    const countBefore = before.data?.meta?.total ?? 0;

    const create = await call(adminToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US',
      shopIds: [shopMine, shopOther],
      product: { title: `E2E Poster ${STAMP}`, images, manualData },
    });
    check('POST /custom ⇒ 201', create.status === 201, create.body);
    const sessionId: string = create.data?.id;
    if (sessionId) created.sessionIds.push(sessionId);
    check('session.source = CUSTOM', create.data?.source === 'CUSTOM', create.data?.source);
    check('session có 2 shop', create.data?.shops?.length === 2);

    const validation = await call(adminToken, 'POST', `/pod/listing-sessions/${sessionId}/validate`, {});
    const sessionCodes: string[] = (validation.data?.issues ?? []).map((i: any) => i.code);
    const productCodes: string[] = (validation.data?.products?.[0]?.issues ?? []).map((i: any) => i.code);
    check('🔴 KHÔNG còn SESSION_NO_CATEGORY_TEMPLATE', !sessionCodes.includes('SESSION_NO_CATEGORY_TEMPLATE'), sessionCodes);
    check('🔴 KHÔNG còn SESSION_NO_SKU_TEMPLATE', !sessionCodes.includes('SESSION_NO_SKU_TEMPLATE'), sessionCodes);
    check('không PRODUCT_MISSING_CATEGORY / PRODUCT_MISSING_SKU', !productCodes.includes('PRODUCT_MISSING_CATEGORY') && !productCodes.includes('PRODUCT_MISSING_SKU'), productCodes);
    check('không lỗi thiếu danh mục / biến thể / giá / mô tả / kiện hàng từ engine', !productCodes.some((c) => /MISSING_(CATEGORY|VARIANT|SKU|PRICE|DESCRIPTION|PACKAGE)/.test(c)), validation.data?.products?.[0]?.issues);
    check('validate.ok = true (full manual, không template)', validation.data?.ok === true, validation.data);

    // -------------------------------------------------------------------------
    console.log('\n▶ 2. Nháp lưu ĐỦ dữ liệu (GET detail + products)');
    const list = await call(adminToken, 'GET', `/pod/listing-sessions/${sessionId}/products`);
    const product = list.data?.items?.[0];
    const saved = product?.manualData ?? {};
    check('title', product?.title === `E2E Poster ${STAMP}`);
    check('category (id + name + path)', saved.category?.tiktokCategoryId === poster.tiktokCategoryId && saved.category?.path === poster.path, saved.category);
    check('description HTML kèm <img>', typeof saved.description === 'string' && saved.description.includes('<img src="https://cdn.example/desc.jpg"'), saved.description);
    check('searchTerms + highlights', JSON.stringify(saved.searchTerms) === JSON.stringify(manualData.searchTerms) && saved.highlights?.length === 2, [saved.searchTerms, saved.highlights]);
    check('attributes', saved.attributes?.[0]?.values?.[0]?.id === 'v1', saved.attributes);
    check('package', saved.package?.weight === '300' && saved.package?.dimensionUnit === 'CENTIMETER', saved.package);
    check('variations + 3 SKU (sellerSku · giá · tồn)', saved.variations?.[0]?.values?.length === 3 && saved.skus?.length === 3 && saved.skus?.[0]?.salePrice === '9.99' && saved.skus?.[0]?.quantity === 5, saved.skus);
    const imgs = product?.images ?? [];
    check('ảnh đúng THỨ TỰ + bảng size tách loại', imgs.length === 3 && imgs[0].imageUrl.endsWith('main.jpg') && imgs[1].imageUrl.endsWith('second.jpg') && imgs[2].imageType === 'SIZE_CHART', imgs.map((i: any) => [i.imageType, i.sortOrder]));
    const detail = await call(adminToken, 'GET', `/pod/listing-sessions/${sessionId}`);
    check('shops persist', detail.data?.shops?.map((s: any) => s.shopId).sort().join() === [shopMine, shopOther].sort().join());

    // -------------------------------------------------------------------------
    console.log('\n▶ 3. Sửa TẠI CHỖ (PATCH /:id/custom) — không tạo lượt mới');
    const edited = await call(adminToken, 'PATCH', `/pod/listing-sessions/${sessionId}/custom`, {
      market: 'US',
      shopIds: [shopMine],
      templates: { categoryTemplateId: null, skuTemplateId: null, descriptionTemplateId: null, imageTemplateId: null },
      product: {
        title: `E2E Poster ${STAMP} (đã sửa)`,
        // Form luôn đánh lại sortOrder theo vị trí mới — backend tôn trọng sortOrder gửi lên.
        images: [{ ...images[1], sortOrder: 0 }, { ...images[0], sortOrder: 1 }],
        manualData: {
          ...manualData,
          searchTerms: ['poster'],
          brand: { tiktokBrandId: 'brand-x', name: 'Brand X' },
          skus: [{ sellerSku: 'POSTER-XL', optionValues: [{ name: 'Size', value: 'XL' }], salePrice: '19.99', quantity: 2 }],
          variations: [{ name: 'Size', values: ['XL'] }],
        },
      },
    });
    check('PATCH /:id/custom ⇒ 200', edited.status === 200, edited.body);
    check('cùng id lượt đăng', edited.data?.id === sessionId);
    check('tên lượt đi theo tiêu đề mới', edited.data?.name === `E2E Poster ${STAMP} (đã sửa)`, edited.data?.name);
    check('shop còn 1', edited.data?.shops?.length === 1 && edited.data.shops[0].shopId === shopMine);
    check('status về DRAFT sau khi sửa', edited.data?.status === 'DRAFT', edited.data?.status);
    const after = await call(adminToken, 'GET', '/pod/listing-sessions?limit=1');
    check('🔴 số lượt đăng KHÔNG tăng thêm sau khi sửa (chỉ +1 từ lần tạo)', (after.data?.meta?.total ?? 0) === countBefore + 1, [countBefore, after.data?.meta?.total]);
    const list2 = await call(adminToken, 'GET', `/pod/listing-sessions/${sessionId}/products`);
    check('vẫn đúng 1 Draft Product', list2.data?.meta?.total === 1, list2.data?.meta);
    const p2 = list2.data?.items?.[0];
    check('title/brand/sku/ảnh đã đổi', p2?.title.endsWith('(đã sửa)') && p2?.manualData?.brand?.tiktokBrandId === 'brand-x' && p2?.manualData?.skus?.[0]?.sellerSku === 'POSTER-XL' && p2?.images?.[0]?.imageUrl.endsWith('second.jpg') && p2?.images?.[1]?.imageUrl.endsWith('main.jpg'), [p2?.manualData?.brand, p2?.manualData?.skus, p2?.images?.map((i: any) => i.imageUrl)]);

    // -------------------------------------------------------------------------
    console.log('\n▶ 4. Thiếu danh mục THẬT ⇒ "Category là bắt buộc." (không nói về template)');
    const { category: _c, ...noCategory } = manualData;
    await call(adminToken, 'PATCH', `/pod/listing-sessions/${sessionId}/custom`, {
      product: { manualData: { ...noCategory, skus: [] } },
    });
    const v2 = await call(adminToken, 'POST', `/pod/listing-sessions/${sessionId}/validate`, {});
    const pi = v2.data?.products?.[0]?.issues ?? [];
    check('PRODUCT_MISSING_CATEGORY = "Category là bắt buộc."', pi.some((i: any) => i.code === 'PRODUCT_MISSING_CATEGORY' && i.message === 'Category là bắt buộc.'), pi);
    check('PRODUCT_MISSING_SKU = "Vui lòng thêm ít nhất một SKU/variation hợp lệ."', pi.some((i: any) => i.code === 'PRODUCT_MISSING_SKU' && i.message.startsWith('Vui lòng thêm ít nhất một SKU')), pi);
    check('cấu hình lượt KHÔNG báo thiếu template', (v2.data?.issues ?? []).length === 0, v2.data?.issues);

    // -------------------------------------------------------------------------
    console.log('\n▶ 5. Employee: chỉ shop được gán; shop ngoài phạm vi ⇒ 403 (tạo + sửa)');
    const denied = await call(sellerToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US',
      shopIds: [shopOther],
      product: { title: `E2E Seller denied ${STAMP}`, manualData },
    });
    check('POST /custom với shop người khác ⇒ 403', denied.status === 403, denied.body);
    const mixed = await call(sellerToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US',
      shopIds: [shopMine, shopOther],
      product: { title: `E2E Seller mixed ${STAMP}`, manualData },
    });
    check('POST /custom lẫn shop người khác ⇒ 403 (không lọc bớt âm thầm)', mixed.status === 403, mixed.body);
    const allowed = await call(sellerToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US',
      shopIds: [shopMine],
      product: { title: `E2E Seller ok ${STAMP}`, images: images.slice(0, 1), manualData },
    });
    check('POST /custom với shop của mình ⇒ 201', allowed.status === 201, allowed.body);
    const sellerSession: string = allowed.data?.id;
    if (sellerSession) created.sessionIds.push(sellerSession);
    const escalate = await call(sellerToken, 'PATCH', `/pod/listing-sessions/${sellerSession}/custom`, {
      shopIds: [shopMine, shopOther],
    });
    check('PATCH thêm shop người khác ⇒ 403', escalate.status === 403, escalate.body);
    // Lượt của admin lúc này đã chỉ còn shop của seller (bước 3) nên seller mở được — kiểm
    // phạm vi bằng lượt CÓ shop người khác: tạo riêng một lượt admin gồm cả hai shop.
    const adminBoth = await call(adminToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US', shopIds: [shopMine, shopOther], product: { title: `E2E both ${STAMP}`, manualData },
    });
    if (adminBoth.data?.id) created.sessionIds.push(adminBoth.data.id);
    const peek = await call(sellerToken, 'GET', `/pod/listing-sessions/${adminBoth.data?.id}`);
    check('Employee không mở được lượt có shop người khác ⇒ 403', peek.status === 403, peek.status);
    const peekEdit = await call(sellerToken, 'PATCH', `/pod/listing-sessions/${adminBoth.data?.id}/custom`, { product: { title: 'hack' } });
    check('Employee không sửa được lượt có shop người khác ⇒ 403', peekEdit.status === 403, peekEdit.status);

    // -------------------------------------------------------------------------
    console.log('\n▶ 6. Hồi quy lô Excel/CSV: session IMPORT không template ⇒ vẫn chặn đúng hai lỗi cũ');
    const imp = await call(adminToken, 'POST', '/pod/listing-sessions', {
      name: `E2E Import ${STAMP}`,
      market: 'US',
      shopIds: [shopMine],
    });
    const importId: string = imp.data?.id;
    if (importId) created.sessionIds.push(importId);
    check('POST / (New Listing) ⇒ 201, source = IMPORT', imp.status === 201 && imp.data?.source === 'IMPORT', imp.data?.source);
    await call(adminToken, 'POST', `/pod/listing-sessions/${importId}/products`, {
      title: 'Dòng Excel', images: images.slice(0, 1),
    });
    const v3 = await call(adminToken, 'POST', `/pod/listing-sessions/${importId}/validate`, {});
    const c3: string[] = (v3.data?.issues ?? []).map((i: any) => i.code);
    check('IMPORT: SESSION_NO_CATEGORY_TEMPLATE + SESSION_NO_SKU_TEMPLATE', c3.includes('SESSION_NO_CATEGORY_TEMPLATE') && c3.includes('SESSION_NO_SKU_TEMPLATE'), c3);
    const wrong = await call(adminToken, 'PATCH', `/pod/listing-sessions/${importId}/custom`, { product: { title: 'x' } });
    check('PATCH /custom trên lượt IMPORT ⇒ 400 POD_SESSION_NOT_CUSTOM', wrong.status === 400 && wrong.body?.code === 'POD_SESSION_NOT_CUSTOM', wrong.body);
    // -------------------------------------------------------------------------
    console.log('\n▶ 7. Template THẬT: kết hợp (Category Template + SKU tay · danh mục tay + SKU Template · full template)');
    const ct = await call(adminToken, 'POST', '/pod/templates/categories', {
      name: `E2E CT ${STAMP}`, market: 'US', tiktokCategoryId: poster.tiktokCategoryId,
      categoryName: poster.localName, categoryPath: poster.path, brandMode: 'NONE',
      packageWeight: 250, weightUnit: 'GRAM',
    });
    check('tạo Category Template ⇒ 201', ct.status === 201, ct.body);
    if (ct.data?.id) created.categoryTemplateIds.push(ct.data.id);
    const st = await call(adminToken, 'POST', '/pod/templates/skus', {
      name: `E2E ST ${STAMP}`, variants: [{ name: 'Size', values: [{ value: 'S' }, { value: 'M' }] }],
      defaultSalePrice: 11.5, defaultRetailPrice: 15, defaultQuantity: 9, currency: 'USD',
    });
    check('tạo SKU Template ⇒ 201', st.status === 201, st.body);
    if (st.data?.id) created.skuTemplateIds.push(st.data.id);
    const gen = await call(adminToken, 'POST', `/pod/templates/skus/${st.data?.id}/generate`, {});
    check('sinh tổ hợp SKU Template', gen.status === 200 || gen.status === 201, gen.body);
    const dt = await call(adminToken, 'POST', '/pod/templates/descriptions', {
      name: `E2E DT ${STAMP}`, contentHtml: '<p>Mô tả từ template {{PRODUCT.TITLE}}</p>',
    });
    check('tạo Description Template ⇒ 201', dt.status === 201, dt.body);
    if (dt.data?.id) created.descriptionTemplateIds.push(dt.data.id);

    const { category: _c2, brand: _b2, attributes: _a2, ...noCategoryData } = manualData;
    const { skus: _s2, variations: _v2, ...noSkuData } = manualData;
    const { description: _d2, ...noDescData } = noCategoryData;

    const mixedA = await call(adminToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US', shopIds: [shopMine],
      templates: { categoryTemplateId: ct.data?.id, descriptionTemplateId: dt.data?.id },
      product: { title: `E2E mixed A ${STAMP}`, images: images.slice(0, 1), manualData: noDescData },
    });
    if (mixedA.data?.id) created.sessionIds.push(mixedA.data.id);
    const vA = await call(adminToken, 'POST', `/pod/listing-sessions/${mixedA.data?.id}/validate`, {});
    check('Category Template + Description Template + SKU tay ⇒ ok', vA.data?.ok === true, vA.data);
    check('mẫu được lưu vào lượt (2 dòng template)', mixedA.data?.templates?.length === 2, mixedA.data?.templates);

    const mixedB = await call(adminToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US', shopIds: [shopMine],
      templates: { skuTemplateId: st.data?.id },
      product: { title: `E2E mixed B ${STAMP}`, images: images.slice(0, 1), manualData: noSkuData },
    });
    if (mixedB.data?.id) created.sessionIds.push(mixedB.data.id);
    const vB = await call(adminToken, 'POST', `/pod/listing-sessions/${mixedB.data?.id}/validate`, {});
    check('danh mục tay + SKU Template ⇒ ok', vB.data?.ok === true, vB.data);
    const bProducts = await call(adminToken, 'GET', `/pod/listing-sessions/${mixedB.data?.id}/products`);
    const prevB = await call(adminToken, 'POST', `/pod/listing-sessions/${mixedB.data?.id}/products/${bProducts.data?.items?.[0]?.id}/preview`, {});
    check('preview: SKU từ template (2 dòng S/M), danh mục Poster từ form', prevB.data?.payload?.variants?.length === 2 && prevB.data?.payload?.category?.tiktokCategoryId === poster.tiktokCategoryId, [prevB.data?.payload?.variants?.length, prevB.data?.payload?.category]);

    const full = await call(adminToken, 'POST', '/pod/listing-sessions/custom', {
      market: 'US', shopIds: [shopMine],
      templates: { categoryTemplateId: ct.data?.id, skuTemplateId: st.data?.id, descriptionTemplateId: dt.data?.id },
      product: { title: `E2E full template ${STAMP}`, images: images.slice(0, 1) },
    });
    if (full.data?.id) created.sessionIds.push(full.data.id);
    const vF = await call(adminToken, 'POST', `/pod/listing-sessions/${full.data?.id}/validate`, {});
    check('FULL TEMPLATE (không manualData) ⇒ ok', vF.data?.ok === true, vF.data);

    // Sửa lượt full template sang danh mục tay ⇒ danh mục tay thắng template ở preview.
    const overrideCat = await call(adminToken, 'PATCH', `/pod/listing-sessions/${full.data?.id}/custom`, {
      product: { manualData: { category: { tiktokCategoryId: '999999', name: 'Khác', path: 'Khác' }, brand: { tiktokBrandId: null }, attributes: [] } },
    });
    const fp = await call(adminToken, 'GET', `/pod/listing-sessions/${full.data?.id}/products`);
    const prevF = await call(adminToken, 'POST', `/pod/listing-sessions/${full.data?.id}/products/${fp.data?.items?.[0]?.id}/preview`, {});
    check('danh mục tay THẮNG Category Template, SKU vẫn từ SKU Template', overrideCat.status === 200 && prevF.data?.payload?.category?.tiktokCategoryId === '999999' && prevF.data?.payload?.variants?.length === 2, [overrideCat.status, prevF.data?.payload?.category, prevF.data?.payload?.variants?.length]);
  } finally {
    console.log('\n🧹 Dọn dữ liệu test');
    const sessionIds = created.sessionIds;
    const products = await prisma.podListingSessionProduct.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    await prisma.podListingJobItem.deleteMany({ where: { sessionProductId: { in: productIds } } });
    await prisma.podListingPayload.deleteMany({ where: { sessionProductId: { in: productIds } } });
    await prisma.podListingSessionProductImage.deleteMany({ where: { sessionProductId: { in: productIds } } });
    await prisma.podListingSessionProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.podListingSessionShop.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.podListingSessionTemplate.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.podListingJob.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.podListingSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.podSkuTemplate.deleteMany({ where: { id: { in: created.skuTemplateIds } } });
    await prisma.podDescriptionTemplate.deleteMany({ where: { id: { in: created.descriptionTemplateIds } } });
    await prisma.podCategoryTemplate.deleteMany({ where: { id: { in: created.categoryTemplateIds } } });
    await prisma.podTiktokShop.deleteMany({ where: { id: { in: created.shopIds } } });
    await prisma.podTiktokAccount.deleteMany({ where: { id: { in: created.accountIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: created.employeeIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });

    console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
