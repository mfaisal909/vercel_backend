const express = require("express");
const Stripe = require("stripe");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

const router = express.Router();

const PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9]{10,}$/;
const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;
const PLACEHOLDER_PATTERN = /your[_-]?(new[_-]?)?(secret|publishable|api|public)?[_-]?key|xxx|changeme|placeholder/i;

const isUsableSecretKey = (key) =>
  SECRET_KEY_PATTERN.test(key) && !PLACEHOLDER_PATTERN.test(key);

const warned = new Set();
const warnOnce = (id, message) => {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[payment] ${message}`);
};

// The publishable key is public, so a missing/placeholder value must not break
// the whole frontend boot with a 500. Return "" instead: the client treats an
// empty key as "Stripe unavailable" and falls back to its own build-time key.
const getPublishableKey = () => {
  const key = (
    process.env.STRIPE_API_KEY ||
    process.env.STRIPE_PUBLIC_KEY ||
    ""
  ).trim();

  if (!key) {
    warnOnce(
      "publishable-key-missing",
      "STRIPE_API_KEY is not set in backend/config/.env, so /api/v2/payment/stripeapikey " +
        "returns an empty key and Stripe.js is not initialised. Add " +
        "STRIPE_API_KEY=pk_test_... (Developers > API keys) and restart the server."
    );
    return "";
  }

  if (!PUBLISHABLE_KEY_PATTERN.test(key) || PLACEHOLDER_PATTERN.test(key)) {
    warnOnce(
      "publishable-key-placeholder",
      "STRIPE_API_KEY in backend/config/.env is not a real Stripe publishable key, so " +
        "/api/v2/payment/stripeapikey returns an empty key. Replace the placeholder with " +
        "the pk_test_... key from your Stripe dashboard (Developers > API keys) and " +
        "restart the server."
    );
    return "";
  }

  return key;
};

const getStripe = () => {
  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secretKey) {
    throw new ErrorHandler(
      "STRIPE_SECRET_KEY is not configured in backend/config/.env. " +
        "Add STRIPE_SECRET_KEY=sk_test_... (Developers > API keys) and restart the server.",
      503
    );
  }

  if (!isUsableSecretKey(secretKey)) {
    throw new ErrorHandler(
      "STRIPE_SECRET_KEY in backend/config/.env is still a placeholder, not a real Stripe key. " +
        "Replace it with the sk_test_... secret key from your Stripe dashboard " +
        "(Developers > API keys) and restart the server.",
      503
    );
  }

  return Stripe(secretKey);
};

// ==================== CREATE PAYMENT INTENT ====================
router.post(
  "/process",
  catchAsyncErrors(async (req, res, next) => {
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
      return next(new ErrorHandler("Amount is required", 400));
    }

    const stripe = getStripe();

    let paymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount)),
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (error) {
      // Surface Stripe's own reason (bad/expired key, restricted key, etc.)
      // instead of letting an opaque 500 reach the browser.
      const isAuthProblem = error.statusCode === 401 || error.statusCode === 403;

      throw new ErrorHandler(
        isAuthProblem
          ? "Stripe rejected STRIPE_SECRET_KEY in backend/config/.env. " +
              "Copy the current sk_test_... secret key from your Stripe dashboard " +
              `(Developers > API keys) and restart the server. Stripe said: ${error.message}`
          : `Stripe could not create the payment: ${error.message}`,
        isAuthProblem ? 503 : 502
      );
    }

    res.status(201).json({
      success: true,
      client_secret: paymentIntent.client_secret,
    });
  })
);

// A publishable key alone cannot charge a card: /payment/process also needs a
// usable STRIPE_SECRET_KEY. Report both so the client can hide the card form
// instead of letting the user fill it in and then fail.
const cardPaymentsEnabled = () =>
  Boolean(getPublishableKey()) && isUsableSecretKey((process.env.STRIPE_SECRET_KEY || "").trim());

// ==================== GET STRIPE PUBLISHABLE KEY ====================
router.get(
  "/stripeapikey",
  catchAsyncErrors(async (req, res, next) => {
    res.status(200).json({
      stripeApikey: getPublishableKey(),
      cardPaymentsEnabled: cardPaymentsEnabled(),
    });
  })
);

module.exports = router;