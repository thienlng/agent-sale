import { Banknote, Building2, Layers, type LucideIcon, Settings2, ShieldCheck } from 'lucide-react';

/** Platform back-office pages (ADR-021 §6), shown to platform admins only. */
export const ADMIN_NAV: readonly { to: string; key: string; icon: LucideIcon }[] = [
  { to: '/admin/accounts', key: 'nav.adminAccounts', icon: Building2 },
  { to: '/admin/payments', key: 'nav.adminPayments', icon: Banknote },
  { to: '/admin/plans', key: 'nav.adminPlans', icon: Layers },
  { to: '/admin/settings', key: 'nav.adminSettings', icon: Settings2 },
  { to: '/admin/llm', key: 'nav.adminLlm', icon: ShieldCheck },
];
