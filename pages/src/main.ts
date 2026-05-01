import { app } from './state';
import { api } from './api';
import { clearChildren } from './lib/dom';
import { PinGateView } from './views/pin-gate';
import { AppShell } from './views/app-shell';

/**
 * Frontend entrypoint. Mounted from `index.html`.
 *
 *   1. Probe `/api/auth/status` to seed `authenticated`.
 *   2. Mount the appropriate view (PIN gate or AppShell).
 *   3. On `authenticated` flip, swap the mounted view.
 *
 * Inner views manage their own subscriptions and DOM; this file only
 * cares about the auth boundary.
 */

async function start(): Promise<void> {
  const rootMaybe = document.getElementById('app');
  if (rootMaybe === null) throw new Error('missing #app root in index.html');
  const root: HTMLElement = rootMaybe;

  try {
    const status = await api.authStatus();
    app.set({ authenticated: status.authenticated });
  } catch {
    app.set({ authenticated: false });
  }

  let lastAuthenticated: boolean | null = null;
  function mount(): void {
    const state = app.get();
    if (state.authenticated === lastAuthenticated) return;
    lastAuthenticated = state.authenticated;
    clearChildren(root);
    root.appendChild(state.authenticated ? AppShell() : PinGateView());
  }
  mount();
  app.subscribe(mount);
}

void start();
