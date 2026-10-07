// jsonwebtoken validates every option key that is *present* on the options
// object, so `expiresIn: undefined` (i.e. JWT_EXPIRES missing from .env) makes
// jwt.sign() throw "\"expiresIn\" should be a number of seconds or string
// representing a timespan", which turns a successful login into a 500. Only
// hand jsonwebtoken a value it can parse, otherwise fall back to the default
// lifetime instead of failing the request.
const DEFAULT_EXPIRES_IN = "90d";

const SECONDS = /^\d+$/;
const TIMESPAN = /^\d+(?:\.\d+)?\s*(?:ms|s|m|h|d|w|y)$/i;

const parseExpiresIn = (value) => {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const raw = value.trim();

  if (SECONDS.test(raw)) return Number(raw);
  if (TIMESPAN.test(raw)) return raw;

  return undefined;
};

const getJwtExpiresIn = () =>
  parseExpiresIn(process.env.JWT_EXPIRES) ?? DEFAULT_EXPIRES_IN;

module.exports = { getJwtExpiresIn, DEFAULT_EXPIRES_IN };
