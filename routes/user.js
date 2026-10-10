const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../model/user");
const { upload } = require("../multer");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isAdmin, optionalAuth } = require("../middleware/auth");
const sendMail = require("../utils/sendMail");
const { userActivationTemplate } = require("../utils/mailTemplates");

const router = express.Router();

// Outside production the activation link is echoed back in the response, the
// same way routes/shop.js does it, so a local signup is never blocked on SMTP.
const isProduction = process.env.NODE_ENV === "PRODUCTION";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const activationLinkFor = (userId) => {
  const token = jwt.sign({ id: userId }, process.env.ACTIVATION_SECRET, {
    expiresIn: "1d",
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  return `${frontendUrl}/activation/${token}`;
};

// Shared by registration and resend so both build exactly the same link and
// report SMTP failure the same way, the way routes/shop.js already does.
const sendActivationMail = async (user) => {
  const activationUrl = activationLinkFor(user._id);

  // The template ships a real HTML body plus a plain-text alternative. A
  // text-only mail that is little more than a bare URL is exactly what spam
  // filters score highest, which is how a send the SMTP server accepted
  // still never showed up in the inbox.
  const { subject, text, html } = userActivationTemplate({
    userName: user.name,
    activationUrl,
    expiresIn: process.env.USER_ACTIVATION_EXPIRES_IN || "24 hours",
  });

  let emailSent = true;
  let failureReason = "";

  try {
    await sendMail({
      email: user.email,
      subject,
      message: text,
      html,
    });
  } catch (mailError) {
    console.error("User activation email failed:", mailError);
    emailSent = false;
    failureReason = mailError?.message || "Unknown mail error";
  }

  return {
    emailSent,
    // The reason is logged rather than echoed: SMTP error strings can contain
    // the host and the authenticated mailbox, and this response is public.
    ...(emailSent ? {} : { mailError: failureReason }),
    // The link travels in the response only outside production.
    ...(isProduction ? {} : { activationUrl }),
  };
};

// Registration stores the address exactly as typed, so a resend has to fall
// back to a case-insensitive match or "Name@Gmail.com" would 404.
const findUserByEmail = async (rawEmail) => {
  const email = String(rawEmail).trim();
  if (!email) return null;

  const exact = await User.findOne({ email });
  if (exact) return exact;

  return User.findOne({
    email: { $regex: `^${escapeRegex(email)}$`, $options: "i" },
  });
};

// ==================== CREATE USER ====================
router.post(
  "/create-user",
  upload.single("file"),
  catchAsyncErrors(async (req, res, next) => {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return next(new ErrorHandler("Please fill all fields", 400));
    }

    if (!req.file) {
      return next(new ErrorHandler("Please upload an avatar image", 400));
    }

    // Check if user exists
    const userEmail = await User.findOne({ email });
    if (userEmail) {
      return next(new ErrorHandler("User already exists", 400));
    }

    // Create user
    const filename = req.file.filename;
    const fileUrl = `uploads/${filename}`;
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const user = await User.create({
      name,
      email,
      password,
      avatar: {
        public_id: filename.replace(/\.[^.]+$/, ""),
        url: `${baseUrl}/${fileUrl}`,
      },
    });

    const { emailSent, activationUrl, mailError } = await sendActivationMail(
      user
    );

    res.status(201).json({
      success: true,
      emailSent,
      message: emailSent
        ? "User created successfully. Verification email sent."
        : "User created successfully, but verification email could not be sent. Use resend verification to try again.",
      ...(mailError ? { mailError } : {}),
      ...(activationUrl ? { activationUrl } : {}),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  })
);

// ==================== RESEND ACTIVATION ====================
// A registration whose one mail failed or was filtered left an orphaned,
// unverified account that could never receive another mail: retrying the
// signup only answered "User already exists".
router.post(
  "/resend-activation",
  catchAsyncErrors(async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorHandler("Email is required", 400));
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return next(new ErrorHandler("Account not found with this email", 404));
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "This account is already verified. Please log in.",
      });
    }

    const { emailSent, activationUrl, mailError } = await sendActivationMail(
      user
    );

    res.status(200).json({
      success: true,
      emailSent,
      message: emailSent
        ? `Verification email sent to ${user.email}. Check the spam folder if it has not arrived within a few minutes.`
        : "The verification email could not be sent. Please try again in a few minutes.",
      ...(mailError ? { mailError } : {}),
      ...(activationUrl ? { activationUrl } : {}),
    });
  })
);

// ==================== LOGIN USER ====================
router.post(
  "/login-user",
  catchAsyncErrors(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new ErrorHandler("Please enter email and password", 400));
    }

    const user = await User.findOne({ email }).select("+password");

    // The same message and status are used whether the account is unknown or the
    // password is wrong, so the response cannot be used to find out which
    // emails are registered.
    if (!user) {
      return next(new ErrorHandler("Invalid email or password", 401));
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return next(new ErrorHandler("Invalid email or password", 401));
    }

    // Authenticated routes (isAuthenticated) read the "token" cookie, so it has
    // to be set here. The response is sanitised below because the document was
    // loaded with .select("+password") and would otherwise leak the hash.
    const token = user.getJwtToken();

    res.cookie("token", token, {
      expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      httpOnly: true,
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  })
);

// ==================== LOGOUT USER ====================
router.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// ==================== GET USER ====================
// Returns the account that owns the session cookie, or null when nobody is
// signed in. It used to be behind isAuthenticated, but every visitor calls it
// on page load, so a signed-out page load answered 401 and filled the browser
// console with Unauthorized errors. It also used to return User.findOne()
// regardless of the session, which made every visitor look logged in and
// produced 401s on authenticated routes such as
// GET /order/get-all-orders/:userId.
router.get(
  "/getuser",
  optionalAuth,
  catchAsyncErrors(async (req, res) => {
    res.status(200).json({
      success: true,
      user: req.user || null,
    });
  })
);

// ==================== GET USER INFORMATION BY ID ====================
// The seller inbox renders the buyer side of a conversation (name + avatar)
// by fetching the other member of `members`. This route used to exist only in
// the never-mounted controller/user.js copy, so every call answered 404.
// It is public because a signed-in seller resolves a buyer they have no
// session for, and only the display fields are returned.
router.get(
  "/user-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(new ErrorHandler("User not found", 404));
    }

    const user = await User.findById(req.params.id).select("name avatar");

    // An old conversation is kept even after its buyer account is removed, and
    // the inbox still renders that thread (name + avatar). Answering 404 there
    // only produced a failed request the UI already knows how to display, so a
    // missing account resolves to a neutral placeholder instead.
    if (!user) {
      return res.status(200).json({
        success: true,
        deleted: true,
        user: {
          _id: req.params.id,
          name: "Deleted user",
          avatar: null,
        },
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  })
);

// ==================== UPDATE USER INFORMATION ====================
router.put(
  "/update-user-info",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { name, email, phoneNumber, password } = req.body;
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    if (!name || !name.trim()) {
      return next(new ErrorHandler("Please fill all fields", 400));
    }

    if (!email || !email.trim()) {
      return next(new ErrorHandler("Please fill all fields", 400));
    }

    if (phoneNumber != null && !String(phoneNumber).trim()) {
      return next(new ErrorHandler("Please provide a valid phone number", 400));
    }

    if (password && password.length < 4) {
      return next(
        new ErrorHandler("Password should be greater than 4 characters", 400)
      );
    }

    user.name = name;
    user.email = email;
    user.phoneNumber = phoneNumber != null ? String(phoneNumber).trim() : user.phoneNumber;
    if (password) {
      user.password = password;
    }
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: userResponse,
    });
  })
);

// ==================== UPDATE USER PASSWORD ====================
router.put(
  "/update-user-password",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    if (!oldPassword || !newPassword || !confirmPassword) {
      return next(new ErrorHandler("Please fill all password fields", 400));
    }

    if (newPassword.length < 6) {
      return next(new ErrorHandler("Password should be greater than 6 characters", 400));
    }

    if (newPassword !== confirmPassword) {
      return next(new ErrorHandler("New passwords do not match", 400));
    }

    const isPasswordValid = await user.comparePassword(oldPassword);
    if (!isPasswordValid) {
      return next(new ErrorHandler("Old password is incorrect", 400));
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  })
);

// ==================== UPDATE AVATAR ====================
router.put(
  "/update-avatar",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { avatar } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    if (!avatar || typeof avatar !== "string") {
      return next(new ErrorHandler("Avatar image is required", 400));
    }

    user.avatar = {
      public_id: "avatar-" + user._id,
      url: avatar,
    };
    await user.save();

    res.status(200).json({
      success: true,
      message: "Avatar updated successfully",
      user,
    });
  })
);

// ==================== USER ADDRESSES ====================
router.put(
  "/update-user-addresses",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { address1, address2, country, city, zipCode, addressType } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    if (!address1 || !country || !city || !zipCode || !addressType) {
      return next(new ErrorHandler("Please fill all address fields", 400));
    }

    user.addresses.push({ address1, address2, country, city, zipCode, addressType });
    await user.save();

    res.status(200).json({
      success: true,
      message: "Address added successfully",
      user,
    });
  })
);

router.delete(
  "/delete-user-address/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const user = await User.findById(req.user._id);

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    const addressExists = user.addresses.some(
      (address) => address._id.toString() === req.params.id
    );
    if (!addressExists) {
      return next(new ErrorHandler("Address not found", 404));
    }

    user.addresses = user.addresses.filter(
      (address) => address._id.toString() !== req.params.id
    );
    await user.save();

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      user,
    });
  })
);

router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    const { activation_token } = req.body;

    if (!activation_token) {
      return next(new ErrorHandler("Activation token is required", 400));
    }

    let decoded;
    try {
      decoded = jwt.verify(activation_token, process.env.ACTIVATION_SECRET);
    } catch (error) {
      return next(new ErrorHandler("Invalid or expired activation token", 400));
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "User already verified",
      });
    }

    user.isVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Account verified successfully",
    });
  })
);

// ==================== ALL USERS (ADMIN) ====================
// The frontend has a getAllUsers() action calling this, but the route only
// existed in the unmounted controller/user.js copy, so the admin list 404'd.
router.get(
  "/admin-all-users",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      users,
    });
  })
);

// ==================== SEND MESSAGE TO SHOP ====================
router.post(
  "/send-message",
  catchAsyncErrors(async (req, res, next) => {
    const { email, subject, message } = req.body;

    if (!email || !subject || !message) {
      return next(new ErrorHandler("Email, subject, and message are required", 400));
    }

    try {
      await sendMail({
        email,
        subject,
        message,
      });
    } catch (error) {
      return next(
        new ErrorHandler("Unable to send your message right now", 500)
      );
    }

    res.status(200).json({
      success: true,
      message: "Message sent successfully.",
    });
  })
);

module.exports = router;
