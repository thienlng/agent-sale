import type { VariantOption } from '@agent-sales/contracts';
import { Package } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatVnd } from '@/lib/format';
import { useWarehouses } from '../api/commerce';
import { ProductPicker } from './order-lines';

/** Inserts the selected catalog facts into a draft; sending stays an explicit composer action. */
export function ProductShare({ onInsert }: { onInsert: (text: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Package className="size-4" />
          {t('channelInbox.sales.shareProduct')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-3"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <h3 className="font-semibold">{t('channelInbox.sales.shareProduct')}</h3>
        <p className="text-xs text-muted-foreground">{t('channelInbox.sales.shareProductHint')}</p>
        {open ? (
          <ProductSharePicker
            onPick={(variant) => {
              onInsert(
                t('channelInbox.sales.productMessage', {
                  name: variant.productName,
                  variant: variant.variantName ? ` · ${variant.variantName}` : '',
                  price: formatVnd(variant.price),
                }),
              );
              setOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
function ProductSharePicker({ onPick }: { onPick: (variant: VariantOption) => void }) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const [chosen, setChosen] = useState('');
  const list = warehouses.data ?? [];
  const warehouse =
    list.find((item) => item.id === chosen) ?? list.find((item) => item.isDefault) ?? list[0];
  if (warehouses.isPending)
    return (
      <p role="status" className="text-sm">
        {t('channelInbox.loading')}
      </p>
    );
  if (warehouses.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('channelInbox.loadError')}</p>
        <Button type="button" variant="outline" onClick={() => void warehouses.refetch()}>
          {t('channelInbox.retry')}
        </Button>
      </div>
    );
  if (!warehouse)
    return <p className="text-sm text-muted-foreground">{t('orderForm.needWarehouse')}</p>;
  return (
    <div className="space-y-3">
      <Label htmlFor="inbox-share-warehouse">{t('orderForm.warehouse')}</Label>
      <Select value={warehouse.id} onValueChange={setChosen}>
        <SelectTrigger id="inbox-share-warehouse" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {list.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ProductPicker compact warehouseId={warehouse.id} onPick={onPick} />
    </div>
  );
}
