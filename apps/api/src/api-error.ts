import { type ApiErrorCode, apiErrorResponseSchema } from "@recipestock/schemas";

type ApiErrorOptions = {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
};

export const apiErrorResponse = ({ status, code, message, details }: ApiErrorOptions) =>
  Response.json(
    apiErrorResponseSchema.parse({
      error: {
        code,
        message,
        details,
      },
    }),
    { status },
  );

export const unauthorizedResponse = () =>
  apiErrorResponse({
    status: 401,
    code: "unauthorized",
    message: "Authentication is required.",
  });

export const validationFailedResponse = (details: unknown) =>
  apiErrorResponse({
    status: 400,
    code: "validation_failed",
    message: "Request validation failed.",
    details,
  });

export const invalidRecipeListCursorResponse = () =>
  apiErrorResponse({
    status: 400,
    code: "invalid_recipe_list_cursor",
    message: "Recipe list cursor is invalid.",
  });

export const alreadySubscribedResponse = () =>
  apiErrorResponse({
    status: 409,
    code: "already_subscribed",
    message: "User already has an active Pro subscription.",
  });

export const recipeLimitExceededResponse = () =>
  apiErrorResponse({
    status: 403,
    code: "recipe_limit_exceeded",
    message: "Recipe limit exceeded.",
  });

export const invalidUrlResponse = () =>
  apiErrorResponse({
    status: 400,
    code: "invalid_url",
    message: "Import URL is invalid.",
  });

export const fetchFailedResponse = () =>
  apiErrorResponse({
    status: 502,
    code: "fetch_failed",
    message: "Import URL could not be fetched.",
  });

export const unsupportedPageResponse = () =>
  apiErrorResponse({
    status: 422,
    code: "unsupported_page",
    message: "Import page is not supported.",
  });

export const extractionFailedResponse = () =>
  apiErrorResponse({
    status: 422,
    code: "extraction_failed",
    message: "Recipe text could not be extracted.",
  });

export const aiUsageLimitExceededResponse = () =>
  apiErrorResponse({
    status: 429,
    code: "ai_usage_limit_exceeded",
    message: "AI usage limit exceeded.",
  });

export const rateLimitExceededResponse = () =>
  apiErrorResponse({
    status: 429,
    code: "rate_limit_exceeded",
    message: "Rate limit exceeded.",
  });

export const aiTimeoutResponse = () =>
  apiErrorResponse({
    status: 504,
    code: "ai_timeout",
    message: "AI normalization timed out.",
  });

export const aiSchemaInvalidResponse = () =>
  apiErrorResponse({
    status: 502,
    code: "ai_schema_invalid",
    message: "AI response schema was invalid.",
  });

export const lockedRecipeResponse = () =>
  apiErrorResponse({
    status: 403,
    code: "locked_recipe",
    message: "Recipe is locked.",
  });

export const notFoundResponse = (message = "Resource was not found.") =>
  apiErrorResponse({
    status: 404,
    code: "not_found",
    message,
  });

export const forbiddenResponse = (message = "Access is forbidden.") =>
  apiErrorResponse({
    status: 403,
    code: "forbidden",
    message,
  });

export const invalidImageTypeResponse = () =>
  apiErrorResponse({
    status: 400,
    code: "invalid_image_type",
    message: "Image type is not supported.",
  });

export const imageTooLargeResponse = () =>
  apiErrorResponse({
    status: 400,
    code: "image_too_large",
    message: "Image is too large.",
  });

export const imageFinalizeFailedResponse = () =>
  apiErrorResponse({
    status: 422,
    code: "image_finalize_failed",
    message: "Image could not be saved.",
  });

export const unknownResponse = () =>
  apiErrorResponse({
    status: 500,
    code: "unknown",
    message: "Unexpected error occurred.",
  });
