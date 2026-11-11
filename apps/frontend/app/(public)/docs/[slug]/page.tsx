import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Info, KeyRound } from 'lucide-react';
import { ScreenshotFrame } from '@/features/public-site/components/screenshot-frame';
import {
  DOC_ORDER,
  DOC_SECTIONS,
  getAdjacentDocs,
  getDoc,
  getDocGroup,
} from '@/features/public-site/docs';
import { DocsBreadcrumb } from '@/features/public-site/docs/components/docs-breadcrumb';
import { getDocScreenshot } from '@/features/public-site/docs/screenshots';
import { PUBLIC_ROUTES, SITE, SITE_OPEN_GRAPH } from '@/features/public-site/site-config';

type Params = Promise<{ slug: string }>;

/** Mọi bài được dựng tĩnh lúc build; slug lạ → 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ORDER.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const article = getDoc(slug);
  if (!article) return {};
  const url = `${PUBLIC_ROUTES.docs}/${slug}`;
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: url },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      type: 'article',
      title: `${article.title} · ${SITE.name}`,
      description: article.summary,
      url,
    },
  };
}

const SECTION_TITLE = Object.fromEntries(
  DOC_SECTIONS.map((section) => [section.id, section.title]),
) as Record<(typeof DOC_SECTIONS)[number]['id'], string>;

export default async function DocArticlePage({ params }: { params: Params }) {
  const { slug } = await params;
  const article = getDoc(slug);
  if (!article) notFound();

  const group = getDocGroup(slug);
  const { prev, next } = getAdjacentDocs(slug);
  const screenshot = getDocScreenshot(article.screenshotRoute);
  const sections = DOC_SECTIONS.filter((section) => {
    if (section.id === 'khi-nao-dung') return article.whenToUse.length > 0;
    if (section.id === 'dieu-kien') return article.prerequisites.length > 0;
    if (section.id === 'luu-y') return article.notes.length > 0;
    if (section.id === 'xu-ly-loi') return article.troubleshooting.length > 0;
    return true;
  });

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <article className="min-w-0 space-y-10">
        <header className="space-y-3">
          <DocsBreadcrumb
            items={[
              { label: 'Tài liệu', href: PUBLIC_ROUTES.docs },
              ...(group
                ? [{ label: group.title, href: `${PUBLIC_ROUTES.docs}#nhom-${group.id}` }]
                : []),
              { label: article.title },
            ]}
          />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{article.title}</h1>
          <p className="text-lg text-muted-foreground">{article.summary}</p>
          {article.permission && (
            <p className="inline-flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden />
              Quyền cần có: <code className="font-mono text-foreground">{article.permission}</code>
            </p>
          )}
        </header>

        <section id="tong-quan" aria-labelledby="tong-quan-h" className="scroll-mt-24 space-y-4">
          <h2 id="tong-quan-h" className="text-2xl font-semibold tracking-tight">
            {SECTION_TITLE['tong-quan']}
          </h2>
          <p className="leading-relaxed">{article.overview}</p>
          {screenshot && (
            <ScreenshotFrame
              src={screenshot}
              alt={`Màn hình ${article.title} (dữ liệu mẫu)`}
              sizes="(min-width: 1280px) 768px, (min-width: 1024px) 70vw, 100vw"
            />
          )}
        </section>

        {article.whenToUse.length > 0 && (
          <DocSection id="khi-nao-dung">
            <BulletList items={article.whenToUse} />
          </DocSection>
        )}

        {article.prerequisites.length > 0 && (
          <DocSection id="dieu-kien">
            <BulletList items={article.prerequisites} />
          </DocSection>
        )}

        <DocSection id="cac-buoc">
          <ol className="space-y-4">
            {article.steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="space-y-1 pt-1">
                  <h3 className="font-semibold">
                    <span className="sr-only">Bước {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="leading-relaxed text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </DocSection>

        {article.notes.length > 0 && (
          <DocSection id="luu-y">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
              <ul className="space-y-2.5">
                {article.notes.map((note) => (
                  <li key={note} className="flex gap-2.5 text-sm leading-relaxed">
                    <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </DocSection>
        )}

        {article.troubleshooting.length > 0 && (
          <DocSection id="xu-ly-loi">
            <dl className="divide-y rounded-xl border">
              {article.troubleshooting.map((item) => (
                <div key={item.problem} className="space-y-1.5 p-4">
                  <dt className="flex gap-2.5 font-medium">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <span>{item.problem}</span>
                  </dt>
                  <dd className="pl-[1.625rem] text-sm leading-relaxed text-muted-foreground">
                    {item.solution}
                  </dd>
                </div>
              ))}
            </dl>
          </DocSection>
        )}

        <nav aria-label="Bài trước / bài tiếp" className="grid gap-3 border-t pt-6 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`${PUBLIC_ROUTES.docs}/${prev.slug}`}
              className="group rounded-xl border p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowLeft className="size-3.5" aria-hidden />
                Bài trước
              </span>
              <span className="mt-1 block font-medium group-hover:text-primary">{prev.title}</span>
            </Link>
          ) : (
            <span aria-hidden />
          )}
          {next && (
            <Link
              href={`${PUBLIC_ROUTES.docs}/${next.slug}`}
              className="group rounded-xl border p-4 text-right transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                Bài tiếp
                <ArrowRight className="size-3.5" aria-hidden />
              </span>
              <span className="mt-1 block font-medium group-hover:text-primary">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>

      <aside className="hidden xl:block">
        <nav aria-label="Mục lục bài viết" className="sticky top-20 space-y-2 text-sm">
          <p className="font-semibold">Trong bài này</p>
          <ul className="space-y-1.5 border-l">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-px block border-l border-transparent pl-3 text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}

function DocSection({
  id,
  children,
}: {
  id: (typeof DOC_SECTIONS)[number]['id'];
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 space-y-4">
      <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight">
        {SECTION_TITLE[id]}
      </h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
