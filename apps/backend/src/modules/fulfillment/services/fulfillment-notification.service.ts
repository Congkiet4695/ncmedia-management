import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import { NotificationOutboxService } from '../../notification/services/notification-outbox.service';
import { groupOrderLines } from '../../notification/shared/order-items';
import type { NotificationOrderItem } from '../../notification/types/notification-payload.types';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { FULFILLMENT_PROVIDER_LABELS } from '../constants/fulfillment-provider.constants';
import {
  FulfillmentRepository,
  type FulfillmentOrderWithRelations,
} from '../repositories/fulfillment.repository';
import { productCostOf } from '../shared/product-cost';

/**
 * Trạng thái chứng tỏ nhà cung cấp ĐÃ TIẾP NHẬN đơn (fulfill thành công). DRAFT / SUBMITTING /
 * FAILED / REJECTED / UNKNOWN thì không — không bao giờ báo "thành công" cho những trạng thái đó.
 */
const ACCEPTED_BY_PROVIDER: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.IN_PRODUCTION,
  FulfillmentStatus.ON_HOLD,
  FulfillmentStatus.SHIPPED,
  FulfillmentStatus.DELIVERED,
];

/**
 * FulfillmentNotificationService — phát sự kiện thông báo SAU khi fulfill / huỷ đã thành công.
 *
 * Gọi từ `FulfillmentProviderGateway` sau khi adapter trả bản ghi — lúc đó trạng thái, mã đơn nhà
 * cung cấp và giá vốn ĐÃ được ghi xuống DB. Adapter ném lỗi (nhà cung cấp từ chối, lỗi mạng, ghi DB
 * lỗi) ⇒ không tới được đây ⇒ không có thông báo thành công.
 *
 * 🔴 KHÔNG BAO GIỜ ném lỗi: thông báo hỏng không được biến một lần fulfill thành công thành lỗi
 * trả về cho người dùng (họ sẽ bấm lại ⇒ nguy cơ sản xuất trùng).
 *
 * Idempotency: khoá sự kiện là `fulfillment_orders.id` — mỗi lần gửi (kể cả Fulfill lại sau huỷ, là
 * bản ghi mới) có đúng một thông báo; gọi lại với cùng bản ghi là no-op.
 */
@Injectable()
export class FulfillmentNotificationService {
  private readonly logger = new Logger(FulfillmentNotificationService.name);

  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly repo: FulfillmentRepository,
  ) {}

  async fulfilled(
    record: FulfillmentOrderWithRelations,
    actorUserId: string,
    trigger: FulfillmentTrigger,
  ): Promise<void> {
    if (!ACCEPTED_BY_PROVIDER.includes(record.status)) return;
    try {
      const order = await this.orderContext(record);
      if (!order) return;
      const cost = productCostOf(true, record.items);
      await this.outbox.publish({
        organizationId: record.organizationId,
        eventType: 'FULFILLMENT_SUBMITTED',
        entityType: 'FULFILLMENT_ORDER',
        entityId: record.id,
        actorUserId,
        payload: {
          ...order,
          provider: FULFILLMENT_PROVIDER_LABELS[record.provider],
          fulfilledBy: record.account?.name ?? null,
          providerOrderId: record.providerOrderId,
          externalOrderId: record.externalOrderId,
          // Chỉ báo giá vốn khi nhà cung cấp đã xác nhận — không đưa giá catalog tạm ra như giá thật.
          baseCost:
            cost.productCostConfirmed && cost.productCost !== null ? cost.productCost.toFixed(2) : null,
          baseCostConfirmed: cost.productCostConfirmed && cost.productCost !== null,
          currency: record.currency,
          trackingNumber: record.trackingNumber,
          productionLine: record.productionLine,
          shippingMethod: record.shippingMethod,
          fulfilledAt: (record.submittedAt ?? new Date()).toISOString(),
        },
      });
    } catch (error) {
      this.logFailure('FULFILLMENT_SUCCESS_NOTIFICATION', record, trigger, error);
    }
  }

  async cancelled(
    record: FulfillmentOrderWithRelations,
    actorUserId: string,
    reason: string | undefined,
  ): Promise<void> {
    // Chỉ khi nhà cung cấp ĐÃ XÁC NHẬN huỷ — "đã gửi yêu cầu, đang chờ" không phải huỷ thành công.
    if (record.status !== FulfillmentStatus.CANCELLED) return;
    try {
      const order = await this.orderContext(record);
      if (!order) return;
      const cancelledBy = await this.repo.findUserDisplayName(record.organizationId, actorUserId);
      await this.outbox.publish({
        organizationId: record.organizationId,
        eventType: 'FULFILLMENT_CANCELLED',
        entityType: 'FULFILLMENT_ORDER',
        entityId: record.id,
        actorUserId,
        payload: {
          ...order,
          provider: FULFILLMENT_PROVIDER_LABELS[record.provider],
          fulfilledBy: record.account?.name ?? null,
          providerOrderId: record.providerOrderId,
          externalOrderId: record.externalOrderId,
          cancelledAt: (record.cancelledAt ?? new Date()).toISOString(),
          reason: reason?.trim() || null,
          sellerName: order.sellerName,
          cancelledBy,
        },
      });
    } catch (error) {
      this.logFailure('FULFILLMENT_CANCEL_NOTIFICATION', record, FulfillmentTrigger.MANUAL, error);
    }
  }

  /**
   * Đơn TikTok của bản ghi — đọc theo (tổ chức, id) để không bao giờ lấy nhầm đơn tổ chức khác.
   * Chỉ liệt kê những dòng THỰC SỰ được gửi đi trong lần fulfill này.
   */
  private async orderContext(record: FulfillmentOrderWithRelations): Promise<{
    tiktokOrderId: string;
    accountName: string | null;
    sellerName: string | null;
    items: NotificationOrderItem[];
  } | null> {
    const order = await this.podOrderRepo.findById(record.organizationId, record.podOrderId);
    if (!order) return null;
    const sentLineIds = new Set(record.items.map((item) => item.podOrderItemId));
    const lines = order.items.filter((item) => sentLineIds.size === 0 || sentLineIds.has(item.id));
    return {
      tiktokOrderId: order.tiktokOrderId,
      accountName: order.account?.accountName ?? null,
      sellerName: order.account?.seller?.user?.fullName ?? null,
      items: groupOrderLines(lines),
    };
  }

  private logFailure(
    operation: string,
    record: FulfillmentOrderWithRelations,
    trigger: FulfillmentTrigger,
    error: unknown,
  ): void {
    this.logger.error({
      module: 'fulfillment',
      operation,
      organizationId: record.organizationId,
      podOrderId: record.podOrderId,
      fulfillmentOrderId: record.id,
      trigger,
      status: 'ENQUEUE_FAILED',
      error: (error as Error).message,
      msg: 'Không phát được thông báo fulfillment (đã bỏ qua — kết quả fulfill không bị ảnh hưởng)',
    });
  }
}
