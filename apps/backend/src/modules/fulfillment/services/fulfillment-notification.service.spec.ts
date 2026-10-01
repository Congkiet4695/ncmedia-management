import { FulfillmentStatus, FulfillmentTrigger, Prisma } from '@prisma/client';
import { NotificationOutboxService } from '../../notification/services/notification-outbox.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import type {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../repositories/fulfillment.repository';
import { FulfillmentNotificationService } from './fulfillment-notification.service';

const ORG = 'org-a';

function record(overrides: Partial<FulfillmentOrderWithRelations> = {}): FulfillmentOrderWithRelations {
  return {
    id: 'fo-1',
    organizationId: ORG,
    podOrderId: 'pod-1',
    provider: 'MANGO',
    status: FulfillmentStatus.SUBMITTED,
    providerOrderId: 'MG-9',
    externalOrderId: 'NC-TT-1',
    currency: 'USD',
    trackingNumber: null,
    productionLine: 'TIKTOK',
    shippingMethod: 'standard',
    submittedAt: new Date('2026-09-29T03:00:00Z'),
    cancelledAt: null,
    account: { id: 'acc', name: 'Mango US', provider: 'MANGO' },
    items: [
      { podOrderItemId: 'li-1', baseCost: new Prisma.Decimal('6.5'), baseCostConfirmedAt: new Date(), quantity: 1 },
      { podOrderItemId: 'li-2', baseCost: new Prisma.Decimal('4.2'), baseCostConfirmedAt: new Date(), quantity: 1 },
    ],
    ...overrides,
  } as unknown as FulfillmentOrderWithRelations;
}

type PublishArg = { payload: Record<string, unknown> };

function build() {
  const outbox = { publish: jest.fn<Promise<void>, [PublishArg]>().mockResolvedValue(undefined) };
  const podOrderRepo = {
    findById: jest.fn().mockResolvedValue({
      tiktokOrderId: 'TT-1',
      account: { accountName: 'AZ_VTR_31', seller: { user: { fullName: 'Seller Lan' } } },
      shop: { name: 'Sunday Crew' },
      items: [
        { id: 'li-1', skuId: 's1', sellerSku: 'SKU1', productName: 'Tee', skuName: 'M / Black' },
        { id: 'li-2', skuId: 's1', sellerSku: 'SKU1', productName: 'Tee', skuName: 'M / Black' },
        { id: 'li-3', skuId: 's2', sellerSku: 'SKU2', productName: 'Mug', skuName: null },
      ],
    }),
  };
  const repo = { findUserDisplayName: jest.fn().mockResolvedValue('Seller Lan') };
  const service = new FulfillmentNotificationService(
    outbox as unknown as NotificationOutboxService,
    podOrderRepo as unknown as PodOrderRepository,
    repo as unknown as FulfillmentRepository,
  );
  return { service, outbox, podOrderRepo, repo };
}

describe('FulfillmentNotificationService', () => {
  it('TEST 12 — fulfill thành công ⇒ sự kiện FULFILLMENT_SUBMITTED khoá theo bản ghi fulfillment', async () => {
    const { service, outbox, podOrderRepo } = build();

    await service.fulfilled(record(), 'admin', FulfillmentTrigger.MANUAL);

    expect(podOrderRepo.findById).toHaveBeenCalledWith(ORG, 'pod-1');
    expect(outbox.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        eventType: 'FULFILLMENT_SUBMITTED',
        entityType: 'FULFILLMENT_ORDER',
        entityId: 'fo-1',
        actorUserId: 'admin',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({
          tiktokOrderId: 'TT-1',
          // Seller / Shop lấy từ quan hệ thật của đơn (Order → Account → Seller; Order → Shop).
          sellerName: 'Seller Lan',
          shopName: 'Sunday Crew',
          status: 'SUBMITTED',
          accountName: 'AZ_VTR_31',
          provider: 'MangoTeePrints',
          fulfilledBy: 'Mango US',
          providerOrderId: 'MG-9',
          baseCost: '10.70',
          baseCostConfirmed: true,
          productionLine: 'TIKTOK',
          shippingMethod: 'standard',
          // Chỉ các dòng đã gửi, gộp theo SKU.
          items: [{ productName: 'Tee', sku: 'SKU1', variant: 'M / Black', quantity: 2 }],
        }),
      }),
    );
  });

  it('giá vốn chưa được nhà cung cấp xác nhận ⇒ không đưa số tạm vào tin', async () => {
    const { service, outbox } = build();
    await service.fulfilled(
      record({
        items: [{ podOrderItemId: 'li-1', baseCost: new Prisma.Decimal('6.5'), baseCostConfirmedAt: null, quantity: 1 }],
      } as Partial<FulfillmentOrderWithRelations>),
      'admin',
      FulfillmentTrigger.MANUAL,
    );
    expect(outbox.publish.mock.calls[0][0].payload).toMatchObject({ baseCost: null, baseCostConfirmed: false });
  });

  it.each([FulfillmentStatus.FAILED, FulfillmentStatus.DRAFT, FulfillmentStatus.SUBMITTING, FulfillmentStatus.REJECTED])(
    'TEST 13 — trạng thái %s ⇒ KHÔNG phát thông báo thành công',
    async (status) => {
      const { service, outbox } = build();
      await service.fulfilled(record({ status }), 'admin', FulfillmentTrigger.MANUAL);
      expect(outbox.publish).not.toHaveBeenCalled();
    },
  );

  it('TEST 14 — huỷ đã được xác nhận ⇒ FULFILLMENT_CANCELLED kèm lý do, Seller và NGƯỜI huỷ', async () => {
    const { service, outbox, repo } = build();
    await service.cancelled(
      record({ status: FulfillmentStatus.CANCELLED, cancelledAt: new Date('2026-09-29T03:30:00Z') }),
      'seller-1',
      '  khách đổi ý ',
    );
    // Tên người huỷ đọc trong ĐÚNG tổ chức của bản ghi.
    expect(repo.findUserDisplayName).toHaveBeenCalledWith(ORG, 'seller-1');
    expect(outbox.publish.mock.calls[0][0].payload).toMatchObject({
      sellerName: 'Seller Lan',
      shopName: 'Sunday Crew',
      cancelledBy: 'Seller Lan',
    });
    expect(outbox.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'FULFILLMENT_CANCELLED',
        entityId: 'fo-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ reason: 'khách đổi ý', cancelledAt: '2026-09-29T03:30:00.000Z' }),
      }),
    );
  });

  it('TEST 15 — huỷ CHƯA được xác nhận (vẫn SUBMITTED/ON_HOLD) ⇒ không phát', async () => {
    const { service, outbox } = build();
    await service.cancelled(record({ status: FulfillmentStatus.ON_HOLD }), 'admin', undefined);
    expect(outbox.publish).not.toHaveBeenCalled();
  });

  it('không tìm thấy đơn trong tổ chức ⇒ không phát (không đọc chéo tổ chức)', async () => {
    const { service, outbox, podOrderRepo } = build();
    podOrderRepo.findById.mockResolvedValue(null);
    await service.fulfilled(record(), 'admin', FulfillmentTrigger.MANUAL);
    expect(outbox.publish).not.toHaveBeenCalled();
  });

  it('lỗi khi phát ⇒ nuốt lỗi, fulfill không bị ảnh hưởng', async () => {
    const { service, podOrderRepo } = build();
    podOrderRepo.findById.mockRejectedValue(new Error('db down'));
    await expect(service.fulfilled(record(), 'admin', FulfillmentTrigger.MANUAL)).resolves.toBeUndefined();
    await expect(
      service.cancelled(record({ status: FulfillmentStatus.CANCELLED }), 'admin', undefined),
    ).resolves.toBeUndefined();
  });
});
