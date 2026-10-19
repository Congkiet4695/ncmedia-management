import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentEventType, FulfillmentTrigger } from '@prisma/client';
import type ExcelJS from 'exceljs';
import { bufferToWorkbook, cellToString, normalizeHeader } from '../../../common/excel/excel.util';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  BASE_COST_IMPORT_HEADERS,
  BASE_COST_IMPORT_MAX_ROWS,
  BASE_COST_IMPORT_TX_TIMEOUT_MS,
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
import { FulfillmentRepository, type HistoryEntry } from '../repositories/fulfillment.repository';
import { resolveOrderLevelBaseCost } from '../shared/manual-base-cost';

/** Một dòng dữ liệu đã đọc từ file (chưa kiểm nghiệp vụ). */
interface RawRow {
  row: number;
  orderId: string | null;
  baseCost: number | null;
  error: BaseCostImportErrorDto | null;
}

/** TikTok Order ID: chữ số / chữ cái, tối đa 64 ký tự (cột `tiktok_order_id` VarChar(64)). */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Số thập phân không dấu, dấu chấm thập phân — không nhận `12,5`, `$12`, `1e3`. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/** Khoá so khớp header: chuẩn hoá chung của dự án rồi bỏ khoảng trắng, `_`, `-`. */
const headerKey = (raw: string): string => normalizeHeader(raw).replace(/[\s_-]+/g, '');

/**
 * **Import Base Cost bằng Excel** — Admin tải lên file 2 cột `OrderID` · `Basecost`.
 *
 * Chính sách (🔴 ATOMIC):
 *  1. Đọc + kiểm TOÀN BỘ file trước khi ghi. Lỗi từng dòng ghi rõ số dòng Excel + lý do.
 *  2. Chỉ cần MỘT dòng lỗi ⇒ `REJECTED`, không ghi đơn nào. Không có import "một phần".
 *  3. `dryRun` ⇒ trả bản xem trước (`READY` / `REJECTED`), không ghi. Bước xác nhận gửi lại CÙNG file và
 *     server kiểm lại từ đầu trên dữ liệu mới nhất (không tin kết quả xem trước).
 *  4. Ghi tất cả trong MỘT transaction (một câu UPDATE gộp + nhật ký từng đơn). Dòng có giá đã đúng
 *     (`unchanged`) không ghi lại ⇒ gửi lại cùng file không tạo nhật ký / thay đổi thừa.
 *
 * Luật mỗi dòng trùng sửa tại chỗ (`resolveOrderLevelBaseCost`): chỉ đơn đã fulfill, đúng MỘT dòng hàng,
 * đơn vị tiền có sẵn, số lẻ theo đơn vị tiền. OrderID trùng trong file ⇒ MỌI dòng trùng đều lỗi (không tự
 * chọn dòng đầu/cuối). OrderID không có / ngoài phạm vi shop ⇒ `ORDER_NOT_FOUND` (không phân biệt, để không
 * lộ đơn của người khác). Không bao giờ tạo đơn mới; chỉ ghi `base_cost` của dòng hàng.
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
    const { rows, ignoredHeaders } = await this.readFile(buffer);

    const errors: BaseCostImportErrorDto[] = rows.flatMap((row) => (row.error ? [row.error] : []));
    let duplicateRows = 0;

    // OrderID trùng trong file — đánh lỗi MỌI dòng của mã đó (kể cả dòng đã lỗi Basecost, để sửa một lần là đủ).
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
    const candidateIds = [...rowsByOrderId.keys()];
    const refs = await this.podOrderRepo.findRefsByTiktokOrderIds(
      organizationId,
      candidateIds,
      scope.allShops ? null : scope.shopIds,
    );
    const podOrderIdOf = new Map(refs.map((ref) => [ref.tiktokOrderId, ref.id]));
    const records = await this.repo.findCurrentByPodOrders(
      organizationId,
      refs.map((ref) => ref.id),
    );

    let notFoundRows = 0;
    const changes: Array<BaseCostImportChangeDto & { itemId: string; fulfillmentOrderId: string; podOrderId: string }> =
      [];
    for (const [orderId, [row]] of rowsByOrderId) {
      const podOrderId = podOrderIdOf.get(orderId);
      if (!podOrderId) {
        notFoundRows += 1;
        errors.push({
          row: row.row,
          orderId,
          code: 'ORDER_NOT_FOUND',
          message: 'Không tìm thấy đơn với OrderID này trong phạm vi bạn quản lý.',
        });
        continue;
      }
      const record = records.get(podOrderId) ?? null;
      const verdict = resolveOrderLevelBaseCost(record, row.baseCost as number, MANUAL_BASE_COST_MAX);
      if (!verdict.ok || !record) {
        errors.push({
          row: row.row,
          orderId,
          code: verdict.ok ? 'NOT_FULFILLED' : verdict.reason,
          message: verdict.ok ? 'Đơn chưa được gửi fulfillment.' : verdict.message,
        });
        continue;
      }
      changes.push({
        row: row.row,
        orderId,
        before: verdict.before,
        after: row.baseCost as number,
        currency: verdict.currency,
        unchanged: verdict.unchanged,
        itemId: verdict.itemId,
        fulfillmentOrderId: record.id,
        podOrderId,
      });
    }

    errors.sort((a, b) => a.row - b.row);
    changes.sort((a, b) => a.row - b.row);
    const invalidRows = new Set(errors.map((error) => error.row)).size;
    const toWrite = changes.filter((change) => !change.unchanged);
    const status: BaseCostImportResultDto['status'] =
      invalidRows > 0 ? 'REJECTED' : dryRun ? 'READY' : 'APPLIED';

    if (status === 'APPLIED' && toWrite.length > 0) {
      await this.repo.applyManualItemCostsBatch({
        organizationId,
        costs: toWrite.map((change) => ({
          itemId: change.itemId,
          fulfillmentOrderId: change.fulfillmentOrderId,
          baseCost: change.after,
        })),
        histories: toWrite.map(
          (change): HistoryEntry => ({
            organizationId,
            fulfillmentOrderId: change.fulfillmentOrderId,
            eventType: FulfillmentEventType.BASE_COST_MANUAL_UPDATED,
            trigger: FulfillmentTrigger.MANUAL,
            message: `Import Base Cost (Excel): ${change.before ?? '—'} → ${change.after} ${change.currency}`,
            payload: {
              source: 'EXCEL_IMPORT',
              row: change.row,
              before: [{ itemId: change.itemId, baseCost: change.before }],
              after: [{ itemId: change.itemId, baseCost: change.after }],
              currencyBefore: change.currency,
              currencyAfter: change.currency,
            },
            performedBy: actorUserId,
          }),
        ),
        timeoutMs: BASE_COST_IMPORT_TX_TIMEOUT_MS,
        onStale: () => new FulfillmentBaseCostImportStaleException(),
      });
    }

    const result: BaseCostImportResultDto = {
      dryRun,
      status,
      totalRows: rows.length,
      validRows: changes.length,
      invalidRows,
      notFoundRows,
      duplicateRows,
      unchangedRows: changes.length - toWrite.length,
      updatedOrders: status === 'APPLIED' ? toWrite.length : 0,
      ignoredHeaders,
      errors,
      changes: changes.map(({ row, orderId, before, after, currency, unchanged }) => ({
        row,
        orderId,
        before,
        after,
        currency,
        unchanged,
      })),
    };

    // Chỉ số liệu tổng hợp — không ghi nội dung file vào log.
    this.logger.log({
      module: 'fulfillment',
      operation: 'base-cost.import',
      organizationId,
      performedBy: actorUserId,
      dryRun,
      status,
      totalRows: result.totalRows,
      invalidRows,
      updatedOrders: result.updatedOrders,
      unchangedRows: result.unchangedRows,
      msg: 'Import Base Cost (Excel)',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Đọc file
  // ---------------------------------------------------------------------------

  /**
   * Sheet ĐẦU TIÊN, dòng 1 là header. Nhận diện cột theo TÊN (không phụ thuộc thứ tự); cột lạ bị bỏ qua
   * và báo lại; thiếu / lặp cột bắt buộc ⇒ lỗi cả file. Dòng trống hoàn toàn bị bỏ qua (không tính).
   */
  private async readFile(buffer: Buffer): Promise<{ rows: RawRow[]; ignoredHeaders: string[] }> {
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

    const columns: { orderId: number[]; baseCost: number[] } = { orderId: [], baseCost: [] };
    const ignoredHeaders: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const raw = cellToString(cell.value);
      if (!raw) return;
      const key = headerKey(raw);
      if ((BASE_COST_IMPORT_HEADERS.orderId as readonly string[]).includes(key)) columns.orderId.push(col);
      else if ((BASE_COST_IMPORT_HEADERS.baseCost as readonly string[]).includes(key)) columns.baseCost.push(col);
      else ignoredHeaders.push(raw);
    });
    const missing = [columns.orderId.length === 0 && 'OrderID', columns.baseCost.length === 0 && 'Basecost'].filter(
      Boolean,
    );
    if (missing.length > 0) {
      throw new FulfillmentBaseCostImportInvalidException(
        'MISSING_COLUMN',
        `Thiếu cột ${missing.join(', ')} ở dòng 1. File cần đúng 2 cột: OrderID, Basecost.`,
      );
    }
    if (columns.orderId.length > 1 || columns.baseCost.length > 1) {
      throw new FulfillmentBaseCostImportInvalidException(
        'DUPLICATE_COLUMN',
        'Cột OrderID hoặc Basecost xuất hiện nhiều lần ở dòng 1.',
      );
    }
    const [orderIdCol] = columns.orderId;
    const [baseCostCol] = columns.baseCost;

    const rows: RawRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const orderCell = excelRow.getCell(orderIdCol).value;
      const costCell = excelRow.getCell(baseCostCol).value;
      const orderText = cellToString(orderCell);
      const costText = cellToString(costCell);
      if (!orderText && !costText) continue;
      if (rows.length >= BASE_COST_IMPORT_MAX_ROWS) {
        throw new FulfillmentBaseCostImportInvalidException(
          'TOO_MANY_ROWS',
          `File vượt giới hạn ${BASE_COST_IMPORT_MAX_ROWS} dòng mỗi lần import — hãy chia nhỏ file.`,
        );
      }
      rows.push(this.parseRow(r, orderCell, orderText, costCell, costText));
    }
    if (rows.length === 0) {
      throw new FulfillmentBaseCostImportInvalidException('EMPTY', 'File không có dòng dữ liệu nào dưới header.');
    }
    return { rows, ignoredHeaders };
  }

  private parseRow(
    row: number,
    orderCell: ExcelJS.CellValue,
    orderText: string,
    costCell: ExcelJS.CellValue,
    costText: string,
  ): RawRow {
    const fail = (orderId: string | null, code: string, message: string): RawRow => ({
      row,
      orderId,
      baseCost: null,
      error: { row, orderId, code, message },
    });

    if (!orderText) return fail(null, 'ORDER_ID_REQUIRED', 'Thiếu OrderID.');
    // Ô kiểu SỐ chứa mã > 15–16 chữ số đã bị Excel làm tròn (TikTok Order ID dài 18 chữ số) — không đoán lại.
    if (typeof orderCell === 'number' && !Number.isSafeInteger(orderCell)) {
      return fail(
        orderText,
        'ORDER_ID_PRECISION_LOST',
        'OrderID bị Excel lưu dạng số và đã mất chữ số — định dạng cột OrderID là Text rồi nhập lại.',
      );
    }
    if (!ORDER_ID_PATTERN.test(orderText)) {
      return fail(orderText, 'ORDER_ID_INVALID', 'OrderID chỉ gồm chữ, số, "-" hoặc "_" (tối đa 64 ký tự).');
    }

    if (!costText) {
      return fail(orderText, 'BASE_COST_REQUIRED', 'Thiếu Basecost (để trống không được hiểu là 0).');
    }
    let value: number;
    if (typeof costCell === 'number') {
      value = costCell;
    } else if (DECIMAL_PATTERN.test(costText)) {
      value = Number(costText);
    } else {
      return fail(
        orderText,
        'BASE_COST_INVALID',
        `Basecost "${costText.slice(0, 40)}" không phải số hợp lệ (dùng dấu chấm thập phân, không ký hiệu tiền).`,
      );
    }
    if (!Number.isFinite(value) || value < 0 || value > MANUAL_BASE_COST_MAX) {
      return fail(orderText, 'OUT_OF_RANGE', `Basecost phải trong khoảng 0 – ${MANUAL_BASE_COST_MAX}.`);
    }
    return { row, orderId: orderText, baseCost: value, error: null };
  }
}
