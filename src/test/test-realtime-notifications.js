require('dotenv').config();
const Ably = require('ably');
const chalk = require('chalk');
const channel = ably.channels.get('drivers');

const ABLY_API_KEY = process.env.ABLY_API_KEY || 'YOUR_ABLY_API_KEY_HERE';

if (ABLY_API_KEY === 'YOUR_ABLY_API_KEY_HERE') {
    process.exit(1);
}

const ably = new Ably.Realtime({ 
    key: ABLY_API_KEY,
    clientId: 'test-listener'
});

ably.connection.on('connecting', () => {
});
ably.connection.on('connected', () => {
});
ably.connection.on('disconnected', () => {
});
ably.connection.on('failed', (err) => {
});

channel.subscribe('new-booking', (message) => {
});
channel.subscribe('booking-taken', (message) => {
});
channel.subscribe('booking-assigned', (message) => {
});
channel.subscribe('booking-cancelled', (message) => {
});
channel.on('failed', (err) => {
});

process.on('SIGINT', () => {
    ably.close();
    process.exit(0);
});

