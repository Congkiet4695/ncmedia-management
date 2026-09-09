'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { DataPagination } from '@/components/ui/data-pagination';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  usePodProductFilters,
  usePodProductVariants,
  usePodProducts,
} from '@/features/pod-product/hooks/use-pod-products';
import {
  isPageFullySelected,
  togglePage,
  toggleRow,
  toPayload,
  type SelectionState,
} from '../selection';
import type { AddFlashSaleItemPayload, PodFlashSaleProductLevel } from '../types';

/** Cỡ trang MẶC ĐỊNH — người dùng đổi được trong dialog. */
const PAGE_SIZE = 10;

interface ProductSelectorDialogProps {
  open: boolean;
  onClose: () => void;
  /** Shop của đợt sale — bộ chọn KHÔNG bao giờ hiển thị sản phẩm của shop khác. */
  shopId: string;
  /**
   * Mức áp dụng của đợt sale, quyết định ĐƠN VỊ được chọn.
   *
   * 🔴 `VARIATION` chọn theo SKU chứ không theo sản phẩm: mỗi SKU mang giá deal riêng, nên
   * người vận hành cần thấy và chọn đúng từng SKU. `PRODUCT` giữ nguyên cách chọn theo sản
   * phẩm vì ở mức đó TikTok chỉ nhận MỘT giá cho cả sản phẩm.
   */
  productLevel: PodFlashSaleProductLevel;
  /** Sản phẩm đã có trong đợt sale — hiển thị "đã thêm" và không cho chọn lại. */
  existingProductIds: string[];
  /** Biến thể đã có trong đợt sale (chế độ VARIATION). */
  existingVariantIds?: string[];
  submitting?: boolean;
  onSubmit: (items: AddFlashSaleItemPayload[]) => void;
}

/**
 * Dialog **Add Products** — chọn nhiều sản phẩm cho một đợt Flash Sale.
 *
 * ```
 *   [ 🔍 tìm theo tên · Product ID · SKU ]  [ Trạng thái ▾ ]
 *   ┌───┬─────┬──────────────────────┬────────────┬───────┬──────────┐
 *   │ ☑ │ ảnh │ Tên sản phẩm         │ Product ID │ SKU   │ Giá      │
 *   └───┴─────┴──────────────────────┴────────────┴───────┴──────────┘
 *   ‹ 1/12 ›                                    [ Thêm 8 sản phẩm ]
 * ```
 *
 * 🔴 Lựa chọn được giữ **xuyên qua phân trang và tìm kiếm**: người dùng tick vài sản phẩm ở
 * trang 1, đổi từ khoá, tick tiếp ở trang 3 rồi mới bấm Thêm. Lưu lựa chọn theo trang (như
 * cách một bảng ngây thơ hay làm) sẽ âm thầm đánh rơi những gì đã tick trước đó.
 *
 * 🔴 Chỉ gửi `productId`. Việc bung ra thành từng SKU do BACKEND làm, vì chỉ backend mới
 * biết chắc biến thể nào còn bán và giá gốc hiện hành là bao nhiêu.
 */
export function ProductSelectorDialog({
  open,
  onClose,
  shopId,
  productLevel,
  existingProductIds,
  existingVariantIds = [],
  submitting,
  onSubmit,
}: ProductSelectorDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatCurrency } = useLocaleFormat();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  /**
   * 🔴 Lựa chọn sống NGOÀI trang hiện tại, và là MỘT cấu trúc duy nhất.
   *
   * Khoá = id đang chọn (productId hoặc variantId tuỳ chế độ), giá trị = payload sẽ gửi đi.
   * Giữ song song một `Set` id và một `Map` payload là tự tạo ra hai nguồn sự thật phải đồng
   * bộ tay — lệch nhau một nhịp là số trên nút bấm nói một đằng, dữ liệu gửi đi một nẻo.
   *
   * Vì là `Map` id ⇒ payload (không phải cờ gắn trên dòng đang render), tick ở trang 1, lật
   * sang trang 2, đổi từ khoá rồi quay lại — những gì đã tick vẫn còn nguyên.
   */
  const [selected, setSelected] = useState<SelectionState>(new Map());
  const search = useDebouncedValue(searchInput, 350);

  // Mở lại dialog là một phiên chọn MỚI — giữ lại lựa chọn cũ sẽ khiến người dùng vô tình
  // thêm những sản phẩm họ đã bỏ ý định từ lần trước.
  useEffect(() => {
    if (!open) return;
    setSelected(new Map());
    setPage(1);
    setSearchInput('');
    setStatus('');
  }, [open]);

  // Đổi từ khoá / bộ lọc thì về trang 1, nếu không người dùng đứng ở trang 7 của một kết
  // quả chỉ có 2 trang và thấy bảng trống.
  useEffect(() => setPage(1), [search, status]);

  const bySku = productLevel === 'VARIATION';

  const filters = usePodProductFilters();
  const products = usePodProducts(
    { page, limit, shopId, search: search || undefined, status: status || undefined },
    // Hai truy vấn loại trừ nhau: chỉ hỏi cái đang dùng.
  );
  const variants = usePodProductVariants(
    { page, limit, shopId, search: search || undefined },
    bySku,
  );

  const query = bySku ? variants : products;
  const meta = query.data?.meta;

  /**
   * Id đã có sẵn trong đợt sale — theo ĐÚNG đơn vị đang chọn.
   *
   * Ở chế độ SKU phải so theo `variantId`: một sản phẩm đã có SKU "Black / S" trong đợt sale
   * vẫn còn "Black / M" chưa thêm, nên khoá cả sản phẩm là chặn nhầm.
   */
  const existing = useMemo(
    () => new Set(bySku ? existingVariantIds : existingProductIds),
    [bySku, existingVariantIds, existingProductIds],
  );

  /** Các dòng của trang hiện tại, quy về một hình dạng chung cho cả hai chế độ. */
  const rows = useMemo(() => {
    if (bySku) {
      return (variants.data?.items ?? []).map((variant) => ({
        /** Khoá lựa chọn = `variantId` ở chế độ SKU. */
        key: variant.id,
        productId: variant.productId,
        variantId: variant.id as string | undefined,
        title: variant.productTitle ?? '—',
        subtitle: variant.variantName ?? variant.sellerSku ?? variant.tiktokSkuId,
        identifier: variant.sellerSku ?? variant.tiktokSkuId,
        price: variant.originalPrice,
        currency: variant.currency,
        imageUrl: variant.imageUrl,
        status: variant.status,
        skuCount: null as number | null,
      }));
    }
    return (products.data?.items ?? []).map((product) => ({
      key: product.id,
      productId: product.id,
      variantId: undefined,
      title: product.title ?? '—',
      subtitle: null as string | null,
      identifier: product.tiktokProductId,
      price: product.minPrice,
      currency: product.currency,
      imageUrl: product.thumbnailUrl,
      status: product.status,
      skuCount: product.skuCount as number | null,
    }));
  }, [bySku, products.data, variants.data]);

  /**
   * 🔴 Lựa chọn sống ngoài trang hiện tại.
   *
   * Cách làm ngây thơ (lưu trạng thái theo mảng dòng đang render) sẽ âm thầm đánh rơi lựa
   * chọn ngay khi dữ liệu trang mới về. Xem chú thích ở khai báo `selected`.
   */
  const selectableOnPage = rows.filter((row) => !existing.has(row.key));
  const allOnPageSelected = isPageFullySelected(selected, selectableOnPage);

  const toggle = (row: (typeof rows)[number]): void => {
    setSelected((previous) => toggleRow(previous, row));
  };

  /**
   * "Chọn tất cả" = tất cả trên TRANG HIỆN TẠI.
   *
   * 🔴 Cố ý không có nút "chọn toàn bộ kết quả": với 100.000 SKU, việc đó nghĩa là tải hết
   * id về trình duyệt — đúng thứ mà phân trang phía server sinh ra để tránh. Người dùng chọn
   * theo trang, và lựa chọn cộng dồn qua các trang.
   */
  const toggleAllOnPage = (): void => {
    const turningOn = !allOnPageSelected;
    setSelected((previous) => togglePage(previous, selectableOnPage, turningOn));
  };

  const submit = (): void => {
    // 🔴 Lấy từ `selected` chứ không từ `rows`: những dòng đã tick ở trang trước KHÔNG còn
    // nằm trong `rows`, nên dựng payload từ trang hiện tại là cách đánh rơi đúng chúng.
    onSubmit(toPayload(selected));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bySku ? t('flashSale.selector.titleSku') : t('flashSale.selector.title')}
      description={t('flashSale.selector.subtitle')}
      className="max-w-4xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t('flashSale.selector.selected', { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('common:action.cancel')}
            </Button>
            <Button onClick={submit} disabled={selected.size === 0 || submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('flashSale.selector.add', { count: selected.size })}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={
                bySku
                  ? t('flashSale.selector.searchSkuPlaceholder')
                  : t('flashSale.selector.searchPlaceholder')
              }
              className="pl-9"
            />
          </div>
          {/* Bộ lọc trạng thái chỉ có ở chế độ sản phẩm: danh sách SKU đã chỉ gồm SKU của
              sản phẩm ACTIVE, nên một ô lọc không đổi được gì chỉ làm người dùng phân vân. */}
          {!bySku && (
            <Combobox
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: t('flashSale.selector.allStatuses') },
                ...(filters.data?.statuses ?? []).map((value) => ({ value, label: value })),
              ]}
              className="w-[180px]"
            />
          )}
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('flashSale.selector.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={selected.size > 0 && !allOnPageSelected}
                      onChange={toggleAllOnPage}
                      disabled={selectableOnPage.length === 0}
                      aria-label={t('flashSale.selector.selectPage')}
                    />
                  </TableHead>
                  <TableHead className="w-14" />
                  <TableHead>
                    {bySku ? t('flashSale.selector.skuColumn') : t('flashSale.selector.product')}
                  </TableHead>
                  <TableHead>
                    {bySku ? t('flashSale.selector.sku') : t('flashSale.selector.productId')}
                  </TableHead>
                  {!bySku && (
                    <TableHead className="text-right">{t('flashSale.selector.sku')}</TableHead>
                  )}
                  <TableHead className="text-right">{t('flashSale.selector.price')}</TableHead>
                  <TableHead>{t('flashSale.selector.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const already = existing.has(row.key);
                  return (
                    <TableRow key={row.key} className={already ? 'opacity-60' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={already || selected.has(row.key)}
                          disabled={already}
                          onChange={() => toggle(row)}
                          aria-label={row.subtitle ?? row.title}
                        />
                      </TableCell>
                      <TableCell>
                        {row.imageUrl ? (
                          <Image
                            src={row.imageUrl}
                            alt=""
                            width={40}
                            height={40}
                            unoptimized
                            className="size-10 rounded object-cover"
                          />
                        ) : (
                          <div className="size-10 rounded bg-muted" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <p className="truncate text-sm font-medium">{row.title}</p>
                        {/* Chế độ SKU: tên biến thể là thứ phân biệt hai dòng cùng sản phẩm. */}
                        {row.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
                        )}
                        {already && (
                          <p className="text-xs text-muted-foreground">
                            {t('flashSale.selector.alreadyAdded')}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.identifier}</TableCell>
                      {!bySku && (
                        <TableCell className="text-right tabular-nums">{row.skuCount}</TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.price, row.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'ACTIVATE' ? 'success' : 'muted'}>
                          {row.status ?? '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DataPagination
          meta={meta}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setLimit(next);
            setPage(1);
          }}
        />
      </div>
    </Modal>
  );
}
