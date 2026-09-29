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

/**
 * Base URL gợi ý khi TẠO theo từng nhà cung cấp. Sellerwix để trống: backend dùng mặc định cấu hình
 * (`SELLERWIX_API_BASE_URL`) — chỉ điền khi cần môi trường khác.
 */
const INITIAL_BASE_URL: Partial<Record<FulfillmentProviderType, string>> = {
  MANGO: DEFAULT_BASE_URL,
  SELLERWIX: '',
};

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
 * mới; không bấm thì khoá hiện tại giữ nguyên. Private key của Sellerwix theo đúng luật đó.
 *
 * Sellerwix (OAuth2 JWT Bearer RS256) cần thêm: Public Key ID, Private Key (PEM) và Store ID —
 * các ô này CHỈ hiện khi nhà cung cấp là Sellerwix.
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
  const [storeId, setStoreId] = useState('');
  const [publicKeyId, setPublicKeyId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [replacingPrivateKey, setReplacingPrivateKey] = useState(false);

  const isSellerwix = type === 'SELLERWIX';

  // Mỗi lần mở lại phải sạch — tránh mang khoá vừa gõ sang bản ghi khác.
  useEffect(() => {
    if (!open) return;
    const initialType = provider?.provider ?? 'MANGO';
    setType(initialType);
    setName(provider?.name ?? '');
    setBaseUrl(provider ? (provider.baseUrl ?? '') : (INITIAL_BASE_URL[initialType] ?? ''));
    setApiKey('');
    setReplacingKey(false);
    setStoreId(provider?.storeId ?? '');
    setPublicKeyId(provider?.publicKeyId ?? '');
    setPrivateKey('');
    setReplacingPrivateKey(false);
  }, [open, provider]);

  const changeType = (next: FulfillmentProviderType) => {
    setType(next);
    // Base URL gợi ý là của nhà cung cấp VỪA chọn — không mang URL Mango sang Sellerwix.
    setBaseUrl(INITIAL_BASE_URL[next] ?? '');
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const sellerwixFields = isSellerwix
      ? {
          storeId: storeId.trim(),
          publicKeyId: publicKeyId.trim(),
          // Private key chỉ gửi khi có giá trị mới — không gửi chuỗi rỗng đè lên key đã lưu.
          ...((!isEdit || replacingPrivateKey) && privateKey.trim()
            ? { privateKey: privateKey.trim() }
            : {}),
        }
      : {};
    if (isEdit) {
      onUpdate({
        name,
        baseUrl,
        // Chỉ gửi khoá khi người dùng chủ động thay — không gửi chuỗi rỗng đè lên khoá cũ.
        ...(replacingKey && apiKey ? { apiKey } : {}),
        ...sellerwixFields,
      });
      return;
    }
    onCreate({
      provider: type,
      name,
      apiKey,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...sellerwixFields,
    });
  };

  const canSubmit = isSellerwix
    ? Boolean(
        name.trim() &&
          storeId.trim() &&
          publicKeyId.trim() &&
          (isEdit || (apiKey.trim() && privateKey.trim())),
      )
    : Boolean(name.trim() && baseUrl.trim() && (isEdit || apiKey.trim()));

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
            onChange={(e) => changeType(e.target.value as FulfillmentProviderType)}
          >
            {FULFILLMENT_PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {t(`provider.typeValue.${value}`)}
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
            {t('provider.baseUrl')}
            {!isSellerwix && <span className="text-destructive"> *</span>}
          </Label>
          <Input
            id="provider-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={isSellerwix ? t('provider.sellerwix.baseUrlPlaceholder') : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider-api-key">
            {isSellerwix ? t('provider.sellerwix.apiKey') : t('provider.apiKey')}
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
          {!isEdit && <p className="text-xs text-muted-foreground">{t('provider.apiKeyMasked')}</p>}
        </div>

        {isSellerwix && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider-public-key-id">
                  {t('provider.sellerwix.publicKeyId')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="provider-public-key-id"
                  value={publicKeyId}
                  onChange={(e) => setPublicKeyId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-store-id">
                  {t('provider.sellerwix.storeId')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="provider-store-id"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-private-key">
                {t('provider.sellerwix.privateKey')}
                {!isEdit && <span className="text-destructive"> *</span>}
              </Label>
              {isEdit && !replacingPrivateKey ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="provider-private-key"
                    readOnly
                    value={
                      provider?.privateKeyConfigured
                        ? t('provider.sellerwix.privateKeyConfigured')
                        : t('provider.sellerwix.privateKeyMissing')
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReplacingPrivateKey(true)}
                  >
                    <KeyRound className="size-4" />
                    {t('provider.sellerwix.replacePrivateKey')}
                  </Button>
                </div>
              ) : (
                <>
                  <textarea
                    id="provider-private-key"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    rows={5}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                    placeholder="-----BEGIN PRIVATE KEY-----"
                  />
                  {isEdit && (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReplacingPrivateKey(false);
                          setPrivateKey('');
                        }}
                      >
                        {t('provider.cancelReplace')}
                      </Button>
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">{t('provider.sellerwix.privateKeyHint')}</p>
            </div>
          </>
        )}

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
