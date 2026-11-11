import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, ChevronDown, Mail, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BILLING_PERIOD_LABEL,
  formatUsd,
  INCLUDED_IN_EVERY_PLAN,
  PRICING_FAQ,
  PRICING_PLANS,
} from '@/features/public-site/pricing';
import {
  APP_ROUTES,
  PUBLIC_ROUTES,
  SITE,
  SITE_OPEN_GRAPH,
} from '@/features/public-site/site-config';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Bảng giá',
  description: `Bảng giá ${SITE.name}: ${PRICING_PLANS.length} gói theo số TikTok Shop, từ ${formatUsd(PRICING_PLANS[0].priceUsd)}/${BILLING_PERIOD_LABEL}. Mọi tính năng có trong tất cả các gói.`,
  alternates: { canonical: PUBLIC_ROUTES.pricing },
  openGraph: { ...SITE_OPEN_GRAPH, title: `Bảng giá · ${SITE.name}`, url: PUBLIC_ROUTES.pricing },
};

/** Bảng giá — `/pricing`. Chỉ trình bày; không có thanh toán online (xem `features/public-site/pricing.ts`). */
export default function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-4 pb-12 pt-14 text-center sm:px-6 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Bảng giá</p>
        <h1 className="mx-auto mt-2 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Chọn gói theo số shop bạn vận hành
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">
          Mọi gói đều có đầy đủ tính năng. Khác biệt duy nhất là số TikTok Shop được kết nối cùng
          lúc.
        </p>
      </section>

      <section aria-label="Các gói" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PRICING_PLANS.map((plan) => (
            <li
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm',
                plan.highlight && 'border-brand shadow-lg ring-1 ring-brand',
              )}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-brand-foreground">
                  Phổ biến
                </span>
              )}
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.audience}</p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">
                  {formatUsd(plan.priceUsd)}
                </span>
                <span className="text-sm text-muted-foreground">/ {BILLING_PERIOD_LABEL}</span>
              </p>
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium">
                <Store className="size-4 text-primary" aria-hidden />
                Tối đa {plan.shops.toLocaleString('vi-VN')} TikTok Shop
              </p>
              <Button
                size="lg"
                asChild
                variant={plan.highlight ? 'default' : 'outline'}
                className={cn(
                  'mt-6 w-full',
                  plan.highlight && 'bg-brand text-brand-foreground hover:bg-brand/90',
                )}
              >
                <Link href={APP_ROUTES.register} aria-label={`Đăng ký — gói ${plan.name}`}>
                  Đăng ký
                </Link>
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Giá tính bằng USD. Hiện chưa có thanh toán trực tuyến — sau khi đăng ký, vui lòng liên hệ
          qua email để chọn hoặc đổi gói.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border bg-content p-8">
          <h2 className="text-center text-2xl font-bold tracking-tight">Có trong mọi gói</h2>
          <ul className="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-2">
            {INCLUDED_IN_EVERY_PLAN.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="faq-h" className="mx-auto max-w-3xl px-4 pb-20 sm:px-6 lg:px-8">
        <h2 id="faq-h" className="text-center text-2xl font-bold tracking-tight">
          Câu hỏi thường gặp
        </h2>
        <div className="mt-8 divide-y rounded-xl border bg-card">
          {PRICING_FAQ.map((item) => (
            <details
              key={item.question}
              className="group p-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {item.question}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground">Cần tư vấn chọn gói?</p>
          <Button variant="outline" asChild>
            <a href={`mailto:${SITE.contact.email}`}>
              <Mail className="size-4" aria-hidden />
              {SITE.contact.email}
            </a>
          </Button>
        </div>
      </section>
    </>
  );
}
