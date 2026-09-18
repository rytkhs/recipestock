import {
  type CreateBillingPortalResponse,
  type CreateCheckoutResponse,
  type GetBillingStatusResponse,
  type GetProPriceResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

export const billingStatusQueryKey = ["billing-status"] as const;

// 値段は誰が見ても同じなので、ログアウトで消すキャッシュには入れない。
export const proPriceQueryKey = ["billing-pro-price"] as const;

export const fetchBillingStatus = () =>
  parseApiResponse<GetBillingStatusResponse>(api.api.billing.status.$get());

export const fetchProPrice = () =>
  parseApiResponse<GetProPriceResponse>(api.api.billing["pro-price"].$get());

export const createCheckout = () =>
  parseApiResponse<CreateCheckoutResponse>(api.api.billing.checkout.$post());

export const createBillingPortal = () =>
  parseApiResponse<CreateBillingPortalResponse>(api.api.billing.portal.$post());

// StripeのCheckoutと契約の管理画面へは、ページごと移る。テストで差し替えられるようにここに置く。
export const billingRedirect = {
  assign(url: string) {
    window.location.assign(url);
  },
};
