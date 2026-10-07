const app = require("./app");
const connectDatabase = require("./db/Database");
const initSocketServer = require("./socket");
const path = require("path");

process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("Shutting down the server due to uncaught exception");
  process.exit(1);
});

if (process.env.NODE_ENV !== "PRODUCTION") {
  require("dotenv").config({
    path: path.join(__dirname, "config", ".env"),
  });
}

connectDatabase();

const server = app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});

// The seller inbox used to talk to a separate socket.io host that no longer
// resolves, so realtime messaging is served by this process instead. The
// origins must mirror the two accepted by the Express CORS config in app.js.
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

initSocketServer(server, {
  corsOrigin: [frontendUrl, frontendUrl.replace(/^http:/, "https:")],
});

process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("Shutting down the server due to unhandled promise rejection");

  server.close(() => {
    process.exit(1);
  });
});
