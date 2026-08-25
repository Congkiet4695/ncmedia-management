'use client';

import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PreviewResult } from '@/features/pod-listing/types';

/**
 * Xem trước payload sau khi áp template của lượt đăng — **đúng thứ sẽ được gửi** khi bấm
 * Start Listing.
 *
 * 🔴 Mô tả render trong `iframe sandbox=""`: đó là HTML do người dùng dán vào Description
 * Template, không phải HTML của mình. Nhúng thẳng vào trang là mở cửa cho script chạy trong
 * phiên đăng nhập của người đang xem.
 */
export function SessionPreviewDialog({
  preview,
  onClose,
}: {
  preview: PreviewResult | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('pod');
  if (!preview) return null;

  const { payload, issues } = preview;

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-3xl"
      title={t('listing.products.previewTitle')}
      description={t('listing.products.previewHint')}
    >
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 text-sm">
        {issues.length > 0 && (
          <ul className="space-y-1 rounded-md border p-3">
            {issues.map((issue, index) => (
              <li
                key={index}
                className={issue.level === 'ERROR' ? 'text-destructive' : 'text-amber-600'}
              >
                [{issue.level}] {issue.message}
              </li>
            ))}
          </ul>
        )}

        <Row label={t('listing.preview.titleField')} value={payload.title} />
        <Row
          label={t('listing.preview.category')}
          value={payload.category.path ?? payload.category.name}
        />
        <Row label={t('listing.preview.brand')} value={payload.brand.name} />
        <Row label={t('listing.preview.warehouse')} value={payload.warehouse.name} />
        <Row
          label={t('listing.preview.pricing')}
          value={
            payload.pricing
              ? `${payload.pricing.salePrice} / ${payload.pricing.retailPrice} ${payload.pricing.currency ?? ''}`
              : null
          }
        />

        <div className="flex flex-wrap gap-2">
          {payload.images.slice(0, 9).map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${image.url}-${index}`}
              src={image.url}
              alt={image.title}
              className="size-16 rounded border object-cover"
            />
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.products.variant')}</TableHead>
              <TableHead>Seller SKU</TableHead>
              <TableHead className="text-right">{t('listing.products.salePrice')}</TableHead>
              <TableHead className="text-right">{t('listing.products.quantity')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payload.variants.map((variant) => (
              <TableRow key={variant.sellerSku}>
                <TableCell>{variant.variantName}</TableCell>
                <TableCell className="font-mono text-xs">{variant.sellerSku}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {variant.salePrice ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{variant.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <iframe
          title="session-description-preview"
          sandbox=""
          srcDoc={payload.description}
          className="h-40 w-full rounded-md border bg-white"
        />
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}
