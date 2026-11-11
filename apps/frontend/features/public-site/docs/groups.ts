/**
 * Cấu trúc trung tâm tài liệu: kiểu dữ liệu bài viết, nhóm & thứ tự đọc, mục lục trong bài.
 * Tách khỏi `index.ts` (nơi nạp JSON) để script kiểm chứng chạy bằng Node thuần import được.
 */
export interface DocStep {
  title: string;
  detail: string;
}

export interface DocTroubleshoot {
  problem: string;
  solution: string;
}

export interface DocArticle {
  slug: string;
  title: string;
  summary: string;
  overview: string;
  whenToUse: string[];
  prerequisites: string[];
  steps: DocStep[];
  notes: string[];
  troubleshooting: DocTroubleshoot[];
  /** Màn hình trong ứng dụng mà bài viết mô tả (để chụp ảnh minh hoạ). */
  screenshotRoute: string;
  /** Quyền cần để mở màn hình (null = mọi người dùng đã đăng nhập / trang công khai). */
  permission: string | null;
}

export interface DocGroup {
  id: string;
  title: string;
  slugs: string[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    id: 'bat-dau',
    title: 'Bắt đầu',
    slugs: [
      'gioi-thieu',
      'dang-ky-organization',
      'dang-nhap',
      'tong-quan-dashboard',
      'goi-su-dung-gioi-han-shop-ngay-het-han',
    ],
  },
  {
    id: 'to-chuc',
    title: 'Tổ chức & đội ngũ',
    slugs: ['nhan-vien', 'thong-ke-cong-viec-nhan-vien', 'thong-bao', 'ho-so-ca-nhan'],
  },
  {
    id: 'tiktok-shop',
    title: 'TikTok Shop & sản phẩm',
    slugs: [
      'ket-noi-tai-khoan-tiktok-shop',
      'quan-ly-shop-va-dong-bo-shop',
      'san-pham',
      'du-lieu-chuan-master-data',
    ],
  },
  {
    id: 'listing',
    title: 'Listing & Flash Sale',
    slugs: [
      'template',
      'auto-listing',
      'custom-listing',
      'clone-san-pham',
      'draft-listings',
      'lich-su-publish',
      'flash-sale',
      'auto-flash-sale',
    ],
  },
  {
    id: 'don-hang',
    title: 'Đơn hàng & tài chính',
    slugs: ['don-hang-tiktok', 'don-hoan-tra-returns', 'tiktok-payout'],
  },
  {
    id: 'fulfillment',
    title: 'Fulfillment',
    slugs: [
      'nha-cung-cap-fulfillment',
      'cau-hinh-san-pham-anh-xa',
      'design',
      'fulfill-don-hang',
      'base-cost',
    ],
  },
];

/** Mục lục trong bài — id cố định để TOC, anchor và tiêu đề luôn khớp. */
export const DOC_SECTIONS = [
  { id: 'tong-quan', title: 'Tổng quan' },
  { id: 'khi-nao-dung', title: 'Khi nào sử dụng' },
  { id: 'dieu-kien', title: 'Điều kiện trước khi thực hiện' },
  { id: 'cac-buoc', title: 'Các bước thực hiện' },
  { id: 'luu-y', title: 'Lưu ý' },
  { id: 'xu-ly-loi', title: 'Lỗi thường gặp' },
] as const;
