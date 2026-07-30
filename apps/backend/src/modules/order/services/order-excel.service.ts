import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { OrderItemStatus, OrderNoteType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ImportResultDto,
  ImportRowErrorDto,
} from '../../../common/excel/import-result.dto';
import {
  addSheet,
  bufferToWorkbook,
  normalizeHeader,
  parseFlexibleDateCell,
  readSheet,
  workbookToBuffer,
} from '../../../common/excel/excel.util';
import { ORDER_LOG_ACTION } from '../constants/order.constants';
import {
  DATE_FORMAT_HINT,
  EXCEL_DATETIME_FORMAT,
  EXCEL_MONEY_FORMAT,
  EXPORT_ONLY_COLUMN,
  INSTRUCTIONS_SHEET,
  ITEM_COLUMN,
  ITEM_HEADERS,
  ITEMS_SHEET,
  NOTE_COLUMN,
  NOTE_HEADERS,
  NOTES_SHEET,
  ORDER_COLUMNS,
  ORDER_COLUMN_ORDER,
  ORDER_EXPORT_HEADERS,
  ORDER_IMPORT_MAX_ROWS,
  ORDER_IMPORT_TX_MAX_WAIT_MS,
  ORDER_IMPORT_TX_TIMEOUT_MS,
  ORDER_ITEM_STATUS_CODES,
  ORDER_NOTE_TYPE_CODES,
  ORDER_STATUS_CODES,
  ORDER_TEMPLATE_HEADERS,
  ORDERS_SHEET,
  PLATFORM_DERIVE_ERROR,
  REFERENCE_SHEET,
  UUID_RE,
  type OrderColumnKey,
} from '../constants/order-excel.constants';

interface ItemInput {
  productName: string;
  productLink?: string | null;
  color?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  trackingNumber?: string | null;
  fulfillmentStatus: OrderItemStatus;
  image?: string | null;
  remark?: string | null;
}

interface NoteInput {
  type: OrderNoteType;
  content: string;
}

/** Một Account trong bộ tra cứu import. */
interface AccountEntry {
  id: string;
  sellerUserId: string | null;
  platformCode: string | null;
}

/** Bộ tra cứu nạp MỘT lần cho cả file (chống N+1). */
interface ImportLookups {
  /** platform code/name (lowercase) → code chuẩn. */
  platformByKey: Map<string, string>;
  /** `name||platformCode` → danh sách Account (>1 = trùng tên trên cùng nền tảng). */
  accountsByNameAndPlatform: Map<string, AccountEntry[]>;
  /** `name` → danh sách Account thuộc mọi nền tảng (dùng khi Platform để trống). */
  accountsByName: Map<string, AccountEntry[]>;
}

/** Dòng Orders đã validate — sẵn sàng ghi. */
interface PreparedOrder {
  key: string;
  orderNumber: string;
  platformCode: string;
  accountId: string;
  shippingAddress: string;
  currency: string;
  status: OrderStatus;
  orderedAt: Date | null;
  itemInputs: ItemInput[];
  noteInputs: NoteInput[];
}

/** Dòng Orders cho luồng import update (theo ID). */
interface PreparedUpdate {
  rowNum: number;
  id: string;
  shippingAddress: string;
  currency: string;
  status: OrderStatus;
  orderedAt: Date | null;
  hasItems: boolean;
  itemInputs: ItemInput[];
  hasNotes: boolean;
  noteInputs: NoteInput[];
}

/** Sheet Orders đã đọc: map cột + các dòng. */
interface OrdersSheet {
  headerByKey: Map<OrderColumnKey, string>;
  idHeader?: string;
  rows: Array<{ rowNumber: number; cells: Record<string, string> }>;
  sheetName: string;
}

/**
 * OrderExcelService — Import/Export/Template Excel cho Order.
 *
 * Sheet: `Orders` + `Order Items` + `Order Notes` (round-trip đầy đủ) + `Instructions` + `Reference`.
 * Cột được khai báo tập trung ở `order-excel.constants.ts` nên Template / Import / Export
 * **luôn đồng bộ**.
 *
 * Nguyên tắc:
 * - Tenant isolation: mọi truy vấn kèm `organizationId`; `sellerScope` = userId (Employee chỉ
 *   Account mình quản lý) hoặc undefined (Admin — toàn bộ).
 * - Validate TOÀN BỘ file trước; chỉ ghi khi sạch lỗi, trong MỘT transaction (lỗi → rollback hết).
 * - Chống N+1: nạp platform/account/order hiện có một lần; ghi bằng `createMany` theo lô.
 */
@Injectable()
export class OrderExcelService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // TEMPLATE
  // ==========================================================================

  async buildExample(): Promise<Buffer> {
    const platforms = await this.loadPlatforms();
    const sampleOrderNumber = 'ORD-SAMPLE-001';

    const wb = new ExcelJS.Workbook();
    const ordersWs = addSheet(
      wb,
      ORDERS_SHEET,
      ORDER_TEMPLATE_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [ORDER_COLUMNS.orderNumber.header]: sampleOrderNumber,
          [ORDER_COLUMNS.platform.header]: platforms[0]?.code ?? '',
          [ORDER_COLUMNS.account.header]: 'TTS Sample 01',
          [ORDER_COLUMNS.orderDate.header]: '2026-03-10',
          [ORDER_COLUMNS.shippingAddress.header]: '123 Main St, City, US',
          [ORDER_COLUMNS.currency.header]: 'USD',
          [ORDER_COLUMNS.status.header]: OrderStatus.WAITING,
        },
      ],
    );
    ordersWs.getColumn(ORDER_COLUMNS.orderDate.header).numFmt = EXCEL_DATETIME_FORMAT;

    const itemsWs = addSheet(
      wb,
      ITEMS_SHEET,
      ITEM_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [ITEM_COLUMN.orderId]: '',
          [ITEM_COLUMN.orderNumber]: sampleOrderNumber,
          [ITEM_COLUMN.productName]: 'T-Shirt',
          [ITEM_COLUMN.color]: 'Black',
          [ITEM_COLUMN.size]: 'XL',
          [ITEM_COLUMN.quantity]: 2,
          [ITEM_COLUMN.unitPrice]: 19.9,
          [ITEM_COLUMN.trackingNumber]: '',
          [ITEM_COLUMN.fulfillmentStatus]: OrderItemStatus.PENDING,
        },
        {
          [ITEM_COLUMN.orderId]: '',
          [ITEM_COLUMN.orderNumber]: sampleOrderNumber,
          [ITEM_COLUMN.productName]: 'Poster',
          [ITEM_COLUMN.size]: 'A3',
          [ITEM_COLUMN.quantity]: 1,
          [ITEM_COLUMN.unitPrice]: 6.0,
          [ITEM_COLUMN.fulfillmentStatus]: OrderItemStatus.PENDING,
        },
      ],
    );
    itemsWs.getColumn(ITEM_COLUMN.unitPrice).numFmt = EXCEL_MONEY_FORMAT;

    addSheet(
      wb,
      NOTES_SHEET,
      NOTE_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [NOTE_COLUMN.orderId]: '',
          [NOTE_COLUMN.orderNumber]: sampleOrderNumber,
          [NOTE_COLUMN.type]: OrderNoteType.SELLER,
          [NOTE_COLUMN.content]: 'Khách yêu cầu giao nhanh',
        },
        {
          [NOTE_COLUMN.orderId]: '',
          [NOTE_COLUMN.orderNumber]: sampleOrderNumber,
          [NOTE_COLUMN.type]: OrderNoteType.WAREHOUSE,
          [NOTE_COLUMN.content]: 'Đóng gói cẩn thận',
        },
      ],
    );

    this.addInstructionsSheet(wb);
    this.addReferenceSheet(wb, platforms);
    return workbookToBuffer(wb);
  }

  /** Sheet Instructions — hướng dẫn nhập (yêu cầu II & VII). */
  private addInstructionsSheet(wb: ExcelJS.Workbook): void {
    const headersOf = (required: boolean): string =>
      ORDER_COLUMN_ORDER.filter((k) => ORDER_COLUMNS[k].required === required)
        .map((k) => ORDER_COLUMNS[k].header)
        .join(' · ');
    const row = (item: string, detail: string): Record<string, string> => ({ item, detail });

    addSheet(
      wb,
      INSTRUCTIONS_SHEET,
      [
        { header: 'Mục', key: 'item', width: 26 },
        { header: 'Nội dung', key: 'detail', width: 110 },
      ],
      [
        row('Sheet dữ liệu', `Nhập đơn ở sheet "${ORDERS_SHEET}", sản phẩm ở "${ITEMS_SHEET}", ghi chú ở "${NOTES_SHEET}".`),
        row('Liên kết các sheet', `Dùng cột "${ITEM_COLUMN.orderNumber}" ở sheet "${ITEMS_SHEET}"/"${NOTES_SHEET}" để trỏ về đơn tương ứng. Mỗi đơn phải có ít nhất 1 sản phẩm.`),
        row('Dòng ví dụ', 'Các dòng dữ liệu mẫu chỉ để minh hoạ định dạng — HÃY XOÁ trước khi import.'),
        row('Không sửa Header', 'Giữ nguyên dòng 1 (tên cột) ở mọi sheet. Đổi hoặc xoá tên cột sẽ khiến import thất bại.'),
        row('Cột bắt buộc (Orders)', headersOf(true)),
        row('Cột tuỳ chọn (Orders)', headersOf(false)),
        row(
          ORDER_COLUMNS.orderDate.header,
          `Ngày đặt đơn. Chấp nhận: ${DATE_FORMAT_HINT}. Ví dụ: 10/03/2026 · 2026-03-10 · ô định dạng Date của Excel. ` +
            'Lưu ý dd/MM/yyyy là NGÀY trước THÁNG (10/03/2026 = ngày 10 tháng 3). ' +
            'Bỏ trống khi tạo mới → lấy thời điểm import; khi import update → giữ nguyên giá trị hiện tại. ' +
            'Ngày không hợp lệ (VD 31/02/2026) sẽ báo lỗi và KHÔNG import dòng nào.',
        ),
        row(
          ORDER_COLUMNS.platform.header,
          'Mã hoặc tên nền tảng (xem sheet Reference). ' +
            'NẾU ĐỂ TRỐNG, hệ thống sẽ TỰ ĐỘNG LẤY PLATFORM TỪ ACCOUNT nếu Account tồn tại. ' +
            `Không tìm thấy Account → "${PLATFORM_DERIVE_ERROR.accountNotFound}". ` +
            `Trùng tên Account trên nhiều nền tảng → "${PLATFORM_DERIVE_ERROR.multipleAccounts}".`,
        ),
        row(
          ORDER_COLUMNS.account.header,
          'Tên Account bán hàng (phải thuộc tổ chức của bạn). Khi có Platform, Account được tìm theo (tên + nền tảng); khi Platform trống, tìm theo tên trên mọi nền tảng.',
        ),
        row(ORDER_COLUMNS.status.header, `${ORDER_STATUS_CODES.join(' · ')}. Bỏ trống → ${OrderStatus.WAITING}.`),
        row('Fulfillment Status (Items)', `${ORDER_ITEM_STATUS_CODES.join(' · ')}. Bỏ trống → ${OrderItemStatus.PENDING}.`),
        row('Type (Notes)', ORDER_NOTE_TYPE_CODES.join(' · ')),
        row('Quantity / Unit Price', 'Quantity là số nguyên >= 1. Unit Price là số >= 0.'),
        row(
          'Cột chỉ đọc khi Export',
          `${EXPORT_ONLY_COLUMN.totalAmount} · ${EXPORT_ONLY_COLUMN.fulfilledBy} · ${EXPORT_ONLY_COLUMN.claimedAt} · ${EXPORT_ONLY_COLUMN.createdAt} · ${EXPORT_ONLY_COLUMN.updatedAt} — hệ thống tự tính/ghi, import sẽ bỏ qua.`,
        ),
        row(
          'Import update theo ID',
          `File Export có cột "${EXPORT_ONLY_COLUMN.id}" nên nạp lại được để CẬP NHẬT. Khi đó cột "${ITEM_COLUMN.orderId}" ở sheet "${ITEMS_SHEET}" dùng để trỏ về đơn.`,
        ),
        row(
          'Xử lý lỗi',
          'Hệ thống kiểm tra toàn bộ file trước khi ghi. Chỉ cần 1 dòng lỗi thì KHÔNG dòng nào được ghi (rollback toàn bộ transaction).',
        ),
        row('Giới hạn', `Tối đa ${ORDER_IMPORT_MAX_ROWS} đơn mỗi lần import. Chỉ nhận file .xlsx.`),
      ],
    );
  }

  /** Sheet Reference — liệt kê enum + Platform **thật trong DB** (không hardcode). */
  private addReferenceSheet(
    wb: ExcelJS.Workbook,
    platforms: Array<{ code: string; name: string }>,
  ): void {
    const HEAD = { group: 'Enum', value: 'Value', note: 'Description' } as const;
    const rows: Array<Record<string, unknown>> = [];
    const push = (group: string, values: string[], note: string): void => {
      values.forEach((v, idx) =>
        rows.push({
          [HEAD.group]: idx === 0 ? group : '',
          [HEAD.value]: v,
          [HEAD.note]: idx === 0 ? note : '',
        }),
      );
    };

    push(
      'Platform',
      platforms.map((p) => `${p.code} (${p.name})`),
      `Nền tảng (cột ${ORDER_COLUMNS.platform.header} — nhập code hoặc tên; để trống sẽ lấy theo Account)`,
    );
    push('Order Status', [...ORDER_STATUS_CODES], `Trạng thái đơn (cột ${ORDER_COLUMNS.status.header})`);
    push('Order Item Status', [...ORDER_ITEM_STATUS_CODES], `Trạng thái fulfillment theo Item (sheet ${ITEMS_SHEET})`);
    push('Note Type', [...ORDER_NOTE_TYPE_CODES], `Loại ghi chú (sheet ${NOTES_SHEET})`);
    push('Order Date', [DATE_FORMAT_HINT], `Định dạng chấp nhận cho cột ${ORDER_COLUMNS.orderDate.header}`);

    addSheet(
      wb,
      REFERENCE_SHEET,
      [HEAD.group, HEAD.value, HEAD.note].map((h) => ({ header: h, key: h })),
      rows,
    );
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  async exportAll(organizationId: string, sellerScope?: string): Promise<Buffer> {
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { account: { sellerUserId: sellerScope } } : {}),
      },
      include: {
        account: { select: { name: true } },
        fulfilledBy: { select: { email: true } },
        items: { orderBy: { createdAt: 'asc' } },
        notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const orderRows = orders.map((o) => ({
      [EXPORT_ONLY_COLUMN.id]: o.id,
      [ORDER_COLUMNS.orderNumber.header]: o.orderNumber,
      [ORDER_COLUMNS.platform.header]: o.platform ?? '',
      [ORDER_COLUMNS.account.header]: o.account?.name ?? '',
      [ORDER_COLUMNS.orderDate.header]: o.orderedAt ?? '',
      [ORDER_COLUMNS.shippingAddress.header]: o.shippingAddress ?? '',
      [ORDER_COLUMNS.currency.header]: o.currency ?? '',
      [ORDER_COLUMNS.status.header]: o.status,
      [EXPORT_ONLY_COLUMN.totalAmount]: o.items.reduce(
        (s, it) => s + it.quantity * Number(it.unitPrice),
        0,
      ),
      [EXPORT_ONLY_COLUMN.fulfilledBy]: o.fulfilledBy?.email ?? '',
      [EXPORT_ONLY_COLUMN.claimedAt]: o.claimedAt ?? '',
      [EXPORT_ONLY_COLUMN.createdAt]: o.createdAt,
      [EXPORT_ONLY_COLUMN.updatedAt]: o.updatedAt,
    }));

    const itemRows: Array<Record<string, unknown>> = [];
    const noteRows: Array<Record<string, unknown>> = [];
    for (const o of orders) {
      for (const it of o.items) {
        itemRows.push({
          [ITEM_COLUMN.orderId]: o.id,
          [ITEM_COLUMN.orderNumber]: o.orderNumber,
          [ITEM_COLUMN.productName]: it.productName,
          [ITEM_COLUMN.productLink]: it.productLink ?? '',
          [ITEM_COLUMN.color]: it.color ?? '',
          [ITEM_COLUMN.size]: it.size ?? '',
          [ITEM_COLUMN.quantity]: it.quantity,
          [ITEM_COLUMN.unitPrice]: Number(it.unitPrice),
          [ITEM_COLUMN.trackingNumber]: it.trackingNumber ?? '',
          [ITEM_COLUMN.fulfillmentStatus]: it.fulfillmentStatus,
          [ITEM_COLUMN.image]: it.image ?? '',
          [ITEM_COLUMN.remark]: it.remark ?? '',
        });
      }
      for (const nt of o.notes) {
        noteRows.push({
          [NOTE_COLUMN.orderId]: o.id,
          [NOTE_COLUMN.orderNumber]: o.orderNumber,
          [NOTE_COLUMN.type]: nt.type,
          [NOTE_COLUMN.content]: nt.content,
        });
      }
    }

    const wb = new ExcelJS.Workbook();
    // addSheet: header đậm + nền màu, freeze dòng 1, auto width.
    const ordersWs = addSheet(
      wb,
      ORDERS_SHEET,
      ORDER_EXPORT_HEADERS.map((h) => ({ header: h, key: h })),
      orderRows,
    );
    // Ngày ghi bằng cell Date thật (giữ nguyên cả giờ) → import ngược lại không cần sửa.
    for (const header of [
      ORDER_COLUMNS.orderDate.header,
      EXPORT_ONLY_COLUMN.claimedAt,
      EXPORT_ONLY_COLUMN.createdAt,
      EXPORT_ONLY_COLUMN.updatedAt,
    ]) {
      ordersWs.getColumn(header).numFmt = EXCEL_DATETIME_FORMAT;
    }
    const totalCol = ordersWs.getColumn(EXPORT_ONLY_COLUMN.totalAmount);
    totalCol.numFmt = EXCEL_MONEY_FORMAT;
    totalCol.alignment = { horizontal: 'right' };

    const itemsWs = addSheet(wb, ITEMS_SHEET, ITEM_HEADERS.map((h) => ({ header: h, key: h })), itemRows);
    itemsWs.getColumn(ITEM_COLUMN.unitPrice).numFmt = EXCEL_MONEY_FORMAT;

    addSheet(wb, NOTES_SHEET, NOTE_HEADERS.map((h) => ({ header: h, key: h })), noteRows);
    this.addInstructionsSheet(wb);
    this.addReferenceSheet(wb, await this.loadPlatforms());
    return workbookToBuffer(wb);
  }

  // ==========================================================================
  // IMPORT (create-only, bỏ qua đơn đã tồn tại)
  // ==========================================================================

  async importCreate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
    sellerScope: string | undefined,
  ): Promise<ImportResultDto> {
    const wb = await this.workbook(buffer);
    const sheet = this.readOrdersSheet(wb, false);
    const itemsByOrderNumber = this.parseLinkedSheet(wb, ITEMS_SHEET, ITEM_COLUMN.orderNumber);
    const notesByOrderNumber = this.parseLinkedSheet(wb, NOTES_SHEET, NOTE_COLUMN.orderNumber);
    const lookups = await this.loadImportLookups(organizationId);

    const errors: ImportRowErrorDto[] = [];
    const prepared: PreparedOrder[] = [];

    for (const raw of sheet.rows) {
      const rowNum = raw.rowNumber;
      const fail = (field: string | null, message: string): void => {
        errors.push(this.err(ORDERS_SHEET, rowNum, field, message));
      };

      const orderNumber = this.cell(raw.cells, sheet, 'orderNumber');
      if (!orderNumber) {
        fail(ORDER_COLUMNS.orderNumber.header, 'Order Number không được rỗng');
        continue;
      }

      const accountName = this.cell(raw.cells, sheet, 'account');
      if (!accountName) {
        fail(ORDER_COLUMNS.account.header, 'Account không được rỗng');
        continue;
      }

      // --- Platform: dùng giá trị trong file, hoặc suy ra từ Account khi để trống ---
      const resolved = this.resolvePlatformAndAccount(
        this.cell(raw.cells, sheet, 'platform'),
        accountName,
        lookups,
      );
      if ('error' in resolved) {
        fail(resolved.field, resolved.error);
        continue;
      }
      const { platformCode, account } = resolved;

      if (sellerScope && account.sellerUserId !== sellerScope) {
        fail(ORDER_COLUMNS.account.header, `Bạn không quản lý Account '${accountName}'`);
        continue;
      }

      const status = this.parseStatus(this.cell(raw.cells, sheet, 'status'));
      if (status === null) {
        fail(
          ORDER_COLUMNS.status.header,
          `Status '${this.cell(raw.cells, sheet, 'status')}' không hợp lệ (${ORDER_STATUS_CODES.join('/')})`,
        );
        continue;
      }

      const orderedAt = this.parseOrderDate(raw.cells, sheet, fail);
      if (orderedAt === undefined) continue;

      const rawItems = itemsByOrderNumber.get(orderNumber.toLowerCase()) ?? [];
      const { itemInputs, itemErrors } = this.validateItems(rawItems);
      if (itemErrors.length) {
        errors.push(...itemErrors);
        continue;
      }
      if (itemInputs.length === 0) {
        fail(
          ORDER_COLUMNS.orderNumber.header,
          `Order '${orderNumber}' phải có ít nhất 1 sản phẩm ở sheet "${ITEMS_SHEET}"`,
        );
        continue;
      }

      const { noteInputs, noteErrors } = this.validateNotes(
        notesByOrderNumber.get(orderNumber.toLowerCase()) ?? [],
      );
      if (noteErrors.length) {
        errors.push(...noteErrors);
        continue;
      }

      prepared.push({
        key: `${platformCode}||${orderNumber.toLowerCase()}`,
        orderNumber,
        platformCode,
        accountId: account.id,
        shippingAddress: this.cell(raw.cells, sheet, 'shippingAddress'),
        currency: this.cell(raw.cells, sheet, 'currency'),
        status,
        orderedAt,
        itemInputs,
        noteInputs,
      });
    }

    if (errors.length) return this.result(sheet.rows.length, 0, 0, 0, errors);

    // Bỏ qua đơn đã tồn tại (theo platform + orderNumber) hoặc trùng trong file.
    const existing = await this.prisma.order.findMany({
      where: { organizationId, deletedAt: null },
      select: { platform: true, orderNumber: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.platform ?? ''}||${e.orderNumber.toLowerCase()}`),
    );
    const seen = new Set<string>();
    const toCreate = prepared.filter((p) => {
      if (existingKeys.has(p.key) || seen.has(p.key)) return false;
      seen.add(p.key);
      return true;
    });
    const skipped = prepared.length - toCreate.length;

    if (toCreate.length === 0) return this.result(sheet.rows.length, 0, 0, skipped, []);

    // Ghi theo LÔ: sinh sẵn id để createMany cho Order rồi createMany cho con (chống N+1).
    const now = new Date();
    const orderRows: Prisma.OrderCreateManyInput[] = [];
    const itemRows: Prisma.OrderItemCreateManyInput[] = [];
    const noteRows: Prisma.OrderNoteCreateManyInput[] = [];
    const historyRows: Prisma.OrderStatusHistoryCreateManyInput[] = [];
    const logRows: Prisma.OrderLogCreateManyInput[] = [];

    for (const p of toCreate) {
      const orderId = randomUUID();
      orderRows.push({
        id: orderId,
        organizationId,
        accountId: p.accountId,
        orderNumber: p.orderNumber,
        platform: p.platformCode,
        shippingAddress: p.shippingAddress || null,
        currency: p.currency || null,
        status: p.status,
        orderedAt: p.orderedAt ?? now,
        createdBy: actorUserId,
      });
      for (const it of p.itemInputs) itemRows.push({ orderId, ...it });
      for (const nt of p.noteInputs) {
        noteRows.push({ orderId, type: nt.type, content: nt.content, createdBy: actorUserId });
      }
      historyRows.push({
        orderId,
        oldStatus: null,
        newStatus: p.status,
        changedBy: actorUserId,
        note: 'Import Excel',
      });
      logRows.push({ orderId, action: ORDER_LOG_ACTION.CREATE, performedBy: actorUserId });
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.order.createMany({ data: orderRows });
          if (itemRows.length) await tx.orderItem.createMany({ data: itemRows });
          if (noteRows.length) await tx.orderNote.createMany({ data: noteRows });
          await tx.orderStatusHistory.createMany({ data: historyRows });
          await tx.orderLog.createMany({ data: logRows });
        },
        { maxWait: ORDER_IMPORT_TX_MAX_WAIT_MS, timeout: ORDER_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      return this.result(sheet.rows.length, 0, 0, 0, [
        this.err(ORDERS_SHEET, 0, null, `Lỗi khi ghi (đã rollback): ${this.msg(err)}`),
      ]);
    }

    return this.result(sheet.rows.length, toCreate.length, 0, skipped, []);
  }

  // ==========================================================================
  // IMPORT UPDATE (theo cột ID — nạp lại file Export)
  // ==========================================================================

  async importUpdate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
    sellerScope: string | undefined,
  ): Promise<ImportResultDto> {
    const wb = await this.workbook(buffer);
    const sheet = this.readOrdersSheet(wb, true);
    const itemsByOrderId = this.parseLinkedSheet(wb, ITEMS_SHEET, ITEM_COLUMN.orderId);
    const notesByOrderId = this.parseLinkedSheet(wb, NOTES_SHEET, NOTE_COLUMN.orderId);

    const errors: ImportRowErrorDto[] = [];
    const rowsData: PreparedUpdate[] = [];

    for (const raw of sheet.rows) {
      const rowNum = raw.rowNumber;
      const fail = (field: string | null, message: string): void => {
        errors.push(this.err(ORDERS_SHEET, rowNum, field, message));
      };

      const id = (raw.cells[sheet.idHeader as string] ?? '').trim();
      if (!id) {
        fail(EXPORT_ONLY_COLUMN.id, 'ID bắt buộc khi import update');
        continue;
      }
      if (!UUID_RE.test(id)) {
        fail(EXPORT_ONLY_COLUMN.id, `ID '${id}' không đúng định dạng UUID`);
        continue;
      }

      const status = this.parseStatus(this.cell(raw.cells, sheet, 'status'));
      if (status === null) {
        fail(
          ORDER_COLUMNS.status.header,
          `Status '${this.cell(raw.cells, sheet, 'status')}' không hợp lệ (${ORDER_STATUS_CODES.join('/')})`,
        );
        continue;
      }

      const orderedAt = this.parseOrderDate(raw.cells, sheet, fail);
      if (orderedAt === undefined) continue;

      const rawItems = itemsByOrderId.get(id.toLowerCase()) ?? [];
      const { itemInputs, itemErrors } = this.validateItems(rawItems);
      if (itemErrors.length) {
        errors.push(...itemErrors);
        continue;
      }

      const rawNotes = notesByOrderId.get(id.toLowerCase()) ?? [];
      const { noteInputs, noteErrors } = this.validateNotes(rawNotes);
      if (noteErrors.length) {
        errors.push(...noteErrors);
        continue;
      }

      rowsData.push({
        rowNum,
        id,
        shippingAddress: this.cell(raw.cells, sheet, 'shippingAddress'),
        currency: this.cell(raw.cells, sheet, 'currency'),
        status,
        orderedAt,
        hasItems: rawItems.length > 0,
        itemInputs,
        hasNotes: rawNotes.length > 0,
        noteInputs,
      });
    }
    if (errors.length) return this.result(sheet.rows.length, 0, 0, 0, errors);

    // MỘT query: kiểm tra ID tồn tại trong phạm vi + lấy status hiện tại (chống N+1).
    const found = await this.prisma.order.findMany({
      where: {
        id: { in: rowsData.map((d) => d.id) },
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { account: { sellerUserId: sellerScope } } : {}),
      },
      select: { id: true, status: true },
    });
    const statusById = new Map(found.map((f) => [f.id, f.status]));
    for (const d of rowsData) {
      if (!statusById.has(d.id)) {
        errors.push(
          this.err(
            ORDERS_SHEET,
            d.rowNum,
            EXPORT_ONLY_COLUMN.id,
            `Không tìm thấy Order ID '${d.id}' trong phạm vi cho phép`,
          ),
        );
      }
    }
    if (errors.length) return this.result(sheet.rows.length, 0, 0, 0, errors);

    const historyRows: Prisma.OrderStatusHistoryCreateManyInput[] = [];
    const logRows: Prisma.OrderLogCreateManyInput[] = [];

    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const d of rowsData) {
            await tx.order.update({
              where: { id: d.id },
              data: {
                shippingAddress: d.shippingAddress || null,
                currency: d.currency || null,
                status: d.status,
                // Ô trống = giữ nguyên ngày hiện tại (không xoá dữ liệu cũ).
                ...(d.orderedAt ? { orderedAt: d.orderedAt } : {}),
                updatedBy: actorUserId,
              },
            });
            // Chỉ thay thế items khi file có cung cấp items cho order này (tránh xoá nhầm).
            if (d.hasItems) {
              await tx.orderItem.deleteMany({ where: { orderId: d.id } });
              await tx.orderItem.createMany({
                data: d.itemInputs.map((x) => ({ orderId: d.id, ...x })),
              });
            }
            if (d.hasNotes) {
              await tx.orderNote.deleteMany({ where: { orderId: d.id } });
              await tx.orderNote.createMany({
                data: d.noteInputs.map((nt) => ({
                  orderId: d.id,
                  type: nt.type,
                  content: nt.content,
                  createdBy: actorUserId,
                })),
              });
            }

            const oldStatus = statusById.get(d.id);
            if (oldStatus !== undefined && oldStatus !== d.status) {
              historyRows.push({
                orderId: d.id,
                oldStatus,
                newStatus: d.status,
                changedBy: actorUserId,
                note: 'Import update Excel',
              });
            }
            logRows.push({
              orderId: d.id,
              action: ORDER_LOG_ACTION.UPDATE,
              field: 'excel-import',
              performedBy: actorUserId,
            });
          }
          if (historyRows.length) await tx.orderStatusHistory.createMany({ data: historyRows });
          await tx.orderLog.createMany({ data: logRows });
        },
        { maxWait: ORDER_IMPORT_TX_MAX_WAIT_MS, timeout: ORDER_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      return this.result(sheet.rows.length, 0, 0, 0, [
        this.err(ORDERS_SHEET, 0, null, `Lỗi khi cập nhật (đã rollback): ${this.msg(err)}`),
      ]);
    }

    return this.result(sheet.rows.length, 0, rowsData.length, 0, []);
  }

  // ==========================================================================
  // Platform ← Account (yêu cầu III / IV / V)
  // ==========================================================================

  /**
   * Xác định Platform + Account cho một dòng.
   *
   * - Platform CÓ dữ liệu → validate như cũ, tìm Account theo (tên + nền tảng).
   * - Platform TRỐNG → tìm Account theo tên trên mọi nền tảng, rồi **lấy Platform của Account**.
   */
  private resolvePlatformAndAccount(
    platformRaw: string,
    accountName: string,
    lookups: ImportLookups,
  ):
    | { platformCode: string; account: AccountEntry }
    | { error: string; field: string } {
    const nameKey = accountName.toLowerCase();

    if (platformRaw) {
      const platformCode = lookups.platformByKey.get(platformRaw.toLowerCase());
      if (!platformCode) {
        return {
          error: `Platform '${platformRaw}' không tồn tại`,
          field: ORDER_COLUMNS.platform.header,
        };
      }
      const candidates = lookups.accountsByNameAndPlatform.get(`${nameKey}||${platformCode}`) ?? [];
      if (candidates.length === 0) {
        return {
          error: `Account '${accountName}' (${platformCode}) không tồn tại`,
          field: ORDER_COLUMNS.account.header,
        };
      }
      if (candidates.length > 1) {
        return {
          error: `Account '${accountName}' bị trùng tên trên cùng nền tảng — không xác định được`,
          field: ORDER_COLUMNS.account.header,
        };
      }
      return { platformCode, account: candidates[0] };
    }

    // Platform để trống → suy ra từ Account.
    const candidates = lookups.accountsByName.get(nameKey) ?? [];
    if (candidates.length === 0) {
      return { error: PLATFORM_DERIVE_ERROR.accountNotFound, field: ORDER_COLUMNS.platform.header };
    }
    if (candidates.length > 1) {
      return { error: PLATFORM_DERIVE_ERROR.multipleAccounts, field: ORDER_COLUMNS.platform.header };
    }
    const account = candidates[0];
    if (!account.platformCode) {
      return {
        error: `Account '${accountName}' chưa được gán Platform — không suy ra được Platform cho Order`,
        field: ORDER_COLUMNS.platform.header,
      };
    }
    return { platformCode: account.platformCode, account };
  }

  /** Nạp toàn bộ dữ liệu tra cứu bằng 2 query (không phụ thuộc số dòng file). */
  private async loadImportLookups(organizationId: string): Promise<ImportLookups> {
    const [platforms, accounts] = await Promise.all([
      this.prisma.platform.findMany({ select: { code: true, name: true } }),
      this.prisma.account.findMany({
        where: { organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sellerUserId: true,
          platform: { select: { code: true } },
        },
      }),
    ]);

    const platformByKey = new Map<string, string>();
    for (const p of platforms) {
      platformByKey.set(p.code.toLowerCase(), p.code);
      platformByKey.set(p.name.toLowerCase(), p.code);
    }

    const accountsByNameAndPlatform = new Map<string, AccountEntry[]>();
    const accountsByName = new Map<string, AccountEntry[]>();
    const push = (map: Map<string, AccountEntry[]>, key: string, entry: AccountEntry): void => {
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    };

    for (const a of accounts) {
      const entry: AccountEntry = {
        id: a.id,
        sellerUserId: a.sellerUserId,
        platformCode: a.platform?.code ?? null,
      };
      const nameKey = a.name.toLowerCase();
      push(accountsByNameAndPlatform, `${nameKey}||${entry.platformCode ?? ''}`, entry);
      push(accountsByName, nameKey, entry);
    }

    return { platformByKey, accountsByNameAndPlatform, accountsByName };
  }

  // ==========================================================================
  // Đọc file
  // ==========================================================================

  private async workbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    try {
      return await bufferToWorkbook(buffer);
    } catch {
      throw this.structural('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
  }

  /** Đọc sheet Orders: map cột theo header chuẩn hoá + kiểm tra cột bắt buộc. */
  private readOrdersSheet(wb: ExcelJS.Workbook, requireId: boolean): OrdersSheet {
    const ws = this.ordersWorksheet(wb);
    const { headers, rows, rowNumbers } = readSheet(ws);

    const actualByNormalized = new Map<string, string>();
    for (const h of headers) actualByNormalized.set(normalizeHeader(h), h);

    const headerByKey = new Map<OrderColumnKey, string>();
    const missing: string[] = [];
    for (const key of ORDER_COLUMN_ORDER) {
      const column = ORDER_COLUMNS[key];
      const found = [column.header, ...column.aliases]
        .map((candidate) => actualByNormalized.get(normalizeHeader(candidate)))
        .find((header): header is string => header !== undefined);
      if (found) headerByKey.set(key, found);
      else if (column.required) missing.push(column.header);
    }

    const idHeader = actualByNormalized.get(normalizeHeader(EXPORT_ONLY_COLUMN.id));
    if (requireId && !idHeader) missing.push(EXPORT_ONLY_COLUMN.id);

    if (missing.length) {
      throw this.structural(
        `Sheet "${ws.name}" thiếu cột: ${missing.join(', ')}. Header đọc được: ` +
          `${headers.map((h) => `"${h}"`).join(', ') || '(không có)'}`,
      );
    }
    if (rows.length > ORDER_IMPORT_MAX_ROWS) {
      throw this.structural(
        `File có ${rows.length} đơn, vượt giới hạn ${ORDER_IMPORT_MAX_ROWS} đơn mỗi lần import`,
      );
    }

    return {
      headerByKey,
      idHeader,
      sheetName: ws.name,
      rows: rows.map((cells, i) => ({ rowNumber: rowNumbers[i], cells })),
    };
  }

  /** Ưu tiên sheet `Orders`; nếu không có thì sheet đầu tiên không phải Instructions/Reference. */
  private ordersWorksheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
    const isNamed = (sheet: ExcelJS.Worksheet, name: string): boolean =>
      sheet.name.trim().toLowerCase() === name.toLowerCase();
    const aux = [INSTRUCTIONS_SHEET, REFERENCE_SHEET, ITEMS_SHEET, NOTES_SHEET];
    const ws =
      wb.worksheets.find((s) => isNamed(s, ORDERS_SHEET)) ??
      wb.worksheets.find((s) => !aux.some((name) => isNamed(s, name)));
    if (!ws) throw this.structural(`Không tìm thấy sheet "${ORDERS_SHEET}"`);
    return ws;
  }

  private cell(cells: Record<string, string>, sheet: OrdersSheet, key: OrderColumnKey): string {
    const header = sheet.headerByKey.get(key);
    return header ? (cells[header] ?? '').trim() : '';
  }

  /**
   * Đọc cột Order Date.
   * Trả `null` = ô trống (hợp lệ); `Date` = giá trị; `undefined` = **lỗi** (đã ghi vào errors).
   */
  private parseOrderDate(
    cells: Record<string, string>,
    sheet: OrdersSheet,
    fail: (field: string | null, message: string) => void,
  ): Date | null | undefined {
    const raw = this.cell(cells, sheet, 'orderDate');
    if (!raw) return null;
    const date = parseFlexibleDateCell(raw);
    if (date) return date;
    fail(
      ORDER_COLUMNS.orderDate.header,
      `${ORDER_COLUMNS.orderDate.header} '${raw}' không hợp lệ (định dạng chấp nhận: ${DATE_FORMAT_HINT})`,
    );
    return undefined;
  }

  /** Parse sheet phụ (Items/Notes) → group theo cột liên kết (Order Number hoặc Order ID). */
  private parseLinkedSheet(
    wb: ExcelJS.Workbook,
    sheetName: string,
    linkCol: string,
  ): Map<string, Array<{ row: number; data: Record<string, string> }>> {
    const map = new Map<string, Array<{ row: number; data: Record<string, string> }>>();
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return map;
    const parsed = readSheet(ws);

    // Cho phép header biến dạng (NBSP/khoảng trắng lặp) ở sheet phụ.
    const actualByNormalized = new Map<string, string>();
    for (const h of parsed.headers) actualByNormalized.set(normalizeHeader(h), h);
    const linkHeader = actualByNormalized.get(normalizeHeader(linkCol));
    if (!linkHeader) return map;

    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const link = (r[linkHeader] ?? '').trim().toLowerCase();
      if (!link) continue;
      const entry = { row: parsed.rowNumbers[i], data: r };
      const list = map.get(link);
      if (list) list.push(entry);
      else map.set(link, [entry]);
    }
    return map;
  }

  // ==========================================================================
  // Validate sheet phụ
  // ==========================================================================

  private validateItems(raw: Array<{ row: number; data: Record<string, string> }>): {
    itemInputs: ItemInput[];
    itemErrors: ImportRowErrorDto[];
  } {
    const itemInputs: ItemInput[] = [];
    const itemErrors: ImportRowErrorDto[] = [];
    for (const { row, data } of raw) {
      const productName = (data[ITEM_COLUMN.productName] ?? '').trim();
      if (!productName) {
        itemErrors.push(
          this.err(ITEMS_SHEET, row, ITEM_COLUMN.productName, 'Product Name không được rỗng'),
        );
        continue;
      }
      const qty = this.parseInteger(data[ITEM_COLUMN.quantity], 1);
      if (qty === null || qty < 1) {
        itemErrors.push(
          this.err(
            ITEMS_SHEET,
            row,
            ITEM_COLUMN.quantity,
            `Quantity '${data[ITEM_COLUMN.quantity]}' không hợp lệ (>=1)`,
          ),
        );
        continue;
      }
      const price = this.parseNumber(data[ITEM_COLUMN.unitPrice], 0);
      if (price === null || price < 0) {
        itemErrors.push(
          this.err(
            ITEMS_SHEET,
            row,
            ITEM_COLUMN.unitPrice,
            `Unit Price '${data[ITEM_COLUMN.unitPrice]}' không hợp lệ (>=0)`,
          ),
        );
        continue;
      }
      const fulfillmentStatus = this.parseItemStatus(data[ITEM_COLUMN.fulfillmentStatus]);
      if (fulfillmentStatus === null) {
        itemErrors.push(
          this.err(
            ITEMS_SHEET,
            row,
            ITEM_COLUMN.fulfillmentStatus,
            `Fulfillment Status '${data[ITEM_COLUMN.fulfillmentStatus]}' không hợp lệ`,
          ),
        );
        continue;
      }
      itemInputs.push({
        productName,
        productLink: (data[ITEM_COLUMN.productLink] ?? '').trim() || null,
        color: (data[ITEM_COLUMN.color] ?? '').trim() || null,
        size: (data[ITEM_COLUMN.size] ?? '').trim() || null,
        quantity: qty,
        unitPrice: price,
        trackingNumber: (data[ITEM_COLUMN.trackingNumber] ?? '').trim() || null,
        fulfillmentStatus,
        image: (data[ITEM_COLUMN.image] ?? '').trim() || null,
        remark: (data[ITEM_COLUMN.remark] ?? '').trim() || null,
      });
    }
    return { itemInputs, itemErrors };
  }

  private validateNotes(raw: Array<{ row: number; data: Record<string, string> }>): {
    noteInputs: NoteInput[];
    noteErrors: ImportRowErrorDto[];
  } {
    const noteInputs: NoteInput[] = [];
    const noteErrors: ImportRowErrorDto[] = [];
    for (const { row, data } of raw) {
      const content = (data[NOTE_COLUMN.content] ?? '').trim();
      if (!content) {
        noteErrors.push(this.err(NOTES_SHEET, row, NOTE_COLUMN.content, 'Content không được rỗng'));
        continue;
      }
      const type = this.parseNoteType(data[NOTE_COLUMN.type]);
      if (type === null) {
        noteErrors.push(
          this.err(
            NOTES_SHEET,
            row,
            NOTE_COLUMN.type,
            `Type '${data[NOTE_COLUMN.type]}' không hợp lệ (${ORDER_NOTE_TYPE_CODES.join(' | ')})`,
          ),
        );
        continue;
      }
      noteInputs.push({ type, content });
    }
    return { noteInputs, noteErrors };
  }

  // ==========================================================================
  // helpers
  // ==========================================================================

  private loadPlatforms(): Promise<Array<{ code: string; name: string }>> {
    return this.prisma.platform.findMany({
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  private parseStatus(raw: string | undefined): OrderStatus | null {
    const v = (raw ?? '').trim();
    if (!v) return OrderStatus.WAITING;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return ORDER_STATUS_CODES.includes(norm) ? (norm as OrderStatus) : null;
  }

  private parseItemStatus(raw: string | undefined): OrderItemStatus | null {
    const v = (raw ?? '').trim();
    if (!v) return OrderItemStatus.PENDING;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return ORDER_ITEM_STATUS_CODES.includes(norm) ? (norm as OrderItemStatus) : null;
  }

  private parseNoteType(raw: string | undefined): OrderNoteType | null {
    const v = (raw ?? '').trim();
    if (!v) return null;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return ORDER_NOTE_TYPE_CODES.includes(norm) ? (norm as OrderNoteType) : null;
  }

  private parseInteger(raw: string | undefined, def: number): number | null {
    const v = (raw ?? '').trim();
    if (!v) return def;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }

  private parseNumber(raw: string | undefined, def: number): number | null {
    const v = (raw ?? '').trim();
    if (!v) return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private err(
    sheet: string,
    row: number,
    field: string | null,
    message: string,
  ): ImportRowErrorDto {
    return { sheet, row, field, message };
  }

  private result(
    total: number,
    created: number,
    updated: number,
    skipped: number,
    errors: ImportRowErrorDto[],
  ): ImportResultDto {
    return { total, created, updated, skipped, failed: errors.length, errors };
  }

  private structural(message: string): BadRequestException {
    return new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
