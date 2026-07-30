import { OrderItemStatus, OrderNoteType, OrderStatus } from '@prisma/client';

/**
 * Hằng số Import/Export/Template Excel cho Order — **nguồn duy nhất** để 3 chức năng
 * luôn đồng bộ (yêu cầu I).
 *
 * ⚠️ Backward compatibility: tên cột đã tồn tại giữ **nguyên**; cột mới chỉ được **thêm vào**.
 */

export const ORDERS_SHEET = 'Orders';
export const ITEMS_SHEET = 'Order Items';
export const NOTES_SHEET = 'Order Notes';
export const REFERENCE_SHEET = 'Reference';
export const INSTRUCTIONS_SHEET = 'Instructions';

/** Định dạng ô xuất ra. */
export const EXCEL_DATE_FORMAT = 'yyyy-mm-dd';
export const EXCEL_DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
export const EXCEL_MONEY_FORMAT = '#,##0.00';

/** Mô tả định dạng ngày chấp nhận khi import (hiển thị trong Instructions + thông báo lỗi). */
export const DATE_FORMAT_HINT = 'dd/MM/yyyy hoặc yyyy-MM-dd hoặc ô Date/Serial của Excel';

export const ORDER_IMPORT_MAX_ROWS = 5000;
export const ORDER_IMPORT_TX_TIMEOUT_MS = 180_000;
export const ORDER_IMPORT_TX_MAX_WAIT_MS = 15_000;

/** Một cột của sheet Orders. `aliases` giúp nhận file cũ / tên cột tiếng Việt. */
export interface OrderExcelColumn {
  header: string;
  aliases: readonly string[];
  required: boolean;
}

/**
 * Cột nghiệp vụ sheet `Orders` (dùng cho Template + Import + Export).
 * Thứ tự khai báo = thứ tự cột trong file.
 */
export const ORDER_COLUMNS = {
  orderNumber: { header: 'Order Number', aliases: ['Mã đơn'], required: true },
  platform: { header: 'Platform', aliases: ['Nền tảng'], required: true },
  account: { header: 'Account', aliases: ['Tên acc'], required: true },
  orderDate: { header: 'Order Date', aliases: ['Ordered At', 'Ngày order'], required: false },
  shippingAddress: { header: 'Shipping Address', aliases: ['Địa chỉ'], required: true },
  currency: { header: 'Currency', aliases: [], required: true },
  status: { header: 'Status', aliases: ['Tình trạng'], required: true },
} as const satisfies Record<string, OrderExcelColumn>;

export type OrderColumnKey = keyof typeof ORDER_COLUMNS;

/** Thứ tự cột sheet Orders trong Template/Import. */
export const ORDER_COLUMN_ORDER = Object.keys(ORDER_COLUMNS) as OrderColumnKey[];

/** Header sheet Orders của Template (cũng là tập cột Import chấp nhận). */
export const ORDER_TEMPLATE_HEADERS: readonly string[] = ORDER_COLUMN_ORDER.map(
  (key) => ORDER_COLUMNS[key].header,
);

/**
 * Cột chỉ có ở file Export (read-only, import bỏ qua trừ `ID` dùng cho import update).
 * `Total Amount` là derived (ADR-014 — không lưu DB).
 */
export const EXPORT_ONLY_COLUMN = {
  id: 'ID',
  totalAmount: 'Total Amount',
  fulfilledBy: 'Fulfilled By',
  claimedAt: 'Claimed At',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
} as const;

/** Header sheet Orders của file Export = ID + cột nghiệp vụ + cột derived/audit. */
export const ORDER_EXPORT_HEADERS: readonly string[] = [
  EXPORT_ONLY_COLUMN.id,
  ...ORDER_TEMPLATE_HEADERS,
  EXPORT_ONLY_COLUMN.totalAmount,
  EXPORT_ONLY_COLUMN.fulfilledBy,
  EXPORT_ONLY_COLUMN.claimedAt,
  EXPORT_ONLY_COLUMN.createdAt,
  EXPORT_ONLY_COLUMN.updatedAt,
];

/** Cột sheet `Order Items` (giữ nguyên tên cũ). */
export const ITEM_COLUMN = {
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

export const ITEM_HEADERS: readonly string[] = Object.values(ITEM_COLUMN);

/** Cột sheet `Order Notes` (giữ nguyên tên cũ). */
export const NOTE_COLUMN = {
  orderId: 'Order ID',
  orderNumber: 'Order Number',
  type: 'Type',
  content: 'Content',
} as const;

export const NOTE_HEADERS: readonly string[] = Object.values(NOTE_COLUMN);

/** Danh sách enum hợp lệ (từ Prisma — không hardcode chuỗi). */
export const ORDER_STATUS_CODES: readonly string[] = Object.values(OrderStatus);
export const ORDER_ITEM_STATUS_CODES: readonly string[] = Object.values(OrderItemStatus);
export const ORDER_NOTE_TYPE_CODES: readonly string[] = Object.values(OrderNoteType);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thông báo lỗi khi không suy ra được Platform từ Account (yêu cầu IV — nguyên văn). */
export const PLATFORM_DERIVE_ERROR = {
  accountNotFound: 'Cannot determine Platform because Account does not exist.',
  multipleAccounts: 'Multiple accounts found. Platform cannot be determined.',
} as const;
