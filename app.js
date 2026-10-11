
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const cors = require("cors");

// Load local environment variables before anything reads process.env, and only
// outside production. On Vercel (NODE_ENV=PRODUCTION) the values come from the
// platform environment instead. __dirname keeps the path correct whether the
// backend is started from the backend/ folder or from the repo root.
if (process.env.NODE_ENV !== "PRODUCTION") {
  require("dotenv").config({
    path: path.join(__dirname, "config", ".env"),
  });
}

const connectDatabase = require("./db/Database");

const app = express();


app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});


// Allowed frontend origins. The exact deployed frontend is always allowed so a
// fresh Vercel backend deployment works even before FRONTEND_URL is added to
// the backend project, and FRONTEND_URL can list extra origins (comma
// separated) such as http://localhost:5173 during development.
const allowedOrigins = new Set();

const addAllowedOrigin = (value) => {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return;
  allowedOrigins.add(trimmed);
  allowedOrigins.add(trimmed.replace(/^http:/, "https:"));
};

addAllowedOrigin("https://frontend-project-blush-delta.vercel.app");
(process.env.FRONTEND_URL || "")
  .split(",")
  .forEach(addAllowedOrigin);

app.getFrontendOrigins = () => Array.from(allowedOrigins);

// CORS runs before every route, so preflight (OPTIONS) and credentialed
// requests coming from the frontend receive the correct headers. Requests from
// origins not listed above are refused by omitting the CORS headers, which the
// browser enforces; the server never hands out Access-Control-Allow-Origin: *.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ""))) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
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
  express.static(path.join(__dirname, "../uploads"))
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

// Connect MongoDB. app.js is the serverless entry Vercel runs (see
// backend/vercel.json), while server.js is only used for local development, so
// the connection must live here or every query on Vercel would sit in the
// buffer until Mongoose reports "buffering timed out after 10000ms".
connectDatabase();

// Export Express app
module.exports = app;
