'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import {
  FULFILLMENT_PROVIDERS,
  type CreateFulfillmentProviderInput,
  type FulfillmentProviderAccount,
  type FulfillmentProviderType,
  type UpdateFulfillmentProviderInput,
} from '../types';

const DEFAULT_BASE_URL = 'https://v3.mangoteeprints.com/api/public/v1';

interface ProviderFormDialogProps {
  open: boolean;
  /** Bỏ trống = tạo mới. */
  provider?: FulfillmentProviderAccount | null;
  submitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateFulfillmentProviderInput) => void;
  onUpdate: (input: UpdateFulfillmentProviderInput) => void;
}

/**
 * Dialog thêm / sửa nhà cung cấp fulfillment.
 *
 * 🔴 Ở chế độ SỬA, ô API key mặc định KHÔNG hiện và KHÔNG gửi đi — backend không bao giờ trả
 * khoá cũ về, nên không có gì để điền sẵn. Muốn đổi thì bấm "Replace API Key" và nhập khoá
 * mới; không bấm thì khoá hiện tại giữ nguyên.
 */
export function ProviderFormDialog({
  open,
  provider,
  submitting,
  onClose,
  onCreate,
  onUpdate,
}: ProviderFormDialogProps) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const isEdit = Boolean(provider);

  const [type, setType] = useState<FulfillmentProviderType>('MANGO');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);

  // Mỗi lần mở lại phải sạch — tránh mang khoá vừa gõ sang bản ghi khác.
  useEffect(() => {
    if (!open) return;
    setType(provider?.provider ?? 'MANGO');
    setName(provider?.name ?? '');
    setBaseUrl(provider?.baseUrl ?? DEFAULT_BASE_URL);
    setApiKey('');
    setReplacingKey(false);
  }, [open, provider]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isEdit) {
      onUpdate({
        name,
        baseUrl,
        // Chỉ gửi khoá khi người dùng chủ động thay — không gửi chuỗi rỗng đè lên khoá cũ.
        ...(replacingKey && apiKey ? { apiKey } : {}),
      });
      return;
    }
    onCreate({ provider: type, name, apiKey, baseUrl });
  };

  const canSubmit = name.trim() && baseUrl.trim() && (isEdit || apiKey.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('provider.edit') : t('provider.add')}
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="provider-type">
            {t('provider.type')} <span className="text-destructive">*</span>
          </Label>
          <NativeSelect
            id="provider-type"
            value={type}
            disabled={isEdit}
            onChange={(e) => setType(e.target.value as FulfillmentProviderType)}
          >
            {FULFILLMENT_PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider-name">
            {t('provider.displayName')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="provider-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('provider.displayNamePlaceholder')}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider-base-url">
            {t('provider.baseUrl')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="provider-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider-api-key">
            {t('provider.apiKey')}
            {!isEdit && <span className="text-destructive"> *</span>}
          </Label>

          {isEdit && !replacingKey ? (
            <div className="flex items-center gap-2">
              <Input
                id="provider-api-key"
                readOnly
                value={provider?.apiKeyHint ? `••••••••${provider.apiKeyHint}` : '••••••••'}
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => setReplacingKey(true)}>
                <KeyRound className="size-4" />
                {t('provider.replaceApiKey')}
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="provider-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('provider.apiKeyPlaceholder')}
                autoComplete="new-password"
                spellCheck={false}
              />
              {isEdit && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{t('provider.replaceApiKeyHint')}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplacingKey(false);
                      setApiKey('');
                    }}
                  >
                    {t('provider.cancelReplace')}
                  </Button>
                </div>
              )}
            </>
          )}
          {!isEdit && (
            <p className="text-xs text-muted-foreground">{t('provider.apiKeyMasked')}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
