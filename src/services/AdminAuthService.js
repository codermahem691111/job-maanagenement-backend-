const crypto = require("crypto");
const { promisify } = require("util");
const jwt = require("jsonwebtoken");

const scrypt = promisify(crypto.scrypt);
// Used so a login for an unknown email takes as long as a real one
const DUMMY_HASH = `${"00".repeat(16)}:${"00".repeat(64)}`;

class AdminAuthService {
  constructor(config) {
    this.config = config;
    // Hash both sides so comparison is constant-time and length-safe
    this.emailHash = this.#hash(config.adminEmail);
    this.passwordHash = this.#hash(config.adminPassword);
  }

  #hash(value) {
    return crypto.createHash("sha256").update(String(value)).digest();
  }

  // ---------- admin ----------
  validateCredentials(email, password) {
    const emailOk = crypto.timingSafeEqual(
      this.#hash(String(email || "").trim().toLowerCase()),
      this.emailHash
    );
    const passOk = crypto.timingSafeEqual(this.#hash(password || ""), this.passwordHash);
    return emailOk && passOk;
  }

  issueToken() {
    return jwt.sign({ role: "admin" }, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn,
    });
  }

  verifyToken(token) {
    const payload = jwt.verify(token, this.config.jwtSecret);
    if (payload.role !== "admin") throw new Error("Not an admin token");
    return payload;
  }

  // ---------- member passwords ----------
  // Stored as "salt:hash" (hex). A random salt per password; the plain password is never stored.
  async hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(String(password), salt, 64);
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
  }

  async verifyPassword(password, stored) {
    const valid = typeof stored === "string" && /^[0-9a-f]+:[0-9a-f]+$/.test(stored);
    const [saltHex, hashHex] = (valid ? stored : DUMMY_HASH).split(":");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return crypto.timingSafeEqual(actual, expected) && valid;
  }

  // ---------- member session ----------
  issueMemberToken(memberId) {
    return jwt.sign({ role: "member", sub: String(memberId) }, this.config.jwtSecret, {
      expiresIn: "1d",
    });
  }

  verifyMemberToken(token) {
    const payload = jwt.verify(token, this.config.jwtSecret);
    if (payload.role !== "member" || !payload.sub) throw new Error("Not a member token");
    return payload;
  }
}

module.exports = AdminAuthService;