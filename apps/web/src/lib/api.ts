import { type AppType } from "@recipestock/api";
import {
  type ApiErrorCode,
  type ApiErrorResponse,
  apiErrorResponseSchema,
} from "@recipestock/schemas";
import { hc } from "hono/client";

export const api = hc<AppType>("/", {
  init: {
    credentials: "include",
  },
});

type ApiClientErrorOptions = {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor({ status, code, message, details }: ApiClientErrorOptions) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ApiResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

const parseErrorResponse = async (response: ApiResponseLike): Promise<ApiErrorResponse> => {
  const body = await response.json().catch(() => null);
  const result = apiErrorResponseSchema.safeParse(body);

  if (!result.success) {
    return {
      error: {
        code: "unexpected_response",
        message: "Unexpected API error response.",
      },
    };
  }

  return result.data;
};

export const parseApiResponse = async <T>(response: Promise<ApiResponseLike>) => {
  const resolvedResponse = await response;

  if (!resolvedResponse.ok) {
    const body = await parseErrorResponse(resolvedResponse);
    throw new ApiClientError({
      status: resolvedResponse.status,
      code: body.error.code,
      message: body.error.message,
      details: body.error.details,
    });
  }

  return (await resolvedResponse.json()) as T;
};
