const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");

const { isSeller, optionalSellerAuth } = require("../middleware/auth");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const Shop = require("../model/shop");
const sendMail = require("../utils/sendMail");
const sendShopToken = require("../utils/shopToken");
const {
  createShopActivationToken,
  verifyShopActivationToken,
} = require("../utils/shopActivationToken");
const { shopActivationTemplate } = require("../utils/mailTemplates");

const router = express.Router();

const frontendUrl = () => process.env.FRONTEND_URL || "http://localhost:5173";

// The activation link is only emailed, so a seller who never receives the mail
// (spam folder, SMTP down) would be locked out of their own shop with no way
// forward. Outside production the link is echoed back in the response, which is
// what the login page renders as a "development only" shortcut.
const isProduction = process.env.NODE_ENV === "PRODUCTION";

const activationLinkFor = (shopId) =>
  `${frontendUrl()}/seller/activation/${createShopActivationToken(shopId)}`;

// The shop schema requires an avatar with a public_id and a url, and the browser
// only sends the picked file as a data URI. The image is written to
// uploads/avatars and stored as a root-relative url, which resolveImageUrl() on
// the frontend resolves against the backend origin. Same approach as
// uploadProductImage() in controller/product.js.
const storeAvatar = (dataUrl) => {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || "");

  if (!match) {
    throw new Error("Shop avatar must be an image");
  }

  const extension = match[1].split("/")[1].replace("jpeg", "jpg");
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const directory = path.join(__dirname, "../../uploads/avatars");

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), match[2], "base64");

  return {
    public_id: `avatars/${fileName}`,
    url: `/uploads/avatars/${fileName}`,
  };
};

// The shop document is handed to the browser as-is everywhere below, and the
// password field is `select: false`, but a document that was loaded with
// .select("+password") still carries the hash. Deleting it on a copy keeps the
// hash from ever reaching the client.
const toPublicShop = (shop) => {
  const plain = shop.toObject ? shop.toObject() : { ...shop };
  delete plain.password;
  return plain;
};

const sendActivationMail = async (seller) => {
  const activationUrl = activationLinkFor(seller._id);
  // The template names the plain-text alternative `text`; destructuring it as
  // `message` used to leave that part undefined, so the mail went out
  // HTML-only, which is the other half of the spam-filter problem documented
  // at the top of mailTemplates.js.
  const { subject, text, html } = shopActivationTemplate({
    shopName: seller.name,
    activationUrl,
    expiresIn: process.env.SHOP_ACTIVATION_EXPIRES_IN || "24 hours",
  });

  let emailSent = true;
  let failureReason = "";

  try {
    await sendMail({
      email: seller.email,
      subject,
      message: text,
      html,
    });
  } catch (mailError) {
    console.error("Shop activation email failed:", mailError);
    emailSent = false;
    failureReason = mailError?.message || "Unknown mail error";
  }

  return {
    emailSent,
    message: emailSent
      ? `Activation email sent to ${seller.email}. Open it to activate your shop.`
      : "Shop created successfully, but the activation email could not be sent. Use resend activation on the login page.",
    // The reason is logged rather than echoed: SMTP error strings can contain
    // the host and the authenticated mailbox, and this response is public.
    ...(emailSent ? {} : { mailError: failureReason }),
    // The link travels in the response only outside production.
    ...(isProduction ? {} : { activationUrl }),
  };
};

// ==================== CREATE SHOP ====================
// The shop row is created pending (isActivated: false) and the seller is signed
// in only by POST /activation, so registering does not hand out a usable
// session for an address that was never confirmed.
router.post(
  "/create-shop",
  catchAsyncErrors(async (req, res, next) => {
    const { name, email, password, address, phoneNumber, zipCode, avatar } =
      req.body;

    if (!name || !email || !password || !address || !phoneNumber || !zipCode) {
      return next(new ErrorHandler("Please fill all fields", 400));
    }

    if (!avatar) {
      return next(new ErrorHandler("Please upload an avatar image", 400));
    }

    const shopEmail = String(email).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shopEmail)) {
      return next(new ErrorHandler("Please enter a valid email address", 400));
    }

    const phone = Number(String(phoneNumber).trim());
    const zip = Number(String(zipCode).trim());

    if (!Number.isFinite(phone) || !Number.isFinite(zip)) {
      return next(
        new ErrorHandler("Phone number and zip code must be numbers", 400)
      );
    }

    const existingShop = await Shop.findOne({ email: shopEmail });

    if (existingShop) {
      return next(
        new ErrorHandler("A shop is already registered with this email", 400)
      );
    }

    let avatarImage;

    try {
      avatarImage = storeAvatar(avatar);
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }

    const seller = await Shop.create({
      name: String(name).trim(),
      email: shopEmail,
      password,
      address: String(address).trim(),
      phoneNumber: phone,
      zipCode: zip,
      avatar: avatarImage,
    });

    const { emailSent, message, activationUrl } = await sendActivationMail(seller);

    res.status(201).json({
      success: true,
      emailSent,
      message,
      ...(activationUrl ? { activationUrl } : {}),
    });
  })
);

// ==================== ACTIVATE SHOP ====================
router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    const { activation_token } = req.body;

    if (!activation_token) {
      return next(new ErrorHandler("Activation token is required", 400));
    }

    let decoded;

    try {
      decoded = verifyShopActivationToken(activation_token);
    } catch (error) {
      return next(
        new ErrorHandler("Invalid or expired activation link", 400)
      );
    }

    const seller = await Shop.findById(decoded.id);

    if (!seller) {
      return next(new ErrorHandler("Shop not found", 404));
    }

    if (seller.isActivated) {
      return res.status(200).json({
        success: true,
        message: "Shop is already activated. Please log in.",
      });
    }

    seller.isActivated = true;
    await seller.save();

    // Opening the emailed link is the proof of ownership, so the seller is
    // signed in here instead of having to type the password again.
    sendShopToken(seller, 200, res);
  })
);

// ==================== RESEND ACTIVATION ====================
router.post(
  "/resend-activation",
  catchAsyncErrors(async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorHandler("Email is required", 400));
    }

    const seller = await Shop.findOne({
      email: String(email).trim().toLowerCase(),
    });

    if (!seller) {
      return next(new ErrorHandler("Shop not found with this email", 404));
    }

    if (seller.isActivated) {
      return res.status(200).json({
        success: true,
        message: "This shop is already activated. Please log in.",
      });
    }

    const { emailSent, message, activationUrl } = await sendActivationMail(seller);

    res.status(200).json({
      success: true,
      emailSent,
      message,
      ...(activationUrl ? { activationUrl } : {}),
    });
  })
);

// ==================== LOGIN SHOP ====================
router.post(
  "/login-shop",
  catchAsyncErrors(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new ErrorHandler("Please enter email and password", 400));
    }

    const seller = await Shop.findOne({
      email: String(email).trim().toLowerCase(),
    }).select("+password");

    if (!seller) {
      return next(new ErrorHandler("Shop not found with this email", 404));
    }

    const isPasswordValid = await seller.comparePassword(password);

    if (!isPasswordValid) {
      return next(new ErrorHandler("Invalid email or password", 401));
    }

    // The seller has to confirm the address before the shop can be used.
    if (!seller.isActivated) {
      return next(
        new ErrorHandler(
          "Your shop is not activated. Please open the activation link we emailed you.",
          400
        )
      );
    }

    sendShopToken(seller, 200, res);
  })
);

// ==================== GET SELLER (SESSION) ====================
// Called on every page load, so a signed-out visitor must not be answered with
// an error the browser console then fills up: optionalSellerAuth answers 200
// with a null seller instead of 401, and the frontend treats that as the
// normal "nobody is signed in" state.
router.get(
  "/getSeller",
  optionalSellerAuth,
  catchAsyncErrors(async (req, res) => {
    res.status(200).json({
      success: true,
      seller: req.seller ? toPublicShop(req.seller) : null,
    });
  })
);

// ==================== LOGOUT SHOP ====================
router.get("/logout", (req, res) => {
  res.clearCookie("seller_token");
  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// ==================== PUBLIC SHOP INFO ====================
router.get(
  "/get-shop-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return next(new ErrorHandler("Invalid shop id", 400));
    }

    const shop = await Shop.findById(id);

    // An old conversation outlives the shop it points at, and the inbox still
    // renders that thread by name and avatar. A missing shop therefore resolves
    // to a neutral placeholder instead of a 404 that only produces a failed
    // request the UI already knows how to display. Mirrors `/user/user-info/:id`.
    if (!shop) {
      return res.status(200).json({
        success: true,
        deleted: true,
        shop: {
          _id: id,
          name: "Deleted shop",
          avatar: null,
        },
      });
    }

    res.status(200).json({
      success: true,
      shop: toPublicShop(shop),
    });
  })
);

// ==================== UPDATE SHOP AVATAR ====================
router.put(
  "/update-shop-avatar",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    const { avatar } = req.body;

    if (!avatar || typeof avatar !== "string") {
      return next(new ErrorHandler("Avatar image is required", 400));
    }

    let avatarImage;

    try {
      avatarImage = storeAvatar(avatar);
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }

    const seller = await Shop.findById(req.seller._id);
    seller.avatar = avatarImage;
    await seller.save();

    res.status(200).json({
      success: true,
      message: "Shop avatar updated successfully",
      seller: toPublicShop(seller),
    });
  })
);

// ==================== UPDATE SELLER INFO ====================
router.put(
  "/update-seller-info",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    const { name, address, phoneNumber, zipCode, description } = req.body;

    if (!name || !address || !phoneNumber || !zipCode) {
      return next(new ErrorHandler("Please fill all fields", 400));
    }

    const phone = Number(String(phoneNumber).trim());
    const zip = Number(String(zipCode).trim());

    if (!Number.isFinite(phone) || !Number.isFinite(zip)) {
      return next(
        new ErrorHandler("Phone number and zip code must be numbers", 400)
      );
    }

    const seller = await Shop.findById(req.seller._id);

    seller.name = String(name).trim();
    seller.address = String(address).trim();
    seller.phoneNumber = phone;
    seller.zipCode = zip;

    if (description !== undefined) {
      seller.description = String(description).trim();
    }

    await seller.save();

    res.status(200).json({
      success: true,
      message: "Shop info updated successfully",
      seller: toPublicShop(seller),
    });
  })
);

module.exports = router;
