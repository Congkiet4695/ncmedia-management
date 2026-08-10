/**
 * Gom toàn bộ file JSON dịch thành một bảng tài nguyên cho i18next.
 *
 * Import tĩnh (không `import()` động) là CHỦ Ý: bundle nhỏ (vài chục KB), đổi ngôn ngữ
 * phải tức thì và không được có trạng thái "đang tải bản dịch". Khi số ngôn ngữ tăng
 * đáng kể thì mới cân nhắc tách chunk theo ngôn ngữ.
 *
 * Thêm ngôn ngữ mới: tạo thư mục `locales/<mã>/` rồi thêm đúng MỘT khối import ở dưới.
 */

import type { Locale, Namespace } from './config';

import viAccount from './locales/vi/account.json';
import viAuth from './locales/vi/auth.json';
import viCommon from './locales/vi/common.json';
import viEmployee from './locales/vi/employee.json';
import viFulfillment from './locales/vi/fulfillment.json';
import viMenu from './locales/vi/menu.json';
import viOrder from './locales/vi/order.json';
import viPod from './locales/vi/pod.json';
import viProfile from './locales/vi/profile.json';
import viReport from './locales/vi/report.json';
import viValidation from './locales/vi/validation.json';

import enAccount from './locales/en/account.json';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enEmployee from './locales/en/employee.json';
import enFulfillment from './locales/en/fulfillment.json';
import enMenu from './locales/en/menu.json';
import enOrder from './locales/en/order.json';
import enPod from './locales/en/pod.json';
import enProfile from './locales/en/profile.json';
import enReport from './locales/en/report.json';
import enValidation from './locales/en/validation.json';

/**
 * Bảng tài nguyên: ngôn ngữ → namespace → cây khoá dịch.
 *
 * Dùng `satisfies` thay vì chú thích kiểu trực tiếp để TypeScript vẫn suy ra được
 * TỪNG khoá cụ thể — nhờ đó `t('action.save')` được kiểm tra ở compile time,
 * đồng thời vẫn bắt buộc đủ ngôn ngữ và đủ namespace.
 */
export const resources = {
  vi: {
    common: viCommon,
    menu: viMenu,
    auth: viAuth,
    validation: viValidation,
    employee: viEmployee,
    account: viAccount,
    order: viOrder,
    report: viReport,
    pod: viPod,
    fulfillment: viFulfillment,
    profile: viProfile,
  },
  en: {
    common: enCommon,
    menu: enMenu,
    auth: enAuth,
    validation: enValidation,
    employee: enEmployee,
    account: enAccount,
    order: enOrder,
    report: enReport,
    pod: enPod,
    fulfillment: enFulfillment,
    profile: enProfile,
  },
} satisfies Record<Locale, Record<Namespace, unknown>>;
