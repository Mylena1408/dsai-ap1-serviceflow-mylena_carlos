export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type ValidationPathSegment = string | number;

export interface ValidationIssue {
  path: ValidationPathSegment[];
  code: string;
}

export interface ErrorResponseBody {
  error: {
    code: ApplicationErrorCode;
    message: string;
    issues?: ValidationIssue[];
  };
}

export interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
}

const PUBLIC_MESSAGES: Record<ApplicationErrorCode, string> = {
  VALIDATION_ERROR: "The submitted input is invalid.",
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "You are not allowed to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  CONFLICT: "The request conflicts with the current state.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

const STATUS_CODES: Record<ApplicationErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

const PUBLIC_VALIDATION_PATHS = new Set([
  "name",
  "email",
  "role",
  "sectorId",
  "description",
  "categoryId",
  "serviceId",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "attachments",
  "isRequired",
  "acceptedFormats",
  "note",
  "body",
]);

const PUBLIC_VALIDATION_CODES = new Set([
  "custom",
  "invalid_format",
  "invalid_type",
  "invalid_value",
  "too_big",
  "too_small",
  "unrecognized_keys",
]);

function sanitizeValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map(({ path, code }) => ({
    path: path.filter(
      (segment): segment is string =>
        typeof segment === "string" && PUBLIC_VALIDATION_PATHS.has(segment),
    ),
    code: PUBLIC_VALIDATION_CODES.has(code) ? code : "custom",
  }));
}

export class ApplicationError extends Error {
  constructor(readonly code: ApplicationErrorCode) {
    super(PUBLIC_MESSAGES[code]);
    this.name = new.target.name;
  }

  get status(): number {
    return STATUS_CODES[this.code];
  }
}

export class ValidationError extends ApplicationError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super("VALIDATION_ERROR");
    this.issues = sanitizeValidationIssues(issues);
  }
}

export class AuthenticationError extends ApplicationError {
  constructor() {
    super("UNAUTHENTICATED");
  }
}

export class AuthorizationError extends ApplicationError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class NotFoundError extends ApplicationError {
  constructor() {
    super("NOT_FOUND");
  }
}

export class ConflictError extends ApplicationError {
  constructor() {
    super("CONFLICT");
  }
}

export class InternalServerError extends ApplicationError {
  constructor() {
    super("INTERNAL_ERROR");
  }
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (!(error instanceof ApplicationError)) {
    const internalError = new InternalServerError();

    return {
      status: internalError.status,
      body: {
        error: {
          code: internalError.code,
          message: PUBLIC_MESSAGES[internalError.code],
        },
      },
    };
  }

  const response: ErrorResponse = {
    status: error.status,
    body: {
      error: {
        code: error.code,
        message: PUBLIC_MESSAGES[error.code],
      },
    },
  };

  if (error instanceof ValidationError) {
    response.body.error.issues = sanitizeValidationIssues(error.issues);
  }

  return response;
}
