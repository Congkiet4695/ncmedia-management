/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật) cho **Group Template**:
 *   - CRUD qua service thật: tạo / đọc lại / sửa (giữ - gỡ - thay mảnh) / nhân bản / xoá mềm.
 *   - Ràng buộc ở DB: tên duy nhất không phân biệt hoa thường (index từng phần — bản đã xoá không
 *     giữ chỗ tên), CHECK "ít nhất một mảnh", FK Restrict tới template con.
 *   - Cô lập tenant: không tham chiếu / đọc được template / group của tổ chức khác.
 *   - Xoá template con đang nằm trong group ⇒ bị chặn.
 *   - `getResolved` trả đúng hình dạng các endpoint chi tiết template lẻ, luôn là bản mới nhất.
 *
 * 🔴 CHỈ chạy trên database CỤC BỘ dùng một lần (tự tạo Organization riêng, KHÔNG dọn).
 *
 * Chạy:
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db npx prisma migrate deploy
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db node -r ts-node/register \
 *     test/manual/e2e-group-template.manual.ts
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodGroupTemplateService } from '../../src/modules/pod-listing/services/pod-group-template.service';
import { PodImageTemplateService } from '../../src/modules/pod-listing/services/pod-image-template.service';
import { PodTemplateService } from '../../src/modules/pod-listing/services/pod-template.service';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('❌ Từ chối chạy: DATABASE_URL phải là database CỤC BỘ dùng một lần (localhost / 127.0.0.1).');
  process.exit(2);
}

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    const response = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    return response?.code ?? (error as { code?: string }).code ?? String(error);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const templates = new PodTemplateService(prisma);
  const images = new PodImageTemplateService(prisma, {} as never);
  const groups = new PodGroupTemplateService(prisma, templates, images);
  const run = randomUUID().slice(0, 8);

  const orgA = await prisma.organization.create({ data: { name: `E2E Group A ${run}`, slug: `e2e-group-a-${run}` } });
  const orgB = await prisma.organization.create({ data: { name: `E2E Group B ${run}`, slug: `e2e-group-b-${run}` } });
  const role = await prisma.role.create({ data: { organizationId: orgA.id, code: 'ADMIN', displayName: 'Admin' } });
  const user = await prisma.user.create({
    data: { organizationId: orgA.id, roleId: role.id, email: `g-${run}@e2e.local`, passwordHash: 'x', fullName: 'Admin' },
  });

  // --- Template con (tổ chức A) ---
  const category = await prisma.podCategoryTemplate.create({
    data: {
      organizationId: orgA.id,
      name: `Tee US ${run}`,
      market: 'US',
      tiktokCategoryId: '601226',
      categoryName: 'T-Shirts',
      categoryPath: 'Womenswear > T-Shirts',
    },
  });
  const sku = await prisma.podSkuTemplate.create({
    data: {
      organizationId: orgA.id,
      name: `Comfort ${run}`,
      skuPrefix: 'TEE',
      currency: 'USD',
      defaultSalePrice: new Prisma.Decimal('19.99'),
      variants: {
        create: [
          { organizationId: orgA.id, name: 'Color', sortOrder: 0, values: { create: [{ organizationId: orgA.id, value: 'Black', code: 'BLK', sortOrder: 0 }] } },
          { organizationId: orgA.id, name: 'Size', sortOrder: 1, values: { create: [{ organizationId: orgA.id, value: 'S', code: 'S', sortOrder: 0 }, { organizationId: orgA.id, value: 'M', code: 'M', sortOrder: 1 }] } },
        ],
      },
    },
  });
  const description = await prisma.podDescriptionTemplate.create({
    data: { organizationId: orgA.id, name: `Desc ${run}`, contentHtml: '<p>Áo thun</p>' },
  });
  const file = await prisma.storageFile.create({
    data: {
      organizationId: orgA.id,
      module: 'POD_TIKTOK',
      referenceType: 'POD_LISTING_ASSET',
      folder: 'e2e',
      objectKey: `e2e/${run}.png`,
      originalName: 'front.png',
      storedName: `${run}.png`,
      extension: 'png',
      mimeType: 'image/png',
      fileSize: 10,
      publicUrl: `https://cdn.local/${run}.png`,
      uploadedBy: user.id,
      uploadedAt: new Date(),
    },
  });
  const image = await prisma.podImageTemplate.create({
    data: {
      organizationId: orgA.id,
      name: `Mockup ${run}`,
      items: {
        create: [1, 0].map((order) => ({
          organizationId: orgA.id,
          title: `Ảnh ${order}`,
          assetType: 'LIFESTYLE' as const,
          fileId: file.id,
          imageUrl: `https://cdn.local/${run}-${order}.png`,
          imageKey: `k-${order}`,
          contentType: 'image/png',
          fileSize: 10,
          displayOrder: order,
        })),
      },
    },
  });
  const categoryB = await prisma.podCategoryTemplate.create({
    data: { organizationId: orgB.id, name: `Other org ${run}`, market: 'US', tiktokCategoryId: '1' },
  });

  // --- Danh sách khi tổ chức CHƯA có group nào ---
  const emptyList = await groups.list(orgA.id, {} as never);
  check('tổ chức chưa có group ⇒ thành công, danh sách rỗng, meta chuẩn', emptyList.items.length === 0 &&
    JSON.stringify(emptyList.meta) === JSON.stringify({ total: 0, page: 1, limit: 20, totalPages: 0 }), emptyList.meta);

  // --- Tạo + đọc lại ---
  const name = `Tee Group ${run}`;
  const created = await groups.create(orgA.id, user.id, {
    name,
    categoryTemplateId: category.id,
    skuTemplateId: sku.id,
    descriptionTemplateId: description.id,
    imageTemplateId: image.id,
  });
  const reloaded = await groups.get(orgA.id, created.id);
  check('tạo group hợp lệ ⇒ đọc lại đúng 4 tham chiếu', [
    reloaded.categoryTemplateId === category.id,
    reloaded.skuTemplateId === sku.id,
    reloaded.descriptionTemplateId === description.id,
    reloaded.imageTemplateId === image.id,
  ].every(Boolean));
  check('bản tóm tắt: thị trường + danh mục + số trục SKU + số ảnh', reloaded.categoryTemplate?.market === 'US' &&
    reloaded.categoryTemplate?.categoryPath === 'Womenswear > T-Shirts' &&
    reloaded.skuTemplate?.variants.map((v) => v.name).join('×') === 'Color×Size' &&
    reloaded.imageTemplate?._count.items === 2, reloaded.imageTemplate?._count);
  check('người tạo được ghi', reloaded.createdBy === user.id);

  const list = await groups.list(orgA.id, { search: run, limit: 100 } as never);
  check('danh sách (tìm theo tên) có group', list.items.some((item) => item.id === created.id));
  const listUk = await groups.list(orgA.id, { market: 'UK', limit: 100 } as never);
  check('lọc thị trường UK ⇒ không có group US', !listUk.items.some((item) => item.id === created.id));

  // --- Validation ---
  check('trùng tên (khác hoa thường) ⇒ 409', (await codeOf(groups.create(orgA.id, user.id, { name: name.toUpperCase(), skuTemplateId: sku.id }))) === 'POD_GROUP_TEMPLATE_NAME_TAKEN');
  check('không mảnh nào ⇒ POD_GROUP_TEMPLATE_EMPTY', (await codeOf(groups.create(orgA.id, user.id, { name: `Empty ${run}` }))) === 'POD_GROUP_TEMPLATE_EMPTY');
  check('🔴 tham chiếu template của TỔ CHỨC KHÁC ⇒ INVALID_REF', (await codeOf(groups.create(orgA.id, user.id, { name: `X ${run}`, categoryTemplateId: categoryB.id }))) === 'POD_GROUP_TEMPLATE_INVALID_REF');
  check('🔴 tổ chức khác không đọc được group', (await codeOf(groups.get(orgB.id, created.id))) === 'POD_GROUP_TEMPLATE_NOT_FOUND');
  const listB = await groups.list(orgB.id, { limit: 100 } as never);
  check('🔴 danh sách của tổ chức khác không chứa group của A', !listB.items.some((item) => item.id === created.id));
  const sameNameOtherOrg = await codeOf(groups.create(orgB.id, user.id, { name, categoryTemplateId: categoryB.id }));
  check('cùng tên ở TỔ CHỨC KHÁC ⇒ cho phép', sameNameOtherOrg === 'OK', sameNameOtherOrg);

  // --- Ràng buộc DB (đi vòng service) ---
  const dupRaw = await codeOf(
    prisma.podGroupTemplate.create({ data: { organizationId: orgA.id, name: name.toLowerCase(), skuTemplateId: sku.id } }),
  );
  check('DB: index duy nhất (lower(name)) chặn trùng tên', dupRaw === 'P2002', dupRaw);
  const emptyRaw = await codeOf(prisma.podGroupTemplate.create({ data: { organizationId: orgA.id, name: `raw-empty-${run}` } }));
  check('DB: CHECK pod_group_templates_has_part_check chặn group rỗng (23514)', emptyRaw.includes('23514') && emptyRaw.includes('pod_group_templates_has_part_check'));
  const hardDelete = await codeOf(prisma.podSkuTemplate.delete({ where: { id: sku.id } }));
  check('DB: FK Restrict chặn xoá cứng template con đang trong group (23001)', hardDelete.includes('23001') && hardDelete.includes('pod_group_templates_sku_template_id_fkey'));

  // --- Sửa: giữ / gỡ / thay ---
  const description2 = await prisma.podDescriptionTemplate.create({
    data: { organizationId: orgA.id, name: `Desc2 ${run}`, contentHtml: '<p>Mới</p>' },
  });
  const updated = await groups.update(orgA.id, user.id, created.id, {
    name,
    imageTemplateId: null,
    descriptionTemplateId: description2.id,
  });
  check('sửa: Category/SKU giữ, Image gỡ, Description thay', updated.categoryTemplateId === category.id &&
    updated.skuTemplateId === sku.id && updated.imageTemplateId === null && updated.descriptionTemplateId === description2.id);
  check('sửa gỡ hết mảnh ⇒ chặn', (await codeOf(groups.update(orgA.id, user.id, created.id, { name, categoryTemplateId: null, skuTemplateId: null, descriptionTemplateId: null }))) === 'POD_GROUP_TEMPLATE_EMPTY');

  // --- Resolved: luôn bản mới nhất ---
  await prisma.podDescriptionTemplate.update({ where: { id: description2.id }, data: { contentHtml: '<p>Sửa sau</p>' } });
  const resolved = await groups.getResolved(orgA.id, created.id);
  check('resolved: lấy bản MỚI NHẤT của template con', resolved.descriptionTemplate?.contentHtml === '<p>Sửa sau</p>');
  check('resolved: mảnh đã gỡ ⇒ null', resolved.imageTemplate === null);
  const direct = await templates.getSkuTemplate(orgA.id, sku.id);
  check('resolved: SKU cùng hình dạng endpoint chi tiết (có trục + items + trạng thái)', JSON.stringify(resolved.skuTemplate) === JSON.stringify(direct));
  check('resolved: thị trường = thị trường Category', resolved.market === 'US');

  // --- Xoá template con đang dùng ⇒ chặn ---
  check('xoá SKU Template đang trong group ⇒ POD_TEMPLATE_IN_USE', (await codeOf(templates.removeSkuTemplate(orgA.id, user.id, sku.id))) === 'POD_TEMPLATE_IN_USE');
  check('xoá Category Template đang trong group ⇒ POD_TEMPLATE_IN_USE', (await codeOf(templates.removeCategoryTemplate(orgA.id, user.id, category.id))) === 'POD_TEMPLATE_IN_USE');
  check('xoá Image Template KHÔNG còn trong group ⇒ được', (await codeOf(images.remove(orgA.id, user.id, image.id))) === 'OK');

  // --- Nhân bản ---
  const copy = await groups.clone(orgA.id, user.id, created.id);
  const copy2 = await groups.clone(orgA.id, user.id, created.id);
  check('nhân bản: tên "(copy)" rồi "(copy 2)", cùng mảnh', copy.name === `${name} (copy)` && copy2.name === `${name} (copy 2)` && copy.skuTemplateId === sku.id, [copy.name, copy2.name]);

  // --- Lượt đăng ghi nhận group + xoá mềm ---
  const platform = await prisma.platform.findFirst({ select: { id: true } });
  let sessionId: string | null = null;
  if (platform) {
    const session = await prisma.podListingSession.create({
      data: {
        organizationId: orgA.id,
        platformId: platform.id,
        name: `S ${run}`,
        market: 'US',
        groupTemplateId: created.id,
        groupTemplateName: name,
        templates: { create: [{ organizationId: orgA.id, templateType: 'SKU', skuTemplateId: sku.id, templateName: sku.name }] },
      },
    });
    sessionId = session.id;
  }
  const removed = await groups.remove(orgA.id, user.id, created.id);
  check('xoá mềm: trả về số lượt đăng đang ghi nhận', removed.referencedSessions === (sessionId ? 1 : 0), removed);
  const row = await prisma.podGroupTemplate.findUnique({ where: { id: created.id } });
  check('xoá mềm: bản ghi còn, deletedAt có giá trị, isActive=false', Boolean(row?.deletedAt) && row?.isActive === false);
  check('xoá rồi không đọc được nữa (404)', (await codeOf(groups.get(orgA.id, created.id))) === 'POD_GROUP_TEMPLATE_NOT_FOUND');
  if (sessionId) {
    const session = await prisma.podListingSession.findUnique({ where: { id: sessionId }, include: { templates: true } });
    check('🔴 lượt đăng KHÔNG hỏng: giữ group id + ảnh chụp tên + template con', session?.groupTemplateId === created.id &&
      session?.groupTemplateName === name && session?.templates[0]?.skuTemplateId === sku.id);
  } else {
    check('lượt đăng ghi nhận group (bỏ qua — DB chưa seed platform)', true);
  }
  const recreated = await codeOf(groups.create(orgA.id, user.id, { name, skuTemplateId: sku.id }));
  check('tên của group đã xoá được dùng lại', recreated === 'OK', recreated);

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    results.push(`❌ LỖI KHÔNG MONG ĐỢI — ${(error as Error).stack ?? String(error)}`);
  })
  .finally(() => {
    console.log(results.join('\n'));
    const failed = results.filter((line) => line.startsWith('❌')).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
