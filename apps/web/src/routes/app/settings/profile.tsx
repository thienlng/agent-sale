import { createFileRoute } from '@tanstack/react-router';

import { DeleteBusinessSection } from '@/features/workspace/components/delete-business-section';
import { ProfilePage } from '@/features/workspace/components/profile-page';
import { useCan } from '@/lib/permissions';

export const Route = createFileRoute('/app/settings/profile')({
  component: function ProfileSettingsRoute() {
    // The danger zone sits under the profile, where owners look first; like the data tab, only
    // owners and admins see it (an admin is told that only the owner can delete).
    const canDelete = useCan('data.export');
    return (
      <div className="flex flex-col gap-10">
        <ProfilePage />
        {canDelete ? <DeleteBusinessSection /> : null}
      </div>
    );
  },
});
