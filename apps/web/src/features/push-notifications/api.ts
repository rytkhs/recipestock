import {
  type GetPushSubscriptionsResponse,
  type PushSubscriptionRequest,
  type RegisterPushSubscriptionResponse,
  type RevokePushSubscriptionResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

export const getPushSubscriptions = () =>
  parseApiResponse<GetPushSubscriptionsResponse>(api.api["push-subscriptions"].$get());

export const pushSubscriptionsQueryKey = ["push-subscriptions"] as const;

export const registerPushSubscription = (subscription: PushSubscriptionRequest) =>
  parseApiResponse<RegisterPushSubscriptionResponse>(
    api.api["push-subscriptions"].$post({ json: subscription }),
  );

export const revokePushSubscription = (endpoint: string) =>
  parseApiResponse<RevokePushSubscriptionResponse>(
    api.api["push-subscriptions"].$delete({ json: { endpoint } }),
  );
