/**
 * Luật TÌM ỨNG VIÊN cho ánh xạ tự động.
 *
 * 🔴 Hàm THUẦN, không phụ thuộc Nest/Prisma — cùng lý do với `mapping-match.ts`: luật nghiệp
 * vụ phải kiểm được bằng unit test mà không cần dựng database, và phải có đúng MỘT bản.
 *
 * 🔴 Nguyên tắc bao trùm: **thà không ánh xạ còn hơn ánh xạ sai.** Ánh xạ sai nghĩa là đơn ra
 * xưởng in với SKU của sản phẩm khác — hàng thật, tiền thật, và không ai phát hiện cho tới
 * khi khách nhận được thứ mình không đặt. Vì thế mọi tầng dưới đây đều theo quy tắc:
 * **nhiều hơn một ứng viên ⇒ trả về tất cả và KHÔNG tự chọn**, để người vận hành quyết định.
 */

/** Một biến thể trong bản sao danh mục nhà cung cấp, đúng những cột dùng để ghép. */
export interface AutoMapVariantRow {
  id: string;
  externalVariantId: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  product: {
    id: string;
    externalProductId: string;
    name: string;
    sku: string | null;
    catalogueId: string | null;
    catalogue: { id: string; name: string } | null;
  };
}

/** Dòng hàng TikTok cần tìm ánh xạ. */
export interface AutoMapQuery {
  sellerSku: string;
  productName: string | null;
  skuName: string | null;
  productCategory: string | null;
}

/** Tầng nào của luật đã cho ra kết quả. Thứ tự khai báo = thứ tự ưu tiên. */
export type AutoMapTier = 'SELLER_SKU' | 'PRODUCT_TITLE' | 'VARIANT' | 'CATALOGUE';

export interface AutoMapCandidate {
  productId: string;
  externalProductId: string;
  productName: string;
  variantId: string;
  externalVariantId: string;
  sku: string;
  variantName: string;
  catalogueId: string | null;
  catalogueName: string | null;
}

export interface AutoMapOutcome {
  tier: AutoMapTier | null;
  candidates: AutoMapCandidate[];
}

/**
 * Chuẩn hoá chuỗi trước khi so khớp theo TÊN.
 *
 * Bỏ dấu, hạ chữ thường, gom khoảng trắng, bỏ ký tự không phải chữ/số. Người bán và nhà cung
 * cấp gõ tên sản phẩm độc lập với nhau: `"Unisex T-Shirt  (Black)"` và `"unisex tshirt black"`
 * là cùng một thứ, và một phép so sánh chuỗi thô sẽ bỏ sót mọi trường hợp như vậy.
 *
 * 🔴 KHÔNG dùng cho SKU. SKU là mã định danh, `POSTER_24x36` và `poster-24x36` có thể là hai
 * sản phẩm khác nhau — so SKU luôn là so CHÍNH XÁC.
 */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return (
    value
      .normalize('NFD')
      // Bỏ dấu tiếng Việt và mọi dấu phụ khác.
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** Chuẩn hoá SKU: chỉ cắt khoảng trắng thừa, GIỮ NGUYÊN hoa/thường. */
export function normalizeSku(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/**
 * Tìm ứng viên theo thứ tự ưu tiên: **Seller SKU → Product Title → Variant → Catalogue**.
 *
 * Dừng ở TẦNG ĐẦU TIÊN có kết quả. Tầng sau chỉ chạy khi tầng trước không tìm được gì —
 * không gộp kết quả nhiều tầng, vì kết quả của tầng yếu hơn sẽ làm loãng kết quả chắc chắn
 * của tầng mạnh hơn và biến một ánh xạ tự động đúng thành "cần chọn tay".
 *
 * @param rows Toàn bộ biến thể đang bán của tài khoản (đã nạp MỘT lần cho cả lượt rà).
 */
export function findAutoMapCandidates(
  query: AutoMapQuery,
  rows: AutoMapVariantRow[],
): AutoMapOutcome {
  const sellerSku = normalizeSku(query.sellerSku);
  if (!sellerSku) return { tier: null, candidates: [] };

  // --- Tầng 1: Seller SKU (chắc chắn nhất) -----------------------------------
  //
  // Người bán thường đặt Seller SKU trùng luôn SKU của nhà cung cấp. Khớp CHÍNH XÁC — không
  // chuẩn hoá, không so gần đúng: SKU là mã định danh, sai một ký tự là sản phẩm khác.
  const bySku = rows.filter((row) => row.sku === sellerSku || row.product.sku === sellerSku);
  if (bySku.length > 0) return { tier: 'SELLER_SKU', candidates: bySku.map(toCandidate) };

  // --- Tầng 2: Product Title -------------------------------------------------
  //
  // Chỉ nhận khớp TUYỆT ĐỐI sau khi chuẩn hoá. Cố tình KHÔNG dùng "chứa" hay khoảng cách
  // chuỗi: `"T-Shirt"` nằm trong hàng trăm tên sản phẩm, khớp kiểu đó sẽ cho ra một danh sách
  // vô nghĩa và đẩy mọi sản phẩm sang trạng thái "cần chọn tay".
  const title = normalizeName(query.productName);
  if (title) {
    const byTitle = rows.filter((row) => normalizeName(row.product.name) === title);
    if (byTitle.length > 0) {
      // Có tên biến thể thì thu hẹp thêm trong nhóm cùng tên sản phẩm — đây chính là chỗ
      // "Product Title → Variant" của yêu cầu ghép lại thành một ứng viên duy nhất.
      const narrowed = narrowByVariant(byTitle, query);
      return { tier: 'PRODUCT_TITLE', candidates: narrowed.map(toCandidate) };
    }
  }

  // --- Tầng 3: Variant -------------------------------------------------------
  //
  // Không khớp được tên sản phẩm thì thử tên biến thể (vd `"Black / L"`). Tầng này yếu hơn
  // hẳn nên hiếm khi cho ra đúng một kết quả — và đúng như vậy: nó sẽ dẫn tới NEED_MANUAL,
  // là kết cục đúng khi hệ thống không đủ chắc chắn.
  const variantName = normalizeName(query.skuName);
  if (variantName) {
    const byVariant = rows.filter((row) => matchesVariantName(row, variantName));
    if (byVariant.length > 0) return { tier: 'VARIANT', candidates: byVariant.map(toCandidate) };
  }

  // --- Tầng 4: Catalogue -----------------------------------------------------
  //
  // Tầng cuối: danh mục sản phẩm bên TikTok trùng tên danh mục bên nhà cung cấp. Gần như
  // không bao giờ cho ra một kết quả duy nhất, nhưng nó thu hẹp danh sách ứng viên để màn
  // hình Map Product mở ra đã lọc sẵn thay vì bắt người dùng dò từ đầu.
  const category = normalizeName(query.productCategory);
  if (category) {
    const byCatalogue = rows.filter(
      (row) => normalizeName(row.product.catalogue?.name) === category,
    );
    if (byCatalogue.length > 0) {
      return { tier: 'CATALOGUE', candidates: byCatalogue.map(toCandidate) };
    }
  }

  return { tier: null, candidates: [] };
}

/**
 * Thu hẹp một nhóm biến thể theo tên biến thể của TikTok.
 *
 * Trả nguyên nhóm khi không thu hẹp được — thà đưa ra 5 ứng viên để người dùng chọn còn hơn
 * bỏ hết rồi báo "không tìm thấy".
 */
function narrowByVariant(rows: AutoMapVariantRow[], query: AutoMapQuery): AutoMapVariantRow[] {
  const variantName = normalizeName(query.skuName);
  if (!variantName || rows.length <= 1) return rows;

  const narrowed = rows.filter((row) => matchesVariantName(row, variantName));
  return narrowed.length > 0 ? narrowed : rows;
}

/**
 * Tên biến thể TikTok có khớp biến thể nhà cung cấp không.
 *
 * TikTok gộp thuộc tính thành một chuỗi (`"Black, L"`, `"Black / L"`) trong khi Mango tách
 * `color` và `size` riêng. Vì thế so theo hai hướng: trùng tuyệt đối tên đã chuẩn hoá, hoặc
 * chuỗi TikTok chứa ĐỦ CẢ HAI mảnh màu và size của nhà cung cấp.
 *
 * Yêu cầu đủ CẢ HAI mảnh là cố ý: chỉ khớp mỗi `"black"` sẽ gom hết mọi size màu đen.
 */
function matchesVariantName(row: AutoMapVariantRow, normalizedQueryName: string): boolean {
  if (normalizeName(row.name) === normalizedQueryName) return true;

  const parts = [row.color, row.size].map(normalizeName).filter(Boolean);
  if (parts.length === 0) return false;

  // So theo TỪ trọn vẹn, không phải `includes` trên chuỗi: `"s"` (size S) nằm trong hầu hết
  // mọi chuỗi, và `"xl"` nằm trong `"2xl"`.
  const words = new Set(normalizedQueryName.split(' '));
  return parts.every((part) => part.split(' ').every((word) => words.has(word)));
}

function toCandidate(row: AutoMapVariantRow): AutoMapCandidate {
  return {
    productId: row.product.id,
    externalProductId: row.product.externalProductId,
    productName: row.product.name,
    variantId: row.id,
    externalVariantId: row.externalVariantId,
    sku: row.sku,
    variantName: row.name,
    catalogueId: row.product.catalogueId,
    catalogueName: row.product.catalogue?.name ?? null,
  };
}
