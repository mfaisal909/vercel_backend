const ShopReview = require("../model/shopReview");
const Conversation = require("../model/conversation");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  isAuthenticated,
  isSeller,
  optionalAuth,
  optionalSellerAuth,
} = require("../middleware/auth");
const express = require("express");
const { sendToUser } = require("../socket");

const router = express.Router();

// `members` holds raw id strings ([userId, sellerId]), so every comparison has
// to be on strings or ObjectId-vs-string silently fails to match and the
// conversation looks like it belongs to somebody else.
const memberIds = (conversation) =>
  (conversation?.members || []).map((member) => String(member));

// The shop and the buyer of a thread, worked out from who is asking. Used to
// make sure the caller is actually in the conversation before reading or
// writing anything, which is what stops one buyer reading another's thread by
// guessing an id.
const resolveParticipants = (conversation, { user, seller }) => {
  const members = memberIds(conversation);

  if (user) {
    const buyerId = String(user._id);

    if (!members.includes(buyerId)) return null;

    return { userId: buyerId, shopId: members.find((m) => m !== buyerId) };
  }

  if (seller) {
    const sellerId = String(seller._id);

    if (!members.includes(sellerId)) return null;

    return { userId: members.find((m) => m !== sellerId), shopId: sellerId };
  }

  return null;
};

// Both sides of the thread need this, and they are authenticated by different
// cookies (`token` for the buyer, `seller_token` for the shop), so each route
// picks the middleware that matches the caller it expects.
const loadConversationFor = async (conversationId, auth) => {
  if (!conversationId || !/^[a-f\d]{24}$/i.test(String(conversationId))) {
    throw new ErrorHandler("Conversation not found", 404);
  }

  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    throw new ErrorHandler("Conversation not found", 404);
  }

  const participants = resolveParticipants(conversation, auth);

  if (!participants) {
    throw new ErrorHandler("You are not part of this conversation", 403);
  }

  return { conversation, ...participants };
};

// The buyer's rating of the shop, left from inside the chat inbox.
//
// The shop is taken from the conversation rather than from the request body: a
// body-supplied shopId would let a buyer post a review for any shop at all.
router.post(
  "/conversation/:conversationId/review",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { rating, comment } = req.body;
      const stars = Number(rating);

      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return next(
          new ErrorHandler("Rating must be a whole number from 1 to 5", 400)
        );
      }

      const text = String(comment ?? "").trim();

      if (!text) {
        return next(new ErrorHandler("Please write a comment", 400));
      }

      const { conversation, userId, shopId } = await loadConversationFor(
        req.params.conversationId,
        { user: req.user }
      );

      // One review per buyer per shop: re-submitting replaces the earlier one
      // rather than stacking a second rating on the same shop.
      const review = await ShopReview.findOneAndUpdate(
        { shop: shopId, user: userId },
        {
          $set: {
            rating: stars,
            comment: text,
            conversationId: String(conversation._id),
            userInfo: {
              name: req.user.name,
              avatar: req.user.avatar,
            },
          },
          $setOnInsert: { shop: shopId, user: userId },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // Tell the shop it is open right now, so the rating lands in its inbox
      // without a reload. Best-effort: the review is already saved, and a shop
      // with no open tab sees it on its next request.
      sendToUser(shopId, "getShopReview", {
        conversationId: String(conversation._id),
        review,
      });

      res.status(201).json({
        success: true,
        review,
      });
    } catch (error) {
      if (error instanceof ErrorHandler) return next(error);
      return next(new ErrorHandler(error.message || "Unable to review the shop", 500));
    }
  })
);

// Every review left in one conversation, so the buyer and the shop see the same
// list from either side of the thread.
router.get(
  "/conversation/:conversationId/reviews",
  optionalAuth,
  optionalSellerAuth,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const conversation = await Conversation.findById(req.params.conversationId);

      if (!conversation) {
        return next(new ErrorHandler("Conversation not found", 404));
      }

      // The thread itself is not a secret: its id travels in the URL, so
      // membership is checked against whichever cookie the caller sent.
      const isMember =
        memberIds(conversation).includes(String(req.user?._id ?? "")) ||
        memberIds(conversation).includes(String(req.seller?._id ?? ""));

      if (!isMember) {
        return next(new ErrorHandler("You are not part of this conversation", 403));
      }

      const reviews = await ShopReview.find({
        conversationId: String(conversation._id),
      }).sort({ updatedAt: -1 });

      res.status(200).json({
        success: true,
        reviews,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message || "Unable to fetch reviews", 500));
    }
  })
);

// Reviews a shop has received, newest first, with the running average. This is
// the shop-wide view for its own dashboard.
router.get(
  "/shop/:shopId/reviews",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      // A shop may only read its own reviews.
      if (String(req.seller._id) !== String(req.params.shopId)) {
        return next(new ErrorHandler("You are not authorized", 403));
      }

      const reviews = await ShopReview.find({ shop: String(req.params.shopId) })
        .sort({ updatedAt: -1 })
        .lean();

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
      return next(new ErrorHandler(error.message || "Unable to fetch reviews", 500));
    }
  })
);

module.exports = router;