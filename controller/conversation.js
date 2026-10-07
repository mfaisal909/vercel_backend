const Conversation = require("../model/conversation");
const User = require("../model/user");
const mongoose = require("mongoose");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const express = require("express");
const { isSeller, isAuthenticated } = require("../middleware/auth");
const router = express.Router();

// One thread per buyer/shop pair. `groupTitle` alone cannot give that: the buyer
// side builds it from the product they opened (`${productId}${userId}`), so the
// same two members could hold a second, empty thread for every product they
// discuss. The pair is matched on the member ids, which are stored as bare
// strings and must therefore be compared as strings.
const findPairConversation = (userId, sellerId) =>
  Conversation.findOne({
    members: { $all: [String(userId), String(sellerId)] },
  }).sort({ updatedAt: -1 });

// create a new conversation
router.post(
  "/create-new-conversation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { groupTitle, userId, sellerId } = req.body;

      const isConversationExist = await Conversation.findOne({ groupTitle });

      if (isConversationExist) {
        const conversation = isConversationExist;
        res.status(201).json({
          success: true,
          conversation,
        });
      } else {
        // No thread with this title yet, but the pair may already talk through
        // another product (or through the shop starting the chat first).
        const pairConversation = await findPairConversation(userId, sellerId);

        if (pairConversation) {
          return res.status(201).json({
            success: true,
            conversation: pairConversation,
          });
        }

        const conversation = await Conversation.create({
          members: [userId, sellerId],
          groupTitle: groupTitle,
        });

        res.status(201).json({
          success: true,
          conversation,
        });
      }
    } catch (error) {
      return next(new ErrorHandler(error.response.message), 500);
    }
  })
);

// The shop opening a thread first, from the dashboard inbox. Until now only the
// buyer could start one (from a product page), so a seller who wanted to reach
// out had to wait for a message. The seller is taken from the session, never
// from the body, so a shop can only ever open a thread as itself.
router.post(
  "/start-conversation-seller",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    const { userId } = req.body;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return next(new ErrorHandler("A valid customer id is required", 400));
    }

    const user = await User.findById(userId).select("_id");

    if (!user) {
      return next(new ErrorHandler("Customer not found", 404));
    }

    const sellerId = String(req.seller.id);

    // The buyer may already have written in (from a product page), in which
    // case that thread is opened instead of a second one being created.
    const existing = await findPairConversation(user._id, sellerId);

    if (existing) {
      return res.status(200).json({
        success: true,
        conversation: existing,
      });
    }

    const conversation = await Conversation.create({
      members: [String(user._id), sellerId],
      groupTitle: `${user._id}${sellerId}`,
    });

    res.status(201).json({
      success: true,
      conversation,
    });
  })
);

// get seller conversations
router.get(
  "/get-all-conversation-seller/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const conversations = await Conversation.find({
        members: {
          $in: [req.params.id],
        },
      }).sort({ updatedAt: -1, createdAt: -1 });

      res.status(201).json({
        success: true,
        conversations,
      });
    } catch (error) {
      return next(new ErrorHandler(error), 500);
    }
  })
);


// get user conversations
router.get(
  "/get-all-conversation-user/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const conversations = await Conversation.find({
        members: {
          $in: [req.params.id],
        },
      }).sort({ updatedAt: -1, createdAt: -1 });

      res.status(201).json({
        success: true,
        conversations,
      });
    } catch (error) {
      return next(new ErrorHandler(error), 500);
    }
  })
);

// update the last message
router.put(
  "/update-last-message/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { lastMessage, lastMessageId } = req.body;

      const conversation = await Conversation.findByIdAndUpdate(req.params.id, {
        lastMessage,
        lastMessageId,
      });

      res.status(201).json({
        success: true,
        conversation,
      });
    } catch (error) {
      return next(new ErrorHandler(error), 500);
    }
  })
);

module.exports = router;