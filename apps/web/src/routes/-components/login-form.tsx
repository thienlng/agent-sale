import { Button } from '@agent-sales/ui';
import { useTranslation } from 'react-i18next';

/** Static until the auth task lands; colocated with the route (`-components/` is excluded from routing). */
export function LoginForm() {
  const { t } = useTranslation();
  return (
    <form
      className="w-80 space-y-4 rounded-lg border border-border p-6"
      onSubmit={(e) => e.preventDefault()}
    >
      <h1 className="text-xl font-semibold">{t('auth.login')}</h1>
      <label className="block text-sm">
        {t('auth.email')}
        <input
          name="email"
          type="email"
          className="mt-1 w-full rounded-md border border-border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        {t('auth.password')}
        <input
          name="password"
          type="password"
          className="mt-1 w-full rounded-md border border-border px-3 py-2"
        />
      </label>
      <Button type="submit" className="w-full">
        {t('auth.login')}
      </Button>
    </form>
  );
}
