process.env['SUPPRESS_NO_CONFIG_WARNING'] = 'y';

const mosca = require('mosca');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Storage } = require('@google-cloud/storage');
const { Parser } = require('json2csv');
const csvParser = require('csv-parser');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs'); // File system module for local storage

// Initialize GCS
const storage = new Storage();
const bucketName = 'mqqt_bucket'; // Replace with your bucket name

// Determine storage method
const useGCS = process.env.USE_GCS === 'true';
const localUploadDir = path.join(__dirname, 'uploads');

// Ensure local upload directory exists
if (!useGCS && !fs.existsSync(localUploadDir)) {
  fs.mkdirSync(localUploadDir, { recursive: true });
}

// User credentials
const USERS = {
  'user1': 'password1',
  'user2': 'password2'
};

// MQTT Server Setup
const mqttSettings = {
  port: 1885,
  http: {
    port: 3000,
    bundle: true,
    static: './'
  }
};

const mqttServer = new mosca.Server(mqttSettings);

let messages = [];
let connectedClients = {};
let clientTopics = {};

mqttServer.on('ready', () => {
  console.log('MQTT server is up and running on port 1885');
  // Start continuous logging every second
  setInterval(() => {
    console.log('Server is running:', new Date().toISOString());
  }, 1000);
});

const authenticate = (client, username, password, callback) => {
  const authorized = USERS[username] && USERS[username] === password.toString();
  if (authorized) {
    client.user = username;
  }
  callback(null, authorized);
};

mqttServer.authenticate = authenticate;

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

// Function to get existing headers from the CSV file
async function getExistingHeaders(filePath) {
  return new Promise((resolve, reject) => {
    const headers = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('headers', (csvHeaders) => {
        headers.push(...csvHeaders);
        resolve(headers);
      })
      .on('error', (error) => reject(error));
  });
}

// Function to update the CSV file with new headers if needed and append data
async function updateCsvFile(filePath, incomingHeaders, rows) {
  let existingHeaders = [];
  if (fs.existsSync(filePath)) {
    existingHeaders = await getExistingHeaders(filePath);
  }

  // Determine new headers
  const newHeaders = incomingHeaders.filter(header => !existingHeaders.includes(header));
  const allHeaders = [...existingHeaders, ...newHeaders];

  // Prepare the rows for appending
  const updatedRows = rows.map(row => {
    const rowObj = {};
    allHeaders.forEach((header, index) => {
      rowObj[header] = row[index] || ''; // Fill missing values for new headers
    });
    return rowObj;
  });

  // If there are new headers, rewrite the file with the new header row
  if (newHeaders.length > 0) {
    const headerString = `${allHeaders.join(',')}\n`;
    const dataString = updatedRows.map(row => allHeaders.map(header => row[header]).join(',')).join('\n') + '\n';
    fs.writeFileSync(filePath, headerString + dataString);
  } else {
    // Otherwise, just append the data
    const dataString = updatedRows.map(row => allHeaders.map(header => row[header]).join(',')).join('\n') + '\n';
    fs.appendFileSync(filePath, dataString);
  }

  console.log(`Updated CSV file: ${filePath}`);
}

// Example usage in the published event handler
mqttServer.on('published', async (packet, client) => {
  if (packet.topic && packet.payload) {
    const payloadString = packet.payload.toString();
    try {
      const jsonData = JSON.parse(payloadString);
      if (jsonData.fileName && jsonData.data) {
        const [headers, ...rows] = jsonData.data;
        const filePath = path.join(localUploadDir, jsonData.fileName);
        await updateCsvFile(filePath, headers, rows);

        const timestamp = new Date().toISOString();
        io.emit('newFile', { fileName: jsonData.fileName, timestamp: timestamp });
      }
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
    }
  }
});

mqttServer.on('subscribed', (topic, client) => {
  console.log(`Client ${client ? client.id : 'unknown'} subscribed to topic: ${topic}`);
  if (client) {
    clientTopics[client.id].add(topic);
    console.log(`Current topics for client ${client.id}: ${Array.from(clientTopics[client.id]).join(', ')}`);
    io.to(client.id).emit('topicListUpdate', Array.from(clientTopics[client.id]));
  }
});

mqttServer.on('unsubscribed', (topic, client) => {
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

// File Upload Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));
app.use(bodyParser.json());

// Endpoint for listing uploaded files
app.get('/files', async (req, res) => {
  if (useGCS) {
    try {
      const [files] = await storage.bucket(bucketName).getFiles();
      const fileDetails = files.map(file => ({
        fileName: file.name,
        timestamp: file.metadata.timeCreated
      }));
      res.send(fileDetails);
    } catch (err) {
      console.error('Error fetching files from GCS:', err);
      res.status(500).send({ message: 'Error reading files' });
    }
  } else {
    try {
      const files = fs.readdirSync(localUploadDir);
      const fileDetails = files.map(file => ({
        fileName: file,
        timestamp: fs.statSync(path.join(localUploadDir, file)).ctime.toISOString()
      }));
      res.send(fileDetails);
    } catch (err) {
      console.error('Error fetching files from local storage:', err);
      res.status(500).send({ message: 'Error reading files' });
    }
  }
});

// Endpoint for downloading a file
app.get('/download/:fileName', (req, res) => {
  const filePath = useGCS 
    ? storage.bucket(bucketName).file(req.params.fileName).createReadStream() 
    : path.join(localUploadDir, req.params.fileName);
  
  if (useGCS) {
    res.setHeader('Content-Type', 'text/csv');
    filePath.pipe(res);
  } else {
    res.download(filePath);
  }
});

// Endpoint for deleting a file
app.delete('/delete/:fileName', async (req, res) => {
  if (useGCS) {
    try {
      await storage.bucket(bucketName).file(req.params.fileName).delete();
      console.log(`File deleted from GCS: ${req.params.fileName}`);
      res.send({ message: 'File deleted successfully' });
    } catch (err) {
      console.error(`Error deleting file from GCS: ${req.params.fileName}`, err);
      res.status(500).send({ message: 'Error deleting file' });
    }
  } else {
    try {
      const filePath = path.join(localUploadDir, req.params.fileName);
      fs.unlinkSync(filePath);
      console.log(`File deleted locally: ${filePath}`);
      res.send({ message: 'File deleted successfully' });
    } catch (err) {
      console.error(`Error deleting file locally: ${req.params.fileName}`, err);
      res.status(500).send({ message: 'Error deleting file' });
    }
  }
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

server.listen(PORT, () => {
  console.log(`HTTP and WebSocket server running on port ${PORT}`);
});
