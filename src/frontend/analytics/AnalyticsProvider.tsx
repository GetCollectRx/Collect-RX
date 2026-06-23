/**
 * AnalyticsProvider
 *
 * Wraps the entire app. Initialises the SDK once, attaches global click
 * tracking, and makes the current user available to all analytics hooks
 * without prop-drilling.
 *
 * Usage (in main.tsx or App.tsx):
 *
 *   <AnalyticsProvider user={authenticatedUser}>
 *     <RouterProvider router={router} />
 *   </AnalyticsProvider>
 *
 * Then in any page component:
 *
 *   const { track, trackFunnelStep, trackClick } = useAnalytics({ pageName: '/dashboard' });
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { AnalyticsUser } from './analytics';
import { useAnalyticsInit } from './useAnalytics';

const AnalyticsContext = createContext<AnalyticsUser | null>(null);

interface AnalyticsProviderProps {
  user: AnalyticsUser | null;
  children: ReactNode;
}

export function AnalyticsProvider({ user, children }: AnalyticsProviderProps) {
  useAnalyticsInit(user);
  return (
    <AnalyticsContext.Provider value={user}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalyticsUser(): AnalyticsUser | null {
  return useContext(AnalyticsContext);
}
