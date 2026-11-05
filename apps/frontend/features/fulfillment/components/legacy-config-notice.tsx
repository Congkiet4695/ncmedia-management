'use client';

import { Copy, History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { useFulfillmentActions } from '../hooks/use-fulfillment';
import type { FulfillmentLegacyConfig } from '../types';

interface LegacyConfigNoticeProps {
  podOrderId: string;
  /** Một dòng đơn của biến thể — backend lấy biến thể từ chính dòng này. */
  podOrderItemId: string;
  config: FulfillmentLegacyConfig;
  onAdopted: () => void;
  onPreviewDesign: (src: string) => void;
}

/**
 * Cấu hình cũ cùng Seller SKU, dùng chung nhiều biến thể nên hệ thống KHÔNG tự áp dụng. Người vận hành xem SKU nhà cung
 * cấp và file in cũ rồi xác nhận dùng cho đúng biến thể này; backend chép sang bản ghi riêng của biến thể, không cần upload lại.
 */
export function LegacyConfigNotice({
  podOrderId,
  podOrderItemId,
  config,
  onAdopted,
  onPreviewDesign,
}: LegacyConfigNoticeProps) {
  const { t } = useTranslation(['fulfillment']);
  const translateApiError = useApiError();
  const { adoptLegacyConfig } = useFulfillmentActions(podOrderId);

  const adopt = () => {
    void adoptLegacyConfig
      .mutateAsync(podOrderItemId)
      .then(() => {
        toast.success(t('fulfill.legacy.adopted'));
        onAdopted();
      })
      .catch((error: unknown) =>
        toast.error(t('fulfill.legacy.adoptFailed'), { description: translateApiError(error) }),
      );
  };

  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-warning">
        <History className="size-3.5 shrink-0" />
        {t('fulfill.legacy.title')}
      </p>
      <p className="text-muted-foreground">{t('fulfill.legacy.description')}</p>
      {config.providerSku && (
        <p className="break-words">
          {t('fulfill.legacy.providerSku')}: <span className="font-mono">{config.providerSku}</span>
          {config.providerProductName && <span> · {config.providerProductName}</span>}
          {config.providerVariantName && <span> · {config.providerVariantName}</span>}
        </p>
      )}
      {config.designs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {config.designs.map((design) => (
            <button
              key={design.placement}
              type="button"
              onClick={() => onPreviewDesign(design.fileUrl)}
              className="w-16 space-y-0.5 text-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={design.fileUrl}
                alt={design.placement}
                className="size-16 rounded border object-cover"
                loading="lazy"
              />
              <span className="block truncate text-[10px] text-muted-foreground">{design.placement}</span>
            </button>
          ))}
        </div>
      )}
      <Button type="button" size="sm" variant="secondary" onClick={adopt} disabled={adoptLegacyConfig.isPending}>
        {adoptLegacyConfig.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
        {t('fulfill.legacy.adopt')}
      </Button>
    </div>
  );
}
