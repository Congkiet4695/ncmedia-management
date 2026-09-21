import { Injectable, Logger } from '@nestjs/common';
import {
  TIKTOK_BRAND_CRAWL_CONCURRENCY,
  TIKTOK_BRAND_CRAWL_MAX_CONSECUTIVE_FAILURES,
  TIKTOK_BRAND_CRAWL_MAX_PREFIX_LENGTH,
  TIKTOK_BRAND_CRAWL_MAX_WALKS,
  TIKTOK_BRAND_CRAWL_PROGRESS_EVERY_CALLS,
  TIKTOK_BRAND_PREFIX_BASE_ALPHABET,
  TIKTOK_BRAND_PREFIX_LATIN_SEEDS,
  TIKTOK_BRAND_PREFIX_MARK_SEEDS,
  TIKTOK_BRAND_PREFIX_SCRIPT_SEEDS,
  TIKTOK_BRAND_WINDOW_LIMIT,
  foldBrandPrefixChar,
} from './tiktok-brand-crawl.constants';
import { TiktokProductApiService } from './tiktok-product-api.service';
import type { TiktokBrand } from './types/tiktok-product.types';
import type { TiktokPage, TiktokShopContext } from './types/tiktok-shop-context.type';

/** Ảnh chụp tiến độ — phát định kỳ để log và cho giao diện thấy lượt chạy còn sống. */
export interface TiktokBrandCrawlProgress {
  apiCalls: number;
  fetched: number;
  emitted: number;
  prefixesDone: number;
  prefixesQueued: number;
  /** Prefix đang được các luồng xử lý (để người vận hành biết đang ở đâu trong bảng chữ cái). */
  activePrefixes: string[];
  elapsedMs: number;
}

/** Kết quả một lượt quét — mọi con số cần cho báo cáo đối chiếu. */
export interface TiktokBrandCrawlReport {
  /** Số lời gọi Get Brands (mỗi trang một lời gọi). */
  apiCalls: number;
  /** Số bản ghi THÔ nhận về (gồm lặp giữa các lượt đi lại và giữa prefix cha/con). */
  fetched: number;
  /** Số bản ghi đã giao cho `onBatch` (duy nhất trong từng prefix). */
  emitted: number;
  /** Bản ghi TikTok trả về không có `id` — bỏ qua. */
  skippedWithoutId: number;
  prefixesDone: number;
  /** Prefix chạm trần 10.000 phải chia theo ký tự kế tiếp. */
  cappedPrefixes: number;
  /** Prefix đi đủ số lượt vẫn thiếu, phải chia tiếp. */
  refinedPrefixes: number;
  /** Prefix KHÔNG thể lấy đủ (không còn ký tự để chia) — kèm số liệu để cảnh báo. */
  incomplete: Array<{ prefix: string; total: number; unique: number }>;
  /** Prefix hỏng sau khi SDK đã retry VÀ sau lượt thử lại cuối — dữ liệu prefix khác vẫn được ghi. */
  failed: Array<{ prefix: string; error: string }>;
  /** Prefix hỏng lần đầu nhưng thành công khi thử lại cuối lượt. */
  recovered: number;
  durationMs: number;
}

export interface TiktokBrandCrawlHandlers {
  /** Nhận thương hiệu DUY NHẤT của một prefix — gọi ngay khi prefix đó xong, không đợi cả lượt. */
  onBatch: (brands: TiktokBrand[]) => Promise<void>;
  onProgress?: (progress: TiktokBrandCrawlProgress) => void | Promise<void>;
}

/** Trạng thái dùng chung giữa các luồng của MỘT lượt quét. */
interface CrawlState {
  queue: string[];
  visited: Set<string>;
  active: Set<string>;
  rootCapped: boolean;
  /** Prefix đã chạm trần (còn chia được) — nhận thêm mồi khi phát hiện ký tự mới (xem `scheduleClosure`). */
  cappedPrefixes: string[];
  /** Ký tự ngoài ASCII gặp ở BẤT KỲ vị trí nào trong tên — mồi để tìm tên bắt đầu bằng chúng. */
  discoveredChars: Set<string>;
  consecutiveFailures: number;
  fatal: Error | null;
  /** Prefix đã được xếp hàng thử lại — mỗi prefix chỉ được thử lại MỘT lần. */
  retried: Set<string>;
  startedAt: number;
  report: Omit<TiktokBrandCrawlReport, 'durationMs'>;
}

/** Ném ra để dừng sớm mọi luồng khi lượt đã bị đánh dấu huỷ. */
class CrawlAbortedError extends Error {}

/**
 * TiktokBrandCrawlerService — lấy **TOÀN BỘ** thương hiệu từ Get Brands.
 *
 * 🔴 API này KHÔNG cho phép "đi hết page_token là xong" — xem `tiktok-brand-crawl.constants.ts`
 * về ba giới hạn đo được (cửa sổ 10.000 / lọc prefix / thứ tự trang không ổn định). Thuật toán:
 *
 * ```
 * queue = [""]                                   // prefix rỗng = không lọc
 * for prefix in queue (song song K luồng):
 *   đi hết trang của prefix  →  gộp theo id
 *   if total_count ≥ 10.000:                     // chạm trần: cửa sổ này KHÔNG bao giờ đủ
 *       enqueue prefix + c  với c ∈ bảng chữ cái ∪ ký tự kế tiếp đã thấy
 *   else while unique < total_count && walks < MAX:
 *       đi lại từ đầu, gộp tiếp                  // thứ tự trang đổi ⇒ mỗi lượt vớt thêm
 *   if vẫn thiếu: enqueue prefix + c  với c ∈ ký tự kế tiếp đã thấy
 *   giao unique cho onBatch                      // ghi DB theo prefix, không đợi cả lượt
 * hết hàng đợi:
 *   gieo cho MỌI prefix chạm trần các dấu / ký hiệu ngoài ASCII đã gặp trong cả lượt (khép kín)
 *   xếp lại MỘT lần các prefix đã hỏng (lỗi tạm thời của TikTok)
 * ```
 *
 * 🔴 Vì sao cần bước khép kín: prefix chạm trần được chia NGAY khi gặp — lúc đó bộ ký tự đã
 * phát hiện còn rất nhỏ (mới có cửa sổ gốc). Dấu nháy `’`, `´`, `°`, dấu tổ hợp… chỉ lộ ra
 * hàng giờ sau, ở những prefix khác. Không quay lại gieo thì "D´France", "N°5" tuỳ vận may của
 * cửa sổ 10.000 (ngẫu nhiên theo bản sao) — lượt 1 có, lượt 2 mất.
 *
 * Bảo đảm:
 *  - Mọi prefix chỉ được xếp hàng MỘT lần (`visited`), prefix con luôn dài hơn cha ⇒ hữu hạn.
 *  - Một prefix hỏng không kéo theo prefix khác; hỏng liên tiếp quá ngưỡng thì huỷ cả lượt
 *    (token hết hạn / TikTok sập) thay vì đốt hàng nghìn call.
 *  - Con số `incomplete` là câu trả lời thật thà cho "có lấy đủ không": tên mà không có ký
 *    tự kế tiếp nào để chia (trùng hệt prefix) hoặc prefix quá dài mà vẫn ≥ 10.000.
 */
@Injectable()
export class TiktokBrandCrawlerService {
  private readonly logger = new Logger(TiktokBrandCrawlerService.name);

  constructor(private readonly productApi: TiktokProductApiService) {}

  async crawl(
    ctx: TiktokShopContext,
    handlers: TiktokBrandCrawlHandlers,
  ): Promise<TiktokBrandCrawlReport> {
    const state: CrawlState = {
      queue: [''],
      visited: new Set(['']),
      active: new Set(),
      rootCapped: false,
      cappedPrefixes: [],
      discoveredChars: new Set(),
      consecutiveFailures: 0,
      fatal: null,
      retried: new Set(),
      startedAt: Date.now(),
      report: {
        apiCalls: 0,
        fetched: 0,
        emitted: 0,
        skippedWithoutId: 0,
        prefixesDone: 0,
        cappedPrefixes: 0,
        refinedPrefixes: 0,
        incomplete: [],
        failed: [],
        recovered: 0,
      },
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        if (state.fatal) return;
        const prefix = state.queue.shift();
        if (prefix === undefined) {
          if (
            state.active.size === 0 &&
            !this.scheduleClosure(state) &&
            !this.scheduleRetries(state)
          ) {
            return;
          }
          await this.delay(25);
          continue;
        }

        state.active.add(prefix);
        try {
          await this.processPrefix(ctx, prefix, state, handlers);
          state.consecutiveFailures = 0;
          if (state.retried.has(prefix)) this.markRecovered(prefix, state);
        } catch (error) {
          if (error instanceof CrawlAbortedError) return;
          this.recordFailure(prefix, error, state);
        } finally {
          state.active.delete(prefix);
        }
      }
    };

    await Promise.all(Array.from({ length: TIKTOK_BRAND_CRAWL_CONCURRENCY }, worker));

    const report: TiktokBrandCrawlReport = {
      ...state.report,
      durationMs: Date.now() - state.startedAt,
    };

    if (state.fatal) {
      throw new Error(
        `Huỷ quét thương hiệu sau ${TIKTOK_BRAND_CRAWL_MAX_CONSECUTIVE_FAILURES} prefix hỏng liên tiếp ` +
          `(đã ghi ${report.emitted} bản ghi từ ${report.prefixesDone} prefix): ${state.fatal.message}`,
      );
    }

    return report;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async processPrefix(
    ctx: TiktokShopContext,
    prefix: string,
    state: CrawlState,
    handlers: TiktokBrandCrawlHandlers,
  ): Promise<void> {
    const unique = new Map<string, TiktokBrand>();
    let total = 0;
    let capped = false;
    let walks = 0;
    // Bản ghi không có id nằm trong `total_count` nhưng không bao giờ vào `unique` — phải cộng
    // vào điều kiện "đã đủ", nếu không prefix đó đi lại vô ích rồi chia nhỏ vô ích.
    let withoutId = 0;

    try {
      const first = await this.fetchPage(ctx, prefix, undefined, state, handlers);
      total = first.totalCount ?? first.items.length;
      capped = total >= TIKTOK_BRAND_WINDOW_LIMIT;
      if (prefix === '') state.rootCapped = capped;
      let walkWithoutId = this.collect(first.items, unique, state);
      let token = first.nextPageToken;

      for (;;) {
        while (token) {
          const page = await this.fetchPage(ctx, prefix, token, state, handlers);
          walkWithoutId += this.collect(page.items, unique, state);
          token = page.nextPageToken;
        }
        walks += 1;
        withoutId = Math.max(withoutId, walkWithoutId);
        // Chạm trần ⇒ cửa sổ này không bao giờ đủ, đi lại chỉ phí call: chia nhỏ luôn.
        if (capped || unique.size + withoutId >= total || walks >= TIKTOK_BRAND_CRAWL_MAX_WALKS) {
          break;
        }

        const again = await this.fetchPage(ctx, prefix, undefined, state, handlers);
        walkWithoutId = this.collect(again.items, unique, state);
        token = again.nextPageToken;
      }
    } finally {
      // Ghi những gì đã lấy được KỂ CẢ khi prefix hỏng giữa chừng — không bỏ dữ liệu đã trả tiền.
      if (unique.size > 0) {
        await handlers.onBatch([...unique.values()]);
        state.report.emitted += unique.size;
      }
    }

    state.report.prefixesDone += 1;
    state.report.skippedWithoutId += withoutId;

    if (capped) {
      if (Array.from(prefix).length >= TIKTOK_BRAND_CRAWL_MAX_PREFIX_LENGTH) {
        state.report.incomplete.push({ prefix, total, unique: unique.size });
      } else {
        state.report.cappedPrefixes += 1;
        state.cappedPrefixes.push(prefix);
        // Cửa sổ chạm trần sắp theo ASCII nên chữ có dấu / dấu tổ hợp ở vị trí kế tiếp KHÔNG
        // bao giờ lộ ra trong `nextChars` — phải gieo mồi ở MỌI tầng, hệ chữ khác chỉ ở gốc.
        const chars = new Set<string>([
          ...TIKTOK_BRAND_PREFIX_BASE_ALPHABET,
          ...TIKTOK_BRAND_PREFIX_LATIN_SEEDS,
          ...TIKTOK_BRAND_PREFIX_MARK_SEEDS,
          ...(prefix === '' ? TIKTOK_BRAND_PREFIX_SCRIPT_SEEDS : []),
          ...this.nextChars(prefix, unique),
        ]);
        this.enqueueChildren(prefix, chars, state);
      }
    } else if (unique.size + withoutId < total) {
      const chars = this.nextChars(prefix, unique);
      if (chars.size === 0) {
        state.report.incomplete.push({ prefix, total, unique: unique.size });
      } else {
        state.report.refinedPrefixes += 1;
        this.enqueueChildren(prefix, chars, state);
      }
    }

    this.enqueueDiscoveredRootChars(state);

    this.logger.debug({
      module: 'tiktok-sdk',
      operation: 'brand.crawl.prefix',
      prefix,
      total,
      unique: unique.size,
      walks,
      capped,
      queued: state.queue.length,
    });
  }

  private async fetchPage(
    ctx: TiktokShopContext,
    prefix: string,
    pageToken: string | undefined,
    state: CrawlState,
    handlers: TiktokBrandCrawlHandlers,
  ): Promise<TiktokPage<TiktokBrand>> {
    if (state.fatal) throw new CrawlAbortedError();

    const { data } = await this.productApi.getBrands(ctx, {
      brandName: prefix === '' ? undefined : prefix,
      pageToken,
    });

    state.report.apiCalls += 1;
    state.report.fetched += data.items.length;

    if (state.report.apiCalls % TIKTOK_BRAND_CRAWL_PROGRESS_EVERY_CALLS === 0) {
      await this.reportProgress(state, handlers);
    }

    return data;
  }

  /**
   * Gộp một trang vào bảng duy nhất theo id; đồng thời nhặt ký tự ngoài ASCII làm mồi cho gốc.
   * Trả về số bản ghi không có id trong trang.
   */
  private collect(items: TiktokBrand[], unique: Map<string, TiktokBrand>, state: CrawlState): number {
    let withoutId = 0;
    for (const brand of items) {
      if (!brand.id) {
        withoutId += 1;
        continue;
      }
      unique.set(brand.id, brand);

      if (!brand.name) continue;
      for (const char of brand.name) {
        if (char.charCodeAt(0) <= 0x7e) continue;
        if (!this.isPrefixChar(char)) continue;
        state.discoveredChars.add(foldBrandPrefixChar(char));
      }
    }
    return withoutId;
  }

  /** Ký tự đứng ngay sau `prefix` trong các tên đã thấy — cách chia nhỏ duy nhất bám sát dữ liệu thật. */
  private nextChars(prefix: string, unique: Map<string, TiktokBrand>): Set<string> {
    const depth = Array.from(prefix).length;
    const chars = new Set<string>();

    for (const brand of unique.values()) {
      if (!brand.name) continue;
      const folded = Array.from(brand.name).map(foldBrandPrefixChar);
      if (folded.length <= depth) continue;
      // TikTok có thể chuẩn hoá tên khác JS (trim, dạng Unicode); tên không khớp prefix thì
      // không suy ra được ký tự kế tiếp — bỏ qua thay vì đoán.
      if (folded.slice(0, depth).join('') !== prefix) continue;
      const next = folded[depth];
      if (this.isPrefixChar(next)) chars.add(next);
    }

    return chars;
  }

  private enqueueChildren(prefix: string, chars: Iterable<string>, state: CrawlState): void {
    for (const char of chars) {
      const child = prefix + char;
      if (state.visited.has(child)) continue;
      state.visited.add(child);
      state.queue.push(child);
    }
  }

  /**
   * Tên bắt đầu bằng Hán tự / Hangul / ký tự lạ chỉ tìm được nếu có mồi. Mỗi ký tự ngoài ASCII
   * từng xuất hiện trong BẤT KỲ tên nào đều trở thành một prefix gốc — chỉ khi gốc đã chạm trần
   * (chưa chạm trần nghĩa là cửa sổ không lọc đã chứa tất cả).
   */
  private enqueueDiscoveredRootChars(state: CrawlState): void {
    if (!state.rootCapped) return;
    this.enqueueChildren('', state.discoveredChars, state);
  }

  /** Ký tự dùng được làm prefix: bỏ ký tự điều khiển/định dạng/không gán. */
  private isPrefixChar(char: string | undefined): char is string {
    return typeof char === 'string' && char.length > 0 && !/\p{C}/u.test(char);
  }

  /**
   * Hết hàng đợi ⇒ gieo cho mọi prefix chạm trần các ký tự ngoài ASCII KHÔNG phải chữ (dấu
   * nháy, ký hiệu, chữ số lạ, dấu tổ hợp) đã gặp trong cả lượt. Trả `true` nếu có việc mới —
   * việc mới có thể phát hiện thêm ký tự, nên bước này lặp tới khi khép kín.
   *
   * Chỉ ký tự KHÔNG phải chữ: chữ của hệ khác (Hán tự, Hangul…) có hàng nghìn, gieo hết cho
   * ~100 prefix chạm trần là hàng trăm nghìn call; còn "chữ Latin rồi tới Hán tự" thì hiếm.
   */
  private scheduleClosure(state: CrawlState): boolean {
    const symbols = [...state.discoveredChars].filter((char) => !/\p{L}/u.test(char));
    const before = state.queue.length;
    for (const prefix of state.cappedPrefixes) this.enqueueChildren(prefix, symbols, state);

    const added = state.queue.length - before;
    if (added === 0) return false;
    this.logger.log({
      module: 'tiktok-sdk',
      operation: 'brand.crawl.closure',
      cappedPrefixes: state.cappedPrefixes.length,
      symbols: symbols.length,
      added,
      msg: 'Gieo ký hiệu / dấu ngoài ASCII đã gặp cho các prefix chạm trần',
    });
    return true;
  }

  /**
   * Hết hàng đợi ⇒ xếp lại các prefix đã hỏng, mỗi prefix đúng MỘT lần. Trả `true` nếu có
   * việc mới. Lỗi của TikTok phần nhiều là tạm thời (`50001 missing or invalid request id`
   * gặp ở lượt thật) — thử lại cuối lượt rẻ hơn nhiều so với chạy lại cả lượt ba giờ.
   */
  private scheduleRetries(state: CrawlState): boolean {
    const pending = state.report.failed
      .map((item) => item.prefix)
      .filter((prefix) => !state.retried.has(prefix));
    if (pending.length === 0) return false;

    for (const prefix of pending) {
      state.retried.add(prefix);
      state.queue.push(prefix);
    }
    this.logger.warn({
      module: 'tiktok-sdk',
      operation: 'brand.crawl.retry',
      prefixes: pending.length,
      msg: 'Thử lại các prefix đã hỏng',
    });
    return true;
  }

  /** Prefix thử lại thành công ⇒ rút khỏi danh sách hỏng. */
  private markRecovered(prefix: string, state: CrawlState): void {
    const index = state.report.failed.findIndex((item) => item.prefix === prefix);
    if (index === -1) return;
    state.report.failed.splice(index, 1);
    state.report.recovered += 1;
  }

  private recordFailure(prefix: string, error: unknown, state: CrawlState): void {
    const message = error instanceof Error ? error.message : String(error);
    const existing = state.report.failed.find((item) => item.prefix === prefix);
    if (existing) existing.error = message;
    else state.report.failed.push({ prefix, error: message });
    state.consecutiveFailures += 1;

    this.logger.error({
      module: 'tiktok-sdk',
      operation: 'brand.crawl.prefix.fail',
      prefix,
      consecutiveFailures: state.consecutiveFailures,
      apiCalls: state.report.apiCalls,
      emitted: state.report.emitted,
      msg: message,
    });

    if (state.consecutiveFailures >= TIKTOK_BRAND_CRAWL_MAX_CONSECUTIVE_FAILURES) {
      state.fatal = error instanceof Error ? error : new Error(message);
    }
  }

  private async reportProgress(
    state: CrawlState,
    handlers: TiktokBrandCrawlHandlers,
  ): Promise<void> {
    const progress: TiktokBrandCrawlProgress = {
      apiCalls: state.report.apiCalls,
      fetched: state.report.fetched,
      emitted: state.report.emitted,
      prefixesDone: state.report.prefixesDone,
      prefixesQueued: state.queue.length,
      activePrefixes: [...state.active],
      elapsedMs: Date.now() - state.startedAt,
    };

    this.logger.log({
      module: 'tiktok-sdk',
      operation: 'brand.crawl.progress',
      ...progress,
      msg: 'Đang quét thương hiệu TikTok',
    });

    if (!handlers.onProgress) return;
    try {
      await handlers.onProgress(progress);
    } catch (error) {
      // Báo tiến độ chỉ để hiển thị — hỏng cũng không được làm gãy lượt quét.
      this.logger.warn({
        module: 'tiktok-sdk',
        operation: 'brand.crawl.progress.fail',
        msg: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
