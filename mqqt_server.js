process.env['SUPPRESS_NO_CONFIG_WARNING'] = 'y';

const mosca = require('mosca');

const settings = {
  port: 1885,  // Use the changed port number if needed
};

const server = new mosca.Server(settings);

let messages = [];
let connectedClients = {};

server.on('ready', () => {
  console.log('MQTT server is up and running on port 1885');
});

server.on('clientConnected', (client) => {
  console.log('Client connected:', client.id);
  connectedClients[client.id] = true;
});

server.on('clientDisconnected', (client) => {
  console.log('Client disconnected:', client.id);
  delete connectedClients[client.id];
});

server.on('published', (packet, client) => {
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

server.on('subscribed', (topic, client) => {
  console.log(`Client ${client ? client.id : 'unknown'} subscribed to topic: ${topic}`);
});

server.on('unsubscribed', (topic, client) => {
  console.log(`Client ${client ? client.id : 'unknown'} unsubscribed from topic: ${topic}`);
});

server.on('error', (err) => {
  console.error('Error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('Process terminated');
  server.close(() => {
    console.log('MQTT server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Process interrupted');
  server.close(() => {
    console.log('MQTT server closed');
    process.exit(0);
  });
});

module.exports = { messages, connectedClients };
