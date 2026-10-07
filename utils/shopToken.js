const sendShopToken = (seller, statusCode, res) => {
  const token = seller.getJwtToken();

  // In production the frontend and the API usually live on different domains
  // (e.g. Vercel + a hosted API), which browsers treat as cross-site: a
  // cookie without SameSite=None is stored but never sent back, so every page
  // refresh looked like a fresh logout. SameSite=None requires Secure, which
  // only works over https. Locally the two run on the same site
  // (localhost:5173 / localhost:8000), so SameSite=Lax is both sufficient and
  // the only option that works on plain http.
  const isProduction = process.env.NODE_ENV === "PRODUCTION";

  const options = {
    expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
  };

  // The seller document is handed to us straight from a .select("+password")
  // query or from Shop.create(), so it still carries the bcrypt hash. Returning
  // it would leak it to the browser, and returning the raw token as well would
  // defeat the httpOnly cookie. Same sanitising as routes/user.js.
  const sellerResponse = seller.toObject ? seller.toObject() : { ...seller };
  delete sellerResponse.password;

  res.status(statusCode).cookie("seller_token", token, options).json({
    success: true,
    seller: sellerResponse,
  });
};

module.exports = sendShopToken;