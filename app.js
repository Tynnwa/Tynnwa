import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js'
import { GazeController } from './libs/GazeController.js'
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

// NEW IMPORTS FOR AUDIO
import { AudioLoader } from './libs/three/jsm/AudioLoader.js'; // Common path for AudioLoader
import { AudioListener } from './libs/three/src/AudioListener.js'; // Three.js modular build often puts these in 'src'
import { Audio } from './libs/three/src/Audio.js'; // Adjust path if your build uses 'jsm' for these

class App{
	constructor(){
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		this.assetsPath = './assets/';
		
		this.camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.01, 500 );
		this.camera.position.set( 0, 1.6, 0 );
        
        // NEW: Audio Listener - acts as the "ear" in the scene, attached to the camera
        this.audioListener = new AudioListener();
        this.camera.add( this.audioListener ); // Attach the listener to your camera
		
        this.dolly = new THREE.Object3D(  );
        this.dolly.position.set(0, 0, 10);
        this.dolly.add( this.camera );
        this.dummyCam = new THREE.Object3D();
        this.camera.add( this.dummyCam );
        
		this.scene = new THREE.Scene();
        this.scene.add( this.dolly );
        
        // MODIFIED: Make ambient light a property for season changes
		this.ambientLight = new THREE.HemisphereLight(0xFFFFFF, 0xAAAAAA, 0.8);
		this.scene.add(this.ambientLight);

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio( window.devicePixelRatio );
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild( this.renderer.domElement );
        
        // REMOVED: Initial setEnvironment call, now handled by applySeason
		// this.setEnvironment(); 
	
        window.addEventListener( 'resize', this.resize.bind(this) );
        
        this.clock = new THREE.Clock();
        this.up = new THREE.Vector3(0,1,0);
        this.origin = new THREE.Vector3();
        this.workingVec3 = new THREE.Vector3();
        this.workingQuaternion = new THREE.Quaternion();
        this.raycaster = new THREE.Raycaster();
        
        this.stats = new Stats();
		container.appendChild( this.stats.dom );
        
		this.loadingBar = new LoadingBar();
		
        // NEW: Properties for season change
        this.currentSeason = 'summer'; // Default season
        this.skyBoxMesh = null; // Will store the actual skybox mesh
        this.groundMesh = null; // Will store the actual ground mesh
        this.treeMeshes = []; // Will store references to all tree meshes

        // Loaders for textures and HDRs
        this.textureLoader = new THREE.TextureLoader();
        this.rgbeLoader = new RGBELoader().setDataType( THREE.UnsignedByteType );
        this.pmremGenerator = new THREE.PMREMGenerator( this.renderer );
        this.pmremGenerator.compileEquirectangularShader();

        // NEW: Define season-specific assets and light settings
        this.seasonConfig = {
            'summer': {
                envMap: './assets/hdr/venice_sunset_1k.hdr', // Ensure this path is correct
                skyBoxTexture: './assets/textures/sky_summer.jpg', // Path to your summer sky texture
                groundTexture: './assets/textures/ground_grass.jpg', // Path to your summer ground texture
                treeTexture: './assets/textures/tree_leaves_summer.jpg', // Path to your summer tree texture
                lightColor: 0xFFFFFF, // White light
                lightIntensity: 0.8 // Brightness
            },
            'autumn': {
                envMap: './assets/hdr/autumn_forest_1k.hdr', // Path to your autumn HDR
                skyBoxTexture: './assets/textures/sky_autumn.jpg',
                groundTexture: './assets/textures/ground_leaves.jpg',
                treeTexture: './assets/textures/tree_leaves_autumn.jpg',
                lightColor: 0xFFDDBB, // Warmer, golden light
                lightIntensity: 0.7
            },
            'winter': {
                envMap: './assets/hdr/snowy_forest_1k.hdr', // Path to your winter HDR
                skyBoxTexture: './assets/textures/sky_winter.jpg',
                groundTexture: './assets/textures/ground_snow.jpg',
                treeTexture: './assets/textures/tree_bare_winter.jpg', // Or a texture for snowy trees
                lightColor: 0xDDDDFF, // Cooler, slightly blue light
                lightIntensity: 0.6
            }
        };

        // NEW: Background Music Setup
        this.backgroundMusic = new Audio( this.audioListener ); // Create a new Audio source
        const audioLoader = new AudioLoader();

        const self = this; // Use self to reference 'this' inside the callback

        audioLoader.load( './assets/audio/background_music.mp3', function( buffer ) {
            self.backgroundMusic.setBuffer( buffer );
            self.backgroundMusic.setLoop( true ); // Loop the music
            self.backgroundMusic.setVolume( 0.5 ); // Adjust volume (0.0 to 1.0)
            // self.backgroundMusic.play(); // Initial play might be blocked by browser. Will rely on user interaction.
            console.log("Background music loaded. Will attempt to play on interaction or VR entry.");
        },
        // Optional: onProgress callback
        function ( xhr ) {
            console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded (audio)' );
        },
        // Optional: onError callback
        function ( err ) {
            console.error( 'An error occurred loading the background music:', err );
        });
		
		this.loadCollege(); // loadCollege will now call applySeason after model is ready
        
        this.immersive = false;
        
        // This self = this; is redundant, already declared above
        // const self = this; 
        
        fetch('./college.json')
            .then(response => response.json())
            .then(obj =>{
                self.boardShown = '';
                self.boardData = obj;
            });
	}
	
    // MODIFIED: setEnvironment now accepts hdrPath
    setEnvironment(hdrPath){
        const self = this;
        // Use the pre-initialized loader and generator
        this.rgbeLoader.load( hdrPath, ( texture ) => {
            const envMap = self.pmremGenerator.fromEquirectangular( texture ).texture;
            // self.pmremGenerator.dispose(); // Can dispose if you're sure it's not reused for another env map soon.
                                            // Or dispose when environment is changed in applySeason.

            self.scene.environment = envMap;
            // self.scene.background = envMap; // Uncomment if you want the HDR to be the background directly

        }, undefined, (err)=>{
            console.error( `An error occurred setting the environment: ${hdrPath}`, err);
        } );
    }
    
    resize(){
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize( window.innerWidth, window.innerHeight );  
    }
    
	loadCollege(){
        
		const loader = new GLTFLoader( ).setPath(this.assetsPath);
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath( './libs/three/js/draco/' );
        loader.setDRACOLoader( dracoLoader );
        
        const self = this;
		
		// Load a glTF resource
		loader.load(
			// resource URL
			'college.glb',
			// called when the resource is loaded
			function ( gltf ) {

                self.collegeModel = gltf.scene.children[0]; // Store the main model
                const college = self.collegeModel; // Use a local const for clarity
				self.scene.add( college );
				
				college.traverse(function (child) {
    				if (child.isMesh){
						if (child.name.indexOf("PROXY")!=-1){
							child.material.visible = false;
							self.proxy = child;
						}else if (child.material.name.indexOf('Glass')!=-1){
                            child.material.opacity = 0.1;
                            child.material.transparent = true;
                        }else if (child.material.name.indexOf("SkyBox")!=-1){
                            // Found the SkyBox mesh
                            const mat1 = child.material;
                            const mat2 = new THREE.MeshBasicMaterial({map: mat1.map});
                            child.material = mat2;
                            mat1.dispose();
                            self.skyBoxMesh = child; // Store this for later
                        }
                        // NEW: Identify Ground and Tree meshes. REPLACE 'YourGroundMeshName' and 'YourTreeMeshName'
                        // with the actual names you found from Step 2 of the season tutorial.
                        // Example: child.name === 'Ground_Mesh' or child.name.includes('Terrain')
                        else if (child.name === 'YourGroundMeshName') { 
                            self.groundMesh = child;
                            console.log("Found ground mesh:", child.name);
                        } else if (child.name.includes('YourTreeMeshName') || child.name.includes('Tree') || child.name.includes('Foliage')) { 
                            self.treeMeshes.push(child);
                            console.log("Found tree mesh:", child.name);
                        }
					}
				});
                        
                const door1 = college.getObjectByName("LobbyShop_Door__1_");
                const door2 = college.getObjectByName("LobbyShop_Door__2_");
                const pos = door1.position.clone().sub(door2.position).multiplyScalar(0.5).add(door2.position);
                const obj = new THREE.Object3D();
                obj.name = "LobbyShop";
                obj.position.copy(pos);
                college.add( obj );
                
                self.loadingBar.visible = false;
			
                self.setupXR();

                // NEW: Apply the initial season after loading the model and setting up XR
                self.applySeason(self.currentSeason);
			},
			// called while loading is progressing
			function ( xhr ) {

				self.loadingBar.progress = (xhr.loaded / xhr.total);
				
			},
			// called when loading has errors
			function ( error ) {

				console.log( 'An error happened loading college.glb:', error );

			}
		);
	}
    
    // NEW METHODS FOR SEASON CHANGES
    /**
     * Applies the visual changes for a given season.
     * @param {string} seasonName - The name of the season (e.g., 'summer', 'autumn', 'winter').
     */
    applySeason(seasonName) {
        const season = this.seasonConfig[seasonName];
        if (!season) {
            console.warn(`Season data for "${seasonName}" not found in seasonConfig.`);
            return;
        }

        console.log(`Applying season: ${seasonName}`);

        // 1. Change Environment Map (HDR)
        this.setEnvironment(season.envMap);

        // 2. Change Skybox texture
        if (this.skyBoxMesh) {
            this.textureLoader.load(season.skyBoxTexture, (texture) => {
                this.skyBoxMesh.material.map = texture;
                this.skyBoxMesh.material.needsUpdate = true; // Essential to update material
            }, undefined, (err) => {
                console.error(`Error loading skybox texture for ${seasonName}:`, err);
            });
        }

        // 3. Change Ground texture
        if (this.groundMesh) {
            this.textureLoader.load(season.groundTexture, (texture) => {
                // Assuming your ground mesh has a material with a 'map' property
                if (this.groundMesh.material.map) {
                    this.groundMesh.material.map = texture;
                } else {
                    // If it doesn't have a map, create a new material with the texture
                    this.groundMesh.material = new THREE.MeshStandardMaterial({ map: texture });
                }
                this.groundMesh.material.needsUpdate = true;
                // You might need to set tiling/repeat for ground textures
                // texture.wrapS = THREE.RepeatWrapping;
                // texture.wrapT = THREE.RepeatWrapping;
                // texture.repeat.set(10, 10); // Adjust repeat values as needed
            }, undefined, (err) => {
                console.error(`Error loading ground texture for ${seasonName}:`, err);
            });
        }

        // 4. Change Tree textures
        this.treeMeshes.forEach(tree => {
            if (season.treeTexture) {
                this.textureLoader.load(season.treeTexture, (texture) => {
                    // This assumes all trees use a material with a 'map' property
                    // If a tree has multiple materials, you might need to iterate through tree.material if it's an array
                    if (Array.isArray(tree.material)) {
                        tree.material.forEach(mat => {
                            if (mat.map) {
                                mat.map = texture;
                                mat.needsUpdate = true;
                            }
                        });
                    } else if (tree.material.map) {
                        tree.material.map = texture;
                        tree.material.needsUpdate = true;
                    } else {
                        // If no map, create a new material with the texture
                        tree.material = new THREE.MeshStandardMaterial({ map: texture });
                        tree.material.needsUpdate = true;
                    }
                }, undefined, (err) => {
                    console.error(`Error loading tree texture for ${seasonName} on tree: ${tree.name}`, err);
                });
            }
        });

        // 5. Adjust Ambient Light properties
        this.ambientLight.color.setHex(season.lightColor);
        this.ambientLight.intensity = season.lightIntensity;

        this.currentSeason = seasonName; // Update current season tracker
    }

    /**
     * Sets the current season, triggering applySeason if it's a new season.
     * @param {string} newSeasonName - The name of the season to set.
     */
    setSeason(newSeasonName) {
        if (this.currentSeason !== newSeasonName) {
            this.applySeason(newSeasonName);
        }
    }
        
    setupXR(){
        this.renderer.xr.enabled = true;

        const btn = new VRButton( this.renderer );
        
        const self = this;
        
        const timeoutId = setTimeout( connectionTimeout, 2000 );
        
        function onSelectStart( event ) {
        
            this.userData.selectPressed = true;
        
        }

        function onSelectEnd( event ) {
        
            this.userData.selectPressed = false;
        
        }
        
        function onConnected( event ){
            clearTimeout( timeoutId );
        }
        
        function connectionTimeout(){
            self.useGaze = true;
            self.gazeController = new GazeController( self.scene, self.dummyCam );
        }
        
        this.controllers = this.buildControllers( this.dolly );
        
        this.controllers.forEach( ( controller ) =>{
            controller.addEventListener( 'selectstart', onSelectStart );
            controller.addEventListener( 'selectend', onSelectEnd );
            controller.addEventListener( 'connected', onConnected );
        });
        
        // NEW: CanvasUI configuration for season buttons and music button
        const uiButtonBaseConfig = { // Renamed for clarity, was seasonBtnConfig
            type: "text",
            padding: 5,
            margin: { left: 0, top: 0 },
            width: 128,
            height: 32,
            backgroundColor: "#222",
            fontColor: "#fff",
            hover: "#444",
            border: "1px solid #111"
        };

        const config = {
            panelSize: { height: 0.5 },
            height: 256,
            name: { fontSize: 50, height: 70 },
            info: { position:{ top: 70, backgroundColor: "#ccc", fontColor:"#000" } },
            // NEW: Season button positions within the CanvasUI panel
            seasonSummer: Object.assign({}, uiButtonBaseConfig, { position: { top: 180, left: 10 }, name: "seasonSummer" }),
            seasonAutumn: Object.assign({}, uiButtonBaseConfig, { position: { top: 180, left: 140 }, name: "seasonAutumn" }),
            seasonWinter: Object.assign({}, uiButtonBaseConfig, { position: { top: 180, left: 270 }, name: "seasonWinter" }),
            // NEW: Music Toggle Button
            musicToggle: Object.assign({}, uiButtonBaseConfig, { position: { top: 10, left: 10 }, width: 120, height: 32, name: "musicToggle" })
        };

        const content = {
            name: "name",
            info: "info",
            // NEW: Season button text content
            seasonSummer: "Summer",
            seasonAutumn: "Autumn",
            seasonWinter: "Winter",
            // NEW: Music Toggle Button text
            musicToggle: "Mute Music" // Initial state, will update on click
        };
        
        this.ui = new CanvasUI( content, config );
        this.scene.add( this.ui.mesh );

        // NEW: Add event listeners for the season and music buttons on the CanvasUI
        this.ui.onUpdated = function(){
            self.ui.setElementCallbacks({
                seasonSummer: () => self.setSeason('summer'),
                seasonAutumn: () => self.setSeason('autumn'),
                seasonWinter: () => self.setSeason('winter'),
                musicToggle: () => {
                    if (self.backgroundMusic.isPlaying) {
                        self.backgroundMusic.pause();
                        self.ui.updateElement('musicToggle', 'Play Music');
                    } else {
                        self.backgroundMusic.play();
                        self.ui.updateElement('musicToggle', 'Mute Music');
                    }
                    self.ui.update(); // Important to refresh the UI texture after text change
                }
            });
        };
        // Ensure onUpdated is triggered initially if CanvasUI is already drawn.
        // This is important to attach the callbacks right after the UI is initialized.
        if (this.ui.mesh) this.ui.onUpdated(); 
        
        this.renderer.setAnimationLoop( this.render.bind(this) );
    }
    
    buildControllers( parent = this.scene ){
        const controllerModelFactory = new XRControllerModelFactory();

        const geometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, -1 ) ] );

        const line = new THREE.Line( geometry );
        line.scale.z = 0;
        
        const controllers = [];
        
        for(let i=0; i<=1; i++){
            const controller = this.renderer.xr.getController( i );
            controller.add( line.clone() );
            controller.userData.selectPressed = false;
            parent.add( controller );
            controllers.push( controller );
            
            const grip = this.renderer.xr.getControllerGrip( i );
            grip.add( controllerModelFactory.createControllerModel( grip ) );
            parent.add( grip );
        }
        
        return controllers;
    }
    
    moveDolly(dt){
        if (this.proxy === undefined) return;
        
        const wallLimit = 1.3;
        const speed = 2;
		let pos = this.dolly.position.clone();
        pos.y += 1;
        
		let dir = new THREE.Vector3();
        //Store original dolly rotation
        const quaternion = this.dolly.quaternion.clone();
        //Get rotation for movement from the headset pose
        this.dolly.quaternion.copy( this.dummyCam.getWorldQuaternion(this.workingQuaternion) );
		this.dolly.getWorldDirection(dir);
        dir.negate();
		this.raycaster.set(pos, dir);
		
        let blocked = false;
		
		let intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length>0){
            if (intersect[0].distance < wallLimit) blocked = true;
        }
		
		if (!blocked){
            this.dolly.translateZ(-dt*speed);
            pos = this.dolly.getWorldPosition( this.origin );
		}
		
        //cast left
        dir.set(-1,0,0);
        dir.applyMatrix4(this.dolly.matrix);
        dir.normalize();
        this.raycaster.set(pos, dir);

        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length>0){
            if (intersect[0].distance<wallLimit) this.dolly.translateX(wallLimit-intersect[0].distance);
        }

        //cast right
        dir.set(1,0,0);
        dir.applyMatrix4(this.dolly.matrix);
        dir.normalize();
        this.raycaster.set(pos, dir);

        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length>0){
            if (intersect[0].distance<wallLimit) this.dolly.translateX(intersect[0].distance-wallLimit);
        }

        //cast down
        dir.set(0,-1,0);
        pos.y += 1.5;
        this.raycaster.set(pos, dir);
        
        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length>0){
            this.dolly.position.copy( intersect[0].point );
        }

        //Restore the original rotation
        this.dolly.quaternion.copy( quaternion );
	}
		
    get selectPressed(){
        return ( this.controllers !== undefined && (this.controllers[0].userData.selectPressed || this.controllers[1].userData.selectPressed) );    
    }
    
    showInfoboard( name, info, pos ){
        if (this.ui === undefined ) return;
        this.ui.position.copy(pos).add( this.workingVec3.set( 0, 1.3, 0 ) );
        const camPos = this.dummyCam.getWorldPosition( this.workingVec3 );
        this.ui.updateElement( 'name', info.name );
        this.ui.updateElement( 'info', info.info );
        this.ui.update();
        this.ui.lookAt( camPos )
        this.ui.visible = true;
        this.boardShown = name;
    }

	render( timestamp, frame ){
        const dt = this.clock.getDelta();
        
        if (this.renderer.xr.isPresenting){
            let moveGaze = false;
        
            if ( this.useGaze && this.gazeController!==undefined){
                this.gazeController.update();
                moveGaze = (this.gazeController.mode == GazeController.Modes.MOVE);
            }
        
            if (this.selectPressed || moveGaze){
                this.moveDolly(dt);
                if (this.boardData){
                    const scene = this.scene;
                    const dollyPos = this.dolly.getWorldPosition( new THREE.Vector3() );
                    let boardFound = false;
                    Object.entries(this.boardData).forEach(([name, info]) => {
                        const obj = scene.getObjectByName( name );
                        if (obj !== undefined){
                            const pos = obj.getWorldPosition( new THREE.Vector3() );
                            if (dollyPos.distanceTo( pos ) < 3){
                                boardFound = true;
                                if ( this.boardShown !== name) this.showInfoboard( name, info, pos );
                            }
                        }
                    });
                    if (!boardFound){
                        this.boardShown = "";
                        this.ui.visible = false;
                    }
                }
            }
        }
        
        if ( this.immersive != this.renderer.xr.isPresenting){
            this.resize();
            this.immersive = this.renderer.xr.isPresenting;
            // NEW: If entering VR, try to play music if not already playing
            if (this.immersive && this.backgroundMusic && !this.backgroundMusic.isPlaying) {
                this.backgroundMusic.play();
                this.ui.updateElement('musicToggle', 'Mute Music'); // Update button text
                this.ui.update();
            }
        }
        
        this.stats.update();
		this.renderer.render(this.scene, this.camera);
	}
}

export { App };
