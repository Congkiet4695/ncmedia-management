import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import { TIKTOK_IMAGE_USE_CASE } from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  classifyImageSource,
  extractDescriptionImages,
  findDescriptionImageProblems,
  rewriteDescriptionImages,
  type DescriptionImageProblem,
  type DescriptionImageRef,
  type ResolvedDescriptionImage,
} from './description-images';
import { fetchRemoteImage } from './remote-image.fetch';

/**
 * Ảnh trong mô tả không đưa lên TikTok được. Thông điệp đã là câu cho người dùng; câu gốc
 * của lỗi (nếu có) nằm ở `cause` để log.
 *
 * 🔴 KHÔNG phải lỗi vĩnh viễn: một lần tải ảnh hỏng vì mạng thì thử lại có thể qua. Hàng đợi
 * listing sẽ retry theo chính sách chung; sau số lần tối đa mới đánh FAILED với câu này.
 */
export class PodDescriptionImageException extends Error {
  constructor(
    message: string,
    readonly problems: DescriptionImageProblem[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PodDescriptionImageException';
  }
}

export const DESCRIPTION_IMAGE_UPLOAD_FAILED_MESSAGE =
  'Không thể upload ảnh trong mô tả lên TikTok Shop. Vui lòng thử lại.';
export const DESCRIPTION_IMAGE_NOT_UPLOADED_MESSAGE =
  'Mô tả sản phẩm chứa ảnh chưa được upload lên TikTok Shop.';

/** Số liệu của một lần chuẩn hoá — để log, không có gì nhạy cảm. */
export interface DescriptionImageStats {
  total: number;
  uploaded: number;
  reused: number;
  failed: number;
  finalCount: number;
}

export interface NormalizeDescriptionResult {
  html: string;
  stats: DescriptionImageStats;
}

/**
 * PodDescriptionImageService — đưa ảnh trong MÔ TẢ lên TikTok với `use_case = DESCRIPTION_IMAGE`
 * rồi thay `src` bằng URL TikTok trả về.
 *
 * ```
 *   <img src="https://cdn-cua-ta/abc.jpg">
 *        │  1. metadata: src đã là URL TikTok của ta? (bảng pod_tiktok_description_images)
 *        │  2. hoặc nằm trong bộ ảnh mô tả ĐANG có trên sản phẩm TikTok (Edit Product)?
 *        │  3. chưa ⇒ tra theo nguồn (file Storage theo public_url / checksum, hoặc URL ngoài)
 *        │  4. chưa có ⇒ tải bytes → Upload Product Image (DESCRIPTION_IMAGE) → ghi mapping
 *        ▼
 *   <img src="https://<tiktok-url>" width="1600" height="1600">
 * ```
 *
 * 🔴 KHÔNG bao giờ dùng `MAIN_IMAGE` / `SIZE_CHART_IMAGE` cho ảnh mô tả: TikTok cấp `uri` theo
 * use case, và `<img src>` trong mô tả chỉ nhận URL của DESCRIPTION_IMAGE (`12052340`).
 *
 * 🔴 "Đã upload chưa" trả lời bằng METADATA, không phải tiền tố URL: dòng trong bảng mapping
 * (do chính ta ghi sau khi TikTok trả về) hoặc bộ ảnh đang có trên sản phẩm (do TikTok trả về
 * lúc đồng bộ). Một URL trông giống CDN TikTok nhưng không thuộc hai tập đó vẫn bị tải về và
 * upload lại — an toàn hơn là đoán.
 *
 * Dedup ba tầng: promise đang chạy (5 luồng của hàng đợi cùng gặp một ảnh chỉ upload một lần)
 * → bảng mapping theo `source_key` (file id / URL) hoặc `checksum` (cùng nội dung, khác tên)
 * → mới upload. `uri`/`url` TikTok ở phạm vi app nên dùng lại được cho mọi shop.
 */
@Injectable()
export class PodDescriptionImageService {
  private readonly logger = new Logger(PodDescriptionImageService.name);
  /** Upload đang chạy, khoá theo `org:sourceKey` — xoá ngay khi xong (thành hay bại). */
  private readonly inflight = new Map<string, Promise<ResolvedDescriptionImage>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly productApi: TiktokProductApiService,
  ) {}

  /**
   * Chuẩn hoá HTML mô tả: mọi `<img>` ra khỏi đây đều mang URL DESCRIPTION_IMAGE của TikTok
   * kèm `width`/`height`. Ném `PodDescriptionImageException` nếu còn một ảnh không đưa lên được
   * — nơi gọi KHÔNG được gửi sản phẩm khi hàm này ném.
   *
   * `knownTiktokUrls`: ảnh mô tả ĐANG có trên sản phẩm TikTok (màn Sửa sản phẩm) — giữ nguyên,
   * không upload lại.
   */
  async normalize(
    organizationId: string,
    ctx: TiktokShopContext,
    html: string,
    options: { knownTiktokUrls?: ReadonlySet<string>; label?: string } = {},
  ): Promise<NormalizeDescriptionResult> {
    const refs = extractDescriptionImages(html);
    const stats: DescriptionImageStats = {
      total: refs.length,
      uploaded: 0,
      reused: 0,
      failed: 0,
      finalCount: 0,
    };
    if (refs.length === 0) return { html, stats };

    // Lỗi hình thức (data:/blob:/rỗng) chặn ngay — không có gì để tải lên.
    const unsendable = findDescriptionImageProblems(html, () => true);
    if (unsendable.length > 0) {
      stats.failed = unsendable.length;
      throw new PodDescriptionImageException(
        `${DESCRIPTION_IMAGE_NOT_UPLOADED_MESSAGE} (ảnh thứ ${unsendable
          .map((problem) => problem.index + 1)
          .join(', ')})`,
        unsendable,
      );
    }

    const known = options.knownTiktokUrls ?? new Set<string>();
    const ownRows = await this.findByTiktokUrls(
      organizationId,
      refs.map((ref) => ref.src),
    );

    const resolvedBySrc = new Map<string, ResolvedDescriptionImage>();
    const failures: DescriptionImageProblem[] = [];

    await Promise.all(
      [...new Set(refs.map((ref) => ref.src))].map(async (src) => {
        const own = ownRows.get(src);
        if (own) {
          resolvedBySrc.set(src, own);
          stats.reused += 1;
          return;
        }
        if (known.has(src)) {
          // Đã nằm trên sản phẩm TikTok — không có kích thước thật để bổ sung, giữ nguyên thẻ.
          stats.reused += 1;
          return;
        }
        try {
          const outcome = await this.resolveSource(organizationId, ctx, src, options.label);
          resolvedBySrc.set(src, outcome.image);
          if (outcome.uploaded) stats.uploaded += 1;
          else stats.reused += 1;
        } catch (error) {
          stats.failed += 1;
          const index = refs.find((ref) => ref.src === src)?.index ?? 0;
          failures.push({ index, src, reason: 'NOT_UPLOADED' });
          this.logger.warn({
            module: 'pod-product',
            operation: 'description-image.upload.fail',
            organizationId,
            src: src.slice(0, 200),
            msg: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (failures.length > 0) {
      throw new PodDescriptionImageException(
        `${DESCRIPTION_IMAGE_UPLOAD_FAILED_MESSAGE} (ảnh thứ ${failures
          .map((problem) => problem.index + 1)
          .sort()
          .join(', ')})`,
        failures,
      );
    }

    const normalized = rewriteDescriptionImages(html, (ref) => resolvedBySrc.get(ref.src) ?? null);
    stats.finalCount = extractDescriptionImages(normalized).length;

    // Hàng rào cuối: sau chuẩn hoá, KHÔNG còn `<img>` nào ngoài tập đã biết. Đây là điều kiện
    // TikTok đặt ra, kiểm ở đây thay vì để sàn từ chối sau khi đã upload bộ ảnh sản phẩm.
    const leftover = findDescriptionImageProblems(
      normalized,
      (ref) => known.has(ref.src) || [...resolvedBySrc.values()].some((item) => item.url === ref.src),
    );
    if (leftover.length > 0) {
      throw new PodDescriptionImageException(DESCRIPTION_IMAGE_NOT_UPLOADED_MESSAGE, leftover);
    }

    return { html: normalized, stats };
  }

  /**
   * Kiểm HTML mô tả KHÔNG gọi sàn — dùng ở cổng Validate/Preview.
   *
   * Chỉ bắt lỗi hình thức (`data:`/`blob:`/rỗng/không http). Ảnh http(s) chưa upload KHÔNG phải
   * lỗi ở bước này: chúng sẽ được upload lúc đăng. Kiểm "đã upload chưa" bằng metadata là việc
   * của `normalize`, ngay trước khi gửi sản phẩm.
   */
  static findUnsendable(html: string): DescriptionImageProblem[] {
    return findDescriptionImageProblems(html, () => true);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Những `src` đã là URL TikTok do ta upload (bảng mapping của tổ chức). */
  private async findByTiktokUrls(
    organizationId: string,
    srcs: string[],
  ): Promise<Map<string, ResolvedDescriptionImage>> {
    const rows = await this.prisma.podTiktokDescriptionImage.findMany({
      where: { organizationId, tiktokUrl: { in: [...new Set(srcs)] } },
      select: { tiktokUrl: true, width: true, height: true },
    });
    return new Map(
      rows.map((row) => [row.tiktokUrl, { url: row.tiktokUrl, width: row.width, height: row.height }]),
    );
  }

  /** Tra mapping theo nguồn; chưa có thì upload. Dedup upload đang chạy theo khoá nguồn. */
  private async resolveSource(
    organizationId: string,
    ctx: TiktokShopContext,
    src: string,
    label?: string,
  ): Promise<{ image: ResolvedDescriptionImage; uploaded: boolean }> {
    const source = await this.identifySource(organizationId, src);

    const cached = await this.prisma.podTiktokDescriptionImage.findFirst({
      where: {
        organizationId,
        OR: [
          { sourceKey: source.sourceKey },
          ...(source.checksum ? [{ checksum: source.checksum }] : []),
        ],
      },
      select: { tiktokUrl: true, width: true, height: true },
    });
    if (cached) {
      return { image: { url: cached.tiktokUrl, width: cached.width, height: cached.height }, uploaded: false };
    }

    const inflightKey = `${organizationId}:${source.sourceKey}`;
    const pending = this.inflight.get(inflightKey);
    if (pending) return { image: await pending, uploaded: false };

    const promise = this.upload(organizationId, ctx, src, source, label).finally(() =>
      this.inflight.delete(inflightKey),
    );
    this.inflight.set(inflightKey, promise);
    return { image: await promise, uploaded: true };
  }

  /**
   * Nguồn của một `src`: file trong Storage của tổ chức (tra theo `public_url`) hay URL ngoài.
   *
   * File Storage mang `checksum` ⇒ dedup theo NỘI DUNG: cùng tấm ảnh tải lên hai lần với hai
   * tên khác nhau vẫn chỉ một lần đẩy sang TikTok; hai file cùng tên khác nội dung là hai dòng.
   */
  private async identifySource(
    organizationId: string,
    src: string,
  ): Promise<{ sourceKey: string; fileId: string | null; checksum: string | null }> {
    if (classifyImageSource(src) !== 'HTTP') {
      throw new Error(`src không phải http(s): ${src.slice(0, 80)}`);
    }
    const file = await this.prisma.storageFile.findFirst({
      where: { organizationId, publicUrl: src, deletedAt: null },
      select: { id: true, checksum: true },
    });
    if (file) return { sourceKey: `file:${file.id}`, fileId: file.id, checksum: file.checksum };
    return {
      sourceKey: `url:${createHash('sha256').update(src).digest('hex')}`,
      fileId: null,
      checksum: null,
    };
  }

  private async upload(
    organizationId: string,
    ctx: TiktokShopContext,
    src: string,
    source: { sourceKey: string; fileId: string | null; checksum: string | null },
    label?: string,
  ): Promise<ResolvedDescriptionImage> {
    const image = source.fileId
      ? await this.readStorageFile(organizationId, source.fileId)
      : await fetchRemoteImage(src, label ?? 'mô tả');

    // 🔴 use_case DESCRIPTION_IMAGE — không phải MAIN_IMAGE.
    const { data } = await this.productApi.uploadImage(
      ctx,
      image,
      TIKTOK_IMAGE_USE_CASE.DESCRIPTION_IMAGE,
    );
    if (!data.uri || !data.url) {
      throw new Error('TikTok không trả về uri/url cho ảnh mô tả');
    }

    const row = await this.prisma.podTiktokDescriptionImage.upsert({
      where: { organizationId_sourceKey: { organizationId, sourceKey: source.sourceKey } },
      create: {
        organizationId,
        sourceKey: source.sourceKey,
        sourceUrl: src.slice(0, 2048),
        fileId: source.fileId,
        checksum: source.checksum,
        tiktokUri: data.uri,
        tiktokUrl: data.url,
        width: data.width ?? null,
        height: data.height ?? null,
        uploadedAt: new Date(),
      },
      update: {
        sourceUrl: src.slice(0, 2048),
        tiktokUri: data.uri,
        tiktokUrl: data.url,
        width: data.width ?? null,
        height: data.height ?? null,
        uploadedAt: new Date(),
      },
      select: { tiktokUrl: true, width: true, height: true },
    });

    return { url: row.tiktokUrl, width: row.width, height: row.height };
  }

  private async readStorageFile(
    organizationId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const { file, body } = await this.storage.download(organizationId, fileId);
    return {
      buffer: body,
      fileName: file.originalName || `${fileId}.png`,
      contentType: file.mimeType,
    };
  }
}

/** Ảnh mô tả `<img src>` đang có trên một sản phẩm TikTok (từ mô tả đã đồng bộ). */
export function knownDescriptionImageUrls(descriptionHtml: string | null | undefined): Set<string> {
  return new Set(
    extractDescriptionImages(descriptionHtml ?? '')
      .map((ref) => ref.src)
      .filter((src) => classifyImageSource(src) === 'HTTP'),
  );
}

export type { DescriptionImageRef };
