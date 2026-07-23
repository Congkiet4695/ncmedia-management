'use client';

import { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuth } from '@/hooks/use-auth';
import { formatDate } from '@/lib/format';
import { getApiErrorMessage } from '@/utils/http';
import {
  useCreateOrderNote,
  useDeleteOrderNote,
  useUpdateOrderNote,
} from '../hooks/use-orders';
import { ORDER_NOTE_TYPES, ORDER_NOTE_TYPE_LABELS } from '../schemas/order.schema';
import type { OrderNote, OrderNoteType } from '../types';

/**
 * Panel quản lý ghi chú Order (Seller / Warehouse) — hiển thị dạng timeline/list + thêm/sửa/xóa.
 * Chỉ hiện nút thao tác khi có quyền `order.note`.
 */
export function OrderNotesPanel({ orderId, notes }: { orderId: string; notes: OrderNote[] }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('order.note');

  const createM = useCreateOrderNote();
  const updateM = useUpdateOrderNote();
  const deleteM = useDeleteOrderNote();

  const [type, setType] = useState<OrderNoteType>('SELLER');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const onAdd = async () => {
    if (!content.trim()) return;
    try {
      await createM.mutateAsync({ id: orderId, payload: { type, content: content.trim() } });
      toast.success('Đã thêm ghi chú.');
      setContent('');
    } catch (e) {
      toast.error('Thêm ghi chú thất bại', { description: getApiErrorMessage(e) });
    }
  };

  const onSaveEdit = async (noteId: string) => {
    if (!editContent.trim()) return;
    try {
      await updateM.mutateAsync({ noteId, payload: { content: editContent.trim() } });
      toast.success('Đã cập nhật ghi chú.');
      setEditingId(null);
    } catch (e) {
      toast.error('Cập nhật ghi chú thất bại', { description: getApiErrorMessage(e) });
    }
  };

  const onDelete = async (noteId: string) => {
    try {
      await deleteM.mutateAsync(noteId);
      toast.success('Đã xóa ghi chú.');
    } catch (e) {
      toast.error('Xóa ghi chú thất bại', { description: getApiErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ghi chú</CardTitle>
        <CardDescription>Ghi chú Seller / Warehouse của đơn hàng.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có ghi chú nào.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {ORDER_NOTE_TYPE_LABELS[note.type]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(note.createdAt)}
                      </span>
                    </div>
                    {editingId === note.id ? (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={updateM.isPending || !editContent.trim()}
                            onClick={() => onSaveEdit(note.id)}
                          >
                            {updateM.isPending && <Loader2 className="size-4 animate-spin" />}
                            Lưu
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{note.content}</p>
                    )}
                  </div>
                  {canManage && editingId !== note.id && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Sửa ghi chú"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditContent(note.content);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Xóa ghi chú"
                        disabled={deleteM.isPending}
                        onClick={() => onDelete(note.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
            <div className="space-y-1.5 sm:w-40">
              <Label htmlFor="note-type" className="text-xs">
                Loại
              </Label>
              <NativeSelect
                id="note-type"
                value={type}
                onChange={(e) => setType(e.target.value as OrderNoteType)}
              >
                {ORDER_NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ORDER_NOTE_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="note-content" className="text-xs">
                Nội dung
              </Label>
              <Input
                id="note-content"
                value={content}
                placeholder="Nhập ghi chú…"
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <Button disabled={createM.isPending || !content.trim()} onClick={onAdd}>
              {createM.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Thêm
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
