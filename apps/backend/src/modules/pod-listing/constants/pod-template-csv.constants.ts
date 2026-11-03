import type { PodTemplateKind } from './pod-listing.constants';

/**
 * Schema CSV của Export / Import template THEO DÒNG (4 tab Category · SKU · Description · Image).
 *
 * Một dòng CSV = MỘT template. Cột = đúng các trường của gói mang đi (`PodTemplateTransferService`);
 * phần lồng nhau (thuộc tính, trục biến thể, bảng SKU, token, danh sách ảnh) nằm trong MỘT ô dưới dạng
 * JSON — giữ nguyên cấu trúc mà importer vẫn đọc, không phải phát minh định dạng phẳng thứ hai.
 *
 * 🔴 Không có cột id / organization / audit: tham chiếu đi theo khoá nghiệp vụ (tên, mã TikTok, URL
 * ảnh công khai), nên file nạp được vào chính tổ chức nguồn lẫn tổ chức khác.
 */
export type PodTemplateCsvKind = Extract<PodTemplateKind, 'CATEGORY' | 'SKU' | 'DESCRIPTION' | 'IMAGE'>;

export const POD_TEMPLATE_CSV_KINDS = ['CATEGORY', 'SKU', 'DESCRIPTION', 'IMAGE'] as const satisfies readonly PodTemplateCsvKind[];

/** Kiểu của một ô khi đọc lại: CSV chỉ có chuỗi, ép kiểu theo cột trước khi qua DTO. */
export type PodTemplateCsvColumnType = 'string' | 'number' | 'integer' | 'json';

export interface PodTemplateCsvColumn {
  key: string;
  type: PodTemplateCsvColumnType;
  /** Thiếu CỘT này ⇒ file không phải CSV của loại template này. */
  required?: boolean;
}

const col = (key: string, type: PodTemplateCsvColumnType = 'string', required = false): PodTemplateCsvColumn => ({
  key,
  type,
  required,
});

export const POD_TEMPLATE_CSV_COLUMNS: Record<PodTemplateCsvKind, readonly PodTemplateCsvColumn[]> = {
  CATEGORY: [
    col('name', 'string', true),
    col('market', 'string', true),
    col('tiktokCategoryId', 'string', true),
    col('categoryName'),
    col('categoryPath'),
    col('brandMode'),
    col('tiktokBrandId'),
    col('brandName'),
    // Kho đi theo mã TikTok — id kho nội bộ chỉ có nghĩa trong một tổ chức.
    col('tiktokWarehouseId'),
    col('packageWeight'),
    col('weightUnit'),
    col('packageLength'),
    col('packageWidth'),
    col('packageHeight'),
    col('dimensionUnit'),
    // File: id dùng lại khi nạp vào CHÍNH tổ chức nguồn; URL công khai để chép sang tổ chức khác.
    col('sizeChartFileId'),
    col('sizeChartUrl'),
    col('videoFileId'),
    col('displayOrder', 'integer'),
    col('note'),
    col('attributes', 'json'),
  ],
  SKU: [
    col('name', 'string', true),
    col('skuPrefix'),
    col('skuSuffix'),
    col('defaultRetailPrice', 'number'),
    col('defaultSalePrice', 'number'),
    col('defaultQuantity', 'integer'),
    col('defaultDiscount', 'number'),
    col('currency'),
    col('displayOrder', 'integer'),
    col('note'),
    col('variants', 'json', true),
    col('items', 'json'),
  ],
  DESCRIPTION: [
    col('name', 'string', true),
    col('contentHtml', 'string', true),
    col('displayOrder', 'integer'),
    col('note'),
    col('tokens', 'json'),
  ],
  IMAGE: [
    col('name', 'string', true),
    col('description'),
    col('displayOrder', 'integer'),
    col('images', 'json', true),
  ],
};

/** Trần số dòng một lần Export / Import theo dòng (bằng trần gói JSON). */
export const POD_TEMPLATE_CSV_MAX_ROWS = 200;

/** Trần dung lượng file CSV tải lên. */
export const POD_TEMPLATE_CSV_MAX_BYTES = 5 * 1024 * 1024;

/** Tiền tố tên file export (kèm mốc thời gian ở frontend). */
export const POD_TEMPLATE_CSV_FILE_PREFIX: Record<PodTemplateCsvKind, string> = {
  CATEGORY: 'category-templates',
  SKU: 'sku-templates',
  DESCRIPTION: 'description-templates',
  IMAGE: 'image-templates',
};
