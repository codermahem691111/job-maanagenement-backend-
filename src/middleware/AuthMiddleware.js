class AuthMiddleware {
  constructor(adminAuthService) {
    this.adminAuthService = adminAuthService;
    this.requireAdmin = this.requireAdmin.bind(this);
    this.requireMember = this.requireMember.bind(this);
  }

  requireAdmin(req, res, next) {
    const token = req.cookies?.admin_token;
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    try {
      req.admin = this.adminAuthService.verifyToken(token);
      next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }
  }

  requireMember(req, res, next) {
    const token = req.cookies?.member_token;
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    try {
      req.memberId = this.adminAuthService.verifyMemberToken(token).sub;
      next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }
  }
}

module.exports = AuthMiddleware;