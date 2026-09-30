import { Injectable } from '@nestjs/common';
import {
  FulfillmentAccount,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentTrigger,
} from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { FULFILLMENT_PROVIDER_LABELS } from '../constants/fulfillment-provider.constants';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentOperationNotSupportedException,
  FulfillmentOperationInProgressException,
  FulfillmentOrderNotFoundException,
  FulfillmentProviderNotAssignedException,
  FulfillmentProviderNotSelectedException,
  FulfillmentProviderNotSupportedException,
} from '../exceptions/fulfillment.exceptions';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import type { MangoShippingMethod } from '../mango/constants/mango.constants';
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../repositories/fulfillment.repository';
import { SellerwixFulfillmentService } from '../sellerwix/services/sellerwix-fulfillment.service';
import { fulfillmentOrderLockKey } from '../shared/fulfillment-lifecycle';
import type {
  FulfillOptionsInput,
  FulfillmentProviderAdapter,
  ProviderConnectionResult,
  ProviderShippingMethods,
} from './fulfillment-provider.adapter';
import { FulfillmentNotificationService } from './fulfillment-notification.service';
import type { MappingWithDesigns, PlacementResolver } from './fulfillment-readiness.service';

/**
 * FulfillmentProviderGateway — điểm vào DUY NHẤT từ controller/scheduler tới nhà cung cấp.
 *
 * 🔴 Trước đây mọi controller gọi thẳng `MangoFulfillmentService`, nên một tài khoản nhà cung cấp
 * khác sẽ bị gửi bằng client Mango với thông tin xác thực của nhà cung cấp khác. Gateway chọn
 * adapter theo `account.provider` — thêm nhà cung cấp mới = thêm một adapter vào danh sách dưới.
 *
 * Chọn tài khoản cho MỘT lần gửi (khi người dùng không chọn):
 * ```
 *   1. người dùng CHỌN ở màn hình Fulfill           (fulfillmentAccountId)
 *   2. tài khoản của bản ghi fulfillment hiện hành  (Retry gửi lại đúng nhà cung cấp cũ)
 *   3. nhà cung cấp gán cho kết nối TikTok          (dữ liệu cũ)
 *   4. đúng MỘT tài khoản khả dụng (mọi nhà cung cấp đã tích hợp)
 * ```
 */
/** Thời hạn khoá của một lần huỷ (hỏi trạng thái + huỷ + đọc lại ở nhà cung cấp). */
const CANCEL_LOCK_MS = 60_000;

@Injectable()
export class FulfillmentProviderGateway {
  private readonly adapters: ReadonlyMap<FulfillmentProvider, FulfillmentProviderAdapter>;

  constructor(
    private readonly repo: FulfillmentRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly mango: MangoFulfillmentService,
    sellerwix: SellerwixFulfillmentService,
    private readonly accessScope: PodAccessScopeService,
    private readonly notifications: FulfillmentNotificationService,
    private readonly lock: DistributedLockService,
  ) {
    this.adapters = new Map<FulfillmentProvider, FulfillmentProviderAdapter>(
      [mango, sellerwix].map((adapter) => [adapter.provider, adapter]),
    );
  }

  /** Nhà cung cấp đã có tích hợp thật. */
  isSupported(provider: FulfillmentProvider): boolean {
    return this.adapters.has(provider);
  }

  adapterFor(provider: FulfillmentProvider): FulfillmentProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new FulfillmentProviderNotSupportedException(provider);
    return adapter;
  }

  // ---------------------------------------------------------------------------
  // Gửi / Retry
  // ---------------------------------------------------------------------------

  async fulfill(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger,
    options: FulfillOptionsInput,
    scope: PodAccessScope,
  ): Promise<FulfillmentOrderWithRelations> {
    // 🔴 Kiểm phạm vi shop NGAY TRƯỚC khi gọi nhà cung cấp — không dựa vào việc giao diện có hiện
    // nút hay không. Seller đổi ID trên URL/request vẫn bị chặn ở đây.
    await this.assertOrderInScope(organizationId, podOrderId, scope);
    const account = await this.resolveAccountForFulfill(
      organizationId,
      podOrderId,
      options.fulfillmentAccountId,
    );
    const record = await this.adapterFor(account.provider).fulfill(
      organizationId,
      actorUserId,
      podOrderId,
      trigger,
      {
        ...options,
        fulfillmentAccountId: account.id,
      },
    );
    // Adapter chỉ trả về khi nhà cung cấp đã tiếp nhận VÀ DB đã ghi trạng thái / mã đơn / giá vốn;
    // mọi thất bại đều ném lỗi nên không tới dòng này. Thông báo không bao giờ ném lỗi.
    await this.notifications.fulfilled(record, actorUserId, trigger);
    return record;
  }

  /**
   * Tài khoản cho một lần gửi — xem thứ tự ở đầu lớp.
   *
   * 🔴 Bước 1 KHÔNG tin frontend: `findAccountById` chỉ trả tài khoản của chính tổ chức hoặc tài
   * khoản dùng chung (`usableAccountWhere`).
   */
  async resolveAccountForFulfill(
    organizationId: string,
    podOrderId: string,
    selectedAccountId?: string | null,
  ): Promise<FulfillmentAccount> {
    const selected = selectedAccountId?.trim();
    if (selected) {
      const account = await this.repo.findAccountById(organizationId, selected);
      if (!account) throw new FulfillmentAccountNotFoundException();
      return account;
    }

    const current = await this.repo.findCurrentByPodOrder(organizationId, podOrderId);
    if (current) {
      const account = await this.repo.findAccountById(organizationId, current.accountId);
      if (account) return account;
    }

    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();

    const assignedId = order.account?.fulfillmentAccountId;
    if (assignedId) {
      const account = await this.repo.findAccountById(organizationId, assignedId);
      if (account) return account;
    }

    const usable = (await this.repo.listAccounts(organizationId)).filter(
      (account) => account.isActive && this.isSupported(account.provider),
    );
    if (usable.length === 1) return usable[0];
    if (usable.length === 0)
      throw new FulfillmentProviderNotAssignedException(order.account?.accountName);
    throw new FulfillmentProviderNotSelectedException(usable.map((account) => account.name));
  }

  // ---------------------------------------------------------------------------
  // Thao tác trên bản ghi đã có — theo nhà cung cấp của bản ghi HIỆN HÀNH
  // ---------------------------------------------------------------------------

  async syncByPodOrder(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const current = await this.requireCurrent(organizationId, podOrderId);
    return this.adapterFor(current.provider).syncByPodOrder(
      organizationId,
      actorUserId,
      podOrderId,
    );
  }

  async cancel(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    scope: PodAccessScope,
    reason?: string,
    actorRole?: string,
  ): Promise<FulfillmentOrderWithRelations> {
    // 🔴 Cùng MỘT đường cho Admin và Seller: quyền `fulfillment.cancel` do controller kiểm, PHẠM VI
    // shop kiểm ở đây (Seller huỷ đơn shop khác ⇒ 403; đơn tổ chức khác ⇒ 404). Không tin id từ client.
    await this.assertOrderInScope(organizationId, podOrderId, scope);
    // Khoá chung với gửi đơn: hai người cùng bấm Huỷ, hoặc Huỷ khi đang Fulfill, không chạy chồng —
    // bên đến sau nhận 409 thay vì gọi nhà cung cấp lần hai trên dữ liệu đã cũ.
    const record = await this.lock.withLock(fulfillmentOrderLockKey(podOrderId), CANCEL_LOCK_MS, async () => {
      const current = await this.requireCurrent(organizationId, podOrderId);
      return this.adapterFor(current.provider).cancel(
        organizationId,
        actorUserId,
        podOrderId,
        reason,
        actorRole,
      );
    });
    if (!record) throw new FulfillmentOperationInProgressException();
    // Chỉ phát khi nhà cung cấp XÁC NHẬN huỷ (status CANCELLED); "đang chờ huỷ" không phát.
    await this.notifications.cancelled(record, actorUserId, reason);
    return record;
  }

  /** Sửa đơn đã gửi — chỉ MangoTeePrints có API (Sellerwix không có Update Order). */
  async updateAtProvider(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    changes: { labelUrl?: string | null; note?: string | null; shippingMethod?: string | null },
    scope: PodAccessScope,
  ): Promise<FulfillmentOrderWithRelations> {
    await this.assertOrderInScope(organizationId, podOrderId, scope);
    const current = await this.requireCurrent(organizationId, podOrderId);
    if (current.provider !== FulfillmentProvider.MANGO) {
      throw new FulfillmentOperationNotSupportedException(
        FULFILLMENT_PROVIDER_LABELS[current.provider],
        'Sửa đơn đã gửi',
      );
    }
    return this.mango.updateAtProvider(organizationId, actorUserId, podOrderId, {
      ...changes,
      shippingMethod: changes.shippingMethod as MangoShippingMethod | null | undefined,
    });
  }

  /**
   * Đơn thuộc phạm vi shop của người gọi (Seller: chỉ shop được Admin gán; Admin: mọi shop).
   * Đơn của tổ chức khác ⇒ 404 (`findById` lọc theo tổ chức); đơn của shop khác ⇒ 403.
   */
  private async assertOrderInScope(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    this.accessScope.assertShopAllowed(scope, order.shopId);
  }

  syncOne(
    record: FulfillmentOrder,
    account: FulfillmentAccount,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<{ changed: boolean; apiCalls: number }> {
    return this.adapterFor(record.provider).syncOne(record, account, trigger, actorUserId);
  }

  testConnection(account: FulfillmentAccount): Promise<ProviderConnectionResult> {
    return this.adapterFor(account.provider).testConnection(account);
  }

  placementResolver(
    account: FulfillmentAccount,
    mappings: MappingWithDesigns[],
  ): Promise<PlacementResolver | undefined> {
    return this.adapterFor(account.provider).placementResolver(account, mappings);
  }

  async shippingMethods(
    organizationId: string,
    podOrderId: string,
    accountId: string,
  ): Promise<ProviderShippingMethods> {
    const account = await this.repo.findAccountById(organizationId, accountId);
    if (!account) throw new FulfillmentAccountNotFoundException();
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    return this.adapterFor(account.provider).shippingMethods(account, order, mappings);
  }

  private async requireCurrent(
    organizationId: string,
    podOrderId: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const current = await this.repo.findCurrentByPodOrder(organizationId, podOrderId);
    if (!current) throw new FulfillmentOrderNotFoundException();
    return current;
  }
}
