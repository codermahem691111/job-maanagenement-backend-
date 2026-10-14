const mongoose = require("mongoose");

const areaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Area name is required"],
      trim: true,
      minlength: [2, "Area name must be at least 2 characters"],
      maxlength: [50, "Area name must be at most 50 characters"],
    },
  },
  { timestamps: true }
);
// "UI/UX" and "ui/ux" count as the same area
areaSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [80, "Name must be at most 80 characters"],
    },
    fatherName: {
      type: String,
      required: [true, "Father's name is required"],
      trim: true,
      minlength: [2, "Father's name must be at least 2 characters"],
      maxlength: [80, "Father's name must be at most 80 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
    },
    area: { type: mongoose.Schema.Types.ObjectId, ref: "Area", required: [true, "Area of expertise is required"] },
    // Set when the member registers. select:false keeps it out of every normal query.
    passwordHash: { type: String, select: false },
    // Set by the admin. One team leader per area of work.
    isTeamLeader: { type: Boolean, default: false },
    yearsOfExperience: {
      type: Number,
      required: [true, "Years of experience is required"],
      min: [0, "Years of experience cannot be negative"],
      max: [60, "Years of experience cannot be more than 60"],
      validate: { validator: Number.isInteger, message: "Years of experience must be a whole number" },
    },
  },
  { timestamps: true }
);

// Work that a team leader assigns to a member of their team
const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Describe the work to assign"],
      trim: true,
      minlength: [2, "The work description must be at least 2 characters"],
      maxlength: [300, "The work description must be at most 300 characters"],
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true },
    area: { type: mongoose.Schema.Types.ObjectId, ref: "Area", required: true, index: true },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Files and web links a team leader shares with their own team (same area of work)
const resourceSchema = new mongoose.Schema(
  {
    area: { type: mongoose.Schema.Types.ObjectId, ref: "Area", required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true },
    kind: { type: String, enum: ["file", "link"], required: true },
    title: { type: String, trim: true, maxlength: [120, "The title must be at most 120 characters"], default: "" },
    url: { type: String, trim: true, maxlength: 2048 }, // links
    fileName: { type: String, maxlength: 200 }, // files
    fileType: { type: String, maxlength: 120 }, // decided by the server, never taken from the client
    fileSize: { type: Number },
    data: { type: Buffer, select: false }, // the file itself; never returned by normal queries
  },
  { timestamps: true }
);

const Area = mongoose.models.Area || mongoose.model("Area", areaSchema);
const Member = mongoose.models.Member || mongoose.model("Member", memberSchema);
const Task = mongoose.models.Task || mongoose.model("Task", taskSchema);
const Resource = mongoose.models.Resource || mongoose.model("Resource", resourceSchema);

class Database {
  constructor(uri) {
    this.uri = uri;
  }

  async connect() {
    await mongoose.connect(this.uri);
    await Promise.all([Area.init(), Member.init(), Task.init(), Resource.init()]); // make sure unique indexes exist
    console.log("MongoDB connected");
  }
}

module.exports = Database;
module.exports.Area = Area;
module.exports.Member = Member;
module.exports.Task = Task;
module.exports.Resource = Resource;