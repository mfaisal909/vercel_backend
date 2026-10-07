const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const cors = require("cors");

if (process.env.NODE_ENV !== "PRODUCTION") {
  require("dotenv").config({
    path: path.join(__dirname, "config", ".env"),
  });
}

const app = express();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

// Accept both schemes: the Vite dev server switches to https://localhost:5173
// when VITE_DEV_HTTPS=true (required for Stripe pk_live_ keys).
const allowedOrigins = new Set([
  frontendUrl,
  frontendUrl.replace(/^http:/, "https:"),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

// middlewares
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(bodyParser.urlencoded({ extended: true, limit: "20mb" }));

// routes
const userRouter = require("./routes/user");
const cartRouter = require("./routes/cart");
const shopRouter = require("./routes/shop");
const productRouter = require("./controller/product");
const eventRouter = require("./controller/event");
const couponRouter = require("./controller/coupounCode");
const paymentRouter = require("./routes/payment");
const orderRouter = require("./routes/order");
const conversationRouter = require("./controller/conversation");
const messageRouter = require("./controller/messages");
const shopReviewRouter = require("./controller/shopReview");

app.use("/api/v2/conversation", conversationRouter);
// Never mounted, so every GET /api/v2/message/... answered 404.
app.use("/api/v2/message", messageRouter);
// Ratings a buyer leaves on a shop from inside the chat inbox.
app.use("/api/v2/shop-review", shopReviewRouter);
app.use("/api/v2/user", userRouter);
app.use("/api/v2/cart", cartRouter);
app.use("/api/v2/shop", shopRouter);
app.use("/api/v2/product", productRouter);
app.use("/api/v2/event", eventRouter);
app.use("/api/v2/coupon", couponRouter);
app.use("/api/v2/payment", paymentRouter);
app.use("/api/v2/order", orderRouter);
// error middleware
const errorMiddleware = require("./middleware/error");
app.use(errorMiddleware);

module.exports = app;
