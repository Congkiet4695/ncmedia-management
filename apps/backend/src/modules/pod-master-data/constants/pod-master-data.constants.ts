import { PodResourceType } from '@prisma/client';

/**
 * Hằng số module Master Data toàn cục.
 *
 * 🔴 Không có dữ liệu nghiệp vụ nào ở đây — danh mục, thương hiệu, thuộc tính đều đến từ
 * TikTok. File này chỉ mô tả phạm vi, giới hạn kỹ thuật và khoá chống chạy chồng.
 */

/**
 * Ba tài nguyên **toàn cục**, theo đúng thứ tự phải chạy.
 *
 * 🔴 Thứ tự là ràng buộc dữ liệu, không phải sở thích: thuộc tính lấy THEO danh mục, nên
 * chưa có cây danh mục thì bước thứ ba không có gì để hỏi TikTok.
 *
 * WAREHOUSE **không** nằm ở đây: kho là của từng shop, vẫn do `pod-resource` phụ trách.
 */
export const POD_MASTER_DATA_RESOURCES: PodResourceType[] = [
  PodResourceType.CATEGORY,
  PodResourceType.BRAND,
  PodResourceType.CATEGORY_ATTRIBUTE,
];

/**
 * Khoá Redis chống hai lượt đồng bộ toàn cục chạy chồng nhau.
 *
 * 🔴 Cột `status = RUNNING` trong database KHÔNG đủ làm hàng rào: API chạy nhiều instance,
 * và giữa lúc đọc status với lúc ghi RUNNING là một khoảng hở đủ để hai instance cùng lọt
 * qua. Khoá Redis (`SET NX PX`) mới là phép kiểm tra-và-ghi nguyên tử.
 */
export const POD_MASTER_DATA_SYNC_LOCK = 'pod:master-data:sync:lock';

/**
 * TTL của khoá (ms). Hữu hạn để một tiến trình chết không khoá vĩnh viễn chức năng đồng bộ.
 *
 * 🔴 TTL này KHÔNG phải trần thời gian chạy: quét thương hiệu là hàng chục nghìn lời gọi
 * TikTok và kéo dài hàng giờ. Lượt đang chạy tự gia hạn khoá theo nhịp
 * `POD_MASTER_DATA_SYNC_LOCK_RENEW_MS` (watchdog); TTL chỉ cần lớn hơn nhịp gia hạn đủ xa
 * để một lần gia hạn trượt (Redis chập chờn) chưa làm mất khoá.
 */
export const POD_MASTER_DATA_SYNC_LOCK_TTL_MS = 30 * 60 * 1000;

/** Nhịp gia hạn khoá trong lúc lượt đang chạy (ms). */
export const POD_MASTER_DATA_SYNC_LOCK_RENEW_MS = 5 * 60 * 1000;

/**
 * Khoá Redis giữ tiến độ của lượt ĐANG chạy (JSON `MasterDataSyncProgressDto`).
 *
 * Để ở Redis chứ không phải cột database: tiến độ là dữ liệu tạm, đổi mỗi vài giây trong
 * suốt lượt và vô nghĩa khi lượt kết thúc. Ghi vào bảng là hàng nghìn UPDATE chỉ để hiển thị.
 */
export const POD_MASTER_DATA_SYNC_PROGRESS_KEY = 'pod:master-data:sync:progress';

/** TTL của tiến độ (ms) — dài hơn khoảng cách giữa hai lần báo tiến độ thật xa. */
export const POD_MASTER_DATA_SYNC_PROGRESS_TTL_MS = 60 * 60 * 1000;

/** Số dòng nhật ký trả về tối đa trong một lần đọc. */
export const POD_MASTER_DATA_LOG_MAX_ITEMS = 100;

/** Số danh mục tối đa được chỉ định đích danh khi lấy thuộc tính trong một lần bấm. */
export const POD_MASTER_DATA_ATTRIBUTE_MAX_CATEGORIES = 200;
