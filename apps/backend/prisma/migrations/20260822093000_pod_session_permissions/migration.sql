-- Dọn hai permission của module Draft Listing đã bị thay bằng Listing Session.
--
-- Seed chỉ UPSERT theo `code`, không bao giờ xoá — nên nếu không dọn ở đây, hai mã chết này
-- còn nằm trong danh sách phân quyền của mọi Organization và người quản trị vẫn tick được
-- một quyền không còn endpoint nào đọc tới.
--
-- `pod.draft.read` và `pod.draft.generate` KHÔNG bị xoá: chúng vẫn là quyền của Payload
-- Generator (`/pod/draft-listings/*` cũ đã bỏ, nhưng `/pod/listing-payloads` thì không).

DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "code" IN ('pod.draft.import', 'pod.draft.write')
);

DELETE FROM "permissions" WHERE "code" IN ('pod.draft.import', 'pod.draft.write');
