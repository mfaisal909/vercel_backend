const mongoose = require("mongoose");
const dns = require("dns");

const connectDatabase = async () => {
  try {
    const data = await mongoose.connect(process.env.TO_URL);
    console.log(`MongoDB is connected with server: ${data.connection.host}`);
  } catch (error) {
    // Some local DNS resolvers refuse the SRV/TXT lookups required by
    // mongodb+srv:// URLs, surfacing as "querySrv ECONNREFUSED". Retry once
    // against public resolvers that do support those record types.
    if (error && /querySrv|queryTxt/i.test(error.message)) {
      try {
        dns.setServers(["1.1.1.1", "8.8.8.8"]);
        const data = await mongoose.connect(process.env.TO_URL);
        console.log(`MongoDB is connected with server: ${data.connection.host}`);
        return;
      } catch (retryError) {
        console.log("Database connection error:", retryError.message);
        process.exit(1);
      }
    }
    console.log("Database connection error:", error.message);
    process.exit(1);
  }
};

module.exports = connectDatabase;
