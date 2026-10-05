require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { validateAuthConfig } = require('./config/auth');

validateAuthConfig();

const authRoutes = require('./routes/authRoutes');
const guestRoutes = require('./routes/guestRoutes');
const roomRoutes = require('./routes/roomRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const billRoutes = require('./routes/billRoutes');
const reportRoutes = require('./routes/reportRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:4173')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'HRGSMS backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/guests', guestRoutes);
app.use('/api', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', serviceRoutes);
app.use('/api', billRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/dashboard', dashboardRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler - keeps stack traces out of API responses
app.use((err, req, res, next) => {
  // Database errors may contain SQL and credentials: log only the error code.
  console.error('Request failed:', err.code || err.name || 'UnknownError');
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  if (err.sqlState === '45000') {
    return res.status(400).json({ error: err.sqlMessage || 'The operation was rejected.' });
  }
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`HRGSMS backend listening on port ${PORT}`));
