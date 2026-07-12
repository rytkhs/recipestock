import {
  type CreateIosShareChannelResponse,
  type DeliverIosShareHandoffResponse,
  type GetPendingIosShareHandoffResponse,
  type ListIosShareChannelsResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

export const createIosShareChannel = (name: string): Promise<CreateIosShareChannelResponse> =>
  parseApiResponse(
    api.api["ios-share"].channels.$post({
      json: { name },
    }),
  );

export const listIosShareChannels = (): Promise<ListIosShareChannelsResponse> =>
  parseApiResponse(api.api["ios-share"].channels.$get());

export const revokeIosShareChannel = async (channelId: string): Promise<void> => {
  await parseApiResponse(
    api.api["ios-share"].channels[":channelId"].$delete({
      param: { channelId },
    }),
  );
};

export const fetchPendingIosShareHandoff = (): Promise<GetPendingIosShareHandoffResponse> =>
  parseApiResponse(api.api["ios-share"].handoffs.pending.$get());

export const deliverIosShareHandoff = (
  handoffId: string,
  target: "pwa" | "browser",
): Promise<DeliverIosShareHandoffResponse> =>
  parseApiResponse(
    api.api["ios-share"].handoffs[":handoffId"].delivery.$patch({
      param: { handoffId },
      json: { target },
    }),
  );
