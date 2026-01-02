const express = require('express');
const cors = require('cors');
const path = require('path');

const convertRoutes = require('./routes/convert');
const playerRoutes = require('./routes/player');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/convert', convertRoutes);
app.use('/api/player', playerRoutes);

// Serve HLS outputs (in production, use proper file serving)
app.use('/hls', express.static(path.join(__dirname, '../output')));

app.listen(PORT, () => {
  console.log(`HLS Player API running on http://localhost:${PORT}`);
});
