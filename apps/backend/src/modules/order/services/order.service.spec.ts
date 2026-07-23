import { OrderItemStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import {
  OrderAccountForbiddenException,
  OrderAccountInvalidException,
  OrderDuplicateException,
  OrderLockedException,
  OrderNotFoundException,
} from '../exceptions/order.exceptions';
import { OrderMapper } from '../mappers/order.mapper';
import { OrderRepository } from '../repositories/order.repository';
import { OrderService } from './order.service';

/** Unit test — OrderService (Order Module). */
describe('OrderService', () => {
  let service: OrderService;

  const repo = {
    findAccountForOrder: jest.fn(),
    duplicateExists: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    createItems: jest.fn(),
    replaceItems: jest.fn(),
    updateScalar: jest.fn(),
    softDelete: jest.fn(),
    addStatusHistory: jest.fn(),
    addLog: jest.fn(),
    findMany: jest.fn(),
    listSellers: jest.fn(),
    claim: jest.fn(),
    release: jest.fn(),
    listNotes: jest.fn(),
    findNoteById: jest.fn(),
    createNote: jest.fn(),
    updateNote: jest.fn(),
    softDeleteNote: jest.fn(),
    findItemById: jest.fn(),
    updateItemFulfillment: jest.fn(),
  };
  // $transaction chạy callback với tx giả.
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
  const mapper = new OrderMapper();

  const ORG = 'org-1';
  const ADMIN = 'admin-1';
  const SELLER = 'seller-1';

  const orderRow = {
    id: 'order-1',
    orderNumber: 'ORD-1',
    platform: 'TIKTOK_SHOP',
    status: OrderStatus.WAITING,
    orderedAt: new Date('2026-07-16T00:00:00Z'),
    shippingAddress: 'addr',
    currency: 'USD',
    fulfilledById: null,
    fulfilledBy: null,
    claimedAt: null,
    account: {
      id: 'acc-1',
      name: 'ACC 1',
      sellerUserId: SELLER,
      platform: { id: 'plat-1', code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
      seller: { id: SELLER, fullName: 'Seller One', email: 's1@x.com' },
    },
    items: [{
      id: 'it-1', productName: 'P1', productLink: null, color: null, size: null,
      quantity: 2, unitPrice: 10, trackingNumber: null, fulfillmentStatus: 'PENDING',
      image: null, remark: null,
    }],
    notes: [],
    statusHistories: [{
      id: 'h-1', oldStatus: null, newStatus: OrderStatus.WAITING, changedBy: ADMIN,
      note: 'Tạo đơn', createdAt: new Date('2026-07-16T00:00:00Z'),
    }],
    createdAt: new Date('2026-07-16T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
  };

  const createDto: CreateOrderDto = {
    accountId: 'acc-1',
    orderNumber: 'ORD-1',
    items: [{ productName: 'P1', quantity: 2, unitPrice: 10 }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService(
      prisma as unknown as PrismaService,
      repo as unknown as OrderRepository,
      mapper,
    );
  });

  it('defined', () => expect(service).toBeDefined());

  it('create: account không thuộc org → OrderAccountInvalidException', async () => {
    repo.findAccountForOrder.mockResolvedValue(null);
    await expect(service.create(ORG, ADMIN, createDto)).rejects.toBeInstanceOf(
      OrderAccountInvalidException,
    );
  });

  it('create: Seller tạo Order cho Account không quản lý → OrderAccountForbiddenException', async () => {
    repo.findAccountForOrder.mockResolvedValue({ id: 'acc-1', sellerUserId: 'other', platform: 'TIKTOK_SHOP' });
    await expect(service.create(ORG, 'emp-x', createDto, 'emp-x')).rejects.toBeInstanceOf(
      OrderAccountForbiddenException,
    );
  });

  it('create: trùng orderNumber trong platform → OrderDuplicateException', async () => {
    repo.findAccountForOrder.mockResolvedValue({ id: 'acc-1', sellerUserId: SELLER, platform: 'TIKTOK_SHOP' });
    repo.duplicateExists.mockResolvedValue(true);
    await expect(service.create(ORG, ADMIN, createDto)).rejects.toBeInstanceOf(
      OrderDuplicateException,
    );
  });

  it('create: happy path → tạo order + items + status history + log CREATE, status WAITING', async () => {
    repo.findAccountForOrder.mockResolvedValue({ id: 'acc-1', sellerUserId: SELLER, platform: 'TIKTOK_SHOP' });
    repo.duplicateExists.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'order-1' });
    repo.findById.mockResolvedValue(orderRow);

    const res = await service.create(ORG, ADMIN, createDto);

    expect(repo.create).toHaveBeenCalled();
    expect(repo.createItems).toHaveBeenCalledWith(expect.anything(), 'order-1', expect.any(Array));
    expect(repo.addStatusHistory).toHaveBeenCalledWith(
      expect.anything(), 'order-1', null, OrderStatus.WAITING, ADMIN, 'Tạo đơn',
    );
    expect(repo.addLog).toHaveBeenCalledWith(expect.anything(), 'order-1', expect.objectContaining({ action: 'CREATE' }));
    expect(res.id).toBe('order-1');
    expect(res.totalQuantity).toBe(2);
    expect(res.totalAmount).toBe(20);
  });

  it('findOne: không tồn tại → OrderNotFoundException', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne(ORG, 'nope')).rejects.toBeInstanceOf(OrderNotFoundException);
  });

  it('updateStatus: ghi history + log STATUS_CHANGE', async () => {
    repo.findById.mockResolvedValue(orderRow);
    await service.updateStatus(ORG, ADMIN, 'order-1', { status: OrderStatus.URGENT, note: 'rush' });
    expect(repo.addStatusHistory).toHaveBeenCalledWith(
      expect.anything(), 'order-1', OrderStatus.WAITING, OrderStatus.URGENT, ADMIN, 'rush',
    );
    expect(repo.addLog).toHaveBeenCalledWith(
      expect.anything(), 'order-1',
      expect.objectContaining({ action: 'STATUS_CHANGE', field: 'status', newValue: OrderStatus.URGENT }),
    );
  });

  it('remove: không tồn tại → OrderNotFoundException', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.remove(ORG, ADMIN, 'nope')).rejects.toBeInstanceOf(OrderNotFoundException);
  });

  it('remove: soft delete + log DELETE', async () => {
    repo.findById.mockResolvedValue(orderRow);
    await service.remove(ORG, ADMIN, 'order-1');
    expect(repo.softDelete).toHaveBeenCalledWith(expect.anything(), 'order-1', ADMIN);
    expect(repo.addLog).toHaveBeenCalledWith(expect.anything(), 'order-1', expect.objectContaining({ action: 'DELETE' }));
  });

  // --- Fulfillment ---
  const FUL = 'ful-1';
  const actorFul = { userId: FUL, role: 'FULFILLMENT' };

  it('claim: đơn chưa claim → gán fulfilledById + status IN_PROGRESS + log CLAIM', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: null });
    await service.claim(ORG, actorFul, 'order-1', undefined, { ipAddress: '1.2.3.4' });
    expect(repo.claim).toHaveBeenCalledWith(expect.anything(), 'order-1', FUL, OrderStatus.IN_PROGRESS);
    expect(repo.addStatusHistory).toHaveBeenCalledWith(
      expect.anything(), 'order-1', OrderStatus.WAITING, OrderStatus.IN_PROGRESS, FUL, 'Nhận xử lý (claim)',
    );
    expect(repo.addLog).toHaveBeenCalledWith(
      expect.anything(), 'order-1',
      expect.objectContaining({ action: 'CLAIM', ipAddress: '1.2.3.4' }),
    );
  });

  it('claim: đơn đã claim bởi người KHÁC → OrderLockedException (409)', async () => {
    repo.findById.mockResolvedValue({
      ...orderRow, fulfilledById: 'other', fulfilledBy: { id: 'other', fullName: 'Ful B' },
    });
    await expect(
      service.claim(ORG, actorFul, 'order-1', undefined, {}),
    ).rejects.toBeInstanceOf(OrderLockedException);
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('updateItemFulfillment: Fulfillment KHÔNG phải người claim → OrderLockedException (409)', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: 'other' });
    await expect(
      service.updateItemFulfillment(ORG, actorFul, 'order-1', 'it-1', { trackingNumber: 'X' }, undefined, {}),
    ).rejects.toBeInstanceOf(OrderLockedException);
  });

  it('updateItemFulfillment: người claim cập nhật tracking + status theo item', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: FUL });
    repo.findItemById.mockResolvedValue({ id: 'it-1', trackingNumber: null, fulfillmentStatus: 'PENDING' });
    await service.updateItemFulfillment(
      ORG, actorFul, 'order-1', 'it-1',
      { trackingNumber: 'TRK-1', fulfillmentStatus: OrderItemStatus.SHIPPED }, undefined, {},
    );
    expect(repo.updateItemFulfillment).toHaveBeenCalledWith(
      expect.anything(), 'it-1',
      expect.objectContaining({ trackingNumber: 'TRK-1' }),
    );
  });

  it('fulfillStatus: người claim đổi status → ghi history + log STATUS_CHANGE', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: FUL });
    await service.fulfillStatus(ORG, actorFul, 'order-1', { status: OrderStatus.SHIPPED }, undefined, {});
    expect(repo.addStatusHistory).toHaveBeenCalledWith(
      expect.anything(), 'order-1', OrderStatus.WAITING, OrderStatus.SHIPPED, FUL, undefined,
    );
  });

  it('release: Admin xóa fulfilledById + status WAITING + log RELEASE', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: FUL });
    await service.release(ORG, { userId: ADMIN, role: 'ADMIN' }, 'order-1', { ipAddress: '9.9.9.9' });
    expect(repo.release).toHaveBeenCalledWith(expect.anything(), 'order-1', ADMIN, OrderStatus.WAITING);
    expect(repo.addLog).toHaveBeenCalledWith(
      expect.anything(), 'order-1', expect.objectContaining({ action: 'RELEASE' }),
    );
  });

  it('update (sales): đơn đã claim + actor EMPLOYEE → OrderLockedException (409)', async () => {
    repo.findById.mockResolvedValue({ ...orderRow, fulfilledById: FUL });
    await expect(
      service.update(ORG, 'emp-1', 'order-1', { shippingAddress: 'X' }, 'emp-1', 'EMPLOYEE'),
    ).rejects.toBeInstanceOf(OrderLockedException);
  });
});
