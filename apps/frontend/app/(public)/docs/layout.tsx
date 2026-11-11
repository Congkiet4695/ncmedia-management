import type { ReactNode } from 'react';
import {
  DocsSidebar,
  type SidebarGroup,
} from '@/features/public-site/docs/components/docs-sidebar';
import { buildDocSearchIndex, DOC_GROUPS, getDoc } from '@/features/public-site/docs';

/** Khung trung tâm tài liệu: menu trái (kèm tìm kiếm) + nội dung bài. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  const groups: SidebarGroup[] = DOC_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    items: group.slugs.map((slug) => ({ slug, title: getDoc(slug)?.title ?? slug })),
  }));

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-10">
      <DocsSidebar groups={groups} searchIndex={buildDocSearchIndex()} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
