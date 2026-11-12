import { createFileRoute } from '@tanstack/react-router';

import { DataExportPage } from '@/features/dataexport/components/data-export-page';
import { DeleteBusinessSection } from '@/features/workspace/components/delete-business-section';

export const Route = createFileRoute('/app/settings/data')({
  component: function DataSettingsRoute() {
    return (
      <div className="flex flex-col gap-10">
        <DataExportPage />
        <DeleteBusinessSection exportAnchor="data-export-title" />
      </div>
    );
  },
});
