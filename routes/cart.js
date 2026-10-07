const express = require("express");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const Cart = require("../model/cart");

const router = express.Router();

// A cart is private to its owner, so every route below takes the userId from
// the session and rejects a mismatch. They used to be unauthenticated and
// trusted a userId in the path/body, which let anyone read or empty another
// account's cart.
const resolveOwnCartId = (req, res, next, requestedId) => {
  if (requestedId && String(requestedId) !== String(req.user.id)) {
    return next(
      new ErrorHandler("You are not authorized to access this cart", 403)
    );
  }

  return String(req.user.id);
};

const getItemPrice = (item) =>
  item?.discountPrice ?? item?.discount_price ?? item?.price ?? 0;

const getItemQty = (item) => item?.qty ?? 1;

const calculateTotalPrice = (items) =>
  items.reduce((sum, item) => sum + getItemPrice(item) * getItemQty(item), 0);

const emptyCart = () => ({ items: [], totalPrice: 0 });

// A cart item is addressed by the id of the product or event it points at.
// Products reach the browser with a string `_id`; older seeded rows carry no id
// at all, so `productId` is written on insert and all three keys are accepted on
// read. Without this a single item whose shape differed made every delete 404 and
// left the row stuck in the cart forever.
const itemIdentity = (item) =>
  String(item?._id ?? item?.id ?? item?.productId ?? "").trim();

const sameItem = (i, productId) => {
  const pid = String(productId ?? "").trim();
  if (!pid) return false;
  return itemIdentity(i) === pid;
};

// ==================== ADD TO CART ====================
router.post(
  "/add-to-cart",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { userId, item } = req.body;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return next(new ErrorHandler("A cart item is required", 400));
    }

    // An item with no id could never be removed again, so it is refused here
    // instead of being stored as an undeletable row.
    const itemId = itemIdentity(item);

    if (!itemId) {
      return next(
        new ErrorHandler("This item has no id and cannot be added to the cart", 400)
      );
    }

    const ownerId = resolveOwnCartId(req, res, next, userId);
    if (!ownerId) return;

    // productId is persisted alongside the item so its identity survives even if
    // the browser later sends a payload that omits _id.
    const stored = { ...item, productId: itemId };

    let cart = await Cart.findOne({ userId: ownerId });

    if (!cart) {
      cart = await Cart.create({ userId: ownerId, items: [stored] });
    } else {
      const isItemExist = cart.items.some((i) => sameItem(i, itemId));

      if (isItemExist) {
        cart.items = cart.items.map((i) => (sameItem(i, itemId) ? stored : i));
      } else {
        cart.items.push(stored);
      }
    }

    cart.totalPrice = calculateTotalPrice(cart.items);
    await cart.save();

    res.status(200).json({
      success: true,
      message: "Item added to cart successfully!",
      cart,
    });
  })
);

// ==================== GET CART ====================
// A cart row does not exist until the buyer adds something, so "not there yet"
// is the normal answer and not an error. The previous 404 fired on every page
// load for every signed-in visitor who had not added an item.
router.get(
  "/get-cart/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const ownerId = resolveOwnCartId(req, res, next, req.params.userId);
    if (!ownerId) return;

    const cart = await Cart.findOne({ userId: ownerId });

    res.status(200).json({
      success: true,
      cart: cart || emptyCart(),
    });
  })
);

// ==================== REMOVE FROM CART ====================
// Idempotent on purpose. Deleting something that is not there leaves the cart in
// the state the caller asked for, so it answers 200 with the current cart. The
// browser used to hold a cart from localStorage that had drifted away from the
// stored one, and every removal of an already-absent item came back as a 404
// "Item not found in cart" that the client swallowed and hid from the buyer.
router.delete(
  "/remove-from-cart/:userId/:productId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const { productId } = req.params;

    const ownerId = resolveOwnCartId(req, res, next, req.params.userId);
    if (!ownerId) return;

    const cart = await Cart.findOne({ userId: ownerId });

    if (!cart) {
      return res.status(200).json({
        success: true,
        message: "Item removed from cart successfully!",
        cart: emptyCart(),
      });
    }

    const before = cart.items.length;
    cart.items = cart.items.filter((i) => !sameItem(i, productId));
    cart.totalPrice = calculateTotalPrice(cart.items);
    await cart.save();

    res.status(200).json({
      success: true,
      message:
        cart.items.length === before
          ? "Item was not in your cart"
          : "Item removed from cart successfully!",
      cart,
    });
  })
);

// ==================== CLEAR CART ====================
// The escape hatch for a cart holding rows that can neither be removed by id nor
// ordered, which used to leave the buyer with no way forward at all.
router.delete(
  "/clear",
  isAuthenticated,
  catchAsyncErrors(async (req, res) => {
    const cart = await Cart.findOneAndUpdate(
      { userId: req.user.id },
      { items: [], totalPrice: 0 },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Cart cleared successfully!",
      cart,
    });
  })
);

module.exports = router;