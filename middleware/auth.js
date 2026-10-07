const ErrorHandler=require('../utils/ErrorHandler')
const catchAsyncErrors=require('./catchAsyncErrors')
const jwt=require('jsonwebtoken')
const User=require('../model/user')
const Shop=require('../model/shop')

exports.isAuthenticated=catchAsyncErrors(async(req,res,next)=>{
    const {token}=req.cookies;

    if(!token){
        return next(new ErrorHandler("Please login to continue",401))
    }

    const decoded=jwt.verify(token,process.env.JWT_SECRET_KEY)

    req.user=await User.findById(decoded.id)

    // A token for an account that no longer exists must not continue as
    // req.user === null, otherwise downstream handlers throw instead of 401.
    if(!req.user){
        return next(new ErrorHandler("Please login to continue",401))
    }

    next();
})

// Same check as isAuthenticated, except that a signed-out visitor is not an
// error: it simply leaves req.user empty and calls next(). Only for endpoints
// every visitor hits on page load, so they can answer "nobody is signed in"
// with 200 instead of 401 and keep the browser console clean.
exports.optionalAuth=catchAsyncErrors(async(req,res,next)=>{
    const {token}=req.cookies;

    if(!token){
        return next();
    }

    let decoded;
    try {
        decoded=jwt.verify(token,process.env.JWT_SECRET_KEY)
    } catch (error) {
        // Expired or tampered token: clear it so the browser stops resending it
        // instead of getting the same rejection on every request.
        res.clearCookie("token");
        return next();
    }

    req.user=await User.findById(decoded.id)

    // The account behind the token no longer exists.
    if(!req.user){
        res.clearCookie("token");
    }

    next();
})

exports.isSeller=catchAsyncErrors(async(req,res,next)=>{
    const {seller_token} = req.cookies;
    if(!seller_token){
        return next(new ErrorHandler("Please login to continue", 401));
    }

    let decoded;
    try {
        decoded = jwt.verify(seller_token, process.env.JWT_SECRET_KEY);
    } catch (error) {
        // Expired or tampered token: clear it so the browser stops resending it
        // instead of getting the same rejection on every request.
        res.clearCookie("seller_token");
        return next(new ErrorHandler("Please login to continue", 401));
    }

    req.seller = await Shop.findById(decoded.id);

    if(!req.seller){
        res.clearCookie("seller_token");
        return next(new ErrorHandler("Seller not found", 401));
    }

    next();
});

// Same lenience as optionalAuth, but for the shop's own cookie. Needed by
// endpoints that both sides of a conversation read: the buyer authenticates with
// `token` and the shop with `seller_token`, so a route that has to serve both
// cannot pick one of them.
exports.optionalSellerAuth=catchAsyncErrors(async(req,res,next)=>{
    const {seller_token}=req.cookies;
    if(!seller_token){
        return next();
    }

    let decoded;
    try {
        decoded=jwt.verify(seller_token,process.env.JWT_SECRET_KEY);
    } catch (error) {
        res.clearCookie("seller_token");
        return next();
    }

    req.seller=await Shop.findById(decoded.id);

    if(!req.seller){
        res.clearCookie("seller_token");
    }

    next();
})

exports.isAdmin=(...roles)=>catchAsyncErrors(async(req,res,next)=>{
    const {token}=req.cookies;

    if(!token){
        return next(new ErrorHandler("Please login to continue",401))
    }

    const decoded=jwt.verify(token,process.env.JWT_SECRET_KEY)
    req.user=await User.findById(decoded.id)

    if(!req.user || !roles.includes(req.user.role)){
        return next(new ErrorHandler("You are not authorized",403))
    }

    next();
})
