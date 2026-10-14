const mongoose = require("mongoose");

/* -------------------------------------------------------------------------
 * Allowed uploads. The server decides the content type from the file name and
 * checks the first bytes of the file, so a renamed file can't sneak through.
 * ------------------------------------------------------------------------- */
const MAX_FILE_MB = 10;
const ZIP = [[0x50, 0x4b, 0x03, 0x04]]; // .docx / .xlsx / .pptx are zip files
const OLE = [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]]; // old .doc / .xls / .ppt
const FILE_TYPES = {
  png: { mime: "image/png", sig: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", sig: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", sig: [[0xff, 0xd8, 0xff]] },
  gif: { mime: "image/gif", sig: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: "image/webp", check: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
  pdf: { mime: "application/pdf", sig: [[0x25, 0x50, 0x44, 0x46]] },
  doc: { mime: "application/msword", sig: OLE },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sig: ZIP },
  xls: { mime: "application/vnd.ms-excel", sig: OLE },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sig: ZIP },
  ppt: { mime: "application/vnd.ms-powerpoint", sig: OLE },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sig: ZIP },
  txt: { mime: "text/plain; charset=utf-8", text: true },
  csv: { mime: "text/csv; charset=utf-8", text: true },
};

/* =========================================================================
 * AdminController — admin login + areas of work + member management
 * ========================================================================= */
class AdminController {
  constructor(adminAuthService, config, models) {
    this.adminAuthService = adminAuthService;
    this.config = config;
    this.Area = models.Area;
    this.Member = models.Member;
    this.Task = models.Task;
    this.Resource = models.Resource;

    [
      "login", "logout", "me", "dashboard",
      "listAreas", "createArea", "deleteArea",
      "listMembers", "createMember", "deleteMember",
      "setTeamLeader", "removeTeamLeader",
    ].forEach((name) => (this[name] = this[name].bind(this)));
  }

  get cookieOptions() {
    return { httpOnly: true, secure: this.config.isProd, sameSite: "lax", path: "/" };
  }

  #fail(res, status, message) {
    return res.status(status).json({ success: false, message });
  }

  #handleError(err, res) {
    if (err.name === "ValidationError") {
      return this.#fail(res, 400, Object.values(err.errors)[0]?.message || "Invalid data");
    }
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      return this.#fail(res, 409, field === "email" ? "A member with this email already exists" : "This area already exists");
    }
    console.error(err);
    return this.#fail(res, 500, "Server error");
  }

  // ---------- auth ----------
  login(req, res) {
    const { email, password } = req.body || {};
    if (!this.adminAuthService.validateCredentials(email, password)) {
      return this.#fail(res, 401, "Invalid email or password");
    }
    const token = this.adminAuthService.issueToken();
    res.cookie("admin_token", token, { ...this.cookieOptions, maxAge: 60 * 60 * 1000 });
    return res.json({ success: true, message: "Login successful" });
  }

  logout(req, res) {
    res.clearCookie("admin_token", this.cookieOptions);
    return res.json({ success: true, message: "Logged out" });
  }

  me(req, res) {
    return res.json({ success: true, role: "admin" });
  }

  dashboard(req, res) {
    return res.json({ success: true, data: { message: "Welcome to the admin dashboard" } });
  }

  // ---------- areas of work ----------
  async listAreas(req, res) {
    try {
      const data = await this.Area.find().collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();
      return res.json({ success: true, data });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async createArea(req, res) {
    try {
      // String() blocks object payloads such as {"$gt": ""}
      const name = String(req.body?.name ?? "").trim();
      if (!name) return this.#fail(res, 400, "Area name is required");
      const area = await this.Area.create({ name });
      return res.status(201).json({ success: true, data: area });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async deleteArea(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid area id");
      if (await this.Member.exists({ area: id })) {
        return this.#fail(res, 409, "This area is used by existing members. Remove them first.");
      }
      const deleted = await this.Area.findByIdAndDelete(id);
      if (!deleted) return this.#fail(res, 404, "Area not found");
      await this.Resource.deleteMany({ area: id });
      return res.json({ success: true, message: "Area deleted" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // ---------- members ----------
  async listMembers(req, res) {
    try {
      const data = await this.Member.find().populate("area", "name").sort({ createdAt: -1 }).lean();
      return res.json({ success: true, data });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async createMember(req, res) {
    try {
      const b = req.body || {};
      const years = Number(b.yearsOfExperience);
      if (b.yearsOfExperience === "" || b.yearsOfExperience == null || !Number.isInteger(years)) {
        return this.#fail(res, 400, "Years of experience must be a whole number");
      }

      // Whitelist fields and coerce to strings (no mass-assignment, no operator injection)
      const data = {
        name: String(b.name ?? "").trim(),
        fatherName: String(b.fatherName ?? "").trim(),
        email: String(b.email ?? "").trim(),
        area: String(b.area ?? "").trim(),
        yearsOfExperience: years,
      };

      if (!mongoose.isValidObjectId(data.area) || !(await this.Area.exists({ _id: data.area }))) {
        return this.#fail(res, 400, "Selected area of expertise does not exist");
      }

      const member = await this.Member.create(data);
      await member.populate("area", "name");
      return res.status(201).json({ success: true, data: member });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async deleteMember(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid member id");
      const deleted = await this.Member.findByIdAndDelete(id);
      if (!deleted) return this.#fail(res, 404, "Member not found");
      await this.Task.deleteMany({ assignedTo: id });
      return res.json({ success: true, message: "Member deleted" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // ---------- team leaders (one per area of work) ----------
  async setTeamLeader(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid member id");

      const member = await this.Member.findById(id).select("area").lean();
      if (!member) return this.#fail(res, 404, "Member not found");

      // A team has one leader: whoever led this area before steps down
      await this.Member.updateMany(
        { area: member.area, isTeamLeader: true, _id: { $ne: member._id } },
        { $set: { isTeamLeader: false } }
      );
      await this.Member.updateOne({ _id: member._id }, { $set: { isTeamLeader: true } });
      return res.json({ success: true, message: "Team leader assigned" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async removeTeamLeader(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid member id");
      const result = await this.Member.updateOne({ _id: id }, { $set: { isTeamLeader: false } });
      if (result.matchedCount === 0) return this.#fail(res, 404, "Member not found");
      return res.json({ success: true, message: "Team leader removed" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }
}

/* =========================================================================
 * MemberController — registration, login, my work, team leader tools, shared files
 * ========================================================================= */
class MemberController {
  constructor(adminAuthService, config, models) {
    this.adminAuthService = adminAuthService;
    this.config = config;
    this.Area = models.Area;
    this.Member = models.Member;
    this.Task = models.Task;
    this.Resource = models.Resource;

    [
      "listAreas", "register", "login", "logout", "me",
      "myTasks", "setTaskDone",
      "leaderMe", "leaderTeam", "leaderAssign",
      "listResources", "downloadResource",
      "leaderAddLink", "leaderUploadFile", "leaderDeleteResource",
    ].forEach((name) => (this[name] = this[name].bind(this)));
  }

  get cookieOptions() {
    return { httpOnly: true, secure: this.config.isProd, sameSite: "lax", path: "/" };
  }

  #fail(res, status, message) {
    return res.status(status).json({ success: false, message });
  }

  #handleError(err, res) {
    if (err.name === "ValidationError") {
      return this.#fail(res, 400, Object.values(err.errors)[0]?.message || "Invalid data");
    }
    console.error(err);
    return this.#fail(res, 500, "Server error");
  }

  #startSession(res, memberId) {
    const token = this.adminAuthService.issueMemberToken(memberId);
    res.cookie("member_token", token, { ...this.cookieOptions, maxAge: 24 * 60 * 60 * 1000 });
  }

  #progress(tasks) {
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  // Looks a file up in FILE_TYPES by extension, then checks the real bytes. Returns null if not allowed.
  #fileType(fileName, buf) {
    const ext = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    const def = Object.prototype.hasOwnProperty.call(FILE_TYPES, ext) ? FILE_TYPES[ext] : null;
    if (!def) return null;
    if (def.sig && !def.sig.some((sig) => sig.every((byte, i) => buf[i] === byte))) return null;
    if (def.check && !def.check(buf)) return null;
    if (def.text && buf.includes(0)) return null; // text files never contain NUL bytes
    return def;
  }

  #publicResource(r) {
    return {
      _id: r._id,
      kind: r.kind,
      title: r.title || "",
      url: r.url || null,
      fileName: r.fileName || null,
      fileType: r.fileType || null,
      fileSize: r.fileSize || null,
      isImage: Boolean(r.fileType && r.fileType.startsWith("image/")),
      sharedBy: r.uploadedBy?.name ?? null,
      createdAt: r.createdAt,
    };
  }

  // Loads the signed-in member from the database and makes sure they are a team leader.
  // Checked on every request, so removing someone as leader takes effect immediately.
  async #leader(req, res) {
    const leader = await this.Member.findById(req.memberId).select("name area isTeamLeader").lean();
    if (!leader) {
      res.clearCookie("member_token", this.cookieOptions);
      this.#fail(res, 401, "Account no longer exists");
      return null;
    }
    if (!leader.isTeamLeader) {
      this.#fail(res, 403, "Team leader access only");
      return null;
    }
    return leader;
  }

  // ---------- registration and login ----------

  // Public: only area names, so the register form can show its dropdown
  async listAreas(req, res) {
    try {
      const data = await this.Area.find().collation({ locale: "en", strength: 2 }).sort({ name: 1 }).select("name").lean();
      return res.json({ success: true, data });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // Step 1: details must match a member record created by the admin.
  // Step 2: that record must not be registered yet; the chosen password is then saved (hashed).
  async register(req, res) {
    try {
      const b = req.body || {};
      const name = String(b.name ?? "").trim();
      const fatherName = String(b.fatherName ?? "").trim();
      const email = String(b.email ?? "").trim().toLowerCase();
      const area = String(b.area ?? "").trim();
      const years = Number(b.yearsOfExperience);
      const password = typeof b.password === "string" ? b.password : "";

      if (!name || !fatherName || !email || !area || b.yearsOfExperience === "" || b.yearsOfExperience == null) {
        return this.#fail(res, 400, "Please fill in all the fields");
      }
      if (!Number.isInteger(years)) {
        return this.#fail(res, 400, "Years of experience must be a whole number");
      }
      if (password.length < 8) return this.#fail(res, 400, "Password must be at least 8 characters");
      if (password.length > 128) return this.#fail(res, 400, "Password must be at most 128 characters");

      // One generic message for every kind of mismatch: it never reveals which field was wrong
      const mismatch = "These details don't match our records. Check them or contact your admin.";
      if (!mongoose.isValidObjectId(area)) return this.#fail(res, 401, mismatch);

      const member = await this.Member.findOne({ name, fatherName, email, area, yearsOfExperience: years })
        .collation({ locale: "en", strength: 2 }) // case-insensitive text match
        .select("+passwordHash")
        .lean();

      if (!member) return this.#fail(res, 401, mismatch);

      const taken = "This member is already registered. Please log in instead.";
      if (member.passwordHash) return this.#fail(res, 409, taken);

      const passwordHash = await this.adminAuthService.hashPassword(password);

      // Only succeeds if nobody registered this member in the meantime
      const result = await this.Member.updateOne(
        { _id: member._id, passwordHash: { $exists: false } },
        { $set: { passwordHash } }
      );
      if (result.modifiedCount !== 1) return this.#fail(res, 409, taken);

      this.#startSession(res, member._id);
      return res.json({ success: true, message: "Registration complete" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async login(req, res) {
    try {
      const b = req.body || {};
      const email = String(b.email ?? "").trim().toLowerCase();
      const password = typeof b.password === "string" ? b.password : "";
      if (!email || !password) return this.#fail(res, 400, "Enter your email and password");

      const bad = "Incorrect email or password";
      if (password.length > 128) return this.#fail(res, 401, bad);

      const member = await this.Member.findOne({ email }).select("+passwordHash").lean();

      // Always run the hash check (even for unknown emails) so response time doesn't reveal who exists
      const ok = await this.adminAuthService.verifyPassword(password, member?.passwordHash);
      if (!member || !member.passwordHash || !ok) return this.#fail(res, 401, bad);

      this.#startSession(res, member._id);
      return res.json({ success: true, message: "Login successful" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  logout(req, res) {
    res.clearCookie("member_token", this.cookieOptions);
    return res.json({ success: true, message: "Logged out" });
  }

  // Looks the member up again on every call, so a member the admin deletes loses access immediately
  async me(req, res) {
    try {
      const member = await this.Member.findById(req.memberId).populate("area", "name").lean();
      if (!member) {
        res.clearCookie("member_token", this.cookieOptions);
        return this.#fail(res, 401, "Account no longer exists");
      }
      return res.json({
        success: true,
        data: { name: member.name, area: member.area?.name ?? null, isTeamLeader: Boolean(member.isTeamLeader) },
      });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // ---------- my work (any member) ----------
  async myTasks(req, res) {
    try {
      const tasks = await this.Task.find({ assignedTo: req.memberId })
        .sort({ createdAt: -1 })
        .select("title done createdAt doneAt")
        .lean();
      return res.json({ success: true, data: { tasks, progress: this.#progress(tasks) } });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // The tick: a member can only change work that was assigned to them
  async setTaskDone(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid work id");
      if (typeof req.body?.done !== "boolean") return this.#fail(res, 400, "done must be true or false");

      const done = req.body.done;
      const task = await this.Task.findOneAndUpdate(
        { _id: id, assignedTo: req.memberId },
        { $set: { done, doneAt: done ? new Date() : null } },
        { new: true }
      )
        .select("title done createdAt doneAt")
        .lean();

      if (!task) return this.#fail(res, 404, "Work not found");
      return res.json({ success: true, data: task });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // ---------- team leader tools ----------
  async leaderMe(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;
      return res.json({ success: true, data: { name: leader.name } });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // Everything the team leader dashboard shows: the team, each member's work and progress, overall progress
  async leaderTeam(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;

      const [area, members, tasks] = await Promise.all([
        this.Area.findById(leader.area).select("name").lean(),
        this.Member.find({ area: leader.area, _id: { $ne: leader._id } }).sort({ name: 1 }).select("name").lean(),
        this.Task.find({ area: leader.area }).sort({ createdAt: -1 }).limit(2000).select("title done assignedTo createdAt doneAt").lean(),
      ]);

      const team = members.map((m) => {
        const mine = tasks.filter((t) => String(t.assignedTo) === String(m._id));
        return { _id: m._id, name: m.name, ...this.#progress(mine), tasks: mine };
      });

      // Overall progress counts the work of the members listed above
      const overall = this.#progress(team.flatMap((m) => m.tasks));

      return res.json({
        success: true,
        data: { leader: { name: leader.name, area: area?.name ?? null }, members: team, overall },
      });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async leaderAssign(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;

      const b = req.body || {};
      const title = String(b.title ?? "").trim();
      const memberId = String(b.memberId ?? "").trim();

      if (!title) return this.#fail(res, 400, "Describe the work to assign");
      if (!mongoose.isValidObjectId(memberId)) return this.#fail(res, 400, "Choose a team member");
      if (String(leader._id) === memberId) return this.#fail(res, 400, "You can't assign work to yourself");

      // Only people in the leader's own area of work can receive their work
      const member = await this.Member.findOne({ _id: memberId, area: leader.area }).select("_id").lean();
      if (!member) return this.#fail(res, 404, "That person is not in your team");

      const task = await this.Task.create({
        title,
        assignedTo: member._id,
        assignedBy: leader._id,
        area: leader.area,
      });

      return res.status(201).json({
        success: true,
        data: { _id: task._id, title: task.title, done: false, assignedTo: task.assignedTo, createdAt: task.createdAt },
      });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // ---------- shared files and links ----------

  // Any member: only what the leader of THEIR OWN area shared. Other areas' items are never returned.
  async listResources(req, res) {
    try {
      const me = await this.Member.findById(req.memberId).select("area").lean();
      if (!me) return this.#fail(res, 401, "Account no longer exists");

      const items = await this.Resource.find({ area: me.area })
        .sort({ createdAt: -1 })
        .limit(200)
        .select("kind title url fileName fileType fileSize createdAt uploadedBy")
        .populate("uploadedBy", "name")
        .lean();

      return res.json({ success: true, data: items.map((r) => this.#publicResource(r)) });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // Sends the file itself, but only to members of the area it was shared with
  async downloadResource(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid file id");

      const me = await this.Member.findById(req.memberId).select("area").lean();
      if (!me) return this.#fail(res, 401, "Account no longer exists");

      const file = await this.Resource.findOne({ _id: id, area: me.area, kind: "file" }).select("+data fileName fileType");
      if (!file || !file.data) return this.#fail(res, 404, "File not found");

      // Pictures can show inside the page; everything else is downloaded, never opened by the browser
      const inline = file.fileType.startsWith("image/");
      const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

      res.set({
        "Content-Type": file.fileType,
        "Content-Length": file.data.length,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      });
      return res.end(file.data);
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  async leaderAddLink(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;

      let raw = String(req.body?.url ?? "").trim();
      const title = String(req.body?.title ?? "").trim();
      if (!raw) return this.#fail(res, 400, "Enter a web link");
      if (title.length > 120) return this.#fail(res, 400, "The title must be at most 120 characters");
      if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`; // "example.com" works too

      let url;
      try {
        url = new URL(raw);
      } catch {
        return this.#fail(res, 400, "Enter a valid web link, like https://example.com");
      }
      if (!["http:", "https:"].includes(url.protocol)) return this.#fail(res, 400, "Only http and https links are allowed");
      if (url.username || url.password) return this.#fail(res, 400, "Links that contain a username or password aren't allowed");
      if (url.href.length > 2048) return this.#fail(res, 400, "That link is too long");

      const item = await this.Resource.create({
        area: leader.area,
        uploadedBy: leader._id,
        kind: "link",
        title,
        url: url.href,
      });
      return res.status(201).json({ success: true, data: this.#publicResource(item) });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // The browser sends the raw file bytes (no multipart), with the name in the X-File-Name header
  async leaderUploadFile(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return this.#fail(res, 400, "Choose a file to upload");

      const decode = (value) => {
        try {
          return decodeURIComponent(String(value ?? ""));
        } catch {
          return "";
        }
      };
      const fileName = decode(req.get("x-file-name")).replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 150);
      const title = decode(req.get("x-file-title")).trim().slice(0, 120);
      if (!fileName) return this.#fail(res, 400, "The file needs a name");

      const type = this.#fileType(fileName, body);
      if (!type) {
        return this.#fail(res, 400, "This file type isn't allowed. Use an image, PDF, Word, Excel, PowerPoint, text or CSV file.");
      }

      const item = await this.Resource.create({
        area: leader.area,
        uploadedBy: leader._id,
        kind: "file",
        title,
        fileName,
        fileType: type.mime,
        fileSize: body.length,
        data: body,
      });
      return res.status(201).json({ success: true, data: this.#publicResource(item) });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }

  // A leader can remove anything shared with their own team
  async leaderDeleteResource(req, res) {
    try {
      const leader = await this.#leader(req, res);
      if (!leader) return;

      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) return this.#fail(res, 400, "Invalid id");

      const result = await this.Resource.deleteOne({ _id: id, area: leader.area });
      if (result.deletedCount === 0) return this.#fail(res, 404, "Not found");
      return res.json({ success: true, message: "Removed" });
    } catch (err) {
      return this.#handleError(err, res);
    }
  }
}

module.exports = { AdminController, MemberController };