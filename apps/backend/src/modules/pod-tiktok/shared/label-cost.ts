import type { ConfigService } from '@nestjs/config';
import type { LabelCostConfig } from './order-financials';

/**
 * Chi phí label MỖI ĐƠN (`ORDER_LABEL_COST` / `ORDER_LABEL_COST_CURRENCY`, mặc định 0.50 USD).
 *
 * 🔴 Nguồn DUY NHẤT cho mọi nơi tính lợi nhuận (màn Order, Thống kê công việc nhân viên, Dashboard) — đổi
 * cấu hình là mọi màn hình đổi theo, không sửa code.
 */
export function labelCostOf(config: ConfigService): LabelCostConfig {
  return config.get<LabelCostConfig>('orderLabelCost', { amount: 0.5, currency: 'USD' });
}
