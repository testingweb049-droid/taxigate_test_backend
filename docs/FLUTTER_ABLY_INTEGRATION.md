# Flutter Ably Integration Guide

This document provides complete instructions for integrating Ably real-time notifications in the Flutter mobile app for drivers.

## Table of Contents

1. [Overview](#overview)
2. [Channel Naming](#channel-naming)
3. [Event List](#event-list)
4. [Flutter Integration](#flutter-integration)
5. [Event Handling](#event-handling)
6. [Reconnection & Reliability](#reconnection--reliability)
7. [Best Practices](#best-practices)

## Overview

The backend uses Ably REST client for publishing events (stateless). Drivers should subscribe to:
- **Driver-specific channel**: `driver-{driverId}` - For events specific to a single driver
- **Broadcast channel**: `drivers` - For events broadcast to all drivers (optional, for backward compatibility)

All events are published to both channels for maximum compatibility.

## Channel Naming

### Driver-Specific Channel
- **Format**: `driver-{driverId}`
- **Example**: `driver-507f1f77bcf86cd799439011`
- **Purpose**: Direct notifications to a specific driver
- **Use Case**: Booking assignments, status updates, unassignments

### Broadcast Channel
- **Name**: `drivers`
- **Purpose**: Broadcast events to all online drivers
- **Use Case**: New bookings, booking taken by another driver, booking expired

### Admin Channel (for reference)
- **Name**: `admin` or `admin-dashboard`
- **Purpose**: Admin dashboard notifications (not used by Flutter app)

## Event List

### Booking Events

#### `new-booking`
**Channel**: `drivers` (broadcast)  
**Description**: New booking available for drivers to accept (auto-assigned bookings only, price <= 150)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "from_location": "Airport",
  "to_location": "City Center",
  "price": "120",
  "date_time": "2024-01-15T10:00:00.000Z",
  "cat_title": "Standard",
  "distance": "25",
  "num_passengers": 2,
  "status": "pending",
  "assignmentType": "auto",
  "driverId": null,
  "onlineDriverIds": ["driver1", "driver2"],
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-assigned`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Booking assigned to driver by admin (price > 150 or expired bookings)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "from_location": "Airport",
  "to_location": "City Center",
  "price": "200",
  "date_time": "2024-01-15T10:00:00.000Z",
  "assignedTo": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-taken`
**Channel**: `drivers` (broadcast)  
**Description**: Booking accepted by another driver (remove from available list)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "takenBy": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z",
  "onlineDriverIds": ["driver1", "driver2"]
}
```

#### `booking-unassigned`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Driver unassigned from a booking

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "unassignedFrom": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-started`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Driver started the booking

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "status": "started",
  "driverId": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-picked-up`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Passenger picked up

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "status": "picked_up",
  "driverId": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-dropped-off`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Passenger dropped off

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "status": "dropped_off",
  "driverId": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-completed`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Booking completed

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "status": "completed",
  "driverId": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `booking-rejected`
**Channel**: `drivers` (broadcast)  
**Description**: Booking rejected by a driver (still available for others)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "rejectedBy": "507f1f77bcf86cd799439012",
  "timestamp": "2024-01-15T09:00:00.000Z",
  "onlineDriverIds": ["driver1", "driver2"]
}
```

#### `booking-expired`
**Channel**: `drivers` (broadcast)  
**Description**: Booking expired (remove from available list)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "timestamp": "2024-01-15T09:00:00.000Z",
  "onlineDriverIds": ["driver1", "driver2"]
}
```

### Upcoming Booking Events

#### `upcoming-booking-added`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Booking added to upcoming list (when driver accepts a future booking)

**Payload**:
```json
{
  "booking": {
    "id": "507f1f77bcf86cd799439011",
    "from_location": "Airport",
    "to_location": "City Center",
    "date_time": "2024-01-20T10:00:00.000Z",
    "status": "upcoming"
  },
  "driverId": "507f1f77bcf86cd799439012",
  "action": "added",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `upcoming-booking-removed`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Booking removed from upcoming list (when booking is started)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "driverId": "507f1f77bcf86cd799439012",
  "action": "removed",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

### Active Booking Events

#### `active-booking-updated`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Active booking updated (status changes during ride)

**Payload**:
```json
{
  "booking": {
    "id": "507f1f77bcf86cd799439011",
    "status": "started",
    "from_location": "Airport",
    "to_location": "City Center"
  },
  "driverId": "507f1f77bcf86cd799439012",
  "action": "updated",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `assigned-booking-removed`
**Channels**: `driver-{driverId}` (primary), `drivers` (broadcast)  
**Description**: Assigned booking removed from list (when booking is started)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "driverId": "507f1f77bcf86cd799439012",
  "action": "removed",
  "reason": "booking_started",
  "status": "started",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

### Live Booking Events

#### `live-booking-added`
**Channels**: `drivers` (broadcast)  
**Description**: New live booking added (for real-time list updates)

**Payload**:
```json
{
  "booking": {
    "id": "507f1f77bcf86cd799439011",
    "from_location": "Airport",
    "to_location": "City Center",
    "status": "pending"
  },
  "action": "added",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `live-booking-removed`
**Channels**: `drivers` (broadcast)  
**Description**: Live booking removed (booking accepted, expired, or cancelled)

**Payload**:
```json
{
  "bookingId": "507f1f77bcf86cd799439011",
  "action": "removed",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

#### `live-booking-updated`
**Channels**: `drivers` (broadcast)  
**Description**: Live booking updated (status or details changed)

**Payload**:
```json
{
  "booking": {
    "id": "507f1f77bcf86cd799439011",
    "from_location": "Airport",
    "to_location": "City Center",
    "status": "pending",
    "driverId": "507f1f77bcf86cd799439012"
  },
  "action": "updated",
  "timestamp": "2024-01-15T09:00:00.000Z"
}
```

## Flutter Integration

### 1. Add Ably Dependency

Add to `pubspec.yaml`:
```yaml
dependencies:
  ably_flutter: ^2.0.0
```

### 2. Initialize Ably Client

```dart
import 'package:ably_flutter/ably_flutter.dart';

class AblyService {
  late Realtime _realtime;
  late RealtimeChannel _driverChannel;
  late RealtimeChannel _broadcastChannel;
  String? _driverId;
  
  Future<void> initialize(String ablyApiKey, String driverId) async {
    _driverId = driverId;
    
    // Initialize Ably Realtime client
    final clientOptions = ClientOptions(
      key: ablyApiKey,
      clientId: 'driver-$driverId',
    );
    
    _realtime = Realtime(options: clientOptions);
    
    // Subscribe to driver-specific channel
    _driverChannel = _realtime.channels.get('driver-$driverId');
    
    // Subscribe to broadcast channel (optional, for backward compatibility)
    _broadcastChannel = _realtime.channels.get('drivers');
    
    // Handle connection state
    _realtime.connection.on().listen((stateChange) {
      print('Ably connection state: ${stateChange.current}');
      
      if (stateChange.current == ConnectionState.connected) {
        print('✅ Ably connected');
        _attachChannels();
      } else if (stateChange.current == ConnectionState.disconnected) {
        print('⚠️ Ably disconnected');
      } else if (stateChange.current == ConnectionState.suspended) {
        print('⚠️ Ably suspended - attempting to reconnect...');
      }
    });
    
    // Connect
    await _realtime.connection.connect();
  }
  
  Future<void> _attachChannels() async {
    try {
      await _driverChannel.attach();
      print('✅ Driver-specific channel attached: driver-$_driverId');
      
      await _broadcastChannel.attach();
      print('✅ Broadcast channel attached: drivers');
    } catch (e) {
      print('❌ Error attaching channels: $e');
    }
  }
  
  void dispose() {
    _driverChannel.detach();
    _broadcastChannel.detach();
    _realtime.close();
  }
}
```

### 3. Subscribe to Events

```dart
class BookingNotificationService {
  final AblyService _ablyService;
  
  BookingNotificationService(this._ablyService);
  
  void subscribeToBookingEvents({
    required Function(Map<String, dynamic>) onNewBooking,
    required Function(Map<String, dynamic>) onBookingAssigned,
    required Function(Map<String, dynamic>) onBookingTaken,
    required Function(Map<String, dynamic>) onBookingUnassigned,
    required Function(Map<String, dynamic>) onBookingStatusUpdate,
    required Function(Map<String, dynamic>) onUpcomingBookingAdded,
    required Function(Map<String, dynamic>) onUpcomingBookingRemoved,
    required Function(Map<String, dynamic>) onActiveBookingUpdated,
    required Function(Map<String, dynamic>) onLiveBookingUpdate,
  }) {
    final driverChannel = _ablyService._driverChannel;
    final broadcastChannel = _ablyService._broadcastChannel;
    
    // Subscribe to driver-specific events (primary channel)
    driverChannel.subscribe('booking-assigned').listen((message) {
      print('🔔 Booking assigned: ${message.data}');
      onBookingAssigned(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('booking-unassigned').listen((message) {
      print('🔔 Booking unassigned: ${message.data}');
      onBookingUnassigned(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('booking-started').listen((message) {
      print('🔔 Booking started: ${message.data}');
      onBookingStatusUpdate(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('booking-picked-up').listen((message) {
      print('🔔 Booking picked up: ${message.data}');
      onBookingStatusUpdate(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('booking-dropped-off').listen((message) {
      print('🔔 Booking dropped off: ${message.data}');
      onBookingStatusUpdate(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('booking-completed').listen((message) {
      print('🔔 Booking completed: ${message.data}');
      onBookingStatusUpdate(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('upcoming-booking-added').listen((message) {
      print('🔔 Upcoming booking added: ${message.data}');
      onUpcomingBookingAdded(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('upcoming-booking-removed').listen((message) {
      print('🔔 Upcoming booking removed: ${message.data}');
      onUpcomingBookingRemoved(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('active-booking-updated').listen((message) {
      print('🔔 Active booking updated: ${message.data}');
      onActiveBookingUpdated(message.data as Map<String, dynamic>);
    });
    
    driverChannel.subscribe('assigned-booking-removed').listen((message) {
      print('🔔 Assigned booking removed: ${message.data}');
      onBookingStatusUpdate(message.data as Map<String, dynamic>);
    });
    
    // Subscribe to broadcast events (optional, for backward compatibility)
    broadcastChannel.subscribe('new-booking').listen((message) {
      print('🔔 New booking: ${message.data}');
      onNewBooking(message.data as Map<String, dynamic>);
    });
    
    broadcastChannel.subscribe('booking-taken').listen((message) {
      print('🔔 Booking taken: ${message.data}');
      onBookingTaken(message.data as Map<String, dynamic>);
    });
    
    broadcastChannel.subscribe('booking-rejected').listen((message) {
      print('🔔 Booking rejected: ${message.data}');
      // Handle booking rejection (booking still available)
    });
    
    broadcastChannel.subscribe('booking-expired').listen((message) {
      print('🔔 Booking expired: ${message.data}');
      // Remove booking from available list
    });
    
    broadcastChannel.subscribe('live-booking-added').listen((message) {
      print('🔔 Live booking added: ${message.data}');
      onLiveBookingUpdate(message.data as Map<String, dynamic>);
    });
    
    broadcastChannel.subscribe('live-booking-removed').listen((message) {
      print('🔔 Live booking removed: ${message.data}');
      onLiveBookingUpdate(message.data as Map<String, dynamic>);
    });
    
    broadcastChannel.subscribe('live-booking-updated').listen((message) {
      print('🔔 Live booking updated: ${message.data}');
      onLiveBookingUpdate(message.data as Map<String, dynamic>);
    });
  }
}
```

### 4. Complete Example

```dart
import 'package:flutter/material.dart';
import 'package:ably_flutter/ably_flutter.dart';

class BookingRealtimeService {
  late Realtime _realtime;
  late RealtimeChannel _driverChannel;
  late RealtimeChannel _broadcastChannel;
  String? _driverId;
  List<StreamSubscription> _subscriptions = [];
  
  Future<void> initialize(String ablyApiKey, String driverId) async {
    _driverId = driverId;
    
    final clientOptions = ClientOptions(
      key: ablyApiKey,
      clientId: 'driver-$driverId',
    );
    
    _realtime = Realtime(options: clientOptions);
    _driverChannel = _realtime.channels.get('driver-$driverId');
    _broadcastChannel = _realtime.channels.get('drivers');
    
    // Handle connection
    _realtime.connection.on().listen((stateChange) {
      if (stateChange.current == ConnectionState.connected) {
        _attachChannels();
      }
    });
    
    await _realtime.connection.connect();
  }
  
  Future<void> _attachChannels() async {
    await _driverChannel.attach();
    await _broadcastChannel.attach();
  }
  
  void subscribeToEvents({
    required Function(Map<String, dynamic>) onNewBooking,
    required Function(Map<String, dynamic>) onBookingAssigned,
    required Function(Map<String, dynamic>) onBookingStatusUpdate,
  }) {
    // Driver-specific channel subscriptions
    _subscriptions.add(
      _driverChannel.subscribe('booking-assigned').listen((message) {
        onBookingAssigned(message.data as Map<String, dynamic>);
      })
    );
    
    // Broadcast channel subscriptions
    _subscriptions.add(
      _broadcastChannel.subscribe('new-booking').listen((message) {
        onNewBooking(message.data as Map<String, dynamic>);
      })
    );
    
    // Add more subscriptions as needed...
  }
  
  void dispose() {
    for (var subscription in _subscriptions) {
      subscription.cancel();
    }
    _driverChannel.detach();
    _broadcastChannel.detach();
    _realtime.close();
  }
}
```

## Event Handling

### Handling New Bookings

```dart
void handleNewBooking(Map<String, dynamic> data) {
  final bookingId = data['bookingId'];
  final fromLocation = data['from_location'];
  final toLocation = data['to_location'];
  final price = data['price'];
  
  // Update UI with new booking
  // Show notification to driver
  // Add to available bookings list
}
```

### Handling Booking Assignments

```dart
void handleBookingAssigned(Map<String, dynamic> data) {
  final bookingId = data['bookingId'];
  final assignedTo = data['assignedTo'];
  
  // Verify this is for current driver
  if (assignedTo == currentDriverId) {
    // Update UI
    // Show notification
    // Navigate to booking details
  }
}
```

### Handling Status Updates

```dart
void handleBookingStatusUpdate(Map<String, dynamic> data) {
  final bookingId = data['bookingId'];
  final status = data['status'];
  
  // Update booking status in local state
  // Update UI accordingly
  switch (status) {
    case 'started':
      // Show "Ride Started" UI
      break;
    case 'picked_up':
      // Show "On the way to destination" UI
      break;
    case 'dropped_off':
      // Show "Ride completed" UI
      break;
    case 'completed':
      // Show completion screen
      break;
  }
}
```

## Reconnection & Reliability

### Automatic Reconnection

Ably Flutter SDK automatically handles reconnections. However, you should handle connection state changes:

```dart
_realtime.connection.on().listen((stateChange) {
  switch (stateChange.current) {
    case ConnectionState.connected:
      print('✅ Connected');
      // Re-attach channels if needed
      _attachChannels();
      break;
    case ConnectionState.disconnected:
      print('⚠️ Disconnected');
      // Show offline indicator
      break;
    case ConnectionState.suspended:
      print('⚠️ Suspended');
      // Attempt manual reconnection if needed
      break;
    case ConnectionState.closed:
      print('❌ Closed');
      // Handle closure
      break;
    default:
      break;
  }
});
```

### Handling Offline Scenarios

1. **Cache Events**: Store critical events locally when offline
2. **Sync on Reconnect**: Sync local state with server on reconnection
3. **Show Connection Status**: Display connection indicator to user

### Event Ordering

Ably guarantees message ordering within a channel. Events are delivered in the order they were published.

## Best Practices

### 1. Always Subscribe to Driver-Specific Channel

The primary channel for driver-specific events is `driver-{driverId}`. Always subscribe to this channel for instant, reliable delivery.

### 2. Use Broadcast Channel for Compatibility

Also subscribe to `drivers` channel for backward compatibility and broadcast events (new bookings, booking taken, etc.).

### 3. Handle All Events

Subscribe to all relevant events to ensure complete real-time updates:
- Booking assignments
- Status updates
- Upcoming bookings
- Active bookings
- Live booking changes

### 4. Update UI Immediately

Update UI immediately when events are received. Don't wait for API calls.

### 5. Handle Errors Gracefully

```dart
try {
  await _driverChannel.attach();
} catch (e) {
  print('Error attaching channel: $e');
  // Retry or show error to user
}
```

### 6. Clean Up Subscriptions

Always dispose of subscriptions and close connections when done:

```dart
@override
void dispose() {
  for (var subscription in _subscriptions) {
    subscription.cancel();
  }
  _driverChannel.detach();
  _broadcastChannel.detach();
  _realtime.close();
  super.dispose();
}
```

### 7. Verify Driver ID

Always verify that events are for the current driver before processing:

```dart
void handleBookingAssigned(Map<String, dynamic> data) {
  final assignedTo = data['assignedTo'];
  if (assignedTo != currentDriverId) {
    return; // Not for this driver
  }
  // Process event
}
```

## Testing

### Test Connection

```dart
void testConnection() async {
  try {
    await _realtime.connection.connect();
    print('Connection test: ✅ Success');
  } catch (e) {
    print('Connection test: ❌ Failed - $e');
  }
}
```

### Test Channel Subscription

```dart
void testSubscription() async {
  try {
    await _driverChannel.attach();
    _driverChannel.subscribe('test-event').listen((message) {
      print('Test event received: ${message.data}');
    });
    print('Subscription test: ✅ Success');
  } catch (e) {
    print('Subscription test: ❌ Failed - $e');
  }
}
```

## Troubleshooting

### Events Not Received

1. **Check Connection**: Verify Ably connection is established
2. **Check Channel**: Verify channel is attached
3. **Check Event Name**: Ensure event name matches exactly
4. **Check Driver ID**: Verify driver ID is correct

### Connection Issues

1. **Check API Key**: Verify Ably API key is correct
2. **Check Network**: Ensure device has internet connection
3. **Check Ably Status**: Verify Ably service is operational
4. **Retry Connection**: Implement retry logic with exponential backoff

### Performance Issues

1. **Limit Subscriptions**: Only subscribe to necessary events
2. **Unsubscribe When Done**: Always unsubscribe from unused events
3. **Use Driver-Specific Channel**: More efficient than broadcast channel
4. **Batch Updates**: Batch UI updates when multiple events arrive

## Support

For issues or questions:
1. Check Ably Flutter SDK documentation: https://github.com/ably/ably-flutter
2. Check backend logs for event publishing
3. Verify channel names and event names match exactly
4. Contact backend team for event payload changes

