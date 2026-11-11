'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PUBLIC_ROUTES } from '../../site-config';
import { normalizeSearchText, type DocSearchEntry } from '../search-text';

const MAX_RESULTS = 8;

/** Tìm kiếm tài liệu ngay trên trình duyệt — gõ có dấu hay không dấu đều khớp. */
export function DocsSearch({ index }: { index: DocSearchEntry[] }) {
  const [query, setQuery] = useState('');
  const listId = useId();

  const results = useMemo(() => {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return index
      .filter((entry) => terms.every((term) => entry.haystack.includes(term)))
      .slice(0, MAX_RESULTS);
  }, [index, query]);

  const searching = query.trim().length > 0;

  return (
    <div role="search" className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Tìm trong tài liệu
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={`${listId}-input`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
        }}
        placeholder="Tìm trong tài liệu..."
        autoComplete="off"
        aria-controls={searching ? listId : undefined}
        className="pl-9"
      />
      {searching && (
        <div
          id={listId}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          <p className="sr-only" aria-live="polite">
            {results.length} kết quả
          </p>
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Không tìm thấy bài viết phù hợp.
            </p>
          ) : (
            <ul>
              {results.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`${PUBLIC_ROUTES.docs}/${entry.slug}`}
                    onClick={() => setQuery('')}
                    className="block rounded-md px-3 py-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="block text-sm font-medium">{entry.title}</span>
                    <span className="block text-xs text-muted-foreground">{entry.group}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
