// routes/listings.js — Unified Listings (Hotels/Rooms/Restaurants/Camps/Experiences)

const express = require('express');
const router = express.Router();
const { Listing, Booking } = require('../models');
const { protect, authorize } = require('../middleware/auth');

// GET /api/listings — Search with filters (supports map bounding box)
router.get('/', async (req, res) => {
  try {
    const { category, city, minPrice, maxPrice, guests, amenities, tags, lat, lng, radiusKm, page = 1, limit = 20 } = req.query;

    const filter = { status: 'active' };
    if (category) filter.category = category;
    if (city) filter['location.city'] = new RegExp(city, 'i');
    if (minPrice || maxPrice) {
      filter.pricePerNight = {};
      if (minPrice) filter.pricePerNight.$gte = parseInt(minPrice);
      if (maxPrice) filter.pricePerNight.$lte = parseInt(maxPrice);
    }
    if (guests) filter.maxGuests = { $gte: parseInt(guests) };
    if (amenities) filter.amenities = { $all: amenities.split(',') };
    if (tags) filter.tags = { $in: tags.split(',') };

    // Simple radius filter (approximate, for map "near me")
    if (lat && lng && radiusKm) {
      const latNum = parseFloat(lat), lngNum = parseFloat(lng), rad = parseFloat(radiusKm);
      const latDelta = rad / 111; // approx km per degree latitude
      const lngDelta = rad / (111 * Math.cos(latNum * Math.PI / 180));
      filter['location.lat'] = { $gte: latNum - latDelta, $lte: latNum + latDelta };
      filter['location.lng'] = { $gte: lngNum - lngDelta, $lte: lngNum + lngDelta };
    }

    const total = await Listing.countDocuments(filter);
    const listings = await Listing.find(filter)
      .populate('owner', 'name phone avatar')
      .populate('destination', 'name state emoji')
      .sort('-isFeatured -avgRating -createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, total, page: parseInt(page), listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/listings/my — Owner's own listings
router.get('/my', protect, authorize('owner', 'admin'), async (req, res) => {
  try {
    const listings = await Listing.find({ owner: req.user.id }).sort('-createdAt');
    res.json({ success: true, count: listings.length, listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/listings/:id — Detail (with nearby places for hotel detail page)
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('owner', 'name phone avatar')
      .populate('destination', 'name state emoji crowdLevel season');
    if (!listing) return res.status(404).json({ success: false, message: 'Listing nahi mila.' });

    // Find nearby listings (within ~5km approx) for "nearby restaurants/attractions"
    const { lat, lng } = listing.location;
    const delta = 0.05; // ~5km
    const nearby = await Listing.find({
      _id: { $ne: listing._id },
      status: 'active',
      'location.lat': { $gte: lat - delta, $lte: lat + delta },
      'location.lng': { $gte: lng - delta, $lte: lng + delta },
    }).limit(10).select('title category emoji location avgRating images');

    res.json({ success: true, listing, nearby });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/listings — Create (owner)
router.post('/', protect, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { location } = req.body;
    if (!location?.lat || !location?.lng) {
      return res.status(400).json({ success: false, message: 'Location (lat/lng) zaroori hai — pin drop, GPS, ya address search se set karo.' });
    }
    const listing = await Listing.create({ ...req.body, owner: req.user.id });
    res.status(201).json({ success: true, message: 'Listing create ho gaya! Admin review karega.', listing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/listings/:id
router.put('/:id', protect, authorize('owner', 'admin'), async (req, res) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, owner: req.user.id });
    if (!listing && req.user.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Listing nahi mila ya permission nahi.' });
    }
    const updated = await Listing.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ success: true, message: 'Update ho gaya!', listing: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/listings/:id
router.delete('/:id', protect, authorize('owner', 'admin'), async (req, res) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, owner: req.user.id });
    if (!listing && req.user.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Permission nahi.' });
    }
    await Listing.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Listing delete ho gaya!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/listings/owner/earnings — Owner earnings dashboard
router.get('/owner/earnings', protect, authorize('owner'), async (req, res) => {
  try {
    const listings = await Listing.find({ owner: req.user.id }, 'title totalEarnings totalBookings avgRating category');
    const totalEarnings = listings.reduce((s, l) => s + (l.totalEarnings || 0), 0);
    const totalBookings = listings.reduce((s, l) => s + (l.totalBookings || 0), 0);
    res.json({ success: true, totalEarnings, totalBookings, listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
