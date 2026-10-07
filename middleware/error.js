const ErrorHandler = require("../utils/ErrorHandler");

module.exports = (err, req, res, next) => {
  // Set default status and message
  err.statusCode = err.statusCode || 500;
  err.message = err.message || "Internal server error";

  // Handle Mongoose validation error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map(val => val.message)
      .join(", ");
    err = new ErrorHandler(message, 400);
  }

  // Handle CastError
  if (err.name === "CastError") {
    const message = `Resource not found. Invalid ${err.path}`;
    err = new ErrorHandler(message, 400);
  }

  // Handle duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists`;
    err = new ErrorHandler(message, 400);
  }

  // Handle JWT errors
  if (err.name === "JsonWebTokenError") {
    const message = `Invalid token, please try again`;
    err = new ErrorHandler(message, 400);
  }

  if (err.name === "TokenExpiredError") {
    const message = `Token expired, please try again later`;
    err = new ErrorHandler(message, 400);
  }

  // Send error response
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
};


