'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';
import {
  useClonePodTemplate,
  useDeletePodTemplate,
  usePodTemplates,
  type PodTemplateKind,
} from './use-pod-listing';
import type { PodListingMarket, PodTemplateQuery, PodTemplateSortField } from '../types';

/** Bộ lọc trạng thái dùng chung cho cả sáu màn hình. */
export type TemplateStatusFilter = 'ALL' | 'ACTIVE' | 'DEFAULT';

const PAGE_SIZE = 20;

/**
 * Toàn bộ trạng thái danh sách của MỘT màn hình template: tìm kiếm, lọc, sắp xếp, phân
 * trang, xoá và nhân bản.
 *
 * Sáu màn hình cần y hệt nhau bộ này. Viết một lần ở đây để chúng không trôi dạt về hành
 * vi — ví dụ đổi bộ lọc mà quên đưa trang về 1 là lỗi kinh điển, và nó chỉ cần sai ở một
 * màn hình là người dùng thấy "danh sách trống" một cách khó hiểu.
 */
export function useTemplateListState<T extends { id: string; name: string }>(
  kind: PodTemplateKind,
  options: { withMarket?: boolean } = {},
) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();

  const [page, setPage] = useState(1);
  const [search, setSearchValue] = useState('');
  const [status, setStatusValue] = useState<TemplateStatusFilter>('ALL');
  const [market, setMarketValue] = useState<PodListingMarket | ''>('');
  const [sortBy, setSortBy] = useState<PodTemplateSortField>('displayOrder');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const query: PodTemplateQuery = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: search || undefined,
      activeOnly: status === 'ACTIVE' ? true : undefined,
      defaultOnly: status === 'DEFAULT' ? true : undefined,
      market: options.withMarket && market ? market : undefined,
      sortBy,
      sortOrder,
    }),
    [page, search, status, market, sortBy, sortOrder, options.withMarket],
  );

  const list = usePodTemplates<T>(kind, query);
  const remove = useDeletePodTemplate(kind);
  const clone = useClonePodTemplate(kind);

  /** Đổi điều kiện lọc thì luôn quay về trang 1 — trang 5 của bộ lọc cũ thường là trang trống. */
  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);
  const setStatus = useCallback((value: TemplateStatusFilter) => {
    setStatusValue(value);
    setPage(1);
  }, []);
  const setMarket = useCallback((value: PodListingMarket | '') => {
    setMarketValue(value);
    setPage(1);
  }, []);
  const setSort = useCallback((by: PodTemplateSortField, order: 'asc' | 'desc') => {
    setSortBy(by);
    setSortOrder(order);
    setPage(1);
  }, []);

  const handleDelete = useCallback(
    async (item: T) => {
      if (!window.confirm(t('listing.common.confirmDelete', { name: item.name }))) return;
      try {
        await remove.mutateAsync(item.id);
        toast.success(t('listing.common.deleted'));
      } catch (error) {
        toast.error(t('listing.common.deleteFailed'), { description: translateApiError(error) });
      }
    },
    [remove, t, translateApiError],
  );

  const handleClone = useCallback(
    async (item: T) => {
      try {
        await clone.mutateAsync({ id: item.id });
        toast.success(t('listing.common.cloned', { name: item.name }));
      } catch (error) {
        toast.error(t('listing.common.cloneFailed'), { description: translateApiError(error) });
      }
    },
    [clone, t, translateApiError],
  );

  return {
    query,
    list,
    items: list.data?.items ?? [],
    meta: list.data?.meta ?? null,
    search,
    setSearch,
    status,
    setStatus,
    market,
    setMarket,
    sort: { by: sortBy, order: sortOrder, onChange: setSort },
    page,
    setPage,
    handleDelete,
    handleClone,
  };
}
