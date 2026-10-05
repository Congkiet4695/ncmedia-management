import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PodDesignPlacement,
  Prisma,
  StorageModuleName,
  StorageReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  fetchRemoteFile,
  RemoteFetchError,
  type RemoteFetchFailure,
  type RemoteFile,
} from '../../../common/http/safe-remote-fetch';
import { detectImageMime, IMAGE_MIME_EXTENSION } from '../../../common/utils/image-signature.util';
import { resolveStorageMaxBytes } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import {
  POD_DESIGN_MIME_TYPES,
  POD_DESIGN_URL_FETCH_TIMEOUT_MS,
  POD_DESIGN_URL_GENERIC_CONTENT_TYPES,
  POD_DESIGN_URL_MAX_REDIRECTS,
} from '../../pod-tiktok/constants/pod-design.constants';
import { PodDesignDto } from '../../pod-tiktok/dto/pod-design.dto';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { mappingKeyOf } from '../shared/mapping-match';
import { toDirectDownloadUrl } from '../shared/design-url';
import { assertPublicDownloadUrl } from '../shared/public-url';

/** Design kèm metadata file — hình dạng dùng chung cho mọi hàm ở đây. */
const DESIGN_INCLUDE = {
  storageFile: { include: { uploader: { select: { id: true, fullName: true } } } },
} satisfies Prisma.FulfillmentProductDesignInclude;

type ProductDesignWithFile = Prisma.FulfillmentProductDesignGetPayload<{
  include: typeof DESIGN_INCLUDE;
}>;

/** Khoá nghiệp vụ của một sản phẩm POD. */
export interface ProductDesignKey {
  tiktokProductId: string;
  sellerSku: string;
}

export class ProductDesignKeyInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_DESIGN_KEY_INVALID',
      message:
        'Thiếu Product ID hoặc Seller SKU. Design được lưu theo cặp khoá này, ' +
        'nên không có đủ hai giá trị thì không xác định được lưu cho sản phẩm nào.',
    });
  }
}

export class ProductDesignNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'FULFILLMENT_DESIGN_NOT_FOUND',
      message: 'Vị trí in này chưa có design.',
    });
  }
}

/** Lỗi tải về thuộc loại 'URL không hợp lệ' (400) — còn lại là 'tải không được' (422). */
const URL_INVALID_REASONS: readonly RemoteFetchFailure[] = [
  'UNSUPPORTED_PROTOCOL',
  'CREDENTIALS_IN_URL',
  'PORT_NOT_ALLOWED',
  'NOT_PUBLIC',
];

/**
 * Tải design từ URL không thành công (link hết hạn / không công khai / không phải ảnh / quá lớn /
 * hết thời gian). `details.reason` cho giao diện nói đúng nguyên nhân.
 */
export class DesignUrlFetchFailedException extends UnprocessableEntityException {
  constructor(
    reason: RemoteFetchFailure | 'NOT_IMAGE' | 'UNSUPPORTED_TYPE',
    message: string,
    status?: number,
  ) {
    super({
      code: 'FULFILLMENT_DESIGN_URL_FETCH_FAILED',
      message,
      details: { reason, ...(status ? { status } : {}) },
    });
  }
}

/**
 * ProductDesignService — file in gắn theo **SẢN PHẨM** (Product ID + Seller SKU).
 *
 * 🔴 **ĐỘC LẬP với Product Mapping.** Đây là thay đổi nghiệp vụ của sprint này: trước đây
 * design treo vào `mapping_id` nên phải khai ánh xạ xong mới upload được. Sai —
 *   · Design  trả lời "in cái gì"  → chỉ cần Product ID + Seller SKU
 *   · Mapping trả lời "in ở đâu"   → chỉ cần khi Fulfill
 * Hai việc không phụ thuộc nhau, người vận hành làm theo thứ tự nào cũng được.
 *
 * 🔴 Đây là ĐƯỜNG GHI DUY NHẤT của design trong toàn hệ thống. Hệ quả của việc đơn hàng
 * ĐỌC-XUYÊN-SUỐT thay vì giữ bản sao — không có bước đồng bộ nào ở đây, và cũng không cần có:
 *   - `upload` (lần đầu hoặc thay thế) ⇒ mọi đơn cùng cặp khoá thấy file mới ngay.
 *   - `remove`                          ⇒ mọi đơn cùng cặp khoá quay về "Design Missing" ngay.
 *   - Đơn ĐỒNG BỘ VỀ SAU                ⇒ tự nhận design đã có, không phải upload lại.
 * Đơn ĐÃ GỬI sản xuất không bị ảnh hưởng: file đã gửi được chụp lại ở
 * `fulfillment_order_items.print_files`.
 *
 * Nguyên tắc kỹ thuật giữ nguyên vì chúng đã đúng:
 *  - Mỗi (sản phẩm × vị trí in) độc lập: upload FRONT không đụng BACK.
 *  - Thay design ⇒ ghi đè bản ghi, tăng `version`, xoá file cũ khỏi kho để không tích rác.
 *  - Không tự ghi file: mọi thao tác lưu trữ đi qua `StorageService`.
 *  - Đẩy file lên kho TRƯỚC transaction (không giữ kết nối DB trong lúc chờ I/O mạng);
 *    ghi DB hỏng thì dọn file vừa lưu.
 */
@Injectable()
export class ProductDesignService {
  private readonly logger = new Logger(ProductDesignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly designMapper: ProductDesignMapper,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  /** Toàn bộ design đang hiệu lực của MỘT sản phẩm. */
  async findByProduct(
    organizationId: string,
    key: ProductDesignKey,
    scope: PodAccessScope,
  ): Promise<PodDesignDto[]> {
    await this.assertKeyInScope(organizationId, key, scope);
    const where = this.keyWhere(organizationId, key);

    const designs = await this.prisma.fulfillmentProductDesign.findMany({
      where,
      include: DESIGN_INCLUDE,
      orderBy: { placement: 'asc' },
    });
    return designs.map((design) => this.designMapper.toDto(design));
  }

  /**
   * Upload (hoặc **thay thế**) design tại một vị trí in.
   *
   * 🔴 KHÔNG kiểm tra Product Mapping. Sản phẩm chưa ánh xạ vẫn upload được — đó chính là
   * điều kiện mà sprint này gỡ bỏ.
   *
   * 🔴 Thay thế chỉ đụng ĐÚNG vị trí được gửi lên: replace FRONT thì BACK giữ nguyên, và
   * ngược lại. Không bao giờ bắt upload cả hai cùng lúc.
   */
  async upload(
    organizationId: string,
    actorUserId: string,
    key: ProductDesignKey,
    placement: PodDesignPlacement,
    file: Express.Multer.File | undefined,
    scope: PodAccessScope,
  ): Promise<PodDesignDto> {
    this.validateFormat(file);
    await this.assertKeyInScope(organizationId, key, scope);
    const saved = await this.store(organizationId, actorUserId, key, placement, file);

    this.logger.log({
      module: 'fulfillment',
      operation: 'product-design.upload',
      organizationId,
      productKey: mappingKeyOf(key.tiktokProductId, key.sellerSku),
      placement,
      version: saved.version,
      storageFileId: saved.storageFileId,
      msg: saved.version > 1 ? 'Đã thay design của sản phẩm' : 'Đã upload design cho sản phẩm',
    });

    return this.designMapper.toDto(saved);
  }

  /**
   * Xoá design tại MỘT vị trí in.
   *
   * 🔴 KHÔNG đụng tới Product Mapping và KHÔNG đụng tới đơn hàng — chỉ gỡ file in. Xoá xong
   * sản phẩm quay về trạng thái "thiếu design" và upload lại được (partial unique index bỏ
   * qua bản đã xoá mềm).
   */
  async remove(
    organizationId: string,
    actorUserId: string,
    key: ProductDesignKey,
    placement: PodDesignPlacement,
    scope: PodAccessScope,
  ): Promise<void> {
    await this.assertKeyInScope(organizationId, key, scope);
    const where = this.keyWhere(organizationId, key);

    // Gỡ liên kết TRƯỚC khi xoá file: khoá ngoại là `Restrict`.
    const removed = await this.prisma.$transaction(async (tx) => {
      const design = await tx.fulfillmentProductDesign.findFirst({
        where: { ...where, placement },
        select: { id: true, storageFileId: true },
      });
      if (!design) return null;

      await tx.fulfillmentProductDesign.update({
        where: { id: design.id },
        data: { deletedAt: new Date(), updatedBy: actorUserId },
      });
      return design;
    });

    if (!removed) throw new ProductDesignNotFoundException();
    const storageFileId = removed.storageFileId;

    // Design nguồn URL không có file trên kho của mình — chỉ xoá mềm bản ghi.
    if (storageFileId) {
      await this.storage.removeInternal(organizationId, actorUserId, storageFileId);
    }

    this.logger.log({
      module: 'fulfillment',
      operation: 'product-design.delete',
      organizationId,
      productKey: mappingKeyOf(key.tiktokProductId, key.sellerSku),
      placement,
      storageFileId,
      msg: 'Đã xoá design của sản phẩm',
    });
  }

  /**
   * Đặt (hoặc **thay thế**) design tại một vị trí in từ một **URL công khai**.
   *
   * ```
   *   URL người dùng nhập ─▶ kiểm hình thức ─▶ server TẢI VỀ (chống SSRF) ─▶ kiểm Content-Type +
   *   chữ ký file (PNG/JPEG/WEBP) ─▶ StorageService.upload (R2) ─▶ design trỏ tới file trên kho
   * ```
   *
   * 🔴 URL ngoài KHÔNG còn là URL chính thức của design. Link Drive / CDN có thể là trang HTML,
   * chuyển hướng, chặn hotlink hoặc hết hạn — Order List và nhà cung cấp chỉ thấy URL trên kho của
   * mình. Cùng đường lưu với upload file (`store`): cùng object key, cùng luật thay thế.
   *
   * Tải / kiểm / lưu hỏng ⇒ KHÔNG ghi gì vào design (design cũ giữ nguyên), lỗi trả rõ lý do:
   *   - 400 `FULFILLMENT_DESIGN_URL_INVALID` — URL sai hình thức / trỏ vào mạng nội bộ.
   *   - 422 `FULFILLMENT_DESIGN_URL_FETCH_FAILED` — tải không được / không phải ảnh / quá lớn.
   *   - lỗi của Storage Module nếu đẩy lên kho thất bại.
   *
   * Design cũ nguồn URL (trước thay đổi này, `source_url`) vẫn đọc được như trước — xem mapper.
   */
  async setUrl(
    organizationId: string,
    actorUserId: string,
    key: ProductDesignKey,
    placement: PodDesignPlacement,
    rawUrl: string,
    scope: PodAccessScope,
  ): Promise<PodDesignDto> {
    const url = assertPublicDownloadUrl(rawUrl);
    await this.assertKeyInScope(organizationId, key, scope);
    // Kiểm khoá TRƯỚC khi tải: không tốn băng thông cho một yêu cầu chắc chắn bị từ chối.
    this.keyWhere(organizationId, key);

    const startedAt = Date.now();
    const downloaded = await this.download(url);
    const saved = await this.store(organizationId, actorUserId, key, placement, downloaded.file);

    this.logger.log({
      module: 'fulfillment',
      operation: 'product-design.import-url',
      organizationId,
      productKey: mappingKeyOf(key.tiktokProductId, key.sellerSku),
      placement,
      version: saved.version,
      storageFileId: saved.storageFileId,
      // Chỉ host — URL đầy đủ có thể mang token chia sẻ.
      sourceHost: new URL(url).hostname,
      finalHost: new URL(downloaded.finalUrl).hostname,
      redirects: downloaded.redirects,
      mimeType: downloaded.file.mimetype,
      sizeBytes: downloaded.file.size,
      durationMs: Date.now() - startedAt,
      msg: 'Đã tải design từ URL và lưu lên kho lưu trữ',
    });

    return this.designMapper.toDto(saved);
  }

  // ---------------------------------------------------------------------------
  // Lưu design (dùng chung cho upload file và nhập từ URL)
  // ---------------------------------------------------------------------------

  /**
   * Đẩy file lên kho TRƯỚC (không giữ kết nối DB trong lúc chờ I/O mạng), rồi ghi/ghi đè design trong
   * transaction; ghi DB hỏng ⇒ dọn file vừa lưu. Ghi xong mới xoá file cũ — tránh mất file khi rollback.
   */
  private async store(
    organizationId: string,
    actorUserId: string,
    key: ProductDesignKey,
    placement: PodDesignPlacement,
    file: Express.Multer.File,
  ): Promise<ProductDesignWithFile> {
    const where = this.keyWhere(organizationId, key);
    const previous = await this.findActive(where, placement);

    const stored = await this.storage.upload(file, {
      organizationId,
      actorUserId,
      // `module` = POD_TIKTOK: file này là **design in của sản phẩm POD**. Độ chính xác nằm ở
      // `referenceType` — thêm một giá trị enum mới chỉ để đổi nhãn là một migration không
      // mua được gì.
      module: StorageModuleName.POD_TIKTOK,
      referenceType: StorageReferenceType.FULFILLMENT_MAPPING_DESIGN,
      // 🔴 `referenceId` phải NULL: cột này là UUID, mà khoá của design nay là một CẶP CHUỖI
      // (Product ID + Seller SKU). Nhét mapping id vào đây như trước sẽ dựng lại đúng ràng
      // buộc "phải ánh xạ xong mới upload được" — và với sản phẩm chưa ánh xạ thì không có
      // giá trị nào để nhét. Đường tra ngược từ file về sản phẩm nằm ở `folderSegments`
      // ngay dưới: object key chứa đủ cả hai nửa khoá.
      referenceId: null,
      folderSegments: [
        'fulfillment',
        'designs',
        organizationId,
        key.tiktokProductId,
        key.sellerSku,
      ],
    });

    let saved: ProductDesignWithFile;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        if (previous) {
          return tx.fulfillmentProductDesign.update({
            where: { id: previous.id },
            data: {
              storageFileId: stored.id,
              // Thay design nguồn URL bằng file ⇒ bỏ URL (CHECK: đúng MỘT nguồn).
              sourceUrl: null,
              version: previous.version + 1,
              updatedBy: actorUserId,
            },
            include: DESIGN_INCLUDE,
          });
        }
        return tx.fulfillmentProductDesign.create({
          data: {
            organizationId,
            tiktokProductId: where.tiktokProductId as string,
            sellerSku: where.sellerSku as string,
            placement,
            storageFileId: stored.id,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          },
          include: DESIGN_INCLUDE,
        });
      });
    } catch (error) {
      // Ghi DB hỏng ⇒ dọn file vừa lưu, không để lại rác trên kho lưu trữ.
      await this.storage.removeInternal(organizationId, actorUserId, stored.id);
      throw error;
    }

    if (previous?.storageFileId && previous.storageFileId !== stored.id) {
      await this.storage.removeInternal(organizationId, actorUserId, previous.storageFileId);
    }
    return saved;
  }

  /**
   * Tải design từ URL và dựng thành file Storage Module nhận được. Định dạng do CHỮ KÝ FILE quyết
   * định — không tin đuôi, không tin `Content-Type` (chỉ dùng để loại sớm HTML/JSON…).
   */
  private async download(url: string): Promise<{
    file: Express.Multer.File;
    finalUrl: string;
    redirects: number;
  }> {
    let remote: RemoteFile;
    try {
      remote = await fetchRemoteFile(toDirectDownloadUrl(url), {
        maxBytes: resolveStorageMaxBytes(),
        timeoutMs: POD_DESIGN_URL_FETCH_TIMEOUT_MS,
        maxRedirects: POD_DESIGN_URL_MAX_REDIRECTS,
      });
    } catch (error) {
      if (!(error instanceof RemoteFetchError)) throw error;
      if (URL_INVALID_REASONS.includes(error.reason)) {
        throw new BadRequestException({
          code: 'FULFILLMENT_DESIGN_URL_INVALID',
          message: error.message,
          details: { reason: error.reason },
        });
      }
      throw new DesignUrlFetchFailedException(
        error.reason,
        error.reason === 'HTTP_STATUS'
          ? `Không tải được design: ${error.message} Link có thể đã hết hạn, bị xoá hoặc không công khai.`
          : `Không tải được design: ${error.message}`,
        error.status,
      );
    }

    if (remote.contentType === 'text/html' || remote.contentType === 'application/xhtml+xml') {
      throw new DesignUrlFetchFailedException(
        'NOT_IMAGE',
        'URL trả về một TRANG WEB (HTML), không phải file ảnh. Hãy dùng link tải trực tiếp của ảnh; ' +
          'với Google Drive, bật chia sẻ "Bất kỳ ai có đường liên kết".',
      );
    }
    const mimeType = detectImageMime(remote.buffer);
    const declaredOk =
      remote.contentType.startsWith('image/') ||
      (POD_DESIGN_URL_GENERIC_CONTENT_TYPES as readonly string[]).includes(remote.contentType);
    if (
      !declaredOk ||
      !mimeType ||
      !(POD_DESIGN_MIME_TYPES as readonly string[]).includes(mimeType)
    ) {
      throw new DesignUrlFetchFailedException(
        'UNSUPPORTED_TYPE',
        `URL không trả về ảnh PNG, JPEG hoặc WEBP (máy chủ khai "${remote.contentType || 'không rõ'}").`,
      );
    }

    // Tên gốc chỉ để hiển thị; đuôi luôn theo định dạng THẬT để Storage Module đối chiếu mime ⇄ đuôi.
    const baseName =
      (remote.fileName ?? 'design').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 200) || 'design';
    return {
      file: {
        fieldname: 'file',
        originalname: `${baseName}.${IMAGE_MIME_EXTENSION[mimeType]}`,
        encoding: '7bit',
        mimetype: mimeType,
        size: remote.buffer.length,
        buffer: remote.buffer,
      } as Express.Multer.File,
      finalUrl: remote.finalUrl,
      redirects: remote.redirects,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Design đang hiệu lực tại một vị trí (kể cả nguồn URL). */
  private findActive(
    where: Prisma.FulfillmentProductDesignWhereInput,
    placement: PodDesignPlacement,
  ) {
    return this.prisma.fulfillmentProductDesign.findFirst({
      where: { ...where, placement },
      select: { id: true, storageFileId: true, version: true },
    });
  }

  /**
   * Cặp khoá (Product ID + Seller SKU) này có thuộc shop của người dùng không.
   *
   * 🔴 Design cố ý KHÔNG mang `shop_id`: một bộ design dùng chung cho MỌI đơn cùng cặp khoá,
   * kể cả khác shop — đó là quyết định của sprint "Refactor Design Storage" và không đổi ở
   * đây. Nhưng "dùng chung" không có nghĩa là "ai cũng sửa được": Seller chỉ được đụng vào
   * cặp khoá THẬT SỰ xuất hiện trong shop mình, dù là ở sản phẩm đã đồng bộ hay ở một đơn
   * hàng. Không có phép kiểm này thì `DELETE /product-designs/BACK?tiktokProductId=…` là một
   * đường xoá file in của shop người khác chỉ bằng cách đoán id.
   *
   * Hỏi hai bảng vì một cặp khoá có thể tới từ hai nguồn khác nhau — sản phẩm đồng bộ về
   * trước, hoặc đơn hàng về trước mà sản phẩm chưa kịp đồng bộ.
   */
  private async assertKeyInScope(
    organizationId: string,
    key: ProductDesignKey,
    scope: PodAccessScope,
  ): Promise<void> {
    if (scope.allShops) return;
    if (scope.shopIds.length === 0) throw new PodShopForbiddenException();

    const [fromProduct, fromOrder] = await Promise.all([
      this.prisma.podProduct.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          tiktokProductId: key.tiktokProductId,
          shopId: { in: scope.shopIds },
        },
        select: { id: true },
      }),
      this.prisma.podOrderItem.findFirst({
        where: {
          organizationId,
          // Cột trên `pod_order_items` tên là `product_id` (id sản phẩm phía TikTok) —
          // cùng một thứ với `tiktokProductId` của `pod_products`, khác tên bảng.
          productId: key.tiktokProductId,
          sellerSku: key.sellerSku,
          order: { organizationId, deletedAt: null, shopId: { in: scope.shopIds } },
        },
        select: { id: true },
      }),
    ]);
    if (!fromProduct && !fromOrder) throw new PodShopForbiddenException();
  }

  /**
   * Điều kiện WHERE theo cặp khoá, đã kiểm tenant (ADR-004) và kiểm khoá hợp lệ.
   *
   * Cắt khoảng trắng thừa cho khớp `mappingKeyOf` — dữ liệu nhập tay hay dính khoảng trắng,
   * và hai nơi chuẩn hoá khác nhau sẽ tạo ra hai bản ghi cho cùng một sản phẩm.
   */
  private keyWhere(
    organizationId: string,
    key: ProductDesignKey,
  ): Prisma.FulfillmentProductDesignWhereInput {
    const tiktokProductId = key.tiktokProductId?.trim();
    const sellerSku = key.sellerSku?.trim();
    if (!tiktokProductId || !sellerSku) throw new ProductDesignKeyInvalidException();

    return { organizationId, tiktokProductId, sellerSku, deletedAt: null };
  }

  /**
   * Design chỉ nhận ảnh PNG/JPEG/WEBP — hẹp hơn danh sách chung của Storage Module
   * (vốn còn nhận pdf/psd). Kiểm tra chung (rỗng, dung lượng, đuôi nguy hiểm) do
   * `StorageService` đảm nhiệm, không lặp lại ở đây.
   */
  private validateFormat(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException({
        code: 'POD_DESIGN_FILE_MISSING',
        message: 'Chưa chọn file design (field "file")',
      });
    }
    if (!(POD_DESIGN_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'POD_DESIGN_FORMAT_INVALID',
        message: 'Chỉ chấp nhận ảnh PNG, JPEG hoặc WEBP',
      });
    }
  }
}
