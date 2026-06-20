// ============================================
// TripGenius AI — Complete Models (V2 Expanded)
// ============================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ===== 1. USER =====
const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 8, select: false },
  role:     { type: String, enum: ['traveler','owner','provider','admin'], default: 'traveler' },
  phone:    { type: String, default: '' },
  avatar:   { type: String, default: '' },
  authProvider: { type: String, enum: ['email','google'], default: 'email' },
  googleId: String,
  location: {
    lat: Number, lng: Number, city: String, state: String,
  },
  preferences: {
    maxBudget:   { type: Number, default: 15000 },
    stayType:    { type: String, default: 'homestay' },
    travelStyle: { type: String, default: 'budget' },
    foodPref:    { type: String, enum: ['veg','non-veg','vegan','any'], default: 'any' },
    vehiclePref: { type: String, enum: ['bike','car','public','any'], default: 'any' },
    favMoods:    [String],
  },
  savedTrips:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }],
  wishlist:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  friends:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isVerified:  { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  lastLogin:   Date,
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
UserSchema.methods.matchPassword = async function(entered) {
  return bcrypt.compare(entered, this.password);
};
UserSchema.methods.getJWT = function() {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: process.env.JWT_EXPIRE || '7d' });
};


// ===== 2. DESTINATION (Explore India) =====
const DestinationSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  state:       { type: String, required: true },
  emoji:       { type: String, default: '🏖️' },
  description: String,
  type:        { type: String, enum: ['beach','mountains','heritage','adventure','peaceful','party','family','culture'] },
  tags:        [String],
  location:    { lat: Number, lng: Number },
  budgetRange: { min: Number, max: Number },
  crowdLevel:  { type: String, enum: ['low','medium','high'], default: 'medium' },
  scores: {
    budget: { type: Number, default: 70 }, crowd: { type: Number, default: 50 },
    weather:{ type: Number, default: 70 }, vibe: { type: Number, default: 80 },
    safety: { type: Number, default: 75 },
  },
  season: { best: String, avoid: String, avoidReason: String },
  heroImages:  [String],
  popularFoods:[String],
  festivals:   [String],
  avgRating:   { type: Number, default: 0 },
  totalReviews:{ type: Number, default: 0 },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });


// ===== 3. LISTING (Unified: Hotels/Rooms/Restaurants/Camps/Experiences) =====
const ListingSchema = new mongoose.Schema({
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category:     { type: String, enum: ['hotel','room','homestay','resort','camp','restaurant','cafe','experience'], required: true },
  title:        { type: String, required: true, trim: true },
  description:  String,
  destination:  { type: mongoose.Schema.Types.ObjectId, ref: 'Destination' },
  location: {
    address: String, city: String, state: String, pincode: String,
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  pricePerNight: Number,       // for stays
  priceRange:    { min: Number, max: Number }, // for restaurants
  images:        [String],
  amenities:     [String],     // wifi, parking, pool, ac, etc.
  tags:          [String],     // luxury, budget, family-friendly, pet-friendly, etc.
  maxGuests:     { type: Number, default: 2 },
  speciality:    [String],     // food items for restaurants
  openHours:     { from: String, to: String },
  availability:  [{ date: Date, isBooked: { type: Boolean, default: false } }],
  crowdLevel:    { type: String, enum: ['low','medium','high'], default: 'medium' },
  safetyScore:   { type: Number, min: 1, max: 10, default: 7 }, // 1-10, owner/admin set or estimated
  avgRating:     { type: Number, default: 0 },
  totalReviews:  { type: Number, default: 0 },
  totalBookings: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  commissionPct: { type: Number, default: 10 },
  isFeatured:    { type: Boolean, default: false },
  status:        { type: String, enum: ['active','inactive','pending'], default: 'pending' },
}, { timestamps: true });

ListingSchema.index({ 'location.lat': 1, 'location.lng': 1 });


// ===== 4. VEHICLE (Bikes/Cars/Taxis) =====
const VehicleSchema = new mongoose.Schema({
  provider:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true },
  type:        { type: String, enum: ['bike','car','taxi','auto','shared'], required: true },
  vehicleModel:String,
  emoji:       { type: String, default: '🚗' },
  destination: { type: mongoose.Schema.Types.ObjectId, ref: 'Destination' },
  location:    { lat: Number, lng: Number, city: String },
  pricePerDay: Number,
  pricePerKm:  Number,
  priceFlat:   Number,
  images:      [String],
  isAvailable: { type: Boolean, default: true },
  avgRating:   { type: Number, default: 0 },
  totalReviews:{ type: Number, default: 0 },
  commissionPct:{ type: Number, default: 15 },
  status:      { type: String, enum: ['active','inactive','pending'], default: 'active' },
}, { timestamps: true });


// ===== 5. TRIP (AI-generated plans) =====
const TripSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sourceCity:  String,
  destination: { type: String, required: true },
  budget:      { type: Number, required: true },
  people:      { type: Number, required: true, min: 1 },
  days:        { type: Number, required: true, min: 1 },
  mood:        String,
  travelStyle: String,
  stayType:    String,
  foodPref:    String,
  vehiclePref: String,
  aiPlan:      String,
  budgetBreakdown: {
    transport: Number, stay: Number, food: Number,
    activities: Number, vehicle: Number, buffer: Number, total: Number,
  },
  itinerary: [{
    day: Number, title: String, activities: [String],
    pinColor: String, // Blue/Purple/Green/Cyan/Gold per day
  }],
  routeInfo: {
    distance: String, travelTime: String, fuelCost: Number, tollCost: Number,
  },
  status:      { type: String, enum: ['planned','active','completed'], default: 'planned' },
  isGroupTrip: { type: Boolean, default: false },
  group:       { type: mongoose.Schema.Types.ObjectId, ref: 'GroupTrip' },
}, { timestamps: true });


// ===== 6. BOOKING (Unified for listing/vehicle) =====
const BookingSchema = new mongoose.Schema({
  user:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:          { type: String, enum: ['listing','vehicle'], required: true },
  listing:       { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  checkIn:       Date,
  checkOut:      Date,
  guests:        { type: Number, default: 1 },
  totalAmount:   { type: Number, required: true }, // final payable amount (after discount + tax)
  commissionAmt: Number,
  ownerAmount:   Number,
  couponCode:    String,
  discountAmount:{ type: Number, default: 0 },
  taxAmount:     { type: Number, default: 0 },
  status:        { type: String, enum: ['pending','confirmed','rejected','cancelled','completed'], default: 'pending' },
  paymentStatus: { type: String, enum: ['pending','paid','refunded'], default: 'pending' },
  paymentMethod: { type: String, enum: ['upi','card','netbanking','cod'], default: 'upi' },
  paymentId:     String, // Razorpay payment id (when live)
  notes:         String,
  cancelReason:  String,
}, { timestamps: true });


// ===== 7. REVIEW =====
const ReviewSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['listing','vehicle','destination'], required: true },
  targetId:  { type: mongoose.Schema.Types.ObjectId, required: true },
  rating:    { type: Number, required: true, min: 1, max: 5 },
  comment:   String,
  images:    [String],
  isVerified:{ type: Boolean, default: false },
}, { timestamps: true });


// ===== 8. GROUP TRIP (Travel Buddies + Groups) =====
const GroupTripSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  creator:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String, joinedAt: { type: Date, default: Date.now },
  }],
  destination: String,
  startDate:   Date,
  endDate:     Date,
  totalBudget: Number,
  isPublic:    { type: Boolean, default: false }, // public itinerary sharing
  expenses: [{
    description: String, amount: Number,
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, paidByName: String,
    emoji: String, splitAmong: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now },
  }],
  itinerary: [{ day: Number, title: String, activities: [String] }],
  notes: [{ text: String, createdBy: String, createdAt: { type: Date, default: Date.now } }],
  chatMessages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, senderName: String,
    text: String, sentAt: { type: Date, default: Date.now },
  }],
  status: { type: String, enum: ['planning','active','completed'], default: 'planning' },
}, { timestamps: true });


// ===== 9. WISHLIST =====
const WishlistSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  listings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  destinations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Destination' }],
}, { timestamps: true });


// ===== 10. PAYMENT (placeholder structure, Razorpay-ready) =====
const PaymentSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  booking:    { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  amount:     { type: Number, required: true },
  currency:   { type: String, default: 'INR' },
  method:     { type: String, enum: ['upi','card','netbanking','cod'], default: 'upi' },
  razorpayOrderId:   String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  status:     { type: String, enum: ['created','pending','success','failed','refunded'], default: 'created' },
}, { timestamps: true });


// ===== 11. COUPON =====
const CouponSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  type:      { type: String, enum: ['flat','percent'], default: 'percent' },
  value:     { type: Number, required: true }, // ₹ amount if flat, % if percent
  minAmount: { type: Number, default: 0 },
  maxUses:   { type: Number, default: 0 }, // 0 = unlimited
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  isActive:  { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  User:        mongoose.model('User', UserSchema),
  Destination: mongoose.model('Destination', DestinationSchema),
  Listing:     mongoose.model('Listing', ListingSchema),
  Vehicle:     mongoose.model('Vehicle', VehicleSchema),
  Trip:        mongoose.model('Trip', TripSchema),
  Booking:     mongoose.model('Booking', BookingSchema),
  Review:      mongoose.model('Review', ReviewSchema),
  GroupTrip:   mongoose.model('GroupTrip', GroupTripSchema),
  Wishlist:    mongoose.model('Wishlist', WishlistSchema),
  Payment:     mongoose.model('Payment', PaymentSchema),
  Coupon:      mongoose.model('Coupon', CouponSchema),
};
