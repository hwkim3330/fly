// FLY - P2P Multiplayer Flight Combat
// Enhanced version with better graphics, sound, and gameplay

class FlyGame {
    constructor() {
        this.state = 'lobby';
        this.peer = null;
        this.peerId = null;
        this.connections = new Map();
        this.isHost = false;
        this.currentRoom = null;
        this.rooms = new Map();

        this.player = {
            id: null,
            name: 'Pilot',
            aircraft: 'cessna',
            position: new THREE.Vector3(0, 100, 0),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            velocity: new THREE.Vector3(),
            speed: 0,
            throttle: 0.3,
            health: 100,
            kills: 0,
            deaths: 0
        };

        this.otherPlayers = new Map();

        this.aircraftStats = {
            cessna: {
                maxSpeed: 140, maxAlt: 14000, agility: 50, weapons: 0,
                color: 0xffffff, accentColor: 0x0066cc
            },
            jet: {
                maxSpeed: 1500, maxAlt: 50000, agility: 80, weapons: 100,
                color: 0x444444, accentColor: 0xff0000
            },
            cyberpink: {
                maxSpeed: 800, maxAlt: 30000, agility: 90, weapons: 80,
                color: 0xff00ff, accentColor: 0x00ffff
            }
        };

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.playerMesh = null;
        this.otherPlayerMeshes = new Map();
        this.projectiles = [];  // Fast missiles
        this.flares = [];       // Defensive flares
        this.explosions = [];

        this.keys = {};
        this.lastFireTime = 0;
        this.lastFlareTime = 0;
        this.cameraMode = 'third';
        this.cameraOffset = new THREE.Vector3(0, 15, -50);

        this.lastUpdate = 0;
        this.gameTime = 15 * 60;
        this.lastBroadcast = 0;

        // Audio
        this.audioCtx = null;
        this.sounds = {};

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initPeerJS();
        this.initAudio();
        this.hideLoading();
    }

    // ==================== AUDIO ====================

    initAudio() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playSound(type) {
        if (!this.audioCtx) return;

        const ctx = this.audioCtx;
        const now = ctx.currentTime;

        if (type === 'engine') {
            // Continuous engine sound
        } else if (type === 'fire') {
            // Missile launch - aggressive whoosh sound
            const osc = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);

            osc2.type = 'square';
            osc2.frequency.setValueAtTime(150, now);
            osc2.frequency.exponentialRampToValueAtTime(80, now + 0.3);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2000, now);

            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

            osc.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc2.start(now);
            osc.stop(now + 0.3);
            osc2.stop(now + 0.3);
        } else if (type === 'flare') {
            // Flare pop sound
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        } else if (type === 'explosion') {
            const noise = ctx.createBufferSource();
            const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1000, now);
            filter.frequency.exponentialRampToValueAtTime(100, now + 0.5);

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noise.start(now);
        } else if (type === 'hit') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.1);
        }
    }

    // ==================== PEERJS ====================

    initPeerJS() {
        this.updateConnectionStatus('connecting', 'Connecting');

        const randomId = 'fly_' + Math.random().toString(36).substr(2, 9);

        this.peer = new Peer(randomId, { debug: 0 });

        this.peer.on('open', (id) => {
            this.peerId = id;
            this.player.id = id;
            this.updateConnectionStatus('connected', 'Online');
            console.log('Connected:', id);
            this.discoverRooms();
        });

        this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));
        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            this.updateConnectionStatus('disconnected', 'Error');
        });
        this.peer.on('disconnected', () => {
            this.updateConnectionStatus('disconnected', 'Offline');
            setTimeout(() => this.peer.reconnect(), 3000);
        });
    }

    handleIncomingConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (this.isHost && this.currentRoom) {
                conn.send({
                    type: 'room_state',
                    room: this.currentRoom,
                    players: Array.from(this.otherPlayers.entries()),
                    host: { id: this.peerId, ...this.getPlayerState() }
                });
            }
        });
        conn.on('data', (data) => this.handleMessage(conn.peer, data));
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.removePlayer(conn.peer);
        });
    }

    connectToPeer(peerId) {
        if (this.connections.has(peerId) || peerId === this.peerId) return;

        const conn = this.peer.connect(peerId, { reliable: true });

        conn.on('open', () => {
            this.connections.set(peerId, conn);
        });
        conn.on('data', (data) => this.handleMessage(peerId, data));
        conn.on('close', () => {
            this.connections.delete(peerId);
            this.removePlayer(peerId);
        });
    }

    broadcast(data, exclude = null) {
        this.connections.forEach((conn, id) => {
            if (id !== exclude) {
                try { conn.send(data); } catch (e) {}
            }
        });
    }

    handleMessage(from, data) {
        switch (data.type) {
            case 'room_info':
                this.rooms.set(data.room.id, data.room);
                this.renderRoomList();
                break;

            case 'room_state':
                this.currentRoom = data.room;
                if (data.host) this.otherPlayers.set(data.host.id, data.host);
                data.players?.forEach(([id, p]) => this.otherPlayers.set(id, p));
                break;

            case 'player_join':
                this.addPlayer(data.player);
                this.addChat('System', `${data.player.name} joined`, true);
                break;

            case 'player_leave':
                const p = this.otherPlayers.get(data.id);
                if (p) this.addChat('System', `${p.name} left`, true);
                this.removePlayer(data.id);
                break;

            case 'player_update':
                this.updateOtherPlayer(from, data);
                break;

            case 'fire':
                this.createProjectile(data.position, data.direction, from, data.color);
                this.playSound('fire');
                break;

            case 'flare':
                this.createFlare(data.position, data.direction, from);
                this.playSound('flare');
                break;

            case 'hit':
                if (data.target === this.peerId) {
                    this.player.health -= data.damage;
                    this.playSound('hit');
                    if (this.player.health <= 0) this.handleDeath(data.shooter);
                }
                break;

            case 'death':
                this.addKillFeed(data.killerName, data.victimName);
                if (data.killer === this.peerId) this.player.kills++;
                break;

            case 'chat':
                this.addChat(data.name, data.msg);
                break;

            case 'discover':
                if (this.isHost && this.currentRoom) {
                    const conn = this.connections.get(from);
                    if (conn) conn.send({
                        type: 'room_info',
                        room: { ...this.currentRoom, players: this.connections.size + 1 }
                    });
                }
                break;
        }
    }

    getPlayerState() {
        return {
            name: this.player.name,
            aircraft: this.player.aircraft,
            position: this.player.position.toArray(),
            rotation: [this.player.rotation.x, this.player.rotation.y, this.player.rotation.z],
            speed: this.player.speed,
            health: this.player.health,
            kills: this.player.kills,
            deaths: this.player.deaths
        };
    }

    // ==================== ROOMS ====================

    discoverRooms() {
        this.rooms.clear();
        this.renderRoomList();
        this.broadcast({ type: 'discover' });
    }

    createRoom(name, maxPlayers, mode) {
        this.currentRoom = {
            id: this.peerId,
            name: name || `${this.player.name}'s Room`,
            host: this.peerId,
            maxPlayers,
            mode,
            players: 1
        };
        this.isHost = true;
        this.startGame();
    }

    joinRoom(roomId) {
        this.connectToPeer(roomId);
        this.isHost = false;
        setTimeout(() => {
            const conn = this.connections.get(roomId);
            if (conn) {
                conn.send({ type: 'player_join', player: { id: this.peerId, ...this.getPlayerState() } });
                this.startGame();
            }
        }, 500);
    }

    quickPlay() {
        if (!this.player.name.trim()) {
            this.player.name = 'Pilot_' + Math.random().toString(36).substr(2, 4);
            document.getElementById('player-name').value = this.player.name;
        }

        let found = null;
        for (const [id, room] of this.rooms) {
            if (room.players < room.maxPlayers) { found = room; break; }
        }
        found ? this.joinRoom(found.id) : this.createRoom('Quick Play', 8, 'ffa');
    }

    renderRoomList() {
        const list = document.getElementById('room-list');

        if (this.rooms.size === 0) {
            list.innerHTML = `
                <div class="no-rooms">
                    <div class="no-rooms-icon">📡</div>
                    <p>No active rooms found</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Create a room or Quick Play!</p>
                </div>`;
            return;
        }

        list.innerHTML = '';
        this.rooms.forEach((room, id) => {
            const el = document.createElement('div');
            el.className = 'room-item';
            el.innerHTML = `
                <div class="room-info">
                    <h3>${this.escapeHtml(room.name)}</h3>
                    <div class="room-meta">
                        <span>🎮 ${room.mode?.toUpperCase() || 'FFA'}</span>
                        <span>👤 Host: ${room.host.substr(4, 6)}</span>
                    </div>
                </div>
                <div class="player-count">${room.players || 1}/${room.maxPlayers}</div>`;
            el.addEventListener('click', () => this.joinRoom(id));
            list.appendChild(el);
        });
    }

    // ==================== GAME ENGINE ====================

    initGame() {
        const canvas = document.getElementById('game-canvas');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0xCCE0FF, 0.00015);

        // Camera
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 50000);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(500, 1000, 500);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 100;
        sun.shadow.camera.far = 5000;
        sun.shadow.camera.left = -2000;
        sun.shadow.camera.right = 2000;
        sun.shadow.camera.top = 2000;
        sun.shadow.camera.bottom = -2000;
        this.scene.add(sun);

        const hemi = new THREE.HemisphereLight(0x87CEEB, 0x3d9140, 0.4);
        this.scene.add(hemi);

        this.createWorld();
        this.createPlayerAircraft();
        this.setupMinimap();

        window.addEventListener('resize', () => this.onResize());
    }

    createWorld() {
        // Water
        const waterGeo = new THREE.PlaneGeometry(100000, 100000);
        const waterMat = new THREE.MeshLambertMaterial({
            color: 0x1e90ff,
            transparent: true,
            opacity: 0.9
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = -5;
        this.scene.add(water);

        // Main Island
        const islandGeo = new THREE.CylinderGeometry(3000, 3500, 50, 32);
        const islandMat = new THREE.MeshLambertMaterial({ color: 0x3d9140 });
        const island = new THREE.Mesh(islandGeo, islandMat);
        island.position.y = -25;
        island.receiveShadow = true;
        this.scene.add(island);

        // Beach ring
        const beachGeo = new THREE.RingGeometry(2800, 3200, 32);
        const beachMat = new THREE.MeshLambertMaterial({ color: 0xF4D03F, side: THREE.DoubleSide });
        const beach = new THREE.Mesh(beachGeo, beachMat);
        beach.rotation.x = -Math.PI / 2;
        beach.position.y = 1;
        this.scene.add(beach);

        // Runway
        const runwayGeo = new THREE.BoxGeometry(60, 2, 1500);
        const runwayMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const runway = new THREE.Mesh(runwayGeo, runwayMat);
        runway.position.y = 1;
        runway.receiveShadow = true;
        this.scene.add(runway);

        // Runway markings
        for (let z = -700; z <= 700; z += 100) {
            const markGeo = new THREE.BoxGeometry(3, 0.5, 30);
            const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const mark = new THREE.Mesh(markGeo, markMat);
            mark.position.set(0, 2, z);
            this.scene.add(mark);
        }

        // Threshold markings
        for (let x = -25; x <= 25; x += 5) {
            const tGeo = new THREE.BoxGeometry(2, 0.5, 50);
            const tMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const t = new THREE.Mesh(tGeo, tMat);
            t.position.set(x, 2, -700);
            this.scene.add(t);
        }

        // Control Tower
        const towerGeo = new THREE.CylinderGeometry(8, 10, 100, 8);
        const towerMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.set(150, 50, 200);
        tower.castShadow = true;
        this.scene.add(tower);

        const cabinGeo = new THREE.CylinderGeometry(15, 12, 20, 8);
        const cabinMat = new THREE.MeshLambertMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.8 });
        const cabin = new THREE.Mesh(cabinGeo, cabinMat);
        cabin.position.set(150, 110, 200);
        this.scene.add(cabin);

        // Hangars
        for (let i = 0; i < 3; i++) {
            const hangarGeo = new THREE.BoxGeometry(80, 40, 100);
            const hangarMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
            const hangar = new THREE.Mesh(hangarGeo, hangarMat);
            hangar.position.set(-200, 20, -400 + i * 200);
            hangar.castShadow = true;
            hangar.receiveShadow = true;
            this.scene.add(hangar);
        }

        // City buildings
        for (let i = 0; i < 30; i++) {
            const w = 30 + Math.random() * 50;
            const h = 50 + Math.random() * 150;
            const d = 30 + Math.random() * 50;
            const buildGeo = new THREE.BoxGeometry(w, h, d);
            const buildMat = new THREE.MeshLambertMaterial({
                color: new THREE.Color().setHSL(0.6, 0.1, 0.3 + Math.random() * 0.3)
            });
            const building = new THREE.Mesh(buildGeo, buildMat);

            const angle = (i / 30) * Math.PI * 2;
            const dist = 800 + Math.random() * 1500;
            building.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist);
            building.castShadow = true;
            building.receiveShadow = true;
            this.scene.add(building);
        }

        // Mountains
        for (let i = 0; i < 8; i++) {
            const mGeo = new THREE.ConeGeometry(400 + Math.random() * 400, 600 + Math.random() * 500, 6);
            const mMat = new THREE.MeshLambertMaterial({ color: 0x4a6741 });
            const mountain = new THREE.Mesh(mGeo, mMat);

            const angle = (i / 8) * Math.PI * 2;
            mountain.position.set(Math.cos(angle) * 6000, 0, Math.sin(angle) * 6000);
            mountain.castShadow = true;
            this.scene.add(mountain);

            // Snow cap
            const snowGeo = new THREE.ConeGeometry(100 + Math.random() * 100, 150, 6);
            const snowMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
            const snow = new THREE.Mesh(snowGeo, snowMat);
            snow.position.copy(mountain.position);
            snow.position.y = mountain.geometry.parameters.height - 100;
            this.scene.add(snow);
        }

        // Clouds
        for (let i = 0; i < 40; i++) {
            const cloudGroup = new THREE.Group();

            for (let j = 0; j < 6; j++) {
                const cGeo = new THREE.SphereGeometry(40 + Math.random() * 60, 8, 6);
                const cMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
                const part = new THREE.Mesh(cGeo, cMat);
                part.position.set(Math.random() * 100 - 50, Math.random() * 30 - 15, Math.random() * 100 - 50);
                part.scale.y = 0.6;
                cloudGroup.add(part);
            }

            cloudGroup.position.set(
                Math.random() * 15000 - 7500,
                400 + Math.random() * 800,
                Math.random() * 15000 - 7500
            );
            this.scene.add(cloudGroup);
        }

        // Aircraft Carrier
        const carrierGroup = new THREE.Group();

        const hullGeo = new THREE.BoxGeometry(60, 20, 300);
        const hullMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
        const hull = new THREE.Mesh(hullGeo, hullMat);
        hull.position.y = 5;
        carrierGroup.add(hull);

        const deckGeo = new THREE.BoxGeometry(50, 3, 280);
        const deckMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const deck = new THREE.Mesh(deckGeo, deckMat);
        deck.position.y = 16;
        carrierGroup.add(deck);

        const towerGeo2 = new THREE.BoxGeometry(15, 30, 30);
        const tower2 = new THREE.Mesh(towerGeo2, new THREE.MeshLambertMaterial({ color: 0x555555 }));
        tower2.position.set(20, 30, 50);
        carrierGroup.add(tower2);

        carrierGroup.position.set(2000, 0, 2000);
        carrierGroup.castShadow = true;
        this.scene.add(carrierGroup);
    }

    createPlayerAircraft() {
        const stats = this.aircraftStats[this.player.aircraft];
        this.playerMesh = this.createAircraftMesh(stats.color, stats.accentColor);
        this.playerMesh.position.copy(this.player.position);
        this.scene.add(this.playerMesh);
    }

    createAircraftMesh(mainColor, accentColor) {
        const group = new THREE.Group();

        // Fuselage
        const fuseGeo = new THREE.CylinderGeometry(2, 4, 25, 8);
        fuseGeo.rotateX(Math.PI / 2);
        const fuseMat = new THREE.MeshLambertMaterial({ color: mainColor });
        const fuselage = new THREE.Mesh(fuseGeo, fuseMat);
        fuselage.castShadow = true;
        group.add(fuselage);

        // Nose
        const noseGeo = new THREE.ConeGeometry(2, 8, 8);
        noseGeo.rotateX(-Math.PI / 2);
        const nose = new THREE.Mesh(noseGeo, fuseMat);
        nose.position.z = 16;
        group.add(nose);

        // Cockpit
        const cockpitGeo = new THREE.SphereGeometry(2.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMat = new THREE.MeshLambertMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.7 });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 2, 5);
        group.add(cockpit);

        // Wings
        const wingGeo = new THREE.BoxGeometry(40, 1, 8);
        const wingMat = new THREE.MeshLambertMaterial({ color: mainColor });
        const wings = new THREE.Mesh(wingGeo, wingMat);
        wings.position.z = -2;
        wings.castShadow = true;
        group.add(wings);

        // Wing tips
        const tipGeo = new THREE.BoxGeometry(2, 0.5, 3);
        const tipMat = new THREE.MeshLambertMaterial({ color: accentColor });
        const tipL = new THREE.Mesh(tipGeo, tipMat);
        tipL.position.set(-20, 0, -2);
        group.add(tipL);
        const tipR = tipL.clone();
        tipR.position.x = 20;
        group.add(tipR);

        // Tail
        const tailGeo = new THREE.BoxGeometry(15, 1, 5);
        const tail = new THREE.Mesh(tailGeo, wingMat);
        tail.position.z = -12;
        group.add(tail);

        // Vertical stabilizer
        const vStabGeo = new THREE.BoxGeometry(1, 8, 6);
        const vStab = new THREE.Mesh(vStabGeo, wingMat);
        vStab.position.set(0, 4, -12);
        group.add(vStab);

        // Engine glow (for jets)
        if (mainColor !== 0xffffff) {
            const glowGeo = new THREE.CylinderGeometry(1.5, 2, 3, 8);
            glowGeo.rotateX(Math.PI / 2);
            const glowMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.z = -14;
            group.add(glow);
        }

        return group;
    }

    // ==================== GAME LOOP ====================

    startGame() {
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game-container').classList.add('active');

        this.state = 'playing';
        this.initGame();

        this.player.position.set(0, 150, -500);
        this.player.rotation.set(0, 0, 0);
        this.player.health = 100;

        this.broadcast({
            type: 'player_join',
            player: { id: this.peerId, ...this.getPlayerState() }
        });

        this.lastUpdate = performance.now();
        this.gameLoop();
    }

    gameLoop() {
        if (this.state !== 'playing') return;

        const now = performance.now();
        const delta = Math.min((now - this.lastUpdate) / 1000, 0.1);
        this.lastUpdate = now;

        this.updateFlight(delta);
        this.updateProjectiles(delta);
        this.updateFlares(delta);
        this.updateExplosions(delta);
        this.syncOtherPlayers();
        this.updateCamera(delta);
        this.updateHUD();
        this.updateMinimap();
        this.updateTimer(delta);

        // Broadcast at ~20Hz
        if (now - this.lastBroadcast > 50) {
            this.broadcastState();
            this.lastBroadcast = now;
        }

        // Speed lines effect
        const speedLines = document.getElementById('speed-lines');
        speedLines.classList.toggle('active', this.player.speed > 100);

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.gameLoop());
    }

    updateFlight(delta) {
        const stats = this.aircraftStats[this.player.aircraft];
        const maxSpeed = stats.maxSpeed / 10;

        // Throttle
        if (this.keys['KeyW']) this.player.throttle = Math.min(1, this.player.throttle + delta * 0.5);
        if (this.keys['KeyS']) this.player.throttle = Math.max(0, this.player.throttle - delta * 0.5);

        // Speed
        const targetSpeed = this.player.throttle * maxSpeed;
        this.player.speed += (targetSpeed - this.player.speed) * delta * 2;

        // Rotation
        const rotSpeed = stats.agility / 50;
        const rot = this.player.rotation;

        if (this.keys['ArrowLeft']) {
            rot.z += rotSpeed * delta;
            rot.y += rotSpeed * 0.3 * delta;
        }
        if (this.keys['ArrowRight']) {
            rot.z -= rotSpeed * delta;
            rot.y -= rotSpeed * 0.3 * delta;
        }
        if (this.keys['ArrowUp']) rot.x -= rotSpeed * delta;
        if (this.keys['ArrowDown']) rot.x += rotSpeed * delta;

        // Banking effect
        rot.x -= rot.z * delta * 0.3;

        // Limits and damping
        rot.z = THREE.MathUtils.clamp(rot.z, -Math.PI / 2.5, Math.PI / 2.5);
        rot.x = THREE.MathUtils.clamp(rot.x, -Math.PI / 3, Math.PI / 3);
        rot.z *= 0.97;
        rot.x *= 0.98;

        // Direction
        const dir = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromEuler(rot);
        dir.applyQuaternion(quat);

        // Position
        const speed = this.player.speed * delta * 15;
        this.player.position.add(dir.multiplyScalar(speed));

        // Gravity when slow
        if (this.player.speed < 5) {
            this.player.position.y -= (5 - this.player.speed) * delta * 3;
        }

        // Ground collision
        if (this.player.position.y < 15) {
            if (this.player.speed > 15 || Math.abs(rot.z) > 0.4) {
                this.handleCrash();
            }
            this.player.position.y = 15;
        }

        // Altitude limit
        const maxAlt = stats.maxAlt / 10;
        if (this.player.position.y > maxAlt) this.player.position.y = maxAlt;

        // Update mesh
        if (this.playerMesh) {
            this.playerMesh.position.copy(this.player.position);
            this.playerMesh.quaternion.copy(quat);
        }
    }

    updateCamera(delta) {
        if (!this.playerMesh) return;

        let offset;
        if (this.cameraMode === 'third') {
            offset = new THREE.Vector3(0, 20, -60);
        } else if (this.cameraMode === 'cockpit') {
            offset = new THREE.Vector3(0, 3, 10);
        } else {
            offset = new THREE.Vector3(0, 40, -100);
        }

        offset.applyQuaternion(this.playerMesh.quaternion);
        const target = this.playerMesh.position.clone().add(offset);

        this.camera.position.lerp(target, delta * 5);
        this.camera.lookAt(this.playerMesh.position);
    }

    updateHUD() {
        document.getElementById('health-fill').style.width = `${this.player.health}%`;
        document.getElementById('health-text').textContent = `${Math.round(this.player.health)}%`;
        document.getElementById('speed-value').textContent = Math.round(this.player.speed * 10);
        document.getElementById('altitude-value').textContent = Math.round(this.player.position.y * 10);
        document.getElementById('kills-value').textContent = this.player.kills;
        document.getElementById('deaths-value').textContent = this.player.deaths;

        this.updateLeaderboard();
    }

    updateLeaderboard() {
        const players = [{ id: this.peerId, name: this.player.name, kills: this.player.kills, deaths: this.player.deaths }];
        this.otherPlayers.forEach((p, id) => {
            players.push({ id, name: p.name || '???', kills: p.kills || 0, deaths: p.deaths || 0 });
        });
        players.sort((a, b) => b.kills - a.kills);

        document.getElementById('leaderboard-list').innerHTML = players.slice(0, 5).map((p, i) => `
            <div class="leaderboard-item ${p.id === this.peerId ? 'self' : ''}">
                <span><span class="leaderboard-rank">#${i + 1}</span> ${this.escapeHtml(p.name)}</span>
                <span>${p.kills}/${p.deaths}</span>
            </div>
        `).join('');
    }

    updateTimer(delta) {
        this.gameTime -= delta;
        if (this.gameTime <= 0) return this.endGame();

        const m = Math.floor(this.gameTime / 60);
        const s = Math.floor(this.gameTime % 60);
        document.getElementById('game-timer').textContent =
            `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    setupMinimap() {
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        this.minimapCanvas.width = 150;
        this.minimapCanvas.height = 150;
    }

    updateMinimap() {
        const ctx = this.minimapCtx;
        const size = 150;
        const scale = 0.015;

        ctx.fillStyle = 'rgba(0, 20, 40, 0.9)';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Island
        ctx.fillStyle = 'rgba(61, 145, 64, 0.5)';
        ctx.beginPath();
        ctx.arc(size / 2 - this.player.position.x * scale, size / 2 - this.player.position.z * scale, 45, 0, Math.PI * 2);
        ctx.fill();

        // Runway
        ctx.fillStyle = '#444';
        const rx = size / 2 - this.player.position.x * scale;
        const rz = size / 2 - this.player.position.z * scale;
        ctx.fillRect(rx - 1, rz - 20, 2, 40);

        // Other players
        ctx.fillStyle = '#ff4757';
        this.otherPlayers.forEach(p => {
            if (!p.position) return;
            const pos = Array.isArray(p.position) ? p.position : [p.position.x, p.position.y, p.position.z];
            const px = size / 2 + (pos[0] - this.player.position.x) * scale;
            const pz = size / 2 + (pos[2] - this.player.position.z) * scale;
            const dist = Math.sqrt((px - size / 2) ** 2 + (pz - size / 2) ** 2);
            if (dist < size / 2 - 5) {
                ctx.beginPath();
                ctx.arc(px, pz, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Player
        ctx.fillStyle = '#00ffaa';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 5, 0, Math.PI * 2);
        ctx.fill();

        // Direction
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(size / 2, size / 2);
        ctx.lineTo(
            size / 2 + Math.sin(this.player.rotation.y) * 12,
            size / 2 - Math.cos(this.player.rotation.y) * 12
        );
        ctx.stroke();
    }

    broadcastState() {
        this.broadcast({
            type: 'player_update',
            position: this.player.position.toArray(),
            rotation: [this.player.rotation.x, this.player.rotation.y, this.player.rotation.z],
            speed: this.player.speed,
            health: this.player.health,
            kills: this.player.kills,
            deaths: this.player.deaths
        });
    }

    // ==================== OTHER PLAYERS ====================

    addPlayer(data) {
        this.otherPlayers.set(data.id, data);
    }

    removePlayer(id) {
        this.otherPlayers.delete(id);
        const mesh = this.otherPlayerMeshes.get(id);
        if (mesh) {
            this.scene.remove(mesh);
            this.otherPlayerMeshes.delete(id);
        }
    }

    updateOtherPlayer(id, data) {
        let p = this.otherPlayers.get(id);
        if (!p) {
            p = { id };
            this.otherPlayers.set(id, p);
        }
        Object.assign(p, data);
    }

    syncOtherPlayers() {
        this.otherPlayers.forEach((data, id) => {
            let mesh = this.otherPlayerMeshes.get(id);

            if (!mesh) {
                const stats = this.aircraftStats[data.aircraft] || this.aircraftStats.cessna;
                mesh = this.createAircraftMesh(stats.color, stats.accentColor);
                this.scene.add(mesh);
                this.otherPlayerMeshes.set(id, mesh);
            }

            if (data.position) {
                const pos = Array.isArray(data.position) ? data.position : [data.position.x, data.position.y, data.position.z];
                mesh.position.lerp(new THREE.Vector3(...pos), 0.15);
            }

            if (data.rotation) {
                const rot = Array.isArray(data.rotation) ? data.rotation : [data.rotation.x, data.rotation.y, data.rotation.z];
                const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ'));
                mesh.quaternion.slerp(targetQuat, 0.15);
            }
        });
    }

    // ==================== COMBAT ====================

    // Fire missile - fast and deadly
    fire() {
        if (this.player.aircraft === 'cessna') return;

        const now = performance.now();
        if (now - this.lastFireTime < 500) return; // 0.5s cooldown
        this.lastFireTime = now;

        const stats = this.aircraftStats[this.player.aircraft];
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.playerMesh.quaternion);
        const pos = this.player.position.clone().add(dir.clone().multiplyScalar(25));

        this.createProjectile(pos.toArray(), dir.toArray(), this.peerId, stats.accentColor);
        this.playSound('fire');

        this.broadcast({
            type: 'fire',
            position: pos.toArray(),
            direction: dir.toArray(),
            color: stats.accentColor
        });
    }

    // Deploy flare - slow falling decoy
    deployFlare() {
        const now = performance.now();
        if (now - this.lastFlareTime < 1000) return; // 1s cooldown
        this.lastFlareTime = now;

        const dir = new THREE.Vector3(0, -0.5, -1).applyQuaternion(this.playerMesh.quaternion).normalize();
        const pos = this.player.position.clone().add(dir.clone().multiplyScalar(10));

        this.createFlare(pos.toArray(), dir.toArray(), this.peerId);
        this.playSound('flare');

        this.broadcast({
            type: 'flare',
            position: pos.toArray(),
            direction: dir.toArray()
        });
    }

    createProjectile(pos, dir, owner, color) {
        // Create missile mesh - elongated shape
        const group = new THREE.Group();

        // Missile body
        const bodyGeo = new THREE.CylinderGeometry(0.8, 1.2, 8, 8);
        bodyGeo.rotateX(Math.PI / 2);
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);

        // Missile tip
        const tipGeo = new THREE.ConeGeometry(0.8, 3, 8);
        tipGeo.rotateX(-Math.PI / 2);
        const tipMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const tip = new THREE.Mesh(tipGeo, tipMat);
        tip.position.z = 5.5;
        group.add(tip);

        // Engine flame
        const flameGeo = new THREE.ConeGeometry(1, 6, 8);
        flameGeo.rotateX(Math.PI / 2);
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.z = -7;
        group.add(flame);

        // Smoke trail particles (will be updated)
        const trailGeo = new THREE.CylinderGeometry(0.3, 1.5, 15, 8);
        trailGeo.rotateX(Math.PI / 2);
        const trailMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.4 });
        const trail = new THREE.Mesh(trailGeo, trailMat);
        trail.position.z = -15;
        group.add(trail);

        group.position.set(...pos);

        // Orient missile in direction of travel
        const lookDir = new THREE.Vector3(...dir);
        const targetQuat = new THREE.Quaternion();
        const matrix = new THREE.Matrix4();
        matrix.lookAt(new THREE.Vector3(), lookDir, new THREE.Vector3(0, 1, 0));
        targetQuat.setFromRotationMatrix(matrix);
        group.quaternion.copy(targetQuat);

        this.scene.add(group);
        this.projectiles.push({
            mesh: group,
            direction: new THREE.Vector3(...dir),
            owner,
            time: 0,
            speed: 2500  // VERY FAST - much faster than any aircraft
        });
    }

    createFlare(pos, dir, owner) {
        const group = new THREE.Group();

        // Flare core - bright
        const coreGeo = new THREE.SphereGeometry(2, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);

        // Flare glow
        const glowGeo = new THREE.SphereGeometry(4, 8, 8);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.5 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        group.add(glow);

        // Sparks
        for (let i = 0; i < 5; i++) {
            const sparkGeo = new THREE.SphereGeometry(0.5, 4, 4);
            const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
            const spark = new THREE.Mesh(sparkGeo, sparkMat);
            spark.userData.offset = new THREE.Vector3(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).multiplyScalar(3);
            group.add(spark);
        }

        group.position.set(...pos);

        this.scene.add(group);
        this.flares.push({
            mesh: group,
            direction: new THREE.Vector3(...dir),
            owner,
            time: 0,
            speed: 80  // Slow - drifts down
        });
    }

    updateProjectiles(delta) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.time += delta;

            // Missiles last 4 seconds
            if (p.time > 4) {
                this.scene.remove(p.mesh);
                this.projectiles.splice(i, 1);
                continue;
            }

            // Move at high speed
            const moveSpeed = p.speed * delta;
            p.mesh.position.add(p.direction.clone().multiplyScalar(moveSpeed));

            // Animate flame flicker
            const flame = p.mesh.children[2];
            if (flame) {
                flame.scale.setScalar(0.8 + Math.random() * 0.4);
            }

            // Collision with other players
            if (p.owner === this.peerId) {
                this.otherPlayers.forEach((data, id) => {
                    if (!data.position) return;
                    const targetPos = Array.isArray(data.position) ? data.position : [data.position.x, data.position.y, data.position.z];
                    const dist = p.mesh.position.distanceTo(new THREE.Vector3(...targetPos));

                    if (dist < 30) {
                        this.broadcast({ type: 'hit', target: id, shooter: this.peerId, damage: 35 });
                        this.createExplosion(p.mesh.position.clone());
                        this.scene.remove(p.mesh);
                        this.projectiles.splice(i, 1);
                    }
                });
            }

            // Self collision (from others)
            if (p.owner !== this.peerId) {
                const dist = p.mesh.position.distanceTo(this.player.position);
                if (dist < 25) {
                    this.player.health -= 35;
                    this.playSound('hit');
                    this.createExplosion(p.mesh.position.clone());
                    this.scene.remove(p.mesh);
                    this.projectiles.splice(i, 1);

                    if (this.player.health <= 0) this.handleDeath(p.owner);
                }
            }
        }
    }

    updateFlares(delta) {
        for (let i = this.flares.length - 1; i >= 0; i--) {
            const f = this.flares[i];
            f.time += delta;

            // Flares last 5 seconds
            if (f.time > 5) {
                this.scene.remove(f.mesh);
                this.flares.splice(i, 1);
                continue;
            }

            // Slow drift with gravity
            f.direction.y -= delta * 0.5; // gravity effect
            const moveSpeed = f.speed * delta;
            f.mesh.position.add(f.direction.clone().multiplyScalar(moveSpeed));

            // Fade out over time
            const fadeStart = 3;
            if (f.time > fadeStart) {
                const alpha = 1 - (f.time - fadeStart) / 2;
                f.mesh.children.forEach(c => {
                    if (c.material) c.material.opacity = alpha * (c.material.opacity > 0.5 ? 1 : 0.5);
                });
            }

            // Animate sparks
            f.mesh.children.forEach((c, idx) => {
                if (idx > 1 && c.userData.offset) {
                    c.position.copy(c.userData.offset.clone().multiplyScalar(1 + Math.sin(f.time * 10 + idx) * 0.3));
                }
            });

            // Flicker effect
            const core = f.mesh.children[0];
            if (core) {
                core.scale.setScalar(0.9 + Math.random() * 0.2);
            }
        }
    }

    createExplosion(pos) {
        this.playSound('explosion');

        const group = new THREE.Group();

        for (let i = 0; i < 15; i++) {
            const geo = new THREE.SphereGeometry(2 + Math.random() * 4, 8, 8);
            const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.5),
                transparent: true
            });
            const sphere = new THREE.Mesh(geo, mat);
            sphere.userData.velocity = new THREE.Vector3(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).multiplyScalar(50);
            group.add(sphere);
        }

        group.position.copy(pos);
        this.scene.add(group);
        this.explosions.push({ group, time: 0 });
    }

    updateExplosions(delta) {
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const e = this.explosions[i];
            e.time += delta;

            if (e.time > 1) {
                this.scene.remove(e.group);
                this.explosions.splice(i, 1);
                continue;
            }

            e.group.children.forEach(c => {
                c.position.add(c.userData.velocity.clone().multiplyScalar(delta));
                c.material.opacity = 1 - e.time;
                c.scale.multiplyScalar(1 + delta * 2);
            });
        }
    }

    handleDeath(killerId) {
        this.player.deaths++;
        this.player.health = 100;

        const killerData = this.otherPlayers.get(killerId);
        const killerName = killerData?.name || 'Unknown';

        this.broadcast({
            type: 'death',
            killer: killerId,
            killerName,
            victim: this.peerId,
            victimName: this.player.name
        });

        this.addKillFeed(killerName, this.player.name);

        // Respawn
        this.player.position.set(
            Math.random() * 1000 - 500,
            200 + Math.random() * 100,
            Math.random() * 1000 - 500
        );
    }

    handleCrash() {
        this.createExplosion(this.player.position.clone());
        this.player.health = 0;
        this.handleDeath(null);
        this.addChat('System', 'You crashed!', true);
    }

    addKillFeed(killer, victim) {
        const feed = document.getElementById('kill-feed');
        const item = document.createElement('div');
        item.className = 'kill-item';
        item.innerHTML = `<span class="killer">${this.escapeHtml(killer || 'Environment')}</span> killed <span class="victim">${this.escapeHtml(victim)}</span>`;
        feed.appendChild(item);

        setTimeout(() => item.remove(), 3000);
    }

    // ==================== CHAT ====================

    sendChat(msg) {
        if (!msg.trim()) return;
        this.addChat(this.player.name, msg);
        this.broadcast({ type: 'chat', name: this.player.name, msg });
    }

    addChat(name, msg, system = false) {
        const container = document.getElementById('chat-messages');
        const el = document.createElement('div');
        el.className = 'chat-message' + (system ? ' system' : '');
        el.innerHTML = system ? msg : `<span class="sender">${this.escapeHtml(name)}:</span> ${this.escapeHtml(msg)}`;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;

        while (container.children.length > 50) container.removeChild(container.firstChild);
    }

    // ==================== UI ====================

    updateConnectionStatus(status, text) {
        const el = document.getElementById('connection-status');
        el.className = `connection-status ${status}`;
        el.textContent = text;
    }

    hideLoading() {
        setTimeout(() => document.getElementById('loading').classList.add('hidden'), 500);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    endGame() {
        this.state = 'lobby';
        alert(`Game Over!\n\nKills: ${this.player.kills}\nDeaths: ${this.player.deaths}`);

        document.getElementById('game-container').classList.remove('active');
        document.getElementById('lobby').classList.remove('hidden');

        this.cleanup();
    }

    exitGame() {
        this.state = 'lobby';
        this.broadcast({ type: 'player_leave', id: this.peerId });

        document.getElementById('game-container').classList.remove('active');
        document.getElementById('lobby').classList.remove('hidden');

        this.cleanup();
    }

    cleanup() {
        if (this.scene) {
            while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0]);
        }
        this.connections.forEach(c => c.close());
        this.connections.clear();
        this.otherPlayers.clear();
        this.otherPlayerMeshes.clear();
        this.projectiles = [];
        this.flares = [];
        this.explosions = [];
        this.currentRoom = null;
        this.isHost = false;
        this.gameTime = 15 * 60;
    }

    // ==================== EVENTS ====================

    setupEventListeners() {
        // Keyboard
        document.addEventListener('keydown', e => {
            this.keys[e.code] = true;

            if (this.state === 'playing') {
                if (e.code === 'Space') {
                    e.preventDefault();
                    this.fire();
                }
                if (e.code === 'KeyF') {
                    e.preventDefault();
                    this.deployFlare();
                }
                if (e.code === 'KeyV') {
                    const modes = ['third', 'cockpit', 'chase'];
                    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
                }
                if (e.code === 'Enter') {
                    const input = document.getElementById('chat-input');
                    if (document.activeElement === input) {
                        this.sendChat(input.value);
                        input.value = '';
                        input.blur();
                    } else {
                        input.focus();
                    }
                    e.preventDefault();
                }
            }
        });

        document.addEventListener('keyup', e => this.keys[e.code] = false);

        // Player name
        const nameInput = document.getElementById('player-name');
        nameInput.value = localStorage.getItem('flyName') || '';
        nameInput.addEventListener('input', e => {
            this.player.name = e.target.value || 'Pilot';
            localStorage.setItem('flyName', e.target.value);
        });
        this.player.name = nameInput.value || 'Pilot';

        // Aircraft selection
        document.querySelectorAll('.aircraft-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.aircraft-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.player.aircraft = card.dataset.aircraft;
                this.updateStats();
            });
        });

        // Quick Play
        document.getElementById('quick-play-btn').addEventListener('click', () => this.quickPlay());

        // Create Room
        document.getElementById('create-room-btn').addEventListener('click', () => {
            document.getElementById('create-modal').classList.add('active');
        });

        document.getElementById('cancel-create').addEventListener('click', () => {
            document.getElementById('create-modal').classList.remove('active');
        });

        document.getElementById('confirm-create').addEventListener('click', () => {
            const name = document.getElementById('room-name').value;
            const max = parseInt(document.getElementById('max-players').value);
            const mode = document.getElementById('game-mode').value;

            if (!this.player.name.trim()) {
                this.player.name = 'Pilot_' + Math.random().toString(36).substr(2, 4);
                document.getElementById('player-name').value = this.player.name;
            }

            document.getElementById('create-modal').classList.remove('active');
            this.createRoom(name, max, mode);
        });

        // Refresh
        document.getElementById('refresh-btn').addEventListener('click', () => this.discoverRooms());

        // Exit
        document.getElementById('exit-game').addEventListener('click', () => this.exitGame());

        // Chat
        document.getElementById('chat-send').addEventListener('click', () => {
            const input = document.getElementById('chat-input');
            this.sendChat(input.value);
            input.value = '';
        });

        // Mobile
        this.setupMobile();

        // Resume audio on interaction
        document.addEventListener('click', () => {
            if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
        }, { once: true });
    }

    updateStats() {
        const stats = this.aircraftStats[this.player.aircraft];
        document.getElementById('stat-speed').textContent = `${stats.maxSpeed} kts`;
        document.getElementById('stat-alt').textContent = `${stats.maxAlt.toLocaleString()} ft`;
        document.getElementById('stat-agility').textContent = stats.agility > 70 ? 'High' : stats.agility > 40 ? 'Medium' : 'Low';
        document.getElementById('stat-weapons').textContent = stats.weapons > 0 ? (stats.weapons > 80 ? 'High' : 'Medium') : 'None';

        document.getElementById('speed-bar').style.width = `${stats.maxSpeed / 15}%`;
        document.getElementById('alt-bar').style.width = `${stats.maxAlt / 500}%`;
        document.getElementById('agility-bar').style.width = `${stats.agility}%`;
        document.getElementById('weapons-bar').style.width = `${stats.weapons}%`;
    }

    setupMobile() {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) document.getElementById('mobile-controls').style.display = 'flex';

        // Joysticks
        const setupJoystick = (stickId, knobId, onMove, onEnd) => {
            const stick = document.getElementById(stickId);
            const knob = document.getElementById(knobId);
            let active = false;

            const handle = (e) => {
                const rect = stick.getBoundingClientRect();
                const touch = e.touches[0];
                const x = (touch.clientX - rect.left - rect.width / 2) / (rect.width / 2);
                const y = (touch.clientY - rect.top - rect.height / 2) / (rect.height / 2);
                const dist = Math.min(1, Math.sqrt(x * x + y * y));
                const angle = Math.atan2(y, x);

                knob.style.transform = `translate(calc(-50% + ${Math.cos(angle) * dist * 35}px), calc(-50% + ${Math.sin(angle) * dist * 35}px))`;
                onMove(x * dist, y * dist);
            };

            stick.addEventListener('touchstart', e => { e.preventDefault(); active = true; handle(e); });
            stick.addEventListener('touchmove', e => { e.preventDefault(); if (active) handle(e); });
            stick.addEventListener('touchend', () => {
                active = false;
                knob.style.transform = 'translate(-50%, -50%)';
                onEnd();
            });
        };

        setupJoystick('joystick-left', 'knob-left',
            (x, y) => {
                this.keys['ArrowLeft'] = x < -0.3;
                this.keys['ArrowRight'] = x > 0.3;
                this.keys['ArrowUp'] = y < -0.3;
                this.keys['ArrowDown'] = y > 0.3;
            },
            () => {
                this.keys['ArrowLeft'] = this.keys['ArrowRight'] = false;
                this.keys['ArrowUp'] = this.keys['ArrowDown'] = false;
            }
        );

        setupJoystick('joystick-right', 'knob-right',
            (x, y) => {
                this.keys['KeyW'] = y < -0.3;
                this.keys['KeyS'] = y > 0.3;
            },
            () => {
                this.keys['KeyW'] = this.keys['KeyS'] = false;
            }
        );

        document.getElementById('btn-fire')?.addEventListener('touchstart', e => { e.preventDefault(); this.fire(); });
        document.getElementById('btn-flare')?.addEventListener('touchstart', e => { e.preventDefault(); this.deployFlare(); });
        document.getElementById('btn-boost')?.addEventListener('touchstart', e => { e.preventDefault(); this.player.throttle = 1; });
    }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
    window.game = new FlyGame();
});
