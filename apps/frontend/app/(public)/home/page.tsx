import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Check, Mail, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScreenshotFrame } from '@/features/public-site/components/screenshot-frame';
import {
  AUDIENCES,
  FEATURES,
  HERO,
  PRODUCT_PREVIEWS,
  STEPS,
} from '@/features/public-site/landing-content';
import { formatUsd, PRICING_PLANS } from '@/features/public-site/pricing';
import {
  APP_ROUTES,
  PUBLIC_ROUTES,
  SITE,
  SITE_OPEN_GRAPH,
} from '@/features/public-site/site-config';

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} - Nền tảng quản lý TikTok Shop & Fulfillment` },
  description: SITE.description,
  alternates: { canonical: PUBLIC_ROUTES.home },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    title: `${SITE.name} - Nền tảng quản lý TikTok Shop & Fulfillment`,
    description: SITE.description,
    url: PUBLIC_ROUTES.home,
  },
};

const cheapest = PRICING_PLANS.reduce((min, plan) => (plan.priceUsd < min.priceUsd ? plan : min));

/** Landing Page — `/home`. Nội dung ở `features/public-site/landing-content.ts`. */
export default function HomePage() {
  return (
    <>
      {/* --- Hero --- */}
      <section className="relative overflow-hidden bg-sidebar text-sidebar-foreground">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--brand)/0.18),transparent_55%)]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:px-8 lg:py-24">
          <div className="space-y-6">
            <p className="inline-flex items-center rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-sidebar-active">
              {HERO.eyebrow}
            </p>
            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              {HERO.title}
            </h1>
            <p className="max-w-xl text-pretty text-base leading-relaxed text-sidebar-muted sm:text-lg">
              {HERO.subtitle}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                <Link href={APP_ROUTES.register}>
                  Đăng ký ngay
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="border-sidebar-border bg-transparent text-white hover:bg-sidebar-accent hover:text-white"
              >
                <Link href={PUBLIC_ROUTES.pricing}>Xem bảng giá</Link>
              </Button>
            </div>
            <Link
              href={PUBLIC_ROUTES.docs}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-sidebar-active hover:underline"
            >
              <BookOpen className="size-4" aria-hidden />
              Xem tài liệu hướng dẫn
            </Link>
          </div>
          <ScreenshotFrame
            src={PRODUCT_PREVIEWS[0].image}
            alt={`Màn hình ${PRODUCT_PREVIEWS[0].title} của ${SITE.name} (dữ liệu mẫu)`}
            priority
            className="border-sidebar-border lg:translate-x-4"
          />
        </div>
      </section>

      {/* --- Tính năng --- */}
      <section id="tinh-nang" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Tính năng"
          title="Mọi công việc vận hành shop, trên một nền tảng"
          description="Từ kết nối shop, đăng sản phẩm, Flash Sale đến đơn hàng và fulfillment — các công cụ đã có sẵn trong hệ thống."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="group flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {feature.points.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* --- Cách bắt đầu --- */}
      <section className="border-y bg-content">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="Bắt đầu" title="Năm bước để vận hành tập trung" />
          <ol className="mt-12 grid gap-5 md:grid-cols-5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-xl border bg-card p-5 shadow-sm">
                <span className="mb-3 flex size-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                  {index + 1}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- Phù hợp với ai --- */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Dành cho" title="Phù hợp với cách bạn bán hàng" />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map((audience) => (
            <article key={audience.title} className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold">{audience.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {audience.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* --- Hình ảnh sản phẩm --- */}
      <section className="border-y bg-content">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Giao diện"
            title="Công cụ mạnh, một giao diện thống nhất"
            description="Ảnh chụp từ hệ thống với dữ liệu mẫu."
          />
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {PRODUCT_PREVIEWS.map((preview) => (
              <div key={preview.title} className="space-y-3">
                <ScreenshotFrame
                  src={preview.image}
                  alt={`Màn hình ${preview.title} (dữ liệu mẫu)`}
                />
                <div>
                  <h3 className="font-semibold">{preview.title}</h3>
                  <p className="text-sm text-muted-foreground">{preview.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Giá --- */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border bg-card p-8 shadow-sm md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Từ {formatUsd(cheapest.priceUsd)}/tháng cho {cheapest.shops} shop
            </h2>
            <p className="mt-1.5 text-muted-foreground">
              {PRICING_PLANS.length} gói theo số shop, từ {cheapest.shops} đến{' '}
              {PRICING_PLANS[PRICING_PLANS.length - 1].shops} shop. Mọi tính năng có trong tất cả
              các gói.
            </p>
          </div>
          <Button size="lg" variant="outline" asChild>
            <Link href={PUBLIC_ROUTES.pricing}>
              Xem bảng giá
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      {/* --- CTA + liên hệ --- */}
      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:px-8">
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Sẵn sàng gom việc vận hành shop về một nơi?
            </h2>
            <p className="max-w-xl text-sidebar-muted">
              Đăng ký tổ chức của bạn — hồ sơ được xét duyệt, sau đó bạn kết nối shop và bắt đầu làm
              việc cùng đội ngũ.
            </p>
            <Button size="lg" asChild className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Link href={APP_ROUTES.register}>
                Đăng ký ngay
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
          <address className="space-y-3 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-6 not-italic">
            <h3 className="font-semibold text-white">Liên hệ</h3>
            <p className="flex items-start gap-2 text-sm">
              <Mail className="mt-0.5 size-4 shrink-0 text-sidebar-active" aria-hidden />
              <a href={`mailto:${SITE.contact.email}`} className="break-all hover:text-white">
                {SITE.contact.email}
              </a>
            </p>
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-sidebar-active" aria-hidden />
              {SITE.contact.location}
            </p>
          </address>
        </div>
      </section>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {description && <p className="mt-3 text-pretty text-muted-foreground">{description}</p>}
    </div>
  );
}
