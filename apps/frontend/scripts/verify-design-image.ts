/**
 * Kiểm chứng luật chọn ảnh design được thu nhỏ — `npm run test:design-image`.
 */

import { isOptimizableDesignUrl, storageImagePatterns } from '../features/fulfillment/design-image-source';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const BASE = 'https://cdn.example.com/';
const TWO = 'https://cdn.example.com, https://old.example.net/';

check('một host', storageImagePatterns(BASE), [{ protocol: 'https', hostname: 'cdn.example.com', port: '' }]);
check('nhiều host', storageImagePatterns(TWO).map((pattern) => pattern.hostname), ['cdn.example.com', 'old.example.net']);
check('chưa cấu hình', storageImagePatterns(undefined), []);
check('chuỗi rỗng', storageImagePatterns(''), []);
check('sai dạng bị bỏ qua', storageImagePatterns('not a url,https://a.example').length, 1);
check('không phải http', storageImagePatterns('ftp://cdn.example.com'), []);

check('file trên Storage', isOptimizableDesignUrl('https://cdn.example.com/pod/a.png', BASE), true);
check('file trên host cũ', isOptimizableDesignUrl('https://old.example.net/pod/a.png', TWO), true);
check('chưa cấu hình ⇒ giữ file gốc', isOptimizableDesignUrl('https://cdn.example.com/a.png', undefined), false);
check('Google Drive ⇒ giữ nguyên', isOptimizableDesignUrl('https://drive.google.com/uc?id=1', TWO), false);
check('đường tải có kiểm quyền ⇒ giữ nguyên', isOptimizableDesignUrl('/api/v1/storage/1/download', BASE), false);
check('khác giao thức', isOptimizableDesignUrl('http://cdn.example.com/a.png', BASE), false);
check('khác cổng', isOptimizableDesignUrl('https://cdn.example.com:8443/a.png', BASE), false);
check('host chỉ giống phần đầu', isOptimizableDesignUrl('https://cdn.example.com.evil.test/a.png', BASE), false);

console.log(`verify-design-image: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
