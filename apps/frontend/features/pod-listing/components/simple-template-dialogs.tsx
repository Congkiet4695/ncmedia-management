'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import {
  usePreviewDescription,
  useSavePodTemplate,
  useSystemTokens,
} from '../hooks/use-pod-listing';
import {
  POD_PRICING_FORMULA_VARIABLES,
  POD_PRICING_MARKUP_TYPES,
  type PodDescriptionTemplate,
  type PodDescriptionTemplateToken,
  type PodPricingMarkupType,
  type PodPricingStrategy,
} from '../types';

// ===========================================================================
// Description Template
// ===========================================================================

/**
 * Form Description Template.
 *
 * Nội dung là **HTML** kèm token. Hai loại token, và đó là điểm cốt lõi của "Token Engine
 * mở rộng được":
 *
 * - **Token hệ thống** (`{{PRODUCT.TITLE}}`, `{{SHOP.NAME}}`…) — do backend cấp, bấm để chèn.
 * - **Token tự đặt** (`{{MATERIAL}}`, `{{CARE}}`…) — người dùng khai báo ngay dưới đây,
 *   lưu vào database. Thêm token mới KHÔNG cần sửa mã.
 *
 * **Preview** gọi thẳng backend để thay token bằng đúng bộ quy tắc sẽ chạy khi làm listing
 * — xem trước một đằng, chạy thật một nẻo là lỗi khó chịu nhất của loại màn hình này.
 * HTML được render trong `iframe sandbox`, KHÔNG chèn vào DOM của trang quản trị: nội dung
 * do người dùng nhập, chèn thẳng là mở đường cho XSS.
 */
export function DescriptionTemplateDialog({
  open,
  template,
  onClose,
}: {
  open: boolean;
  template: PodDescriptionTemplate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate('descriptions');
  const preview = usePreviewDescription();
  const systemTokens = useSystemTokens();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [tokens, setTokens] = useState<PodDescriptionTemplateToken[]>([]);
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [unknownTokens, setUnknownTokens] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setContentHtml(template?.contentHtml ?? '');
    setTokens(template?.tokens ?? []);
    setDisplayOrder(String(template?.displayOrder ?? 0));
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);
    setPreviewHtml(null);
    setUnknownTokens([]);
  }, [open, template]);

  /** Chèn token vào đúng vị trí con trỏ thay vì bắt người dùng gõ tay. */
  const insertToken = (code: string) => {
    const editor = editorRef.current;
    const snippet = `{{${code}}}`;
    if (!editor) {
      setContentHtml((prev) => prev + snippet);
      return;
    }
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    setContentHtml((prev) => prev.slice(0, start) + snippet + prev.slice(end));
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const handlePreview = async () => {
    try {
      const result = await preview.mutateAsync({
        contentHtml,
        tokens: tokens.map((token) => ({ code: token.code, value: token.value })),
      });
      setPreviewHtml(result.html);
      setUnknownTokens(result.unknownTokens);
    } catch (error) {
      toast.error(t('listing.descriptionTemplates.previewFailed'), {
        description: translateApiError(error),
      });
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !contentHtml.trim()) {
      toast.error(t('listing.descriptionTemplates.missingRequired'));
      return;
    }
    try {
      await save.mutateAsync({
        id: template?.id,
        payload: {
          name: name.trim(),
          contentHtml,
          displayOrder: Number(displayOrder || 0),
          isDefault,
          ...(template ? { isActive } : {}),
          tokens: tokens
            .filter((token) => token.code.trim())
            .map((token, index) => ({
              code: token.code.trim().toUpperCase(),
              label: token.label || undefined,
              value: token.value,
              sortOrder: index,
            })),
        },
      });
      toast.success(t('listing.common.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-4xl"
      title={
        template ? t('listing.descriptionTemplates.edit') : t('listing.descriptionTemplates.create')
      }
      description={t('listing.descriptionTemplates.dialogHint')}
    >
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label>
              {t('listing.common.name')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.common.displayOrder')}</Label>
            <Input
              type="number"
              min="0"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t('listing.descriptionTemplates.content')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePreview()}
              disabled={preview.isPending}
            >
              {preview.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('listing.descriptionTemplates.preview')}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {(systemTokens.data ?? []).map((token) => (
              <Button
                key={token.code}
                variant="outline"
                size="sm"
                className="h-7 font-mono text-xs"
                onClick={() => insertToken(token.code)}
              >
                {`{{${token.code}}}`}
              </Button>
            ))}
            {tokens
              .filter((token) => token.code.trim())
              .map((token) => (
                <Button
                  key={token.code}
                  variant="outline"
                  size="sm"
                  className="h-7 font-mono text-xs"
                  onClick={() => insertToken(token.code.toUpperCase())}
                >
                  {`{{${token.code.toUpperCase()}}}`}
                </Button>
              ))}
          </div>

          <textarea
            ref={editorRef}
            value={contentHtml}
            onChange={(event) => setContentHtml(event.target.value)}
            rows={10}
            className="w-full rounded-md border bg-background p-3 font-mono text-xs"
            placeholder="<h3>{{PRODUCT.TITLE}}</h3><p>{{MATERIAL}}</p>"
          />
        </div>

        {/* --- Token tự đặt: dữ liệu, không phải hằng số trong mã --- */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('listing.descriptionTemplates.customTokens')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTokens((prev) => [...prev, { code: '', label: '', value: '' }])}
            >
              <Plus className="size-4" />
              {t('listing.descriptionTemplates.addToken')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('listing.descriptionTemplates.tokenHint')}
          </p>

          {tokens.map((token, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <div className="w-[160px] space-y-1">
                <Label>{t('listing.descriptionTemplates.tokenCode')}</Label>
                <Input
                  value={token.code}
                  placeholder="MATERIAL"
                  className="font-mono text-xs uppercase"
                  onChange={(event) =>
                    setTokens((prev) =>
                      prev.map((item, i) =>
                        i === index ? { ...item, code: event.target.value.toUpperCase() } : item,
                      ),
                    )
                  }
                />
              </div>
              <div className="min-w-[260px] flex-1 space-y-1">
                <Label>{t('listing.descriptionTemplates.tokenValue')}</Label>
                <Input
                  value={token.value}
                  placeholder="100% ring-spun cotton"
                  onChange={(event) =>
                    setTokens((prev) =>
                      prev.map((item, i) =>
                        i === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTokens((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {previewHtml !== null && (
          <div className="space-y-2">
            {unknownTokens.length > 0 && (
              <p className="text-xs text-destructive">
                {t('listing.descriptionTemplates.unknownTokens', {
                  tokens: unknownTokens.join(', '),
                })}
              </p>
            )}
            <iframe
              title="description-preview"
              sandbox=""
              srcDoc={previewHtml}
              className="h-56 w-full rounded-md border bg-white"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            {t('listing.common.setDefault')}
          </label>
          {template && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              {t('listing.common.active')}
            </label>
          )}
        </div>

        <DialogActions onClose={onClose} onSubmit={handleSubmit} pending={save.isPending} />
      </div>
    </Modal>
  );
}

// ===========================================================================
// Pricing Strategy
// ===========================================================================

/**
 * Form Pricing Strategy — Cost + Shipping + Markup ⇒ Sale Price ⇒ Retail Price ⇒ Discount.
 *
 * Ba kiểu tính: **Percentage**, **Fixed** và **Formula** (biểu thức số học trên các biến
 * `cost / shipping / base / markup`). Có **xem trước giá ngay tại form**: người dùng thấy
 * con số cuối cùng trước khi lưu, thay vì phải làm listing mới biết công thức ra bao nhiêu.
 */
export function PricingStrategyDialog({
  open,
  strategy,
  onClose,
}: {
  open: boolean;
  strategy: PodPricingStrategy | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate('pricing');

  const [form, setForm] = useState({
    name: '',
    cost: '0',
    shippingCost: '0',
    markupType: 'PERCENT' as PodPricingMarkupType,
    markupValue: '0',
    formula: '',
    retailPriceMultiplier: '1',
    discountPercent: '0',
    roundingIncrement: '0',
    currency: 'USD',
    displayOrder: '0',
    isDefault: false,
    isActive: true,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: strategy?.name ?? '',
      cost: strategy?.cost ?? '0',
      shippingCost: strategy?.shippingCost ?? '0',
      markupType: strategy?.markupType ?? 'PERCENT',
      markupValue: strategy?.markupValue ?? '0',
      formula: strategy?.formula ?? '',
      retailPriceMultiplier: strategy?.retailPriceMultiplier ?? '1',
      discountPercent: strategy?.discountPercent ?? '0',
      roundingIncrement: strategy?.roundingIncrement ?? '0',
      currency: strategy?.currency ?? 'USD',
      displayOrder: String(strategy?.displayOrder ?? 0),
      isDefault: strategy?.isDefault ?? false,
      isActive: strategy?.isActive ?? true,
    });
  }, [open, strategy]);

  // Xem trước — cùng công thức với backend (`pod-pricing.calculator.ts`).
  const preview = (() => {
    const cost = Number(form.cost || 0);
    const shipping = Number(form.shippingCost || 0);
    const base = cost + shipping;
    const markup = Number(form.markupValue || 0);

    let sale: number | null;
    if (form.markupType === 'PERCENT') sale = base * (1 + markup / 100);
    else if (form.markupType === 'FIXED') sale = base + markup;
    else sale = evaluateFormula(form.formula, { cost, shipping, base, markup });

    if (sale === null) return null;

    const increment = Number(form.roundingIncrement || 0);
    if (increment > 0) sale = Math.ceil(sale / increment) * increment;
    const retail = sale * Number(form.retailPriceMultiplier || 1);
    const final = sale * (1 - Number(form.discountPercent || 0) / 100);
    return { sale: sale.toFixed(2), retail: retail.toFixed(2), final: final.toFixed(2) };
  })();

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('listing.pricing.missingRequired'));
      return;
    }
    if (form.markupType === 'FORMULA' && !form.formula.trim()) {
      toast.error(t('listing.pricing.formulaRequired'));
      return;
    }
    try {
      await save.mutateAsync({
        id: strategy?.id,
        payload: {
          name: form.name.trim(),
          cost: Number(form.cost || 0),
          shippingCost: Number(form.shippingCost || 0),
          markupType: form.markupType,
          markupValue: Number(form.markupValue || 0),
          formula: form.markupType === 'FORMULA' ? form.formula.trim() : undefined,
          retailPriceMultiplier: Number(form.retailPriceMultiplier || 1),
          discountPercent: Number(form.discountPercent || 0),
          roundingIncrement: Number(form.roundingIncrement || 0),
          currency: form.currency,
          displayOrder: Number(form.displayOrder || 0),
          isDefault: form.isDefault,
          ...(strategy ? { isActive: form.isActive } : {}),
        },
      });
      toast.success(t('listing.common.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-3xl"
      title={strategy ? t('listing.pricing.edit') : t('listing.pricing.create')}
      description={t('listing.pricing.dialogHint')}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label>
              {t('listing.common.name')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input value={form.name} onChange={(event) => set('name')(event.target.value)} />
          </div>
          <NumberField
            label={t('listing.common.displayOrder')}
            value={form.displayOrder}
            onChange={set('displayOrder')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label={t('listing.pricing.cost')} value={form.cost} onChange={set('cost')} />
          <NumberField
            label={t('listing.pricing.shipping')}
            value={form.shippingCost}
            onChange={set('shippingCost')}
          />
          <div className="space-y-1">
            <Label>{t('listing.pricing.markupType')}</Label>
            <Combobox
              value={form.markupType}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, markupType: value as PodPricingMarkupType }))
              }
              options={POD_PRICING_MARKUP_TYPES.map((type) => ({
                value: type,
                label: t(`listing.pricing.markup.${type}`),
              }))}
            />
          </div>
        </div>

        {form.markupType === 'FORMULA' ? (
          <div className="space-y-1">
            <Label>{t('listing.pricing.formula')}</Label>
            <Input
              value={form.formula}
              placeholder="(cost + shipping) * 1.8 + 2"
              className="font-mono text-sm"
              onChange={(event) => set('formula')(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('listing.pricing.formulaHint', {
                variables: POD_PRICING_FORMULA_VARIABLES.join(', '),
              })}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label={t('listing.pricing.markupValue')}
              value={form.markupValue}
              onChange={set('markupValue')}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <NumberField
            label={t('listing.pricing.retailMultiplier')}
            value={form.retailPriceMultiplier}
            onChange={set('retailPriceMultiplier')}
          />
          <NumberField
            label={t('listing.pricing.discount')}
            value={form.discountPercent}
            onChange={set('discountPercent')}
          />
          <NumberField
            label={t('listing.pricing.rounding')}
            value={form.roundingIncrement}
            onChange={set('roundingIncrement')}
          />
          <div className="space-y-1">
            <Label>{t('listing.common.currency')}</Label>
            <Input value={form.currency} onChange={(event) => set('currency')(event.target.value)} />
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{t('listing.pricing.previewTitle')}</p>
          <p className="mt-1 text-muted-foreground">
            {preview
              ? t('listing.pricing.previewLine', {
                  sale: preview.sale,
                  retail: preview.retail,
                  final: preview.final,
                  currency: form.currency,
                })
              : t('listing.pricing.previewInvalid')}
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => setForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
            />
            {t('listing.common.setDefault')}
          </label>
          {strategy && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                }
              />
              {t('listing.common.active')}
            </label>
          )}
        </div>

        <DialogActions onClose={onClose} onSubmit={handleSubmit} pending={save.isPending} />
      </div>
    </Modal>
  );
}

/**
 * Đánh giá công thức để XEM TRƯỚC trên trình duyệt.
 *
 * 🔴 Không `eval`: chuỗi được tách token rồi tính bằng shunting-yard, giống hệt cách
 * backend làm. Preview sai cú pháp thì trả `null` để form hiện "công thức chưa hợp lệ" —
 * bản kiểm tra có thẩm quyền vẫn là ở backend lúc lưu.
 */
function evaluateFormula(formula: string, vars: Record<string, number>): number | null {
  const tokens = formula.match(/\d*\.?\d+|[a-zA-Z_][a-zA-Z0-9_]*|[+\-*/()]/g);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== formula.replace(/\s/g, '')) return null;

  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const output: Array<number | string> = [];
  const operators: string[] = [];
  let previous: string | null = null;

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      output.push(Number(token));
    } else if (/^[a-zA-Z_]/.test(token)) {
      if (!(token in vars)) return null;
      output.push(vars[token]);
    } else if (token === '(') {
      operators.push(token);
    } else if (token === ')') {
      let matched = false;
      while (operators.length > 0) {
        const top = operators.pop() as string;
        if (top === '(') {
          matched = true;
          break;
        }
        output.push(top);
      }
      if (!matched) return null;
    } else {
      // Dấu âm ở đầu biểu thức / sau `(` / sau toán tử ⇒ chèn 0 để thành phép trừ.
      if ((token === '-' || token === '+') && (previous === null || previous === '(' || previous in precedence)) {
        output.push(0);
      }
      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (top === '(' || precedence[top] < precedence[token]) break;
        output.push(operators.pop() as string);
      }
      operators.push(token);
    }
    previous = token;
  }

  while (operators.length > 0) {
    const top = operators.pop() as string;
    if (top === '(') return null;
    output.push(top);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (typeof token === 'number') {
      stack.push(token);
      continue;
    }
    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) return null;
    if (token === '/' && right === 0) return null;
    stack.push(
      token === '+'
        ? left + right
        : token === '-'
          ? left - right
          : token === '*'
            ? left * right
            : left / right,
    );
  }

  return stack.length === 1 && Number.isFinite(stack[0]) ? stack[0] : null;
}

// ===========================================================================
// Dùng chung
// ===========================================================================

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function DialogActions({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="outline" onClick={onClose} disabled={pending}>
        {t('action.cancel')}
      </Button>
      <Button onClick={() => void onSubmit()} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t('action.save')}
      </Button>
    </div>
  );
}
