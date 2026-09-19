// src/lib/errors.ts
export class PharmacyServiceError extends Error {
  // Optional machine-readable code alongside the human-readable message
  // — most callers never set this and nothing breaks if they don't, but
  // it lets a specific frontend flow (e.g. login) distinguish "wrong
  // password" from "your trial expired" without parsing message text,
  // which breaks the moment the wording changes.
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PharmacyServiceError';
    this.code = code;
  }
}
