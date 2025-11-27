// FLY - P2P Multiplayer Flight Game
// Using PeerJS for P2P connectivity and Three.js for 3D graphics

class FlyGame {
    constructor() {
        // Game state
        this.state = 'lobby'; // lobby, connecting, playing
        this.peer = null;
        this.peerId = null;
        this.connections = new Map();
        this.isHost = false;
        this.currentRoom = null;
        this.rooms = new Map();

        // Player data
        this.player = {
            id: null,
            name: 'Pilot',
            aircraft: 'cessna',
            position: { x: 0, y: 100, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            speed: 0,
            throttle: 0.5,
            health: 100,
            kills: 0,
            deaths: 0
        };

        this.otherPlayers = new Map();

        // Aircraft stats
        this.aircraftStats = {
            cessna: { maxSpeed: 140, maxAlt: 14000, agility: 'Medium', weapons: 'None', color: 0xffffff },
            jet: { maxSpeed: 1500, maxAlt: 50000, agility: 'High', weapons: 'Missiles', color: 0x444444 },
            cyberpink: { maxSpeed: 800, maxAlt: 30000, agility: 'High', weapons: 'Lasers', color: 0xff00ff }
        };

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.playerMesh = null;
        this.otherPlayerMeshes = new Map();

        // Controls
        this.keys = {};
        this.cameraMode = 'third';

        // Game loop
        this.lastUpdate = 0;
        this.gameTime = 15 * 60; // 15 minutes

        // Initialize
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initPeerJS();
        this.initPreviewCanvas();
        this.hideLoading();
    }

    // ==================== PeerJS Setup ====================

    initPeerJS() {
        this.updateConnectionStatus('connecting', 'Connecting to network...');

        // Generate random peer ID
        const randomId = 'fly_' + Math.random().toString(36).substr(2, 9);

        this.peer = new Peer(randomId, {
            debug: 1
        });

        this.peer.on('open', (id) => {
            this.peerId = id;
            this.player.id = id;
            this.updateConnectionStatus('connected', 'Connected');
            console.log('PeerJS connected with ID:', id);

            // Start room discovery
            this.discoverRooms();
        });

        this.peer.on('connection', (conn) => {
            this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            this.updateConnectionStatus('disconnected', 'Connection error');
        });

        this.peer.on('disconnected', () => {
            this.updateConnectionStatus('disconnected', 'Disconnected');
            // Try to reconnect
            setTimeout(() => this.peer.reconnect(), 3000);
        });
    }

    handleIncomingConnection(conn) {
        console.log('Incoming connection from:', conn.peer);

        conn.on('open', () => {
            this.connections.set(conn.peer, conn);

            // Send current game state if host
            if (this.isHost && this.currentRoom) {
                conn.send({
                    type: 'room_state',
                    room: this.currentRoom,
                    players: Array.from(this.otherPlayers.entries()).map(([id, p]) => ({
                        id, ...p
                    })),
                    host: this.player
                });
            }
        });

        conn.on('data', (data) => {
            this.handleMessage(conn.peer, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.removePlayer(conn.peer);
        });
    }

    connectToPeer(peerId) {
        if (this.connections.has(peerId)) return;

        const conn = this.peer.connect(peerId);

        conn.on('open', () => {
            this.connections.set(peerId, conn);
            console.log('Connected to peer:', peerId);
        });

        conn.on('data', (data) => {
            this.handleMessage(peerId, data);
        });

        conn.on('close', () => {
            this.connections.delete(peerId);
            this.removePlayer(peerId);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    broadcast(data, excludePeer = null) {
        this.connections.forEach((conn, peerId) => {
            if (peerId !== excludePeer) {
                try {
                    conn.send(data);
                } catch (e) {
                    console.error('Failed to send to', peerId);
                }
            }
        });
    }

    handleMessage(fromPeer, data) {
        switch (data.type) {
            case 'room_list':
                this.updateRoomList(data.rooms);
                break;

            case 'room_info':
                this.rooms.set(data.room.id, data.room);
                this.renderRoomList();
                break;

            case 'room_state':
                // Received full room state
                this.currentRoom = data.room;
                data.players.forEach(p => {
                    this.otherPlayers.set(p.id, p);
                });
                if (data.host) {
                    this.otherPlayers.set(data.host.id, data.host);
                }
                break;

            case 'player_join':
                this.addPlayer(data.player);
                this.addChatMessage('System', `${data.player.name} joined the game`);
                break;

            case 'player_leave':
                this.removePlayer(data.playerId);
                break;

            case 'player_update':
                this.updatePlayer(fromPeer, data.player);
                break;

            case 'player_fire':
                this.handlePlayerFire(fromPeer, data);
                break;

            case 'player_hit':
                this.handlePlayerHit(data);
                break;

            case 'player_death':
                this.handlePlayerDeath(data);
                break;

            case 'chat':
                this.addChatMessage(data.name, data.message);
                break;

            case 'discover_rooms':
                // Respond with our room if we're hosting
                if (this.isHost && this.currentRoom) {
                    const conn = this.connections.get(fromPeer);
                    if (conn) {
                        conn.send({
                            type: 'room_info',
                            room: {
                                ...this.currentRoom,
                                playerCount: this.connections.size + 1
                            }
                        });
                    }
                }
                break;
        }
    }

    // ==================== Room Management ====================

    discoverRooms() {
        // In a real P2P network, we'd use a signaling server or DHT
        // For now, we'll use a simple approach with known peer prefixes
        this.rooms.clear();
        this.renderRoomList();

        // Broadcast room discovery to connected peers
        this.broadcast({ type: 'discover_rooms' });
    }

    createRoom(name, maxPlayers, gameMode) {
        this.currentRoom = {
            id: this.peerId,
            name: name || `${this.player.name}'s Room`,
            host: this.peerId,
            maxPlayers: maxPlayers,
            gameMode: gameMode,
            playerCount: 1,
            createdAt: Date.now()
        };

        this.isHost = true;
        this.startGame();
    }

    joinRoom(roomId) {
        this.connectToPeer(roomId);
        this.isHost = false;

        // Wait for connection and room state
        setTimeout(() => {
            const conn = this.connections.get(roomId);
            if (conn) {
                conn.send({
                    type: 'player_join',
                    player: {
                        id: this.peerId,
                        name: this.player.name,
                        aircraft: this.player.aircraft
                    }
                });
                this.startGame();
            }
        }, 1000);
    }

    quickPlay() {
        // Find a room with available space or create one
        let foundRoom = null;

        for (const [id, room] of this.rooms) {
            if (room.playerCount < room.maxPlayers) {
                foundRoom = room;
                break;
            }
        }

        if (foundRoom) {
            this.joinRoom(foundRoom.id);
        } else {
            this.createRoom('Quick Play', 8, 'ffa');
        }
    }

    updateRoomList(rooms) {
        rooms.forEach(room => {
            this.rooms.set(room.id, room);
        });
        this.renderRoomList();
    }

    renderRoomList() {
        const roomList = document.getElementById('room-list');

        if (this.rooms.size === 0) {
            roomList.innerHTML = `
                <div class="no-rooms">
                    <p>No rooms available</p>
                    <p>Create a new room or use Quick Play!</p>
                </div>
            `;
            return;
        }

        roomList.innerHTML = '';

        this.rooms.forEach((room, id) => {
            const roomEl = document.createElement('div');
            roomEl.className = 'room-item';
            roomEl.innerHTML = `
                <div class="room-info">
                    <h3>${this.escapeHtml(room.name)}</h3>
                    <p>${room.gameMode.toUpperCase()} | Host: ${room.host.substring(0, 8)}...</p>
                </div>
                <div class="room-players">
                    <span class="player-count">${room.playerCount}/${room.maxPlayers}</span>
                    <button class="btn" data-room-id="${id}">Join</button>
                </div>
            `;

            roomEl.querySelector('button').addEventListener('click', () => {
                this.joinRoom(id);
            });

            roomList.appendChild(roomEl);
        });
    }

    // ==================== Game Engine ====================

    initGame() {
        const canvas = document.getElementById('game-canvas');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 500, 10000);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000);
        this.camera.position.set(0, 150, -200);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 200, 100);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // Create world
        this.createWorld();

        // Create player aircraft
        this.createPlayerAircraft();

        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Setup minimap
        this.setupMinimap();
    }

    createWorld() {
        // Ground
        const groundGeometry = new THREE.PlaneGeometry(20000, 20000);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x3d9140 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Ocean (far away)
        const oceanGeometry = new THREE.PlaneGeometry(50000, 50000);
        const oceanMaterial = new THREE.MeshLambertMaterial({ color: 0x1e90ff });
        const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
        ocean.rotation.x = -Math.PI / 2;
        ocean.position.y = -5;
        ocean.position.z = 15000;
        this.scene.add(ocean);

        // Runway
        const runwayGeometry = new THREE.BoxGeometry(50, 1, 1000);
        const runwayMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
        runway.position.y = 0.5;
        runway.receiveShadow = true;
        this.scene.add(runway);

        // Runway markings
        for (let i = -400; i < 400; i += 50) {
            const markingGeometry = new THREE.BoxGeometry(2, 0.1, 20);
            const markingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const marking = new THREE.Mesh(markingGeometry, markingMaterial);
            marking.position.set(0, 1, i);
            this.scene.add(marking);
        }

        // Buildings
        for (let i = 0; i < 20; i++) {
            const width = 20 + Math.random() * 30;
            const height = 30 + Math.random() * 100;
            const depth = 20 + Math.random() * 30;

            const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
            const buildingMaterial = new THREE.MeshLambertMaterial({
                color: new THREE.Color().setHSL(0, 0, 0.3 + Math.random() * 0.4)
            });
            const building = new THREE.Mesh(buildingGeometry, buildingMaterial);

            const angle = Math.random() * Math.PI * 2;
            const distance = 500 + Math.random() * 2000;
            building.position.set(
                Math.cos(angle) * distance,
                height / 2,
                Math.sin(angle) * distance
            );
            building.castShadow = true;
            building.receiveShadow = true;
            this.scene.add(building);
        }

        // Control Tower
        const towerGeometry = new THREE.CylinderGeometry(5, 8, 80, 8);
        const towerMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const tower = new THREE.Mesh(towerGeometry, towerMaterial);
        tower.position.set(100, 40, 0);
        tower.castShadow = true;
        this.scene.add(tower);

        // Tower cabin
        const cabinGeometry = new THREE.CylinderGeometry(12, 10, 15, 8);
        const cabinMaterial = new THREE.MeshLambertMaterial({ color: 0x87ceeb });
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(100, 85, 0);
        this.scene.add(cabin);

        // Mountains in distance
        for (let i = 0; i < 10; i++) {
            const mountainGeometry = new THREE.ConeGeometry(500 + Math.random() * 500, 800 + Math.random() * 600, 4);
            const mountainMaterial = new THREE.MeshLambertMaterial({ color: 0x6b8e23 });
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);

            const angle = (i / 10) * Math.PI * 2;
            mountain.position.set(
                Math.cos(angle) * 8000,
                0,
                Math.sin(angle) * 8000
            );
            mountain.rotation.y = Math.random() * Math.PI;
            this.scene.add(mountain);
        }

        // Clouds
        for (let i = 0; i < 50; i++) {
            const cloudGroup = new THREE.Group();

            for (let j = 0; j < 5; j++) {
                const cloudGeometry = new THREE.SphereGeometry(30 + Math.random() * 50, 8, 8);
                const cloudMaterial = new THREE.MeshLambertMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0.8
                });
                const cloudPart = new THREE.Mesh(cloudGeometry, cloudMaterial);
                cloudPart.position.set(
                    Math.random() * 80 - 40,
                    Math.random() * 20 - 10,
                    Math.random() * 80 - 40
                );
                cloudGroup.add(cloudPart);
            }

            cloudGroup.position.set(
                Math.random() * 10000 - 5000,
                500 + Math.random() * 1000,
                Math.random() * 10000 - 5000
            );
            this.scene.add(cloudGroup);
        }
    }

    createPlayerAircraft() {
        const stats = this.aircraftStats[this.player.aircraft];

        // Simple aircraft geometry
        const group = new THREE.Group();

        // Fuselage
        const fuselageGeometry = new THREE.CylinderGeometry(2, 3, 20, 8);
        fuselageGeometry.rotateX(Math.PI / 2);
        const fuselageMaterial = new THREE.MeshLambertMaterial({ color: stats.color });
        const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
        group.add(fuselage);

        // Wings
        const wingGeometry = new THREE.BoxGeometry(30, 0.5, 5);
        const wingMaterial = new THREE.MeshLambertMaterial({ color: stats.color });
        const wings = new THREE.Mesh(wingGeometry, wingMaterial);
        wings.position.z = -2;
        group.add(wings);

        // Tail
        const tailGeometry = new THREE.BoxGeometry(10, 0.5, 3);
        const tail = new THREE.Mesh(tailGeometry, new THREE.MeshLambertMaterial({ color: stats.color }));
        tail.position.z = -10;
        group.add(tail);

        // Vertical stabilizer
        const stabGeometry = new THREE.BoxGeometry(0.5, 5, 3);
        const stab = new THREE.Mesh(stabGeometry, new THREE.MeshLambertMaterial({ color: stats.color }));
        stab.position.set(0, 2.5, -10);
        group.add(stab);

        // Cockpit
        const cockpitGeometry = new THREE.SphereGeometry(2, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMaterial = new THREE.MeshLambertMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.7 });
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.position.set(0, 1.5, 5);
        group.add(cockpit);

        group.castShadow = true;
        group.position.set(this.player.position.x, this.player.position.y, this.player.position.z);

        this.playerMesh = group;
        this.scene.add(group);
    }

    createOtherPlayerMesh(playerData) {
        const stats = this.aircraftStats[playerData.aircraft] || this.aircraftStats.cessna;

        const group = new THREE.Group();

        // Fuselage
        const fuselageGeometry = new THREE.CylinderGeometry(2, 3, 20, 8);
        fuselageGeometry.rotateX(Math.PI / 2);
        const fuselageMaterial = new THREE.MeshLambertMaterial({ color: stats.color });
        const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
        group.add(fuselage);

        // Wings
        const wingGeometry = new THREE.BoxGeometry(30, 0.5, 5);
        const wings = new THREE.Mesh(wingGeometry, new THREE.MeshLambertMaterial({ color: stats.color }));
        wings.position.z = -2;
        group.add(wings);

        // Tail
        const tailGeometry = new THREE.BoxGeometry(10, 0.5, 3);
        const tail = new THREE.Mesh(tailGeometry, new THREE.MeshLambertMaterial({ color: stats.color }));
        tail.position.z = -10;
        group.add(tail);

        // Vertical stabilizer
        const stabGeometry = new THREE.BoxGeometry(0.5, 5, 3);
        const stab = new THREE.Mesh(stabGeometry, new THREE.MeshLambertMaterial({ color: stats.color }));
        stab.position.set(0, 2.5, -10);
        group.add(stab);

        // Name tag
        // (Would use CSS2DRenderer in production)

        group.castShadow = true;
        this.scene.add(group);

        return group;
    }

    // ==================== Game Loop ====================

    startGame() {
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game-container').classList.add('active');

        this.state = 'playing';
        this.initGame();

        // Start position
        this.player.position = { x: 0, y: 100, z: -300 };
        this.player.rotation = { x: 0, y: 0, z: 0 };

        // Notify others
        this.broadcast({
            type: 'player_join',
            player: {
                id: this.peerId,
                name: this.player.name,
                aircraft: this.player.aircraft,
                position: this.player.position,
                rotation: this.player.rotation
            }
        });

        // Start game loop
        this.lastUpdate = performance.now();
        this.gameLoop();
    }

    gameLoop() {
        if (this.state !== 'playing') return;

        const now = performance.now();
        const delta = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;

        this.updatePlayer(delta);
        this.updateOtherPlayers();
        this.updateCamera();
        this.updateHUD();
        this.updateMinimap();
        this.updateGameTimer(delta);

        // Broadcast position at 20Hz
        if (now % 50 < delta * 1000) {
            this.broadcastPosition();
        }

        this.renderer.render(this.scene, this.camera);

        requestAnimationFrame(() => this.gameLoop());
    }

    updatePlayer(delta) {
        const stats = this.aircraftStats[this.player.aircraft];
        const maxSpeed = stats.maxSpeed / 10; // Scale for game units

        // Input handling
        if (this.keys['KeyW'] || this.keys['ArrowUp']) {
            this.player.throttle = Math.min(1, this.player.throttle + delta);
        }
        if (this.keys['KeyS'] || this.keys['ArrowDown']) {
            this.player.throttle = Math.max(0, this.player.throttle - delta);
        }

        // Speed based on throttle
        const targetSpeed = this.player.throttle * maxSpeed;
        this.player.speed += (targetSpeed - this.player.speed) * delta * 2;

        // Rotation
        const rotSpeed = 2;
        if (this.keys['ArrowLeft']) {
            this.player.rotation.z += rotSpeed * delta;
            this.player.rotation.y += rotSpeed * 0.5 * delta;
        }
        if (this.keys['ArrowRight']) {
            this.player.rotation.z -= rotSpeed * delta;
            this.player.rotation.y -= rotSpeed * 0.5 * delta;
        }

        // Pitch
        if (this.keys['KeyQ']) {
            this.player.rotation.x -= rotSpeed * delta;
        }
        if (this.keys['KeyE']) {
            this.player.rotation.x += rotSpeed * delta;
        }

        // Bank to pitch (realistic banking)
        this.player.rotation.x -= this.player.rotation.z * delta * 0.5;

        // Limit bank
        this.player.rotation.z = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.player.rotation.z));

        // Return to level gradually
        this.player.rotation.z *= 0.98;
        this.player.rotation.x *= 0.99;

        // Calculate velocity based on rotation
        const direction = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromEuler(new THREE.Euler(
            this.player.rotation.x,
            this.player.rotation.y,
            this.player.rotation.z,
            'YXZ'
        ));
        direction.applyQuaternion(quaternion);

        // Update position
        this.player.position.x += direction.x * this.player.speed * delta * 10;
        this.player.position.y += direction.y * this.player.speed * delta * 10;
        this.player.position.z += direction.z * this.player.speed * delta * 10;

        // Gravity effect when slow
        if (this.player.speed < 5) {
            this.player.position.y -= (5 - this.player.speed) * delta * 5;
        }

        // Ground collision
        if (this.player.position.y < 10) {
            if (this.player.speed > 20 || Math.abs(this.player.rotation.z) > 0.3) {
                // Crash!
                this.handleCrash();
            }
            this.player.position.y = 10;
        }

        // Altitude limit
        const maxAlt = stats.maxAlt / 10;
        if (this.player.position.y > maxAlt) {
            this.player.position.y = maxAlt;
        }

        // Update mesh
        if (this.playerMesh) {
            this.playerMesh.position.set(
                this.player.position.x,
                this.player.position.y,
                this.player.position.z
            );
            this.playerMesh.rotation.set(
                this.player.rotation.x,
                this.player.rotation.y,
                this.player.rotation.z,
                'YXZ'
            );
        }
    }

    updateOtherPlayers() {
        this.otherPlayers.forEach((playerData, id) => {
            let mesh = this.otherPlayerMeshes.get(id);

            if (!mesh) {
                mesh = this.createOtherPlayerMesh(playerData);
                this.otherPlayerMeshes.set(id, mesh);
            }

            // Smooth interpolation
            if (playerData.position) {
                mesh.position.lerp(
                    new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z),
                    0.2
                );
            }

            if (playerData.rotation) {
                mesh.rotation.set(
                    playerData.rotation.x,
                    playerData.rotation.y,
                    playerData.rotation.z,
                    'YXZ'
                );
            }
        });
    }

    updateCamera() {
        if (!this.playerMesh) return;

        const offset = new THREE.Vector3();

        if (this.cameraMode === 'third') {
            offset.set(0, 30, -80);
        } else if (this.cameraMode === 'cockpit') {
            offset.set(0, 3, 8);
        } else if (this.cameraMode === 'chase') {
            offset.set(0, 50, -150);
        }

        offset.applyQuaternion(this.playerMesh.quaternion);
        const targetPos = this.playerMesh.position.clone().add(offset);

        this.camera.position.lerp(targetPos, 0.1);
        this.camera.lookAt(this.playerMesh.position);
    }

    updateHUD() {
        const stats = this.aircraftStats[this.player.aircraft];

        // Health
        document.getElementById('health-fill').style.width = `${this.player.health}%`;

        // Speed (convert to knots-like display)
        const displaySpeed = Math.round(this.player.speed * 10);
        document.getElementById('speed-value').textContent = `${displaySpeed} kts`;

        // Altitude
        const displayAlt = Math.round(this.player.position.y * 10);
        document.getElementById('altitude-value').textContent = `${displayAlt} ft`;

        // K/D
        document.getElementById('kd-value').textContent = `${this.player.kills} / ${this.player.deaths}`;

        // Update leaderboard
        this.updateLeaderboard();
    }

    updateLeaderboard() {
        const leaderboardList = document.getElementById('leaderboard-list');
        const players = [
            { id: this.peerId, name: this.player.name, kills: this.player.kills, deaths: this.player.deaths }
        ];

        this.otherPlayers.forEach((p, id) => {
            players.push({ id, name: p.name || 'Unknown', kills: p.kills || 0, deaths: p.deaths || 0 });
        });

        // Sort by kills
        players.sort((a, b) => b.kills - a.kills);

        leaderboardList.innerHTML = players.slice(0, 5).map((p, i) => `
            <div class="leaderboard-item ${p.id === this.peerId ? 'self' : ''}">
                <span>${i + 1}. ${this.escapeHtml(p.name)}</span>
                <span>${p.kills}/${p.deaths}</span>
            </div>
        `).join('');
    }

    updateGameTimer(delta) {
        this.gameTime -= delta;
        if (this.gameTime <= 0) {
            this.endGame();
            return;
        }

        const minutes = Math.floor(this.gameTime / 60);
        const seconds = Math.floor(this.gameTime % 60);
        document.getElementById('game-timer').textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    setupMinimap() {
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        this.minimapCanvas.width = 180;
        this.minimapCanvas.height = 180;
    }

    updateMinimap() {
        if (!this.minimapCtx) return;

        const ctx = this.minimapCtx;
        const size = 180;
        const scale = 0.02;

        // Clear
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw runway
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const rx = size / 2 + (0 - this.player.position.x) * scale;
        const rz = size / 2 + (0 - this.player.position.z) * scale;
        ctx.moveTo(rx, rz - 10);
        ctx.lineTo(rx, rz + 10);
        ctx.stroke();

        // Draw other players
        ctx.fillStyle = '#ff4444';
        this.otherPlayers.forEach((p) => {
            if (p.position) {
                const px = size / 2 + (p.position.x - this.player.position.x) * scale;
                const pz = size / 2 + (p.position.z - this.player.position.z) * scale;
                const dist = Math.sqrt(Math.pow(px - size / 2, 2) + Math.pow(pz - size / 2, 2));

                if (dist < size / 2 - 5) {
                    ctx.beginPath();
                    ctx.arc(px, pz, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });

        // Draw player (center)
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw player direction
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(size / 2, size / 2);
        ctx.lineTo(
            size / 2 + Math.sin(this.player.rotation.y) * 15,
            size / 2 - Math.cos(this.player.rotation.y) * 15
        );
        ctx.stroke();
    }

    broadcastPosition() {
        this.broadcast({
            type: 'player_update',
            player: {
                position: this.player.position,
                rotation: this.player.rotation,
                speed: this.player.speed,
                health: this.player.health,
                kills: this.player.kills,
                deaths: this.player.deaths
            }
        });
    }

    // ==================== Combat ====================

    fire() {
        if (this.player.aircraft === 'cessna') return; // No weapons

        // Create projectile visually
        const projectileGeometry = new THREE.SphereGeometry(1, 8, 8);
        const projectileMaterial = new THREE.MeshBasicMaterial({
            color: this.player.aircraft === 'cyberpink' ? 0xff00ff : 0xff0000
        });
        const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);

        projectile.position.copy(this.playerMesh.position);

        const direction = new THREE.Vector3(0, 0, 1);
        direction.applyQuaternion(this.playerMesh.quaternion);

        this.scene.add(projectile);

        // Animate projectile
        const speed = 500;
        const startTime = performance.now();

        const animateProjectile = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            if (elapsed > 3) {
                this.scene.remove(projectile);
                return;
            }

            projectile.position.add(direction.clone().multiplyScalar(speed * 0.016));

            // Check collision with other players
            this.otherPlayers.forEach((p, id) => {
                if (p.position) {
                    const dist = projectile.position.distanceTo(
                        new THREE.Vector3(p.position.x, p.position.y, p.position.z)
                    );
                    if (dist < 20) {
                        this.broadcast({
                            type: 'player_hit',
                            targetId: id,
                            shooterId: this.peerId,
                            damage: 25
                        });
                        this.scene.remove(projectile);
                        return;
                    }
                }
            });

            requestAnimationFrame(animateProjectile);
        };

        animateProjectile();

        // Broadcast fire event
        this.broadcast({
            type: 'player_fire',
            position: this.player.position,
            rotation: this.player.rotation
        });
    }

    handlePlayerFire(fromPeer, data) {
        // Create visual projectile for other player's fire
        const playerData = this.otherPlayers.get(fromPeer);
        if (!playerData) return;

        // Similar projectile animation...
    }

    handlePlayerHit(data) {
        if (data.targetId === this.peerId) {
            this.player.health -= data.damage;

            if (this.player.health <= 0) {
                this.handleDeath(data.shooterId);
            }
        }
    }

    handleDeath(killerId) {
        this.player.deaths++;
        this.player.health = 100;

        // Respawn
        this.player.position = {
            x: Math.random() * 1000 - 500,
            y: 200,
            z: Math.random() * 1000 - 500
        };

        // Notify others
        this.broadcast({
            type: 'player_death',
            playerId: this.peerId,
            killerId: killerId
        });

        // Update killer's score
        if (killerId) {
            const killer = this.otherPlayers.get(killerId);
            if (killer) {
                killer.kills = (killer.kills || 0) + 1;
            }
        }
    }

    handlePlayerDeath(data) {
        if (data.killerId === this.peerId) {
            this.player.kills++;
            this.addChatMessage('System', `You killed ${this.otherPlayers.get(data.playerId)?.name || 'someone'}!`);
        }
    }

    handleCrash() {
        this.player.health = 0;
        this.handleDeath(null);
        this.addChatMessage('System', 'You crashed!');
    }

    // ==================== Player Management ====================

    addPlayer(playerData) {
        this.otherPlayers.set(playerData.id, playerData);
    }

    removePlayer(playerId) {
        this.otherPlayers.delete(playerId);

        const mesh = this.otherPlayerMeshes.get(playerId);
        if (mesh) {
            this.scene.remove(mesh);
            this.otherPlayerMeshes.delete(playerId);
        }
    }

    updatePlayerData(playerId, data) {
        const player = this.otherPlayers.get(playerId);
        if (player) {
            Object.assign(player, data);
        }
    }

    // ==================== Chat ====================

    sendChat(message) {
        if (!message.trim()) return;

        this.addChatMessage(this.player.name, message);

        this.broadcast({
            type: 'chat',
            name: this.player.name,
            message: message
        });
    }

    addChatMessage(name, message) {
        const chatMessages = document.getElementById('chat-messages');
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message';
        msgEl.innerHTML = `<span class="name">${this.escapeHtml(name)}:</span> ${this.escapeHtml(message)}`;
        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Limit messages
        while (chatMessages.children.length > 50) {
            chatMessages.removeChild(chatMessages.firstChild);
        }
    }

    // ==================== UI Helpers ====================

    updateConnectionStatus(status, text) {
        const statusEl = document.getElementById('connection-status');
        statusEl.className = `connection-status ${status}`;
        statusEl.textContent = text;
    }

    hideLoading() {
        setTimeout(() => {
            document.getElementById('loading-overlay').classList.add('hidden');
        }, 500);
    }

    onWindowResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    initPreviewCanvas() {
        const canvas = document.getElementById('preview-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        canvas.width = 250;
        canvas.height = 150;

        // Simple aircraft preview
        const drawPreview = () => {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const stats = this.aircraftStats[this.player.aircraft];
            const color = '#' + stats.color.toString(16).padStart(6, '0');

            // Draw simple aircraft shape
            ctx.fillStyle = color;
            ctx.beginPath();

            // Fuselage
            ctx.ellipse(125, 75, 40, 15, 0, 0, Math.PI * 2);
            ctx.fill();

            // Wings
            ctx.fillRect(85, 70, 80, 8);

            // Tail
            ctx.fillRect(100, 65, 30, 5);
            ctx.fillRect(115, 50, 5, 20);

            // Cockpit
            ctx.fillStyle = '#87ceeb';
            ctx.beginPath();
            ctx.ellipse(150, 72, 10, 8, 0, 0, Math.PI * 2);
            ctx.fill();
        };

        drawPreview();

        // Update on aircraft change
        document.getElementById('aircraft-select').addEventListener('change', (e) => {
            this.player.aircraft = e.target.value;
            drawPreview();
            this.updateAircraftStats();
        });
    }

    updateAircraftStats() {
        const stats = this.aircraftStats[this.player.aircraft];
        document.getElementById('stat-speed').textContent = `${stats.maxSpeed} kts`;
        document.getElementById('stat-alt').textContent = `${stats.maxAlt.toLocaleString()} ft`;
        document.getElementById('stat-agility').textContent = stats.agility;
        document.getElementById('stat-weapons').textContent = stats.weapons;
    }

    endGame() {
        this.state = 'lobby';

        // Show results
        alert(`Game Over!\n\nYour Score:\nKills: ${this.player.kills}\nDeaths: ${this.player.deaths}`);

        // Return to lobby
        document.getElementById('game-container').classList.remove('active');
        document.getElementById('lobby').classList.remove('hidden');

        // Cleanup
        this.cleanup();
    }

    exitGame() {
        this.state = 'lobby';

        // Notify others
        this.broadcast({
            type: 'player_leave',
            playerId: this.peerId
        });

        // Return to lobby
        document.getElementById('game-container').classList.remove('active');
        document.getElementById('lobby').classList.remove('hidden');

        // Cleanup
        this.cleanup();
    }

    cleanup() {
        // Clear scene
        if (this.scene) {
            while (this.scene.children.length > 0) {
                this.scene.remove(this.scene.children[0]);
            }
        }

        // Clear connections
        this.connections.forEach(conn => conn.close());
        this.connections.clear();

        // Reset state
        this.otherPlayers.clear();
        this.otherPlayerMeshes.clear();
        this.currentRoom = null;
        this.isHost = false;
        this.gameTime = 15 * 60;
    }

    // ==================== Event Listeners ====================

    setupEventListeners() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;

            if (e.code === 'Space' && this.state === 'playing') {
                this.fire();
            }

            if (e.code === 'KeyV' && this.state === 'playing') {
                const modes = ['third', 'cockpit', 'chase'];
                const currentIndex = modes.indexOf(this.cameraMode);
                this.cameraMode = modes[(currentIndex + 1) % modes.length];
            }

            if (e.code === 'Enter' && this.state === 'playing') {
                const chatInput = document.getElementById('chat-input');
                if (document.activeElement === chatInput) {
                    this.sendChat(chatInput.value);
                    chatInput.value = '';
                    chatInput.blur();
                } else {
                    chatInput.focus();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Player name
        const nameInput = document.getElementById('player-name');
        nameInput.value = localStorage.getItem('flyPlayerName') || '';
        nameInput.addEventListener('input', (e) => {
            this.player.name = e.target.value || 'Pilot';
            localStorage.setItem('flyPlayerName', e.target.value);
        });
        this.player.name = nameInput.value || 'Pilot';

        // Aircraft select
        document.getElementById('aircraft-select').addEventListener('change', (e) => {
            this.player.aircraft = e.target.value;
        });

        // Quick play
        document.getElementById('quick-play-btn').addEventListener('click', () => {
            if (!this.player.name.trim()) {
                this.player.name = 'Pilot_' + Math.random().toString(36).substr(2, 4);
            }
            this.quickPlay();
        });

        // Create room button
        document.getElementById('create-room-btn').addEventListener('click', () => {
            document.getElementById('create-room-modal').classList.remove('hidden');
        });

        // Cancel create room
        document.getElementById('cancel-create').addEventListener('click', () => {
            document.getElementById('create-room-modal').classList.add('hidden');
        });

        // Confirm create room
        document.getElementById('confirm-create').addEventListener('click', () => {
            const name = document.getElementById('room-name').value;
            const maxPlayers = parseInt(document.getElementById('max-players').value);
            const gameMode = document.getElementById('game-mode').value;

            if (!this.player.name.trim()) {
                this.player.name = 'Pilot_' + Math.random().toString(36).substr(2, 4);
            }

            document.getElementById('create-room-modal').classList.add('hidden');
            this.createRoom(name, maxPlayers, gameMode);
        });

        // Refresh rooms
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.discoverRooms();
        });

        // Exit game
        document.getElementById('exit-game').addEventListener('click', () => {
            this.exitGame();
        });

        // Chat send
        document.getElementById('chat-send').addEventListener('click', () => {
            const chatInput = document.getElementById('chat-input');
            this.sendChat(chatInput.value);
            chatInput.value = '';
        });

        // Mobile controls
        this.setupMobileControls();
    }

    setupMobileControls() {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (isMobile) {
            document.getElementById('mobile-controls').style.display = 'flex';
        }

        // Joystick handling
        const leftJoystick = document.getElementById('joystick-left');
        const leftKnob = document.getElementById('joystick-knob-left');
        const rightJoystick = document.getElementById('joystick-right');
        const rightKnob = document.getElementById('joystick-knob-right');

        let leftActive = false;
        let rightActive = false;

        const handleJoystick = (joystick, knob, e, isLeft) => {
            const rect = joystick.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const touch = e.touches[0];
            const x = touch.clientX - rect.left - centerX;
            const y = touch.clientY - rect.top - centerY;

            const maxDist = 35;
            const dist = Math.min(maxDist, Math.sqrt(x * x + y * y));
            const angle = Math.atan2(y, x);

            const knobX = Math.cos(angle) * dist;
            const knobY = Math.sin(angle) * dist;

            knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

            // Apply to controls
            const normalX = knobX / maxDist;
            const normalY = knobY / maxDist;

            if (isLeft) {
                // Left stick controls roll/pitch
                if (normalX < -0.3) this.keys['ArrowLeft'] = true;
                else if (normalX > 0.3) this.keys['ArrowRight'] = true;
                else {
                    this.keys['ArrowLeft'] = false;
                    this.keys['ArrowRight'] = false;
                }

                if (normalY < -0.3) this.keys['KeyQ'] = true;
                else if (normalY > 0.3) this.keys['KeyE'] = true;
                else {
                    this.keys['KeyQ'] = false;
                    this.keys['KeyE'] = false;
                }
            } else {
                // Right stick controls throttle
                if (normalY < -0.3) this.keys['KeyW'] = true;
                else if (normalY > 0.3) this.keys['KeyS'] = true;
                else {
                    this.keys['KeyW'] = false;
                    this.keys['KeyS'] = false;
                }
            }
        };

        leftJoystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            leftActive = true;
            handleJoystick(leftJoystick, leftKnob, e, true);
        });

        leftJoystick.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (leftActive) handleJoystick(leftJoystick, leftKnob, e, true);
        });

        leftJoystick.addEventListener('touchend', () => {
            leftActive = false;
            leftKnob.style.transform = 'translate(-50%, -50%)';
            this.keys['ArrowLeft'] = false;
            this.keys['ArrowRight'] = false;
            this.keys['KeyQ'] = false;
            this.keys['KeyE'] = false;
        });

        rightJoystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            rightActive = true;
            handleJoystick(rightJoystick, rightKnob, e, false);
        });

        rightJoystick.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (rightActive) handleJoystick(rightJoystick, rightKnob, e, false);
        });

        rightJoystick.addEventListener('touchend', () => {
            rightActive = false;
            rightKnob.style.transform = 'translate(-50%, -50%)';
            this.keys['KeyW'] = false;
            this.keys['KeyS'] = false;
        });

        // Fire button
        document.getElementById('fire-btn').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.fire();
        });

        // Boost button
        document.getElementById('boost-btn').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.player.throttle = 1;
        });
    }
}

// Initialize game
window.addEventListener('DOMContentLoaded', () => {
    window.game = new FlyGame();
});
