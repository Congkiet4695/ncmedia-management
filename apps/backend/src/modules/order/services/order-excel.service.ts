import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { OrderItemStatus, OrderNoteType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ImportResultDto,
  ImportRowErrorDto,
} from '../../../common/excel/import-result.dto';
import {
  addSheet,
  bufferToWorkbook,
  missingHeaders,
  readSheet,
  workbookToBuffer,
} from '../../../common/excel/excel.util';

/** Cột sheet Orders. */
const O = {
  id: 'ID',
  orderNumber: 'Order Number',
  platform: 'Platform',
  account: 'Account',
  shippingAddress: 'Shipping Address',
  currency: 'Currency',
  status: 'Status',
  totalAmount: 'Total Amount',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
} as const;
const ORDER_IMPORT_HEADERS = [
  O.orderNumber, O.platform, O.account, O.shippingAddress, O.currency, O.status,
];
const ORDER_EXPORT_HEADERS = [O.id, ...ORDER_IMPORT_HEADERS, O.totalAmount, O.createdAt, O.updatedAt];

/** Cột sheet Order Items (Tracking + Fulfillment Status theo TỪNG Item). */
const I = {
  orderId: 'Order ID',
  orderNumber: 'Order Number',
  productName: 'Product Name',
  productLink: 'Product Link',
  color: 'Color',
  size: 'Size',
  quantity: 'Quantity',
  unitPrice: 'Unit Price',
  trackingNumber: 'Tracking Number',
  fulfillmentStatus: 'Fulfillment Status',
  image: 'Image',
  remark: 'Remark',
} as const;
const ITEM_HEADERS = [
  I.orderId, I.orderNumber, I.productName, I.productLink, I.color, I.size,
  I.quantity, I.unitPrice, I.trackingNumber, I.fulfillmentStatus, I.image, I.remark,
];

/** Cột sheet Order Notes (ghi chú Seller/Warehouse — 1..N theo Order). */
const N = {
  orderId: 'Order ID',
  orderNumber: 'Order Number',
  type: 'Type',
  content: 'Content',
} as const;
const NOTE_HEADERS = [N.orderId, N.orderNumber, N.type, N.content];

const ORDERS_SHEET = 'Orders';
const ITEMS_SHEET = 'Order Items';
const NOTES_SHEET = 'Order Notes';
const REFERENCE_SHEET = 'Reference';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * OrderExcelService — Import/Export Excel cho Order (Admin + Employee scoped).
 * Sheet: "Orders" + "Order Items" + "Order Notes" (round-trip đầy đủ) + "Reference" (mô tả Enum).
 * Import chạy trong transaction. `sellerScope` = userId (Employee — chỉ Account mình quản lý)
 * hoặc undefined (Admin — toàn bộ).
 */
@Injectable()
export class OrderExcelService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Export ----------

  async buildExample(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      ORDERS_SHEET,
      ORDER_IMPORT_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [O.orderNumber]: 'ORD-SAMPLE-001',
          [O.platform]: 'TIKTOK_SHOP',
          [O.account]: 'TTS Sample 01',
          [O.shippingAddress]: '123 Main St, City, US',
          [O.currency]: 'USD',
          [O.status]: 'WAITING',
        },
      ],
    );
    addSheet(
      wb,
      ITEMS_SHEET,
      ITEM_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [I.orderId]: '', [I.orderNumber]: 'ORD-SAMPLE-001', [I.productName]: 'T-Shirt',
          [I.color]: 'Black', [I.size]: 'XL', [I.quantity]: 2, [I.unitPrice]: 19.9,
          [I.trackingNumber]: '', [I.fulfillmentStatus]: 'PENDING',
        },
        {
          [I.orderId]: '', [I.orderNumber]: 'ORD-SAMPLE-001', [I.productName]: 'Poster',
          [I.size]: 'A3', [I.quantity]: 1, [I.unitPrice]: 6.0, [I.fulfillmentStatus]: 'PENDING',
        },
      ],
    );
    addSheet(
      wb,
      NOTES_SHEET,
      NOTE_HEADERS.map((h) => ({ header: h, key: h })),
      [
        { [N.orderId]: '', [N.orderNumber]: 'ORD-SAMPLE-001', [N.type]: 'SELLER', [N.content]: 'Khách yêu cầu giao nhanh' },
        { [N.orderId]: '', [N.orderNumber]: 'ORD-SAMPLE-001', [N.type]: 'WAREHOUSE', [N.content]: 'Đóng gói cẩn thận' },
      ],
    );
    this.addReferenceSheet(wb);
    return workbookToBuffer(wb);
  }

  async exportAll(organizationId: string, sellerScope?: string): Promise<Buffer> {
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { account: { sellerUserId: sellerScope } } : {}),
      },
      include: {
        account: { select: { name: true } },
        items: { orderBy: { createdAt: 'asc' } },
        notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const orderRows = orders.map((o) => {
      const total = o.items.reduce((s, it) => s + it.quantity * Number(it.unitPrice), 0);
      return {
        [O.id]: o.id,
        [O.orderNumber]: o.orderNumber,
        [O.platform]: o.platform ?? '',
        [O.account]: o.account?.name ?? '',
        [O.shippingAddress]: o.shippingAddress ?? '',
        [O.currency]: o.currency ?? '',
        [O.status]: o.status,
        [O.totalAmount]: total,
        [O.createdAt]: o.createdAt.toISOString(),
        [O.updatedAt]: o.updatedAt.toISOString(),
      };
    });

    const itemRows: Array<Record<string, unknown>> = [];
    const noteRows: Array<Record<string, unknown>> = [];
    for (const o of orders) {
      for (const it of o.items) {
        itemRows.push({
          [I.orderId]: o.id,
          [I.orderNumber]: o.orderNumber,
          [I.productName]: it.productName,
          [I.productLink]: it.productLink ?? '',
          [I.color]: it.color ?? '',
          [I.size]: it.size ?? '',
          [I.quantity]: it.quantity,
          [I.unitPrice]: Number(it.unitPrice),
          [I.trackingNumber]: it.trackingNumber ?? '',
          [I.fulfillmentStatus]: it.fulfillmentStatus,
          [I.image]: it.image ?? '',
          [I.remark]: it.remark ?? '',
        });
      }
      for (const nt of o.notes) {
        noteRows.push({
          [N.orderId]: o.id,
          [N.orderNumber]: o.orderNumber,
          [N.type]: nt.type,
          [N.content]: nt.content,
        });
      }
    }

    const wb = new ExcelJS.Workbook();
    addSheet(wb, ORDERS_SHEET, ORDER_EXPORT_HEADERS.map((h) => ({ header: h, key: h })), orderRows);
    addSheet(wb, ITEMS_SHEET, ITEM_HEADERS.map((h) => ({ header: h, key: h })), itemRows);
    addSheet(wb, NOTES_SHEET, NOTE_HEADERS.map((h) => ({ header: h, key: h })), noteRows);
    this.addReferenceSheet(wb);
    return workbookToBuffer(wb);
  }

  // ---------- Import (create-only) ----------

  async importCreate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
    sellerScope: string | undefined,
  ): Promise<ImportResultDto> {
    const wb = await this.workbook(buffer);
    const ordersWs = this.sheet(wb, ORDERS_SHEET);
    const parsed = readSheet(ordersWs);
    const miss = missingHeaders(parsed.headers, ORDER_IMPORT_HEADERS);
    if (miss.length) this.structural(`Sheet "Orders" thiếu cột: ${miss.join(', ')}`);

    const itemsByOrderNumber = this.parseItemsBy(wb, I.orderNumber);
    const notesByOrderNumber = this.parseNotesBy(wb, N.orderNumber);
    const platformMap = await this.loadPlatformCodes();
    const accountMap = await this.loadAccountMap(organizationId);

    const errors: ImportRowErrorDto[] = [];
    const items: Array<{
      key: string; orderNumber: string; platformCode: string; accountId: string;
      shippingAddress: string; currency: string; status: OrderStatus;
      itemInputs: ItemInput[]; noteInputs: NoteInput[];
    }> = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const rowNum = parsed.rowNumbers[i];
      const orderNumber = (r[O.orderNumber] ?? '').trim();
      if (!orderNumber) { errors.push(this.err(ORDERS_SHEET, rowNum, O.orderNumber, 'Order Number không được rỗng')); continue; }

      const platRaw = (r[O.platform] ?? '').trim();
      if (!platRaw || !platformMap.has(platRaw.toLowerCase())) {
        errors.push(this.err(ORDERS_SHEET, rowNum, O.platform, `Platform '${platRaw}' không tồn tại`)); continue;
      }
      const platformCode = platformMap.get(platRaw.toLowerCase())!;

      const accName = (r[O.account] ?? '').trim();
      if (!accName) { errors.push(this.err(ORDERS_SHEET, rowNum, O.account, 'Account không được rỗng')); continue; }
      const acc = accountMap.get(`${accName.toLowerCase()}||${platformCode}`);
      if (!acc) { errors.push(this.err(ORDERS_SHEET, rowNum, O.account, `Account '${accName}' (${platformCode}) không tồn tại`)); continue; }
      if (acc.ambiguous) { errors.push(this.err(ORDERS_SHEET, rowNum, O.account, `Account '${accName}' bị trùng tên trên cùng nền tảng — không xác định được`)); continue; }
      if (sellerScope && acc.sellerUserId !== sellerScope) {
        errors.push(this.err(ORDERS_SHEET, rowNum, O.account, `Bạn không quản lý Account '${accName}'`)); continue;
      }

      const status = this.parseStatus(r[O.status]);
      if (status === null) { errors.push(this.err(ORDERS_SHEET, rowNum, O.status, `Status '${r[O.status]}' không hợp lệ`)); continue; }

      const rawItems = itemsByOrderNumber.get(orderNumber.toLowerCase()) ?? [];
      const { itemInputs, itemErrors } = this.validateItems(rawItems);
      if (itemErrors.length) { errors.push(...itemErrors); continue; }
      if (itemInputs.length === 0) {
        errors.push(this.err(ORDERS_SHEET, rowNum, O.orderNumber, `Order '${orderNumber}' phải có ít nhất 1 sản phẩm ở sheet "${ITEMS_SHEET}"`));
        continue;
      }

      const rawNotes = notesByOrderNumber.get(orderNumber.toLowerCase()) ?? [];
      const { noteInputs, noteErrors } = this.validateNotes(rawNotes);
      if (noteErrors.length) { errors.push(...noteErrors); continue; }

      items.push({
        key: `${platformCode}||${orderNumber.toLowerCase()}`,
        orderNumber, platformCode, accountId: acc.id,
        shippingAddress: (r[O.shippingAddress] ?? '').trim(),
        currency: (r[O.currency] ?? '').trim(),
        status,
        itemInputs, noteInputs,
      });
    }

    if (errors.length) return this.result(parsed.rows.length, 0, 0, 0, errors);

    // Skip nếu (platform+orderNumber) đã tồn tại hoặc trùng trong file.
    const existing = await this.prisma.order.findMany({
      where: { organizationId, deletedAt: null },
      select: { platform: true, orderNumber: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.platform ?? ''}||${e.orderNumber.toLowerCase()}`));
    const seen = new Set<string>();

    let created = 0;
    let skipped = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const it of items) {
          if (existingKeys.has(it.key) || seen.has(it.key)) { skipped++; continue; }
          seen.add(it.key);
          const order = await tx.order.create({
            data: {
              organizationId,
              accountId: it.accountId,
              orderNumber: it.orderNumber,
              platform: it.platformCode,
              shippingAddress: it.shippingAddress || null,
              currency: it.currency || null,
              status: it.status,
              orderedAt: new Date(),
              createdBy: actorUserId,
            },
            select: { id: true },
          });
          await tx.orderItem.createMany({ data: it.itemInputs.map((x) => ({ orderId: order.id, ...x })) });
          if (it.noteInputs.length) {
            await tx.orderNote.createMany({
              data: it.noteInputs.map((nt) => ({ orderId: order.id, type: nt.type, content: nt.content, createdBy: actorUserId })),
            });
          }
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, oldStatus: null, newStatus: it.status, changedBy: actorUserId, note: 'Import Excel' },
          });
          await tx.orderLog.create({ data: { orderId: order.id, action: 'CREATE', performedBy: actorUserId } });
          created++;
        }
      });
    } catch (err) {
      return this.result(parsed.rows.length, 0, 0, 0, [this.err(ORDERS_SHEET, 0, null, `Lỗi khi ghi (đã rollback): ${this.msg(err)}`)]);
    }

    return this.result(parsed.rows.length, created, 0, skipped, []);
  }

  // ---------- Import Update (by ID) ----------

  async importUpdate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
    sellerScope: string | undefined,
  ): Promise<ImportResultDto> {
    const wb = await this.workbook(buffer);
    const ordersWs = this.sheet(wb, ORDERS_SHEET);
    const parsed = readSheet(ordersWs);
    const miss = missingHeaders(parsed.headers, [O.id, ...ORDER_IMPORT_HEADERS]);
    if (miss.length) this.structural(`Sheet "Orders" thiếu cột: ${miss.join(', ')}`);

    const itemsByOrderId = this.parseItemsBy(wb, I.orderId);
    const notesByOrderId = this.parseNotesBy(wb, N.orderId);
    const errors: ImportRowErrorDto[] = [];
    const rowsData: Array<{
      rowNum: number; id: string; shippingAddress: string; currency: string; status: OrderStatus;
      hasItems: boolean; itemInputs: ItemInput[]; hasNotes: boolean; noteInputs: NoteInput[];
    }> = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const rowNum = parsed.rowNumbers[i];
      const id = (r[O.id] ?? '').trim();
      if (!id) { errors.push(this.err(ORDERS_SHEET, rowNum, O.id, 'ID bắt buộc khi import update')); continue; }
      if (!UUID_RE.test(id)) { errors.push(this.err(ORDERS_SHEET, rowNum, O.id, `ID '${id}' không đúng định dạng UUID`)); continue; }
      const status = this.parseStatus(r[O.status]);
      if (status === null) { errors.push(this.err(ORDERS_SHEET, rowNum, O.status, `Status '${r[O.status]}' không hợp lệ`)); continue; }

      const rawItems = itemsByOrderId.get(id.toLowerCase()) ?? [];
      const hasItems = rawItems.length > 0;
      const { itemInputs, itemErrors } = this.validateItems(rawItems);
      if (itemErrors.length) { errors.push(...itemErrors); continue; }

      const rawNotes = notesByOrderId.get(id.toLowerCase()) ?? [];
      const hasNotes = rawNotes.length > 0;
      const { noteInputs, noteErrors } = this.validateNotes(rawNotes);
      if (noteErrors.length) { errors.push(...noteErrors); continue; }

      rowsData.push({
        rowNum, id,
        shippingAddress: (r[O.shippingAddress] ?? '').trim(),
        currency: (r[O.currency] ?? '').trim(),
        status,
        hasItems, itemInputs, hasNotes, noteInputs,
      });
    }
    if (errors.length) return this.result(parsed.rows.length, 0, 0, 0, errors);

    // Tất cả ID phải tồn tại + trong phạm vi (Employee: Account mình quản lý).
    const ids = rowsData.map((d) => d.id);
    const found = await this.prisma.order.findMany({
      where: {
        id: { in: ids }, organizationId, deletedAt: null,
        ...(sellerScope ? { account: { sellerUserId: sellerScope } } : {}),
      },
      select: { id: true },
    });
    const foundSet = new Set(found.map((f) => f.id));
    for (const d of rowsData) {
      if (!foundSet.has(d.id)) {
        errors.push(this.err(ORDERS_SHEET, d.rowNum, O.id, `Không tìm thấy Order ID '${d.id}' trong phạm vi cho phép`));
      }
    }
    if (errors.length) return this.result(parsed.rows.length, 0, 0, 0, errors);

    let updated = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const d of rowsData) {
          const existingOrder = await tx.order.findUnique({ where: { id: d.id }, select: { status: true } });
          await tx.order.update({
            where: { id: d.id },
            data: {
              shippingAddress: d.shippingAddress || null,
              currency: d.currency || null,
              status: d.status,
              updatedBy: actorUserId,
            },
          });
          if (existingOrder && existingOrder.status !== d.status) {
            await tx.orderStatusHistory.create({
              data: { orderId: d.id, oldStatus: existingOrder.status, newStatus: d.status, changedBy: actorUserId, note: 'Import update Excel' },
            });
          }
          // Chỉ thay thế items khi file có cung cấp items cho order này (tránh xoá nhầm).
          if (d.hasItems) {
            await tx.orderItem.deleteMany({ where: { orderId: d.id } });
            await tx.orderItem.createMany({ data: d.itemInputs.map((x) => ({ orderId: d.id, ...x })) });
          }
          // Tương tự: chỉ thay thế notes khi file có cung cấp notes cho order này.
          if (d.hasNotes) {
            await tx.orderNote.deleteMany({ where: { orderId: d.id } });
            await tx.orderNote.createMany({
              data: d.noteInputs.map((nt) => ({ orderId: d.id, type: nt.type, content: nt.content, createdBy: actorUserId })),
            });
          }
          await tx.orderLog.create({ data: { orderId: d.id, action: 'UPDATE', field: 'excel-import', performedBy: actorUserId } });
          updated++;
        }
      });
    } catch (err) {
      return this.result(parsed.rows.length, 0, 0, 0, [this.err(ORDERS_SHEET, 0, null, `Lỗi khi cập nhật (đã rollback): ${this.msg(err)}`)]);
    }

    return this.result(parsed.rows.length, 0, updated, 0, []);
  }

  // ---------- helpers ----------

  private async workbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    try {
      return await bufferToWorkbook(buffer);
    } catch {
      this.structural('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
  }

  private sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
    const ws = wb.getWorksheet(name) ?? wb.worksheets[0];
    if (!ws) this.structural(`Không tìm thấy sheet "${name}"`);
    return ws;
  }

  /** Parse sheet Order Items → group theo linkCol (Order Number hoặc Order ID). */
  private parseItemsBy(wb: ExcelJS.Workbook, linkCol: string): Map<string, Array<{ row: number; data: Record<string, string> }>> {
    return this.parseLinkedSheet(wb, ITEMS_SHEET, linkCol);
  }

  /** Parse sheet Order Notes → group theo linkCol (Order Number hoặc Order ID). */
  private parseNotesBy(wb: ExcelJS.Workbook, linkCol: string): Map<string, Array<{ row: number; data: Record<string, string> }>> {
    return this.parseLinkedSheet(wb, NOTES_SHEET, linkCol);
  }

  private parseLinkedSheet(wb: ExcelJS.Workbook, sheetName: string, linkCol: string): Map<string, Array<{ row: number; data: Record<string, string> }>> {
    const map = new Map<string, Array<{ row: number; data: Record<string, string> }>>();
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return map;
    const parsed = readSheet(ws);
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const link = (r[linkCol] ?? '').trim().toLowerCase();
      if (!link) continue;
      if (!map.has(link)) map.set(link, []);
      map.get(link)!.push({ row: parsed.rowNumbers[i], data: r });
    }
    return map;
  }

  private validateItems(raw: Array<{ row: number; data: Record<string, string> }>): { itemInputs: ItemInput[]; itemErrors: ImportRowErrorDto[] } {
    const itemInputs: ItemInput[] = [];
    const itemErrors: ImportRowErrorDto[] = [];
    for (const { row, data } of raw) {
      const productName = (data[I.productName] ?? '').trim();
      if (!productName) { itemErrors.push(this.err(ITEMS_SHEET, row, I.productName, 'Product Name không được rỗng')); continue; }
      const qty = this.parseInt(data[I.quantity], 1);
      if (qty === null || qty < 1) { itemErrors.push(this.err(ITEMS_SHEET, row, I.quantity, `Quantity '${data[I.quantity]}' không hợp lệ (>=1)`)); continue; }
      const price = this.parseNum(data[I.unitPrice], 0);
      if (price === null || price < 0) { itemErrors.push(this.err(ITEMS_SHEET, row, I.unitPrice, `Unit Price '${data[I.unitPrice]}' không hợp lệ (>=0)`)); continue; }
      const fulfillmentStatus = this.parseItemStatus(data[I.fulfillmentStatus]);
      if (fulfillmentStatus === null) { itemErrors.push(this.err(ITEMS_SHEET, row, I.fulfillmentStatus, `Fulfillment Status '${data[I.fulfillmentStatus]}' không hợp lệ`)); continue; }
      itemInputs.push({
        productName,
        productLink: (data[I.productLink] ?? '').trim() || null,
        color: (data[I.color] ?? '').trim() || null,
        size: (data[I.size] ?? '').trim() || null,
        quantity: qty,
        unitPrice: price,
        trackingNumber: (data[I.trackingNumber] ?? '').trim() || null,
        fulfillmentStatus,
        image: (data[I.image] ?? '').trim() || null,
        remark: (data[I.remark] ?? '').trim() || null,
      });
    }
    return { itemInputs, itemErrors };
  }

  private validateNotes(raw: Array<{ row: number; data: Record<string, string> }>): { noteInputs: NoteInput[]; noteErrors: ImportRowErrorDto[] } {
    const noteInputs: NoteInput[] = [];
    const noteErrors: ImportRowErrorDto[] = [];
    for (const { row, data } of raw) {
      const content = (data[N.content] ?? '').trim();
      if (!content) { noteErrors.push(this.err(NOTES_SHEET, row, N.content, 'Content không được rỗng')); continue; }
      const type = this.parseNoteType(data[N.type]);
      if (type === null) { noteErrors.push(this.err(NOTES_SHEET, row, N.type, `Type '${data[N.type]}' không hợp lệ (SELLER | WAREHOUSE)`)); continue; }
      noteInputs.push({ type, content });
    }
    return { noteInputs, noteErrors };
  }

  private async loadPlatformCodes(): Promise<Map<string, string>> {
    const platforms = await this.prisma.platform.findMany({ select: { code: true, name: true } });
    const map = new Map<string, string>();
    for (const p of platforms) {
      map.set(p.code.toLowerCase(), p.code);
      map.set(p.name.toLowerCase(), p.code);
    }
    return map;
  }

  private async loadAccountMap(organizationId: string): Promise<Map<string, { id: string; sellerUserId: string | null; ambiguous: boolean }>> {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, sellerUserId: true, platform: { select: { code: true } } },
    });
    const map = new Map<string, { id: string; sellerUserId: string | null; ambiguous: boolean }>();
    for (const a of accounts) {
      const key = `${a.name.toLowerCase()}||${a.platform?.code ?? ''}`;
      const cur = map.get(key);
      if (cur) cur.ambiguous = true;
      else map.set(key, { id: a.id, sellerUserId: a.sellerUserId, ambiguous: false });
    }
    return map;
  }

  private parseStatus(raw: string | undefined): OrderStatus | null {
    const v = (raw ?? '').trim();
    if (!v) return OrderStatus.WAITING;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return (Object.values(OrderStatus) as string[]).includes(norm) ? (norm as OrderStatus) : null;
  }

  private parseItemStatus(raw: string | undefined): OrderItemStatus | null {
    const v = (raw ?? '').trim();
    if (!v) return OrderItemStatus.PENDING;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return (Object.values(OrderItemStatus) as string[]).includes(norm) ? (norm as OrderItemStatus) : null;
  }

  private parseNoteType(raw: string | undefined): OrderNoteType | null {
    const v = (raw ?? '').trim();
    if (!v) return null;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return (Object.values(OrderNoteType) as string[]).includes(norm) ? (norm as OrderNoteType) : null;
  }

  /** Sheet "Reference" — mô tả toàn bộ Enum dùng khi import (chỉ để tham khảo, không parse). */
  private addReferenceSheet(wb: ExcelJS.Workbook): void {
    const HEAD = { group: 'Enum', value: 'Value', note: 'Description' } as const;
    const rows: Array<Record<string, unknown>> = [];
    const push = (group: string, values: string[], note: string): void => {
      values.forEach((v, idx) => rows.push({
        [HEAD.group]: idx === 0 ? group : '',
        [HEAD.value]: v,
        [HEAD.note]: idx === 0 ? note : '',
      }));
    };
    push('Platform', ['TIKTOK_SHOP', 'EBAY', 'AMAZON', 'ETSY', 'SHOPIFY'], 'Mã nền tảng (cột Platform ở sheet Orders — có thể nhập code hoặc tên)');
    push('Order Status', Object.values(OrderStatus), 'Trạng thái đơn (cột Status ở sheet Orders)');
    push('Order Item Status', Object.values(OrderItemStatus), 'Trạng thái fulfillment theo Item (cột Fulfillment Status ở sheet Order Items)');
    push('Note Type', Object.values(OrderNoteType), 'Loại ghi chú (cột Type ở sheet Order Notes)');
    addSheet(wb, REFERENCE_SHEET, [HEAD.group, HEAD.value, HEAD.note].map((h) => ({ header: h, key: h })), rows);
  }

  private parseInt(raw: string | undefined, def: number): number | null {
    const v = (raw ?? '').trim();
    if (!v) return def;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }

  private parseNum(raw: string | undefined, def: number): number | null {
    const v = (raw ?? '').trim();
    if (!v) return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private err(sheet: string, row: number, field: string | null, message: string): ImportRowErrorDto {
    return { sheet, row, field, message };
  }

  private result(total: number, created: number, updated: number, skipped: number, errors: ImportRowErrorDto[]): ImportResultDto {
    return { total, created, updated, skipped, failed: errors.length, errors };
  }

  private structural(message: string): never {
    throw new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
