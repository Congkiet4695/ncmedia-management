/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật) cho **Template — Export / Import theo dòng (CSV)**:
 *   - Export đúng các row đã chọn (1 row / nhiều row), id lạ hoặc của tổ chức khác ⇒ 404, không xuất gì.
 *   - CSV nạp lại được vào CHÍNH tổ chức nguồn và vào tổ chức KHÁC (4 loại: Category · SKU · Description · Image).
 *   - Nạp sang tổ chức khác: id mới, `organization_id` của tổ chức đích, dữ liệu tổ chức nguồn không đổi,
 *     template khác của tổ chức đích không bị xoá / sửa, ảnh trở thành file CỦA tổ chức đích.
 *   - Bảng SKU (giá / tổ hợp đã xoá) và "No brand" giữ nguyên qua vòng export → import.
 *
 * Chép ảnh qua URL cần mạng + Cloudflare R2 ⇒ thay `PodListingImageUrlService` bằng bản giả tạo đúng một
 * dòng `storage_files` cho tổ chức đích (cái thật có test riêng: hàng rào SSRF + chữ ký ảnh).
 *
 * 🔴 CHỈ chạy trên database CỤC BỘ dùng một lần (tự tạo Organization riêng, KHÔNG dọn).
 *
 * Chạy:
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db npx prisma migrate deploy
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db node -r ts-node/register \
 *     test/manual/e2e-template-csv-transfer.manual.ts
 */
import { randomUUID } from 'node:crypto';
import { parseCsv } from '../../src/common/csv/csv.util';
import { PrismaService } from '../../src/database/prisma.service';
import { PodImageTemplateService } from '../../src/modules/pod-listing/services/pod-image-template.service';
import { PodTemplateService } from '../../src/modules/pod-listing/services/pod-template.service';
import { PodTemplateTransferService } from '../../src/modules/pod-listing/services/pod-template-transfer.service';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('❌ Từ chối chạy: DATABASE_URL phải là database CỤC BỘ dùng một lần (localhost / 127.0.0.1).');
  process.exit(2);
}

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${!ok && detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    const response = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    return response?.code ?? String(error);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const run = randomUUID().slice(0, 8);

  const makeOrg = async (tag: string) => {
    const org = await prisma.organization.create({ data: { name: `E2E CSV ${tag} ${run}`, slug: `e2e-csv-${tag}-${run}` } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: 'ADMIN', displayName: 'Admin' } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, roleId: role.id, email: `csv-${tag}-${run}@e2e.local`, passwordHash: 'x', fullName: tag },
    });
    return { org, user };
  };
  const A = await makeOrg('a');
  const B = await makeOrg('b');

  const storageRow = (organizationId: string, userId: string, key: string) =>
    prisma.storageFile.create({
      data: {
        organizationId,
        module: 'POD_TIKTOK',
        referenceType: 'POD_LISTING_ASSET',
        folder: 'e2e',
        objectKey: `e2e/${key}.png`,
        originalName: `${key}.png`,
        storedName: `${key}.png`,
        extension: 'png',
        mimeType: 'image/png',
        fileSize: 10,
        publicUrl: `https://cdn.local/e2e/${key}.png`,
        uploadedBy: userId,
        uploadedAt: new Date(),
      },
    });

  // Bản giả của "Thêm ảnh bằng URL": tạo file MỚI thuộc tổ chức đích.
  const copies: Array<{ organizationId: string; url: string }> = [];
  const imageUrls = {
    importImage: async (organizationId: string, userId: string, sourceUrl: string) => {
      copies.push({ organizationId, url: sourceUrl });
      return storageRow(organizationId, userId, `copy-${randomUUID().slice(0, 8)}`);
    },
  };

  const templates = new PodTemplateService(prisma);
  const images = new PodImageTemplateService(prisma, {} as never);
  const transfer = new PodTemplateTransferService(prisma, templates, images, {} as never, imageUrls as never);

  // ---------------- Dữ liệu nguồn (tổ chức A) ----------------
  const category = await templates.createCategoryTemplate(A.org.id, A.user.id, {
    name: `Tee "US", ${run}`,
    market: 'US',
    tiktokCategoryId: '601226',
    categoryName: 'T-Shirts',
    categoryPath: 'Womenswear > T-Shirts',
    brandMode: 'NONE',
    packageWeight: '0.3',
    weightUnit: 'KILOGRAM',
  } as never);
  const sku = await templates.createSkuTemplate(A.org.id, A.user.id, {
    name: `Comfort ${run}`,
    skuPrefix: '00TEE',
    currency: 'USD',
    defaultSalePrice: 19.99,
    variants: [
      { name: 'Color', values: [{ value: 'Đen', code: 'BLK' }] },
      { name: 'Size', values: [{ value: 'S', code: 'S' }, { value: 'M', code: 'M' }] },
    ],
  } as never);
  const generated = await templates.generateSkuItems(A.org.id, A.user.id, sku.id);
  const [keep, drop] = generated.items;
  await prisma.podSkuTemplateItem.update({ where: { id: keep.id }, data: { salePrice: '24.50', barcode: '0001234' } });
  await prisma.podSkuTemplateItem.delete({ where: { id: drop.id } });
  const descA = await templates.createDescriptionTemplate(A.org.id, A.user.id, {
    name: `Mô tả 🎃 ${run}`,
    contentHtml: '<p>Áo "đẹp", mềm\nmới</p>',
    tokens: [{ code: 'MATERIAL', label: 'Chất liệu', value: 'Cotton, 100%' }],
  } as never);
  const descA2 = await templates.createDescriptionTemplate(A.org.id, A.user.id, { name: `Không chọn ${run}`, contentHtml: '<p>x</p>' } as never);
  const fileA = await storageRow(A.org.id, A.user.id, `front-${run}`);
  const imageA = await images.create(A.org.id, A.user.id, { name: `Mockup ${run}` } as never);
  await images.restoreItems(A.org.id, imageA.id, [
    { title: 'Mặt trước', assetType: 'MAIN_FRONT', fileId: fileA.id, imageUrl: fileA.publicUrl ?? '', imageKey: fileA.objectKey, contentType: 'image/png', fileSize: 10, width: 100, height: 200, isRequired: true, displayOrder: 0 },
  ]);

  // Template sẵn có của tổ chức B — không được bị đụng tới.
  const descB = await templates.createDescriptionTemplate(B.org.id, B.user.id, { name: `B riêng ${run}`, contentHtml: '<p>b</p>' } as never);

  const snapshot = async (organizationId: string) => ({
    categories: await prisma.podCategoryTemplate.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    skus: await prisma.podSkuTemplate.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    skuItems: await prisma.podSkuTemplateItem.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    descriptions: await prisma.podDescriptionTemplate.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    images: await prisma.podImageTemplateItem.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
  });
  const before = { A: JSON.stringify(await snapshot(A.org.id)), descB: await prisma.podDescriptionTemplate.findUniqueOrThrow({ where: { id: descB.id } }) };

  // ---------------- Export ----------------
  const one = await transfer.exportRowsCsv(A.org.id, 'DESCRIPTION', [descA.id]);
  check('1. export 1 row ⇒ CSV đúng 1 dòng', one.count === 1 && parseCsv(one.csv).length === 2);
  check('CSV không chứa id nội bộ / organization id', !one.csv.includes(descA.id) && !one.csv.includes(A.org.id));
  check('3. row không chọn ("Không chọn") không có trong CSV', !one.csv.includes('Không chọn'));
  check('Unicode / emoji / dấu phẩy / nháy kép / xuống dòng còn nguyên', parseCsv(one.csv)[1].includes('<p>Áo "đẹp", mềm\nmới</p>') && one.csv.includes('🎃'));
  check(
    '🔴 export kèm id của tổ chức KHÁC ⇒ 404, không xuất gì',
    (await codeOf(transfer.exportRowsCsv(A.org.id, 'DESCRIPTION', [descA.id, descB.id]))) === 'POD_TEMPLATE_EXPORT_NOT_FOUND',
  );
  const both = await transfer.exportRowsCsv(A.org.id, 'DESCRIPTION', [descA.id, descA2.id]);
  check('2. export nhiều row ⇒ đúng các row đã chọn', both.count === 2 && parseCsv(both.csv).length === 3);

  const csv = {
    CATEGORY: (await transfer.exportRowsCsv(A.org.id, 'CATEGORY', [category.id])).csv,
    SKU: (await transfer.exportRowsCsv(A.org.id, 'SKU', [sku.id])).csv,
    DESCRIPTION: one.csv,
    IMAGE: (await transfer.exportRowsCsv(A.org.id, 'IMAGE', [imageA.id])).csv,
  };

  // ---------------- 5. Import sang tổ chức B ----------------
  for (const kind of ['CATEGORY', 'SKU', 'DESCRIPTION', 'IMAGE'] as const) {
    const result = await transfer.importRowsCsv(B.org.id, B.user.id, kind, csv[kind]);
    check(`5. ${kind}: import sang tổ chức khác — tạo 1, không lỗi`, result.created === 1 && result.failed === 0, result);
  }

  const catB = await prisma.podCategoryTemplate.findFirstOrThrow({ where: { organizationId: B.org.id, name: category.name } });
  check('7. Category ở B: id MỚI, organization B, "No brand" (NONE) giữ nguyên', catB.id !== category.id && catB.brandMode === 'NONE' && catB.packageWeight === '0.3');

  const skuB = await templates.getSkuTemplate(B.org.id, (await prisma.podSkuTemplate.findFirstOrThrow({ where: { organizationId: B.org.id, name: sku.name } })).id);
  check('7. SKU ở B: id mới, tiền tố "00TEE" giữ số 0 đầu, tổ hợp đã xoá không sống lại', skuB.id !== sku.id && skuB.skuPrefix === '00TEE' && skuB.items.length === 1, skuB.items.length);
  check('SKU ở B: giá / barcode từng dòng giữ nguyên', skuB.items[0].variantName === keep.variantName && Number(skuB.items[0].salePrice) === 24.5 && skuB.items[0].barcode === '0001234');
  check('SKU ở B: mọi dòng con mang organization B', skuB.items.every((item) => item.organizationId === B.org.id) && skuB.variants.every((v) => v.organizationId === B.org.id));

  const descImported = await templates.getDescriptionTemplate(B.org.id, (await prisma.podDescriptionTemplate.findFirstOrThrow({ where: { organizationId: B.org.id, name: descA.name } })).id);
  check('Description ở B: nội dung + token giữ nguyên', descImported.contentHtml === '<p>Áo "đẹp", mềm\nmới</p>' && descImported.tokens[0]?.value === 'Cotton, 100%');

  const imageB = await prisma.podImageTemplate.findFirstOrThrow({ where: { organizationId: B.org.id, name: imageA.name }, include: { items: { include: { file: true } } } });
  check(
    '🔴 Image ở B: ảnh là file CỦA tổ chức B (đã chép), không trỏ file của A',
    imageB.items.length === 1 && imageB.items[0].fileId !== fileA.id && imageB.items[0].file.organizationId === B.org.id && imageB.items[0].assetType === 'MAIN_FRONT',
  );
  check('Image ở B: chép đúng 1 lần, từ URL công khai, vào tổ chức B', copies.length === 1 && copies[0].organizationId === B.org.id && copies[0].url === fileA.publicUrl, copies);

  check('6. Dữ liệu của tổ chức A KHÔNG thay đổi sau khi import sang B', JSON.stringify(await snapshot(A.org.id)) === before.A);
  const descBAfter = await prisma.podDescriptionTemplate.findUniqueOrThrow({ where: { id: descB.id } });
  check('8. Template sẵn có của B không bị xoá / sửa', descBAfter.deletedAt === null && descBAfter.updatedAt.getTime() === before.descB.updatedAt.getTime());

  // ---------------- 4. Import lại vào chính tổ chức A ----------------
  const reA = await transfer.importRowsCsv(A.org.id, A.user.id, 'IMAGE', csv.IMAGE);
  const imageReA = await prisma.podImageTemplate.findFirstOrThrow({ where: { organizationId: A.org.id, name: `${imageA.name} (import 1)` }, include: { items: true } });
  check('4. import lại vào A: tạo bản "(import 1)", ảnh DÙNG LẠI đúng file của A, không chép', reA.created === 1 && imageReA.items[0]?.fileId === fileA.id && copies.length === 1);
  const reDesc = await transfer.importRowsCsv(A.org.id, A.user.id, 'DESCRIPTION', both.csv);
  const descCount = await prisma.podDescriptionTemplate.count({ where: { organizationId: A.org.id, deletedAt: null } });
  check('8. import tập row vào A không xoá row khác (2 cũ + 2 mới = 4)', reDesc.created === 2 && descCount === 4, descCount);

  // ---------------- 9. File lỗi ----------------
  const header = parseCsv(csv.IMAGE)[0];
  const noUrl = `${header.join(',')}\r\nX,,,"[{""title"":""F"",""assetType"":""MAIN_FRONT"",""fileId"":""${fileA.id}""}]"\r\n`;
  const r9 = await transfer.importRowsCsv(B.org.id, B.user.id, 'IMAGE', noUrl);
  check('9. Image sang B chỉ có id của A (không URL) ⇒ lỗi dòng 2, không tạo', r9.created === 0 && r9.errors[0]?.row === 2 && r9.errors[0]?.message.includes('không có trong tổ chức'), r9);
  check('9. CSV của tab khác ⇒ POD_TEMPLATE_CSV_COLUMNS_MISMATCH', (await codeOf(transfer.importRowsCsv(B.org.id, B.user.id, 'DESCRIPTION', csv.SKU))) === 'POD_TEMPLATE_CSV_COLUMNS_MISMATCH');
  const missingName = `name,contentHtml\r\n,<p>x</p>\r\n`;
  const r9b = await transfer.importRowsCsv(B.org.id, B.user.id, 'DESCRIPTION', missingName);
  check('9. thiếu trường bắt buộc (name) ⇒ lỗi theo dòng', r9b.failed === 1 && r9b.errors[0]?.row === 2, r9b);

  for (const line of results) console.log(line);
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n${results.length - failed}/${results.length} pass`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
