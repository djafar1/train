
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;
const WORLD_SIZE = 3000;
const TICK_RATE = 30;

let players = {};
let orbs = [];

// Helper: Generate random position
const randomPos = () => ({
  x: Math.random() * WORLD_SIZE,
  y: Math.random() * WORLD_SIZE
});

// Helper: Init Orbs
const spawnOrbs = (count) => {
  for (let i = 0; i < count; i++) {
    orbs.push({
      id: Math.random().toString(36).substr(2, 9),
      ...randomPos(),
      value: 1,
      color: ['#ef4444', '#22c55e', '#3b82f6', '#eab308'][Math.floor(Math.random() * 4)]
    });
  }
};
spawnOrbs(300);

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (data) => {
    const startPos = randomPos();
    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Anonymous',
      color: data.color || '#ef4444',
      body: [startPos, { x: startPos.x - 10, y: startPos.y }, { x: startPos.x - 20, y: startPos.y }],
      angle: Math.random() * Math.PI * 2,
      targetAngle: 0,
      score: 0,
      isDead: false
    };
    socket.emit('init', { id: socket.id, worldSize: WORLD_SIZE });
  });

  socket.on('input', (data) => {
    if (players[socket.id]) {
      players[socket.id].targetAngle = data.angle;
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Player disconnected:', socket.id);
  });
});

// Game Loop
setInterval(() => {
  const playerIds = Object.keys(players);
  
  playerIds.forEach(id => {
    const p = players[id];
    if (p.isDead) return;

    // Turn
    let diff = p.targetAngle - p.angle;
    while (diff <= -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    p.angle += Math.max(-0.1, Math.min(0.1, diff));

    // Move Head
    const speed = 5;
    const newHead = {
      x: p.body[0].x + Math.cos(p.angle) * speed,
      y: p.body[0].y + Math.sin(p.angle) * speed
    };

    // Boundary check
    if (newHead.x < 0 || newHead.x > WORLD_SIZE || newHead.y < 0 || newHead.y > WORLD_SIZE) {
      p.isDead = true;
      // Drop cargo
      return;
    }

    // Move Body
    const newBody = [newHead];
    for (let i = 0; i < p.body.length - 1; i++) {
      const current = newBody[i];
      const prev = p.body[i + 1]; // Originally at i+1
      const dx = current.x - prev.x;
      const dy = current.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const spacing = 10;
      
      if (dist > 0) {
        newBody.push({
          x: current.x - (dx / dist) * spacing,
          y: current.y - (dy / dist) * spacing
        });
      } else {
        newBody.push(prev);
      }
    }
    
    // Add pending growth if collected orb recently (simplified here)
    if (p.pendingGrowth > 0) {
       newBody.push(p.body[p.body.length-1]);
       p.pendingGrowth--;
    }
    
    p.body = newBody;

    // Orb Collision
    for (let i = orbs.length - 1; i >= 0; i--) {
      const orb = orbs[i];
      const dx = newHead.x - orb.x;
      const dy = newHead.y - orb.y;
      if (dx * dx + dy * dy < 400) { // 20*20
        p.score += orb.value;
        // Simple growth logic: add tail next tick
        p.body.push(p.body[p.body.length - 1]);
        orbs.splice(i, 1);
        // Respawn orb
        orbs.push({
            id: Math.random().toString(36).substr(2, 9),
            ...randomPos(),
            value: 1,
            color: orb.color
        });
      }
    }

    // Player Collision
    playerIds.forEach(otherId => {
      if (id === otherId) return;
      const other = players[otherId];
      if (other.isDead) return;

      // Head to Head or Head to Body
      for (let i = 0; i < other.body.length; i++) {
        const seg = other.body[i];
        const dx = newHead.x - seg.x;
        const dy = newHead.y - seg.y;
        if (dx*dx + dy*dy < 225) { // 15*15 radius check
           p.isDead = true;
           // Drop orbs from dead player
           for(let j=0; j<p.body.length; j+=2) {
             orbs.push({
               id: Math.random().toString(),
               x: p.body[j].x + (Math.random()*20-10),
               y: p.body[j].y + (Math.random()*20-10),
               value: 5,
               color: p.color
             });
           }
           break;
        }
      }
    });
  });

  io.emit('state', { players, orbs });

}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log('Server running on port ' + PORT));
