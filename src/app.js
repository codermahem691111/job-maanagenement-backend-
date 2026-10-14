const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { Area, Member, Task, Resource } = require("./config/database");
const AdminAuthService = require("./services/AdminAuthService");
const AuthMiddleware = require("./middleware/AuthMiddleware");
const { AdminController, MemberController } = require("./controllers/AdminController");
const { AdminRoutes, MemberRoutes } = require("./routes/AdminRoutes");

class App {
  constructor(config) {
    this.config = config;
    this.instance = express();
    this.#middlewares();
    this.#routes();
    this.#errorHandlers();
  }

  #middlewares() {
    this.instance.set("trust proxy", 1);
    this.instance.use(helmet());
    this.instance.use(cors({ origin: this.config.clientUrl, credentials: true }));
    this.instance.use(express.json({ limit: "10kb" }));
    this.instance.use(cookieParser());
  }

  #routes() {
    const models = { Area, Member, Task, Resource };
    const adminAuthService = new AdminAuthService(this.config);
    const authMiddleware = new AuthMiddleware(adminAuthService);

    const adminRoutes = new AdminRoutes(
      new AdminController(adminAuthService, this.config, models),
      authMiddleware
    );
    const memberRoutes = new MemberRoutes(
      new MemberController(adminAuthService, this.config, models),
      authMiddleware
    );

    this.instance.get("/api/health", (req, res) => res.json({ status: "ok" }));
    this.instance.use("/api/admin", adminRoutes.router);
    this.instance.use("/api/member", memberRoutes.router);
  }

  #errorHandlers() {
    this.instance.use((req, res) => res.status(404).json({ success: false, message: "Not found" }));
    this.instance.use((err, req, res, next) => {
      if (err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "Invalid JSON" });
      }
      if (err.type === "entity.too.large") {
        return res.status(413).json({ success: false, message: "That upload is too large. Files can be up to 10 MB." });
      }
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    });
  }
}

module.exports = App;