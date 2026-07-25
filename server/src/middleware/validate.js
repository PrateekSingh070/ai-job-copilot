export function validateBody(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    res.locals.validatedQuery = schema.parse(req.query);
    next();
  };
}
