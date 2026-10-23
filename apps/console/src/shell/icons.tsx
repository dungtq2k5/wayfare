import {
  AudioLines,
  Bell,
  FileCheck,
  House,
  Languages,
  Layers,
  LifeBuoy,
  MapPin,
  ScrollText,
  Speech,
  Store,
  Tags,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavIcon } from '../nav';

/** The navigation's icons, by the name the table gives (round 33's icon set). */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  house: House,
  'file-check': FileCheck,
  'user-check': UserCheck,
  'map-pin': MapPin,
  tags: Tags,
  layers: Layers,
  'audio-lines': AudioLines,
  speech: Speech,
  languages: Languages,
  users: Users,
  'life-buoy': LifeBuoy,
  'scroll-text': ScrollText,
  store: Store,
  wallet: Wallet,
  bell: Bell,
};
