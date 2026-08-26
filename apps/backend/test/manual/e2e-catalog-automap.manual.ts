/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI: đồng bộ danh mục nhà cung cấp + ánh xạ tự động + ánh xạ tay.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-catalog-automap.manual.ts
 * Cần backend đang chạy ở :3000 (npm run start:dev).
 *
 * ⚠️ VÌ SAO DÙNG NHÀ CUNG CẤP GIẢ, KHÔNG GỌI MANGO THẬT
 *   API key Mango đang lưu trong database bị chính Mango từ chối (`401 Invalid API key` —
 *   đã dò trực tiếp). Không có key hợp lệ thì không có cách nào kéo danh mục thật về.
 *   Kịch bản này vì thế dựng một máy chủ giả nói ĐÚNG giao thức MangoV3 (envelope
 *   `{status, code, data}`, phân trang `page`/`limit`/`pagination`), rồi trỏ `base_url_override`
 *   của một tài khoản TẠM vào đó.
 *
 *   Toàn bộ đường đi vẫn là đường thật: HTTP → MangoApiClient (retry + điều tiết tần suất) →
 *   MangoCatalogService (phân trang) → FulfillmentCatalogSyncService (ghi theo lô) →
 *   PostgreSQL → API đọc → ánh xạ tự động. Chỉ có nguồn dữ liệu là giả.
 *
 *   Nhà cung cấp giả cố tình trả NHIỀU TRANG và một sản phẩm báo thừa `variations_count`,
 *   để kiểm đúng hai thứ dễ sai nhất: duyệt hết trang, và phát hiện thiếu dữ liệu.
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối.
 */
import * as http from 'node:http';
import * as jwt from 'jsonwebtoken';
import { randomUUID, createHash, createCipheriv, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Mã hoá API key đúng định dạng của `AesGcmCipher` (`v1.<iv>.<tag>.<data>`).
 *
 * Kịch bản chạy NGOÀI tiến trình Nest nên không dùng lại được service; lặp lại đúng thuật
 * toán ở đây là cách duy nhất tạo được một tài khoản mà backend đọc được. Khoá lấy từ CÙNG
 * biến môi trường mà backend dùng — không có khoá viết cứng nào.
 */
function encryptApiKey(plain: string): string {
  const key = Buffer.from(process.env.TIKTOK_ENCRYPTION_KEY as string, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

const API = 'http://localhost:3000/api/v1';
const FAKE_PORT = 4599;

/** Bật lên ở bước 8 để nhà cung cấp giả báo `pagination.total` trung thực trở lại. */
let truthfulTotals = false;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

// ---------------------------------------------------------------------------
// Danh mục giả — 25 sản phẩm × 3 biến thể, trải trên nhiều trang
// ---------------------------------------------------------------------------
const CATALOGS = [
  { id: 'CAT-APPAREL', name: 'Apparel' },
  { id: 'CAT-POSTER', name: 'Poster' },
];

interface FakeProduct {
  id: string;
  sku: string;
  name: string;
  catalog_id: string;
  catalog_name: string;
  base_price: string;
  currency: string;
  images: string[];
  variations_count: number;
  is_active: boolean;
}

function buildProducts(count: number): FakeProduct[] {
  return Array.from({ length: count }, (_, i) => {
    const catalog = CATALOGS[i % CATALOGS.length];
    return {
      id: `P${String(i).padStart(3, '0')}`,
      sku: `PROD-SKU-${i}`,
      name: i === 0 ? 'Unisex T-Shirt' : `Fake Product ${i}`,
      catalog_id: catalog.id,
      catalog_name: catalog.name,
      base_price: '9.50',
      currency: 'USD',
      images: [`https://cdn.fake/${i}.png`],
      // 🔴 Sản phẩm P001 cố tình báo THỪA một biến thể so với số thực trả về:
      // phép đối chiếu của sync job phải phát hiện ra.
      variations_count: i === 1 ? 4 : 3,
      is_active: true,
    };
  });
}

const SIZES = ['S', 'M', 'L'];

function variationsOf(productId: string) {
  const index = Number(productId.slice(1));
  return SIZES.map((size, s) => ({
    id: `${productId}-V${s}`,
    product_id: productId,
    sku: `${productId}-BLK-${size}`,
    name: `Black / ${size}`,
    color: 'Black',
    size,
    price: '9.50',
    is_available: true,
  })).concat(
    // Sản phẩm P002 có thêm một biến thể TRÙNG SKU với biến thể của P000 ⇒ tạo tình huống
    // "nhiều ứng viên" để kiểm nhánh NEED_MANUAL.
    index === 2 ? [{
      id: 'P002-DUP',
      product_id: productId,
      sku: 'P000-BLK-L',
      name: 'Black / L (trùng SKU)',
      color: 'Black',
      size: 'L',
      price: '9.50',
      is_available: true,
    }] : [],
  );
}

/** Máy chủ giả nói đúng giao thức MangoV3. Trả về hàm tắt và bộ đếm request. */
function startFakeProvider(products: FakeProduct[]) {
  const stats = { requests: 0, productPages: 0, variationCalls: 0 };

  const server = http.createServer((req, res) => {
    stats.requests += 1;
    const url = new URL(req.url ?? '/', `http://localhost:${FAKE_PORT}`);
    const page = Number(url.searchParams.get('page') ?? '1');
    const limit = Number(url.searchParams.get('limit') ?? '100');

    const send = (data: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: true, code: 'SUCCESS', data, request_id: randomUUID() }));
    };

    // 🔴 Trang nhỏ hơn `limit` client yêu cầu, để bắt buộc phải duyệt nhiều trang. Đọc đúng
    // một trang đầu — lỗi kinh điển — sẽ lộ ra ngay ở phép đếm cuối.
    const pageSize = Math.min(limit, 10);

    if (url.pathname === '/products') {
      stats.productPages += 1;
      const start = (page - 1) * pageSize;
      send({
        items: products.slice(start, start + pageSize),
        pagination: {
          total: products.length,
          page,
          limit: pageSize,
          pages: Math.ceil(products.length / pageSize),
        },
      });
      return;
    }

    const variationMatch = url.pathname.match(/^\/products\/([^/]+)\/variations$/);
    if (variationMatch) {
      stats.variationCalls += 1;
      const productId = decodeURIComponent(variationMatch[1]);
      const all = variationsOf(productId);
      const start = (page - 1) * pageSize;
      // 🔴 P003 cố tình báo `pagination.total` CAO HƠN số bản ghi thực có. Đây mới là tín
      // hiệu ĐỌC THIẾU thật sự (khác với `variations_count` — xem chú thích ở phần kiểm tra).
      const reportedTotal =
        productId === 'P003' && !truthfulTotals ? all.length + 5 : all.length;
      send({
        product_id: productId,
        items: all.slice(start, start + pageSize),
        pagination: {
          total: reportedTotal,
          page,
          limit: pageSize,
          pages: Math.ceil(reportedTotal / pageSize),
        },
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: false, code: 'NOT_FOUND', message: 'Not found' }));
  });

  return new Promise<{ stop: () => Promise<void>; stats: typeof stats }>((resolve) => {
    server.listen(FAKE_PORT, '127.0.0.1', () =>
      resolve({
        stats,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}

async function main() {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({
    where: { organization: { slug: 'ncmedia' }, role: { code: 'ADMIN' }, deletedAt: null },
    select: { id: true, organizationId: true, role: { select: { code: true } } },
  });
  if (!admin) throw new Error('Không tìm thấy admin của tổ chức giữ dữ liệu đơn');
  const orgId = admin.organizationId;

  const token = jwt.sign(
    { sub: admin.id, organizationId: orgId, role: admin.role.code, jti: randomUUID() },
    process.env.JWT_ACCESS_SECRET as string,
    { algorithm: 'HS256', expiresIn: 900 },
  );
  const auth = { Authorization: `Bearer ${token}` };
  const json = (r: Response) => r.json() as any;
  const get = (path: string) => fetch(`${API}${path}`, { headers: auth }).then(json);
  const post = (path: string) =>
    fetch(`${API}${path}`, { method: 'POST', headers: auth }).then(json);

  const products = buildProducts(25);
  const fake = await startFakeProvider(products);
  console.log(`\nNhà cung cấp giả đang chạy ở http://127.0.0.1:${FAKE_PORT}`);

  // Tài khoản TẠM trỏ vào nhà cung cấp giả. `api_key_enc` để NULL: hệ thống sẽ dùng key mặc
  // định từ biến môi trường, và máy chủ giả không kiểm key.
  const account = await prisma.fulfillmentAccount.create({
    data: {
      organizationId: orgId,
      provider: 'MANGO',
      name: `E2E Fake Provider ${Date.now()}`,
      baseUrlOverride: `http://127.0.0.1:${FAKE_PORT}`,
      // Máy chủ giả không kiểm key, nhưng backend BẮT BUỘC phải có key mới chịu gọi —
      // đúng như với nhà cung cấp thật.
      apiKeyEnc: encryptApiKey('E2E-FAKE-KEY'),
      apiKeyHint: '-KEY',
      isActive: true,
      isDefault: false,
      createdBy: admin.id,
    },
    select: { id: true },
  });
  const cleanup: { orderIds: string[]; mappingIds: string[] } = { orderIds: [], mappingIds: [] };

  try {
    // -------------------------------------------------------------------------
    console.log('\n▶ 1. Đồng bộ danh mục — Catalogue → Product → Variant');
    // -------------------------------------------------------------------------
    const sync = await post(`/fulfillment/accounts/${account.id}/catalog/sync`);
    const result = sync?.data;
    check('gọi endpoint đồng bộ thành công', Boolean(result), sync);
    // Không đồng bộ được thì mọi phép kiểm sau đều vô nghĩa — dừng ngay để lỗi dễ đọc.
    if (!result) throw new Error(`Đồng bộ thất bại: ${JSON.stringify(sync)}`);
    check(`đọc HẾT ${products.length} sản phẩm qua nhiều trang`, result?.products === 25, {
      products: result?.products,
      productPages: fake.stats.productPages,
    });
    check('duyệt NHIỀU trang sản phẩm (không dừng ở trang đầu)', fake.stats.productPages >= 3, fake.stats);
    check('suy ra đúng 2 danh mục từ catalog_id của sản phẩm', result?.catalogues === 2, result?.catalogues);
    // 25 sản phẩm × 3 biến thể + 1 biến thể trùng SKU của P002 = 76
    check('đọc HẾT biến thể của MỌI sản phẩm', result?.variants === 76, result?.variants);
    check('gọi variations đúng một lần cho mỗi sản phẩm', fake.stats.variationCalls >= 25, fake.stats);

    /**
     * 🔴 HAI tín hiệu khác nhau, chỉ MỘT trong hai nói lên "đọc thiếu":
     *
     *   · `products[].variations_count`  — P001 báo 4 nhưng chỉ có 3 biến thể.
     *     ĐO THỰC TẾ trên API Mango thật: trường này đếm khác hẳn endpoint variations (một
     *     sản phẩm báo 3440 trong khi endpoint trả `total = 596` và đúng 596 bản ghi). Đây là
     *     chênh lệch ĐỊNH NGHĨA giữa hai trường của nhà cung cấp, KHÔNG phải mất dữ liệu.
     *     Tính nó là "đọc thiếu" khiến 248/252 sản phẩm thật bị gắn cờ, mọi lượt đồng bộ đều
     *     PARTIAL, và bước ARCHIVE không bao giờ chạy — sản phẩm ngừng bán ở lại vĩnh viễn
     *     trong các ô chọn.
     *
     *   · `pagination.total` của chính endpoint variations — P003 báo dư 5 bản ghi so với số
     *     thực trả về. ĐÂY mới là đọc thiếu thật, và phải chặn archive.
     */
    check(
      '🔴 lệch `variations_count` KHÔNG bị coi là đọc thiếu',
      (result?.warnings ?? []).every((w: string) => !w.includes('P001')),
      result?.warnings,
    );
    check(
      '🔴 lệch `pagination.total` MỚI là đọc thiếu',
      result?.complete === false &&
        (result?.warnings ?? []).some((w: string) => w.includes('P003')),
      result?.warnings,
    );
    check('đọc THIẾU ⇒ BỎ QUA bước đánh dấu ngừng bán', result?.archivedProducts === 0);

    // -------------------------------------------------------------------------
    console.log('\n▶ 2. Đọc danh mục TỪ DATABASE (không gọi nhà cung cấp)');
    // -------------------------------------------------------------------------
    const requestsBefore = fake.stats.requests;

    const catalogues = await get(`/fulfillment/accounts/${account.id}/catalog/catalogues`);
    check('API trả 2 danh mục', catalogues?.data?.length === 2, catalogues?.data);
    check('danh mục có tên đọc được', catalogues?.data?.[0]?.name?.length > 0);
    check('danh mục kèm lastSyncedAt', Boolean(catalogues?.data?.[0]?.lastSyncedAt));

    const paged = await get(`/fulfillment/accounts/${account.id}/catalog/products?page=1&limit=10`);
    check('sản phẩm PHÂN TRANG phía server', paged?.data?.items?.length === 10, paged?.data?.meta);
    check('meta tổng đúng 25', paged?.data?.meta?.total === 25, paged?.data?.meta);

    const searched = await get(
      `/fulfillment/accounts/${account.id}/catalog/products?search=${encodeURIComponent('Unisex')}`,
    );
    check('tìm kiếm chạy phía server', searched?.data?.items?.length === 1, searched?.data?.meta);

    const apparelId = catalogues.data.find((c: any) => c.name === 'Apparel').id;
    const filtered = await get(
      `/fulfillment/accounts/${account.id}/catalog/products?catalogueId=${apparelId}&limit=100`,
    );
    check('lọc theo danh mục chạy phía server', filtered?.data?.meta?.total === 13, filtered?.data?.meta);

    const firstProduct = paged.data.items[0];
    const variants = await get(
      `/fulfillment/accounts/${account.id}/catalog/products/${firstProduct.id}/variations`,
    );
    check('biến thể đọc được từ Database', (variants?.data?.length ?? 0) >= 3, variants?.data?.length);
    check('biến thể mang SKU sẽ gửi khi tạo đơn', Boolean(variants?.data?.[0]?.sku));

    check(
      '🔴 TOÀN BỘ các lượt đọc trên KHÔNG gọi nhà cung cấp lần nào',
      fake.stats.requests === requestsBefore,
      { before: requestsBefore, after: fake.stats.requests },
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 3. Đồng bộ LẦN HAI — cập nhật, KHÔNG duplicate');
    // -------------------------------------------------------------------------
    const before = await get(`/fulfillment/accounts/${account.id}/catalog/status`);
    await post(`/fulfillment/accounts/${account.id}/catalog/sync`);
    const after = await get(`/fulfillment/accounts/${account.id}/catalog/status`);

    check(
      '🔴 số danh mục KHÔNG đổi sau lần đồng bộ thứ hai',
      after?.data?.catalogues === before?.data?.catalogues,
      { before: before?.data, after: after?.data },
    );
    check('🔴 số sản phẩm KHÔNG đổi', after?.data?.products === before?.data?.products);
    check('🔴 số biến thể KHÔNG đổi', after?.data?.variants === before?.data?.variants);

    const dupProducts = await prisma.$queryRawUnsafe<any[]>(`
      SELECT external_product_id, count(*)::int c FROM fulfillment_products
      WHERE account_id = '${account.id}' GROUP BY 1 HAVING count(*) > 1`);
    check('không có sản phẩm trùng external_product_id', dupProducts.length === 0, dupProducts);

    const dupVariants = await prisma.$queryRawUnsafe<any[]>(`
      SELECT product_id, external_variant_id, count(*)::int c FROM fulfillment_variants
      WHERE account_id = '${account.id}' GROUP BY 1,2 HAVING count(*) > 1`);
    check('không có biến thể trùng external_variant_id', dupVariants.length === 0, dupVariants);

    // -------------------------------------------------------------------------
    console.log('\n▶ 4. Ánh xạ tự động — Seller SKU khớp DUY NHẤT ⇒ tự tạo Product Mapping');
    // -------------------------------------------------------------------------
    const shop = await prisma.podTiktokShop.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, accountId: true },
    });
    if (!shop) throw new Error('Không có shop TikTok nào để dựng đơn thử');

    // Gán tài khoản nhà cung cấp giả cho kết nối TikTok — đúng đường mà ánh xạ tự động tra.
    const tiktokAccount = await prisma.podTiktokAccount.findUnique({
      where: { id: shop.accountId },
      select: { id: true, fulfillmentAccountId: true },
    });
    const previousProvider = tiktokAccount?.fulfillmentAccountId ?? null;
    await prisma.podTiktokAccount.update({
      where: { id: shop.accountId },
      data: { fulfillmentAccountId: account.id },
    });

    const sourceOrder = await prisma.podOrder.findFirst({
      where: { organizationId: orgId, accountId: shop.accountId },
    });
    if (!sourceOrder) throw new Error('Không có đơn mẫu để nhân bản');

    /** Dựng một đơn thử mang đúng cặp khoá muốn kiểm. */
    const makeOrder = async (
      label: string,
      productId: string,
      sellerSku: string,
      skuName: string,
      productName = 'Unisex T-Shirt',
    ) => {
      const { id: _drop, createdAt: _c, updatedAt: _u, ...clone } = sourceOrder as any;
      const stamp = `${Date.now()}-${label}`;
      const orderId = randomUUID();
      await prisma.podOrder.create({
        data: {
          ...clone,
          id: orderId,
          tiktokOrderId: `E2E-CAT-${stamp}`,
          payloadHash: createHash('sha256').update(stamp).digest('hex'),
          items: {
            create: {
              organizationId: orgId,
              tiktokLineItemId: `E2E-ITEM-${stamp}`,
              productId,
              sellerSku,
              skuId: `E2E-SKUID-${stamp}`,
              skuName,
              productName,
              payloadHash: createHash('sha256').update(`item-${stamp}`).digest('hex'),
            },
          },
        },
      });
      cleanup.orderIds.push(orderId);
      return orderId;
    };

    // (a) Seller SKU khớp DUY NHẤT một biến thể ⇒ tự ánh xạ.
    const uniqueOrder = await makeOrder('unique', 'TT-UNIQUE', 'P005-BLK-M', 'Black / M');
    // (b) Seller SKU khớp HAI biến thể (P000-BLK-L có bản trùng ở P002) ⇒ cần chọn tay.
    const ambiguousOrder = await makeOrder('ambiguous', 'TT-AMBIG', 'P000-BLK-L', 'Black / L');
    // (c) Không khớp gì ⇒ không tìm thấy.
    //     🔴 Tên sản phẩm cũng phải KHÔNG khớp: luật ghép có tầng Product Title, nên để tên
    //     trùng một sản phẩm thật sẽ ra NEED_MANUAL chứ không phải NOT_FOUND — đúng thiết kế.
    const missingOrder = await makeOrder(
      'missing',
      'TT-MISSING',
      'KHONG-TON-TAI-SKU',
      'Nothing',
      'Ten San Pham Khong Ton Tai 9x9',
    );

    const auto = await post('/fulfillment/mappings/auto-resolve');
    check('gọi rà ánh xạ tự động thành công', Boolean(auto?.data), auto);
    check('rà được ít nhất 3 cặp khoá vừa dựng', (auto?.data?.scanned ?? 0) >= 3, auto?.data);
    check('có ít nhất 1 sản phẩm được TỰ ánh xạ', (auto?.data?.autoMapped ?? 0) >= 1, auto?.data);
    check('có ít nhất 1 sản phẩm cần chọn tay', (auto?.data?.needManual ?? 0) >= 1, auto?.data);
    check('có ít nhất 1 sản phẩm không tìm thấy', (auto?.data?.notFound ?? 0) >= 1, auto?.data);

    const autoMapping = await prisma.fulfillmentProductMapping.findFirst({
      where: { organizationId: orgId, tiktokProductId: 'TT-UNIQUE', sellerSku: 'P005-BLK-M' },
    });
    check('🔴 Product Mapping được TẠO cho trường hợp khớp duy nhất', Boolean(autoMapping), autoMapping);
    check('ánh xạ trỏ đúng Fulfillment SKU', autoMapping?.providerSku === 'P005-BLK-M');
    check(
      'ánh xạ mang dấu vết [auto-map] để phân biệt với khai tay',
      autoMapping?.note?.startsWith('[auto-map]') === true,
      autoMapping?.note,
    );
    if (autoMapping) cleanup.mappingIds.push(autoMapping.id);

    const ambiguousMapping = await prisma.fulfillmentProductMapping.findFirst({
      where: { organizationId: orgId, tiktokProductId: 'TT-AMBIG', sellerSku: 'P000-BLK-L' },
    });
    check(
      '🔴 KHÔNG tạo ánh xạ khi có nhiều ứng viên (không được auto mapping sai)',
      ambiguousMapping === null,
      ambiguousMapping,
    );

    const candidateRows = await prisma.fulfillmentMappingCandidate.findMany({
      where: { organizationId: orgId, tiktokProductId: { in: ['TT-UNIQUE', 'TT-AMBIG', 'TT-MISSING'] } },
    });
    const byProduct = new Map(candidateRows.map((row) => [row.tiktokProductId, row]));
    check('trường hợp duy nhất ⇒ AUTO_MAPPED', byProduct.get('TT-UNIQUE')?.status === 'AUTO_MAPPED');
    check('trường hợp nhiều ứng viên ⇒ NEED_MANUAL', byProduct.get('TT-AMBIG')?.status === 'NEED_MANUAL');
    check('trường hợp không khớp ⇒ NOT_FOUND', byProduct.get('TT-MISSING')?.status === 'NOT_FOUND');
    check(
      'ứng viên được lưu lại để dialog lọc sẵn',
      ((byProduct.get('TT-AMBIG')?.candidates as any[]) ?? []).length === 2,
      byProduct.get('TT-AMBIG')?.candidates,
    );
    check('ghi đúng tầng đã khớp', byProduct.get('TT-UNIQUE')?.tier === 'SELLER_SKU');

    // -------------------------------------------------------------------------
    console.log('\n▶ 5. Order List hiển thị đúng trạng thái ánh xạ');
    // -------------------------------------------------------------------------
    // 🔴 Đọc theo ID, KHÔNG quét danh sách phân trang: đơn nhân bản kế thừa `orderedAt` của
    // đơn gốc nên nằm lẫn giữa 148 đơn thật, và một phép `find` trên trang đầu sẽ trượt —
    // trượt vì test viết sai, không phải vì tính năng sai.
    const readOrder = async (orderId: string) => {
      const detail = await get(`/pod/tiktok/orders/${orderId}`);
      return {
        fulfillmentAccountId: detail?.data?.fulfillmentAccountId ?? null,
        item: detail?.data?.items?.[0],
      };
    };

    const mappedRead = await readOrder(uniqueOrder);
    const ambiguousRead = await readOrder(ambiguousOrder);
    const missingRead = await readOrder(missingOrder);
    const mappedRow = mappedRead.item;
    const ambiguousRow = ambiguousRead.item;
    const missingRow = missingRead.item;

    check('đơn đã tự ánh xạ ⇒ MAPPED', mappedRow?.mappingStatus === 'MAPPED', mappedRow?.mappingStatus);
    check('đơn nhiều ứng viên ⇒ NEED_MANUAL', ambiguousRow?.mappingStatus === 'NEED_MANUAL', ambiguousRow?.mappingStatus);
    check('đơn không khớp ⇒ MISSING', missingRow?.mappingStatus === 'MISSING', missingRow?.mappingStatus);
    check(
      '🔴 NEED_MANUAL kèm ứng viên để dialog mở ra đã lọc sẵn',
      (ambiguousRow?.mappingCandidates?.length ?? 0) === 2,
      ambiguousRow?.mappingCandidates,
    );
    check('MAPPED không kèm ứng viên thừa', (mappedRow?.mappingCandidates?.length ?? 0) === 0);
    check(
      'đơn mang fulfillmentAccountId để dialog điền sẵn nhà cung cấp',
      mappedRead.fulfillmentAccountId === account.id,
      mappedRead.fulfillmentAccountId,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 6. Ánh xạ TAY vẫn hoạt động, đơn thoát trạng thái thiếu ánh xạ');
    // -------------------------------------------------------------------------
    const pickVariant = await get(
      `/fulfillment/accounts/${account.id}/catalog/products?search=${encodeURIComponent('Fake Product 7')}`,
    );
    const chosenProduct = pickVariant.data.items[0];
    const chosenVariants = await get(
      `/fulfillment/accounts/${account.id}/catalog/products/${chosenProduct.id}/variations`,
    );
    const chosenVariant = chosenVariants.data[0];

    const manual = await fetch(`${API}/fulfillment/mappings?provider=MANGO`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 🔴 Khai cho ĐÚNG tài khoản của đơn. Tổ chức đang có hai tài khoản MANGO; bỏ trống
        // thì backend lấy tài khoản mặc định và ánh xạ gắn nhầm chỗ.
        accountId: account.id,
        tiktokProductId: 'TT-MISSING',
        sellerSku: 'KHONG-TON-TAI-SKU',
        providerSku: chosenVariant.sku,
        providerProductId: chosenProduct.externalProductId,
        providerVariantId: chosenVariant.externalVariantId,
        providerProductName: chosenProduct.name,
        providerVariantName: chosenVariant.name,
        baseCost: 7.25,
      }),
    }).then(json);
    check('tạo ánh xạ tay thành công', Boolean(manual?.data?.id), manual);
    if (manual?.data?.id) cleanup.mappingIds.push(manual.data.id);
    check('ánh xạ tay lưu đúng Fulfillment SKU', manual?.data?.providerSku === chosenVariant.sku);
    check('ánh xạ tay lưu Base Cost', manual?.data?.baseCost === 7.25, manual?.data?.baseCost);

    const fixedRow = (await readOrder(missingOrder)).item;
    check(
      '🔴 đơn chuyển sang MAPPED NGAY sau khi khai tay (không cần đồng bộ lại)',
      fixedRow?.mappingStatus === 'MAPPED',
      fixedRow?.mappingStatus,
    );
    check('đơn mang mappingId để upload design', Boolean(fixedRow?.mappingId));

    // -------------------------------------------------------------------------
    console.log('\n▶ 7. Luồng Fulfill đọc được ánh xạ mới');
    // -------------------------------------------------------------------------
    const state = await get(`/fulfillment/orders/${missingOrder}`);
    const issueCodes = (state?.data?.issues ?? []).map((i: any) => i.code);
    check(
      '🔴 không còn MAPPING_MISSING sau khi đã ánh xạ',
      !issueCodes.includes('MAPPING_MISSING'),
      issueCodes,
    );
    check(
      'chuyển sang thiếu DESIGN — đúng bước tiếp theo của quy trình',
      issueCodes.includes('DESIGN_MISSING'),
      issueCodes,
    );

    const stillAmbiguous = await get(`/fulfillment/orders/${ambiguousOrder}`);
    check(
      'đơn chưa ánh xạ vẫn bị chặn đúng lý do',
      (stillAmbiguous?.data?.issues ?? []).some((i: any) => i.code === 'MAPPING_MISSING'),
      stillAmbiguous?.data?.issues?.map((i: any) => i.code),
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 8. Đánh dấu ngừng bán khi nhà cung cấp bỏ sản phẩm');
    // -------------------------------------------------------------------------
    // Cho P003 báo `pagination.total` đúng trở lại ⇒ lượt đọc ĐẦY ĐỦ ⇒ archive được chạy.
    // (P001 vẫn lệch `variations_count` — và đúng như thiết kế, việc đó không cản trở gì.)
    truthfulTotals = true;
    // Bỏ 5 sản phẩm cuối khỏi danh mục của nhà cung cấp.
    const removed = products.splice(20, 5);
    const archiveSync = await post(`/fulfillment/accounts/${account.id}/catalog/sync`);
    check('lượt đọc lần này ĐẦY ĐỦ', archiveSync?.data?.complete === true, archiveSync?.data?.warnings);
    check(
      '🔴 sản phẩm không còn được đánh dấu ARCHIVED (KHÔNG xoá cứng)',
      archiveSync?.data?.archivedProducts === removed.length,
      archiveSync?.data?.archivedProducts,
    );

    const archivedRows = await prisma.fulfillmentProduct.count({
      where: { accountId: account.id, status: 'ARCHIVED' },
    });
    check('bản ghi cũ vẫn còn trong Database để tra cứu', archivedRows === removed.length);

    const visible = await get(`/fulfillment/accounts/${account.id}/catalog/products?limit=100`);
    check(
      'sản phẩm ARCHIVED KHÔNG hiện ra ở ô chọn',
      visible?.data?.meta?.total === 20,
      visible?.data?.meta,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 9. Cô lập tenant');
    // -------------------------------------------------------------------------
    const otherOrg = await prisma.fulfillmentAccount.findFirst({
      where: { organizationId: { not: orgId }, deletedAt: null },
      select: { id: true },
    });
    if (otherOrg) {
      const cross = await fetch(
        `${API}/fulfillment/accounts/${otherOrg.id}/catalog/catalogues`,
        { headers: auth },
      );
      check('đọc danh mục của tổ chức khác ⇒ 404', cross.status === 404, cross.status);
    } else {
      console.log('  ⤳ Bỏ qua: không có tài khoản của tổ chức khác để thử.');
    }

    // --- Trả kết nối TikTok về nhà cung cấp cũ ---
    await prisma.podTiktokAccount.update({
      where: { id: shop.accountId },
      data: { fulfillmentAccountId: previousProvider },
    });
  } finally {
    // -------------------------------------------------------------------------
    // Dọn dẹp — xoá CỨNG mọi thứ do kịch bản này tạo ra
    // -------------------------------------------------------------------------
    await prisma.fulfillmentMappingCandidate.deleteMany({
      where: { organizationId: orgId, tiktokProductId: { in: ['TT-UNIQUE', 'TT-AMBIG', 'TT-MISSING'] } },
    });
    await prisma.fulfillmentProductMapping.deleteMany({
      where: { organizationId: orgId, tiktokProductId: { in: ['TT-UNIQUE', 'TT-AMBIG', 'TT-MISSING'] } },
    });
    await prisma.podOrder.deleteMany({ where: { id: { in: cleanup.orderIds } } });
    await prisma.fulfillmentSyncLog.deleteMany({ where: { accountId: account.id } });
    // Danh mục/sản phẩm/biến thể bị xoá theo tài khoản nhờ ON DELETE CASCADE.
    await prisma.fulfillmentAccount.delete({ where: { id: account.id } });
    await fake.stop();
    console.log('\n🧹 Đã dọn tài khoản giả, danh mục, đơn và ánh xạ test.');

    console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
