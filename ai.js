// routes/ai.js — AI Trip Planning APIs (Expanded V2)

const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const { Trip } = require('../models');

// Groq API call helper — FREE, no credit card, console.groq.com
async function callGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Groq API error — GROQ_API_KEY check karo .env mein');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

const DAY_COLORS = ['Blue','Purple','Green','Cyan','Gold'];

// ─────────────────────────────────────
// POST /api/ai/generate-trip — Main AI Trip Planner (expanded)
// ─────────────────────────────────────
router.post('/generate-trip', optionalAuth, async (req, res) => {
  try {
    const { sourceCity, destination, budget, people, days, mood, travelStyle, stayType, foodPref, vehiclePref } = req.body;

    if (!budget || !people || !days) {
      return res.status(400).json({ success: false, message: 'Budget, people, days zaroori hain.' });
    }

    const prompt = `You are TripGenius AI — India's most advanced AI travel planner.

User Details:
- From: ${sourceCity || 'Not specified'}
- To: ${destination || 'AI should recommend best fit'}
- Total Budget: ₹${budget} for ${people} person(s), ${days} days
- Mood: ${mood || 'any'}
- Travel Style: ${travelStyle || 'budget'}
- Stay Preference: ${stayType || 'any'}
- Food Preference: ${foodPref || 'any'}
- Vehicle Preference: ${vehiclePref || 'any'}

Create a COMPLETE travel plan:

🏆 DESTINATION & ROUTE
[If destination given, confirm it fits. If not, recommend best Indian destination. Include route: ${sourceCity || 'source'} → destination, with estimated distance and travel time.]

💰 BUDGET BREAKDOWN (Total ₹${budget})
• Transport (to/from): ₹___
• Stay (${days} nights, ${stayType || 'budget'}): ₹___
• Food (${days} days × ${people} people, ${foodPref || 'any'}): ₹___
• Local transport (${vehiclePref || 'any'}): ₹___
• Activities & entry fees: ₹___
• Emergency buffer: ₹___
• TOTAL: ₹___ (must be ≤ ₹${budget})

📊 TRIP INTELLIGENCE
• Crowd Level: 🟢Low/🟡Medium/🔴High + reason
• Weather: current season insight
• Budget Score: X/10
• Best Season: months
• Avoid Period: dates + reason

📅 ${days}-DAY ITINERARY (with pin colors for map)
Day 1 (${DAY_COLORS[0]} pins) — [Theme]: morning/afternoon/evening activities
Day 2 (${DAY_COLORS[1]} pins) — [Theme]: activities
${days>2?`Day 3 (${DAY_COLORS[2]} pins) — [Theme]: activities`:''}
${days>3?`Day 4 (${DAY_COLORS[3]} pins) — [Theme]: activities`:''}
${days>4?`Day 5+ (${DAY_COLORS[4]} pins) — summary`:''}

🍜 FOOD RECOMMENDATIONS (${foodPref || 'any'} preference, 3 items with price)

🚗 TRANSPORT DETAILS
Fuel cost estimate: ₹___
Toll cost estimate: ₹___
Recommended vehicle: ${vehiclePref || 'best fit'}

💡 3 MONEY-SAVING TIPS

Be specific, practical, exciting. Realistic India 2024 prices.`;

    const aiResponse = await callGroq(prompt);

    let savedTrip = null;
    if (req.user) {
      savedTrip = await Trip.create({
        user: req.user.id, sourceCity, destination: destination || 'AI Recommended',
        budget: parseInt(budget), people: parseInt(people), days: parseInt(days),
        mood, travelStyle, stayType, foodPref, vehiclePref, aiPlan: aiResponse,
      });
    }

    res.json({ success: true, plan: aiResponse, tripId: savedTrip?._id || null });
  } catch (err) {
    console.error('AI Error:', err.message);
    res.status(500).json({ success: false, message: 'AI call fail hua: ' + err.message });
  }
});

// ─────────────────────────────────────
// POST /api/ai/recommend-destinations
// ─────────────────────────────────────
router.post('/recommend-destinations', async (req, res) => {
  try {
    const { budget, people, days, mood } = req.body;
    const prompt = `Give TOP 5 budget travel destinations in India for: Budget ₹${budget} for ${people} people, ${days} days, mood: ${mood}.
Respond ONLY with valid JSON, no other text:
{"destinations":[{"name":"City","state":"State","emoji":"🏖️","reason":"why","budgetFit":"Excellent/Good/Okay","crowdLevel":"Low/Medium/High","highlight":"best thing"}]}`;

    const aiResponse = await callGroq(prompt);
    let parsed;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch { parsed = { destinations: [] }; }

    res.json({ success: true, ...parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────
// POST /api/ai/route-plan — Multi-stop route (Delhi → Shimla → Kufri)
// ─────────────────────────────────────
router.post('/route-plan', async (req, res) => {
  try {
    const { stops } = req.body; // array of city names
    if (!stops || stops.length < 2) {
      return res.status(400).json({ success: false, message: 'Minimum 2 stops chahiye.' });
    }

    const prompt = `Plan a road trip route: ${stops.join(' → ')}.
Respond ONLY with valid JSON:
{"totalDistance":"XXX km","totalTime":"X hours","fuelCost":"₹XXXX","tollCost":"₹XXX","segments":[{"from":"A","to":"B","distance":"XX km","time":"X hrs","roadCondition":"Good/Average/Poor"}],"weatherNote":"brief note","trafficNote":"brief note"}`;

    const aiResponse = await callGroq(prompt);
    let parsed;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch { parsed = { segments: [] }; }

    res.json({ success: true, ...parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────
// POST /api/ai/budget-optimize
// ─────────────────────────────────────
router.post('/budget-optimize', protect, async (req, res) => {
  try {
    const { destination, budget, people, days } = req.body;
    const prompt = `Give 5 money-saving tips for traveling to ${destination}, India with ₹${budget} for ${people} people, ${days} days.
Respond ONLY with valid JSON:
{"tips":[{"title":"Tip","saving":"₹XXX","detail":"How"}],"totalPossibleSaving":"₹XXXX"}`;

    const aiResponse = await callGroq(prompt);
    let parsed;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch { parsed = { tips: [], totalPossibleSaving: '₹0' }; }

    res.json({ success: true, ...parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
