import { Building2 } from 'lucide-react';

import { useLogoUrl, useProfile } from '../api/profile';

/** The current business's logo for the business selector; the building icon until one is set. */
export function BusinessLogo() {
  const profile = useProfile();
  const logo = useLogoUrl(profile.data?.logoVersion ?? null);
  if (!logo.data) return <Building2 aria-hidden />;
  // Decorative: the business name is the button's text right next to it.
  return <img src={logo.data} alt="" className="size-8 shrink-0 rounded-md object-cover" />;
}
