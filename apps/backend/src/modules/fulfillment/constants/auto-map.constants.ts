/**
 * Tham số của ánh xạ tự động.
 *
 * Tách khỏi service để các con số này nằm ở MỘT chỗ, có giải thích, và đổi được mà không phải
 * đọc lại logic nghiệp vụ.
 */
export const AUTO_MAP = {
  /**
   * Số cặp (Product ID + Seller SKU) tối đa rà trong một lượt.
   *
   * Lưới an toàn, không phải giới hạn nghiệp vụ: một tổ chức thực tế có vài chục tới vài trăm
   * sản phẩm. Con số này chặn trường hợp dữ liệu bất thường biến một lượt rà theo lịch thành
   * một tác vụ chạy hàng giờ. Chạm trần thì lượt kế tiếp rà nốt phần còn lại — vì cặp đã ánh
   * xạ xong sẽ không xuất hiện lại trong truy vấn.
   */
  maxKeysPerRun: 2000,

  /**
   * Số ứng viên tối đa lưu vào `fulfillment_mapping_candidates.candidates`.
   *
   * Cột này để màn hình "Map Product" mở ra đã lọc sẵn, KHÔNG phải để lưu cả danh mục. Quá 20
   * ứng viên thì danh sách gợi ý cũng không còn giúp được gì, người dùng sẽ tự tìm kiếm.
   */
  maxStoredCandidates: 20,
} as const;
