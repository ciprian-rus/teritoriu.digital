const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s]+/gi,
  /sb_(?:secret|publishable)_[A-Za-z0-9._-]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
];

export class AcquisitionError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AcquisitionError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }
}

export function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[redacted]");
  }
  return message.slice(0, 500);
}
