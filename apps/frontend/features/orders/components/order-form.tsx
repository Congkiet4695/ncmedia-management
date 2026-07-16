'use client';

import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  EMPTY_ORDER_ITEM,
  orderFormSchema,
  type OrderFormInput,
} from '../schemas/order.schema';

interface AccountOption {
  id: string;
  name: string;
}

interface OrderFormProps {
  mode: 'create' | 'edit';
  accounts: AccountOption[];
  /** Khóa chọn Account (edit không đổi Account chủ đơn). */
  accountDisabled?: boolean;
  submitting?: boolean;
  defaultValues?: Partial<OrderFormInput>;
  onSubmit: (values: OrderFormInput) => void;
}

const BASE_DEFAULTS: OrderFormInput = {
  accountId: '',
  orderNumber: '',
  customerName: '',
  customerPhone: '',
  shippingAddress: '',
  sellerNote: '',
  warehouseNote: '',
  tracking: '',
  orderedAt: '',
  items: [EMPTY_ORDER_ITEM],
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export function OrderForm({
  mode,
  accounts,
  accountDisabled,
  submitting,
  defaultValues,
  onSubmit,
}: OrderFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<OrderFormInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: { ...BASE_DEFAULTS, ...defaultValues },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* Thông tin đơn */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="accountId">
            Account <span className="text-destructive">*</span>
          </Label>
          <NativeSelect
            id="accountId"
            disabled={submitting || accountDisabled}
            aria-invalid={!!errors.accountId}
            {...register('accountId')}
          >
            <option value="">— Chọn Account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.accountId?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="orderNumber">
            Order Number <span className="text-destructive">*</span>
          </Label>
          <Input
            id="orderNumber"
            disabled={submitting}
            aria-invalid={!!errors.orderNumber}
            {...register('orderNumber')}
          />
          <FieldError message={errors.orderNumber?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="customerName">Tên khách hàng</Label>
          <Input id="customerName" disabled={submitting} {...register('customerName')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="customerPhone">SĐT khách hàng</Label>
          <Input id="customerPhone" disabled={submitting} {...register('customerPhone')} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="shippingAddress">Địa chỉ giao hàng</Label>
          <Input id="shippingAddress" disabled={submitting} {...register('shippingAddress')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tracking">Tracking</Label>
          <Input id="tracking" disabled={submitting} {...register('tracking')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="orderedAt">Ngày order</Label>
          <Input id="orderedAt" type="date" disabled={submitting} {...register('orderedAt')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sellerNote">Note của Seller</Label>
          <Input id="sellerNote" disabled={submitting} {...register('sellerNote')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="warehouseNote">Note Kho</Label>
          <Input id="warehouseNote" disabled={submitting} {...register('warehouseNote')} />
        </div>
      </div>

      {/* Order Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Sản phẩm ({fields.length})</h3>
            <FieldError message={errors.items?.message} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => append({ ...EMPTY_ORDER_ITEM })}
          >
            <Plus className="size-4" />
            Thêm sản phẩm
          </Button>
        </div>

        {fields.map((field, index) => (
          <div key={field.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Xóa sản phẩm"
                disabled={submitting || fields.length <= 1}
                onClick={() => remove(index)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`items.${index}.productName`} className="text-xs">
                  Tên sản phẩm <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`items.${index}.productName`}
                  disabled={submitting}
                  aria-invalid={!!errors.items?.[index]?.productName}
                  {...register(`items.${index}.productName` as const)}
                />
                <FieldError message={errors.items?.[index]?.productName?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.quantity`} className="text-xs">
                  Số lượng
                </Label>
                <Input
                  id={`items.${index}.quantity`}
                  type="number"
                  min={1}
                  disabled={submitting}
                  {...register(`items.${index}.quantity` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.unitPrice`} className="text-xs">
                  Đơn giá
                </Label>
                <Input
                  id={`items.${index}.unitPrice`}
                  type="number"
                  step="0.01"
                  min={0}
                  disabled={submitting}
                  {...register(`items.${index}.unitPrice` as const)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`items.${index}.productLink`} className="text-xs">
                  Link sản phẩm
                </Label>
                <Input
                  id={`items.${index}.productLink`}
                  disabled={submitting}
                  {...register(`items.${index}.productLink` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.supplier`} className="text-xs">
                  Supplier
                </Label>
                <Input
                  id={`items.${index}.supplier`}
                  disabled={submitting}
                  {...register(`items.${index}.supplier` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.sku`} className="text-xs">
                  SKU
                </Label>
                <Input
                  id={`items.${index}.sku`}
                  disabled={submitting}
                  {...register(`items.${index}.sku` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.color`} className="text-xs">
                  Color
                </Label>
                <Input
                  id={`items.${index}.color`}
                  disabled={submitting}
                  {...register(`items.${index}.color` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.size`} className="text-xs">
                  Size
                </Label>
                <Input
                  id={`items.${index}.size`}
                  disabled={submitting}
                  {...register(`items.${index}.size` as const)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items.${index}.variant`} className="text-xs">
                  Variant
                </Label>
                <Input
                  id={`items.${index}.variant`}
                  disabled={submitting}
                  {...register(`items.${index}.variant` as const)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`items.${index}.image`} className="text-xs">
                  Ảnh (URL)
                </Label>
                <Input
                  id={`items.${index}.image`}
                  disabled={submitting}
                  {...register(`items.${index}.image` as const)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor={`items.${index}.remark`} className="text-xs">
                  Ghi chú
                </Label>
                <Input
                  id={`items.${index}.remark`}
                  disabled={submitting}
                  {...register(`items.${index}.remark` as const)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {mode === 'edit' ? 'Lưu thay đổi' : 'Tạo Order'}
        </Button>
      </div>
    </form>
  );
}
