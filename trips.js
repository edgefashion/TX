// routes/trips.js — Trip CRUD APIs

const express = require('express');
const router = express.Router();
const { Trip } = require('../models');
const { protect } = require('../middleware/auth');

router.get('/my', protect, async (req, res) => {
  try {
    const trips = await Trip.find({ user: req.user.id }).sort('-createdAt');
    res.json({ success: true, count: trips.length, trips });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', protect, async (req, res) => {
  try {
    const trip = await Trip.create({ ...req.body, user: req.user.id });
    res.status(201).json({ success: true, message: 'Trip save ho gaya!', trip });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.user.id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip nahi mili.' });
    res.json({ success: true, trip });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip nahi mili.' });
    res.json({ success: true, message: 'Trip delete ho gaya!' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
