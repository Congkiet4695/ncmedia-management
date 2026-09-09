import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PodFlashSaleItemStatus, PodFlashSaleProductLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  FLASH_SALE_DEFAULT_DISCOUNT_PERCENT,
  FLASH_SALE_MAX_ITEMS,
  FLASH_SALE_UNLIMITED,
} from '../constants/pod-flash-sale.constants';
import type {
  AddFlashSaleItemDto,
  BatchUpdateFlashSaleItemsDto,
  UpdateFlashSaleItemDto,
} from '../dto/pod-flash-sale.dto';
import {
  PodFlashSaleItemNotFoundException,
  PodFlashSaleTooManyItemsException,
} from '../exceptions/pod-flash-sale.exceptions';
import type { FlashSaleDetailRow } from '../mappers/pod-flash-sale.mapper';
import {
  computeFlashSalePricing,
  toDecimal,
  validatePricing,
  validateQuantityLimit,
  type FlashSalePricing,
} from './pod-flash-sale-pricing';
import { PodFlashSaleService } from './pod-flash-sale.service';

/** Sản phẩm + biến thể đã nạp đủ để dựng một dòng. */
type ProductWithVariants = Prisma.PodProductGetPayload<{
  select: {
    id: true;
    shopId: true;
    title: true;
    tiktokProductId: true;
    currency: true;
    minPrice: true;
    status: true;
    variants: {
      select: {
        id: true;
        tiktokSkuId: true;
        sellerSku: true;
        variantName: true;
        salePrice: true;
        listPrice: true;
        currency: true;
        status: true;
      };
    };
  };
}>;

/** Không dựng được dòng vì sản phẩm thiếu dữ liệu bắt buộc. */
class PodFlashSaleItemNotResolvableException extends BadRequestException {
  constructor(reasons: string[]) {
    super({
      code: 'POD_FLASH_SALE_ITEM_NOT_RESOLVABLE',
      message: 'Không thêm được một số sản phẩm vào Flash Sale.',
      details: reasons,
    });
  }
}

/**
 * PodFlashSaleItemService — thêm, sửa, sửa hàng loạt và xoá các dòng của một đợt sale.
 *
 * 🔴 **Giá LUÔN được tính lại ở server.** Client gửi lên `discountPercent` hoặc
 * `flashSalePrice`; cả `flashSalePrice`, `discountPercent` lẫn `originalPrice` trong
 * database đều do server quyết. Tin con số client gửi nghĩa là một request thủ công có thể
 * đặt giá bán bất kỳ trên shop thật.
 *
 * 🔴 Trạng thái dòng phản ánh ĐÚNG kết quả kiểm tra ngay khi ghi: hợp lệ ⇒ `READY`, chưa
 * hợp lệ ⇒ `PENDING`. Nhờ vậy màn hình biết ngay dòng nào còn thiếu mà không phải chạy lại
 * cả bộ validator cho từng lần vẽ.
 */
@Injectable()
export class PodFlashSaleItemService {
  private readonly logger = new Logger(PodFlashSaleItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSales: PodFlashSaleService,
  ) {}

  /**
   * Thêm sản phẩm vào đợt sale (dialog "Add Products").
   *
   * Ở mức `VARIATION`, một mục KHÔNG kèm `variantId` được BUNG ra thành mọi biến thể của
   * sản phẩm — đúng thao tác người dùng mong đợi khi tick ô ở cấp sản phẩm.
   *
   * Thêm lại một dòng đã có là thao tác RỖNG (không lỗi, không nhân đôi): người dùng mở
   * dialog lần hai và tick lại cả nhóm là chuyện bình thường.
   */
  async addItems(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    dtoItems: AddFlashSaleItemDto[],
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    this.flashSales.assertEditable(flashSale.status, 'thêm sản phẩm');

    const products = await this.loadProducts(
      organizationId,
      flashSale.shopId,
      dtoItems.map((item) => item.productId),
    );

    // Khoá nhận diện một dòng: `productId` ở mức sản phẩm, `variantId` ở mức biến thể.
    const existing = new Set(
      flashSale.items.map((item) => this.itemKey(item.productId, item.variantId)),
    );

    const rows: Prisma.PodFlashSaleItemCreateManyInput[] = [];
    const problems: string[] = [];
    let sortOrder = flashSale.items.length;

    for (const dto of dtoItems) {
      const product = products.get(dto.productId);
      if (!product) {
        problems.push(`Sản phẩm ${dto.productId} không thuộc shop của Flash Sale này.`);
        continue;
      }

      for (const target of this.expandTargets(flashSale.productLevel, product, dto.variantId)) {
        const key = this.itemKey(product.id, target.variantId);
        if (existing.has(key)) continue;

        const originalPrice = toDecimal(target.originalPrice);
        if (!originalPrice || originalPrice.lessThanOrEqualTo(0)) {
          // Không có giá gốc thì không có gì để giảm. Xảy ra với sản phẩm chưa đồng bộ đủ
          // hoặc SKU đã ngừng bán — báo tên cụ thể để người dùng biết phải xử lý cái nào.
          problems.push(
            `"${product.title ?? product.id}"${target.variantName ? ` (${target.variantName})` : ''}` +
              ' chưa có giá bán — hãy đồng bộ lại sản phẩm trước khi thêm vào Flash Sale.',
          );
          continue;
        }

        // 🔴 Không nhập giá lẫn % ⇒ áp % giảm MẶC ĐỊNH, KHÔNG phải 0%.
        //
        // Mặc định 0% cũ tạo ra một dòng hợp lệ với database nhưng không publish được, nên
        // thêm 600 SKU là sinh 600 lỗi giống hệt nhau và người dùng phải sửa tay từng dòng.
        //
        // 🔴 Tính từ `originalPrice` của CHÍNH dòng này — biến `originalPrice` nằm trong
        // vòng lặp theo từng biến thể, nên mỗi SKU nhận giá deal riêng. Không có chuyện lấy
        // giá của SKU rẻ nhất áp cho cả sản phẩm.
        const pricing =
          computeFlashSalePricing({
            originalPrice,
            flashSalePrice: dto.flashSalePrice ?? null,
            discountPercent: dto.discountPercent ?? FLASH_SALE_DEFAULT_DISCOUNT_PERCENT,
          }) ??
          // Chỉ tới được đây khi giá gốc không dùng được để tính (≤ 0) — dòng vẫn được thêm
          // nhưng nằm ở `PENDING` cho tới khi người dùng nhập giá.
          ({ originalPrice, flashSalePrice: originalPrice, discountPercent: toDecimal(0)! } satisfies FlashSalePricing);

        const totalPurchaseLimit = dto.totalPurchaseLimit ?? FLASH_SALE_UNLIMITED;
        const customerPurchaseLimit = dto.customerPurchaseLimit ?? FLASH_SALE_UNLIMITED;

        rows.push({
          organizationId,
          flashSaleId,
          productId: product.id,
          variantId: target.variantId,
          skuId: target.sellerSku,
          originalPrice: pricing.originalPrice,
          flashSalePrice: pricing.flashSalePrice,
          discountPercent: pricing.discountPercent,
          currency: target.currency ?? product.currency,
          totalPurchaseLimit,
          customerPurchaseLimit,
          providerProductId: product.tiktokProductId,
          providerVariantId: target.tiktokSkuId,
          status: this.resolveItemStatus(pricing, totalPurchaseLimit, customerPurchaseLimit),
          sortOrder: sortOrder++,
        });
        existing.add(key);
      }
    }

    if (rows.length === 0 && problems.length > 0) throw new PodFlashSaleItemNotResolvableException(problems);

    const total = flashSale.items.filter((item) => item.status !== PodFlashSaleItemStatus.REMOVED).length + rows.length;
    if (total > FLASH_SALE_MAX_ITEMS) throw new PodFlashSaleTooManyItemsException(FLASH_SALE_MAX_ITEMS);

    if (rows.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.podFlashSaleItem.createMany({ data: rows });
        await this.flashSales.refreshItemCount(flashSaleId, tx);
        await tx.podFlashSale.update({ where: { id: flashSaleId }, data: { updatedBy: userId } });
      });
    }

    if (problems.length > 0) {
      this.logger.warn({
        module: 'pod-flash-sale',
        operation: 'item.add',
        organizationId,
        flashSaleId,
        skipped: problems.length,
        msg: 'Một số sản phẩm không thêm được vào Flash Sale',
      });
    }

    return this.flashSales.get(organizationId, flashSaleId, scope);
  }

  /** Sửa MỘT dòng. */
  async updateItem(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    itemId: string,
    dto: UpdateFlashSaleItemDto,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    this.flashSales.assertEditable(flashSale.status, 'sửa sản phẩm');

    const item = flashSale.items.find((row) => row.id === itemId);
    if (!item) throw new PodFlashSaleItemNotFoundException();

    const pricing =
      dto.flashSalePrice === undefined && dto.discountPercent === undefined
        ? { originalPrice: item.originalPrice, flashSalePrice: item.flashSalePrice, discountPercent: item.discountPercent }
        : computeFlashSalePricing({
            originalPrice: item.originalPrice,
            flashSalePrice: dto.flashSalePrice ?? null,
            discountPercent: dto.discountPercent ?? null,
          });

    if (!pricing) {
      throw new PodFlashSaleItemNotResolvableException([
        'Giá Flash Sale hoặc % giảm không phải một số hợp lệ.',
      ]);
    }

    const totalPurchaseLimit = dto.totalPurchaseLimit ?? item.totalPurchaseLimit;
    const customerPurchaseLimit = dto.customerPurchaseLimit ?? item.customerPurchaseLimit;

    await this.prisma.$transaction(async (tx) => {
      await tx.podFlashSaleItem.update({
        where: { id: itemId },
        data: {
          flashSalePrice: pricing.flashSalePrice,
          discountPercent: pricing.discountPercent,
          totalPurchaseLimit,
          customerPurchaseLimit,
          status: this.resolveItemStatus(pricing, totalPurchaseLimit, customerPurchaseLimit),
          // Sửa xong là lỗi cũ hết ý nghĩa — giữ lại chỉ khiến người dùng tưởng vẫn đang hỏng.
          errorCode: null,
          error: null,
        },
      });
      await tx.podFlashSale.update({ where: { id: flashSaleId }, data: { updatedBy: userId } });
    });

    return this.flashSales.get(organizationId, flashSaleId, scope);
  }

  /**
   * Batch Action — áp một thay đổi cho MỌI dòng được chọn.
   *
   * 🔴 `discountPercent` được áp trên giá gốc RIÊNG của từng dòng, không phải trên một con
   * số chung. Đây chính là khác biệt giữa "giảm 30% cho 50 sản phẩm" (mỗi sản phẩm một giá
   * deal khác nhau) và "đặt tất cả về 20.99" — hai thao tác khác hẳn nhau, và gộp chúng lại
   * là cách nhanh nhất để bán lỗ một nửa danh mục.
   */
  async batchUpdate(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    dto: BatchUpdateFlashSaleItemsDto,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    this.flashSales.assertEditable(flashSale.status, 'sửa hàng loạt');

    const selected = new Set(dto.itemIds);
    const targets = flashSale.items.filter((item) => selected.has(item.id));
    if (targets.length === 0) throw new PodFlashSaleItemNotFoundException();

    const updates = targets.map((item) => {
      const pricing =
        dto.flashSalePrice === undefined && dto.discountPercent === undefined
          ? { originalPrice: item.originalPrice, flashSalePrice: item.flashSalePrice, discountPercent: item.discountPercent }
          : computeFlashSalePricing({
              originalPrice: item.originalPrice,
              flashSalePrice: dto.flashSalePrice ?? null,
              discountPercent: dto.discountPercent ?? null,
            });

      const totalPurchaseLimit = dto.totalPurchaseLimit ?? item.totalPurchaseLimit;
      const customerPurchaseLimit = dto.customerPurchaseLimit ?? item.customerPurchaseLimit;

      return { item, pricing, totalPurchaseLimit, customerPurchaseLimit };
    });

    if (updates.some((update) => update.pricing === null)) {
      throw new PodFlashSaleItemNotResolvableException([
        'Giá Flash Sale hoặc % giảm không phải một số hợp lệ.',
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      // Mỗi dòng một giá deal khác nhau ⇒ không gộp được thành một `updateMany`. Cả lô nằm
      // trong MỘT transaction để không bao giờ có trạng thái "một nửa đã giảm giá".
      for (const update of updates) {
        const pricing = update.pricing as FlashSalePricing;
        await tx.podFlashSaleItem.update({
          where: { id: update.item.id },
          data: {
            flashSalePrice: pricing.flashSalePrice,
            discountPercent: pricing.discountPercent,
            totalPurchaseLimit: update.totalPurchaseLimit,
            customerPurchaseLimit: update.customerPurchaseLimit,
            status: this.resolveItemStatus(
              pricing,
              update.totalPurchaseLimit,
              update.customerPurchaseLimit,
            ),
            errorCode: null,
            error: null,
          },
        });
      }
      await tx.podFlashSale.update({ where: { id: flashSaleId }, data: { updatedBy: userId } });
    });

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'item.batchUpdate',
      organizationId,
      flashSaleId,
      items: updates.length,
      msg: 'Đã áp thay đổi hàng loạt cho các dòng được chọn',
    });
    return this.flashSales.get(organizationId, flashSaleId, scope);
  }

  /** Xoá dòng (một hoặc nhiều). Xoá CỨNG — dòng chưa lên sàn không có gì phải giữ lại. */
  async deleteItems(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    itemIds: string[],
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    this.flashSales.assertEditable(flashSale.status, 'xoá sản phẩm');

    // Chỉ xoá những id THỰC SỰ thuộc đợt này — id lạ bị bỏ qua, không xoá nhầm dòng của
    // đợt khác chỉ vì client gửi sai.
    const owned = flashSale.items.filter((item) => itemIds.includes(item.id)).map((item) => item.id);
    if (owned.length === 0) throw new PodFlashSaleItemNotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await tx.podFlashSaleItem.deleteMany({ where: { id: { in: owned }, flashSaleId } });
      await this.flashSales.refreshItemCount(flashSaleId, tx);
      await tx.podFlashSale.update({ where: { id: flashSaleId }, data: { updatedBy: userId } });
    });

    return this.flashSales.get(organizationId, flashSaleId, scope);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Khoá nhận diện một dòng — dùng chung cho phép chống trùng ở cả hai mức. */
  private itemKey(productId: string, variantId: string | null): string {
    return `${productId}::${variantId ?? 'PRODUCT'}`;
  }

  /**
   * Một mục người dùng chọn ⇒ danh sách dòng thực sự được tạo.
   *
   * - Mức PRODUCT: luôn đúng MỘT dòng, giá gốc lấy từ `minPrice` của sản phẩm (giá thấp
   *   nhất trong các SKU — giảm giá theo SPU mà lấy giá cao nhất sẽ cho ra deal cao hơn giá
   *   thật của một số SKU).
   * - Mức VARIATION: chọn một biến thể ⇒ một dòng; không chọn ⇒ mọi biến thể của sản phẩm.
   */
  private expandTargets(
    productLevel: PodFlashSaleProductLevel,
    product: ProductWithVariants,
    variantId?: string,
  ): Array<{
    variantId: string | null;
    tiktokSkuId: string | null;
    sellerSku: string | null;
    variantName: string | null;
    originalPrice: Prisma.Decimal | null;
    currency: string | null;
  }> {
    if (productLevel === PodFlashSaleProductLevel.PRODUCT) {
      return [
        {
          variantId: null,
          tiktokSkuId: null,
          sellerSku: null,
          variantName: null,
          originalPrice: product.minPrice,
          currency: product.currency,
        },
      ];
    }

    const variants = variantId
      ? product.variants.filter((variant) => variant.id === variantId)
      : product.variants;

    return variants.map((variant) => ({
      variantId: variant.id,
      tiktokSkuId: variant.tiktokSkuId,
      sellerSku: variant.sellerSku,
      variantName: variant.variantName,
      // `salePrice` là giá ĐANG BÁN; `listPrice` chỉ là giá gạch ngang. Lấy giá đang bán làm
      // gốc để % giảm hiển thị đúng với thứ người mua thấy hôm nay.
      originalPrice: variant.salePrice ?? variant.listPrice,
      currency: variant.currency,
    }));
  }

  /** Nạp sản phẩm + biến thể, ĐÃ giới hạn theo shop của đợt sale. */
  private async loadProducts(
    organizationId: string,
    shopId: string,
    productIds: string[],
  ): Promise<Map<string, ProductWithVariants>> {
    const products = await this.prisma.podProduct.findMany({
      where: { id: { in: [...new Set(productIds)] }, organizationId, shopId, deletedAt: null },
      select: {
        id: true,
        shopId: true,
        title: true,
        tiktokProductId: true,
        currency: true,
        minPrice: true,
        status: true,
        variants: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            tiktokSkuId: true,
            sellerSku: true,
            variantName: true,
            salePrice: true,
            listPrice: true,
            currency: true,
            status: true,
          },
        },
      },
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  /**
   * Trạng thái của một dòng ngay khi ghi.
   *
   * Dùng đúng bộ luật của validator (`validatePricing` + `validateQuantityLimit`) chứ không
   * viết lại một phiên bản rút gọn — hai bộ luật song song là hai bộ luật sẽ lệch nhau.
   */
  private resolveItemStatus(
    pricing: FlashSalePricing,
    totalPurchaseLimit: number,
    customerPurchaseLimit: number,
  ): PodFlashSaleItemStatus {
    const issues = [
      ...validatePricing(pricing),
      ...validateQuantityLimit(totalPurchaseLimit, 'totalPurchaseLimit'),
      ...validateQuantityLimit(customerPurchaseLimit, 'customerPurchaseLimit'),
    ];
    return issues.some((issue) => issue.level === 'ERROR')
      ? PodFlashSaleItemStatus.PENDING
      : PodFlashSaleItemStatus.READY;
  }
}
