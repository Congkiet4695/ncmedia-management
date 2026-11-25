/**
 * Kiểm chứng ô Images của "Edit draft product" (dán ảnh clipboard + kéo thả + URL) — `npm run test:draft-images`.
 *
 * Bất biến được canh:
 *   1. Clipboard KHÔNG có ảnh ⇒ rỗng (người gọi để trình duyệt dán chữ như bình thường).
 *   2. Clipboard có ảnh ⇒ lấy đúng các file ảnh, không nhân đôi giữa `items` và `files`.
 *   3. Sai định dạng / quá dung lượng bị từ chối có lý do; hết chỗ thì báo số ảnh dư — không im lặng bỏ.
 *   4. Thêm ảnh: nối CUỐI, bỏ trùng (fileId hoặc URL), không vượt trần, không đổi thumbnail.
 *   5. Kéo thả đổi thứ tự rồi lưu ⇒ `sortOrder` = vị trí mới, ảnh đầu = thumbnail, giữ fileId/imageType.
 */
import {
  appendImages,
  clipboardImageFiles,
  planImageUploads,
  toImagePayload,
  type DraftImage,
} from '../features/pod-listing-session/draft-product-images';
import {
  moveImage,
  PRODUCT_IMAGE_UPLOAD_MAX_BYTES,
  PRODUCT_IMAGE_UPLOAD_TYPES,
} from '../features/pod-listing-session/media-image-order';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`✗ ${label}\n    expected ${e}\n    actual   ${a}`);
}

const file = (name: string, type: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type });
const item = (f: File) => ({ kind: 'file', type: f.type, getAsFile: () => f });
const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => null };

// --- 1–2. Clipboard ---
check(
  'dán chữ ⇒ không có ảnh (không chặn dán)',
  clipboardImageFiles({ items: [textItem], files: [] }),
  [],
);
check('clipboard rỗng / null', clipboardImageFiles(null), []);
const shot = file('screenshot.png', 'image/png');
check(
  'ảnh chụp màn hình + chữ ⇒ đúng một ảnh',
  clipboardImageFiles({ items: [textItem, item(shot)], files: [shot] }).map((f) => f.name),
  ['screenshot.png'],
);
check(
  'không items nhưng có files (Safari) ⇒ lấy từ files, bỏ file không phải ảnh',
  clipboardImageFiles({
    items: [],
    files: [file('a.jpg', 'image/jpeg'), file('b.pdf', 'application/pdf')],
  }).map((f) => f.name),
  ['a.jpg'],
);

// --- 3. Kế hoạch tải lên ---
const rules = { types: PRODUCT_IMAGE_UPLOAD_TYPES, maxBytes: PRODUCT_IMAGE_UPLOAD_MAX_BYTES };
const gif = file('anim.gif', 'image/gif');
const huge = file('huge.png', 'image/png', PRODUCT_IMAGE_UPLOAD_MAX_BYTES + 1);
let plan = planImageUploads([gif, huge, shot], 0, 10, rules);
check(
  'sai định dạng + quá dung lượng bị từ chối có lý do',
  plan.rejected.map((r) => [r.file.name, r.reason]),
  [
    ['anim.gif', 'TYPE'],
    ['huge.png', 'SIZE'],
  ],
);
check(
  'ảnh hợp lệ vẫn được nhận',
  plan.accepted.map((f) => f.name),
  ['screenshot.png'],
);
plan = planImageUploads([shot], 10, 10, rules);
check(
  'đã đủ 10 ảnh ⇒ full, không nhận',
  [plan.full, plan.accepted.length, plan.overflow],
  [true, 0, 1],
);
plan = planImageUploads(
  [file('1.png', 'image/png'), file('2.png', 'image/png'), file('3.png', 'image/png')],
  8,
  10,
  rules,
);
check(
  'còn 2 chỗ, dán 3 ⇒ nhận 2, báo dư 1',
  [plan.accepted.length, plan.overflow, plan.full],
  [2, 1, false],
);

// --- 4. Nối ảnh ---
const A: DraftImage = { imageUrl: 'https://cdn.example/a.jpg' };
const B: DraftImage = { imageUrl: 'https://cdn.example/b.jpg', fileId: 'f-b', imageType: 'MAIN' };
const C: DraftImage = { imageUrl: 'https://cdn.example/c.jpg' };
const D: DraftImage = { imageUrl: 'https://r2.example/pasted.png', fileId: 'f-d' };
let appended = appendImages([A, B, C], [D], 10);
check(
  'dán thêm ⇒ nối cuối, thumbnail giữ nguyên',
  appended.images.map((i) => i.imageUrl),
  [A.imageUrl, B.imageUrl, C.imageUrl, D.imageUrl],
);
appended = appendImages(
  [A, B],
  [{ imageUrl: 'https://CDN.example/a.jpg' }, { imageUrl: 'x', fileId: 'f-b' }],
  10,
);
check(
  'trùng URL (khác hoa/thường host) hoặc trùng fileId ⇒ bỏ, có đếm',
  [appended.images.length, appended.duplicates],
  [2, 2],
);
const nine = Array.from({ length: 9 }, (_, i) => ({ imageUrl: `https://cdn/${i}.png` }));
appended = appendImages(nine, [D, { imageUrl: 'https://cdn/extra.png' }], 10);
check('không vượt trần 10, báo dư', [appended.images.length, appended.overflow], [10, 1]);

// --- 5. Kéo thả + lưu ---
const pastedThenFirst = moveImage([A, B, C, D], 3, 0);
check(
  'kéo D lên đầu ⇒ D A B C',
  pastedThenFirst.map((i) => i.imageUrl),
  [D.imageUrl, A.imageUrl, B.imageUrl, C.imageUrl],
);
check(
  'payload lưu đúng thứ tự + sortOrder + giữ fileId/imageType',
  toImagePayload(pastedThenFirst),
  [
    { imageUrl: D.imageUrl, sortOrder: 0, fileId: 'f-d' },
    { imageUrl: A.imageUrl, sortOrder: 1 },
    { imageUrl: B.imageUrl, sortOrder: 2, fileId: 'f-b', imageType: 'MAIN' },
    { imageUrl: C.imageUrl, sortOrder: 3 },
  ],
);
let shuffled = [A, B, C, D];
for (const [from, to] of [
  [0, 3],
  [3, 0],
  [1, 2],
  [0, 3],
])
  shuffled = moveImage(shuffled, from, to);
check(
  'đổi nhiều lần ⇒ đủ ảnh, không trùng, không mất',
  shuffled.map((i) => i.imageUrl).sort(),
  [A.imageUrl, B.imageUrl, C.imageUrl, D.imageUrl].sort(),
);
check('chỉ đổi thứ tự ⇒ không mất ảnh cũ', toImagePayload(moveImage([A, B], 0, 1)).length, 2);
check(
  'kéo cuối ↔ đầu',
  moveImage([A, B, C], 0, 2).map((i) => i.imageUrl),
  [B.imageUrl, C.imageUrl, A.imageUrl],
);

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ draft product images: ${passed} checks passed`);
