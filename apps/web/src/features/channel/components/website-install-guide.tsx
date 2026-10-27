import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const GUIDE_PLATFORMS = [
  'html',
  'wordpress',
  'ladipage',
  'haravan',
  'sapo',
  'shopify',
  'wix',
  'gtm',
] as const;

/** Short static install steps per site builder (paste before </body>; GTM via Custom HTML). */
export function WebsiteInstallGuide() {
  const { t } = useTranslation();
  const base = 'channelInbox.integrations.website.guide';
  const steps = (key: string): string[] => {
    const value: unknown = t(`${base}.${key}.steps`, { returnObjects: true });
    return Array.isArray(value) ? value.map(String) : [];
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t(`${base}.title`)}</p>
      <Tabs defaultValue="html">
        <TabsList className="h-auto flex-wrap justify-start">
          {GUIDE_PLATFORMS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`${base}.${key}.name`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {GUIDE_PLATFORMS.map((key) => (
          <TabsContent key={key} value={key}>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {steps(key).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
