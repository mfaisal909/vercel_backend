const jwt = require("jsonwebtoken");

// The seller activation link only carries the id of the pending shop plus a
// purpose claim. The shop row itself (name, address, hashed password, avatar)
// already lives in MongoDB from the moment the seller registers, so nothing
// sensitive - in particular no password - ever travels through the email.
//
// An earlier version signed the whole seller object, which meant the plaintext
// password was readable in the link (browser history, server logs, referrers).

const PURPOSE = "seller-activation";

const createShopActivationToken = (shopId) => {
  return jwt.sign({ id: String(shopId), purpose: PURPOSE }, process.env.ACTIVATION_SECRET, {
    expiresIn: process.env.SHOP_ACTIVATION_EXPIRES_IN || "1d",
  });
};

const verifyShopActivationToken = (token) => {
  const payload = jwt.verify(token, process.env.ACTIVATION_SECRET);

  if (payload.purpose !== PURPOSE || !payload.id) {
    throw new Error("Activation token is not a seller activation token");
  }

  return payload;
};

module.exports = { createShopActivationToken, verifyShopActivationToken };
