import { createFileRoute } from '@tanstack/react-router';

import { DataExportPage } from '@/features/dataexport/components/data-export-page';

export const Route = createFileRoute('/app/settings/data')({
  component: DataExportPage,
});
