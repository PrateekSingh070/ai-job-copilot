// The HTTP contract in one file: how errors are raised and how every response
// is shaped. Route handlers throw `ApiError`; `errorHandler` turns it into a
// `sendError` call, so success and failure always share the same envelope.

export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function sendSuccess(res, data, status = 200, meta) {
  return res.status(status).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendError(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}
