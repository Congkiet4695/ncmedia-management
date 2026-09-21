/**
 * Đăng ký hook resolve cho các script `verify-*.ts` chạy bằng `node --experimental-strip-types`.
 *
 * 🔴 Node không tự thêm đuôi `.ts` cho import tương đối (`from './manual-sku'`) — chuẩn ESM bắt
 * buộc đuôi tường minh, còn mã nguồn app thì viết KHÔNG đuôi (Next/tsc "bundler" resolve).
 * Hook này thêm `.ts`/`.tsx` khi file tồn tại, để script kiểm đúng mã nguồn đang chạy mà không
 * phải sửa import của app hay nới `allowImportingTsExtensions`.
 *
 * Dùng: `node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/verify-x.ts`
 */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
