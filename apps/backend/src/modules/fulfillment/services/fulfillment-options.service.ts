import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentAccount, FulfillmentProvider, PodDesignPlacement } from '@prisma/client';
import {
  MANGO_FACILITIES,
  MANGO_PREFERRED_CARRIERS,
  MANGO_PRODUCTION_CONFIGS,
  MANGO_PROVIDER_NOTICE,
  MANGO_SHIPPING_METHODS,
  MANGO_SPEED_TYPES,
} from '../mango/constants/mango.constants';
import { DEFAULT_PLACEMENT_MAP } from '../mango/mappers/mango-order.mapper';
import { MangoCatalogService } from '../mango/services/mango-catalog.service';

/** Một lựa chọn cho ô chọn ở giao diện: giá trị gửi lên + nhãn hiển thị. */
export interface FulfillmentOption {
  value: string;
  label: string;
}

/** Vị trí in hệ thống hỗ trợ, kèm khoá tương ứng phía nhà cung cấp. */
export interface PrintLocationOption {
  /** `PodDesignPlacement` — khoá NỘI BỘ, cũng là tham số của API upload design. */
  placement: PodDesignPlacement;
  /** `print_files[].key` sẽ gửi đi. Bản ghi ánh xạ có thể ghi đè bằng `placementMap`. */
  providerKey: string;
}

/** Toàn bộ lựa chọn của MỘT tài khoản nhà cung cấp — nguồn duy nhất cho màn hình Fulfill. */
export interface FulfillmentOptions {
  provider: FulfillmentProvider;
  accountId: string;
  /** Lưu ý riêng của nhà cung cấp (hiện ở đầu khối cấu hình sản phẩm). */
  notice: string | null;
  shippingMethods: FulfillmentOption[];
  facilities: FulfillmentOption[];
  speedTypes: FulfillmentOption[];
  preferredCarriers: FulfillmentOption[];
  productionConfigs: FulfillmentOption[];
  /** Lấy TRỰC TIẾP từ nhà cung cấp (`GET /production-lines`). Rỗng = chưa hỏi được. */
  productionLines: FulfillmentOption[];
  printLocations: PrintLocationOption[];
  /** Lời gọi tới nhà cung cấp hỏng ⇒ nói rõ, không im lặng trả danh sách rỗng. */
  warnings: string[];
}

/** Thời gian nhớ danh sách production line (ms). Danh sách này gần như tĩnh. */
const PRODUCTION_LINE_CACHE_MS = 10 * 60_000;

/**
 * FulfillmentOptionsService — trả lời "nhà cung cấp này nhận những giá trị nào?".
 *
 * 🔴 Tồn tại để GIAO DIỆN KHÔNG VIẾT CỨNG dữ liệu của nhà cung cấp. Trước đây danh sách
 * shipping method / facility / speed type nằm luôn trong file TypeScript của frontend: thêm một
 * nhà cung cấp thứ hai là lập tức sai, và sửa một giá trị phải build lại cả web.
 *
 * Nguồn của từng nhóm:
 *   - shipping / facility / speed / carrier / production config → hằng số ĐÃ CHÉP NGUYÊN VĂN từ
 *     tài liệu MangoV3 (`mango.constants.ts`) — đây là hợp đồng API, không phải dữ liệu chạy.
 *   - production line → hỏi thẳng nhà cung cấp (`GET /production-lines`), nhớ 10 phút.
 *   - print location → vị trí in hệ thống hỗ trợ + khoá tương ứng của nhà cung cấp.
 *
 * Thêm nhà cung cấp mới: thêm một nhánh ở `forAccount()`, KHÔNG sửa giao diện.
 */
@Injectable()
export class FulfillmentOptionsService {
  private readonly logger = new Logger(FulfillmentOptionsService.name);

  private readonly productionLineCache = new Map<
    string,
    { at: number; lines: FulfillmentOption[] }
  >();

  constructor(private readonly catalog: MangoCatalogService) {}

  async forAccount(account: FulfillmentAccount): Promise<FulfillmentOptions> {
    const warnings: string[] = [];
    const base: FulfillmentOptions = {
      provider: account.provider,
      accountId: account.id,
      notice: null,
      shippingMethods: [],
      facilities: [],
      speedTypes: [],
      preferredCarriers: [],
      productionConfigs: [],
      productionLines: [],
      printLocations: [],
      warnings,
    };

    if (account.provider !== FulfillmentProvider.MANGO) {
      // Nhà cung cấp khác chưa có tích hợp ⇒ trả danh sách RỖNG kèm cảnh báo, tuyệt đối không
      // mượn tạm giá trị của Mango: gửi `shipping_method` của xưởng này sang xưởng kia là lỗi
      // không ai phát hiện cho tới khi hàng đi sai đường.
      warnings.push(
        `Nhà cung cấp ${account.provider} chưa có tích hợp danh mục — chưa lấy được lựa chọn cấu hình.`,
      );
      return base;
    }

    return {
      ...base,
      notice: MANGO_PROVIDER_NOTICE,
      shippingMethods: MANGO_SHIPPING_METHODS.map((value) => ({ value, label: value })),
      facilities: MANGO_FACILITIES.map((value) => ({ value, label: value })),
      speedTypes: MANGO_SPEED_TYPES.map((value) => ({ value, label: value })),
      preferredCarriers: MANGO_PREFERRED_CARRIERS.map((value) => ({ value, label: value })),
      productionConfigs: MANGO_PRODUCTION_CONFIGS.map((value) => ({ value, label: value })),
      productionLines: await this.productionLines(account, warnings),
      printLocations: Object.entries(DEFAULT_PLACEMENT_MAP).map(([placement, providerKey]) => ({
        placement: placement as PodDesignPlacement,
        providerKey,
      })),
    };
  }

  /**
   * Danh sách production line của nhà cung cấp.
   *
   * Fail-soft: hỏng thì trả rỗng kèm cảnh báo để giao diện nói "chưa lấy được, dùng mặc định
   * của tài khoản" — chặn cả màn hình cấu hình chỉ vì một lời gọi phụ là phản ứng thái quá.
   */
  private async productionLines(
    account: FulfillmentAccount,
    warnings: string[],
  ): Promise<FulfillmentOption[]> {
    const cached = this.productionLineCache.get(account.id);
    if (cached && Date.now() - cached.at < PRODUCTION_LINE_CACHE_MS) return cached.lines;

    try {
      const items = await this.catalog.fetchProductionLines(account);
      const lines = items
        .filter((line) => line.id)
        .map((line) => ({ value: String(line.id), label: line.name || String(line.id) }));
      this.productionLineCache.set(account.id, { at: Date.now(), lines });
      return lines;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi không xác định';
      this.logger.warn({
        module: 'fulfillment',
        operation: 'options.production-lines',
        accountId: account.id,
        msg: `Không lấy được production line: ${message}`,
      });
      warnings.push(`Chưa lấy được danh sách line sản xuất từ nhà cung cấp: ${message}`);
      return [];
    }
  }
}
