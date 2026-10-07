const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { isSeller, isAuthenticated, isAdmin } = require("../middleware/auth");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../model/product");
const Order = require("../model/order");
const Shop = require("../model/shop");
const cloudinary = require("cloudinary");
const ErrorHandler = require("../utils/ErrorHandler");

// A cart line names the product it was bought from under whichever key that
// product had at the time: a real catalogue product arrives as `_id`, while the
// bundled demo catalogue numbers its products and sends `id`/`productId`. A
// review has to be matched against all of them, or the "reviewed" mark never
// lands on the line it belongs to.
const cartLineProductId = (line) => line?._id ?? line?.productId ?? line?.id ?? null;

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

const uploadProductImage = async (image) => {
  if (hasCloudinaryConfig) {
    return cloudinary.v2.uploader.upload(image, { folder: "products" });
  }

  const match = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid product image");
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

// create product
router.post(
  "/create-product",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        name,
        description,
        category,
        discountPrice,
        stock,
      } = req.body;
      if (!name || !description || !category || !discountPrice || !stock) {
        return next(new ErrorHandler("Please fill all required product fields", 400));
      }

      // The product always belongs to the seller's own shop. The dashboard
      // sends shopId, but a body field must never decide who owns the product,
      // and this route used to be reachable without any session at all.
      const shop = await Shop.findById(req.seller.id);
      if (!shop) {
        return next(new ErrorHandler("Shop Id is invalid!", 400));
      }

      if (req.body.shopId && String(req.body.shopId) !== String(shop._id)) {
        return next(
          new ErrorHandler("You can only add products to your own shop", 403)
        );
      }

      let images = [];

      if (typeof req.body.images === "string") {
        images.push(req.body.images);
      } else {
        images = req.body.images || [];
      }

      if (images.length === 0) {
        return next(new ErrorHandler("Please upload at least one product image", 400));
      }

      const imagesLinks = [];

      for (let i = 0; i < images.length; i++) {
        const result = await uploadProductImage(images[i]);

        imagesLinks.push({
          public_id: result.public_id,
          url: result.secure_url,
        });
      }

      const productData = {
        ...req.body,
        shopId: String(shop._id),
        images: imagesLinks,
        shop: shop,
      };

      const product = await Product.create(productData);

      res.status(201).json({
        success: true,
        product,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Product creation failed", 400));
    }
  })
);

// get all products of a shop
router.get(
  "/get-all-products-shop/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find({ shopId: req.params.id });

      res.status(201).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Product request failed", 400));
    }
  })
);

// get a product by id
router.get(
  "/get-product/:id",
  catchAsyncErrors(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorHandler("Product is not found", 404));
    }

    res.status(200).json({
      success: true,
      product,
    });
  })
);

// delete product of a shop
router.delete(
  "/delete-shop-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return next(new ErrorHandler("Product is not found with this id", 404));
      }    

      // isSeller only proves that *some* shop is logged in, so without this
      // check any seller could delete another shop's products.
      if (String(product.shopId) !== String(req.seller.id)) {
        return next(
          new ErrorHandler("You are not authorized to delete this product", 403)
        );
      }

      for (const image of product.images || []) {
        if (hasCloudinaryConfig) {
          await cloudinary.v2.uploader.destroy(image.public_id);
        } else if (image.url?.startsWith("/uploads/")) {
          const localImagePath = path.join(__dirname, "../..", image.url);
          if (fs.existsSync(localImagePath)) {
            fs.unlinkSync(localImagePath);
          }
        }
      }
    
      await Product.findByIdAndDelete(product._id);

      res.status(201).json({
        success: true,
        message: "Product Deleted successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to delete product", 400));
    }
  })
);

// get all products
router.get(
  "/get-all-products",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find().sort({ createdAt: -1 });

      res.status(201).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to fetch products", 400));
    }
  })
);

// ==================== SOLD COUNTS ====================
// "How many of these have been sold" is a question about the orders, not a
// counter that has to be kept in step with them. It used to be a `sold_out`
// field bumped from the order controllers, but those handlers lived in
// controller/order.js, which app.js never mounts (routes/order.js is the live
// copy), so the field never moved off zero. Even if they had run they read the
// product id off `cart._id`, which the bundled demo catalogue does not send, so
// `findById(undefined)` resolved null and the update threw inside a `forEach`
// nobody awaited.
//
// Counting from the orders makes the number correct by construction instead:
// it cannot drift, it needs no counter to reset when an order is refunded, and
// it covers the demo catalogue, whose products only ever existed as bundled
// JSON and never had a Product document to increment in the first place.
//
// A line is grouped by the same `cartLineProductId` shape a review uses, so a
// demo line (`id`/`productId`, numeric) and a real one (`_id`, an ObjectId) each
// land under the key the catalogue uses to look the product up again.
router.get(
  "/sold-counts",
  catchAsyncErrors(async (req, res, next) => {
    try {
      // A refunded order is stock that went back on the shelf, so it must stop
      // counting as sold. "Processing refund" is still a completed sale while
      // the shop decides, which matches the refund flow the seller panel drives.
      const rows = await Order.aggregate([
        { $match: { status: { $ne: "Refund Success" } } },
        { $unwind: "$cart" },
        {
          $group: {
            _id: {
              $toString: {
                $ifNull: ["$cart._id", { $ifNull: ["$cart.productId", "$cart.id"] }],
              },
            },
            sold: { $sum: { $ifNull: ["$cart.qty", 1] } },
          },
        },
        { $match: { _id: { $ne: null } } },
      ]);

      // Keyed by string because a demo product id arrives as a number on the
      // catalogue and as a string on the order line; comparing those with `===`
      // would miss every demo product that had been bought.
      const soldCounts = rows.reduce((acc, { _id, sold }) => {
        acc[_id] = sold;
        return acc;
      }, {});

      res.status(200).json({
        success: true,
        soldCounts,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to fetch sold counts", 400));
    }
  })
);

// review for a product
router.put(
  "/create-new-review",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { rating, comment, productId, orderId } = req.body;

      if (!rating || !comment || !productId) {
        return next(
          new ErrorHandler("Rating, comment and productId are required", 400)
        );
      }

      const stars = Number(rating);

      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return next(new ErrorHandler("Rating must be a whole number from 1 to 5", 400));
      }

      
      if (!orderId) {
        return next(
          new ErrorHandler("An orderId is required to review a product", 400)
        );
      }

      if (!mongoose.isValidObjectId(orderId)) {
        return next(new ErrorHandler("Order not found with this id", 404));
      }

      const order = await Order.findOne({
        _id: orderId,
        "user._id": req.user._id,
      });

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 404));
      }

      
      if (order.status !== "Delivered") {
        return next(
          new ErrorHandler(
            "You can review a product once its order is delivered",
            400
          )
        );
      }

      const line = (order.cart || []).find(
        (item) => String(cartLineProductId(item)) === String(productId)
      );

      if (!line) {
        return next(
          new ErrorHandler("This product is not part of that order", 400)
        );
      }

      
      const reviewer = {
        _id: String(req.user._id),
        name: req.user.name,
        avatar: req.user.avatar,
      };

    
      line.review = {
        rating: stars,
        comment,
        user: reviewer,
        productId: String(productId),
        updatedAt: new Date(),
      };

      
      const product = mongoose.isValidObjectId(productId)
        ? await Product.findById(productId).catch(() => null)
        : null;

      if (product) {
        
        const existingReview = product.reviews.find(
          (rev) => String(rev.user?._id) === String(req.user._id)
        );

        if (existingReview) {
          existingReview.rating = stars;
          existingReview.comment = comment;
          existingReview.user = reviewer;
        } else {
          product.reviews.push({
            user: reviewer,
            rating: stars,
            comment,
            productId: String(productId),
          });
        }

        const avg = product.reviews.reduce((sum, rev) => sum + (rev.rating || 0), 0);
        product.ratings = avg / product.reviews.length;

        await product.save({ validateBeforeSave: false });
      }

      line.isReviewed = true;

      
      order.markModified("cart");

      await order.save({ validateBeforeSave: false });

      res.status(200).json({
        success: true,
        message: "Reviewed successfully!",
        
        order,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to review product", 400));
    }
  })
);

// all reviews for one product
//
// A review is written to two places by the endpoint above, but only one of them
// covers the whole catalogue. The cart line on the order is written
// unconditionally, so it is the only record that exists for the bundled demo
// catalogue: those products are numbered (`id` 3, `productId` "19") and have no
// Product document, and the write to `product.reviews` is guarded by
// `mongoose.isValidObjectId`, so every review of a demo product was silently
// dropped from the product and the reviews tab had nothing to render even though
// the review had been accepted. Reading the orders back is what makes those
// reviews reachable.
router.get(
  "/reviews/:productId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const key = String(req.params.productId ?? "").trim();

      if (!key) {
        return next(new ErrorHandler("A productId is required", 400));
      }

      // Same id shape the write side used: a real product arrives as `_id`, a
      // demo one as `productId`/`id`. Compared as a string because the demo side
      // is a number in the catalogue and a string on the order line.
      const rows = await Order.aggregate([
        { $unwind: "$cart" },
        { $match: { "cart.review": { $exists: true } } },
        {
          $addFields: {
            lineProductId: {
              $toString: {
                $ifNull: ["$cart._id", { $ifNull: ["$cart.productId", "$cart.id"] }],
              },
            },
          },
        },
        { $match: { lineProductId: key } },
        // Newest first, and used below to decide which of two reviews by the
        // same person survives.
        { $sort: { "cart.review.updatedAt": -1, _id: -1 } },
        { $project: { _id: 0, review: "$cart.review" } },
      ]);

      // One review per person per product. A buyer can hold more than one
      // delivered order for the same product and each order carries its own cart
      // line, so without this the same person would be listed several times.
      const seen = new Set();
      const reviews = rows
        .map(({ review }) => review)
        .filter((review) => {
          const userId = String(review?.user?._id ?? "");
          if (!userId || seen.has(userId)) return false;
          seen.add(userId);
          return true;
        });

      // A real product also holds reviews written straight onto its document,
      // which is where any written before this endpoint existed still live. They
      // are merged in rather than preferred, so no review is ever lost, and
      // anything the orders already reported is dropped as a duplicate of the
      // same review stored in both places.
      if (mongoose.isValidObjectId(key)) {
        const product = await Product.findById(key)
          .select("reviews")
          .lean()
          .catch(() => null);

        for (const review of product?.reviews || []) {
          const userId = String(review?.user?._id ?? "");
          if (!userId || seen.has(userId)) continue;
          seen.add(userId);
          reviews.push(review);
        }
      }

      const averageRating = reviews.length
        ? reviews.reduce((sum, review) => sum + (review.rating || 0), 0) /
          reviews.length
        : 0;

      res.status(200).json({
        success: true,
        reviews,
        totalReviews: reviews.length,
        averageRating,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to fetch reviews", 400));
    }
  })
);

// ==================== SELLER STATS ====================
// A whole shop's review total and average, in one place.
//
// The product detail page's seller panel used to add up `product.reviews` over
// whatever `getAllProductsShop` had returned, and it could never produce a
// number: a review is only ever guaranteed to exist on the order's cart line,
// because the write to `product.reviews` above is guarded by
// `mongoose.isValidObjectId(productId)`. The bundled demo catalogue is numbered
// (`id` 9, `shop.id` 109) and has no Product document at all, so every review of
// a demo product was dropped from the product and the "Total Reviews" stat sat
// at zero no matter how many reviews had been written. The reviews tab on the
// same page looked fine because it reads `/reviews/:productId` below, which is
// what this endpoint is the shop-wide version of.
//
// The count is therefore read off the orders rather than off a counter or a
// denormalised field, the same reasoning as `/sold-counts` above: a number
// derived from the records that exist cannot drift, and it needs no reset when
// an order is refunded.
//
// `cart.shopId` is the grouping key because create-order stamps it onto every
// line (see `resolveShopId` in routes/order.js), which is also what lets the
// demo shops be counted: they have no Shop document, but their order lines are
// just as queryable.
router.get(
  "/seller-stats/:shopId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shopId = String(req.params.shopId ?? "").trim();

      if (!shopId) {
        return next(new ErrorHandler("A shopId is required", 400));
      }

      // Newest first, for the same reason as in `/reviews/:productId`: one
      // buyer can hold several delivered orders for the same product and each
      // carries its own cart line, so the same person shows up more than once
      // and the most recent one is the one that counts.
      const rows = await Order.aggregate([
        { $unwind: "$cart" },
        { $match: { "cart.shopId": shopId, "cart.review": { $exists: true } } },
        { $sort: { "cart.review.updatedAt": -1, _id: -1 } },
        {
          $project: {
            _id: 0,
            // Same id shape the write side used, so a demo line (`id`/`productId`,
            // numeric) and a real one (`_id`, an ObjectId) each land under the
            // key the catalogue looks the product up by.
            productId: {
              $toString: {
                $ifNull: ["$cart._id", { $ifNull: ["$cart.productId", "$cart.id"] }],
              },
            },
            userId: { $toString: { $ifNull: ["$cart.review.user._id", ""] } },
            rating: { $ifNull: ["$cart.review.rating", 0] },
            review: "$cart.review",
          },
        },
      ]);

      // One review per person per product, deduped the same way as the
      // per-product endpoint so the shop total is always the sum of the
      // per-product counts the detail page renders beside it.
      const seen = new Set();
      const reviews = [];

      const collect = (productId, userId, review) => {
        const key = `${productId}::${userId}`;

        // A review with no author cannot be attributed, so it is dropped rather
        // than counted as one anonymous entry that would collapse every other
        // anonymous review into it.
        if (!userId || seen.has(key)) return;

        seen.add(key);
        reviews.push(review);
      };

      for (const row of rows) {
        collect(row.productId, row.userId, row.review);
      }

      // `null` rather than 0 when the shop is not a Mongo id: the demo shops
      // exist only in the bundled catalogue the browser already holds, so
      // answering 0 would report "this shop has no products" when the truth is
      // that only the client can know.
      let totalProducts = null;

      if (mongoose.isValidObjectId(shopId)) {
        const products = await Product.find({ shopId })
          .select("_id reviews")
          .lean();

        totalProducts = products.length;

        // A real product also holds reviews written straight onto its document,
        // including any that predate the order-line write. Merged in rather than
        // preferred, so no review is lost, and anything the orders already
        // reported is dropped as the same review stored in both places.
        for (const product of products) {
          const productId = String(product._id);

          for (const review of product.reviews || []) {
            collect(productId, String(review?.user?._id ?? ""), review);
          }
        }
      }

      const ratings = reviews.map((review) => Number(review?.rating) || 0);

      const totalReviews = reviews.length;
      const averageRating = totalReviews
        ? ratings.reduce((sum, rating) => sum + rating, 0) / totalReviews
        : 0;

      res.status(200).json({
        success: true,
        totalProducts,
        totalReviews,
        averageRating,
        reviews,
      });
    } catch (error) {
      return next(
        new ErrorHandler(error.message || "Unable to fetch seller stats", 400)
      );
    }
  })
);

// all products --- for admin
router.get(
  "/admin-all-products",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find().sort({
        createdAt: -1,
      });
      res.status(201).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);
module.exports = router;