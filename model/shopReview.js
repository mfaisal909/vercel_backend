const mongoose = require("mongoose");

// A rating the buyer gives the shop from inside the chat inbox.
//
// This is deliberately separate from `product.reviews` (a review of one
// product, written on the order page) and from the review kept on an order's
// cart line: this one is about the shop itself and is written from the
// conversation, so it is keyed by shop + user rather than by product.
const shopReviewSchema = new mongoose.Schema(
  {
    shop: {
      type: String,
      required: true,
    },
    user: {
      type: String,
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      default: "",
    },
    // Which conversation it was left in, so the seller sees it in the thread it
    // belongs to instead of having to guess where to look.
    conversationId: {
      type: String,
      default: null,
    },
    userInfo: {
      name: String,
      avatar: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

// One review per buyer per shop. The unique index is what enforces it under
// concurrent writes; the findOneAndUpdate below alone would still let two
// simultaneous requests both insert.
shopReviewSchema.index({ shop: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("ShopReview", shopReviewSchema);