// ============================================
// TripGenius AI — Remaining Routes (V2)
// ============================================

const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const { Vehicle, Listing, Booking, Review, GroupTrip, Destination, User, Trip, Wishlist, Payment, Coupon } = require('../models');

// ==========================================
// VEHICLES ROUTER (Bikes/Cars/Taxis)
// ==========================================
const vehicleRouter = express.Router();

vehicleRouter.get('/', async (req, res) => {
  try {
    const { city, type, lat, lng, radiusKm, page = 1, limit = 20 } = req.query;
    const filter = { status: 'active', isAvailable: true };
    if (city) filter['location.city'] = new RegExp(city, 'i');
    if (type) filter.type = type;
    if (lat && lng && radiusKm) {
      const latNum = parseFloat(lat), lngNum = parseFloat(lng), rad = parseFloat(radiusKm);
      const d = rad / 111;
      filter['location.lat'] = { $gte: latNum - d, $lte: latNum + d };
      filter['location.lng'] = { $gte: lngNum - d, $lte: lngNum + d };
    }
    const vehicles = await Vehicle.find(filter).populate('provider', 'name phone')
      .sort('-avgRating').skip((page - 1) * limit).limit(parseInt(limit));
    res.json({ success: true, count: vehicles.length, vehicles });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

vehicleRouter.get('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate('provider', 'name phone');
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle nahi mila.' });
    res.json({ success: true, vehicle });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

vehicleRouter.post('/', protect, authorize('provider', 'owner', 'admin'), async (req, res) => {
  try {
    const { location } = req.body;
    if (!location?.lat || !location?.lng) return res.status(400).json({ success: false, message: 'Location zaroori hai.' });
    const vehicle = await Vehicle.create({ ...req.body, provider: req.user.id });
    res.status(201).json({ success: true, message: 'Vehicle listed ho gaya!', vehicle });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

vehicleRouter.patch('/:id/availability', protect, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, { isAvailable: req.body.isAvailable }, { new: true });
    res.json({ success: true, vehicle });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// BOOKINGS ROUTER (unified listing/vehicle, Razorpay-ready)
// ==========================================
const bookingRouter = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = process.env.RAZORPAY_KEY_ID ? new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
}) : null;

bookingRouter.post('/', protect, async (req, res) => {
  try {
    const { type, listingId, vehicleId, checkIn, checkOut, guests, notes, paymentMethod, couponCode } = req.body;
    let totalAmount = 0, commissionPct = 10;

    if (type === 'listing' && listingId) {
      const listing = await Listing.findById(listingId);
      if (!listing) return res.status(404).json({ success: false, message: 'Listing nahi mila.' });
      if (listing.status !== 'active') return res.status(400).json({ success: false, message: 'Listing available nahi hai.' });
      const nights = Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000));
      totalAmount = (listing.pricePerNight || 0) * nights;
      commissionPct = listing.commissionPct || 10;
    }
    if (type === 'vehicle' && vehicleId) {
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle nahi mila.' });
      totalAmount = vehicle.pricePerDay || vehicle.priceFlat || 0;
      commissionPct = vehicle.commissionPct || 15;
    }
    if (totalAmount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });

    // Coupon support — simple flat/percent discount, extend the Coupon model as needed
    let discount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (coupon && (!coupon.expiresAt || coupon.expiresAt > new Date())) {
        discount = coupon.type === 'percent' ? Math.round(totalAmount * coupon.value / 100) : coupon.value;
        discount = Math.min(discount, totalAmount - 1);
      }
    }
    const payableAmount = totalAmount - discount;
    const taxAmount = Math.round(payableAmount * 0.05); // 5% platform tax, adjust as needed
    const finalAmount = payableAmount + taxAmount;
    const commissionAmt = Math.round(payableAmount * commissionPct / 100);

    const booking = await Booking.create({
      user: req.user.id, type, listing: listingId, vehicle: vehicleId,
      checkIn, checkOut, guests, notes, totalAmount: finalAmount, commissionAmt,
      ownerAmount: payableAmount - commissionAmt,
      paymentMethod: paymentMethod || 'upi', paymentStatus: 'pending', status: 'pending',
      couponCode: couponCode || null, discountAmount: discount, taxAmount,
    });

    if (!razorpay) {
      // Razorpay keys not configured yet — booking stays pending, no order created
      return res.status(201).json({ success: true, message: 'Booking created. Add RAZORPAY_KEY_ID/SECRET to .env to enable payment.', booking, razorpayOrder: null });
    }

    const order = await razorpay.orders.create({
      amount: finalAmount * 100, // paise
      currency: 'INR',
      receipt: booking._id.toString(),
      notes: { bookingId: booking._id.toString(), userId: req.user.id },
    });

    await Payment.create({
      user: req.user.id, booking: booking._id, amount: finalAmount,
      method: paymentMethod || 'upi', status: 'created', razorpayOrderId: order.id,
    });

    res.status(201).json({
      success: true, message: 'Booking created — complete payment to confirm.',
      booking, razorpayOrder: order, razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

bookingRouter.get('/my', protect, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.id })
      .populate('listing', 'title location pricePerNight images category')
      .populate('vehicle', 'name vehicleModel pricePerDay')
      .sort('-createdAt');
    res.json({ success: true, count: bookings.length, bookings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

bookingRouter.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking nahi mili.' });
    if (status === 'completed' && booking.listing) {
      await Listing.findByIdAndUpdate(booking.listing, { $inc: { totalBookings: 1, totalEarnings: booking.ownerAmount } });
    }
    res.json({ success: true, message: `Booking ${status} ho gaya!`, booking });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

bookingRouter.patch('/:id/cancel', protect, async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, user: req.user.id });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking nahi mili.' });

    // Refund via Razorpay if payment was captured
    if (booking.paymentStatus === 'paid' && razorpay) {
      const payment = await Payment.findOne({ booking: booking._id, status: 'success' });
      if (payment?.razorpayPaymentId) {
        await razorpay.payments.refund(payment.razorpayPaymentId, { amount: booking.totalAmount * 100 });
        payment.status = 'refunded';
        await payment.save();
        booking.paymentStatus = 'refunded';
      }
    }
    booking.status = 'cancelled';
    booking.cancelReason = req.body.reason || '';
    await booking.save();
    res.json({ success: true, message: 'Booking cancelled' + (booking.paymentStatus === 'refunded' ? ' aur refund process ho gaya.' : '.'), booking });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Verifies the Razorpay payment signature server-side — this is the step that actually
// proves the payment is real and wasn't forged by a malicious client request.
bookingRouter.post('/:id/confirm-payment', protect, async (req, res) => {
  try {
    if (!razorpay) return res.status(400).json({ success: false, message: 'Razorpay not configured on server.' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification fields.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await Payment.findOneAndUpdate({ razorpayOrderId: razorpay_order_id }, { status: 'failed' });
      return res.status(400).json({ success: false, message: 'Payment signature verification failed — possible tampering.' });
    }

    await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, status: 'success' }
    );
    const booking = await Booking.findByIdAndUpdate(req.params.id, { paymentStatus: 'paid', status: 'confirmed' }, { new: true });
    res.json({ success: true, message: 'Payment verified and booking confirmed!', booking });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// REVIEWS ROUTER
// ==========================================
const reviewRouter = express.Router();

reviewRouter.post('/', protect, async (req, res) => {
  try {
    const { type, targetId, rating, comment } = req.body;
    const existing = await Review.findOne({ user: req.user.id, type, targetId });
    if (existing) return res.status(400).json({ success: false, message: 'Pehle se review diya hai.' });

    const review = await Review.create({ user: req.user.id, type, targetId, rating, comment });
    const all = await Review.find({ type, targetId });
    const avg = (all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(1);

    if (type === 'listing') await Listing.findByIdAndUpdate(targetId, { avgRating: avg, totalReviews: all.length });
    if (type === 'vehicle') await Vehicle.findByIdAndUpdate(targetId, { avgRating: avg, totalReviews: all.length });
    if (type === 'destination') await Destination.findByIdAndUpdate(targetId, { avgRating: avg, totalReviews: all.length });

    await review.populate('user', 'name avatar');
    res.status(201).json({ success: true, message: 'Review submit ho gaya! 🙏', review });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

reviewRouter.get('/:type/:targetId', async (req, res) => {
  try {
    const reviews = await Review.find({ type: req.params.type, targetId: req.params.targetId })
      .populate('user', 'name avatar').sort('-createdAt').limit(20);
    res.json({ success: true, count: reviews.length, reviews });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// GROUPS ROUTER (Travel Buddies + Group Trips + Chat)
// ==========================================
const groupRouter = express.Router();

groupRouter.post('/', protect, async (req, res) => {
  try {
    const group = await GroupTrip.create({
      ...req.body, creator: req.user.id,
      members: [{ user: req.user.id, name: req.user.name, joinedAt: new Date() }]
    });
    res.status(201).json({ success: true, message: 'Group trip create ho gaya!', group });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

groupRouter.get('/my', protect, async (req, res) => {
  try {
    const groups = await GroupTrip.find({ 'members.user': req.user.id }).sort('-createdAt');
    res.json({ success: true, groups });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

groupRouter.get('/public', async (req, res) => {
  try {
    const groups = await GroupTrip.find({ isPublic: true }).sort('-createdAt').limit(20)
      .select('name destination startDate endDate members totalBudget');
    res.json({ success: true, groups });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

groupRouter.get('/:id', protect, async (req, res) => {
  try {
    const group = await GroupTrip.findById(req.params.id).populate('members.user', 'name avatar email');
    if (!group) return res.status(404).json({ success: false, message: 'Group nahi mila.' });
    res.json({ success: true, group });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

groupRouter.post('/:id/expense', protect, async (req, res) => {
  try {
    const group = await GroupTrip.findById(req.params.id);
    group.expenses.push({ ...req.body, paidBy: req.user.id, paidByName: req.user.name });
    await group.save();
    res.json({ success: true, group });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

groupRouter.post('/:id/note', protect, async (req, res) => {
  try {
    const group = await GroupTrip.findById(req.params.id);
    group.notes.push({ text: req.body.text, createdBy: req.user.name });
    await group.save();
    res.json({ success: true, group });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

groupRouter.post('/:id/chat', protect, async (req, res) => {
  try {
    const group = await GroupTrip.findById(req.params.id);
    group.chatMessages.push({ sender: req.user.id, senderName: req.user.name, text: req.body.text });
    await group.save();
    res.json({ success: true, chatMessages: group.chatMessages });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

groupRouter.post('/:id/join', protect, async (req, res) => {
  try {
    const group = await GroupTrip.findById(req.params.id);
    if (group.members.some(m => m.user?.toString() === req.user.id)) {
      return res.status(400).json({ success: false, message: 'Already member ho.' });
    }
    group.members.push({ user: req.user.id, name: req.user.name, joinedAt: new Date() });
    await group.save();
    res.json({ success: true, group });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// Travel buddy finder — simple match on destination + dates overlap
groupRouter.get('/buddies/find', protect, async (req, res) => {
  try {
    const { destination } = req.query;
    const trips = await Trip.find({
      destination: new RegExp(destination || '', 'i'),
      user: { $ne: req.user.id }
    }).populate('user', 'name avatar').limit(20).sort('-createdAt');
    res.json({ success: true, trips });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// DESTINATIONS ROUTER (Explore India)
// ==========================================
const destRouter = express.Router();

destRouter.get('/', async (req, res) => {
  try {
    const { type, crowdLevel, state } = req.query;
    const filter = { isActive: true };
    if (type) filter.type = type;
    if (crowdLevel) filter.crowdLevel = crowdLevel;
    if (state) filter.state = new RegExp(state, 'i');
    const destinations = await Destination.find(filter).sort('-avgRating');
    res.json({ success: true, count: destinations.length, destinations });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

destRouter.get('/:id', async (req, res) => {
  try {
    const dest = await Destination.findById(req.params.id);
    if (!dest) return res.status(404).json({ success: false, message: 'Nahi mila.' });
    const listings = await Listing.find({ destination: dest._id, status: 'active' }).limit(10);
    res.json({ success: true, destination: dest, listings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

destRouter.post('/', protect, authorize('admin'), async (req, res) => {
  try {
    const dest = await Destination.create(req.body);
    res.status(201).json({ success: true, destination: dest });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});


// ==========================================
// MAPS ROUTER (Near-Me + Heatmap data, uses stored lat/lng — pair with Google Maps JS on frontend)
// ==========================================
const mapsRouter = express.Router();

mapsRouter.get('/near-me', async (req, res) => {
  try {
    const { lat, lng, radiusKm = 10, category } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat/lng zaroori hai (browser GPS se).' });

    const latNum = parseFloat(lat), lngNum = parseFloat(lng), rad = parseFloat(radiusKm);
    const d = rad / 111;
    const filter = {
      status: 'active',
      'location.lat': { $gte: latNum - d, $lte: latNum + d },
      'location.lng': { $gte: lngNum - d, $lte: lngNum + d },
    };
    if (category) filter.category = category;

    const [listings, vehicles] = await Promise.all([
      Listing.find(filter).limit(30),
      Vehicle.find({
        status: 'active', isAvailable: true,
        'location.lat': { $gte: latNum - d, $lte: latNum + d },
        'location.lng': { $gte: lngNum - d, $lte: lngNum + d },
      }).limit(30),
    ]);

    res.json({ success: true, listings, vehicles });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Heatmap data — crowd/budget/food density points for visualization layer
mapsRouter.get('/heatmap', async (req, res) => {
  try {
    const { type } = req.query; // crowd | budget | food | nightlife
    const destinations = await Destination.find({ isActive: true }).select('name location crowdLevel scores type');
    const points = destinations.map(d => ({
      lat: d.location?.lat, lng: d.location?.lng, name: d.name,
      weight: type === 'crowd' ? d.scores.crowd : type === 'budget' ? d.scores.budget : 50,
    })).filter(p => p.lat && p.lng);
    res.json({ success: true, type: type || 'crowd', points });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// USERS ROUTER
// ==========================================
const userRouter = express.Router();

userRouter.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const totalTrips = await Trip.countDocuments({ user: req.user.id });
    res.json({ success: true, user, totalTrips });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

userRouter.post('/wishlist/:listingId', protect, async (req, res) => {
  try {
    let wishlist = await Wishlist.findOne({ user: req.user.id }) || await Wishlist.create({ user: req.user.id, listings: [] });
    const idx = wishlist.listings.indexOf(req.params.listingId);
    if (idx > -1) wishlist.listings.splice(idx, 1); else wishlist.listings.push(req.params.listingId);
    await wishlist.save();
    res.json({ success: true, wishlist });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

userRouter.post('/friends/:friendId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.friends.includes(req.params.friendId)) {
      user.friends.push(req.params.friendId);
      await user.save();
    }
    res.json({ success: true, message: 'Friend added!' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// ADMIN ROUTER
// ==========================================
const adminRouter = express.Router();
adminRouter.use(protect, authorize('admin'));

adminRouter.get('/stats', async (req, res) => {
  try {
    const [totalUsers, totalListings, totalVehicles, totalBookings] = await Promise.all([
      User.countDocuments(), Listing.countDocuments(), Vehicle.countDocuments(), Booking.countDocuments(),
    ]);
    const revenue = await Booking.aggregate([
      { $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$commissionAmt' } } }
    ]);
    res.json({ success: true, stats: { totalUsers, totalListings, totalVehicles, totalBookings, revenue: revenue[0]?.total || 0 } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.get('/users', async (req, res) => {
  try {
    const { role, page = 1, limit = 20 } = req.query;
    const filter = role ? { role } : {};
    const [users, total] = await Promise.all([
      User.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, total, users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.patch('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, user });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.get('/listings/pending', async (req, res) => {
  try {
    const listings = await Listing.find({ status: 'pending' }).populate('owner', 'name email');
    res.json({ success: true, listings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.patch('/listings/:id/approve', async (req, res) => {
  try {
    const listing = await Listing.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
    res.json({ success: true, listing });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.patch('/listings/:id/reject', async (req, res) => {
  try {
    const listing = await Listing.findByIdAndUpdate(req.params.id, { status: 'inactive' }, { new: true });
    res.json({ success: true, listing });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.get('/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().populate('user', 'name email').populate('listing', 'title').sort('-createdAt').limit(50);
    res.json({ success: true, bookings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.get('/coupons', async (req, res) => {
  try {
    const coupons = await Coupon.find().sort('-createdAt');
    res.json({ success: true, coupons });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.post('/coupons', async (req, res) => {
  try {
    const coupon = await Coupon.create({ ...req.body, createdBy: req.user.id });
    res.status(201).json({ success: true, coupon });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

adminRouter.patch('/coupons/:id', async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, coupon });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

adminRouter.delete('/coupons/:id', async (req, res) => {
  try {
    await Coupon.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Coupon deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ==========================================
// COUPON VALIDATION (public, used at checkout before booking)
// ==========================================
const couponRouter = express.Router();
couponRouter.post('/validate', protect, async (req, res) => {
  try {
    const { code, amount } = req.body;
    const coupon = await Coupon.findOne({ code: (code || '').toUpperCase(), isActive: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Invalid coupon code.' });
    if (coupon.expiresAt && coupon.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'Coupon has expired.' });
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) return res.status(400).json({ success: false, message: 'Coupon usage limit reached.' });
    if (amount < coupon.minAmount) return res.status(400).json({ success: false, message: `Minimum order amount is ₹${coupon.minAmount}.` });
    const discount = coupon.type === 'percent' ? Math.round(amount * coupon.value / 100) : coupon.value;
    res.json({ success: true, coupon: { code: coupon.code, type: coupon.type, value: coupon.value }, discount: Math.min(discount, amount - 1) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = { vehicleRouter, bookingRouter, reviewRouter, groupRouter, destRouter, mapsRouter, userRouter, adminRouter, couponRouter };
