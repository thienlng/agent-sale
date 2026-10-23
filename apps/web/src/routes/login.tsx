import { createFileRoute } from '@tanstack/react-router';

import { LoginForm } from './-components/login-form';

export const Route = createFileRoute('/login')({
  component: () => (
    <div className="flex min-h-screen items-center justify-center">
      <LoginForm />
    </div>
  ),
});
