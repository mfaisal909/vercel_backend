const express = require("express");
const router = express.Router();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");

const stripeClient = () => {
  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secretKey || secretKey.includes("your_secret_key")) {
    throw new ErrorHandler(
      "Stripe is not configured on the server. Set STRIPE_SECRET_KEY (sk_test_...) in backend/config/.env and restart the server.",
      500
    );
  }

  return require("stripe")(secretKey);
};

router.post(
  "/process",
  catchAsyncErrors(async (req, res, next) => {
    const stripe = stripeClient();

    const amount = Math.round(Number(req.body.amount));

    if (!Number.isInteger(amount) || amount < 50) {
      throw new ErrorHandler("Invalid payment amount.", 400);
    }

    let myPayment;

    try {
      myPayment = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        metadata: {
          company: "Becodemy",
        },
      });
    } catch (error) {
      throw new ErrorHandler(
        `Stripe rejected the payment: ${error.message}`,
        error.statusCode || 500
      );
    }

    res.status(200).json({
      success: true,
      client_secret: myPayment.client_secret,
    });
  })
);

router.get(
  "/stripeapikey",
  catchAsyncErrors(async (req, res, next) => {
    const publishableKey = (process.env.STRIPE_API_KEY || "").trim();

    res.status(200).json({
      stripeApikey:
        publishableKey && !publishableKey.includes("your_publishable_key")
          ? publishableKey
          : "",
    });
  })
);

module.exports = router;
