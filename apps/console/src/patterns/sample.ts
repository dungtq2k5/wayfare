import type { StatusTone } from '@wayfare/ui/surfaces';

/** A sample Place for `/dev/patterns` (K16): what P1–P5 show, never sent anywhere. */
export interface SamplePlace {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly area: string;
  readonly category: string;
  readonly status: StatusTone;
  /** Minutes before the page's clock. */
  readonly updatedMinutesAgo: number;
  readonly owner: string;
  readonly description: string;
  readonly address: string;
  readonly phone: string;
}

const NAMES = [
  ['Phở Hòa Pasteur', 'District 3', 'Restaurant'],
  ['Bánh mì Huỳnh Hoa', 'District 1', 'Street food'],
  ['Nhà thờ Đức Bà', 'District 1', 'Church'],
  ['Chợ Bến Thành', 'District 1', 'Market'],
  ['Cà phê Ba Son', 'District 1', 'Café'],
  ['Ốc Oanh Vĩnh Khánh', 'District 4', 'Street food'],
  ['Bảo tàng Chứng tích Chiến tranh', 'District 3', 'Museum'],
  ['Công viên Tao Đàn', 'District 1', 'Park'],
  ['Hủ tiếu Nam Vang Liên Hương', 'District 5', 'Restaurant'],
  ['Dinh Độc Lập', 'District 1', 'Landmark'],
  ['Bưu điện Thành phố', 'District 1', 'Landmark'],
  ['Phố đi bộ Nguyễn Huệ', 'District 1', 'Viewpoint'],
  ['Chùa Ngọc Hoàng', 'District 1', 'Landmark'],
  ['Cơm tấm Ba Ghiền', 'Phú Nhuận', 'Restaurant'],
  ['Bánh xèo 46A', 'District 1', 'Restaurant'],
  ['The Workshop Coffee', 'District 1', 'Café'],
  ['Bảo tàng Mỹ thuật', 'District 1', 'Museum'],
  ['Chợ Bình Tây', 'District 6', 'Market'],
  ['Bún bò Huế Đông Ba', 'District 3', 'Restaurant'],
  ['Landmark 81 SkyView', 'Bình Thạnh', 'Viewpoint'],
] as const;

const STATUSES: readonly StatusTone[] = [
  'active',
  'pending',
  'active',
  'active',
  'draft',
  'inactive',
  'active',
  'processing',
  'active',
  'active',
  'active',
  'active',
  'active',
  'active',
  'rejected',
  'active',
  'active',
  'active',
  'approved',
  'active',
];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A deterministic public code, like `K7M2 9QXA`. */
function codeOf(index: number): string {
  let seed = (index + 1) * 2_654_435_761;
  let code = '';
  for (let slot = 0; slot < 8; slot++) {
    code += ALPHABET[Math.abs(seed) % ALPHABET.length];
    seed = Math.floor(seed / 7) + 97 * (slot + 3);
    if (slot === 3) code += ' ';
  }
  return code;
}

/** 248 sample Places, the first twenty as the frames draw them, newest first. */
export const SAMPLE_PLACES: readonly SamplePlace[] = Array.from({ length: 248 }, (_, index) => {
  const [base, area, category] = NAMES[index % NAMES.length]!;
  const round = Math.floor(index / NAMES.length);
  return {
    id: `sample-${index + 1}`,
    name: round === 0 ? base : `${base} ${round + 1}`,
    code: codeOf(index),
    area,
    category,
    status: STATUSES[index % STATUSES.length]!,
    updatedMinutesAgo: 120 + index * 517,
    owner: 'Minh Tran',
    description: 'Phở bò since 1968.',
    address: '260C Pasteur, Phường 8, Quận 3',
    phone: '3829 7943',
  };
});

export const SAMPLE_AREAS = [...new Set(NAMES.map(([, area]) => area))];
export const SAMPLE_CATEGORIES = [...new Set(NAMES.map(([, , category]) => category))];
