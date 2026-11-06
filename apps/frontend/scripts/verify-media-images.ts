/**
 * Kiểm chứng luật danh sách Product Images (kéo thả + thêm bằng URL) — `npm run test:media-images`.
 */

import {
  classifyImageUrl,
  imageKeys,
  moveImage,
  normalizeImageUrl,
  parseImageUrls,
  readdImage,
} from '../features/pod-listing-session/media-image-order.ts';

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

const list = ['A', 'B', 'C', 'D'];
check('kéo đầu xuống cuối', moveImage(list, 0, 3), ['B', 'C', 'D', 'A']);
check('kéo cuối lên đầu', moveImage(list, 3, 0), ['D', 'A', 'B', 'C']);
check('kéo giữa', moveImage(list, 1, 2), ['A', 'C', 'B', 'D']);
check('thả tại chỗ ⇒ không đổi', moveImage(list, 2, 2), list);
check('index ngoài mảng ⇒ không đổi', moveImage(list, 5, 0), list);
check('không làm đổi mảng gốc', list, ['A', 'B', 'C', 'D']);
let many = [...list];
for (const [from, to] of [[0, 3], [2, 0], [1, 2], [3, 1]]) many = moveImage(many, from, to);
check('đổi nhiều lần vẫn đủ ảnh, không trùng', [...many].sort(), ['A', 'B', 'C', 'D']);
// Xoá rồi thêm sau khi đổi thứ tự — thao tác mảng thường, thứ tự còn lại giữ nguyên.
const afterDelete = moveImage(list, 0, 3).filter((x) => x !== 'C');
check('xoá sau khi đổi thứ tự', afterDelete, ['B', 'D', 'A']);
check('thêm sau khi đổi thứ tự (thêm vào cuối)', [...afterDelete, 'E'], ['B', 'D', 'A', 'E']);

const images = [
  { imageUrl: 'https://cdn/a.jpg', fileId: 'f1' },
  { imageUrl: 'https://cdn/b.jpg', uri: 'tos/b' },
  { imageUrl: 'https://cdn/c.jpg' },
  { imageUrl: 'https://cdn/c.jpg' },
];
check('khoá ổn định: fileId > uri > url, trùng thì hậu tố', imageKeys(images), ['f1', 'tos/b', 'https://cdn/c.jpg', 'https://cdn/c.jpg#1']);
check('khoá đi THEO ảnh khi đổi thứ tự (không theo index)', imageKeys(moveImage(images, 0, 2))[2], 'f1');

check(
  'tách nhiều URL (xuống dòng, khoảng trắng, dấu phẩy) + kiểm hình thức',
  parseImageUrls(' https://a.com/1.jpg\nhttp://b.com/2.png , ftp://c.com/x  javascript:alert(1) nope '),
  [
    { url: 'https://a.com/1.jpg', problem: null },
    { url: 'http://b.com/2.png', problem: null },
    { url: 'ftp://c.com/x', problem: 'NOT_HTTP' },
    { url: 'javascript:alert(1)', problem: 'NOT_HTTP' },
    { url: 'nope', problem: 'INVALID' },
  ],
);
check('URL quá dài', parseImageUrls(`https://a.com/${'x'.repeat(2100)}`)[0].problem, 'TOO_LONG');
check('ô trống ⇒ không URL nào', parseImageUrls('   \n '), []);
check('trùng URL: bỏ #fragment, host chữ thường', normalizeImageUrl('https://CDN.example.com/a.jpg#zoom'), 'https://cdn.example.com/a.jpg');
check('query giữ nguyên (có thể là ảnh khác)', normalizeImageUrl('https://cdn/a.jpg?v=2') === normalizeImageUrl('https://cdn/a.jpg?v=1'), false);

// --- URL đã có / đã xoá ---
const stored = (id: string) => ({ imageUrl: `https://store/${id}.jpg`, fileId: id });
const [imgA, imgB, imgC] = [stored('a'), stored('b'), stored('c')];
const SOURCE = 'https://shop.example/a.jpg';
const memory = new Map([[SOURCE, imgA]]);

check('URL mới ⇒ NEW', classifyImageUrl('https://new.example/x.jpg', [imgA], memory), { status: 'NEW' });
check('URL nguồn của ảnh đang có ⇒ PRESENT', classifyImageUrl(SOURCE, [imgB, imgA], memory), {
  status: 'PRESENT',
  index: 1,
});
check('URL lưu trữ của ảnh đang có ⇒ PRESENT', classifyImageUrl('https://store/b.jpg', [imgA, imgB], new Map()), {
  status: 'PRESENT',
  index: 1,
});
check('đã xoá (hoặc template thay bộ ảnh) ⇒ REMOVED, giữ lại file đã tải', classifyImageUrl(SOURCE, [imgB], memory), {
  status: 'REMOVED',
  image: imgA,
});
check('khác #fragment vẫn là một URL', classifyImageUrl(`${SOURCE}#zoom`, [imgA], memory).status, 'PRESENT');
check('khác query là URL khác', classifyImageUrl(`${SOURCE}?x=1`, [imgA], memory).status, 'NEW');
check(
  'ảnh không có URL không khớp nhầm',
  classifyImageUrl('https://n.example/1.jpg', [{ imageUrl: '', fileId: 'z' }], new Map()).status,
  'NEW',
);

const ids = (list: Array<{ fileId?: string }>) => list.map((image) => image.fileId);
check('đưa lại ảnh đã xoá ⇒ vào cuối', ids(readdImage([imgB, imgC], imgA, 9)), ['b', 'c', 'a']);
check('🔴 ảnh chính đang có ⇒ giữ nguyên, không đổi ảnh chính', ids(readdImage([imgA, imgB, imgC], imgA, 9)), ['a', 'b', 'c']);
check('ảnh giữa đang có ⇒ giữ nguyên, không nhân đôi', ids(readdImage([imgA, imgB, imgC], imgB, 9)), ['a', 'b', 'c']);
check('đưa lại ảnh đã xoá ⇒ ảnh chính không đổi', readdImage([imgB, imgC], imgA, 9)[0].fileId, 'b');
check('danh sách rỗng ⇒ ảnh đưa lại thành ảnh chính', ids(readdImage([], imgA, 9)), ['a']);
check('bấm nhiều lần vẫn một bản', ids(readdImage(readdImage([imgB, imgC], imgA, 9), imgA, 9)), ['b', 'c', 'a']);
check('hết chỗ ⇒ không thêm', ids(readdImage([imgB, imgC], imgA, 2)), ['b', 'c']);
check('ảnh đang có khi đã hết chỗ ⇒ giữ nguyên', ids(readdImage([imgA, imgB], imgA, 2)), ['a', 'b']);
check('không sửa mảng gốc', ids([imgB, imgC]), ['b', 'c']);
const readded = readdImage([imgB, imgC], imgA, 9);
check('xoá sau khi đưa lại', ids(readded.filter((image) => image.fileId !== 'a')), ['b', 'c']);
check('sắp xếp sau khi đưa lại', ids(moveImage(readded, 2, 0)), ['a', 'b', 'c']);

console.log(`verify-media-images: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
