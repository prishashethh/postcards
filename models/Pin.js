const mongoose = require('mongoose');

// One visit to a city. Trips are embedded inside a Pin.
const tripSchema = new mongoose.Schema(
  {
    id: String, // client-generated id (kept stable across the frontend UI)
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    photos: { type: [String], default: [] }, // Cloudinary secure URLs
    restaurants: { type: String, default: '' },
    attractions: { type: String, default: '' },
    notes: { type: String, default: '' },
    postedAt: { type: Date, default: Date.now }, // when the trip was added (drives the social feed)
  },
  { _id: false }
);

const pinSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: { type: String, default: '' },      // city name
  country: { type: String, default: '' },    // as returned by the geocoder
  shadedAs: { type: String, default: '' },   // resolved GeoJSON country name used for map shading
  lat: Number,
  lng: Number,
  trips: { type: [tripSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Pin', pinSchema);
