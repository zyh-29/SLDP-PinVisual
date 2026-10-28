import type { ReactNode } from 'react';

/**
 * Pull down at the top of a page to reload it: web only (see usePullToRefresh.web.tsx). The phone app has nothing
 * to reload, so here it does nothing.
 */
export function usePullToRefresh(): { attach: undefined; indicator: ReactNode } {
  return { attach: undefined, indicator: null };
}
