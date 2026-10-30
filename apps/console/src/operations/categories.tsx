'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminCategoriesCreate,
  adminCategoriesList,
  adminCategoriesUpdate,
  ApiError,
} from '@wayfare/api-client';
import { zCategoryCreateInput } from '@wayfare/contracts';
import type { AdminCategoryResponseDto, CreateCategoryDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { DataList, ListCard, PageHeader } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Ellipsis, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { CategoryIcon } from './category-icon';
import { operationHasUndo } from './undo';

type AppliesTo = CreateCategoryDto['appliesTo'];
const APPLIES: readonly AppliesTo[] = ['VENUE', 'EDITORIAL', 'ANY'];
/** How long a changed row keeps the accent fill before it fades (round 33). */
const CHANGED_MS = 2000;

type Row = AdminCategoryResponseDto;

/** A category's name from the app's strings; `null` until a release names its code. */
function useCategoryName() {
  const { tDynamic } = useConsole();
  return (code: string): string | null => {
    const name = tDynamic(`category.${code}`, undefined, '');
    return name === '' ? null : name;
  };
}

/** The name, else the code with the no-name line under it (G1); pickers show the same. */
export function CategoryName({ code, inactive = false }: { code: string; inactive?: boolean }) {
  const { t } = useConsole();
  const name = useCategoryName()(code);
  const tone = inactive ? 'text-muted-foreground' : 'text-foreground';
  return name === null ? (
    <span className="flex flex-col">
      <span className={`font-medium ${tone}`} aria-label={t('categories.noNameLabel', { code })}>
        {code}
      </span>
      <span aria-hidden className="text-xs text-muted-foreground italic">
        {t('categories.noName')}
      </span>
    </span>
  ) : (
    <span className="flex flex-col">
      <span className={`font-medium ${tone}`}>{name}</span>
      <span className="text-xs text-muted-foreground">{code}</span>
    </span>
  );
}

/**
 * Categories (G1–G3b): ordered by `sortOrder`, created and edited in a dialog; deactivating is the
 * round's one Undo (K12).
 */
export function Categories() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const queries = useQueryClient();
  const nameOf = useCategoryName();
  const list = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => (await adminCategoriesList()).data,
  });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());

  const label = (row: Row) => nameOf(row.code) ?? row.code;
  const refresh = (id?: string) => {
    void queries.invalidateQueries({ queryKey: ['admin-categories'] });
    void queries.invalidateQueries({ queryKey: ['categories'] });
    if (id === undefined) return;
    setChanged((current) => new Set(current).add(id));
    setTimeout(
      () =>
        setChanged((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      CHANGED_MS,
    );
  };
  const setActive = (row: Row, isActive: boolean) =>
    adminCategoriesUpdate(row.id, { isActive }).then(() => refresh(row.id));

  const deactivate = (row: Row) => {
    setBusy(true);
    setAlert(null);
    setActive(row, false).then(
      () => {
        setBusy(false);
        setDeactivating(null);
        toast.success(t('categories.deactivated', { name: label(row) }), {
          description: t('categories.deactivatedBody'),
          ...(operationHasUndo('category.deactivate')
            ? {
                action: {
                  label: t('action.undo'),
                  onClick: () =>
                    void setActive(row, true).catch((error: unknown) =>
                      toast.error(errorText(error, translator), { duration: Infinity }),
                    ),
                },
              }
            : {}),
        });
      },
      (error: unknown) => {
        setBusy(false);
        setAlert(errorText(error, translator));
      },
    );
  };
  const reactivate = (row: Row) =>
    void setActive(row, true).then(
      () => toast.success(t('categories.reactivated', { name: label(row) })),
      (error: unknown) => toast.error(errorText(error, translator), { duration: Infinity }),
    );

  const status = (row: Row) =>
    row.isActive ? (
      <StatusBadge tone="active">{t('categories.active')}</StatusBadge>
    ) : (
      <StatusBadge tone="inactive">{t('categories.inactive')}</StatusBadge>
    );
  const name = (row: Row) => (
    <span className="flex items-center gap-3">
      <CategoryIcon code={row.code} />
      {can('catalog.taxonomy.manage') ? (
        <button type="button" className="text-left hover:underline" onClick={() => setEditing(row)}>
          <CategoryName code={row.code} inactive={!row.isActive} />
        </button>
      ) : (
        <CategoryName code={row.code} inactive={!row.isActive} />
      )}
    </span>
  );
  const menu = (row: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('categories.rowMenu', { name: label(row) })}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setEditing(row)}>{t('categories.edit')}</DropdownMenuItem>
        {row.isActive ? (
          <DropdownMenuItem onSelect={() => setDeactivating(row)}>
            {t('categories.deactivate')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => reactivate(row)}>
            {t('categories.reactivate')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <PageHeader
        title={t('categories.title')}
        description={t('categories.lead')}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('categories.new')}
          </Button>
        }
      />
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataList
          caption={t('categories.title')}
          columns={[
            { key: 'category', label: t('categories.category') },
            { key: 'applies', label: t('categories.appliesTo') },
            { key: 'order', label: t('categories.order') },
            { key: 'places', label: t('categories.places') },
            { key: 'status', label: t('categories.status') },
          ]}
          rows={list.data}
          rowKey={(row) => row.id}
          rowClassName={(row) =>
            changed.has(row.id)
              ? 'bg-accent'
              : 'transition-colors duration-(--duration-slow) motion-reduce:transition-none'
          }
          cell={(row, column) => {
            switch (column) {
              case 'category':
                return name(row);
              case 'applies':
                return tDynamic(`categories.applies.${row.appliesTo}`);
              case 'order':
                return row.sortOrder;
              case 'places':
                return row.placeCount;
              default:
                return status(row);
            }
          }}
          card={(row) => (
            <ListCard
              name={name(row)}
              status={status(row)}
              facts={`${tDynamic(`categories.applies.${row.appliesTo}`)} · ${t('categories.order')} ${row.sortOrder} · ${t('categories.places')} ${row.placeCount}`}
              time={null}
            />
          )}
          rowEnd={{ label: t('categories.rowActions'), render: menu }}
        />
      )}
      {editing === null ? null : (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          nextOrder={Math.max(0, ...(list.data ?? []).map((row) => row.sortOrder)) + 10}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={(id) => {
            setEditing(null);
            refresh(id);
          }}
        />
      )}
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivating(null);
            setAlert(null);
          }
        }}
        title={
          deactivating === null
            ? ''
            : t('categories.deactivateTitle', { name: label(deactivating) })
        }
        description={t('categories.deactivateBody', { count: deactivating?.placeCount ?? 0 })}
        confirm={t('categories.deactivate')}
        busy={busy ? t('categories.deactivate') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        alert={alert}
        onConfirm={() => {
          if (deactivating !== null) deactivate(deactivating);
        }}
      />
    </>
  );
}

/** Create or edit (G2, G2b): the code fixed after create, the icon the app's for the code (K12). */
function CategoryDialog({
  category,
  nextOrder,
  onOpenChange,
  onSaved,
}: {
  category: Row | null;
  nextOrder: number;
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const nameOf = useCategoryName();
  const [code, setCode] = useState(category?.code ?? '');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(category?.appliesTo ?? 'VENUE');
  const [order, setOrder] = useState(String(category?.sortOrder ?? nextOrder));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownCode = category?.code ?? code.trim();

  const save = () => {
    const values = {
      code: code.trim(),
      appliesTo,
      // The seed's convention: the stored icon is the lowercased code; nothing draws from it.
      icon: (category?.code ?? code.trim()).toLowerCase(),
      sortOrder: order.trim() === '' ? undefined : Number(order),
    };
    const checked = validateForm(
      category === null ? zCategoryCreateInput : zCategoryCreateInput.omit({ code: true }),
      category === null ? values : { ...values, code: undefined },
      translator,
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setAlert(null);
    setBusy(true);
    const request =
      category === null
        ? adminCategoriesCreate(checked.data as CreateCategoryDto)
        : adminCategoriesUpdate(category.id, { appliesTo, sortOrder: Number(order) });
    request.then(
      ({ data }) => {
        setBusy(false);
        toast.success(category === null ? t('categories.created') : t('categories.saved'));
        onSaved(data.category.id);
      },
      (error: unknown) => {
        setBusy(false);
        if (taken(error)) setErrors({ code: t('categories.codeTaken', { code: values.code }) });
        else setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader
          title={
            category === null
              ? t('categories.new')
              : t('categories.editTitle', { name: nameOf(category.code) ?? category.code })
          }
          description={category === null ? t('categories.newLead') : undefined}
        />
        {alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {category === null ? (
            <Field
              label={t('categories.code')}
              required
              help={t('categories.codeHelp')}
              error={errors.code}
            >
              {(control) => (
                <Input
                  {...control}
                  value={code}
                  autoComplete="off"
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
              )}
            </Field>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">{t('categories.code')}</span>
              <span className="flex items-center gap-2 text-sm text-foreground">
                <Lock aria-hidden className="size-4 text-muted-foreground" />
                {category.code}
              </span>
              <p className="text-xs text-muted-foreground">{t('categories.codeFixed')}</p>
            </div>
          )}
          <Field
            label={t('categories.appliesTo')}
            required
            help={t('categories.appliesHelp')}
            error={errors.appliesTo}
          >
            {(control) => (
              <select
                {...control}
                value={appliesTo}
                onChange={(event) => setAppliesTo(event.target.value as AppliesTo)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {APPLIES.map((value) => (
                  <option key={value} value={value}>
                    {tDynamic(`categories.applies.${value}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{t('categories.icon')}</span>
            <CategoryIcon code={shownCode} size="md" />
            <p className="text-xs text-muted-foreground">
              {nameOf(shownCode) === null
                ? t('categories.iconNew')
                : t('categories.iconDrawn', { code: shownCode })}
            </p>
          </div>
          <Field
            label={t('categories.order')}
            required
            help={t('categories.orderHelp')}
            error={errors.sortOrder}
            className="max-w-50"
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={0}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              busy={
                busy ? (category === null ? t('categories.create') : t('action.save')) : undefined
              }
            >
              {category === null ? t('categories.create') : t('action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A taken code is `400 VALIDATION_FAILED` at `/code` (catalog). */
export const taken = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.code === 'VALIDATION_FAILED' &&
  Array.isArray((error.details as { issues?: unknown } | undefined)?.issues) &&
  (error.details as { issues: { path?: string; code?: string }[] }).issues.some(
    (issue) => issue.path === '/code' && issue.code === 'taken',
  );
