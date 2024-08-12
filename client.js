const mqtt = require('mqtt');

// Use WebSocket URL
const client = mqtt.connect('wss://mqqt-server-9360b01b0f99.herokuapp.com');

client.on('connect', () => {
  console.log('Connected to MQTT broker via WebSocket');
  
  // Subscribe to a topic
  client.subscribe('sensors/temperature', (err) => {
    if (!err) {
      console.log('Subscribed to sensors/temperature');
    }
  });

  // Publish a message
  client.publish('sensors/temperature', '23.5');
});

client.on('message', (topic, message) => {
  console.log(`Received message: ${message.toString()} on topic: ${topic}`);
});
