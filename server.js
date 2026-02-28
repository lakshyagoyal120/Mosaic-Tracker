// ============================================================
// MOSAIC AD WAR ROOM — Complete Backend Server
// ============================================================
// SETUP: npm install express cors axios
// RUN:   node server.js
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// CORS — Explicitly allow everything
// ============================================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// ============================================================
// COMPETITOR CONFIG
// ============================================================
const COMPETITORS = {
  manMatters: [
    'Traya Health',
    'Bold Care',
    'Misters',
    'Ustraa',
    'Beardo',
    'ForMen',
    'The Man Company'
  ],
  beBodywise: [
    'Nua Woman',
    'Plix Life',
    'OZiva',
    'Wellbeing Nutrition',
    'Gynoveda',
    'The Derma Co',
    'Minimalist'
  ],
  littleJoys: [
    'Gritzo',
    'Slurrp Farm',
    'The Moms Co',
    'Timios',
    'Healthy Buddy'
  ]
};

// ============================================================
// HELPER — Fetch ads for one competitor from Meta
// ============================================================
async function fetchAdsForCompetitor(competitorName) {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    throw new Error('META_ACCESS_TOKEN not found in environment variables');
  }

  const response = await axios.get('https://graph.facebook.com/v19.0/ads_archive', {
    params: {
      access_token: token,
      search_terms: competitorName,
      ad_reached_countries: "['IN']",
      ad_active_status: 'ACTIVE',
      ad_type: 'ALL',
      fields: 'id,ad_creation_time,ad_delivery_start_time,ad_creative_bodies,ad_creative_link_captions,page_name,ad_snapshot_url',
      limit: 25
    }
  });

  const ads = response.data.data || [];

  // Add computed fields to each ad
  return ads.map(ad => {
    const startDate = ad.ad_delivery_start_time || ad.ad_creation_time;
    const daysRunning = startDate
      ? Math.floor((Date.now() - new Date(startDate)) / (1000 * 60 * 60 * 24))
      : null;

    return {
      ...ad,
      competitor: competitorName,
      days_running: daysRunning,
      is_long_running: daysRunning > 30,
      ad_copy: ad.ad_creative_bodies?.[0] || 'No copy available'
    };
  });
}

// ============================================================
// ROUTE 1 — Health Check
// GET /test
// ============================================================
app.get('/test', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'SUCCESS',
    message: 'Ad War Room Backend is running',
    timestamp: new Date().toISOString(),
    apis_configured: {
      meta: !!process.env.META_ACCESS_TOKEN,
      rainforest: !!process.env.RAINFOREST_API_KEY
    }
  });
});

// ============================================================
// ROUTE 2 — Fetch ads for ONE competitor
// GET /meta?competitor=Traya Health
// ============================================================
app.get('/meta', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');

  const { competitor } = req.query;

  if (!competitor) {
    return res.status(400).json({ error: 'Missing competitor parameter. Use ?competitor=BrandName' });
  }

  try {
    const ads = await fetchAdsForCompetitor(competitor);
    res.json({
      status: 'SUCCESS',
      competitor,
      total_ads: ads.length,
      ads
    });
  } catch (err) {
    res.status(500).json({
      status: 'ERROR',
      competitor,
      error: err.response?.data?.error?.message || err.message
    });
  }
});

// ============================================================
// ROUTE 3 — Fetch all ads for a Mosaic BRAND
// GET /meta/brand?brand=manMatters
// GET /meta/brand?brand=beBodywise
// GET /meta/brand?brand=littleJoys
// ============================================================
app.get('/meta/brand', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');

  const { brand } = req.query;

  if (!brand || !COMPETITORS[brand]) {
    return res.status(400).json({
      error: 'Invalid brand. Use ?brand=manMatters or ?brand=beBodywise or ?brand=littleJoys',
      valid_brands: Object.keys(COMPETITORS)
    });
  }

  const competitors = COMPETITORS[brand];
  const results = {};
  const errors = {};

  // Fetch ads for all competitors of this brand
  for (const competitor of competitors) {
    try {
      const ads = await fetchAdsForCompetitor(competitor);
      results[competitor] = {
        total_ads: ads.length,
        long_running_ads: ads.filter(a => a.is_long_running).length,
        ads
      };
      await sleep(500); // avoid rate limiting
    } catch (err) {
      errors[competitor] = err.response?.data?.error?.message || err.message;
    }
  }

  res.json({
    status: 'SUCCESS',
    brand,
    competitors_tracked: competitors.length,
    total_ads_fetched: Object.values(results).reduce((sum, r) => sum + r.total_ads, 0),
    results,
    errors: Object.keys(errors).length > 0 ? errors : undefined
  });
});

// ============================================================
// ROUTE 4 — Fetch Amazon product data via Rainforest
// GET /amazon?asin=B09THQH4KN
// ============================================================
app.get('/amazon', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');

  const { asin } = req.query;

  if (!asin) {
    return res.status(400).json({ error: 'Missing asin parameter. Use ?asin=ASIN_CODE' });
  }

  const apiKey = process.env.RAINFOREST_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'RAINFOREST_API_KEY not configured' });
  }

  try {
    const response = await axios.get('https://api.rainforestapi.com/request', {
      params: {
        api_key: apiKey,
        type: 'product',
        asin,
        amazon_domain: 'amazon.in'
      }
    });

    const product = response.data.product;

    res.json({
      status: 'SUCCESS',
      asin,
      title: product.title,
      price: product.buybox_winner?.price?.raw || 'N/A',
      rating: product.rating,
      total_reviews: product.ratings_total,
      bsr: product.bestsellers_rank?.[0] || null,
      images: product.images?.slice(0, 3) || []
    });
  } catch (err) {
    res.status(500).json({
      status: 'ERROR',
      error: err.response?.data?.request_info?.message || err.message
    });
  }
});

// ============================================================
// ROUTE 5 — Full dashboard data dump
// GET /dashboard?brand=manMatters
// ============================================================
app.get('/dashboard', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');

  const { brand } = req.query;

  if (!brand || !COMPETITORS[brand]) {
    return res.status(400).json({
      error: 'Invalid brand',
      valid_brands: Object.keys(COMPETITORS)
    });
  }

  const competitors = COMPETITORS[brand];
  const allAds = [];

  for (const competitor of competitors) {
    try {
      const ads = await fetchAdsForCompetitor(competitor);
      allAds.push(...ads);
      await sleep(500);
    } catch (err) {
      console.error(`Failed to fetch ads for ${competitor}:`, err.message);
    }
  }

  // Compute summary stats
  const activeAds = allAds.filter(a => a.days_running !== null);
  const longRunning = allAds.filter(a => a.is_long_running);

  res.json({
    status: 'SUCCESS',
    brand,
    summary: {
      total_ads: allAds.length,
      competitors_tracked: competitors.length,
      long_running_ads: longRunning.length,
      avg_days_running: activeAds.length
        ? Math.round(activeAds.reduce((s, a) => s + a.days_running, 0) / activeAds.length)
        : 0
    },
    top_long_running: longRunning
      .sort((a, b) => b.days_running - a.days_running)
      .slice(0, 5),
    all_ads: allAds
  });
});

// ============================================================
// HELPER
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ Ad War Room Backend running on port ${PORT}`);
  console.log(`\nAvailable routes:`);
  console.log(`  GET /test`);
  console.log(`  GET /meta?competitor=BrandName`);
  console.log(`  GET /meta/brand?brand=manMatters`);
  console.log(`  GET /meta/brand?brand=beBodywise`);
  console.log(`  GET /meta/brand?brand=littleJoys`);
  console.log(`  GET /amazon?asin=ASIN_CODE`);
  console.log(`  GET /dashboard?brand=manMatters`);
});
