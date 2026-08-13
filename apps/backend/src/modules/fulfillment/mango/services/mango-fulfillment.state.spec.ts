import { ConfigService } from '@nestjs/config';
import { callArg, callArgs } from '../../../../testing/mock-call.util';
import { FulfillmentStatus, FulfillmentTrigger, type FulfillmentOrder } from '@prisma/client';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoOrderMapper } from '../mappers/mango-order.mapper';
import { MangoFulfillmentService } from './mango-fulfillment.service';
import { MangoCredentialService } from './mango-credential.service';
import type { MangoOrderStatus } from '../constants/mango.constants';
import type { MangoOrderResponse } from '../types/mango-api.types';

/**
 * Kiểm tra riêng phần ÁP TRẠNG THÁI (`applyProviderState`) — đường đi chung của cả
 * scheduler lẫn webhook. Chỉ giả lập những phụ thuộc mà nhánh này thực sự chạm tới.
 */
function buildService() {
  const updateOrder = jest.fn().mockResolvedValue(undefined);
  const addHistory = jest.fn().mockResolvedValue(undefined);

  const repo = { updateOrder, addHistory } as unknown as FulfillmentRepository;
  const mapper = new MangoOrderMapper();

  const service = new MangoFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    {} as unknown as PodOrderRepository,
    {} as unknown as FulfillmentReadinessService,
    {} as unknown as MangoApiClient,
    mapper,
    {} as unknown as MangoCredentialService,
  );

  return { service, updateOrder, addHistory };
}

function record(over: Partial<FulfillmentOrder> = {}): FulfillmentOrder {
  return {
    id: 'ff-1',
    organizationId: 'org-1',
    status: FulfillmentStatus.IN_PRODUCTION,
    providerStatus: 'in_production',
    trackingNumber: null,
    trackingUrl: null,
    carrier: null,
    labelUrl: null,
    providerFulfillId: null,
    productionLine: null,
    cancelledAt: null,
    completedAt: null,
    ...over,
  } as unknown as FulfillmentOrder;
}

/**
 * Payload tối thiểu của Get Order Detail.
 *
 * ⚠️ `status` chỉ nhận giá trị CÓ TRONG tài liệu Mango (`MANGO_ORDER_STATUSES`). Tài liệu
 * KHÔNG có trạng thái `delivered` ở cấp đơn — "đã giao" được suy ra từ `status = shipped`
 * cộng `tracking_status = delivered`, nên các case bên dưới dựng đúng như vậy.
 */
function detail(status: MangoOrderStatus, over: Partial<MangoOrderResponse> = {}): MangoOrderResponse {
  return { status, ...over };
}

/** Đơn đã giao theo đúng cách Mango biểu diễn: shipped + tracking_status delivered. */
function deliveredDetail(): MangoOrderResponse {
  return detail('shipped', {
    tracking_number: 'TRK-DONE',
    tracking_status: 'delivered',
    shipments: [{ tracking_number: 'TRK-DONE', tracking_status: 'delivered' }],
  });
}

describe('MangoFulfillmentService.applyProviderState — mốc hoàn tất', () => {
  it('ghi completedAt khi đơn chuyển sang DELIVERED', async () => {
    const { service, updateOrder } = buildService();

    await service.applyProviderState(record(), deliveredDetail(), FulfillmentTrigger.CRON);

    const patch = callArg<{ status: string; completedAt?: Date }>(updateOrder, 0, 1);
    expect(patch.status).toBe(FulfillmentStatus.DELIVERED);
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it('KHÔNG ghi đè completedAt đã có', async () => {
    // Trạng thái có thể dao động quanh DELIVERED (webhook tới sau lượt đồng bộ).
    // Ghi đè sẽ làm sai mốc đối soát.
    const { service, updateOrder } = buildService();
    const alreadyCompleted = record({
      status: FulfillmentStatus.DELIVERED,
      providerStatus: 'shipped',
      trackingNumber: 'TRK-DONE',
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.applyProviderState(alreadyCompleted, deliveredDetail(), FulfillmentTrigger.CRON);

    const patch = callArg<{ completedAt?: Date }>(updateOrder, 0, 1);
    expect(patch.completedAt).toBeUndefined();
  });

  it('KHÔNG ghi completedAt cho trạng thái chưa hoàn tất', async () => {
    const { service, updateOrder } = buildService();

    await service.applyProviderState(record(), detail('shipped'), FulfillmentTrigger.CRON);

    const patch = callArg<{ status: string; completedAt?: Date }>(updateOrder, 0, 1);
    expect(patch.status).toBe(FulfillmentStatus.SHIPPED);
    expect(patch.completedAt).toBeUndefined();
  });

  it('ghi cancelledAt khi đơn bị huỷ, và không nhầm sang completedAt', async () => {
    const { service, updateOrder } = buildService();

    await service.applyProviderState(record(), detail('cancelled'), FulfillmentTrigger.CRON);

    const patch = callArg<{ cancelledAt?: Date; completedAt?: Date }>(updateOrder, 0, 1);
    expect(patch.cancelledAt).toBeInstanceOf(Date);
    expect(patch.completedAt).toBeUndefined();
  });

  it('cập nhật tracking và ghi nhật ký khi có mã vận đơn mới', async () => {
    const { service, addHistory } = buildService();

    const changed = await service.applyProviderState(
      record(),
      detail('shipped', { tracking_number: 'TRK-1', shipments: [{ tracking_number: 'TRK-1' }] }),
      FulfillmentTrigger.CRON,
    );

    expect(changed).toBe(true);
    const events = callArgs<{ eventType: string }>(addHistory, 0).map((entry) => entry.eventType);
    expect(events).toContain('SHIPMENT_UPDATED');
  });

  it('payload rỗng thì không đổi gì (webhook thiếu dữ liệu không được xoá trạng thái)', async () => {
    const { service, updateOrder } = buildService();

    const changed = await service.applyProviderState(record(), null, FulfillmentTrigger.WEBHOOK);

    expect(changed).toBe(false);
    expect(updateOrder).not.toHaveBeenCalled();
  });
});
