require("dotenv").config();

const required = ["MONGO_URI", "JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

module.exports = Object.freeze({
  port: process.env.PORT || 5000,
  isProd: process.env.NODE_ENV === "production",
  mongoUri: process.env.MONGO_URI,
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  adminEmail: process.env.ADMIN_EMAIL.toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD,
});
