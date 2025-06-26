import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js';
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
    constructor() {
        const container = document.createElement('div');
        document.body.appendChild(container);

        this.assetsPath = './assets/';

        // Initialize core components and render setup
        this.clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.loadingBar = new LoadingBar();
        document.body.appendChild(this.loadingBar.dom);
        this.stats = new Stats();
        document.body.appendChild(this.stats.dom);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.xr.enabled = true;
        container.appendChild(this.renderer.domElement);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
        this.camera.position.set(0, 1.6, 0);

        const listener = new THREE.AudioListener();
        this.camera.add(listener);

        // Dolly setup
        this.dolly = new THREE.Object3D();
        this.dolly.position.set(0, 0, 10);
        this.dolly.add(this.camera);
        this.dummyCam = new THREE.Object3D();
        this.camera.add(this.dummyCam);

        this.scene = new THREE.Scene();
        this.scene.add(this.dolly);

        // Initialize working vectors for calculations
        this.workingQuaternion = new THREE.Quaternion();
        this.workingVec3 = new THREE.Vector3();
        this.origin = new THREE.Vector3();

        // Background music
        const bgSound = new THREE.Audio(listener);
        const audioLoader = new THREE.AudioLoader();
        audioLoader.load(this.assetsPath + 'assets_background_music.mp3', (buffer) => {
            console.log("Background audio loaded");
            bgSound.setBuffer(buffer);
            bgSound.setLoop(true);
            bgSound.setVolume(3);
            this.scene.add(bgSound);

            const startAudio = () => {
                if (!bgSound.isPlaying) {
                    bgSound.play();
                    console.log("Background music started");
                }
                // Remove the event listener after the audio starts to prevent multiple plays
                window.removeEventListener('click', startAudio);
            };

            // Start audio on first user interaction (e.g., click)
            window.addEventListener('click', startAudio);
        }, undefined, (err) => {
            console.error("Failed to load background audio", err);
        });

        // Box click interaction (optional) - you mentioned interactiveBox but it's not defined
        // If you have an interactiveBox in your scene, make sure it's created and added to the scene.
        // For example:
        // const geometry = new THREE.BoxGeometry(1, 1, 1);
        // const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        // const interactiveBox = new THREE.Mesh(geometry, material);
        // interactiveBox.position.set(0, 1, -5); // Example position
        // this.scene.add(interactiveBox); // Add it to your scene

        window.addEventListener('click', (event) => {
            const mouse = new THREE.Vector2(
                (event.clientX / window.innerWidth) * 2 - 1,
                -(event.clientY / window.innerHeight) * 2 + 1
            );
            this.raycaster.setFromCamera(mouse, this.camera);
            // Uncomment and use 'interactiveBox' if it's defined and added to the scene
            // const intersects = this.raycaster.intersectObjects([interactiveBox]);
            // if (intersects.length > 0) {
            //     const newColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
            //     intersects[0].object.material.color.set(newColor);
            // }
        });

        // Load environment and models
        this.setEnvironment();
        this.loadCollege();

        // Handle resizing
        window.addEventListener('resize', this.resize.bind(this));
    }

    // You need to define setEnvironment method within the class
    setEnvironment() {
        const loader = new RGBELoader().setPath(this.assetsPath);
        const self = this;
        loader.load('venice_sunset_1k.hdr', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            self.scene.environment = texture;
            self.scene.background = texture;
        }, undefined, (err) => {
            console.error("Failed to load environment map", err);
        });
    }

    loadCollege() {
        const loader = new GLTFLoader().setPath(this.assetsPath);
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('./libs/three/js/draco/');
        loader.setDRACOLoader(dracoLoader);

        const self = this;

        // Load a glTF resource
        loader.load(
            // resource URL
            'college.glb',
            // called when the resource is loaded
            function (gltf) {
                const college = gltf.scene.children[0];
                self.scene.add(college);

                college.traverse(function (child) {
                    if (child.isMesh) {
                        if (child.name.indexOf("PROXY") != -1) {
                            child.material.visible = false;
                            self.proxy = child;
                        } else if (child.material.name.indexOf('Glass') != -1) {
                            child.material.opacity = 0.1;
                            child.material.transparent = true;
                        } else if (child.material.name.indexOf("SkyBox") != -1) {
                            const mat1 = child.material;
                            const mat2 = new THREE.MeshBasicMaterial({ map: mat1.map });
                            child.material = mat2;
                            mat1.dispose();
                        }
                    }
                });

                const door1 = college.getObjectByName("LobbyShop_Door_1");
                const door2 = college.getObjectByName("LobbyShop_Door_2");
                const pos = door1.position.clone().sub(door2.position).multiplyScalar(0.5).add(door2.position);
                const obj = new THREE.Object3D();
                obj.name = "LobbyShop";
                obj.position.copy(pos);
                college.add(obj);

                self.loadingBar.visible = false;

                self.setupXR();
            },
            // called while loading is progressing
            function (xhr) {
                self.loadingBar.progress = (xhr.loaded / xhr.total);
            },
            // called when loading has errors
            function (error) {
                console.error('An error happened while loading college.glb', error);
            }
        );
    }

    setupXR() {
        this.renderer.xr.enabled = true;

        const btn = new VRButton(this.renderer); // Make sure VRButton is imported and correctly linked

        const self = this;

        const timeoutId = setTimeout(connectionTimeout, 2000);

        function onSelectStart(event) {
            this.userData.selectPressed = true;
        }

        function onSelectEnd(event) {
            this.userData.selectPressed = false;
        }

        function onConnected(event) {
            clearTimeout(timeoutId);
        }

        function connectionTimeout() {
            self.useGaze = true;
            // Make sure GazeController is imported and correctly linked
            self.gazeController = new GazeController(self.scene, self.dummyCam);
        }

        this.controllers = this.buildControllers(this.dolly);

        this.controllers.forEach((controller) => {
            controller.addEventListener('selectstart', onSelectStart);
            controller.addEventListener('selectend', onSelectEnd);
            controller.addEventListener('connected', onConnected);
        });

        // CanvasUI configuration
        const config = {
            panelSize: { height: 0.5 },
            height: 256,
            name: { fontSize: 50, height: 70 },
            info: { position: { top: 70, backgroundColor: "#ccc", fontColor: "#000" } }
        };
        const content = {
            name: "name",
            info: "info"
        };

        // Make sure CanvasUI is imported and correctly linked
        this.ui = new CanvasUI(content, config);
        this.scene.add(this.ui.mesh);

        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    buildControllers(parent = this.scene) {
        const controllerModelFactory = new XRControllerModelFactory();

        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

        const line = new THREE.Line(geometry);
        line.scale.z = 0;

        const controllers = [];

        for (let i = 0; i <= 1; i++) {
            const controller = this.renderer.xr.getController(i);
            controller.add(line.clone());
            controller.userData.selectPressed = false;
            parent.add(controller);
            controllers.push(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(controllerModelFactory.createControllerModel(grip));
            parent.add(grip);
        }

        return controllers;
    }

    moveDolly(dt) {
        if (this.proxy === undefined) return;

        const wallLimit = 1.3;
        const speed = 2;
        let pos = this.dolly.position.clone();
        pos.y += 1;

        let dir = new THREE.Vector3();
        //Store original dolly rotation
        const quaternion = this.dolly.quaternion.clone();
        //Get rotation for movement from the headset pose
        this.dolly.quaternion.copy(this.dummyCam.getWorldQuaternion(this.workingQuaternion));
        this.dolly.getWorldDirection(dir);
        dir.negate();
        this.raycaster.set(pos, dir);

        let blocked = false;

        let intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length > 0) {
            if (intersect[0].distance < wallLimit) blocked = true;
        }

        if (!blocked) {
            this.dolly.translateZ(-dt * speed);
            pos = this.dolly.getWorldPosition(this.origin);
        }

        //cast left
        dir.set(-1, 0, 0);
        dir.applyMatrix4(this.dolly.matrix);
        dir.normalize();
        this.raycaster.set(pos, dir);

        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length > 0) {
            if (intersect[0].distance < wallLimit) this.dolly.translateX(wallLimit - intersect[0].distance);
        }

        //cast right
        dir.set(1, 0, 0);
        dir.applyMatrix4(this.dolly.matrix);
        dir.normalize();
        this.raycaster.set(pos, dir);

        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length > 0) {
            if (intersect[0].distance < wallLimit) this.dolly.translateX(intersect[0].distance - wallLimit);
        }

        //cast down
        dir.set(0, -1, 0);
        pos.y += 1.5;
        this.raycaster.set(pos, dir);

        intersect = this.raycaster.intersectObject(this.proxy);
        if (intersect.length > 0) {
            this.dolly.position.copy(intersect[0].point);
        }

        //Restore the original rotation
        this.dolly.quaternion.copy(quaternion);
    }

    get selectPressed() {
        return (this.controllers !== undefined && (this.controllers[0].userData.selectPressed || this.controllers[1].userData.selectPressed));
    }

    showInfoboard(name, info, pos) {
        if (this.ui === undefined) return;

        // Ensure workingVec3 is initialized
        if (!this.workingVec3) this.workingVec3 = new THREE.Vector3();

        this.ui.position.copy(pos).add(this.workingVec3.set(0, 1.3, 0));
        const camPos = this.dummyCam.getWorldPosition(this.workingVec3);
        this.ui.updateElement('name', info.name);
        this.ui.updateElement('info', info.info);
        this.ui.update();
        this.ui.lookAt(camPos);
        this.ui.visible = true;
        this.boardShown = name;
    }

    render(timestamp, frame) {
        const dt = this.clock.getDelta();

        if (this.renderer.xr.isPresenting) {
            let moveGaze = false;

            if (this.useGaze && this.gazeController !== undefined) {
                this.gazeController.update();
                moveGaze = (this.gazeController.mode == GazeController.Modes.MOVE);
            }

            if (this.selectPressed || moveGaze) {
                this.moveDolly(dt);
                // Ensure boardData is defined before accessing it
                if (this.boardData) {
                    const scene = this.scene;
                    const dollyPos = this.dolly.getWorldPosition(new THREE.Vector3());
                    let boardFound = false;
                    Object.entries(this.boardData).forEach(([name, info]) => {
                        const obj = scene.getObjectByName(name);
                        if (obj !== undefined) {
                            const pos = obj.getWorldPosition(new THREE.Vector3());
                            if (dollyPos.distanceTo(pos) < 3) {
                                boardFound = true;
                                if (this.boardShown !== name) this.showInfoboard(name, info, pos);
                            }
                        }
                    });
                    if (!boardFound) {
                        this.boardShown = "";
                        this.ui.visible = false;
                    }
                }
            }
        }

        // Ensure 'immersive' property is initialized if used for the first time here
        if (this.immersive === undefined) this.immersive = false;

        if (this.immersive != this.renderer.xr.isPresenting) {
            this.resize();
            this.immersive = this.renderer.xr.isPresenting;
        }

        this.stats.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

export { App };
