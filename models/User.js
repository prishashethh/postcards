const mongoose = require('mongoose');

// A favorite trip reference for the profile "Top 5" section.
const top5Schema = new mongoose.Schema(
  {
    pinId: String,        // Pin _id (as string)
    tripId: String,       // client-generated trip id within that pin
    photoIndex: { type: Number, default: 0 },
  },
  { _id: false }
);

// A free-text bucket-list entry on the profile page.
const bucketSchema = new mongoose.Schema(
  {
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    why: { type: String, default: '' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  // ─── From Google ───
  googleId: { type: String, required: true, unique: true, index: true },
  email: { type: String, default: '' },
  displayName: { type: String, default: '' },
  profilePic: { type: String, default: '' }, // Google avatar URL

  // ─── Editable profile fields ───
  avatar: { type: String, default: '' },      // custom uploaded avatar (Cloudinary), overrides profilePic
  bio: { type: String, default: '' },
  socials: {
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
  },
  top5: { type: [top5Schema], default: [] },
  bucket: { type: [bucketSchema], default: [] },

  // ─── Social graph ───
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // people I follow
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // people who follow me

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
