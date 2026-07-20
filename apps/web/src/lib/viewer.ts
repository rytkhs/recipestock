import { type GetMeResponse } from "@recipestock/schemas";
import { useQuery } from "@tanstack/react-query";
import { api, parseApiResponse } from "./api";

export const viewerQueryKey = ["viewer"] as const;

export const fetchViewer = () => parseApiResponse<GetMeResponse>(api.api.me.$get());

export const useViewer = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: viewerQueryKey,
    queryFn: fetchViewer,
    enabled,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
