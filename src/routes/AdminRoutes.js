const express = require("express");
const { Router } = express;
const rateLimit = require("express-rate-limit");

/* ------------------------------ /api/admin ------------------------------ */
class AdminRoutes {
  constructor(adminController, authMiddleware) {
    this.router = Router();
    this.adminController = adminController;
    this.authMiddleware = authMiddleware;
    this.#register();
  }

  #register() {
    const c = this.adminController;
    const guard = this.authMiddleware.requireAdmin;

    // Brute-force protection on login: 5 attempts / 15 min / IP
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: "Too many attempts, try again later" },
    });

    this.router.post("/login", loginLimiter, c.login);
    this.router.post("/logout", c.logout);

    // Everything below requires a valid admin session
    this.router.get("/me", guard, c.me);
    this.router.get("/dashboard", guard, c.dashboard);

    this.router.get("/areas", guard, c.listAreas);
    this.router.post("/areas", guard, c.createArea);
    this.router.delete("/areas/:id", guard, c.deleteArea);

    this.router.get("/members", guard, c.listMembers);
    this.router.post("/members", guard, c.createMember);
    this.router.delete("/members/:id", guard, c.deleteMember);

    this.router.post("/members/:id/team-leader", guard, c.setTeamLeader);
    this.router.delete("/members/:id/team-leader", guard, c.removeTeamLeader);
  }
}

/* ------------------------------ /api/member ----------------------------- */
class MemberRoutes {
  constructor(memberController, authMiddleware) {
    this.router = Router();
    this.memberController = memberController;
    this.authMiddleware = authMiddleware;
    this.#register();
  }

  #register() {
    const c = this.memberController;

    // Stops people from guessing details or passwords: 10 attempts / 15 min / IP (counted separately)
    const limiter = (max = 10) =>
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: "Too many attempts, try again later" },
      });

    this.router.get("/areas", c.listAreas); // public: area names for the register form
    this.router.post("/register", limiter(), c.register);
    this.router.post("/login", limiter(), c.login);
    this.router.post("/logout", c.logout);
    // Everything below requires a valid member session
    const guard = this.authMiddleware.requireMember;
    this.router.get("/me", guard, c.me);

    // My work: any member sees what was assigned to them and ticks it off
    this.router.get("/tasks", guard, c.myTasks);
    this.router.patch("/tasks/:id", guard, c.setTaskDone);

    // Team leader tools (the controller also checks that the member really is a team leader)
    this.router.get("/leader/me", guard, c.leaderMe);
    this.router.get("/leader/team", guard, c.leaderTeam);
    this.router.post("/leader/tasks", guard, c.leaderAssign);

    // Files and links: any member sees what their own leader shared; only leaders add or remove
    this.router.get("/resources", guard, c.listResources);
    this.router.get("/resources/:id/file", guard, c.downloadResource);
    this.router.post("/leader/resources/link", guard, c.leaderAddLink);
    this.router.post(
      "/leader/resources/file",
      guard, // sign-in is checked before the upload is read
      limiter(30),
      express.raw({ type: "application/octet-stream", limit: "10mb" }), // raw file bytes, no extra package
      c.leaderUploadFile
    );
    this.router.delete("/leader/resources/:id", guard, c.leaderDeleteResource);
  }
}

module.exports = { AdminRoutes, MemberRoutes };