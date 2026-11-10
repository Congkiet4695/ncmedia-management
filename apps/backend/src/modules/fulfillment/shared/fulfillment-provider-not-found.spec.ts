import { FulfillmentStatus, FulfillmentTrigger, type FulfillmentOrder } from '@prisma/client';
import { FulfillmentClientError, FulfillmentErrorClass } from '../exceptions/fulfillment.exceptions';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import {
  PROVIDER_ORDER_NOT_FOUND_CODE,
  RESETTABLE_ON_PROVIDER_NOT_FOUND,
  isProviderOrderGone,
  isProviderOrderNotFoundError,
  shouldResetOnProviderNotFound,
} from './fulfillment-provider-not-found';

const NOT_FOUND = new FulfillmentClientError(FulfillmentErrorClass.NOT_FOUND, 'order not found', 404, '404');
const RECORD = { status: FulfillmentStatus.SUBMITTED, providerOrderId: 'swx-1', externalOrderId: 'TT-1' };

describe('fulfillment-provider-not-found — chỉ reset khi CHẮC CHẮN nhà cung cấp không còn đơn', () => {
  it.each([
    FulfillmentErrorClass.NETWORK,
    FulfillmentErrorClass.RATE_LIMIT,
    FulfillmentErrorClass.SERVER,
    FulfillmentErrorClass.AUTH,
    FulfillmentErrorClass.VALIDATION,
    FulfillmentErrorClass.UNKNOWN,
  ])('lỗi %s KHÔNG phải "không còn đơn"', (errorClass) => {
    expect(isProviderOrderNotFoundError(new FulfillmentClientError(errorClass, 'x'))).toBe(false);
  });

  it('lỗi không phải của client nhà cung cấp (vd lỗi DB) ⇒ không phải "không còn đơn"', () => {
    expect(isProviderOrderNotFoundError(new Error('not found'))).toBe(false);
  });

  it('NOT_FOUND + người dùng bấm Sync + đơn chưa vào sản xuất ⇒ reset', () => {
    for (const status of RESETTABLE_ON_PROVIDER_NOT_FOUND) {
      expect(shouldResetOnProviderNotFound({ ...RECORD, status }, FulfillmentTrigger.MANUAL, NOT_FOUND)).toBe(true);
    }
  });

  it.each([FulfillmentTrigger.CRON, FulfillmentTrigger.WEBHOOK, FulfillmentTrigger.RETRY])(
    'trigger %s ⇒ KHÔNG reset',
    (trigger) => {
      expect(shouldResetOnProviderNotFound(RECORD, trigger, NOT_FOUND)).toBe(false);
    },
  );

  it.each([
    FulfillmentStatus.IN_PRODUCTION,
    FulfillmentStatus.SHIPPED,
    FulfillmentStatus.DELIVERED,
    FulfillmentStatus.REFUNDED,
    FulfillmentStatus.CANCELLED,
    FulfillmentStatus.FAILED,
    FulfillmentStatus.SUBMITTING,
    FulfillmentStatus.DRAFT,
  ])('bản ghi %s ⇒ KHÔNG reset', (status) => {
    expect(shouldResetOnProviderNotFound({ ...RECORD, status }, FulfillmentTrigger.MANUAL, NOT_FOUND)).toBe(false);
  });

  it('isProviderOrderGone: chỉ CANCELLED + PROVIDER_ORDER_NOT_FOUND (huỷ có xác nhận ≠ không còn đơn)', () => {
    expect(isProviderOrderGone({ status: FulfillmentStatus.CANCELLED, lastErrorCode: PROVIDER_ORDER_NOT_FOUND_CODE })).toBe(true);
    expect(isProviderOrderGone({ status: FulfillmentStatus.CANCELLED, lastErrorCode: null })).toBe(false);
    expect(isProviderOrderGone({ status: FulfillmentStatus.SUBMITTED, lastErrorCode: PROVIDER_ORDER_NOT_FOUND_CODE })).toBe(false);
  });
});

describe('FulfillmentRepository.markProviderOrderNotFound', () => {
  function build(updatedCount: number) {
    const tx = {
      fulfillmentOrder: { updateMany: jest.fn().mockResolvedValue({ count: updatedCount }) },
      fulfillmentHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    return { repo: new FulfillmentRepository(prisma as never), tx };
  }
  const record = {
    id: 'fo-1',
    organizationId: 'org-1',
    status: FulfillmentStatus.SUBMITTED,
  } as FulfillmentOrder;
  const input = {
    allowedStatuses: RESETTABLE_ON_PROVIDER_NOT_FOUND,
    code: PROVIDER_ORDER_NOT_FOUND_CODE,
    providerStatus: 'not found',
    message: 'gone',
    trigger: FulfillmentTrigger.MANUAL,
    performedBy: 'user-1',
    payload: { providerOrderNotFound: true },
  };

  it('🔴 điều kiện trạng thái + tổ chức + chưa lưu trữ nằm TRONG câu UPDATE; KHÔNG xoá mã đơn cũ', async () => {
    const { repo, tx } = build(1);
    await expect(repo.markProviderOrderNotFound(record, input)).resolves.toBe(true);

    const [args] = tx.fulfillmentOrder.updateMany.mock.calls[0] as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    expect(args.where).toEqual({
      id: 'fo-1',
      organizationId: 'org-1',
      deletedAt: null,
      status: { in: [...RESETTABLE_ON_PROVIDER_NOT_FOUND] },
    });
    expect(args.data).toMatchObject({
      status: FulfillmentStatus.CANCELLED,
      lastErrorCode: PROVIDER_ORDER_NOT_FOUND_CODE,
    });
    expect(args.data).not.toHaveProperty('providerOrderId');
    expect(args.data).not.toHaveProperty('externalOrderId');
    expect(args.data).not.toHaveProperty('deletedAt');
    expect(tx.fulfillmentHistory.create).toHaveBeenCalledTimes(1);
  });

  it('0 dòng (đã reset / đổi trạng thái giữa chừng) ⇒ false, KHÔNG ghi nhật ký', async () => {
    const { repo, tx } = build(0);
    await expect(repo.markProviderOrderNotFound(record, input)).resolves.toBe(false);
    expect(tx.fulfillmentHistory.create).not.toHaveBeenCalled();
  });
});
