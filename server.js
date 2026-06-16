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
    createdAt: u.createdAt,
  };
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
      trips: Array.isArray(trips) ? trips : [],
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
    if (trips !== undefined) pin.trips = trips;

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

// ─── Error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  // Invalid ObjectId etc.
  if (err.name === 'CastError') return res.status(400).json({ error: 'bad id' });
  res.status(500).json({ error: 'server error' });
});

app.listen(PORT, () => console.log(`✓ API running on ${SERVER_URL}`));
