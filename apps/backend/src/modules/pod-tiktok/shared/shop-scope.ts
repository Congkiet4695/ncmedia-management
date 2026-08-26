/**
 * Ghép PHẠM VI shop của người dùng với BỘ LỌC shop mà người dùng chọn.
 *
 * 🔴 Hàm thuần, không phụ thuộc Nest/Prisma — để mọi repository POD dùng chung đúng một phép
 * ghép, và để kiểm được bằng unit test mà không cần dựng database.
 *
 * 🔴 **Luôn là phép GIAO, không bao giờ là phép gán đè.** Viết
 * `if (scope) where.shopId = {in: scope}; if (filter) where.shopId = filter;`
 * là bug bảo mật: dòng sau ghi đè dòng trước, và người dùng chỉ cần gửi `?shopId=<shop người
 * khác>` là đọc được dữ liệu của shop đó. Phạm vi phải là trần cứng mà bộ lọc chỉ thu hẹp
 * thêm được, không nới ra được.
 *
 * @param scope  Shop người dùng được phép thấy. `undefined` = không giới hạn.
 *               Mảng RỖNG = chưa được gán shop nào ⇒ không thấy gì.
 * @param picked Shop người dùng chọn ở bộ lọc giao diện.
 */
export function shopScopeFilter(
  scope: string[] | undefined,
  picked?: string | null,
): { in: string[] } | string | undefined {
  if (scope === undefined) return picked ?? undefined;
  if (!picked) return { in: scope };
  // Chọn một shop ngoài phạm vi ⇒ giao rỗng ⇒ không trả về gì. Tầng service còn chặn sớm
  // bằng `assertShopAllowed` để trả 403 rõ ràng thay vì một danh sách rỗng khó hiểu.
  return { in: scope.includes(picked) ? [picked] : [] };
}

/** Bản dùng cho cột `accountId` — cùng luật, khác cột. */
export function accountScopeFilter(
  scope: string[] | undefined,
  picked?: string | null,
): { in: string[] } | string | undefined {
  return shopScopeFilter(scope, picked);
}
