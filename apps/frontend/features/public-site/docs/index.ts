import gettingStarted from './content/getting-started.json';
import listingFlashSale from './content/listing-flash-sale.json';
import ordersFulfillment from './content/orders-fulfillment.json';
import shopsProducts from './content/shops-products.json';
import { DOC_GROUPS, type DocArticle, type DocGroup } from './groups';
import { normalizeSearchText, type DocSearchEntry } from './search-text';

/**
 * Trung tâm tài liệu (/docs) — nội dung tĩnh, viết theo đúng giao diện & thông báo thật trong source
 * (menu, nhãn nút, quyền, thông báo lỗi). Mỗi bài là một phần tử JSON trong `content/`; nhóm & thứ tự ở `groups.ts`.
 */
export * from './groups';

const ALL_ARTICLES: DocArticle[] = [
  ...(gettingStarted as DocArticle[]),
  ...(shopsProducts as DocArticle[]),
  ...(listingFlashSale as DocArticle[]),
  ...(ordersFulfillment as DocArticle[]),
];

const BY_SLUG = new Map(ALL_ARTICLES.map((article) => [article.slug, article]));

/** Bài viết theo đúng thứ tự đọc (nhóm → bài). Ném lỗi lúc build nếu nhóm trỏ tới slug không tồn tại. */
export const DOC_ORDER: DocArticle[] = DOC_GROUPS.flatMap((group) =>
  group.slugs.map((slug) => {
    const article = BY_SLUG.get(slug);
    if (!article) throw new Error(`Docs: nhóm "${group.id}" trỏ tới bài không tồn tại: ${slug}`);
    return article;
  }),
);

export function getDoc(slug: string): DocArticle | undefined {
  return BY_SLUG.get(slug);
}

export function getDocGroup(slug: string): DocGroup | undefined {
  return DOC_GROUPS.find((group) => group.slugs.includes(slug));
}

export function getAdjacentDocs(slug: string): { prev?: DocArticle; next?: DocArticle } {
  const index = DOC_ORDER.findIndex((article) => article.slug === slug);
  if (index < 0) return {};
  return { prev: DOC_ORDER[index - 1], next: DOC_ORDER[index + 1] };
}

/** Dữ liệu gọn cho ô tìm kiếm phía client (không gửi toàn bộ bài xuống trình duyệt). */
export function buildDocSearchIndex(): DocSearchEntry[] {
  return DOC_ORDER.map((article) => {
    const group = getDocGroup(article.slug)?.title ?? '';
    return {
      slug: article.slug,
      title: article.title,
      group,
      summary: article.summary,
      haystack: normalizeSearchText(
        [article.title, group, article.summary, ...article.steps.map((step) => step.title)].join(
          ' ',
        ),
      ),
    };
  });
}
