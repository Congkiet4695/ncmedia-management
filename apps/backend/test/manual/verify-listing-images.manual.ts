/* eslint-disable */
/**
 * Kiểm chứng bộ ảnh + bảng size của listing trên DỮ LIỆU THẬT (chỉ đọc — không ghi DB, không gọi TikTok).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/verify-listing-images.manual.ts [sessionId]
 *
 * Với mỗi Draft Product của một Listing Session (Auto Listing từ file) đang ghép Image Template
 * + Category Template, chạy đúng resolver mà job listing dùng và in ra:
 *   - số ảnh riêng · số ảnh mẫu được bổ sung · tổng (≤ POD_LISTING_MAX_IMAGES)
 *   - thứ tự: ảnh riêng đứng trước, nguyên thứ tự; ảnh mẫu nối sau; không trùng
 *   - bảng size lấy từ đâu (sản phẩm / Category Template / Image Template)
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { POD_LISTING_MAX_IMAGES } from '../../src/modules/pod-listing/constants/pod-listing.constants';
import { PodListingResolverService } from '../../src/modules/pod-listing/services/pod-listing-resolver.service';
import { PodListingTemplateService } from '../../src/modules/pod-listing/services/pod-listing-template.service';
import { PrismaService } from '../../src/database/prisma.service';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}`, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const templates = app.get(PodListingTemplateService);
  const resolver = app.get(PodListingResolverService);

  const sessionId = process.argv[2] ?? '779b933c-6216-4e72-a166-4a17c0ea5d9e';
  const session = await prisma.podListingSession.findFirstOrThrow({
    where: { id: sessionId },
    select: { id: true, organizationId: true, shops: { select: { shopId: true }, take: 1 }, templates: true },
  });
  const shopId = session.shops[0]?.shopId ?? (await prisma.podTiktokShop.findFirstOrThrow({ where: { organizationId: session.organizationId }, select: { id: true } })).id;
  const template = await templates.getForSession(session.organizationId, sessionId);
  const templateItems = (template.imageTemplate?.items ?? []).filter((item) => item.assetType !== 'SIZE_CHART');
  console.log(`session=${sessionId} imageTemplate=${template.imageTemplate?.id ?? '-'} (${templateItems.length} ảnh gallery) categoryTemplate=${template.categoryTemplate?.id ?? '-'} sizeChartFileId=${template.categoryTemplate?.sizeChartFileId ?? '-'}`);

  const products = await prisma.podListingSessionProduct.findMany({
    where: { sessionId, deletedAt: null },
    select: { id: true, title: true, images: { select: { imageUrl: true, imageType: true, sortOrder: true, fileId: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: { importOrder: 'asc' },
  });

  for (const product of products) {
    const own = product.images.filter((image) => image.imageType === 'MAIN' || image.imageType === 'VARIANT');
    const { payload, issues } = await resolver.resolve(session.organizationId, {
      template,
      productId: null,
      sessionProductId: product.id,
      shopId,
    });
    const urls = payload.images.map((image) => image.url);
    const ownUrls = own.map((image) => image.imageUrl);
    const appended = urls.slice(own.length);
    const expectedAppend = Math.min(templateItems.length, Math.max(0, POD_LISTING_MAX_IMAGES - own.length));
    console.log(`\n▶ "${product.title.slice(0, 60)}…" — ${own.length} ảnh riêng + ${templateItems.length} ảnh mẫu ⇒ ${urls.length} ảnh`);
    check(`ảnh riêng giữ nguyên thứ tự và đứng đầu (${own.length})`, JSON.stringify(urls.slice(0, own.length)) === JSON.stringify(ownUrls));
    check(`bổ sung đúng ${expectedAppend} ảnh mẫu (tổng ${own.length + expectedAppend}, không vượt ${POD_LISTING_MAX_IMAGES} bằng ảnh mẫu)`, appended.length === expectedAppend, appended);
    check('không có ảnh trùng', new Set(urls).size === urls.length);
    check('ảnh mẫu bổ sung theo đúng thứ tự bộ mẫu', JSON.stringify(appended) === JSON.stringify(templateItems.slice(0, expectedAppend).map((item) => item.imageUrl)));
    check('thứ tự liên tiếp 0..n-1', payload.images.every((image, index) => image.sortOrder === index));
    check('không lỗi MISSING_IMAGE', !issues.some((issue) => issue.code === 'MISSING_IMAGE'), issues);
    const chartSource = product.images.some((image) => image.imageType === 'SIZE_CHART')
      ? 'sản phẩm'
      : template.categoryTemplate?.sizeChartFileId
        ? 'Category Template'
        : 'không có';
    check(`bảng size: ${chartSource} ⇒ payload.sizeChart ${payload.sizeChart ? 'có (fileId=' + payload.sizeChart.fileId + ')' : 'null'}`,
      chartSource === 'không có' ? payload.sizeChart === null : payload.sizeChart?.fileId === (template.categoryTemplate?.sizeChartFileId ?? payload.sizeChart?.fileId));
    check('bảng size KHÔNG nằm trong bộ ảnh sản phẩm', !urls.some((url) => payload.sizeChart?.url && url === payload.sizeChart.url));
  }

  await app.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} đạt · ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
