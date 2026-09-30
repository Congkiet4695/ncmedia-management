import type {
  FulfillmentAccount,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentTrigger,
} from '@prisma/client';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { FulfillmentOrderWithRelations } from '../repositories/fulfillment.repository';
import type { MappingWithDesigns, PlacementResolver } from './fulfillment-readiness.service';

/**
 * Tuỳ chọn của MỘT lần gửi — hợp của mọi nhà cung cấp.
 *
 * 🔴 Mỗi adapter tự kiểm tra field nào NÓ hỗ trợ và TỪ CHỐI field không hỗ trợ (vd `facility` gửi
 * cho Sellerwix, `rushService` gửi cho Mango) thay vì lặng lẽ bỏ qua: người vận hành chọn một tuỳ
 * chọn thì phải biết nó có được áp dụng hay không.
 */
export interface FulfillOptionsInput {
  /** Tài khoản nhà cung cấp cho lần gửi này — gateway luôn điền trước khi gọi adapter. */
  fulfillmentAccountId?: string | null;
  /** Mã phương thức vận chuyển THEO nhà cung cấp (Mango: enum; Sellerwix: `code` theo biến thể). */
  shippingMethod?: string | null;
  /** Mango (production line TIKTOK). */
  facility?: string | null;
  /** Mango (production line FASTUS). */
  speedType?: string | null;
  /** Mango. */
  preferredCarrier?: string | null;
  /** Mango (production line TIKTOK). */
  isScanLabel?: boolean;
  /** Nhãn vận chuyển (URL công khai). */
  labelUrl?: string | null;
  note?: string | null;
  /** Sellerwix: `rush_service`. */
  rushService?: boolean;
}

/** Kết quả Test Connection — không bao giờ chứa thông tin xác thực. */
export interface ProviderConnectionResult {
  connected: boolean;
  message: string;
  durationMs: number | null;
  /** Mango: số production line đọc được. */
  productionLineCount: number | null;
  /** Sellerwix: số danh mục đọc được. */
  categoryCount: number | null;
}

/** Phương thức vận chuyển dùng được cho MỘT đơn với MỘT tài khoản. */
export interface ProviderShippingMethods {
  options: Array<{ value: string; label: string }>;
  warnings: string[];
}

/**
 * Hợp đồng của một nhà cung cấp fulfillment.
 *
 * ```
 *   Controller / Scheduler / Webhook
 *        │
 *        ▼
 *   FulfillmentProviderGateway ──(account.provider)──▶ Adapter ──▶ Client ──▶ API nhà cung cấp
 * ```
 *
 * Adapter sở hữu TOÀN BỘ phần đặc thù (client, mapper, luật validate, ánh xạ trạng thái). Phần chung
 * (readiness, ánh xạ sản phẩm, design, nhật ký, khoá phân tán) nằm ở `services/` và được dùng lại.
 */
export interface FulfillmentProviderAdapter {
  readonly provider: FulfillmentProvider;

  /** Gửi đơn (cũng là Retry — trigger RETRY). Idempotent theo khoá của nhà cung cấp. */
  fulfill(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger,
    options: FulfillOptionsInput,
  ): Promise<FulfillmentOrderWithRelations>;

  /** Đồng bộ MỘT bản ghi — KHÔNG ném lỗi (fail-soft, dùng cho scheduler). */
  syncOne(
    record: FulfillmentOrder,
    account: FulfillmentAccount,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<{ changed: boolean; apiCalls: number }>;

  syncByPodOrder(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
  ): Promise<FulfillmentOrderWithRelations>;

  cancel(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    reason?: string,
    /** Mã role của người huỷ — chỉ để ghi audit (quyền đã được kiểm ở controller / gateway). */
    actorRole?: string,
  ): Promise<FulfillmentOrderWithRelations>;

  /** Chẩn đoán — KHÔNG ném lỗi, trả nguyên văn thông báo của nhà cung cấp. */
  testConnection(account: FulfillmentAccount): Promise<ProviderConnectionResult>;

  /**
   * Luật vị trí in cho readiness. `undefined` ⇒ luật mặc định (Mango).
   * Async vì Sellerwix cần nạp `print_areas` của các biến thể đã ánh xạ.
   */
  placementResolver(
    account: FulfillmentAccount,
    mappings: MappingWithDesigns[],
  ): Promise<PlacementResolver | undefined>;

  /** Phương thức vận chuyển hợp lệ cho đơn này. */
  shippingMethods(
    account: FulfillmentAccount,
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
  ): Promise<ProviderShippingMethods>;
}
