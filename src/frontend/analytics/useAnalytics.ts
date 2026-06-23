/**
 * useAnalytics — React hook wrapping the CollectRx Analytics SDK.
 *
 * Drop this into any component or page to get:
 *   - Automatic page view tracking on mount
 *   - Automatic page exit + duration on unmount
 *   - track() for custom events
 *   - trackFunnelStep() for funnel drop-off analysis
 *   - ref-based click tracking (optional, or use global click capture)
 */

import { useEffect, useCallback, useRef } from 'react';
import { analytics, AnalyticsUser, EventType, AnalyticsEvent } from './analytics';

// ---------------------------------------------------------------------------
// Provider-level init hook
// Wrap your <App /> with <AnalyticsProvider> instead of calling this directly.
// ---------------------------------------------------------------------------

export function useAnalyticsInit(user: AnalyticsUser | null): void {
  useEffect(() => {
    analytics.start();
    analytics.enableClickTracking();
    analytics.trackInitialPage();

    return () => {
      analytics.stop();
    };
  }, []); // once on mount

  useEffect(() => {
    if (user) {
      analytics.identify(user);
    }
  }, [user]);
}

// ---------------------------------------------------------------------------
// Per-page hook
// Call at the top of each page/route component.
// ---------------------------------------------------------------------------

interface UseAnalyticsOptions {
  /** Explicit page name override (defaults to window.location.pathname). */
  pageName?: string;
  /** Extra metadata attached to all events from this page. */
  meta?: Record<string, string | number | boolean>;
}

interface UseAnalyticsReturn {
  /** Fire a named custom event. */
  track: (eventType: EventType, overrides?: Partial<AnalyticsEvent>) => void;
  /** Record a step in a named funnel. */
  trackFunnelStep: (
    funnelName: string,
    stepName: string,
    stepIndex: number,
    meta?: Record<string, string | number | boolean>
  ) => void;
  /** Wrap a click handler to also fire a click event with a label. */
  trackClick: (label: string, handler?: () => void) => () => void;
}

export function useAnalytics(options: UseAnalyticsOptions = {}): UseAnalyticsReturn {
  const { pageName, meta } = options;
  const enterTime = useRef(Date.now());
  const path = pageName ?? window.location.pathname;

  useEffect(() => {
    enterTime.current = Date.now();
    analytics.track('page_view', { path, meta });

    return () => {
      const durationMs = Date.now() - enterTime.current;
      analytics.track('page_exit', { path, durationMs, meta });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const track = useCallback(
    (eventType: EventType, overrides?: Partial<AnalyticsEvent>) => {
      analytics.track(eventType, { path, meta, ...overrides });
    },
    [path, meta]
  );

  const trackFunnelStep = useCallback(
    (
      funnelName: string,
      stepName: string,
      stepIndex: number,
      stepMeta?: Record<string, string | number | boolean>
    ) => {
      analytics.trackFunnelStep(funnelName, stepName, stepIndex, {
        ...meta,
        ...stepMeta,
      });
    },
    [meta]
  );

  const trackClick = useCallback(
    (label: string, handler?: () => void) => {
      return () => {
        analytics.track('click', {
          path,
          elementLabel: label,
          elementType: 'button',
          meta,
        });
        handler?.();
      };
    },
    [path, meta]
  );

  return { track, trackFunnelStep, trackClick };
}

// ---------------------------------------------------------------------------
// Funnel hook — tracks a multi-step user journey
// ---------------------------------------------------------------------------

interface UseFunnelOptions {
  funnelName: string;
  steps: string[];
}

interface UseFunnelReturn {
  currentStep: number;
  advanceTo: (stepIndex: number, meta?: Record<string, string | number | boolean>) => void;
  advance: (meta?: Record<string, string | number | boolean>) => void;
}

export function useFunnel(options: UseFunnelOptions): UseFunnelReturn {
  const { funnelName, steps } = options;
  const currentStep = useRef(0);

  const advanceTo = useCallback(
    (stepIndex: number, meta?: Record<string, string | number | boolean>) => {
      if (stepIndex >= steps.length) return;
      currentStep.current = stepIndex;
      analytics.trackFunnelStep(funnelName, steps[stepIndex], stepIndex, meta);
    },
    [funnelName, steps]
  );

  const advance = useCallback(
    (meta?: Record<string, string | number | boolean>) => {
      advanceTo(currentStep.current + 1, meta);
    },
    [advanceTo]
  );

  // Track entry to step 0 automatically
  useEffect(() => {
    advanceTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { currentStep: currentStep.current, advanceTo, advance };
}
