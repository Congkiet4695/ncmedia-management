import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { TiktokEncryptionService } from '../services/tiktok-encryption.service';
import {
  TiktokOrder,
  TiktokOrderLineItem,
  TiktokRecipientAddress,
} from '../types/tiktok-order.types';

/** Dữ liệu order đã chuẩn hoá, sẵn sàng ghi DB. */
export interface MappedOrder {
  tiktokOrderId: string;
  tiktokUpdateTime: bigint;
  payloadHash: string;
  hasPodItem: boolean;
  recipientMasked: boolean;
  /** Trường ghi vào `pod_orders` (chưa gồm khoá ngoại và metadata sync). */
  data: Prisma.PodOrderUncheckedCreateInput;
  items: MappedOrderItem[];
  packageIds: string[];
}

export interface MappedOrderItem {
  tiktokLineItemId: string;
  payloadHash: string;
  data: Omit<Prisma.PodOrderItemUncheckedCreateInput, 'orderId' | 'organizationId'>;
}

/**
 * PodOrderMapper — Anti-Corruption Layer: TikTok DTO → entity nội bộ.
 *
 * Ba trách nhiệm:
 *  1. Ép kiểu an toàn (TikTok trả tiền dạng STRING, thời gian dạng Unix seconds).
 *  2. Tính `payload_hash` ổn định để phát hiện thay đổi thật sự.
 *  3. Bảo vệ PII: mã hoá `recipient_address`, nhận diện dữ liệu đã bị che.
 */
@Injectable()
export class PodOrderMapper {
  /**
   * Field bị LOẠI khỏi hash ở cấp Order.
   *
   * - `recipient_address`: thị trường US che dần dữ liệu theo thời gian (đơn `CANCELLED`,
   *   quá 30 ngày sau `COMPLETED`, đơn 4PL). Nếu để trong hash, mỗi đơn cũ sẽ đổi hash
   *   đúng một lần khi bị che ⇒ sinh UPDATE vô ích hàng loạt. Thay đổi địa chỉ thật được
   *   nhận biết qua `has_updated_recipient_address`.
   * - 🔴 `buyer_avatar`: URL CDN **có chữ ký, sinh lại ở MỖI lần gọi API**. Đo thực tế hai
   *   lần gọi cách nhau vài giây trên cùng một đơn: khác host (`p19`/`p16`), khác
   *   `refresh_token`, khác `x-signature` — trong khi ảnh không đổi. Để trong hash thì
   *   ~60% số đơn bị coi là "có thay đổi" ở MỌI lượt sync, ghi đè DB vô ích và làm
   *   `sync_version` phình vô hạn.
   */
  private static readonly ORDER_HASH_EXCLUDED_KEYS = new Set([
    'recipient_address',
    'buyer_avatar',
  ]);

  /** Dấu hiệu giá trị đã bị TikTok che (masked). */
  private static readonly MASK_PATTERN = /\*{2,}/;

  /**
   * 🔴 Tiền tố shard của CDN TikTok (`https://p16-...`, `https://p19-...`).
   *
   * Cùng một ảnh được trả về luân phiên qua nhiều shard giữa các lần gọi API, trong khi
   * đường dẫn và query hoàn toàn giống nhau. Chuẩn hoá shard TRƯỚC KHI hash để `sku_image`
   * đổi shard không bị hiểu nhầm là "ảnh sản phẩm đã đổi".
   *
   * Chỉ tác động tới việc HASH — giá trị lưu vào DB vẫn là URL nguyên bản TikTok trả về.
   */
  private static readonly CDN_SHARD_PATTERN = /^(https:\/\/)p\d+-/;

  constructor(private readonly encryption: TiktokEncryptionService) {}

  map(order: TiktokOrder): MappedOrder {
    const items = (order.line_items ?? []).map((item) => this.mapItem(item));
    const hasPodItem = items.some((item) => item.data.isPodCustomized === true);
    const recipient = order.recipient_address;
    const recipientMasked = this.isRecipientMasked(recipient);

    const createTime = this.toBigInt(order.create_time) ?? 0n;
    const updateTime = this.toBigInt(order.update_time) ?? createTime;

    const data = {
      tiktokOrderId: order.id,
      status: order.status,

      buyerUserId: order.user_id ?? null,
      buyerEmail: this.truncate(order.buyer_email, 255),
      buyerNickname: this.truncate(order.buyer_nickname, 255),
      buyerMessage: order.buyer_message ?? null,
      sellerNote: order.seller_note ?? null,

      cancellationInitiator: this.truncate(order.cancellation_initiator, 20),
      cancelReason: this.truncate(order.cancel_reason, 500),
      isBuyerRequestCancel: order.is_buyer_request_cancel ?? false,

      fulfillmentType: this.truncate(order.fulfillment_type, 40),
      deliveryType: this.truncate(order.delivery_type, 30),
      shippingType: this.truncate(order.shipping_type, 30),
      shippingProvider: this.truncate(order.shipping_provider, 255),
      shippingProviderId: this.truncate(order.shipping_provider_id, 64),
      trackingNumber: this.truncate(order.tracking_number, 255),
      splitOrCombineTag: this.truncate(order.split_or_combine_tag, 20),
      hasUpdatedRecipientAddress: order.has_updated_recipient_address ?? false,
      warehouseId: this.truncate(order.warehouse_id, 64),
      deliveryOptionId: this.truncate(order.delivery_option_id, 64),
      deliveryOptionName: this.truncate(order.delivery_option_name, 255),
      paymentMethodName: this.truncate(order.payment_method_name, 100),
      needUploadInvoice: this.truncate(order.need_upload_invoice, 30),
      isCod: order.is_cod ?? false,

      orderType: this.truncate(order.order_type, 30),
      handlingDurationDays: this.truncate(order.handling_duration?.days, 10),
      handlingDurationType: this.truncate(order.handling_duration?.type, 20),
      releaseDate: this.toBigInt(order.release_date),
      isOnHoldOrder: order.is_on_hold_order ?? false,
      isSampleOrder: order.is_sample_order ?? false,
      isReplacementOrder: order.is_replacement_order ?? false,
      replacedOrderId: this.truncate(order.replaced_order_id, 64),
      isExchangeOrder: order.is_exchange_order ?? false,
      exchangeSourceOrderId: this.truncate(order.exchange_source_order_id, 64),
      isSubscriptionOrder: order.is_subscription_order ?? false,
      commercePlatform: this.truncate(order.commerce_platform, 30),
      autoCombineGroupId: this.truncate(order.auto_combine_group_id, 64),
      fastDeliveryProgram: this.truncate(order.fast_delivery_program, 40),

      // payment{}
      currency: this.truncate(order.payment?.currency, 10),
      totalAmount: this.toDecimal(order.payment?.total_amount),
      subTotal: this.toDecimal(order.payment?.sub_total),
      shippingFee: this.toDecimal(order.payment?.shipping_fee),
      originalTotalProductPrice: this.toDecimal(order.payment?.original_total_product_price),
      originalShippingFee: this.toDecimal(order.payment?.original_shipping_fee),
      sellerDiscount: this.toDecimal(order.payment?.seller_discount),
      platformDiscount: this.toDecimal(order.payment?.platform_discount),
      paymentPlatformDiscount: this.toDecimal(order.payment?.payment_platform_discount),
      paymentDiscountServiceFee: this.toDecimal(order.payment?.payment_discount_service_fee),
      shippingFeeSellerDiscount: this.toDecimal(order.payment?.shipping_fee_seller_discount),
      shippingFeePlatformDiscount: this.toDecimal(order.payment?.shipping_fee_platform_discount),
      shippingFeeCofundedDiscount: this.toDecimal(order.payment?.shipping_fee_cofunded_discount),
      tax: this.toDecimal(order.payment?.tax),
      productTax: this.toDecimal(order.payment?.product_tax),
      shippingFeeTax: this.toDecimal(order.payment?.shipping_fee_tax),
      retailDeliveryFee: this.toDecimal(order.payment?.retail_delivery_fee),
      buyerServiceFee: this.toDecimal(order.payment?.buyer_service_fee),
      handlingFee: this.toDecimal(order.payment?.handling_fee),
      shippingInsuranceFee: this.toDecimal(order.payment?.shipping_insurance_fee),
      itemInsuranceFee: this.toDecimal(order.payment?.item_insurance_fee),
      itemInsuranceTax: this.toDecimal(order.payment?.item_insurance_tax),
      smallOrderFee: this.toDecimal(order.payment?.small_order_fee),

      // recipient_address{} — PII mã hoá; giữ riêng vùng/mã bưu chính để lọc.
      recipientEnc: recipient ? this.encryption.encrypt(JSON.stringify(recipient)) : null,
      recipientRegionCode: this.truncate(recipient?.region_code, 10),
      recipientPostalCode: this.truncate(recipient?.postal_code, 20),
      recipientMasked,

      // Mốc thời gian
      tiktokCreateTime: createTime,
      tiktokUpdateTime: updateTime,
      paidTime: this.toBigInt(order.paid_time),
      rtsTime: this.toBigInt(order.rts_time),
      cancelTime: this.toBigInt(order.cancel_time),
      deliveryTime: this.toBigInt(order.delivery_time),
      collectionTime: this.toBigInt(order.collection_time),
      requestCancelTime: this.toBigInt(order.request_cancel_time),
      rtsSlaTime: this.toBigInt(order.rts_sla_time),
      ttsSlaTime: this.toBigInt(order.tts_sla_time),
      deliverySlaTime: this.toBigInt(order.delivery_sla_time),
      cancelOrderSlaTime: this.toBigInt(order.cancel_order_sla_time),
      shippingDueTime: this.toBigInt(order.shipping_due_time),
      collectionDueTime: this.toBigInt(order.collection_due_time),
      deliveryDueTime: this.toBigInt(order.delivery_due_time),

      orderedAt: this.unixToDate(createTime),
      tiktokUpdatedAt: this.unixToDate(updateTime),

      hasPodItem,
      rawPayload: order as unknown as Prisma.InputJsonValue,
    } as Prisma.PodOrderUncheckedCreateInput;

    return {
      tiktokOrderId: order.id,
      tiktokUpdateTime: updateTime,
      payloadHash: this.hashOrder(order),
      hasPodItem,
      recipientMasked,
      data,
      items,
      packageIds: (order.packages ?? []).map((pkg) => pkg.id).filter(Boolean),
    };
  }

  /**
   * Hash canonical của Order — dùng để phát hiện thay đổi NỘI DUNG.
   * Sắp xếp key đệ quy nên cùng dữ liệu luôn cho cùng hash bất kể thứ tự TikTok trả về.
   */
  hashOrder(order: TiktokOrder): string {
    return this.sha256(
      this.canonicalize(order, PodOrderMapper.ORDER_HASH_EXCLUDED_KEYS),
    );
  }

  hashItem(item: TiktokOrderLineItem): string {
    return this.sha256(this.canonicalize(item));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private mapItem(item: TiktokOrderLineItem): MappedOrderItem {
    return {
      tiktokLineItemId: item.id,
      payloadHash: this.hashItem(item),
      data: {
        tiktokLineItemId: item.id,
        productId: this.truncate(item.product_id, 64),
        productName: this.truncate(item.product_name, 1024),
        skuId: this.truncate(item.sku_id, 64),
        skuName: this.truncate(item.sku_name, 512),
        sellerSku: this.truncate(item.seller_sku, 255),
        skuImage: this.truncate(item.sku_image, 2048),

        salePrice: this.toDecimal(item.sale_price),
        originalPrice: this.toDecimal(item.original_price),
        platformDiscount: this.toDecimal(item.platform_discount),
        sellerDiscount: this.toDecimal(item.seller_discount),
        currency: this.truncate(item.currency, 10),

        displayStatus: this.truncate(item.display_status, 40),
        packageStatus: this.truncate(item.package_status, 40),
        packageId: this.truncate(item.package_id, 64),
        trackingNumber: this.truncate(item.tracking_number, 255),
        shippingProviderId: this.truncate(item.shipping_provider_id, 64),
        shippingProviderName: this.truncate(item.shipping_provider_name, 255),
        warehouseId: this.truncate(item.warehouse_id, 64),

        cancelReason: this.truncate(item.cancel_reason, 500),
        cancelUser: this.truncate(item.cancel_user, 20),
        rtsTime: this.toBigInt(item.rts_time),

        isGift: item.is_gift ?? false,
        isDangerousGood: item.is_dangerous_good ?? false,
        needsPrescription: item.needs_prescription ?? false,
        isPodCustomized: item.is_pod_customized ?? false,
        podInfoId: this.truncate(item.pod_info_id, 64),

        skuType: this.truncate(item.sku_type, 40),
        productListingType: this.truncate(item.product_listing_type, 40),
        roomId: this.truncate(item.room_id, 64),

        retailDeliveryFee: this.toDecimal(item.retail_delivery_fee),
        buyerServiceFee: this.toDecimal(item.buyer_service_fee),
        smallOrderFee: this.toDecimal(item.small_order_fee),
        pfandFee: this.toDecimal(item.pfand_fee),
        giftRetailPrice: this.toDecimal(item.gift_retail_price),

        isUnboxingItem: item.is_unboxing_item ?? false,
        unboxingSkuCode: this.truncate(item.unboxing_sku_code, 64),

        itemTax: this.toJson(item.item_tax),
        subItemInfo: this.toJson(item.sub_item_info),
        combinedListingSkus: this.toJson(item.combined_listing_skus),
        unboxingCaseList: this.toJson(item.unboxing_case_list),

        payloadHash: this.hashItem(item),
      },
    };
  }

  /**
   * Nhận diện `recipient_address` đã bị TikTok che.
   * Coi là đã che khi các field định danh đều trống, hoặc chứa chuỗi dấu `*`.
   */
  private isRecipientMasked(recipient?: TiktokRecipientAddress): boolean {
    if (!recipient) return false;
    const identityFields = [
      recipient.name,
      recipient.phone_number,
      recipient.address_detail,
      recipient.address_line1,
      recipient.full_address,
    ];
    const present = identityFields.filter((v) => typeof v === 'string' && v.trim().length > 0);
    if (present.length === 0) return true;
    return present.some((v) => PodOrderMapper.MASK_PATTERN.test(v as string));
  }

  /** Chuỗi JSON đã sắp xếp key đệ quy — nền tảng của hash ổn định. */
  private canonicalize(value: unknown, excludedKeys?: Set<string>): string {
    return JSON.stringify(this.sortDeep(value, excludedKeys));
  }

  /**
   * Chuẩn hoá để so sánh NỘI DUNG: sắp xếp key theo alphabet và sắp xếp cả PHẦN TỬ MẢNG.
   *
   * 🔴 Sắp xếp phần tử mảng là bắt buộc: TikTok KHÔNG bảo đảm thứ tự `line_items[]`/
   * `packages[]` giữa hai lần gọi. Giữ nguyên thứ tự thì chỉ cần đảo chỗ hai sản phẩm là
   * hash đổi ⇒ đơn bị coi là "có thay đổi" và ghi đè DB vô ích.
   * Ở đây thứ tự mảng không mang ý nghĩa nghiệp vụ (dữ liệu thật vẫn map theo
   * `tiktokLineItemId`), nên sắp xếp là an toàn.
   */
  private sortDeep(value: unknown, excludedKeys?: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value
        .map((v) => this.sortDeep(v, excludedKeys))
        .sort((a, b) => {
          const left = JSON.stringify(a) ?? '';
          const right = JSON.stringify(b) ?? '';
          return left < right ? -1 : left > right ? 1 : 0;
        });
    }
    if (typeof value === 'string') {
      return value.replace(PodOrderMapper.CDN_SHARD_PATTERN, '$1p-');
    }
    if (value === null || typeof value !== 'object') return value;

    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .filter((key) => !excludedKeys?.has(key))
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        // Loại field undefined để hash không đổi chỉ vì TikTok bỏ trống field.
        if (source[key] !== undefined) acc[key] = this.sortDeep(source[key], excludedKeys);
        return acc;
      }, {});
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /** Tiền: TikTok trả STRING. Chuỗi rỗng/không hợp lệ → null (không ép về 0). */
  private toDecimal(value?: string | null): Prisma.Decimal | null {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return new Prisma.Decimal(value);
  }

  private toBigInt(value?: number | null): bigint | null {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return BigInt(Math.trunc(num));
  }

  private unixToDate(seconds: bigint): Date {
    return new Date(Number(seconds) * 1000);
  }

  private truncate(value: string | undefined | null, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    return value.length > max ? value.slice(0, max) : value;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return value;
  }
}
