import { ERROR_DEFINITIONS, type ErrorCode } from "./error-code";

export interface FieldError {
  field: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly fieldErrors?: FieldError[];

  constructor(code: ErrorCode, detail?: string, fieldErrors?: FieldError[]) {
    const definition = ERROR_DEFINITIONS[code];
    super(detail ?? definition.title);
    this.name = "DomainError";
    this.code = code;
    this.status = definition.status;
    this.title = definition.title;
    this.fieldErrors = fieldErrors;
  }
}
