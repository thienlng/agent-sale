/**
 * Dark mode follows the operating system: shadcn tokens switch on `.dark`.
 * Runs before the first render so there is no light flash.
 */
export function followSystemTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => document.documentElement.classList.toggle('dark', query.matches);
  apply();
  query.addEventListener('change', apply);
}
