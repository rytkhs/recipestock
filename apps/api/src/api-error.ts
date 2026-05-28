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

export const recipeLimitExceededResponse = () =>
  apiErrorResponse({
    status: 403,
    code: "recipe_limit_exceeded",
    message: "Recipe limit exceeded.",
  });

export const notFoundResponse = (message = "Resource was not found.") =>
  apiErrorResponse({
    status: 404,
    code: "not_found",
    message,
  });
