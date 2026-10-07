const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const Shop = require("../model/shop");
const Event = require("../model/event");
const ErrorHandler = require("../utils/ErrorHandler");
const { isSeller, isAdmin, isAuthenticated } = require("../middleware/auth");
const router = express.Router();
const cloudinary = require("cloudinary");

const hasCloudinaryConfig = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (hasCloudinaryConfig) {
  cloudinary.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const uploadEventImage = async (image) => {
  if (hasCloudinaryConfig) {
    return cloudinary.v2.uploader.upload(image, { folder: "events" });
  }

  const match = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid event image");
  }

  const extension = match[1].split("/")[1].replace("jpeg", "jpg");
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const uploadDirectory = path.join(__dirname, "../../uploads/products");
  fs.mkdirSync(uploadDirectory, { recursive: true });
  fs.writeFileSync(path.join(uploadDirectory, fileName), match[2], "base64");

  return {
    public_id: `products/${fileName}`,
    secure_url: `/uploads/products/${fileName}`,
  };
};

// create event
router.post(
  "/create-event",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        name,
        description,
        category,
        discountPrice,
        stock,
        start_Date,
        Finish_Date,
      } = req.body;

      if (
        !name ||
        !description ||
        !category ||
        !discountPrice ||
        !stock ||
        !start_Date ||
        !Finish_Date
      ) {
        return next(
          new ErrorHandler("Please fill all required event fields", 400)
        );
      }

      // The event always belongs to the seller's own shop. The dashboard sends
      // shopId, but a body field must never decide who owns the event, and this
      // route used to be reachable without any session at all.
      const shop = await Shop.findById(req.seller.id);
      if (!shop) {
        return next(new ErrorHandler("Shop Id is invalid!", 400));
      }

      if (req.body.shopId && String(req.body.shopId) !== String(shop._id)) {
        return next(
          new ErrorHandler("You can only add events to your own shop", 403)
        );
      }

      let images = [];

      if (typeof req.body.images === "string") {
        images.push(req.body.images);
      } else {
        images = req.body.images || [];
      }

      if (images.length === 0) {
        return next(new ErrorHandler("Please upload at least one event image", 400));
      }

      const imagesLinks = [];

      for (let i = 0; i < images.length; i++) {
        const result = await uploadEventImage(images[i]);

        imagesLinks.push({
          public_id: result.public_id,
          url: result.secure_url,
        });
      }

      const eventData = {
        ...req.body,
        shopId: String(shop._id),
        images: imagesLinks,
        shop: {
          _id: shop._id,
          name: shop.name,
          email: shop.email,
          avatar: shop.avatar,
        },
      };

      const event = await Event.create(eventData);

      res.status(201).json({
        success: true,
        event,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Event creation failed", 400));
    }
  })
);

// get all events
router.get("/get-all-events", async (req, res, next) => {
  try {
    const events = await Event.find();
    res.status(201).json({
      success: true,
      events,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message || "Unable to fetch events", 400));
  }
});

// get all events of a shop
router.get(
  "/get-all-events/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const events = await Event.find({ shopId: req.params.id });

      res.status(201).json({
        success: true,
        events,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to fetch events", 400));
    }
  })
);

// delete event of a shop
router.delete(
  "/delete-shop-event/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.id);

      if (!event) {
        return next(new ErrorHandler("Event is not found with this id", 404));
      }

      // Without this check any signed-in seller could delete another shop's
      // events, and the route had no session requirement at all.
      if (String(event.shopId) !== String(req.seller.id)) {
        return next(
          new ErrorHandler("You are not authorized to delete this event", 403)
        );
      }

      for (const image of event.images || []) {
        if (hasCloudinaryConfig) {
          await cloudinary.v2.uploader.destroy(image.public_id);
        } else if (image.url?.startsWith("/uploads/")) {
          const localImagePath = path.join(__dirname, "../..", image.url);
          if (fs.existsSync(localImagePath)) {
            fs.unlinkSync(localImagePath);
          }
        }
      }

      await Event.findByIdAndDelete(event._id);

      res.status(201).json({
        success: true,
        message: "Event Deleted successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to delete event", 400));
    }
  })
);

// all events --- for admin
router.get(
  "/admin-all-events",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const events = await Event.find().sort({
        createdAt: -1,
      });
      res.status(201).json({
        success: true,
        events,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;