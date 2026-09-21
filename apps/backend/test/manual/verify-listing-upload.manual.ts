/* eslint-disable */
/**
 * Kiểm chứng đường UPLOAD ảnh lên TikTok của listing trên DỮ LIỆU THẬT — dừng NGAY TRƯỚC
 * Create Product (không tạo sản phẩm nào trên shop).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/verify-listing-upload.manual.ts [sessionId]
 *
 * Gọi đúng `ensureImageUris` + `buildCreateRequest` mà `publishDraft` dùng:
 *   - ảnh riêng + ảnh mẫu ⇒ `main_images[].uri` (use case MAIN_IMAGE), ≤ POD_LISTING_MAX_IMAGES
 *   - bảng size của Category Template (fileId trong Storage) ⇒ upload use case SIZE_CHART_IMAGE
 *     ⇒ `size_chart.image.uri` — trường RIÊNG, không nằm trong `main_images`
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { POD_LISTING_MAX_IMAGES } from '../../src/modules/pod-listing/constants/pod-listing.constants';
import { PodListingPublisherService } from '../../src/modules/pod-listing/services/pod-listing-publisher.service';
import { PodListingResolverService } from '../../src/modules/pod-listing/services/pod-listing-resolver.service';
import { PodListingTemplateService } from '../../src/modules/pod-listing/services/pod-listing-template.service';
import { PodProductCatalogService } from '../../src/modules/pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../src/modules/pod-product/repositories/pod-product-sync.repository';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}`, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const templates = app.get(PodListingTemplateService);
  const resolver = app.get(PodListingResolverService);
  const publisher = app.get(PodListingPublisherService) as any;
  const catalog = app.get(PodProductCatalogService);
  const syncRepo = app.get(PodProductSyncRepository);

  const sessionId = process.argv[2] ?? '779b933c-6216-4e72-a166-4a17c0ea5d9e';
  const session = await prisma.podListingSession.findFirstOrThrow({ where: { id: sessionId }, select: { organizationId: true } });
  const target = (await syncRepo.findSyncTargets({ organizationId: session.organizationId }))[0];
  if (!target) throw new Error('Không có shop đủ điều kiện');
  const ctx = await catalog.buildContext(target);
  const template = await templates.getForSession(session.organizationId, sessionId);

  // Sản phẩm có 8 ảnh riêng ⇒ được bổ sung 1 ảnh mẫu.
  const product = await prisma.podListingSessionProduct.findFirstOrThrow({
    where: { sessionId, deletedAt: null, title: { contains: 'Nativity' } },
    select: { id: true, title: true },
  });
  const { payload } = await resolver.resolve(session.organizationId, { template, productId: null, sessionProductId: product.id, shopId: target.id });
  console.log(`payload: ${payload.images.length} ảnh · sizeChart=${payload.sizeChart ? `fileId=${payload.sizeChart.fileId} url=${payload.sizeChart.url}` : 'null'}`);

  const logs: Array<{ level: string; step: string; message: string; payload?: unknown }> = [];
  const log = async (level: string, step: string, message: string, extra?: unknown) => { logs.push({ level, step, message, payload: extra }); };

  console.log('\n▶ ensureImageUris (upload thật lên TikTok — chỉ ảnh, không tạo sản phẩm)');
  const images = await publisher.ensureImageUris(session.organizationId, ctx, payload, new Map(), log);
  check(`main_images: ${images.uris.length} uri (≤ ${POD_LISTING_MAX_IMAGES})`, images.uris.length === Math.min(payload.images.length, POD_LISTING_MAX_IMAGES) && images.uris.every((u: string) => typeof u === 'string' && u.length > 0), images.uris);
  check('🔴 bảng size từ Category Template đã upload với use case SIZE_CHART_IMAGE ⇒ có uri', typeof images.sizeChartUri === 'string' && images.sizeChartUri.length > 0, { sizeChartUri: images.sizeChartUri, logs });
  check('uri bảng size KHÔNG trùng bất kỳ uri ảnh sản phẩm nào', !images.uris.includes(images.sizeChartUri));
  const prepared = logs.find((entry) => entry.message.includes('Đã chuẩn bị ảnh'));
  check('log chuẩn bị ảnh báo sizeChart=OK', (prepared?.payload as any)?.sizeChart === 'OK', prepared);
  check('không có cảnh báo "Không tải được bảng size"', !logs.some((entry) => entry.message.includes('bảng size') && entry.level === 'WARN'), logs);

  console.log('\n▶ buildCreateRequest (payload cuối gửi TikTok — KHÔNG gọi Create Product)');
  const request = publisher.buildCreateRequest(payload, 'verify-only', images.uris, images.variantUris, 'warehouse-verify', images.sizeChartUri, images.videoId);
  check(`request.mainImages có ${request.mainImages?.length} phần tử`, request.mainImages?.length === images.uris.length, request.mainImages);
  check('request.sizeChart.image.uri = uri bảng size', request.sizeChart?.image?.uri === images.sizeChartUri, request.sizeChart);
  check('bảng size không nằm trong mainImages', !request.mainImages?.some((image: { uri: string }) => image.uri === request.sizeChart?.image?.uri));
  console.log('  mainImages:', request.mainImages?.map((image: { uri: string }) => image.uri.slice(0, 40) + '…'));
  console.log('  sizeChart :', request.sizeChart);

  await app.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} đạt · ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
