process.env['SUPPRESS_NO_CONFIG_WARNING'] = 'y';

const mosca = require('mosca');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// MQTT Server Setup
const mqttSettings = {
  port: 1885,
};

const mqttServer = new mosca.Server(mqttSettings);

let messages = [];
let connectedClients = {};
let clientTopics = {};

mqttServer.on('ready', () => {
  console.log('MQTT server is up and running on port 1885');
});

mqttServer.on('clientConnected', (client) => {
  console.log('Client connected:', client.id);
  connectedClients[client.id] = true;
  clientTopics[client.id] = new Set();
  io.emit('statusUpdate', { connectedClients: Object.keys(connectedClients).length });
  io.emit('clientListUpdate', Object.keys(connectedClients));
});

mqttServer.on('clientDisconnected', (client) => {
  console.log('Client disconnected:', client.id);
  delete connectedClients[client.id];
  delete clientTopics[client.id];
  io.emit('statusUpdate', { connectedClients: Object.keys(connectedClients).length });
  io.emit('clientListUpdate', Object.keys(connectedClients));
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
    io.emit('newMessage', message);
  }
});

mqttServer.on('subscribed', (topic, client) => {
  console.log("From the subscribe topics");
  console.log(`Client ${client ? client.id : 'unknown'} subscribed to topic: ${topic}`);
  if (client) {
    clientTopics[client.id].add(topic);
    console.log(`Current topics for client ${client.id}: ${Array.from(clientTopics[client.id]).join(', ')}`);
    io.to(client.id).emit('topicListUpdate', Array.from(clientTopics[client.id]));
  }
});

mqttServer.on('unsubscribed', (topic, client) => {
  console.log("From the unsubscribe topics");
  console.log(`Client ${client ? client.id : 'unknown'} unsubscribed from topic: ${topic}`);
  if (client) {
    clientTopics[client.id].delete(topic);
    io.to(client.id).emit('topicListUpdate', Array.from(clientTopics[client.id]));
  }
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

// HTTP and WebSocket Server Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

io.on('connection', (socket) => {
  console.log('WebSocket client connected');
  socket.emit('statusUpdate', { connectedClients: Object.keys(connectedClients).length });
  socket.emit('allMessages', messages);
  socket.emit('clientListUpdate', Object.keys(connectedClients));

  socket.on('getTopics', (clientId) => {
    if (clientTopics[clientId]) {
      console.log(`Sending topics for client ${clientId}: ${Array.from(clientTopics[clientId]).join(', ')}`);
      socket.emit('topicListUpdate', Array.from(clientTopics[clientId]));
    }
  });

  socket.on('publish', (data) => {
    const { topic, message, clientId } = data;
    const packet = {
      topic,
      payload: Buffer.from(message),  // Convert the message to a buffer
      qos: 0,
      retain: false
    };
    mqttServer.publish(packet, (err) => {
      if (err) {
        console.error('Error publishing message:', err);
        socket.emit('error', { message: 'Error publishing message', error: err });
      } else {
        console.log(`Message published to topic ${topic}: ${message}`);
        socket.emit('messagePublished', { topic, message });
      }
    });
  });
});

app.use(express.static(__dirname));

server.listen(httpPort, () => {
  console.log(`HTTP and WebSocket server running on http://localhost:${httpPort}`);
});
