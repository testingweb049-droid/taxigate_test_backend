const Ably = require("ably");
const ably = new Ably.Realtime({ key: process.env.ABLY_API_KEY });

const channel = ably.channels.get("drivers");

channel.publish("new-booking", {
    bookingId: "64f8e0b9a1b2c3d4e5f6",
    from_location: "City A",
    to_location: "City B",
    date_time: new Date().toISOString(),
    onlineDriverIds: ["driver1", "driver2"]
}, (err) => {
    process.exit();
});
