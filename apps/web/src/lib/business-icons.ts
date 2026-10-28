import type { BusinessIcon } from '@agent-sales/contracts';
import {
  Baby,
  Building2,
  Car,
  Coffee,
  Dumbbell,
  Flower2,
  Gem,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  type LucideIcon,
  ShoppingBag,
  Shirt,
  Sparkles,
  Store,
  Utensils,
} from 'lucide-react';

/** The drawing for each icon key a business can pick; an unknown key falls back to the building. */
const ICONS: Record<BusinessIcon, LucideIcon> = {
  building: Building2,
  store: Store,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  sparkles: Sparkles,
  utensils: Utensils,
  coffee: Coffee,
  home: House,
  car: Car,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  dumbbell: Dumbbell,
  laptop: Laptop,
  gem: Gem,
  flower: Flower2,
  baby: Baby,
};

export function businessIcon(key: string | null | undefined): LucideIcon {
  return ICONS[key as BusinessIcon] ?? Building2;
}
