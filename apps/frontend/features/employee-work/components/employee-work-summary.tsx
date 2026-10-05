'use client';

import { useTranslation } from 'react-i18next';
import { ClipboardList, Package, Store, TrendingUp, Users, Wallet } from 'lucide-react';
import { StatCard } from '@/features/reports/components/stat-card';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import type { EmployeeWorkSummary as Summary } from '../types';

interface EmployeeWorkSummaryProps {
  summary?: Summary;
  currency: string | null;
  loading: boolean;
}

/**
 * Sáu thẻ tóm tắt. Đơn / lợi nhuận do backend cộng theo SHOP DUY NHẤT — thẻ chỉ hiển thị.
 * Lợi nhuận `null` (chưa đơn nào tính được) hiện "—", không hiện 0.
 */
export function EmployeeWorkSummary({ summary, currency, loading }: EmployeeWorkSummaryProps) {
  const { t } = useTranslation('report');
  const { formatCurrency, formatNumber } = useLocaleFormat();
  const showLoading = loading && !summary;

  const cards = [
    { key: 'activeEmployees', icon: Users, value: formatNumber(summary?.activeEmployees) },
    { key: 'accountsListed', icon: Store, value: formatNumber(summary?.accountsListed) },
    { key: 'productsListed', icon: Package, value: formatNumber(summary?.productsListed) },
    { key: 'orders', icon: ClipboardList, value: formatNumber(summary?.orders) },
    { key: 'profit', icon: Wallet, value: formatCurrency(summary?.profit, currency) },
    {
      key: 'profitPerOrder',
      icon: TrendingUp,
      value: formatCurrency(summary?.profitPerOrder, currency),
    },
  ] as const;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <StatCard
          key={card.key}
          label={t(`employeeWork.summary.${card.key}`)}
          value={card.value}
          icon={card.icon}
          loading={showLoading}
        />
      ))}
    </div>
  );
}
