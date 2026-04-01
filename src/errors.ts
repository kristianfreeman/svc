export class SvcError extends Error {
  constructor(message: string, readonly details?: string[]) {
    super(message);
    this.name = "SvcError";
  }
}

export function formatError(error: unknown): string {
  if (error instanceof SvcError && error.details && error.details.length > 0) {
    return `${error.message}\n${error.details.map((detail) => `- ${detail}`).join("\n")}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
