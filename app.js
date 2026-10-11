
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const cors = require("cors");

// Project directory
const _dirname = path.resolve();

// Load local environment variables
if (process.env.NODE_ENV !== "PRODUCTION") {
  require("dotenv").config({
    path: path.join(_dirname, "config", ".env"),
  });
}

const app = express();


app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});


// Frontend URL
const frontendUrl =
  process.env.FRONTEND_URL || "http://localhost:5173";

// Allowed frontend origins
const allowedOrigins = new Set([
  frontendUrl.replace(/\/$/, ""),
  frontendUrl
    .replace(/^http:/, "https:")
    .replace(/\/$/, ""),
]);

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.has(origin.replace(/\/$/, ""))
      ) {
        return callback(null, true);
      }

      return callback(
        new Error(`Origin ${origin} is not allowed by CORS`)
      );
    },
    credentials: true,
  })
);

// Middlewares
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());
app.use(
  bodyParser.urlencoded({
    extended: true,
    limit: "20mb",
  })
);

// Static uploads
app.use(
  "/uploads",
  express.static(path.join(_dirname, "../uploads"))
);

// Import routes
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

// API routes
app.use("/api/v2/conversation", conversationRouter);
app.use("/api/v2/message", messageRouter);
app.use("/api/v2/shop-review", shopReviewRouter);
app.use("/api/v2/user", userRouter);
app.use("/api/v2/cart", cartRouter);
app.use("/api/v2/shop", shopRouter);
app.use("/api/v2/product", productRouter);
app.use("/api/v2/event", eventRouter);
app.use("/api/v2/coupon", couponRouter);
app.use("/api/v2/payment", paymentRouter);
app.use("/api/v2/order", orderRouter);

// Backend home route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend API is running",
  });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Error middleware
const errorMiddleware = require("./middleware/error");
app.use(errorMiddleware);

// Export Express app
module.exports = app;
