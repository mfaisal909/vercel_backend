const mongoose = require("mongoose");

const connectDatabase = async () => {
  try {
    const data = await mongoose.connect(process.env.TO_URL);
    console.log(`MongoDB is connected with server: ${data.connection.host}`);
  } catch (error) {
    console.log("Database connection error:", error.message);
    process.exit(1);
  }
};

module.exports = connectDatabase;
