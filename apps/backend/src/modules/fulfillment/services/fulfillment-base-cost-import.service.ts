import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentEventType, FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import type ExcelJS from 'exceljs';
import { bufferToWorkbook, cellToString, normalizeHeader } from '../../../common/excel/excel.util';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import {
  BASE_COST_IMPORT_HEADERS,
  BASE_COST_IMPORT_MAX_ROWS,
  BASE_COST_IMPORT_TX_TIMEOUT_MS,
  IMPORT_EXTERNAL_ORDER_MAX,
  IMPORT_EXTERNAL_ORDER_PREFIX,
  IMPORT_TRACKING_NUMBER_MAX,
} from '../constants/base-cost-import.constants';
import {
  MANUAL_BASE_COST_MAX,
  type BaseCostImportChangeDto,
  type BaseCostImportErrorDto,
  type BaseCostImportResultDto,
} from '../dto/fulfillment.dto';
import {
  FulfillmentBaseCostImportInvalidException,
  FulfillmentBaseCostImportStaleException,
} from '../exceptions/fulfillment.exceptions';
import {
  FulfillmentRepository,
  type FulfillmentOrderWithRelations,
  type HistoryEntry,
  type ImportRowBaseCost,
  type ImportRowWrite,
} from '../repositories/fulfillment.repository';
import {
  IMPORT_FULFILLED_STATUS,
  IMPORT_MARKABLE_STATUSES,
  holdsFulfilledOrder,
} from '../shared/fulfillment-lifecycle';
import { currencyFractionDigits, exceedsFractionDigits, resolveOrderLevelBaseCost } from '../shared/manual-base-cost';
import { createMappingIndex, findMappingInIndex, itemHasProductKey, productIdsOf } from '../shared/mapping-match';
import { PRODUCT_KEY_ISSUE_MESSAGE } from '../../pod-tiktok/shared/order-item-product-key';

/** Một dòng dữ liệu đã đọc từ file (chưa kiểm nghiệp vụ). `null` = ô trống / không có cột ⇒ không đổi. */
interface RawRow {
  row: number;
  orderId: string | null;
  baseCost: number | null;
  trackingNumber: string | null;
  error: BaseCostImportErrorDto | null;
}

interface FileColumns {
  orderId: number;
  baseCost: number | null;
  trackingNumber: number | null;
}

/** Dòng hợp lệ + cách ghi. `write = null` ⇒ không có gì thay đổi. */
type PlannedRow = BaseCostImportChangeDto & {
  /** Chỉ đổi Base Cost của một dòng hàng đã có ⇒ đi đường UPDATE gộp sẵn có (nhanh, như trước). */
  batchCost: { itemId: string; fulfillmentOrderId: string; baseCost: number; history: HistoryEntry } | null;
  write: Omit<ImportRowWrite, 'onStale'> | null;
};

type RowVerdict = { ok: true; plan: PlannedRow } | { ok: false; code: string; message: string };

/** TikTok Order ID: chữ số / chữ cái, tối đa 64 ký tự (cột `tiktok_order_id` VarChar(64)). */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Số thập phân không dấu, dấu chấm thập phân — không nhận `12,5`, `$12`, `1e3`. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
/** Mã vận đơn: chữ, số, `-`, `_`; không khoảng trắng (mã dán từ chỗ khác hay dính khoảng trắng giữa các cụm số). */
const TRACKING_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{2,${IMPORT_TRACKING_NUMBER_MAX - 1}}$`);
/** Trạng thái đơn TikTok mà Import KHÔNG được đánh dấu đã fulfill. */
const TIKTOK_CANCELLED_STATUS = 'CANCELLED';
const SOURCE = 'EXCEL_IMPORT';

/** Khoá so khớp header: chuẩn hoá chung của dự án rồi bỏ khoảng trắng, `_`, `-`. */
const headerKey = (raw: string): string => normalizeHeader(raw).replace(/[\s_-]+/g, '');

/**
 * **Import Excel Base Cost + Tracking Number** — Admin tải lên file `OrderID` · `Basecost` · `Tracking Number`
 * (file cũ 2 cột `OrderID` · `Basecost` vẫn dùng được).
 *
 * Chính sách (quyết định PO 2026-11-02):
 *  1. Đọc + kiểm TOÀN BỘ file trước khi ghi; lỗi từng dòng ghi rõ số dòng Excel + OrderID + lý do.
 *  2. MỘT PHẦN: dòng hợp lệ được ghi, dòng lỗi bị bỏ qua và liệt kê lại (`PARTIAL`). Mỗi dòng là MỘT transaction —
 *     dòng ghi hỏng (dữ liệu đổi giữa chừng) rollback riêng dòng đó, không để trạng thái "đã fulfill" thiếu giá vốn.
 *  3. `dryRun` ⇒ bản xem trước, không ghi. Bước xác nhận gửi lại CÙNG file và server kiểm lại từ đầu.
 *  4. Ô trống = KHÔNG đổi (không xoá giá / mã đang có). Dòng không có gì thay đổi không ghi lại ⇒ gửi lại cùng file
 *     không tạo bản ghi / nhật ký thừa.
 *
 * Luật theo trạng thái lần fulfill HIỆN HÀNH:
 *  - Đã fulfill (đang giữ đơn): cập nhật Base Cost (luật `resolveOrderLevelBaseCost`) và/hoặc Tracking Number; KHÔNG
 *    đổi trạng thái, KHÔNG tạo lần fulfill mới.
 *  - Chưa fulfill / `DRAFT` / `FAILED`: phải có CẢ Base Cost lẫn Tracking Number ⇒ ghi cả hai và chuyển sang
 *    `IMPORT_FULFILLED_STATUS` với nguồn `MANUAL_IMPORT` (nhà cung cấp KHÔNG xác nhận). Đơn chưa có bản ghi ⇒ tạo bản
 *    ghi dưới nhà cung cấp gán cho kết nối TikTok, dòng hàng theo Product Mapping.
 *  - Từ chối: đơn TikTok đã huỷ, lần fulfill `CANCELLED` / `REJECTED` / `SUBMITTING`, `FAILED` mà nhà cung cấp đã có
 *    mã đơn (đối soát sẽ lấy trạng thái thật — không import đè).
 *
 * 🔴 KHÔNG gọi API nhà cung cấp ở bất cứ đâu trong luồng này. OrderID không có / ngoài phạm vi shop ⇒
 * `ORDER_NOT_FOUND` (không phân biệt, để không lộ đơn của người khác).
 */
@Injectable()
export class FulfillmentBaseCostImportService {
  private readonly logger = new Logger(FulfillmentBaseCostImportService.name);

  constructor(
    private readonly repo: FulfillmentRepository,
    private readonly podOrderRepo: PodOrderRepository,
  ) {}

  async import(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
    scope: PodAccessScope,
    dryRun: boolean,
  ): Promise<BaseCostImportResultDto> {
    const { rows, ignoredHeaders, hasTrackingColumn } = await this.readFile(buffer);

    const errors: BaseCostImportErrorDto[] = rows.flatMap((row) => (row.error ? [row.error] : []));
    let duplicateRows = 0;

    // OrderID trùng trong file — đánh lỗi MỌI dòng của mã đó (kể cả dòng đã lỗi dữ liệu, để sửa một lần là đủ).
    const rowsByOrderId = new Map<string, RawRow[]>();
    for (const row of rows) {
      if (!row.orderId) continue;
      rowsByOrderId.set(row.orderId, [...(rowsByOrderId.get(row.orderId) ?? []), row]);
    }
    for (const [orderId, group] of rowsByOrderId) {
      if (group.length < 2) {
        if (group[0].error) rowsByOrderId.delete(orderId);
        continue;
      }
      const rowList = group.map((row) => row.row).join(', ');
      for (const row of group) {
        errors.push({
          row: row.row,
          orderId,
          code: 'DUPLICATE_ORDER_ID',
          message: `OrderID xuất hiện ${group.length} lần trong file (dòng ${rowList}).`,
        });
        duplicateRows += 1;
      }
      rowsByOrderId.delete(orderId);
    }

    // Tra đơn + lần fulfill hiện hành theo lô (2 truy vấn cho cả file).
    const refs = await this.podOrderRepo.findRefsByTiktokOrderIds(
      organizationId,
      [...rowsByOrderId.keys()],
      scope.allShops ? null : scope.shopIds,
    );
    const refOf = new Map(refs.map((ref) => [ref.tiktokOrderId, ref]));
    const records = await this.repo.findCurrentByPodOrders(
      organizationId,
      refs.map((ref) => ref.id),
    );
    // Dòng cần TẠO bản ghi / dòng hàng mới ⇒ nạp đơn (kèm khoá sản phẩm) + Product Mapping, chỉ khi thật sự cần.
    const context = await this.loadMarkContext(organizationId, rowsByOrderId, refOf, records);

    let notFoundRows = 0;
    const plans: PlannedRow[] = [];
    for (const [orderId, [row]] of rowsByOrderId) {
      const ref = refOf.get(orderId);
      if (!ref) {
        notFoundRows += 1;
        errors.push({
          row: row.row,
          orderId,
          code: 'ORDER_NOT_FOUND',
          message: 'Không tìm thấy đơn với OrderID này trong phạm vi bạn quản lý.',
        });
        continue;
      }
      const record = records.get(ref.id) ?? null;
      const verdict =
        !record || IMPORT_MARKABLE_STATUSES.includes(record.status)
          ? this.planMark(organizationId, actorUserId, row, orderId, ref, record, context, hasTrackingColumn)
          : this.planUpdate(organizationId, actorUserId, row, orderId, record);
      if (verdict.ok) plans.push(verdict.plan);
      else errors.push({ row: row.row, orderId, code: verdict.code, message: verdict.message });
    }

    const invalidRows = new Set(errors.map((error) => error.row)).size;
    let writeFailedRows = 0;
    if (!dryRun) {
      for (const failure of await this.write(organizationId, plans)) {
        writeFailedRows += 1;
        errors.push(failure);
      }
    }

    errors.sort((a, b) => a.row - b.row);
    plans.sort((a, b) => a.row - b.row);
    const counted = plans.filter((plan) => !plan.unchanged && (dryRun || plan.applied));
    const succeededRows = plans.length - writeFailedRows;
    const hasErrors = errors.length > 0;
    const status: BaseCostImportResultDto['status'] =
      succeededRows === 0 && hasErrors ? 'REJECTED' : hasErrors ? 'PARTIAL' : dryRun ? 'READY' : 'APPLIED';

    const result: BaseCostImportResultDto = {
      dryRun,
      status,
      totalRows: rows.length,
      validRows: plans.length,
      invalidRows,
      notFoundRows,
      duplicateRows,
      unchangedRows: plans.filter((plan) => plan.unchanged).length,
      updatedOrders: dryRun ? 0 : counted.length,
      baseCostUpdated: counted.filter((plan) => plan.baseCostChanged).length,
      trackingUpdated: counted.filter((plan) => plan.trackingChanged).length,
      markedFulfilled: counted.filter((plan) => plan.action === 'MARK_FULFILLED').length,
      writeFailedRows,
      ignoredHeaders,
      errors,
      changes: plans.map(({ batchCost: _batch, write: _write, ...change }) => change),
    };

    // Chỉ số liệu tổng hợp — không ghi nội dung file (mã đơn, mã vận đơn) vào log.
    this.logger.log({
      module: 'fulfillment',
      operation: 'base-cost.import',
      organizationId,
      performedBy: actorUserId,
      dryRun,
      status,
      totalRows: result.totalRows,
      invalidRows,
      writeFailedRows,
      updatedOrders: result.updatedOrders,
      markedFulfilled: result.markedFulfilled,
      unchangedRows: result.unchangedRows,
      msg: 'Import Base Cost / Tracking Number (Excel)',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Luật từng dòng
  // ---------------------------------------------------------------------------

  /** Đơn ĐÃ fulfill: chỉ cập nhật Base Cost / Tracking Number, không đổi trạng thái. */
  private planUpdate(
    organizationId: string,
    actorUserId: string,
    row: RawRow,
    orderId: string,
    record: FulfillmentOrderWithRelations,
  ): RowVerdict {
    if (!holdsFulfilledOrder(record)) {
      const terminal = record.status === FulfillmentStatus.CANCELLED || record.status === FulfillmentStatus.REJECTED;
      return terminal
        ? {
            ok: false,
            code: 'STATUS_NOT_ALLOWED',
            message: `Lần fulfill của đơn đang ở trạng thái ${record.status} — không cập nhật / không chuyển sang đã fulfill bằng import.`,
          }
        : {
            ok: false,
            code: 'NOT_SUBMITTED',
            message: `Đơn đang được gửi sang nhà cung cấp (trạng thái ${record.status}) — chờ kết quả rồi import lại.`,
          };
    }

    let baseCost: { itemId: string; before: number | null; changed: boolean; currency: string } | null = null;
    if (row.baseCost !== null) {
      const verdict = resolveOrderLevelBaseCost(record, row.baseCost, MANUAL_BASE_COST_MAX);
      if (!verdict.ok) return { ok: false, code: verdict.reason, message: verdict.message };
      baseCost = { itemId: verdict.itemId, before: verdict.before, changed: !verdict.unchanged, currency: verdict.currency };
    }
    const trackingChanged = row.trackingNumber !== null && row.trackingNumber !== record.trackingNumber;
    const baseCostChanged = baseCost?.changed ?? false;

    const histories = [
      ...(baseCostChanged && baseCost ? [this.baseCostHistory(actorUserId, row, baseCost, row.baseCost as number)] : []),
      ...(trackingChanged ? [this.trackingHistory(actorUserId, row, record.trackingNumber, row.trackingNumber as string)] : []),
    ];
    const plan: PlannedRow = {
      ...this.change(row, orderId, 'UPDATE', {
        before: baseCost?.before ?? this.singleItemCost(record),
        currency: baseCost?.currency ?? record.currency?.toUpperCase() ?? null,
        baseCostChanged,
        trackingBefore: record.trackingNumber,
        trackingChanged,
        statusBefore: record.status,
        statusAfter: record.status,
      }),
      batchCost:
        baseCostChanged && baseCost && !trackingChanged
          ? {
              itemId: baseCost.itemId,
              fulfillmentOrderId: record.id,
              baseCost: row.baseCost as number,
              history: { ...histories[0], organizationId, fulfillmentOrderId: record.id },
            }
          : null,
      write:
        trackingChanged
          ? {
              organizationId,
              actorUserId,
              target: {
                kind: 'EXISTING',
                fulfillmentOrderId: record.id,
                expectedStatus: record.status,
                requireNoProviderOrder: false,
              },
              markFulfilled: false,
              currency: null,
              trackingNumber: row.trackingNumber,
              baseCost: baseCostChanged && baseCost ? { itemId: baseCost.itemId, value: row.baseCost as number } : null,
              histories,
            }
          : null,
    };
    return { ok: true, plan };
  }

  /** Đơn chưa fulfill / `DRAFT` / `FAILED`: ghi Base Cost + Tracking Number và chuyển sang đã fulfill. */
  private planMark(
    organizationId: string,
    actorUserId: string,
    row: RawRow,
    orderId: string,
    ref: { id: string; status: string },
    record: FulfillmentOrderWithRelations | null,
    context: MarkContext,
    hasTrackingColumn: boolean,
  ): RowVerdict {
    if (ref.status === TIKTOK_CANCELLED_STATUS) {
      return { ok: false, code: 'ORDER_CANCELLED', message: 'Đơn TikTok đã bị huỷ — không chuyển sang đã fulfill.' };
    }
    if (record?.providerOrderId) {
      return {
        ok: false,
        code: 'PROVIDER_RECEIVED',
        message:
          `Lần gửi đang ${record.status} nhưng nhà cung cấp ĐÃ có mã đơn (${record.providerOrderId}) — hệ thống sẽ đối ` +
          'soát lấy trạng thái thật; không import đè.',
      };
    }
    if (!hasTrackingColumn) {
      // File cũ (chỉ OrderID · Basecost): giữ đúng mã lỗi cũ, chỉ thêm hướng dẫn.
      return record
        ? {
            ok: false,
            code: 'NOT_SUBMITTED',
            message:
              `Đơn chưa được nhà cung cấp nhận (trạng thái ${record.status}). Muốn đánh dấu đã fulfill: thêm cột ` +
              'Tracking Number và nhập cả Basecost lẫn Tracking Number.',
          }
        : {
            ok: false,
            code: 'NOT_FULFILLED',
            message:
              'Đơn chưa được gửi fulfillment. Muốn đánh dấu đã fulfill: thêm cột Tracking Number và nhập cả Basecost ' +
              'lẫn Tracking Number.',
          };
    }
    if (row.baseCost === null || row.trackingNumber === null) {
      return {
        ok: false,
        code: 'MARK_REQUIRES_BOTH',
        message: `Đơn ${record ? `fulfill thất bại / chưa gửi (${record.status})` : 'chưa fulfill'} — cần CẢ Basecost lẫn Tracking Number để chuyển sang đã fulfill.`,
      };
    }

    const order = context.orders.get(ref.id);
    if (!order) {
      return { ok: false, code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn với OrderID này trong phạm vi bạn quản lý.' };
    }

    // Tài khoản nhà cung cấp: bản ghi đã có giữ nguyên tài khoản của nó; đơn chưa fulfill dùng nhà cung cấp gán cho
    // kết nối TikTok của đơn (cùng nguồn với nút Fulfill).
    const account = record
      ? { id: record.accountId, provider: record.provider }
      : order.account?.fulfillmentAccount
        ? { id: order.account.fulfillmentAccount.id, provider: order.account.fulfillmentAccount.provider }
        : null;
    if (!account) {
      return {
        ok: false,
        code: 'PROVIDER_NOT_ASSIGNED',
        message: `Kết nối TikTok "${order.account?.accountName ?? '—'}" chưa được gán nhà cung cấp fulfillment.`,
      };
    }

    // Dòng hàng: bản ghi đã có dòng ⇒ dùng đúng dòng đó; chưa có ⇒ dựng từ Product Mapping của dòng đơn.
    let item: { itemId: string } | { create: Extract<ImportRowBaseCost, { create: unknown }>['create'] };
    const existingItems = record?.items ?? [];
    if (existingItems.length > 0) {
      const [only, ...rest] = existingItems;
      if (rest.length > 0 || only.quantity !== 1) return this.multiItem(existingItems.length);
      item = { itemId: only.id };
    } else {
      const built = this.itemFromMapping(order, account.id, context);
      if (!built.ok) return built;
      item = { create: built.create };
    }

    const currency = (record?.currency ?? order.currency)?.toUpperCase() ?? null;
    const costError = this.checkCost(row.baseCost, currency);
    if (costError) return costError;

    const before = 'itemId' in item ? this.singleItemCost(record) : null;
    const histories = [
      this.markHistory(actorUserId, row, record),
      this.baseCostHistory(actorUserId, row, { before, currency: currency as string }, row.baseCost),
      this.trackingHistory(actorUserId, row, record?.trackingNumber ?? null, row.trackingNumber),
    ];
    const plan: PlannedRow = {
      ...this.change(row, orderId, 'MARK_FULFILLED', {
        before,
        currency,
        baseCostChanged: true,
        trackingBefore: record?.trackingNumber ?? null,
        trackingChanged: true,
        statusBefore: record?.status ?? null,
        statusAfter: IMPORT_FULFILLED_STATUS,
      }),
      batchCost: null,
      write: {
        organizationId,
        actorUserId,
        target: record
          ? { kind: 'EXISTING', fulfillmentOrderId: record.id, expectedStatus: record.status, requireNoProviderOrder: true }
          : {
              kind: 'CREATE',
              accountId: account.id,
              provider: account.provider,
              podOrderId: ref.id,
              externalOrderId: `${IMPORT_EXTERNAL_ORDER_PREFIX}${orderId}`.slice(0, IMPORT_EXTERNAL_ORDER_MAX),
            },
        markFulfilled: true,
        currency: record?.currency ? null : currency,
        trackingNumber: row.trackingNumber,
        baseCost: 'itemId' in item ? { itemId: item.itemId, value: row.baseCost } : { create: item.create, value: row.baseCost },
        histories,
      },
    };
    return { ok: true, plan };
  }

  /** Dòng hàng cho bản ghi mới: đúng MỘT dòng đơn cần sản xuất, có Product Mapping của đúng nhà cung cấp. */
  private itemFromMapping(
    order: PodOrderWithRelations,
    accountId: string,
    context: MarkContext,
  ):
    | { ok: true; create: Extract<ImportRowBaseCost, { create: unknown }>['create'] }
    | { ok: false; code: string; message: string } {
    // Quà tặng khuyến mãi chưa khai ánh xạ không đi sang nhà cung cấp (như luồng Fulfill) ⇒ không tính.
    const lines = order.items.filter((line) => !(line.isGift && !findMappingInIndex(line, context.mappingIndex)));
    if (lines.length === 0) return { ok: false, code: 'NO_ITEMS', message: 'Đơn không có dòng hàng nào cần fulfill.' };
    if (lines.length > 1) return this.multiItem(lines.length);
    const [line] = lines;
    // Thiếu Seller SKU nhưng có SKU ID ⇒ vẫn có khoá (Product ID + SKU ID) — xem shared/mapping-match.ts.
    if (!itemHasProductKey(line)) {
      const reason = line.productId?.trim() ? ('NO_SKU_ID' as const) : ('NO_PRODUCT_ID' as const);
      return { ok: false, code: 'MAPPING_KEY_MISSING', message: PRODUCT_KEY_ISSUE_MESSAGE[reason] };
    }
    const mapping = findMappingInIndex(line, context.mappingIndex);
    if (!mapping) {
      return {
        ok: false,
        code: 'MAPPING_MISSING',
        message: `Chưa khai báo ánh xạ sản phẩm (Product ID ${line.productId} · Seller SKU ${line.sellerSku}).`,
      };
    }
    if (mapping.accountId !== accountId) {
      return {
        ok: false,
        code: 'MAPPING_PROVIDER_MISMATCH',
        message: 'Ánh xạ sản phẩm khai cho nhà cung cấp KHÁC với nhà cung cấp gán cho kết nối TikTok của đơn.',
      };
    }
    return {
      ok: true,
      create: {
        podOrderItemId: line.id,
        providerSku: mapping.providerSku,
        productionConfig: mapping.productionConfig,
        color: mapping.providerColor,
        size: mapping.providerSize,
      },
    };
  }

  /** Cùng luật số với `resolveOrderLevelBaseCost` cho bản ghi chưa giữ đơn (đơn vị tiền, số lẻ, khoảng giá). */
  private checkCost(value: number, currency: string | null): { ok: false; code: string; message: string } | null {
    if (!Number.isFinite(value) || value < 0 || value > MANUAL_BASE_COST_MAX) {
      return { ok: false, code: 'OUT_OF_RANGE', message: `Base Cost phải trong khoảng 0 – ${MANUAL_BASE_COST_MAX}.` };
    }
    if (!currency) {
      return { ok: false, code: 'CURRENCY_REQUIRED', message: 'Đơn chưa có đơn vị tiền — không ghi được Base Cost.' };
    }
    let digits: number;
    try {
      digits = currencyFractionDigits(currency);
    } catch {
      return { ok: false, code: 'CURRENCY_INVALID', message: `Mã tiền tệ ${currency} không hợp lệ.` };
    }
    if (exceedsFractionDigits(value, digits)) {
      return {
        ok: false,
        code: 'TOO_MANY_DECIMALS',
        message: `${currency} chỉ có ${digits} chữ số thập phân (nhận được ${value}).`,
      };
    }
    return null;
  }

  private multiItem(count: number): { ok: false; code: string; message: string } {
    return {
      ok: false,
      code: 'MULTI_ITEM',
      message: `Đơn có ${count} dòng hàng — một Base Cost cho cả đơn không chia được; nhập từng dòng bằng "Cập nhật Base Cost".`,
    };
  }

  private singleItemCost(record: FulfillmentOrderWithRelations | null): number | null {
    const item = record?.items.length === 1 ? record.items[0] : null;
    return item?.baseCost == null ? null : Number(item.baseCost.toString());
  }

  private change(
    row: RawRow,
    orderId: string,
    action: BaseCostImportChangeDto['action'],
    fields: Pick<
      BaseCostImportChangeDto,
      'before' | 'currency' | 'baseCostChanged' | 'trackingBefore' | 'trackingChanged' | 'statusBefore' | 'statusAfter'
    >,
  ): BaseCostImportChangeDto {
    return {
      row: row.row,
      orderId,
      action,
      after: row.baseCost,
      trackingAfter: row.trackingNumber,
      ...fields,
      unchanged: !fields.baseCostChanged && !fields.trackingChanged && fields.statusBefore === fields.statusAfter,
      applied: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Nhật ký (cùng transaction với lần ghi)
  // ---------------------------------------------------------------------------

  private markHistory(
    actorUserId: string,
    row: RawRow,
    record: FulfillmentOrderWithRelations | null,
  ): Omit<HistoryEntry, 'organizationId' | 'fulfillmentOrderId'> {
    return {
      eventType: FulfillmentEventType.STATUS_CHANGED,
      trigger: FulfillmentTrigger.MANUAL,
      fromStatus: record?.status ?? null,
      toStatus: IMPORT_FULFILLED_STATUS,
      message:
        `Import Excel: đánh dấu đã fulfill (${record?.status ?? 'chưa fulfill'} → ${IMPORT_FULFILLED_STATUS}) — nhập tay ` +
        'Base Cost + Tracking Number, nhà cung cấp KHÔNG xác nhận.',
      payload: {
        source: SOURCE,
        row: row.row,
        createdRecord: record === null,
        // Lần gửi hỏng trước đó — chép lại để bản tóm tắt lỗi trên bản ghi được xoá mà không mất dấu.
        previousError: record?.lastErrorCode
          ? { code: record.lastErrorCode, message: record.lastErrorMessage }
          : null,
      },
      performedBy: actorUserId,
    };
  }

  private baseCostHistory(
    actorUserId: string,
    row: RawRow,
    cost: { itemId?: string; before: number | null; currency: string },
    after: number,
  ): Omit<HistoryEntry, 'organizationId' | 'fulfillmentOrderId'> {
    return {
      eventType: FulfillmentEventType.BASE_COST_MANUAL_UPDATED,
      trigger: FulfillmentTrigger.MANUAL,
      message: `Import Base Cost (Excel): ${cost.before ?? '—'} → ${after} ${cost.currency}`,
      payload: {
        source: SOURCE,
        row: row.row,
        before: [{ itemId: cost.itemId ?? null, baseCost: cost.before }],
        after: [{ itemId: cost.itemId ?? null, baseCost: after }],
        currencyBefore: cost.currency,
        currencyAfter: cost.currency,
      },
      performedBy: actorUserId,
    };
  }

  private trackingHistory(
    actorUserId: string,
    row: RawRow,
    before: string | null,
    after: string,
  ): Omit<HistoryEntry, 'organizationId' | 'fulfillmentOrderId'> {
    return {
      eventType: FulfillmentEventType.SHIPMENT_UPDATED,
      trigger: FulfillmentTrigger.MANUAL,
      message: `Import Excel: mã vận đơn ${before ?? '—'} → ${after}`,
      payload: { source: SOURCE, row: row.row, trackingBefore: before, trackingAfter: after },
      performedBy: actorUserId,
    };
  }

  // ---------------------------------------------------------------------------
  // Ghi
  // ---------------------------------------------------------------------------

  /**
   * Ghi các dòng đã kiểm; trả lỗi của dòng ghi hỏng (dòng đó đã rollback, các dòng khác không bị ảnh hưởng).
   *
   * Dòng CHỈ đổi Base Cost ⇒ một câu UPDATE gộp như trước (nhanh với file vài nghìn dòng). Lô đó hỏng vì dữ liệu đổi
   * giữa chừng ⇒ ghi lại từng dòng để chỉ dòng thật sự cũ bị báo lỗi. Dòng còn lại (Tracking / đánh dấu đã fulfill)
   * ⇒ mỗi dòng MỘT transaction.
   */
  private async write(organizationId: string, plans: PlannedRow[]): Promise<BaseCostImportErrorDto[]> {
    const failures: BaseCostImportErrorDto[] = [];
    const batch = plans.filter((plan) => plan.batchCost);
    if (batch.length > 0) {
      try {
        await this.writeCosts(organizationId, batch);
        for (const plan of batch) plan.applied = true;
      } catch {
        for (const plan of batch) {
          try {
            await this.writeCosts(organizationId, [plan]);
            plan.applied = true;
          } catch (error) {
            failures.push(this.writeFailure(plan, error));
          }
        }
      }
    }
    for (const plan of plans) {
      if (!plan.write) continue;
      try {
        await this.repo.applyImportRow({ ...plan.write, onStale: () => new FulfillmentBaseCostImportStaleException() });
        plan.applied = true;
      } catch (error) {
        failures.push(this.writeFailure(plan, error));
      }
    }
    return failures;
  }

  private writeCosts(organizationId: string, plans: PlannedRow[]): Promise<void> {
    const costs = plans.map((plan) => plan.batchCost as NonNullable<PlannedRow['batchCost']>);
    return this.repo.applyManualItemCostsBatch({
      organizationId,
      costs: costs.map(({ itemId, fulfillmentOrderId, baseCost }) => ({ itemId, fulfillmentOrderId, baseCost })),
      histories: costs.map((cost) => cost.history),
      timeoutMs: BASE_COST_IMPORT_TX_TIMEOUT_MS,
      onStale: () => new FulfillmentBaseCostImportStaleException(),
    });
  }

  private writeFailure(plan: PlannedRow, error: unknown): BaseCostImportErrorDto {
    const stale = error instanceof FulfillmentBaseCostImportStaleException;
    if (!stale) {
      // Không ghi nội dung dòng (mã vận đơn…) — chỉ vị trí + loại lỗi.
      this.logger.error({
        module: 'fulfillment',
        operation: 'base-cost.import.write',
        row: plan.row,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Ghi một dòng Import Excel thất bại — đã rollback dòng này',
      });
    }
    return {
      row: plan.row,
      orderId: plan.orderId,
      code: stale ? 'WRITE_STALE' : 'WRITE_FAILED',
      message: stale
        ? 'Đơn vừa thay đổi lần fulfill trong lúc import — dòng này CHƯA được ghi, hãy import lại.'
        : 'Ghi dòng này thất bại — dòng CHƯA được ghi (không đổi trạng thái), hãy thử lại.',
    };
  }

  /** Đơn (kèm khoá sản phẩm) + Product Mapping cho các dòng sẽ đánh dấu đã fulfill — chỉ nạp khi có dòng như vậy. */
  private async loadMarkContext(
    organizationId: string,
    rowsByOrderId: Map<string, RawRow[]>,
    refOf: Map<string, { id: string }>,
    records: Map<string, FulfillmentOrderWithRelations>,
  ): Promise<MarkContext> {
    const podOrderIds = [...rowsByOrderId.entries()].flatMap(([orderId, [row]]) => {
      const ref = refOf.get(orderId);
      if (!ref || row.baseCost === null || row.trackingNumber === null) return [];
      const record = records.get(ref.id);
      return !record || IMPORT_MARKABLE_STATUSES.includes(record.status) ? [ref.id] : [];
    });
    if (podOrderIds.length === 0) return { orders: new Map(), mappingIndex: new Map() };
    const orders = await this.podOrderRepo.findManyByIds(organizationId, podOrderIds);
    const mappings = await this.repo.listMappingsForProducts(
      organizationId,
      productIdsOf(orders.flatMap((order) => order.items)),
    );
    return {
      orders: new Map(orders.map((order) => [order.id, order])),
      mappingIndex: createMappingIndex(mappings.filter((mapping) => mapping.isActive)),
    };
  }

  // ---------------------------------------------------------------------------
  // Đọc file
  // ---------------------------------------------------------------------------

  /**
   * Sheet ĐẦU TIÊN, dòng 1 là header. Nhận diện cột theo TÊN (không phụ thuộc thứ tự); cột lạ bị bỏ qua và báo lại.
   * Bắt buộc `OrderID` + ít nhất một trong `Basecost` / `Tracking Number`; lặp cột ⇒ lỗi cả file. Dòng trống hoàn
   * toàn bị bỏ qua (không tính).
   */
  private async readFile(
    buffer: Buffer,
  ): Promise<{ rows: RawRow[]; ignoredHeaders: string[]; hasTrackingColumn: boolean }> {
    // `.xlsx` là file ZIP — kiểm chữ ký thay vì tin MIME / đuôi file client gửi.
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new FulfillmentBaseCostImportInvalidException('FORMAT', 'File không phải Excel .xlsx hợp lệ.');
    }
    let workbook: ExcelJS.Workbook;
    try {
      workbook = await bufferToWorkbook(buffer);
    } catch {
      throw new FulfillmentBaseCostImportInvalidException('FORMAT', 'Không đọc được file Excel — file hỏng hoặc sai định dạng.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.actualRowCount === 0) {
      throw new FulfillmentBaseCostImportInvalidException('EMPTY', 'File không có dữ liệu.');
    }

    const found: { orderId: number[]; baseCost: number[]; trackingNumber: number[] } = {
      orderId: [],
      baseCost: [],
      trackingNumber: [],
    };
    const ignoredHeaders: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const raw = cellToString(cell.value);
      if (!raw) return;
      const key = headerKey(raw);
      const field = (Object.keys(found) as Array<keyof typeof found>).find((name) =>
        (BASE_COST_IMPORT_HEADERS[name] as readonly string[]).includes(key),
      );
      if (field) found[field].push(col);
      else ignoredHeaders.push(raw);
    });
    if (found.orderId.length === 0 || (found.baseCost.length === 0 && found.trackingNumber.length === 0)) {
      const missing = [
        found.orderId.length === 0 && 'OrderID',
        found.baseCost.length === 0 && found.trackingNumber.length === 0 && 'Basecost hoặc Tracking Number',
      ].filter(Boolean);
      throw new FulfillmentBaseCostImportInvalidException(
        'MISSING_COLUMN',
        `Thiếu cột ${missing.join(', ')} ở dòng 1. File cần cột OrderID và ít nhất một trong Basecost, Tracking Number.`,
      );
    }
    if (found.orderId.length > 1 || found.baseCost.length > 1 || found.trackingNumber.length > 1) {
      throw new FulfillmentBaseCostImportInvalidException(
        'DUPLICATE_COLUMN',
        'Cột OrderID, Basecost hoặc Tracking Number xuất hiện nhiều lần ở dòng 1.',
      );
    }
    const columns: FileColumns = {
      orderId: found.orderId[0],
      baseCost: found.baseCost[0] ?? null,
      trackingNumber: found.trackingNumber[0] ?? null,
    };

    const rows: RawRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const cells = {
        orderId: excelRow.getCell(columns.orderId).value,
        baseCost: columns.baseCost === null ? null : excelRow.getCell(columns.baseCost).value,
        trackingNumber: columns.trackingNumber === null ? null : excelRow.getCell(columns.trackingNumber).value,
      };
      if (!cellToString(cells.orderId) && !cellToString(cells.baseCost) && !cellToString(cells.trackingNumber)) continue;
      if (rows.length >= BASE_COST_IMPORT_MAX_ROWS) {
        throw new FulfillmentBaseCostImportInvalidException(
          'TOO_MANY_ROWS',
          `File vượt giới hạn ${BASE_COST_IMPORT_MAX_ROWS} dòng mỗi lần import — hãy chia nhỏ file.`,
        );
      }
      rows.push(this.parseRow(r, cells, columns));
    }
    if (rows.length === 0) {
      throw new FulfillmentBaseCostImportInvalidException('EMPTY', 'File không có dòng dữ liệu nào dưới header.');
    }
    return { rows, ignoredHeaders, hasTrackingColumn: columns.trackingNumber !== null };
  }

  private parseRow(
    row: number,
    cells: { orderId: ExcelJS.CellValue; baseCost: ExcelJS.CellValue; trackingNumber: ExcelJS.CellValue },
    columns: FileColumns,
  ): RawRow {
    const fail = (orderId: string | null, code: string, message: string): RawRow => ({
      row,
      orderId,
      baseCost: null,
      trackingNumber: null,
      error: { row, orderId, code, message },
    });

    const orderText = cellToString(cells.orderId);
    if (!orderText) return fail(null, 'ORDER_ID_REQUIRED', 'Thiếu OrderID.');
    // Ô kiểu SỐ chứa mã > 15–16 chữ số đã bị Excel làm tròn (TikTok Order ID dài 18 chữ số) — không đoán lại.
    if (typeof cells.orderId === 'number' && !Number.isSafeInteger(cells.orderId)) {
      return fail(
        orderText,
        'ORDER_ID_PRECISION_LOST',
        'OrderID bị Excel lưu dạng số và đã mất chữ số — định dạng cột OrderID là Text rồi nhập lại.',
      );
    }
    if (!ORDER_ID_PATTERN.test(orderText)) {
      return fail(orderText, 'ORDER_ID_INVALID', 'OrderID chỉ gồm chữ, số, "-" hoặc "_" (tối đa 64 ký tự).');
    }

    const costText = cellToString(cells.baseCost);
    const trackingText = cellToString(cells.trackingNumber).trim();
    if (!costText && !trackingText) {
      // File cũ (không có cột Tracking Number): giữ mã lỗi cũ — ô trống không được hiểu là 0.
      return columns.trackingNumber === null
        ? fail(orderText, 'BASE_COST_REQUIRED', 'Thiếu Basecost (để trống không được hiểu là 0).')
        : fail(orderText, 'NOTHING_TO_UPDATE', 'Dòng không có Basecost lẫn Tracking Number — không có gì để cập nhật.');
    }

    let baseCost: number | null = null;
    if (costText) {
      if (typeof cells.baseCost === 'number') {
        baseCost = cells.baseCost;
      } else if (DECIMAL_PATTERN.test(costText)) {
        baseCost = Number(costText);
      } else {
        return fail(
          orderText,
          'BASE_COST_INVALID',
          `Basecost "${costText.slice(0, 40)}" không phải số hợp lệ (dùng dấu chấm thập phân, không ký hiệu tiền).`,
        );
      }
      if (!Number.isFinite(baseCost) || baseCost < 0 || baseCost > MANUAL_BASE_COST_MAX) {
        return fail(orderText, 'OUT_OF_RANGE', `Basecost phải trong khoảng 0 – ${MANUAL_BASE_COST_MAX}.`);
      }
    }

    let trackingNumber: string | null = null;
    if (trackingText) {
      // Mã vận đơn dài (USPS 22 chữ số) lưu dạng SỐ đã bị Excel làm tròn — không đoán lại.
      if (typeof cells.trackingNumber === 'number' && !Number.isSafeInteger(cells.trackingNumber)) {
        return fail(
          orderText,
          'TRACKING_PRECISION_LOST',
          'Tracking Number bị Excel lưu dạng số và đã mất chữ số — định dạng cột là Text rồi nhập lại.',
        );
      }
      if (!TRACKING_PATTERN.test(trackingText)) {
        return fail(
          orderText,
          'TRACKING_INVALID',
          `Tracking Number "${trackingText.slice(0, 40)}" không hợp lệ — chỉ chữ, số, "-", "_", không khoảng trắng, ` +
            `3–${IMPORT_TRACKING_NUMBER_MAX} ký tự.`,
        );
      }
      trackingNumber = trackingText;
    }
    return { row, orderId: orderText, baseCost, trackingNumber, error: null };
  }
}

interface MarkContext {
  orders: Map<string, PodOrderWithRelations>;
  mappingIndex: Map<string, Awaited<ReturnType<FulfillmentRepository['listMappingsForProducts']>>[number]>;
}
