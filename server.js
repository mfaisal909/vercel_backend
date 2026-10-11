const app = require("./app");
const initSocketServer = require("./socket");

process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("Shutting down the server due to uncaught exception");
  process.exit(1);
});

// app.js loads the local environment (backend/config/.env) and connects
// MongoDB, so this process only has to listen and serve socket.io.

const server = app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});

// The seller inbox used to talk to a separate socket.io host that no longer
// resolves, so realtime messaging is served by this process instead. The
// origins mirror the ones accepted by the Express CORS config in app.js.
initSocketServer(server, {
  corsOrigin: app.getFrontendOrigins ? app.getFrontendOrigins() : [],
});

process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("Shutting down the server due to unhandled promise rejection");

  server.close(() => {
    process.exit(1);
  });
});