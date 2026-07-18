import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const TILE_TYPES = ["occupancy", "current-revenue", "units", "potential-revenue"] as const;

async function apiFetch(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Prefetch failed: ${url}`);
  return res.json();
}

export function usePrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const prefetch = async () => {
      await Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: ["/api/overview"],
          queryFn: () => apiFetch("/api/overview"),
          staleTime: Infinity,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/locations"],
          queryFn: () => apiFetch("/api/locations"),
          staleTime: Infinity,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/series", "12M"],
          queryFn: () => apiFetch("/api/series?timeRange=12M"),
          staleTime: Infinity,
        }),
        ...TILE_TYPES.map((tileType) =>
          queryClient.prefetchQuery({
            queryKey: ["/api/tile-details", tileType],
            queryFn: () => apiFetch(`/api/tile-details/${tileType}`),
            staleTime: Infinity,
          })
        ),
        queryClient.prefetchQuery({
          queryKey: ["/api/analytics/campus-metrics", "all", "all", "all"],
          queryFn: () => apiFetch("/api/analytics/campus-metrics"),
          staleTime: Infinity,
        }),
        // Warm the strategy overview commentary so the Pricing Controls page
        // loads instantly for the default (unfiltered) view.
        queryClient.prefetchQuery({
          queryKey: ["/api/pricing-controls/commentary", "All", "", "", ""],
          queryFn: () => apiFetch("/api/pricing-controls/commentary"),
          staleTime: 30 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/adjustment-rules", "", ""],
          queryFn: () => apiFetch("/api/adjustment-rules"),
          staleTime: 5 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/adjustment-rules/combined-stats"],
          queryFn: () => apiFetch("/api/adjustment-rules/combined-stats"),
          staleTime: 5 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/pricing-controls/competitive-position"],
          queryFn: () => apiFetch("/api/pricing-controls/competitive-position"),
          staleTime: 10 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/guardrails"],
          queryFn: () => apiFetch("/api/guardrails"),
          staleTime: 5 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/locations/service-lines"],
          queryFn: () => apiFetch("/api/locations/service-lines"),
          staleTime: 5 * 60 * 1000,
        }),
      ]);
    };

    prefetch();
  }, [queryClient]);
}
