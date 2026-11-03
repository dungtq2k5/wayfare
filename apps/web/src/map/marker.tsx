import { cn } from '@wayfare/ui/cn';
import { categoryIcon } from '../places/category-icon';

/**
 * The map marker (round 25): the category's icon in a disc — the selected one larger, in the
 * selected colour, with the Place's name in a chip under it.
 */
export function MarkerFace({
  categoryCode,
  selected,
  name,
}: {
  categoryCode: string;
  selected: boolean;
  name?: string | undefined;
}) {
  const Icon = categoryIcon(categoryCode);
  return (
    <span className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'flex items-center justify-center rounded-full border-card shadow-2',
          selected
            ? 'size-14 border-3 bg-map-marker-selected text-map-marker-selected-foreground'
            : 'size-10 border-2 bg-map-marker text-map-marker-foreground',
        )}
      >
        <Icon aria-hidden className={selected ? 'size-7' : 'size-5'} />
      </span>
      {name === undefined ? null : (
        <span className="rounded-full bg-card px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground shadow-2">
          {name}
        </span>
      )}
    </span>
  );
}
