require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const User = require('./models/User');
const Pin = require('./models/Pin');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5500';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// ─── Database ────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✓ MongoDB connected'))
  .catch((err) => {
    console.error('✗ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ─── Cloudinary ──────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Core middleware ─────────────────────────────────────────────────────
// CORS must allow credentials so the session cookie is sent on fetch().
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Behind a proxy in production (e.g. Render/Heroku) this lets secure cookies work.
app.set('trust proxy', 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // localhost:5500 and localhost:3000 are "same-site" (ports are ignored),
      // so 'lax' works locally. For two DIFFERENT domains in production, switch
      // to sameSite: 'none' and secure: true (requires HTTPS).
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ─── Passport / Google OAuth ─────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${SERVER_URL}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails?.[0]?.value || '',
            displayName: profile.displayName || '',
            profilePic: profile.photos?.[0]?.value || '',
          });
        }
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

// ─── Auth routes ─────────────────────────────────────────────────────────
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${CLIENT_URL}/index.html?login=failed`,
  }),
  (req, res) => res.redirect(`${CLIENT_URL}/index.html`)
);

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.redirect(`${CLIENT_URL}/index.html`);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect(`${CLIENT_URL}/index.html`);
    });
  });
});

// ─── Auth guard for all /api/* routes ────────────────────────────────────
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// Small wrapper so thrown errors in async handlers become 500s instead of hangs.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    googleId: u.googleId,
    email: u.email,
    displayName: u.displayName,
    profilePic: u.profilePic,
    avatar: u.avatar,
    bio: u.bio,
    socials: u.socials,
    top5: u.top5,
    bucket: u.bucket,
    followersCount: (u.followers || []).length,
    followingCount: (u.following || []).length,
    createdAt: u.createdAt,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal public info for list views (followers/following, search).
function publicMini(u) {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    avatar: u.avatar,
    profilePic: u.profilePic,
  };
}

// Keep each trip's postedAt authoritative on the server: preserve it for trips
// that already existed (matched by client id), stamp "now" for brand-new trips.
function stampTrips(incomingTrips, existingTrips = []) {
  const prev = {};
  (existingTrips || []).forEach((t) => { if (t.id) prev[t.id] = t.postedAt; });
  return (incomingTrips || []).map((t) => ({
    ...t,
    postedAt: prev[t.id] || t.postedAt || new Date(),
  }));
}

// ─── Current user ────────────────────────────────────────────────────────
app.get('/api/me', ensureAuth, (req, res) => {
  res.json(sanitizeUser(req.user));
});

// Update editable profile fields (never googleId/email).
app.put(
  '/api/me',
  ensureAuth,
  asyncH(async (req, res) => {
    const allowed = ['displayName', 'bio', 'socials', 'avatar', 'top5', 'bucket'];
    const update = {};
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    res.json(sanitizeUser(user));
  })
);

// ─── Pins ────────────────────────────────────────────────────────────────
app.get(
  '/api/pins',
  ensureAuth,
  asyncH(async (req, res) => {
    const pins = await Pin.find({ userId: req.user.id }).sort({ createdAt: 1 });
    res.json(pins);
  })
);

app.post(
  '/api/pins',
  ensureAuth,
  asyncH(async (req, res) => {
    const { name, country, shadedAs, lat, lng, trips } = req.body;
    const pin = await Pin.create({
      userId: req.user.id,
      name,
      country,
      shadedAs,
      lat,
      lng,
      trips: stampTrips(Array.isArray(trips) ? trips : []),
    });
    res.status(201).json(pin);
  })
);

app.put(
  '/api/pins/:id',
  ensureAuth,
  asyncH(async (req, res) => {
    const pin = await Pin.findOne({ _id: req.params.id, userId: req.user.id });
    if (!pin) return res.status(404).json({ error: 'pin not found' });

    const { name, country, shadedAs, lat, lng, trips } = req.body;
    if (name !== undefined) pin.name = name;
    if (country !== undefined) pin.country = country;
    if (shadedAs !== undefined) pin.shadedAs = shadedAs;
    if (lat !== undefined) pin.lat = lat;
    if (lng !== undefined) pin.lng = lng;
    if (trips !== undefined) pin.trips = stampTrips(trips, pin.trips);

    await pin.save();
    res.json(pin);
  })
);

app.delete(
  '/api/pins/:id',
  ensureAuth,
  asyncH(async (req, res) => {
    const removed = await Pin.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!removed) return res.status(404).json({ error: 'pin not found' });
    res.status(204).end();
  })
);

// ─── Photo upload ────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

app.post(
  '/api/photos',
  ensureAuth,
  upload.single('photo'),
  asyncH(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'postcards', resource_type: 'image' },
        (err, uploaded) => (err ? reject(err) : resolve(uploaded))
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url, publicId: result.public_id });
  })
);

// ─── Social: search, public profiles, follow, feed ───────────────────────

// Search other users by (partial) email.
app.get(
  '/api/users/search',
  ensureAuth,
  asyncH(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ email: rx, _id: { $ne: req.user.id } }).limit(20);
    const followingSet = new Set((req.user.following || []).map((id) => id.toString()));
    res.json(
      users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        avatar: u.avatar,
        profilePic: u.profilePic,
        followersCount: (u.followers || []).length,
        isFollowing: followingSet.has(u.id),
      }))
    );
  })
);

// Public view of a single user's profile.
app.get(
  '/api/users/:id',
  ensureAuth,
  asyncH(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'user not found' });
    const isSelf = u.id === req.user.id;
    const isFollowing = (req.user.following || []).some((id) => id.toString() === u.id);
    res.json({ ...sanitizeUser(u), isSelf, isFollowing });
  })
);

// A user's pins (public — used to render their profile: top 5, stamps, year in review).
app.get(
  '/api/users/:id/pins',
  ensureAuth,
  asyncH(async (req, res) => {
    const pins = await Pin.find({ userId: req.params.id }).sort({ createdAt: 1 });
    res.json(pins);
  })
);

// Who follows this user.
app.get(
  '/api/users/:id/followers',
  ensureAuth,
  asyncH(async (req, res) => {
    const u = await User.findById(req.params.id).populate('followers', 'displayName email avatar profilePic');
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json((u.followers || []).map(publicMini));
  })
);

// Who this user follows.
app.get(
  '/api/users/:id/following',
  ensureAuth,
  asyncH(async (req, res) => {
    const u = await User.findById(req.params.id).populate('following', 'displayName email avatar profilePic');
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json((u.following || []).map(publicMini));
  })
);

// Follow a user.
app.post(
  '/api/follow/:id',
  ensureAuth,
  asyncH(async (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user.id) return res.status(400).json({ error: "can't follow yourself" });
    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ error: 'user not found' });
    await User.updateOne({ _id: req.user.id }, { $addToSet: { following: target._id } });
    await User.updateOne({ _id: target._id }, { $addToSet: { followers: req.user._id } });
    res.json({ following: true });
  })
);

// Unfollow a user.
app.delete(
  '/api/follow/:id',
  ensureAuth,
  asyncH(async (req, res) => {
    const targetId = req.params.id;
    await User.updateOne({ _id: req.user.id }, { $pull: { following: targetId } });
    await User.updateOne({ _id: targetId }, { $pull: { followers: req.user.id } });
    res.json({ following: false });
  })
);

// The mailbox feed: recent postcards (trips posted in the last 30 days) from
// everyone the current user follows, newest first.
app.get(
  '/api/feed',
  ensureAuth,
  asyncH(async (req, res) => {
    const following = req.user.following || [];
    if (!following.length) return res.json([]);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const authors = await User.find({ _id: { $in: following } }).select(
      'displayName avatar profilePic email'
    );
    const authorMap = {};
    authors.forEach((a) => { authorMap[a.id] = a; });

    const pins = await Pin.find({ userId: { $in: following } });
    const entries = [];
    pins.forEach((p) => {
      const a = authorMap[p.userId.toString()];
      if (!a) return;
      (p.trips || []).forEach((t) => {
        if (t.postedAt && new Date(t.postedAt) >= cutoff) {
          entries.push({
            author: {
              id: a.id,
              name: a.displayName,
              avatar: a.avatar || a.profilePic || '',
            },
            pinId: p.id,
            city: p.name,
            country: p.country,
            trip: t,
            postedAt: t.postedAt,
          });
        }
      });
    });
    entries.sort((x, y) => new Date(y.postedAt) - new Date(x.postedAt));
    res.json(entries);
  })
);

// ─── Error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  // Invalid ObjectId etc.
  if (err.name === 'CastError') return res.status(400).json({ error: 'bad id' });
  res.status(500).json({ error: 'server error' });
});

app.listen(PORT, () => console.log(`✓ API running on ${SERVER_URL}`));
