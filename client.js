const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://mqqt-server-9360b01b0f99.herokuapp.com:1885');

client.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  // Subscribe to a topic
  client.subscribe('sensors/temperature', (err) => {
    if (!err) {
      console.log('Subscribed to sensors/temperature');
    }
  });

  // Publish a message to a topic
  client.publish('sensors/temperature', '22.5');
});

client.on('message', (topic, message) => {
  // Handle received messages
  console.log(`Received message: ${message.toString()} on topic: ${topic}`);
});
