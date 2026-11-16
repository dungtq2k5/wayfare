'use client';

import { useQuery } from '@tanstack/react-query';
import { areasList, categoriesList } from '@wayfare/api-client';
import { useConsole } from '../i18n/provider';

/** Categories and areas change rarely; one read a session is enough. */
const REFERENCE = { staleTime: 30 * 60_000 } as const;

/** The categories, with what each applies to (`ANY`, `VENUE`, `EDITORIAL`). */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await categoriesList()).data,
    ...REFERENCE,
  });
}

/** The active areas, each with its published map pack's styles, if any (K4). */
export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: async () => (await areasList()).data,
    ...REFERENCE,
  });
}

/** Category and area names, from the app's bundle (`category.*`, `area.*`); the code when unknown. */
export function useNames() {
  const { tDynamic } = useConsole();
  return {
    category: (code: string) => tDynamic(`category.${code}`, undefined, code),
    area: (code: string) => tDynamic(`area.${code}`, undefined, code),
  };
}
