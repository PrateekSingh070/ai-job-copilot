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
