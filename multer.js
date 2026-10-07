const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = file.originalname.split(".").pop();
    const filename = file.originalname.split(".")[0];

    cb(null, filename + "-" + uniqueSuffix + "." + extension);
  },
});

exports.upload = multer({ storage });
