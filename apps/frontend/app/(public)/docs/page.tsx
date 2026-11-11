import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DOC_GROUPS, getDoc } from '@/features/public-site/docs';
import { DocsBreadcrumb } from '@/features/public-site/docs/components/docs-breadcrumb';
import { PUBLIC_ROUTES, SITE, SITE_OPEN_GRAPH } from '@/features/public-site/site-config';

export const metadata: Metadata = {
  title: 'Tài liệu hướng dẫn',
  description: `Hướng dẫn sử dụng ${SITE.name} từng bước: đăng ký, kết nối TikTok Shop, sản phẩm, listing, Flash Sale, đơn hàng và fulfillment.`,
  alternates: { canonical: PUBLIC_ROUTES.docs },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    title: `Tài liệu hướng dẫn · ${SITE.name}`,
    url: PUBLIC_ROUTES.docs,
  },
};

/** Trang chủ tài liệu — `/docs`: danh sách bài theo nhóm. */
export default function DocsIndexPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <DocsBreadcrumb items={[{ label: 'Tài liệu' }]} />
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Tài liệu hướng dẫn</h1>
        <p className="max-w-2xl text-muted-foreground">
          Hướng dẫn từng bước cho mọi màn hình của {SITE.name} — từ đăng ký tổ chức, kết nối TikTok
          Shop đến đăng sản phẩm, xử lý đơn và fulfillment. Mới bắt đầu? Hãy đọc{' '}
          <Link
            href={`${PUBLIC_ROUTES.docs}/gioi-thieu`}
            className="font-medium text-primary hover:underline"
          >
            Giới thiệu
          </Link>{' '}
          trước.
        </p>
      </header>

      {DOC_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`nhom-${group.id}`} className="space-y-4">
          <h2 id={`nhom-${group.id}`} className="text-xl font-semibold tracking-tight">
            {group.title}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {group.slugs.map((slug) => {
              const article = getDoc(slug);
              if (!article) return null;
              return (
                <li key={slug}>
                  <Link
                    href={`${PUBLIC_ROUTES.docs}/${slug}`}
                    className="group flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {article.title}
                      <ArrowRight
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
                        aria-hidden
                      />
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">{article.summary}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
