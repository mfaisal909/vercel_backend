const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getJwtExpiresIn } = require("../utils/jwtExpires");

const userSchema = new mongoose.Schema({
  name:{
    type: String,
    required: [true, "Please enter your name!"],
  },
  email:{
    type: String,
    required: [true, "Please enter your email!"],
  },
  password:{
    type: String,
    required: [true, "Please enter your password"],
    minLength: [4, "Password should be greater than 4 characters"],
    select: false,
  },
  phoneNumber:{
    type: String,
  },
  addresses:[
    {
      country: {
        type: String,
      },
      city:{
        type: String,
      },
      address1:{
        type: String,
      },
      address2:{
        type: String,
      },
      zipCode:{
        type: Number,
      },
      addressType:{
        type: String,
      },
    }
  ],
  role:{
    type: String,
    default: "user",
  },
  avatar:{
    public_id: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
 },
 createdAt:{
  type: Date,
  default: Date.now(),
 },
  resetPasswordToken: String,
  resetPasswordTime: Date,
  // Set by POST /activation. The field has to exist in the schema: mongoose
  // strict mode silently drops assignments to fields that are not declared, so
  // without this the verification link reported success and saved nothing.
  isVerified: {
    type: Boolean,
    default: false,
  },
});


//  Hash password
userSchema.pre("save", async function (){
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

// jwt token
userSchema.methods.getJwtToken = function () {
  return jwt.sign({ id: this._id}, process.env.JWT_SECRET_KEY,{
    expiresIn: getJwtExpiresIn(),
  });
};

// compare password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);