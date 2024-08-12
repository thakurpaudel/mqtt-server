process.env['SUPPRESS_NO_CONFIG_WARNING'] = 'y';

const mosca = require('mosca');
const express = require('express');

// MQTT Server Setup
const mqttSettings = {
  port: 1885,  // Use the changed port number if needed
};

const mqttServer = new mosca.Server(mqttSettings);

let messages = [];
let connectedClients = {};

mqttServer.on('ready', () => {
  console.log('MQTT server is up and running on port 1885');
});

mqttServer.on('clientConnected', (client) => {
  console.log('Client connected:', client.id);
  connectedClients[client.id] = true;
});

mqttServer.on('clientDisconnected', (client) => {
  console.log('Client disconnected:', client.id);
  delete connectedClients[client.id];
});

mqttServer.on('published', (packet, client) => {
  if (packet.topic && packet.payload) {
    const message = {
      topic: packet.topic,
      payload: packet.payload.toString(),
      clientId: client ? client.id : 'unknown'
    };
    messages.push(message);
    console.log(`Message received on topic ${packet.topic}: ${packet.payload.toString()}`);
  }
});

mqttServer.on('subscribed', (topic, client) => {
  console.log(`Client ${client ? client.id : 'unknown'} subscribed to topic: ${topic}`);
});

mqttServer.on('unsubscribed', (topic, client) => {
  console.log(`Client ${client ? client.id : 'unknown'} unsubscribed from topic: ${topic}`);
});

mqttServer.on('error', (err) => {
  console.error('Error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('Process terminated');
  mqttServer.close(() => {
    console.log('MQTT server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Process interrupted');
  mqttServer.close(() => {
    console.log('MQTT server closed');
    process.exit(0);
  });
});

// HTTP Server Setup
const app = express();
const httpPort = 3000;

app.use(express.json());

app.get('/messages', (req, res) => {
  res.json(messages);
});

app.get('/status', (req, res) => {
  res.json({
    message: 'MQTT server is up and running',
    connectedClients: Object.keys(connectedClients).length
  });
});

app.get('/clients', (req, res) => {
  res.json(Object.keys(connectedClients));
});

app.listen(httpPort, () => {
  console.log(`HTTP server running on http://localhost:${httpPort}`);
});
